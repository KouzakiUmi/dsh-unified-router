// All console requests use separate credentials and fixed vendor origins.
import { APIKEY_CONSOLES, apiQuotaAmount as amount, apiQuotaClampedAmount as clampedAmount, apiQuotaGift as giftOf, apiQuotaWindow as windowOf, projectApiKeyRateLimit } from './apikey-quota-projection.js'
const agnesConsole = 'https://platform-backend.agnes-ai.cn/api'
const unisoundConsole = 'https://maas.unisound.com/manager'
const UNISOUND_WINDOW5H_BY_PLAN = Object.freeze({
  'U-FREE': 500,
  'U-STANDARD': 2000,
  'U-PLUS': 12000,
})

function unisoundResetInMs(data, weekly) {
  const prefix = weekly ? 'weeklyResetIn' : 'window5hResetIn'
  const major = data?.[prefix + (weekly ? 'Days' : 'Hours')]
  const minor = data?.[prefix + (weekly ? 'Hours' : 'Minutes')]
  const unit = weekly ? 3600000 : 60000
  if (data?.[prefix + (weekly ? 'LessThanOneHour' : 'LessThanOneMinute')] === true) return unit
  const valid = (value, max) => Number.isInteger(value) && value >= 0 && value <= max
  if (major == null && minor == null || major != null && !valid(major, weekly ? 7 : 5) || minor != null && !valid(minor, weekly ? 23 : 59)) return null
  const count = (major ?? 0) * (weekly ? 24 : 60) + (minor ?? 0)
  return count <= (weekly ? 168 : 300) ? Math.max(count, 1) * unit : null
}

// consoleSession：宿主凭据服务里存的控制台会话（设置页「浏览器登录」收割或粘贴），
// 优先于环境变量；两者都没有才报 needs-console。会话原文不进任何返回值。
export async function readApiKeyQuota(provider, fetchJson, signal, env = process.env, consoleSession = null) {
  if (!Object.hasOwn(APIKEY_CONSOLES, provider)) return null
  const agnes = provider === 'agnes'
  const session = (typeof consoleSession === 'string' && consoleSession.trim()
    ? consoleSession
    : (agnes ? env.UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN : env.UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE))?.trim()
  if (!session) return { status: 'needs-console' }
  const headers = agnes ? { authorization: `Bearer ${session.replace(/^Bearer\s+/i, '')}`, 'x-user-language': 'zh-CN' } : { cookie: session }
  // 控制台前端对写请求带 X-XSRF-TOKEN（取自 XSRF-TOKEN Cookie）；只读 GET 也照带，
  // 与浏览器行为一致，避免网关对缺失该头的会话请求另眼相待。
  if (!agnes) {
    const xsrf = session.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1]
    if (xsrf) headers['x-xsrf-token'] = decodeURIComponent(xsrf)
  }
  const paths = agnes ? ['/user/agentplan/credits', '/cn/user/subscription', '/user/balance'] : ['/u-plan/subscription/current']
  const settled = await Promise.allSettled(paths.map(path => fetchJson({ url: (agnes ? agnesConsole : unisoundConsole) + path, headers }, signal)))
  signal?.throwIfAborted()
  const data = settled.map(item => item.status === 'fulfilled' && String(agnes ? item.value?.code : item.value?.errorCode ?? item.value?.code) === (agnes ? '200' : '0')
    ? (agnes ? item.value.data : item.value.result) : null)
  const [credits, legacy, cash] = data
  const weeklyLimit = agnes ? null : amount(credits?.weeklyPointsTotal)
  const weeklyRemain = agnes ? null : clampedAmount(credits?.weeklyPointsRemain)
  const raw5hLimit = agnes ? null : amount(credits?.window5hLimit)
  const raw5hRemain = agnes ? null : clampedAmount(credits?.window5hRemain)
  const plan5hLimit = !agnes
    ? (UNISOUND_WINDOW5H_BY_PLAN[String(credits?.planCode ?? '').trim().toUpperCase()]
      ?? (weeklyLimit !== null && weeklyLimit > 0 ? Math.round(weeklyLimit / 5) : null))
    : null
  const window5hLimit = raw5hLimit ?? plan5hLimit
  const window5hRemain = raw5hRemain ?? (raw5hLimit === null ? plan5hLimit : null)
  const windows = (agnes ? [
    windowOf('monthly-credits', null, credits?.plan_quota_credits, credits?.plan_balance_credits),
    windowOf('window-credits', credits?.window_used_credits, credits?.window_limit_credits),
    windowOf('pack-credits', null, null, credits?.pack_balance_credits),
    windowOf('window-requests', legacy?.usage?.text_generation?.windowed?.used, legacy?.usage?.text_generation?.windowed?.limit),
    windowOf('weekly-requests', legacy?.usage?.text_generation?.weekly?.used, legacy?.usage?.text_generation?.weekly?.limit),
  ] : [
    windowOf('window-points', null, window5hLimit, window5hRemain, unisoundResetInMs(credits, false)),
    windowOf('weekly-points', credits?.weeklyPointsUsed, weeklyLimit, weeklyRemain, unisoundResetInMs(credits, true)),
  ]).filter(Boolean)
  const gifts = !agnes && Array.isArray(credits?.giftQuotas)
    ? credits.giftQuotas.map(item => giftOf(item?.modelId, item?.usedAmount, item?.totalAmount, item?.remainAmount, item?.unit ?? item?.displayUnit)).filter(Boolean)
    : []
  const minor = /^cny$/i.test(cash?.currency ?? '') ? amount(cash.available_total_minor ?? cash.total_minor) : null
  if (windows.length || gifts.length || minor !== null) {
    return { status: 'ready', windows, ...(gifts.length ? { gifts } : {}), balance: minor === null ? null : minor / 100, updatedAt: Date.now() }
  }
  if (settled.some(item => item.status === 'rejected' && [401, 403].includes(item.reason?.status)
    || item.status === 'fulfilled' && (/^(401|403|521|1000103)$/.test(String(item.value?.code ?? item.value?.errorCode))
      || (!agnes && /未登录|session.{0,5}超时/i.test(item.value?.errorMsg ?? ''))))) return { status: 'expired' }
  return { status: settled.some(item => item.status === 'fulfilled') ? 'unavailable' : 'error' }
}

// Inspect small JSON envelopes without consuming the caller's response or touching SSE.
async function peekApiKeyError(response) {
  if (!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body || response.bodyUsed) return null
  const reader = response.clone().body.getReader()
  const decoder = new TextDecoder()
  let timer, size = 0, text = ''
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 300) })
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), timeout])
      if (!part) return null
      if (part.done) return JSON.parse(text + decoder.decode())
      size += part.value.byteLength
      if (size > 16_384) return null
      text += decoder.decode(part.value, { stream: true })
    }
  } catch { return null } finally { clearTimeout(timer); void reader.cancel().catch(() => {}) }
}

export async function detectApiKeyRateLimit(provider, response, now = Date.now()) {
  if (!response?.headers || (response.status !== 429 && !(provider === 'unisound' && response.ok))) return null
  const body = await peekApiKeyError(response)
  const code = String(body?.base_resp?.status_code ?? body?.error?.code ?? body?.error?.type ?? '')
  if (['100104', '220107', '220108', '220109', 'insufficient_quota', 'insufficient_balance', 'billing_hard_limit_reached'].includes(code)
    || body?.error?.type === 'insufficient_quota') return null
  const reason = provider === 'unisound' && code === '100501' ? 'rpm' : provider === 'unisound' && code === '100502' ? 'tpm' : 'unknown'
  if (reason === 'unknown' && response.status !== 429) return null
  const header = response.headers.get('retry-after')?.trim()
  const delay = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000
    : header && /^[A-Z]{3},/i.test(header) ? Date.parse(header) - now : NaN
  const estimated = !Number.isFinite(delay)
  return projectApiKeyRateLimit({ until: now + (estimated ? 60_000 : Math.max(0, Math.ceil(delay))), reason, estimated })
}
