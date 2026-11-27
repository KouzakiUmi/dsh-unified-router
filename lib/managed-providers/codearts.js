// CodeArts（华为云码道）自管多账号渠道规格。
// 参考：officeace-auth@0.3.2 (MIT) 与本机 CodeArts 0.2.9 (app.asar / product.json) 实测。
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { openSystemBrowser } from '../browser-login.js'
import { channelOutputHardCap } from '../model-catalog.js'
import { normalizeCodeArtsStream } from './codearts-stream.js'
import { codeArtsSessionId, holdCodeArtsSession, trackCodeArtsResponse } from './codearts-session.js'

const execFileAsync = promisify(execFile)

const PORTAL_AUTHORIZE_URL = 'https://codearts.huaweicloud.com/portal/authorize'
const STS_ORIGIN = 'https://sts.cn-north-4.myhuaweicloud.com'
const STS_TOKEN_URL = `${STS_ORIGIN}/v1/oauth2/tokens`
const STS_CALLER_URL = `${STS_ORIGIN}/v5/caller-identity`
const SNAP_ORIGIN = 'https://snap-access.cn-north-4.myhuaweicloud.com'
const OPENGW_ORIGIN = 'https://opengw.developer.huaweicloud.com'
const INFER_BASE_URL = `${SNAP_ORIGIN}/api/v2`
const INFER_CHAT_PATH = '/api/v2/chat/completions'
const OUTPUT_BUDGET_CAP = channelOutputHardCap('codearts')
const CLIENT_ID = 'codearts'
const PLUGIN_NAME = 'snap_AIIDE'
const PLUGIN_VERSION = '5.1.0'
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

// 2026-11-20 本机 CodeArts 0.2.9 核实的内置兜底模型表（KERNEL_MODELS）
export const CODEARTS_FALLBACK_MODELS = Object.freeze([
  { id: 'GLM-5.2', name: 'GLM-5.2', context: 1_048_576, output: null, rate: 0.62, protocol: 'openai-completions' },
  { id: 'GLM-5.2-ZX', name: 'GLM-5.2-ZX', context: 1_048_576, output: null, rate: 0.62, protocol: 'openai-completions' },
  { id: 'GLM-5.1', name: 'GLM-5.1', context: 1_048_576, output: null, rate: 1.32, protocol: 'openai-completions' },
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

function parseJwk(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  return null
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value)
    if (Number.isFinite(num) && num > 0) return num
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function createDpopJwt({ method, url, privateJwk, publicJwk }) {
  const priv = parseJwk(privateJwk)
  const pub = parseJwk(publicJwk)
  if (!priv || !pub || !pub.x || !pub.y) throw new Error('DPoP 密钥格式无效')
  const header = {
    alg: 'ES256',
    typ: 'dpop+jwt',
    jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y },
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
  // Node.js crypto.sign 需要先由 createPrivateKey 从 JWK 构造 KeyObject。
  const keyObject = createPrivateKey({ key: priv, format: 'jwk' })
  const sig = cryptoSign('sha256', Buffer.from(signingInput), {
    key: keyObject,
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
  const expiresAt = parseTimestamp(raw.expiresAt)
  if (expiresAt !== undefined) out.expiresAt = expiresAt
  if (typeof raw.userId === 'string' && raw.userId) out.userId = raw.userId.slice(0, 120)
  if (typeof raw.userName === 'string' && raw.userName) out.userName = raw.userName.slice(0, 120)
  // 本机 CodeArts secretStorage 把 DPoP JWK 存成 JSON 字符串；同时兼容对象与字符串。
  const privJwk = parseJwk(raw.dpopPrivateJwk ?? raw.dpopKeyPair?.privateKey)
  const pubJwk = parseJwk(raw.dpopPublicJwk ?? raw.dpopKeyPair?.publicKey)
  if (privJwk) out.dpopPrivateJwk = privJwk
  if (pubJwk) out.dpopPublicJwk = pubJwk
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

// 按账号单飞刷新：华为云 refresh_token 是一次性轮换，并发刷新会让先到的轮换把后到的作废。
const refreshInFlight = new Map()

function callerUserName(identity, fallback = '') {
  if (typeof identity?.principal_urn === 'string' && identity.principal_urn) {
    const tail = identity.principal_urn.slice(identity.principal_urn.lastIndexOf(':') + 1)
    const name = tail.includes('/') ? tail.slice(tail.indexOf('/') + 1) : tail
    if (name) return name
  }
  return identity?.user_name || identity?.userName || fallback
}

async function ensureFreshCredential(handle, signal, { force = false } = {}) {
  const cred = await handle.getCredential()
  if (!cred) return null
  const needsRefresh = force || (Number.isFinite(cred.expiresAt) && cred.expiresAt - Date.now() < 5 * 60_000)
  if (!needsRefresh) return cred

  const lockKey = handle.entry?.id || cred.userId || 'default'
  if (refreshInFlight.has(lockKey)) {
    const shared = await refreshInFlight.get(lockKey).catch(() => null)
    return shared || cred
  }

  const job = (async () => {
    const latest = await handle.getCredential()
    if (!latest) return null
    if (!force && Number.isFinite(latest.expiresAt) && latest.expiresAt - Date.now() >= 5 * 60_000) return latest

    // 1. 先尝试用当前账号持有的 refreshToken + PKCE + DPoP 刷新
    if (latest.refreshToken) {
      const refreshed = await refreshCodeArtsToken(handle.fetch, latest, signal).catch(() => null)
      if (refreshed) {
        await handle.saveCredential(refreshed, latest)
        return refreshed
      }
    }

    // 2. 本机导入账号自愈：旧版导入缺失 DPoP 密钥，或本机桌面端轮换了 refreshToken 时，
    // 重新读取本机 secretStorage（仅同账号才采纳）。
    if (handle.entry?.source === 'local') {
      const localFound = await readLocalCodeArtsSession().catch(() => null)
      const localCred = localFound?.credential
      const sameUser = localCred && (!latest.userId || !localCred.userId || localCred.userId === latest.userId)
      if (sameUser) {
        if (Number.isFinite(localCred.expiresAt) && localCred.expiresAt - Date.now() >= 5 * 60_000) {
          await handle.saveCredential(localCred, latest)
          return localCred
        }
        if (localCred.refreshToken) {
          const refreshed = await refreshCodeArtsToken(handle.fetch, localCred, signal).catch(() => null)
          if (refreshed) {
            await handle.saveCredential(refreshed, latest)
            return refreshed
          }
        }
      }
    }
    return latest
  })()

  refreshInFlight.set(lockKey, job)
  try {
    return (await job) || cred
  } finally {
    if (refreshInFlight.get(lockKey) === job) refreshInFlight.delete(lockKey)
  }
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

const codeArtsDailyClaimed = item => item?.claimed === true || ['CONFIRMED', 'CONSUMED'].includes(String(item?.status ?? '').toUpperCase())

// 业务包判定：上游约定 code 缺省或为 0/200 视为成功，其余已定义 code 一律按拒绝处理（对齐 magpie 的 code!==0）。
function codeArtsBizOk(json) {
  return json != null && typeof json === 'object' && !Array.isArray(json)
    && (json.code == null || ['0', '200'].includes(String(json.code)))
}

// 每日领取类活动：只认已知类型；带标题时要求含签到/每日/登录字样，避免误领同类型的活动奖励，不扩展到未知奖励类型。
const CODEARTS_DAILY_TYPES = new Set(['USER_LOGIN', 'daily_claim', 'DAILY_CLAIM'])
const CODEARTS_DAILY_TITLE = /签到|每日|登录/
const CODEARTS_INELIGIBLE_CLAIM = /需要先通过触发接口激活|未参与|未报名|无资格/

function codeArtsIsDailyReward(item) {
  if (!CODEARTS_DAILY_TYPES.has(String(item?.type ?? ''))) return false
  const title = String(item?.title ?? item?.name ?? '')
  return !title || CODEARTS_DAILY_TITLE.test(title)
}

function codeArtsDeliveryItems(delivery) {
  if (Array.isArray(delivery?.data?.items)) return delivery.data.items
  if (Array.isArray(delivery?.items)) return delivery.items
  if (Array.isArray(delivery?.data)) return delivery.data
  if (Array.isArray(delivery?.campaigns)) return delivery.campaigns
  return null
}

async function codeArtsFetchDelivery(handle, cred, ch, signal) {
  const delivery = await signedFetchJson(handle.fetch, cred, {
    url: `${SNAP_ORIGIN}/v1/ops/delivery?channel=${ch}`,
    headers: { 'Agent-Type': 'PromptCenter' },
    signal,
  })
  if (!codeArtsBizOk(delivery)) return null
  return codeArtsDeliveryItems(delivery)
}

// 收集两个通道里全部每日领取类活动（首个出现的通道保留原 channel，同 campaignId 去重）。
// 返回 { items, listed }：listed 表示成功读取到数组形态的通道数，0 表示所有通道查询均失败。
async function codeArtsDailyItems(handle, cred, signal) {
  const items = []
  const seenIds = new Set()
  let listed = 0
  for (const ch of ['DESKTOP', 'IDE']) {
    try {
      const list = await codeArtsFetchDelivery(handle, cred, ch, signal)
      if (!list) continue
      listed++
      for (const item of list) {
        if (!codeArtsIsDailyReward(item)) continue
        const key = String(item?.campaignId ?? item?.id ?? '')
        if (key && seenIds.has(key)) continue
        if (key) seenIds.add(key)
        items.push({ item, ch })
      }
    } catch {}
  }
  return { items, listed }
}

// 领取/确认结果存疑时重查同 campaignId 的活动状态，区分「已提交成功」与「确实失败」，避免重复提交领取请求。
async function codeArtsFindDailyItem(handle, cred, signal, campaignId) {
  const key = String(campaignId)
  for (const ch of ['IDE', 'DESKTOP']) {
    try {
      const items = await codeArtsFetchDelivery(handle, cred, ch, signal)
      const found = items?.find(it => String(it?.campaignId ?? it?.id ?? '') === key)
      if (found) return found
    } catch {}
  }
  return null
}

async function codeArtsPostOps(handle, cred, path, body, signal) {
  return signedFetchJson(handle.fetch, cred, {
    method: 'POST',
    url: `${SNAP_ORIGIN}${path}`,
    headers: { 'Agent-Type': 'PromptCenter' },
    body,
    signal,
  }).catch(() => null)
}

function parseRatio(value) {
  const match = typeof value === 'string' && /^(?:[x×]\s*)?(\d+(?:\.\d+)?)(?:\s*[x×])?$/i.exec(value.trim())
  const ratio = match ? Number(match[1]) : value
  return Number.isFinite(ratio) && ratio >= 0 ? Math.max(0, ratio) : null
}

function quotaNumber(value) {
  const n = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value
  return Number.isFinite(n) && n >= 0 ? n : null
}

function codeArtsModelRates(credit) {
  const items = Array.isArray(credit) ? credit : [credit]
  // 缺档时无法判断全时段倍率，尤其不能把某一档的 0 当作全时段免费。
  if (!items.length) return {}
  let min = Infinity
  let max = 0
  const before = parseRatio(items[0]?.before_display_ratio)
  let consistentBefore = before !== null
  for (const item of items) {
    const rate = parseRatio(item?.ratio_display)
    if (rate === null) return {}
    min = Math.min(min, rate)
    max = Math.max(max, rate)
    consistentBefore &&= parseRatio(item?.before_display_ratio) === before
  }
  if (min !== max) return { rateRange: [min, max] }
  return { rate: min, ...(consistentBefore ? { rateWas: before } : {}) }
}

// 合并相邻同角色消息，保留 CodeArts 请求的 user/assistant 交替约定。
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

const CODEARTS_STRENGTHS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function applyCodeArtsThinkingVariants(rows, variants) {
  const entries = new Map(Object.entries(objectOrEmpty(variants)).map(([id, value]) => [id.toLowerCase(), value]))
  return rows.map(row => {
    const variant = entries.get(row.id.toLowerCase()) ?? entries.get(row.name.toLowerCase())
    const efforts = Array.isArray(variant?.strengths) ? [...new Set(variant.strengths.filter(level => CODEARTS_STRENGTHS.has(level)))] : []
    return {
      ...row, efforts,
      defaultEffort: efforts.includes(variant?.default_strength) ? variant.default_strength : undefined,
    }
  })
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function catalogOutput(model) {
  for (const value of [model.max_tokens, model.output_context_window]) {
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
    if (Number.isSafeInteger(n) && n > 0) return n
  }
  return null
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
    const rates = codeArtsModelRates(m.credit)
    out.push({
      id,
      name: rawName,
      context: Number(m.context_window ?? m.input_context_window ?? m.input_length) || 200_000,
      output: catalogOutput(m),
      attachment: m.supports_images === true,
      efforts: [],
      free: m.is_free_benefit === true || rates.rate === 0,
      ...rates,
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
    let resolveResult
    let rejectResult
    const callbackPromise = new Promise((res, rej) => { resolveResult = res; rejectResult = rej })
    server.on('request', (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.pathname !== '/oauth/callback') { res.writeHead(404); res.end('Not found'); return }
        const oauthError = u.searchParams.get('error')
        if (oauthError) {
          const desc = u.searchParams.get('error_description') || oauthError
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body><h3>CodeArts 登录失败，可关闭此页面。</h3></body></html>')
          if (!settled) { settled = true; rejectResult(new Error(`CodeArts 授权失败：${desc}`)) }
          return
        }
        const secret = u.searchParams.get('secret')
        const redirect = u.searchParams.get('redirect')
        if (secret) {
          let safeRedirect = ''
          if (redirect) {
            try {
              const parsed = new URL(redirect)
              if (parsed.protocol === 'https:') safeRedirect = parsed.href
            } catch {}
          }
          if (safeRedirect) {
            res.writeHead(307, { Location: safeRedirect })
            res.end()
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<html><body><h3>CodeArts 登录成功，可关闭此页面。</h3></body></html>')
          }
          if (!settled) { settled = true; resolveResult({ kind: 'ticket', secret }) }
          return
        }
        const code = u.searchParams.get('code')
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body><h3>CodeArts 登录成功，可关闭此页面。</h3></body></html>')
          if (!settled) { settled = true; resolveResult({ kind: 'code', code }) }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Missing authorization code')
        }
      } catch {
        res.writeHead(500); res.end('Error')
      }
    })
    const onAbort = () => {
      if (!settled) { settled = true; rejectResult(new Error('登录已取消')) }
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
          callbackPromise,
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

async function exchangeTicket(fetchImpl, ticketId, secret, signal) {
  const url = `${SNAP_ORIGIN}/snap-manager/v1/login/ticket?ticket_id=${encodeURIComponent(ticketId)}&secret=${encodeURIComponent(secret)}`
  for (let i = 0; i < 10; i += 1) {
    signal?.throwIfAborted()
    try {
      const res = await fetchImpl(url, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'plugin-name': PLUGIN_NAME,
          'plugin-version': PLUGIN_VERSION,
          'User-Agent': CHROME_UA,
        },
        redirect: 'error',
        signal,
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const c = data?.credential
        if (c?.access && c?.secret && c?.securitytoken) {
          return sanitizeCodeArtsCredential({
            accessKey: c.access,
            secretKey: c.secret,
            securityToken: c.securitytoken,
            expiresAt: parseTimestamp(c.expires_at) ?? Date.now() + 55 * 60_000,
            clientId: CLIENT_ID,
            userId: data.user_id || '',
            userName: data.user_name || '',
          })
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, 2000)
      const onAbort = () => { clearTimeout(timer); reject(new Error('登录已取消')) }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  throw new Error('CodeArts Ticket 登录超时')
}

export const codeartsSpec = {
  id: 'codearts',
  title: 'CodeArts',
  protocol: 'openai-completions',
  baseUrl: INFER_BASE_URL,
  catalogCacheRevision: 'declared-output-v2',
  restoreLegacyCatalog: row => ({ ...row, output: null, reasoning: false, efforts: [], defaultEffort: undefined }),
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkinResetHour: 0,
  taskResetHour: 0,
  fallbackModels: CODEARTS_FALLBACK_MODELS,
  sanitizeCredential: sanitizeCodeArtsCredential,

  async importLocal({ fetch, signal }) {
    const found = await readLocalCodeArtsSession()
    if (!found) throw new Error('未检测到本机 CodeArts 登录态')
    let cred = found.credential
    let identity = null
    const expired = Number.isFinite(cred.expiresAt) && cred.expiresAt - Date.now() < 5 * 60_000
    if (!expired) {
      identity = await signedFetchJson(fetch, cred, { url: STS_CALLER_URL, signal }).catch(() => null)
    }
    if (!identity) {
      const refreshed = await refreshCodeArtsToken(fetch, cred, signal).catch(() => null)
      if (!refreshed) {
        throw new Error('本机 CodeArts 登录态已过期，请先在 CodeArts 客户端重新登录或改用浏览器登录')
      }
      cred = refreshed
      identity = await signedFetchJson(fetch, cred, { url: STS_CALLER_URL, signal }).catch(() => null)
    }
    const uid = identity?.principal_id || cred.userId || found.uid
    const name = callerUserName(identity, cred.userName || found.name)
    return {
      credential: { ...cred, ...(uid ? { userId: uid } : {}), ...(name ? { userName: name } : {}) },
      uid,
      name,
    }
  },

  async loginWithBrowser({ fetch, signal, onUrl }) {
    // 对齐官方 CodeArts 0.2.9：codeVerifier 为 128 位 hex，ticketId 为 64 位 hex。
    const codeVerifier = randomBytes(64).toString('hex')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const ticketId = randomBytes(32).toString('hex')
    const { publicJwk, privateJwk } = generateDpopKeyPair()
    const callback = await listenCallbackServer(signal)
    let timeoutHandle
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
      const authUrl = `${PORTAL_AUTHORIZE_URL}?${params}`
      onUrl?.(authUrl)
      signal?.throwIfAborted()
      openSystemBrowser(authUrl)
      const timeout = new Promise((_, rej) => {
        timeoutHandle = setTimeout(() => rej(new Error('登录超时')), 5 * 60_000)
        timeoutHandle.unref?.()
      })
      const cb = await Promise.race([callback.callbackPromise, timeout])
      let credential
      if (cb.kind === 'ticket') {
        credential = await exchangeTicket(fetch, ticketId, cb.secret, signal)
      } else {
        const dpop = createDpopJwt({ method: 'POST', url: STS_TOKEN_URL, privateJwk, publicJwk })
        const form = new URLSearchParams({
          client_id: CLIENT_ID,
          code: cb.code,
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
        credential = sanitizeCodeArtsCredential({
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
      }
      if (!credential) throw new Error('CodeArts 凭据无效')
      const identity = await signedFetchJson(fetch, credential, { url: STS_CALLER_URL, signal }).catch(() => null)
      credential.userId = identity?.principal_id || credential.userId || ''
      credential.userName = callerUserName(identity, credential.userName || '')
      return {
        credential,
        uid: credential.userId,
        name: credential.userName || 'CodeArts 账号',
      }
    } finally {
      clearTimeout(timeoutHandle)
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
        output: catalogOutput(fm),
        attachment: fm.supports_images === true,
        efforts: [],
        free: true,
        protocol: 'openai-completions',
        meta: { maasType: 'benefit' },
      })
    }
    if (!rows.length) return rows
    const variants = await signedFetchJson(handle.fetch, cred, {
      method: 'POST', url: `${SNAP_ORIGIN}/v1/model/thinking-variants`,
      headers: { 'Agent-Type': 'PromptCenter' }, signal,
      body: { model_names: rows.map(row => row.id) },
    }).catch(() => null)
    return applyCodeArtsThinkingVariants(rows, variants?.variants)
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
      const limit = quotaNumber(m.package_credit_amount)
      const remain = quotaNumber(m.package_credit_remain)
      const used = quotaNumber(m.package_credit_used)
      if (m.name === 'usageTotalPackageCredit' && remain !== null) totalRemain = remain
      if (limit > 0 && (remain !== null || used !== null)) {
        const labelMap = {
          usageTotalPackageCredit: '总积分包',
          usageBasicPackageCredit: '基础积分包',
          usageOnDemandPackageCredit: '按需积分包',
          usageBonusPackageCredit: '赠送积分包',
        }
        const consumed = used ?? Math.max(0, limit - remain)
        windows.push({
          name: labelMap[m.name] || m.name,
          balance: remain,
          limit,
          amount: consumed,
          used: Math.round((consumed / limit) * 100),
          unit: '积分',
          resetsAt: typeof stats?.end_date === 'string' ? stats.end_date : '',
        })
      }
    }
    const freeResult = freeBal?.result
    const tokenLimit = quotaNumber(freeResult?.daily_token_limit)
    const usedTokens = quotaNumber(freeResult?.daily_tokens_used)
    if (tokenLimit > 0 && usedTokens !== null) {
      windows.push({
        name: '免费日额度',
        balance: Math.max(0, tokenLimit - usedTokens),
        limit: tokenLimit,
        amount: usedTokens,
        used: Math.round((usedTokens / tokenLimit) * 100),
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
    const dayKey = createHash('sha256').update(`${day}:${cred.userId || handle.entry?.id || ''}`).digest('hex').slice(0, 24)
    // 1. 触发每日登录事件上报
    await signedFetchJson(handle.fetch, cred, {
      method: 'POST',
      url: `${SNAP_ORIGIN}/v1/ops/events/trigger`,
      headers: { 'Agent-Type': 'PromptCenter' },
      body: { triggerEvent: 'user.login', channel: 'DESKTOP', idempotentKey: `login-${dayKey}` },
      signal,
    }).catch(() => {})

    // 2. 汇总双通道全部每日领取类活动并逐个处理（旧实现只取首个同类活动，会漏领其余活动）。
    const { items: campaigns, listed } = await codeArtsDailyItems(handle, cred, signal)
    signal?.throwIfAborted()
    if (!campaigns.length) return { outcome: listed > 0 ? 'inactive' : 'failed', unsubmitted: true }

    let claimed = 0
    let creditSum = 0
    let doneCount = 0
    let pendingCount = 0
    let failedCount = 0
    let submitted = false
    for (const { item, ch } of campaigns) {
      const campaignId = item?.campaignId ?? item?.id
      if (codeArtsDailyClaimed(item)) { doneCount++; continue }
      if (String(item?.status ?? '').toUpperCase() === 'CLAIMED') {
        // 已领取待确认：不重发 claim，只尝试补发一次 confirm 推进结算。
        const existingBenefitId = item?.userBenefitId ?? item?.benefitRecordId
        if ((ch === 'IDE' && campaignId) || existingBenefitId != null) {
          const confirmRes = await codeArtsPostOps(handle, cred, '/v1/ops/confirm',
            ch === 'IDE' ? { campaignId } : { userBenefitId: existingBenefitId }, signal)
          if (codeArtsBizOk(confirmRes)) {
            claimed++
            creditSum += Number(item?.benefitAmount ?? item?.creditAmount) || 0
            continue
          }
          const seenItem = campaignId ? await codeArtsFindDailyItem(handle, cred, signal, campaignId) : null
          if (codeArtsDailyClaimed(seenItem) && String(seenItem?.status ?? '').toUpperCase() !== 'CLAIMED') {
            claimed++
            creditSum += Number(item?.benefitAmount ?? item?.creditAmount) || 0
            continue
          }
        }
        pendingCount++
        continue
      }
      if (item?.claimable !== true) continue
      if (!campaignId) { failedCount++; continue }
      submitted = true
      const claimRes = await codeArtsPostOps(handle, cred, '/v1/ops/claim',
        ch === 'IDE'
          ? { campaignId, channel: 'IDE' }
          : { campaignId, idempotentKey: `claim_${campaignId}_${dayKey}`, channel: 'DESKTOP', ...(item.benefitId ? { benefitId: item.benefitId } : {}) },
        signal)
      if (!codeArtsBizOk(claimRes)) {
        // 领取响应存疑（传输失败或业务拒绝）：先重查是否已在别处入账，绝不直接重发领取请求。
        const seenItem = await codeArtsFindDailyItem(handle, cred, signal, campaignId)
        if (codeArtsDailyClaimed(seenItem)) { doneCount++; continue }
        if (CODEARTS_INELIGIBLE_CLAIM.test(String(claimRes?.message ?? claimRes?.msg ?? ''))) continue
        pendingCount++
        continue
      }
      const benefit = claimRes?.data && typeof claimRes.data === 'object' && !Array.isArray(claimRes.data) ? claimRes.data : {}
      const userBenefitId = benefit.id ?? benefit.userBenefitId
      if (userBenefitId != null) {
        const confirmRes = await codeArtsPostOps(handle, cred, '/v1/ops/confirm',
          ch === 'IDE' ? { campaignId } : { userBenefitId }, signal)
        if (!codeArtsBizOk(confirmRes)) {
          // 领取已提交但确认失败：重查结算状态；已确认入账记已领，未确认记 pending 待下轮核实，不重复 claim。
          const seenItem = await codeArtsFindDailyItem(handle, cred, signal, campaignId)
          if (codeArtsDailyClaimed(seenItem) && String(seenItem?.status ?? '').toUpperCase() !== 'CLAIMED') {
            claimed++
            creditSum += Number(benefit.benefitAmount ?? benefit.amount ?? benefit.creditAmount ?? item.benefitAmount) || 0
          } else {
            pendingCount++
          }
          continue
        }
      }
      if (userBenefitId == null && benefit.id !== null) {
        const seenItem = await codeArtsFindDailyItem(handle, cred, signal, campaignId)
        if (codeArtsDailyClaimed(seenItem)) doneCount++
        else pendingCount++
        continue
      }
      claimed++
      creditSum += Number(benefit.benefitAmount ?? benefit.amount ?? benefit.creditAmount ?? item.benefitAmount) || 0
    }
    // 未确认优先于任何已完成项，避免把部分结算当成整批成功。
    if (pendingCount > 0) return { outcome: 'pending' }
    if (failedCount > 0) return { outcome: 'failed' }
    if (claimed > 0) return { outcome: 'claimed', credit: creditSum > 0 ? creditSum : null }
    if (doneCount > 0) return { outcome: 'already-claimed' }
    return { outcome: 'ineligible', ...(!submitted ? { unsubmitted: true } : {}) }
  },

  // 只读签到状态：不触发事件、不领取、不确认，只按活动列表的结算证据给结论。
  // 'done' 仅当上游证实已入账（claimed 标记或 CONFIRMED/CONSUMED）；CLAIMED 表示已提交未结算，记 pending。
  async checkinStatus(handle, { signal }) {
    const cred = await ensureFreshCredential(handle, signal)
    if (!cred) return { outcome: 'ineligible', unsubmitted: true }
    const { items: campaigns, listed } = await codeArtsDailyItems(handle, cred, signal)
    signal?.throwIfAborted()
    if (!campaigns.length) return { outcome: listed > 0 ? 'inactive' : 'failed', unsubmitted: true }
    let doneCount = 0
    let pendingCount = 0
    let ineligibleCount = 0
    let failedCount = 0
    let creditSum = 0
    for (const { item } of campaigns) {
      const status = String(item?.status ?? '').toUpperCase()
      if (item?.claimed === true || ['CONFIRMED', 'CONSUMED'].includes(status)) {
        doneCount++
        creditSum += Number(item?.benefitAmount) || 0
        continue
      }
      if (status === 'CLAIMED' || item?.claimable === true) {
        // CLAIMED 是「已提交、结算未确认」；claimable 是「今日可领未领」，均非已到账证据。
        if (status === 'CLAIMED' || (item?.campaignId ?? item?.id)) pendingCount++
        else failedCount++
        continue
      }
      ineligibleCount++
    }
    if (failedCount > 0) return { outcome: 'failed', unsubmitted: true }
    if (pendingCount > 0) return { outcome: 'pending', unsubmitted: true }
    if (doneCount > 0) return { outcome: 'done', credit: creditSum > 0 ? creditSum : null, unsubmitted: true }
    return { outcome: 'ineligible', unsubmitted: true }
  },

  async createTransport(handle) {
    const initialCred = await ensureFreshCredential(handle)
    if (!initialCred) throw new Error('CodeArts 凭据缺失')
    return {
      async fetch(input, init, { row, request } = {}) {
        const isReq = typeof Request !== 'undefined' && input instanceof Request
        const url = new URL(isReq ? input.url : input)
        const signal = init?.signal ?? (isReq ? input.signal : undefined)
        if (url.origin !== SNAP_ORIGIN || url.pathname !== INFER_CHAT_PATH) {
          throw new Error('CodeArts 请求地址无效')
        }
        let body = init?.body
        body ??= isReq ? await input.clone().text() : undefined
        if (typeof body === 'string') {
          try {
            const parsed = JSON.parse(body)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              // 1. 合并相邻同角色文本消息
              if (Array.isArray(parsed.messages)) parsed.messages = mergeConsecutiveTurns(parsed.messages)
              // CodeArts v2 网关 RANGE_VALIDATOR 限制输出上限为 65,536，超限夹取至协议硬上限。
              if (Number.isFinite(parsed.max_tokens) && parsed.max_tokens > OUTPUT_BUDGET_CAP) parsed.max_tokens = OUTPUT_BUDGET_CAP
              if (Number.isFinite(parsed.max_completion_tokens) && parsed.max_completion_tokens > OUTPUT_BUDGET_CAP) parsed.max_completion_tokens = OUTPUT_BUDGET_CAP
              // 3. stop 只收单字符串
              if (Array.isArray(parsed.stop)) parsed.stop = parsed.stop[0]
              // 只使用官方目录给该模型下发的强度，保留实际档位差异。
              delete parsed.enable_thinking
              if (row?.efforts?.includes(request?.reasoningEffort)) parsed.reasoning_effort = request.reasoningEffort
              else delete parsed.reasoning_effort
              // 5. 码道只对流式计费
              parsed.stream = true
              body = JSON.stringify(parsed)
            }
          } catch {}
        }
        const sessionId = codeArtsSessionId(request?.sessionId)
        const sessionHeaders = () => ({ 'x-snap-traceid': randomBytes(8).toString('hex'), 'user-session-id': sessionId })
        const sendWith = cred => {
          const extraHeaders = {
            'Content-Type': 'application/json',
            'Agent-Type': 'PromptCenter',
            'X-Language': 'zh-cn',
            ...sessionHeaders(),
            'x-ot-session-id': sessionId,
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
          return handle.fetch(url.href, { ...init, method: 'POST', headers: signedHeaders, body, signal, redirect: 'error' })
        }

        let cred = (await ensureFreshCredential(handle, signal)) || initialCred
        signal?.throwIfAborted()
        const lease = holdCodeArtsSession(handle.transportScope ?? handle, handle.entry?.id, sessionId, status =>
          signedFetchJson(handle.fetch, cred, {
            method: 'PUT', url: `${SNAP_ORIGIN}/snap-manager/v1/chat-session/heartbeat?status=${status}`,
            headers: { ...sessionHeaders(), 'Agent-Type': 'PromptCenter', 'Content-Type': 'application/json' },
            timeoutMs: 2_500,
          }))
        const normalize = resp => trackCodeArtsResponse(resp, signal, lease.release, (response, streamSignal) =>
          normalizeCodeArtsStream(response, { model: request?.model ?? row?.id, signal: streamSignal }))
        try {
          await lease.ready
          signal?.throwIfAborted()
          const response = await sendWith(cred)
          // 安全令牌过期时最多刷新一次，并沿用同一会话标识。
          if (response.status === 400 || response.status === 401) {
            const text = response.status === 401 ? '' : await response.clone().text().catch(() => '')
            if (response.status === 401 || /APIG\.0602|security token has expired/i.test(text)) {
              const refreshed = await ensureFreshCredential(handle, signal, { force: true }).catch(() => null)
              if (refreshed && refreshed.securityToken !== cred.securityToken) {
                void response.body?.cancel().catch(() => {})
                cred = refreshed
                return await normalize(await sendWith(cred))
              }
            }
          }
          return await normalize(response)
        } catch (error) {
          await lease.release()
          throw error
        }
      },
    }
  },
}
