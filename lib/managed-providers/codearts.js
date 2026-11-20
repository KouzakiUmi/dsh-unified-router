// CodeArts（华为云码道）自管多账号渠道规格。
// 参考：officeace-auth@0.3.2 (MIT) 与本机 CodeArts 0.2.9 (app.asar / product.json) 实测。
import { createCipheriv, createDecipheriv, createHash, createHmac, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PORTAL_AUTHORIZE_URL = 'https://codearts.huaweicloud.com/portal/authorize'
const STS_ORIGIN = 'https://sts.cn-north-4.myhuaweicloud.com'
const STS_TOKEN_URL = `${STS_ORIGIN}/v1/oauth2/tokens`
const STS_CALLER_URL = `${STS_ORIGIN}/v5/caller-identity`
const SNAP_ORIGIN = 'https://snap-access.cn-north-4.myhuaweicloud.com'
const OPENGW_ORIGIN = 'https://opengw.developer.huaweicloud.com'
const INFER_BASE_URL = `${SNAP_ORIGIN}/api/v1`
const INFER_CHAT_PATH = '/api/v1/chat/completions'
const CLIENT_ID = 'codearts'
const PLUGIN_NAME = 'snap_AIIDE'
const PLUGIN_VERSION = '5.1.0'
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

// 2026-11-20 本机 CodeArts 0.2.9 核实的内置兜底模型表（KERNEL_MODELS）
export const CODEARTS_FALLBACK_MODELS = Object.freeze([
  { id: 'GLM-5.2', name: 'GLM-5.2', context: 1_048_576, output: 32_000, efforts: ['off', 'high'], defaultEffort: 'high', rate: 0.62, protocol: 'openai-completions' },
  { id: 'GLM-5.2-ZX', name: 'GLM-5.2-ZX', context: 1_048_576, output: 32_000, efforts: ['off', 'high'], defaultEffort: 'high', rate: 0.62, protocol: 'openai-completions' },
  { id: 'GLM-5.1', name: 'GLM-5.1', context: 1_048_576, output: 32_000, rate: 1.32, protocol: 'openai-completions' },
])

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data).digest('hex')
}

function formatSdkDate(now = Date.now()) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

// 华为云 SDK-HMAC-SHA256 签名（对齐本机 CodeArts AuthService.sign 与 officeace-auth signRequestHuawei）。
export function signHuaweiRequest({ method, url, headers = {}, body = '', accessKey, secretKey, securityToken }) {
  const parsed = new URL(url)
  const sdkDate = formatSdkDate()
  const lowerHeaders = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) lowerHeaders[k.toLowerCase()] = String(v).trim()
  }
  lowerHeaders.host = parsed.host
  lowerHeaders['x-sdk-date'] = sdkDate
  if (securityToken) lowerHeaders['x-security-token'] = securityToken

  const signedHeaderNames = Object.keys(lowerHeaders)
    .filter(name => ['host', 'x-sdk-date', 'x-security-token', 'content-type', 'agent-type', 'x-language', 'x-sdk-content-sha256', 'maas_type'].includes(name))
    .sort()
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${lowerHeaders[name]}\n`).join('')
  const signedHeadersStr = signedHeaderNames.join(';')

  const canonicalUri = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
  const queryPairs = [...parsed.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  const canonicalQuery = queryPairs.map(([k, v]) => `${k}=${v}`).join('&')

  const payloadHash = sha256Hex(typeof body === 'string' ? body : '')
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join('\n')

  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${sha256Hex(canonicalRequest)}`
  const signature = hmacHex(secretKey, stringToSign)
  const authorization = `SDK-HMAC-SHA256 Access=${accessKey}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`

  return {
    ...headers,
    'User-Agent': CHROME_UA,
    'X-Sdk-Date': sdkDate,
    ...(securityToken ? { 'X-Security-Token': securityToken } : {}),
    Authorization: authorization,
  }
}

function createDpopJwt({ method, url, privateJwk, publicJwk }) {
  const header = {
    alg: 'ES256',
    typ: 'dpop+jwt',
    jwk: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y },
  }
  const payload = {
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString('hex'),
  }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const sig = cryptoSign('sha256', Buffer.from(signingInput), {
    key: { key: privateJwk, format: 'jwk' },
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${signingInput}.${sig}`
}

function generateDpopKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  }
}

export function sanitizeCodeArtsCredential(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const accessKey = typeof raw.accessKey === 'string' ? raw.accessKey.trim() : typeof raw.access_key_id === 'string' ? raw.access_key_id.trim() : ''
  const secretKey = typeof raw.secretKey === 'string' ? raw.secretKey.trim() : typeof raw.secret_access_key === 'string' ? raw.secret_access_key.trim() : ''
  const securityToken = typeof raw.securityToken === 'string' ? raw.securityToken.trim() : typeof raw.security_token === 'string' ? raw.security_token.trim() : ''
  if (!accessKey || !secretKey || !securityToken) return null
  const out = {
    accessKey: accessKey.slice(0, 256),
    secretKey: secretKey.slice(0, 512),
    securityToken: securityToken.slice(0, 8192),
    clientId: typeof raw.clientId === 'string' && raw.clientId ? raw.clientId.slice(0, 64) : CLIENT_ID,
  }
  if (typeof raw.refreshToken === 'string' && raw.refreshToken) out.refreshToken = raw.refreshToken.slice(0, 8192)
  if (typeof raw.codeVerifier === 'string' && raw.codeVerifier) out.codeVerifier = raw.codeVerifier.slice(0, 256)
  if (Number.isFinite(raw.expiresAt)) out.expiresAt = raw.expiresAt
  if (typeof raw.userId === 'string' && raw.userId) out.userId = raw.userId.slice(0, 120)
  if (typeof raw.userName === 'string' && raw.userName) out.userName = raw.userName.slice(0, 120)
  if (raw.dpopPrivateJwk && typeof raw.dpopPrivateJwk === 'object') out.dpopPrivateJwk = raw.dpopPrivateJwk
  if (raw.dpopPublicJwk && typeof raw.dpopPublicJwk === 'object') out.dpopPublicJwk = raw.dpopPublicJwk
  return out
}

async function dpapiUnprotectBase64(base64Bytes) {
  if (process.platform !== 'win32') throw new Error('仅 Windows 支持 DPAPI 解密本机 CodeArts 凭据')
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$raw = [Convert]::FromBase64String('${base64Bytes}')`,
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  ].join('; ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000 })
  return Buffer.from(stdout.trim(), 'base64')
}

async function readLocalCodeArtsSession() {
  if (process.platform !== 'win32') return null
  const appData = process.env.APPDATA
  if (!appData) return null
  const dir = join(appData, 'codearts')
  const localStatePath = join(dir, 'Local State')
  const encPath = join(dir, 'secretStorage', `${sha256Hex('authSession:cn-north-4')}.enc`)
  if (!existsSync(localStatePath) || !existsSync(encPath)) return null

  const localState = JSON.parse(readFileSync(localStatePath, 'utf8'))
  const encKeyB64 = localState?.os_crypt?.encrypted_key
  if (typeof encKeyB64 !== 'string' || !encKeyB64) return null
  const encKeyBuf = Buffer.from(encKeyB64, 'base64')
  if (encKeyBuf.subarray(0, 5).toString('utf8') !== 'DPAPI') return null
  const aesKey = await dpapiUnprotectBase64(encKeyBuf.subarray(5).toString('base64'))

  const encText = readFileSync(encPath, 'utf8').trim()
  const payload = Buffer.from(encText, 'base64')
  if (payload.subarray(0, 3).toString('utf8') !== 'v10') return null
  const iv = payload.subarray(3, 15)
  const tag = payload.subarray(payload.length - 16)
  const ciphertext = payload.subarray(15, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const parsed = JSON.parse(plaintext)
  const s = parsed?.session
  if (!s) return null
  const cred = sanitizeCodeArtsCredential({
    accessKey: s.accessKey,
    secretKey: s.secretKey,
    securityToken: s.securityToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresAt,
    clientId: s.clientId || CLIENT_ID,
    userId: s.userId,
    userName: s.userName,
    codeVerifier: parsed?.loginContext?.pkcePair?.codeVerifier,
    dpopPrivateJwk: parsed?.loginContext?.dpopKeyPair?.privateKey,
    dpopPublicJwk: parsed?.loginContext?.dpopKeyPair?.publicKey,
  })
  if (!cred) return null
  return {
    credential: cred,
    uid: cred.userId || '',
    name: cred.userName || (cred.userId ? `CodeArts (${cred.userId.slice(0, 6)})` : 'CodeArts 本机账号'),
  }
}

async function refreshCodeArtsToken(fetchImpl, cred, signal) {
  if (!cred.refreshToken || !cred.codeVerifier || !cred.dpopPrivateJwk || !cred.dpopPublicJwk) return null
  const dpop = createDpopJwt({ method: 'POST', url: STS_TOKEN_URL, privateJwk: cred.dpopPrivateJwk, publicJwk: cred.dpopPublicJwk })
  const form = new URLSearchParams({
    client_id: cred.clientId || CLIENT_ID,
    code_verifier: cred.codeVerifier,
    grant_type: 'refresh_token',
    refresh_token: cred.refreshToken,
  })
  const res = await fetchImpl(STS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpop, 'User-Agent': CHROME_UA },
    body: form.toString(),
    redirect: 'error',
    signal,
  })
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  const c = json?.credentials
  if (!c?.access_key_id || !c?.secret_access_key || !c?.security_token) return null
  return sanitizeCodeArtsCredential({
    ...cred,
    accessKey: c.access_key_id,
    secretKey: c.secret_access_key,
    securityToken: c.security_token,
    expiresAt: c.expiration ? Date.parse(c.expiration) : Date.now() + 55 * 60_000,
    refreshToken: json.refresh_token || cred.refreshToken,
  })
}

async function ensureFreshCredential(handle, signal) {
  const cred = await handle.getCredential()
  if (!cred) return null
  if (Number.isFinite(cred.expiresAt) && cred.expiresAt - Date.now() < 5 * 60_000 && cred.refreshToken) {
    const refreshed = await refreshCodeArtsToken(handle.fetch, cred, signal).catch(() => null)
    if (refreshed) {
      await handle.saveCredential(refreshed)
      return refreshed
    }
  }
  return cred
}

async function signedFetchJson(fetchImpl, cred, { method = 'GET', url, headers = {}, body, signal, timeoutMs = 10_000 }) {
  const bodyStr = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const signedHeaders = signHuaweiRequest({
    method,
    url,
    headers: {
      'X-Language': 'zh-cn',
      'x-snap-traceid': randomBytes(8).toString('hex'),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: bodyStr,
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
    securityToken: cred.securityToken,
  })
  const deadline = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const res = await fetchImpl(url, {
    method,
    headers: signedHeaders,
    ...(body !== undefined ? { body: bodyStr } : {}),
    signal: combined,
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function parseRatio(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const m = /([\d.]+)/.exec(value)
    if (m) return Number(m[1])
  }
  return null
}

// 合并相邻同角色消息（CodeArts /api/v1 严格要求 user/assistant 交替）
export function mergeConsecutiveTurns(messages) {
  if (!Array.isArray(messages)) return messages
  const out = []
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const prev = out[out.length - 1]
    if (prev && prev.role === msg.role && (msg.role === 'user' || msg.role === 'assistant') && !prev.tool_calls && !msg.tool_calls) {
      if (typeof prev.content === 'string' && typeof msg.content === 'string') {
        prev.content = `${prev.content}\n\n${msg.content}`
        continue
      }
    }
    out.push({ ...msg })
  }
  return out
}

export function parseCodeArtsBuiltinModels(json) {
  const list = Array.isArray(json?.builtinModels) ? json.builtinModels : Array.isArray(json?.data?.builtinModels) ? json.data.builtinModels : []
  const hidden = new Set(['Qwen3-VL-235B', 'maas-glm-4.7'])
  const out = []
  for (const m of list) {
    const id = typeof m?.model_id === 'string' ? m.model_id.trim() : typeof m?.model_name === 'string' ? m.model_name.trim() : ''
    if (!id || hidden.has(id) || m.display_enabled === false) continue
    const rawName = typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim()
      : typeof m.model_name === 'string' && m.model_name.trim() ? m.model_name.trim() : id
    const ratio = parseRatio(m.credit?.ratio_display)
    const beforeRatio = parseRatio(m.credit?.before_display_ratio)
    const hasThinking = Boolean(m.think_level) || /think|reason/i.test(String(m.model_tag ?? ''))
    const rawOut = Number(m.max_tokens ?? m.output_context_window) || 32_000
    out.push({
      id,
      name: rawName,
      context: Number(m.context_window ?? m.input_context_window ?? m.input_length) || 200_000,
      // /api/v1 实测 max_tokens 上限 32000
      output: Math.min(32_000, rawOut),
      attachment: m.supports_images === true,
      efforts: hasThinking ? ['off', 'high'] : [],
      defaultEffort: hasThinking ? 'high' : '',
      free: m.is_free_benefit === true || ratio === 0,
      rate: ratio,
      rateWas: beforeRatio,
      protocol: 'openai-completions',
      meta: { maasType: m.maas_type || (m.is_free_benefit ? 'benefit' : '') },
    })
  }
  return out
}

function listenCallbackServer(signal) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    let settled = false
    let resolveCode
    let rejectCode
    const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej })
    server.on('request', (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.pathname !== '/oauth/callback') { res.writeHead(404); res.end('Not found'); return }
        const code = u.searchParams.get('code')
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body><h3>CodeArts 登录成功，可关闭此页面。</h3></body></html>')
          if (!settled) { settled = true; resolveCode(code) }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Missing authorization code')
        }
      } catch {
        res.writeHead(500); res.end('Error')
      }
    })
    const onAbort = () => {
      if (!settled) { settled = true; rejectCode(new Error('登录已取消')) }
      server.close()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // 华为云要求回调端口 >= 10000
    const tryPort = attempt => {
      if (attempt >= 20) return reject(new Error('无法绑定本地回调端口'))
      const port = 10000 + Math.floor(Math.random() * 45000)
      server.once('error', () => tryPort(attempt + 1))
      server.listen(port, '127.0.0.1', () => {
        resolve({
          port,
          codePromise,
          close() {
            signal?.removeEventListener('abort', onAbort)
            server.close()
          },
        })
      })
    }
    tryPort(0)
  })
}

export const codeartsSpec = {
  id: 'codearts',
  title: 'CodeArts',
  protocol: 'openai-completions',
  baseUrl: INFER_BASE_URL,
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkinResetHour: 0,
  taskResetHour: 0,
  fallbackModels: CODEARTS_FALLBACK_MODELS,
  sanitizeCredential: sanitizeCodeArtsCredential,

  async importLocal({ fetch, signal }) {
    const found = await readLocalCodeArtsSession()
    if (!found) throw new Error('未检测到本机 CodeArts 登录态')
    // 用 caller-identity 校验凭据有效
    const identity = await signedFetchJson(fetch, found.credential, { url: STS_CALLER_URL, signal }).catch(() => null)
    return {
      credential: found.credential,
      uid: identity?.principal_id || found.uid,
      name: identity?.user_name || found.name,
    }
  },

  async loginWithBrowser({ fetch, signal, onUrl }) {
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const ticketId = randomBytes(16).toString('hex')
    const { publicJwk, privateJwk } = generateDpopKeyPair()
    const callback = await listenCallbackServer(signal)
    try {
      const redirectUri = `http://127.0.0.1:${callback.port}/oauth/callback`
      const params = new URLSearchParams({
        theme: '2',
        locale: 'zh-cn',
        uri_scheme: CLIENT_ID,
        client_id: CLIENT_ID,
        port: String(callback.port),
        code_challenge: codeChallenge,
        code_challenge_method: 'SHA-256',
        ticket_id: ticketId,
        'plugin-name': PLUGIN_NAME,
        'plugin-version': PLUGIN_VERSION,
      })
      onUrl?.(`${PORTAL_AUTHORIZE_URL}?${params}`)
      const timeout = new Promise((_, rej) => {
        const t = setTimeout(() => rej(new Error('登录超时')), 5 * 60_000)
        t.unref?.()
      })
      const code = await Promise.race([callback.codePromise, timeout])
      const dpop = createDpopJwt({ method: 'POST', url: STS_TOKEN_URL, privateJwk, publicJwk })
      const form = new URLSearchParams({
        client_id: CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      })
      const res = await fetch(STS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpop, 'User-Agent': CHROME_UA },
        body: form.toString(),
        redirect: 'error',
        signal,
      })
      if (!res.ok) throw new Error('CodeArts 凭据交换失败')
      const json = await res.json()
      const c = json?.credentials
      const credential = sanitizeCodeArtsCredential({
        accessKey: c?.access_key_id,
        secretKey: c?.secret_access_key,
        securityToken: c?.security_token,
        expiresAt: c?.expiration ? Date.parse(c.expiration) : Date.now() + 55 * 60_000,
        refreshToken: json?.refresh_token,
        clientId: CLIENT_ID,
        codeVerifier,
        dpopPrivateJwk: privateJwk,
        dpopPublicJwk: publicJwk,
      })
      if (!credential) throw new Error('CodeArts 凭据无效')
      const identity = await signedFetchJson(fetch, credential, { url: STS_CALLER_URL, signal }).catch(() => null)
      credential.userId = identity?.principal_id || ''
      credential.userName = identity?.user_name || ''
      return {
        credential,
        uid: credential.userId,
        name: credential.userName || 'CodeArts 账号',
      }
    } finally {
      callback.close()
    }
  },

  async parseCredential(raw, { fetch, signal }) {
    let parsed
    try { parsed = JSON.parse(raw) } catch { throw new Error('请粘贴有效的 JSON 凭据') }
    const credential = sanitizeCodeArtsCredential(parsed)
    if (!credential) throw new Error('缺少 accessKey / secretKey / securityToken')
    const identity = await signedFetchJson(fetch, credential, { url: STS_CALLER_URL, signal })
    return {
      credential: { ...credential, userId: identity?.principal_id || credential.userId, userName: identity?.user_name || credential.userName },
      uid: identity?.principal_id || credential.userId || '',
      name: identity?.user_name || credential.userName || 'CodeArts 账号',
    }
  },

  async fetchModels(handle, { signal }) {
    const cred = await ensureFreshCredential(handle, signal)
    if (!cred) return []
    const [builtin, freeCfg] = await Promise.all([
      signedFetchJson(handle.fetch, cred, {
        url: `${SNAP_ORIGIN}/v1/model/builtin`,
        headers: { 'Agent-Type': 'PromptCenter' },
        signal,
      }).catch(() => null),
      signedFetchJson(handle.fetch, cred, {
        url: `${OPENGW_ORIGIN}/api/v1/gateway/config`,
        signal,
      }).catch(() => null),
    ])
    const rows = parseCodeArtsBuiltinModels(builtin)
    const seen = new Set(rows.map(r => r.id))
    const freeModels = Array.isArray(freeCfg?.result?.models) ? freeCfg.result.models : []
    for (const fm of freeModels) {
      const id = typeof fm?.model_id === 'string' ? fm.model_id.trim() : typeof fm?.id === 'string' ? fm.id.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      rows.push({
        id,
        name: typeof fm.display_name === 'string' && fm.display_name.trim() ? fm.display_name.trim() : id,
        context: Number(fm.context_window) || 200_000,
        output: Math.min(32_000, Number(fm.max_tokens) || 32_000),
        attachment: fm.supports_images === true,
        free: true,
        protocol: 'openai-completions',
        meta: { maasType: 'benefit' },
      })
    }
    return rows
  },

  async fetchUsage(handle, { signal }) {
    const cred = await ensureFreshCredential(handle, signal)
    if (!cred) return { signedIn: false, error: 'credential_error' }
    const [stats, freeBal] = await Promise.all([
      signedFetchJson(handle.fetch, cred, {
        url: `${SNAP_ORIGIN}/snap-manager/v1/statistics/plugin`,
        headers: { 'Agent-Type': 'PromptCenter' },
        signal,
      }),
      signedFetchJson(handle.fetch, cred, {
        url: `${OPENGW_ORIGIN}/api/v1/user/tokens/balance?channel=benefit`,
        signal,
      }).catch(() => null),
    ])
    const pkg = stats?.package ?? {}
    const metrics = Array.isArray(stats?.metrics) ? stats.metrics : []
    const windows = []
    let totalRemain = null
    for (const m of metrics) {
      if (!m || m.show === false) continue
      const amount = Number(m.package_credit_amount)
      const remain = Number(m.package_credit_remain)
      const used = Number(m.package_credit_used)
      if (m.name === 'usageTotalPackageCredit' && Number.isFinite(remain)) totalRemain = remain
      if (Number.isFinite(amount) && amount > 0 && Number.isFinite(remain)) {
        const labelMap = {
          usageTotalPackageCredit: '总积分包',
          usageBasicPackageCredit: '基础积分包',
          usageOnDemandPackageCredit: '按需积分包',
          usageBonusPackageCredit: '赠送积分包',
        }
        windows.push({
          name: labelMap[m.name] || m.name,
          balance: remain,
          limit: amount,
          amount: Number.isFinite(used) ? used : amount - remain,
          used: Math.round((1 - remain / amount) * 100),
          unit: '积分',
          resetsAt: typeof stats?.end_date === 'string' ? stats.end_date : '',
        })
      }
    }
    const freeResult = freeBal?.result
    if (Number.isFinite(freeResult?.daily_token_limit) && freeResult.daily_token_limit > 0) {
      const usedTokens = Number(freeResult.daily_tokens_used) || 0
      windows.push({
        name: '免费日额度',
        balance: Math.max(0, freeResult.daily_token_limit - usedTokens),
        limit: freeResult.daily_token_limit,
        amount: usedTokens,
        used: Math.round((usedTokens / freeResult.daily_token_limit) * 100),
        unit: 'Tokens',
      })
    }
    return {
      signedIn: true,
      uid: cred.userId || '',
      plan: typeof pkg.package_name_cn === 'string' ? pkg.package_name_cn : '',
      balance: totalRemain,
      unit: '积分',
      windows,
      updatedAt: Date.now(),
    }
  },

  async checkin(handle, { signal }) {
    const cred = await ensureFreshCredential(handle, signal)
    if (!cred) return { outcome: 'ineligible', unsubmitted: true }
    const day = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')
    // 1. 触发每日登录事件上报
    await signedFetchJson(handle.fetch, cred, {
      method: 'POST',
      url: `${SNAP_ORIGIN}/v1/ops/events/trigger`,
      headers: { 'Agent-Type': 'PromptCenter' },
      body: { triggerEvent: 'user.login', channel: 'DESKTOP', idempotentKey: `login-${day}-${randomBytes(3).toString('hex')}` },
      signal,
    }).catch(() => {})

    // 2. 查询可领取每日签到活动
    const delivery = await signedFetchJson(handle.fetch, cred, {
      url: `${SNAP_ORIGIN}/v1/ops/delivery?channel=DESKTOP`,
      headers: { 'Agent-Type': 'PromptCenter' },
      signal,
    })
    const items = Array.isArray(delivery?.data) ? delivery.data : Array.isArray(delivery?.campaigns) ? delivery.campaigns : []
    const daily = items.find(item => ['daily_claim', 'DAILY_CLAIM', 'USER_LOGIN'].includes(String(item?.type ?? '')))
    if (!daily) return { outcome: 'inactive', unsubmitted: true }
    const doneStatus = new Set(['CLAIMED', 'CONFIRMED', 'CONSUMED'])
    if (daily.claimed === true || doneStatus.has(String(daily.status ?? '').toUpperCase())) {
      return { outcome: 'already-claimed' }
    }
    const claimRes = await signedFetchJson(handle.fetch, cred, {
      method: 'POST',
      url: `${SNAP_ORIGIN}/v1/ops/claim`,
      headers: { 'Agent-Type': 'PromptCenter' },
      body: {
        campaignId: daily.campaignId ?? daily.id,
        idempotentKey: `claim_${daily.campaignId ?? daily.id}_${Date.now()}`,
        channel: 'DESKTOP',
        ...(daily.benefitId ? { benefitId: daily.benefitId } : {}),
      },
      signal,
    })
    const userBenefitId = claimRes?.data?.id ?? claimRes?.data?.userBenefitId
    await signedFetchJson(handle.fetch, cred, {
      method: 'POST',
      url: `${SNAP_ORIGIN}/v1/ops/confirm`,
      headers: { 'Agent-Type': 'PromptCenter' },
      body: userBenefitId ? { userBenefitId } : { campaignId: daily.campaignId ?? daily.id },
      signal,
    }).catch(() => {})
    const credit = Number(claimRes?.data?.amount ?? claimRes?.data?.creditAmount)
    return { outcome: 'claimed', credit: Number.isFinite(credit) ? credit : null }
  },

  async claimRewards(handle, { signal }) {
    const cred = await ensureFreshCredential(handle, signal)
    if (!cred) return { kind: 'failed', retryable: true }
    const delivery = await signedFetchJson(handle.fetch, cred, {
      url: `${SNAP_ORIGIN}/v1/ops/delivery?channel=DESKTOP`,
      headers: { 'Agent-Type': 'PromptCenter' },
      signal,
    })
    const items = Array.isArray(delivery?.data) ? delivery.data : Array.isArray(delivery?.campaigns) ? delivery.campaigns : []
    const doneStatus = new Set(['CLAIMED', 'CONFIRMED', 'CONSUMED'])
    let claimed = 0
    for (const item of items) {
      if (item?.claimable === false || item?.claimed === true || doneStatus.has(String(item?.status ?? '').toUpperCase())) continue
      const campaignId = item.campaignId ?? item.id
      if (!campaignId) continue
      try {
        const res = await signedFetchJson(handle.fetch, cred, {
          method: 'POST',
          url: `${SNAP_ORIGIN}/v1/ops/claim`,
          headers: { 'Agent-Type': 'PromptCenter' },
          body: { campaignId, idempotentKey: `claim_${campaignId}_${Date.now()}`, channel: 'DESKTOP' },
          signal,
        })
        const userBenefitId = res?.data?.id ?? res?.data?.userBenefitId
        await signedFetchJson(handle.fetch, cred, {
          method: 'POST',
          url: `${SNAP_ORIGIN}/v1/ops/confirm`,
          headers: { 'Agent-Type': 'PromptCenter' },
          body: userBenefitId ? { userBenefitId } : { campaignId },
          signal,
        }).catch(() => {})
        claimed += 1
      } catch {}
    }
    return claimed > 0 ? { kind: 'claimed', claimed } : { kind: 'done', claimed: 0 }
  },

  async createTransport(handle) {
    const cred = await ensureFreshCredential(handle)
    if (!cred) throw new Error('CodeArts 凭据缺失')
    return {
      async fetch(input, init, { row, request } = {}) {
        const isReq = typeof Request !== 'undefined' && input instanceof Request
        const url = new URL(isReq ? input.url : input)
        if (url.origin !== SNAP_ORIGIN || url.pathname !== INFER_CHAT_PATH) {
          throw new Error('CodeArts 请求地址无效')
        }
        let body = init?.body
        body ??= isReq ? await input.clone().text() : undefined
        if (typeof body === 'string') {
          try {
            const parsed = JSON.parse(body)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              // 1. /api/v1 严格 user/assistant 交替
              if (Array.isArray(parsed.messages)) parsed.messages = mergeConsecutiveTurns(parsed.messages)
              // 2. /api/v1 max_tokens 上限 32000
              if (Number.isFinite(parsed.max_tokens) && parsed.max_tokens > 32_000) parsed.max_tokens = 32_000
              if (Number.isFinite(parsed.max_completion_tokens) && parsed.max_completion_tokens > 32_000) parsed.max_completion_tokens = 32_000
              // 3. stop 只收单字符串
              if (Array.isArray(parsed.stop)) parsed.stop = parsed.stop[0]
              // 4. 思考控制
              if (request?.reasoningEffort === 'off') parsed.enable_thinking = false
              else if (request?.reasoningEffort) parsed.enable_thinking = true
              // 5. 码道只对流式计费
              parsed.stream = true
              body = JSON.stringify(parsed)
            }
          } catch {}
        }
        const extraHeaders = {
          'Content-Type': 'application/json',
          'Agent-Type': 'PromptCenter',
          'X-Language': 'zh-cn',
          'x-snap-traceid': randomBytes(8).toString('hex'),
          'x-ot-session-id': String(request?.sessionId || randomBytes(8).toString('hex')).slice(0, 128),
          ...(handle.entry?.deviceId ? { 'x-ot-client-id': handle.entry.deviceId } : {}),
          ...(row?.meta?.maasType === 'benefit' || row?.free ? { maas_type: 'benefit' } : {}),
        }
        const signedHeaders = signHuaweiRequest({
          method: 'POST',
          url: url.href,
          headers: extraHeaders,
          body: typeof body === 'string' ? body : '',
          accessKey: cred.accessKey,
          secretKey: cred.secretKey,
          securityToken: cred.securityToken,
        })
        return handle.fetch(url.href, { ...init, method: 'POST', headers: signedHeaders, body })
      },
    }
  },
}
