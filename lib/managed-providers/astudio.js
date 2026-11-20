// AStudio（科大讯飞 Astron Studio）自管多账号渠道规格。
// 参考：@jianmu-plugins/opencode-astudio-auth (MIT)、dsh-astudio-connect (MIT) 与本机 AStudio 3.6.x 实测。
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'

const execFileAsync = promisify(execFile)

const GATEWAY_ORIGIN = 'https://astronstudio-api-volces-prod.xf-yun.com'
const MODELS_URL = `${GATEWAY_ORIGIN}/api/v1/model-manager/models`
const RESPONSES_BASE_URL = `${GATEWAY_ORIGIN}/model-gateway/v1`
const RESPONSES_PATH = '/model-gateway/v1/responses'
const STUDIO_ORIGIN = 'https://agent.xfyun.cn'
const SSO_ORIGIN = 'https://sso.xfyun.cn'
const STUDIO_VERSION = '3.6.0'
const CLIENT_TYPE = process.platform === 'darwin' ? '22' : '21'

// 2026-11-20 实测确认存在的模型（实时目录 6 条 + 桌面端缓存可用补位 xdeepseek-flash-in）。
export const ASTUDIO_FALLBACK_MODELS = Object.freeze([
  { id: 'astronclaw-auto', name: 'Auto', context: 262_144, output: 100_000, efforts: ['off', 'high'], defaultEffort: 'high', protocol: 'openai-responses' },
  { id: 'spark-x2.6', name: 'Spark-X2.6', context: 1_048_576, output: 100_000, efforts: ['off', 'high'], defaultEffort: 'high', protocol: 'openai-responses' },
  { id: 'spark-x2.6-4b', name: 'Spark-X2.6-Lite', context: 1_048_576, output: 110_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', free: true, protocol: 'openai-responses' },
  { id: 'xopglm52', name: 'GLM-5.2', context: 1_048_576, output: 100_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', protocol: 'openai-responses' },
  { id: 'xopdeepseekv4pro0813', name: 'DeepSeek-V4-Pro', context: 1_048_576, output: 100_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', protocol: 'openai-responses' },
  { id: 'xopdsv4flash0731in', name: 'DeepSeek-V4-Flash', context: 1_048_576, output: 100_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', protocol: 'openai-responses' },
  { id: 'xdeepseek-flash-in', name: 'DeepSeek-V4.1-Flash', context: 1_048_576, output: 100_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', protocol: 'openai-responses' },
])

// 目录滞后补位：仅在实时目录未返回同名 slug（含 hidden）时补入。
const EXTRA_CATALOG_SLUGS = Object.freeze([
  { id: 'xdeepseek-flash-in', name: 'DeepSeek-V4.1-Flash', context: 1_048_576, output: 100_000, efforts: ['off', 'high', 'max'], defaultEffort: 'high', protocol: 'openai-responses' },
])

function isValidJwt(token) {
  if (typeof token !== 'string' || !token || token.length > 4096) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return header?.alg === 'HS256' && Boolean(payload?.uid)
  } catch { return false }
}

function jwtUid(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
    return typeof payload?.uid === 'string' || typeof payload?.uid === 'number' ? String(payload.uid) : ''
  } catch { return '' }
}

function cookieHeader(cred) {
  const sso = cred.ssoSessionId || cred.sessionToken || ''
  const token = cred.sessionToken || cred.ssoSessionId || ''
  const parts = []
  if (sso) {
    parts.push(`ssoSessionId=${sso}`)
    parts.push(`sso_sessionid=${sso}`)
  }
  if (cred.accountId) parts.push(`account_id=${cred.accountId}`)
  if (token) parts.push(`token=${token}`)
  return parts.join('; ')
}

function studioHeaders(cred) {
  return {
    accept: 'application/json',
    clientType: CLIENT_TYPE,
    studioVersion: STUDIO_VERSION,
    clientVersion: STUDIO_VERSION,
    ...(cookieHeader(cred) ? { cookie: cookieHeader(cred) } : {}),
  }
}

function beijingDateRange(now = Date.now()) {
  const bj = new Date(now + 8 * 3_600_000)
  const day = bj.toISOString().slice(0, 10)
  return {
    day,
    startTime: `${day} 00:00:00`,
    endTime: `${day} 23:59:59`,
  }
}

function parseBeijingIso(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const trimmed = value.trim()
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed
  return trimmed.includes('T') ? `${trimmed}+08:00` : `${trimmed.replace(' ', 'T')}+08:00`
}

async function discoverAStudioDataRoots() {
  const roots = []
  const push = dir => { if (typeof dir === 'string' && dir.trim() && !roots.includes(dir.trim())) roots.push(dir.trim()) }
  if (process.env.ASTUDIO_HOME) push(process.env.ASTUDIO_HOME)
  if (process.env.SYNARA_HOME) push(process.env.SYNARA_HOME)
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\AStudioStorage'], { timeout: 3000 })
      for (const key of ['ProductionDataRoot', 'CanaryDataRoot', 'DevelopmentDataRoot']) {
        const match = new RegExp(`${key}\\s+REG_\\w+\\s+(.+)`).exec(stdout)
        if (match?.[1]) push(match[1].trim())
      }
    } catch {}
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    push(join(localAppData, 'Programs', 'AStudio Data'))
  }
  push(join(homedir(), '.acode', 'acode'))
  return roots
}

function readTomlBearer(tomlPath) {
  try {
    const raw = readFileSync(tomlPath, 'utf8')
    const tokenMatch = /experimental_bearer_token\s*=\s*"([^"]+)"/.exec(raw)
    const uidMatch = /\buid\s*=\s*"([^"]+)"/.exec(raw)
    return {
      modelBearerToken: tokenMatch?.[1] || '',
      uid: uidMatch?.[1] || '',
    }
  } catch { return { modelBearerToken: '', uid: '' } }
}

export function sanitizeAStudioCredential(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const modelBearerToken = typeof raw.modelBearerToken === 'string' ? raw.modelBearerToken.trim() : ''
  if (!modelBearerToken || modelBearerToken.length > 4096) return null
  const ssoSessionId = typeof raw.ssoSessionId === 'string' ? raw.ssoSessionId.trim().slice(0, 512) : ''
  const sessionToken = typeof raw.sessionToken === 'string' ? raw.sessionToken.trim().slice(0, 512)
    : typeof raw.token === 'string' ? raw.token.trim().slice(0, 512) : ''
  const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim().slice(0, 120) : ''
  const uid = typeof raw.uid === 'string' ? raw.uid.trim().slice(0, 120) : (accountId || jwtUid(modelBearerToken))
  return {
    modelBearerToken,
    ...(ssoSessionId ? { ssoSessionId } : {}),
    ...(sessionToken ? { sessionToken } : {}),
    ...(accountId ? { accountId } : {}),
    ...(uid ? { uid } : {}),
  }
}

export function parseAStudioCatalog(json) {
  const list = Array.isArray(json?.data?.models) ? json.data.models : []
  const seenAll = new Set()
  const out = []
  for (const item of list) {
    const id = typeof item?.slug === 'string' ? item.slug.trim() : ''
    if (!id || id.startsWith('builtin/')) continue
    seenAll.add(id)
    if (item.visibility !== 'list' || item.supported_in_api === false) continue
    const rawEfforts = Array.isArray(item.supported_reasoning_levels)
      ? item.supported_reasoning_levels.map(x => x?.effort).filter(Boolean)
      : []
    const efforts = rawEfforts.map(e => e === 'none' ? 'off' : e)
    const badgeEn = item.badge?.text?.en
    const free = typeof badgeEn === 'string' && badgeEn.toLowerCase() === 'free'
    const modalities = Array.isArray(item.input_modalities) ? item.input_modalities : []
    out.push({
      id,
      name: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : id,
      context: Number.isFinite(item.context_window) ? item.context_window : Number.isFinite(item.max_context_window) ? item.max_context_window : 262_144,
      output: Number.isFinite(item.max_output_tokens) ? item.max_output_tokens : 100_000,
      attachment: modalities.includes('image'),
      efforts,
      defaultEffort: item.default_reasoning_level === 'none' ? 'off' : (typeof item.default_reasoning_level === 'string' ? item.default_reasoning_level : ''),
      free,
      protocol: 'openai-responses',
    })
  }
  for (const extra of EXTRA_CATALOG_SLUGS) {
    if (!seenAll.has(extra.id)) out.push({ ...extra })
  }
  return out
}

async function fetchJsonSafe(fetchImpl, url, init, timeoutMs = 10_000) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  const res = await fetchImpl(url, { ...init, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function exchangeBearerToken(fetchImpl, cred, signal) {
  const res = await fetchImpl(`${STUDIO_ORIGIN}/xingchen-studio/auth/bearer-token`, {
    method: 'POST',
    headers: { ...studioHeaders(cred), 'content-type': 'application/json' },
    body: '{}',
    signal,
  })
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  const token = json?.data?.modelBearerToken || json?.data?.token || json?.modelBearerToken
  return typeof token === 'string' && token.length > 20 ? token : null
}

async function readLocalAStudio() {
  const roots = await discoverAStudioDataRoots()
  for (const root of roots) {
    const sessionPath = join(root, 'userdata', 'astron-session.json')
    if (existsSync(sessionPath)) {
      try {
        const data = JSON.parse(readFileSync(sessionPath, 'utf8'))
        if (data?.banned === true) throw new Error('本机 AStudio 账号处于受限状态')
        const cred = sanitizeAStudioCredential({
          modelBearerToken: data.modelBearerToken,
          ssoSessionId: data.ssoSessionId,
          sessionToken: data.token,
          accountId: data.accountId || data.uid,
          uid: data.uid || data.accountId,
        })
        if (cred) {
          return {
            credential: cred,
            uid: cred.uid || cred.accountId || '',
            name: cred.uid ? `AStudio (${cred.uid.slice(-4)})` : 'AStudio 本机账号',
          }
        }
      } catch (err) {
        if (err?.message?.includes('受限')) throw err
      }
    }
    const tomlPath = join(root, 'runtime', 'acode-home', 'config.toml')
    if (existsSync(tomlPath)) {
      const parsed = readTomlBearer(tomlPath)
      const cred = sanitizeAStudioCredential(parsed)
      if (cred) {
        return {
          credential: cred,
          uid: cred.uid || '',
          name: cred.uid ? `AStudio (${cred.uid.slice(-4)})` : 'AStudio 本机账号',
        }
      }
    }
  }
  return null
}

export const astudioSpec = {
  id: 'astudio',
  title: 'AStudio',
  protocol: 'openai-responses',
  baseUrl: RESPONSES_BASE_URL,
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴 modelBearerToken（JWT）或 astron-session.json 内容',
  checkinResetHour: 0,
  taskResetHour: 0,
  fallbackModels: ASTUDIO_FALLBACK_MODELS,
  sanitizeCredential: sanitizeAStudioCredential,

  async importLocal({ fetch, signal }) {
    const found = await readLocalAStudio()
    if (!found) throw new Error('未检测到本机 AStudio 登录态')
    // 校验 bearer 可用
    await fetchJsonSafe(fetch, MODELS_URL, {
      headers: { authorization: `Bearer ${found.credential.modelBearerToken}`, accept: 'application/json' },
      signal,
    })
    return found
  },

  async loginWithBrowser({ fetch, signal, onUrl }) {
    // 微信扫码 SSO 票据流（无需外部浏览器控制，用户打开二维码页扫码即可）
    const ticket = randomBytes(4).toString('hex')
    const qrUrl = `${SSO_ORIGIN}/SSOService/wx/scanlogin/qrcode?fd=${ticket}`
    onUrl?.(qrUrl)
    const deadline = Date.now() + 3 * 60_000
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      await new Promise(resolve => setTimeout(resolve, 2000))
      signal?.throwIfAborted()
      try {
        const poll = await fetchJsonSafe(fetch, `${SSO_ORIGIN}/SSOService/wx/scanlogin/uids?fd=${ticket}`, { signal }, 6000)
        const info = Array.isArray(poll?.data?.infoList) ? poll.data.infoList[0]
          : Array.isArray(poll?.infoList) ? poll.infoList[0] : null
        if (info?.ssoSessionId) {
          const baseCred = {
            ssoSessionId: String(info.ssoSessionId),
            sessionToken: String(info.ssoSessionId),
            accountId: String(info.uid ?? ''),
            uid: String(info.uid ?? ''),
          }
          const bearer = await exchangeBearerToken(fetch, baseCred, signal)
          if (!bearer) throw new Error('未能换取 AStudio 推理凭据')
          const credential = sanitizeAStudioCredential({ ...baseCred, modelBearerToken: bearer })
          return {
            credential,
            uid: credential.uid,
            name: credential.uid ? `AStudio (${credential.uid.slice(-4)})` : 'AStudio 账号',
          }
        }
      } catch (err) {
        if (signal?.aborted) throw err
      }
    }
    return { signedIn: false }
  },

  async parseCredential(raw, { fetch, signal }) {
    let parsed
    if (raw.startsWith('{')) {
      try { parsed = JSON.parse(raw) } catch { throw new Error('JSON 凭据格式无效') }
    } else {
      parsed = { modelBearerToken: raw }
    }
    const credential = sanitizeAStudioCredential(parsed)
    if (!credential || (!isValidJwt(credential.modelBearerToken) && credential.modelBearerToken.length < 20)) {
      throw new Error('需要有效的 AStudio modelBearerToken')
    }
    await fetchJsonSafe(fetch, MODELS_URL, {
      headers: { authorization: `Bearer ${credential.modelBearerToken}`, accept: 'application/json' },
      signal,
    })
    return {
      credential,
      uid: credential.uid || '',
      name: credential.uid ? `AStudio (${credential.uid.slice(-4)})` : 'AStudio 账号',
    }
  },

  async fetchModels(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred?.modelBearerToken) return []
    const json = await fetchJsonSafe(handle.fetch, MODELS_URL, {
      headers: { authorization: `Bearer ${cred.modelBearerToken}`, accept: 'application/json' },
      signal,
    })
    const rows = parseAStudioCatalog(json)
    // 如果有网页会话 Cookie，顺带拉 bot/models/configs 补齐倍率展示
    if (cookieHeader(cred)) {
      try {
        const cfg = await fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/bot/models/configs`, {
          headers: studioHeaders(cred),
          signal,
        }, 6000)
        const rateMap = new Map()
        for (const item of Array.isArray(cfg?.data) ? cfg.data : []) {
          if (typeof item?.model === 'string' && Number.isFinite(Number(item.point_multiplier))) {
            rateMap.set(item.model, Number(item.point_multiplier))
          }
        }
        for (const row of rows) {
          if (!row.free && rateMap.has(row.id)) row.rate = rateMap.get(row.id)
        }
      } catch {}
    }
    return rows
  },

  async fetchUsage(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred?.modelBearerToken) return { signedIn: false, error: 'credential_error' }
    if (!cookieHeader(cred)) {
      // 仅配置了 modelBearerToken 时，用目录接口核验登录有效
      try {
        await fetchJsonSafe(handle.fetch, MODELS_URL, {
          headers: { authorization: `Bearer ${cred.modelBearerToken}`, accept: 'application/json' },
          signal,
        }, 8000)
        return { signedIn: true, plan: 'Token 模式', balance: null, windows: [], updatedAt: Date.now() }
      } catch {
        return { signedIn: false, error: 'auth_expired' }
      }
    }
    const headers = studioHeaders(cred)
    const [balJson, meJson] = await Promise.all([
      fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/points/balance`, { headers, signal }, 8000),
      fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/membership/me`, { headers, signal }, 8000).catch(() => null),
    ])
    if ([1002, 1005, 80000].includes(balJson?.code)) {
      return { signedIn: false, error: 'auth_expired' }
    }
    const d = balJson?.data ?? {}
    const totalBalance = Number.isFinite(d.totalBalance) ? d.totalBalance : null
    const windows = []
    if (Number.isFinite(d.activityBalance) && (d.activityTotal > 0 || d.activityBalance > 0)) {
      windows.push({
        name: '活动赠送积分',
        balance: d.activityBalance,
        limit: Number.isFinite(d.activityTotal) ? d.activityTotal : null,
        used: d.activityTotal > 0 ? Math.round((1 - d.activityBalance / d.activityTotal) * 100) : null,
        unit: '积分',
        resetsAt: parseBeijingIso(d.activityNextExpireTime),
      })
    }
    if (Number.isFinite(d.memberBalance) && (d.memberTotal > 0 || d.memberBalance > 0)) {
      windows.push({
        name: '会员积分',
        balance: d.memberBalance,
        limit: Number.isFinite(d.memberTotal) ? d.memberTotal : null,
        used: d.memberTotal > 0 ? Math.round((1 - d.memberBalance / d.memberTotal) * 100) : null,
        unit: '积分',
        resetsAt: parseBeijingIso(d.memberNextExpireTime),
      })
    }
    if (Number.isFinite(d.buyBalance) && (d.buyTotal > 0 || d.buyBalance > 0)) {
      windows.push({
        name: '购买积分',
        balance: d.buyBalance,
        limit: Number.isFinite(d.buyTotal) ? d.buyTotal : null,
        unit: '积分',
        resetsAt: parseBeijingIso(d.buyNextExpireTime),
      })
    }
    if (Number.isFinite(d.sparkTotalBalance) && d.sparkTotalBalance > 0) {
      windows.push({ name: '星火积分', balance: d.sparkTotalBalance, unit: '积分' })
    }
    const planName = typeof meJson?.data?.planName === 'string' ? meJson.data.planName : ''
    return {
      signedIn: true,
      uid: cred.uid || String(meJson?.data?.uid ?? ''),
      plan: planName,
      balance: totalBalance,
      unit: '积分',
      windows,
      updatedAt: Date.now(),
    }
  },

  async checkin(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred || !cookieHeader(cred)) return { outcome: 'ineligible', unsubmitted: true }
    const headers = studioHeaders(cred)
    const { startTime, endTime } = beijingDateRange()
    const queryTodayGrant = async () => {
      const qs = new URLSearchParams({ pageNum: '1', pageSize: '20', direction: 'CREDIT', startTime, endTime })
      const details = await fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/points/details?${qs}`, { headers, signal }, 8000)
      if ([1002, 1005, 80000].includes(details?.code)) return { dead: true }
      const rows = Array.isArray(details?.data?.records) ? details.data.records
        : Array.isArray(details?.data?.list) ? details.data.list
          : Array.isArray(details?.data) ? details.data : []
      const grant = rows.find(row => row?.operation === 'GRANT' && /每日|登录/.test(String(row?.reason ?? '')))
      return { grant }
    }
    // 1. 先查今日流水，已入账则零写返回
    const before = await queryTodayGrant()
    if (before.dead) return { outcome: 'ineligible', unsubmitted: true }
    if (before.grant) return { outcome: 'already-claimed', credit: Number(before.grant.amount) || null }

    // 2. 触发 init-app 结算今日登录积分
    await handle.fetch(`${STUDIO_ORIGIN}/xingchen-studio/tenant-app/v2/init-app`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
      signal,
    }).catch(() => {})

    // 3. 查询待处理弹窗并关闭每日奖励弹窗（popupId 必须为正整数）
    try {
      const pending = await fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/client-popups/pending`, { headers, signal }, 8000)
      const list = Array.isArray(pending?.data) ? pending.data : []
      for (const popup of list) {
        if (popup?.componentType === 'DAILY_REWARD_DIALOG' && Number.isSafeInteger(popup.popupId) && popup.popupId > 0 && typeof popup.instanceKey === 'string' && popup.instanceKey) {
          await handle.fetch(`${STUDIO_ORIGIN}/xingchen-studio/client-popups/complete`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ popupId: popup.popupId, instanceKey: popup.instanceKey }),
            signal,
          }).catch(() => {})
        }
      }
    } catch {}

    // 4. 以流水再次认定结果
    const after = await queryTodayGrant()
    if (after.grant) return { outcome: 'claimed', credit: Number(after.grant.amount) || null }
    return { outcome: 'done' }
  },

  async claimRewards(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred || !cookieHeader(cred)) return { kind: 'empty', retryable: false }
    const headers = studioHeaders(cred)
    const pending = await fetchJsonSafe(handle.fetch, `${STUDIO_ORIGIN}/xingchen-studio/client-popups/pending`, { headers, signal }, 8000)
    if ([1002, 1005, 80000].includes(pending?.code)) return { kind: 'failed', retryable: true }
    const list = Array.isArray(pending?.data) ? pending.data : []
    const claimableTypes = new Set(['NEW_USER_DIALOG', 'NEW_USER_DIALOG_V2', 'DAILY_REWARD_DIALOG'])
    let claimed = 0
    for (const popup of list) {
      if (!claimableTypes.has(popup?.componentType)) continue
      if (!Number.isSafeInteger(popup.popupId) || popup.popupId <= 0 || typeof popup.instanceKey !== 'string' || !popup.instanceKey) continue
      const res = await handle.fetch(`${STUDIO_ORIGIN}/xingchen-studio/client-popups/complete`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ popupId: popup.popupId, instanceKey: popup.instanceKey }),
        signal,
      })
      if (res.ok) claimed += 1
    }
    return claimed > 0 ? { kind: 'claimed', claimed } : { kind: 'done', claimed: 0 }
  },

  async createTransport(handle) {
    const cred = await handle.getCredential()
    if (!cred?.modelBearerToken) throw new Error('AStudio 凭据缺失')
    return {
      async fetch(input, init, { request } = {}) {
        const isReq = typeof Request !== 'undefined' && input instanceof Request
        const url = new URL(isReq ? input.url : input)
        if (url.origin !== GATEWAY_ORIGIN || url.pathname !== RESPONSES_PATH) {
          throw new Error('AStudio 请求地址无效')
        }
        const headers = new Headers(init?.headers ?? (isReq ? input.headers : undefined))
        headers.set('authorization', `Bearer ${cred.modelBearerToken}`)
        headers.set('content-type', 'application/json')
        let body = init?.body
        body ??= isReq ? await input.clone().text() : undefined
        if (typeof body === 'string') {
          try {
            const parsed = JSON.parse(body)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              parsed.store = false
              // 实测关闭思考必须发 effort: "none"（"off" 会仍产出 reasoning）
              const eff = request?.reasoningEffort
              if (eff === 'off' || eff === 'none') {
                parsed.reasoning = { ...(parsed.reasoning ?? {}), effort: 'none' }
              } else if (typeof eff === 'string' && eff) {
                parsed.reasoning = { ...(parsed.reasoning ?? {}), effort: eff }
              }
              body = JSON.stringify(parsed)
            }
          } catch {}
        }
        return handle.fetch(url.href, { ...init, method: init?.method || 'POST', headers, body })
      },
    }
  },
}
