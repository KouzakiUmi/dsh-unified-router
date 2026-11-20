// All console requests use separate credentials and fixed vendor origins.
import { APIKEY_CONSOLES, apiQuotaAmount as amount, apiQuotaWindow as windowOf, projectApiKeyRateLimit } from './apikey-quota-projection.js'
const agnesConsole = 'https://platform-backend.agnes-ai.cn/api'
const unisoundConsole = 'https://maas.unisound.com/manager'

export async function readApiKeyQuota(provider, fetchJson, signal, env = process.env) {
  if (!Object.hasOwn(APIKEY_CONSOLES, provider)) return null
  const agnes = provider === 'agnes'
  const session = (agnes ? env.UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN : env.UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE)?.trim()
  if (!session) return { status: 'needs-console' }
  const headers = agnes ? { authorization: `Bearer ${session.replace(/^Bearer\s+/i, '')}`, 'x-user-language': 'zh-CN' } : { cookie: session }
  const paths = agnes ? ['/user/agentplan/credits', '/cn/user/subscription', '/user/balance'] : ['/u-plan/subscription/current']
  const settled = await Promise.allSettled(paths.map(path => fetchJson({ url: (agnes ? agnesConsole : unisoundConsole) + path, headers }, signal)))
  signal?.throwIfAborted()
  const data = settled.map(item => item.status === 'fulfilled' && String(agnes ? item.value?.code : item.value?.errorCode ?? item.value?.code) === (agnes ? '200' : '0')
    ? (agnes ? item.value.data : item.value.result) : null)
  const [credits, legacy, cash] = data
  const windows = (agnes ? [
    windowOf('monthly-credits', null, credits?.plan_quota_credits, credits?.plan_balance_credits),
    windowOf('window-credits', credits?.window_used_credits, credits?.window_limit_credits),
    windowOf('pack-credits', null, null, credits?.pack_balance_credits),
    windowOf('window-requests', legacy?.usage?.text_generation?.windowed?.used, legacy?.usage?.text_generation?.windowed?.limit),
    windowOf('weekly-requests', legacy?.usage?.text_generation?.weekly?.used, legacy?.usage?.text_generation?.weekly?.limit),
  ] : [
    windowOf('window-points', null, credits?.window5hLimit, credits?.window5hRemain),
    windowOf('weekly-points', credits?.weeklyPointsUsed, credits?.weeklyPointsTotal, credits?.weeklyPointsRemain),
  ]).filter(Boolean)
  const minor = /^cny$/i.test(cash?.currency ?? '') ? amount(cash.available_total_minor ?? cash.total_minor) : null
  if (windows.length || minor !== null) return { status: 'ready', windows, balance: minor === null ? null : minor / 100, updatedAt: Date.now() }
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
