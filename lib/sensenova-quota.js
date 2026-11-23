import { m as parsePools } from '../vendor/sensenova-token-plan/llm-models.js'

export const SENSENOVA_CONSOLE_REF = 'UNIFIED_ROUTER_SENSENOVA_CONSOLE_TOKEN'
const CONSOLE_ORIGIN = 'https://platform.sensenova.cn'
const POOL_USAGE_URL = `${CONSOLE_ORIGIN}/lite/console/v1/tokenplan/pool-usage`
const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const amount = value => Number.isFinite(value) && value >= 0 ? value : null
const epoch = value => Number.isSafeInteger(value) && value > 0 && value <= 253402300799 ? value : null

function projectWindow(row) {
  const limit = amount(row?.limit)
  const used = amount(row?.used)
  const remaining = amount(row?.remaining) ?? (limit !== null && used !== null ? Math.max(0, limit - used) : null)
  return remaining === null ? null : { limit, remaining, resetAt: epoch(row?.resetAt) }
}

export function projectSenseNovaQuota(value) {
  if (['needs-console', 'expired', 'error'].includes(value?.status)) return { status: value.status }
  if (value?.status !== 'ready' || !Array.isArray(value.pools)) return null
  return {
    status: 'ready', plan: text(value.plan), updatedAt: amount(value.updatedAt),
    pools: value.pools.slice(0, 32).filter(row => row && typeof row === 'object').map(row => ({
      name: text(row.name), poolType: text(row.poolType, 32),
      modelIds: Array.isArray(row.modelIds) ? row.modelIds.slice(0, 512).map(id => text(id, 256)).filter(Boolean) : [],
      window5h: projectWindow(row.window5h), window7d: projectWindow(row.window7d),
      grantBalance: amount(row.grantBalance), nearestGrantExpiry: epoch(row.nearestGrantExpiry),
      nearestGrantExpiringBalance: amount(row.nearestGrantExpiringBalance),
    })),
  }
}

export async function readSenseNovaQuota(credentials, fetchImpl = globalThis.fetch, signal) {
  try {
    const resolved = await credentials?.resolve?.(SENSENOVA_CONSOLE_REF)
    const token = typeof resolved?.value === 'string' ? resolved.value.trim().replace(/^Bearer\s+/i, '') : ''
    if (!token) return { status: 'needs-console' }
    const deadline = AbortSignal.timeout(8000)
    const response = await fetchImpl(POOL_USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', referer: `${CONSOLE_ORIGIN}/console` },
      redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return { status: [401, 403].includes(response.status) ? 'expired' : 'error' }
    }
    // The existing vendor parser handles decimal strings and epoch seconds.
    const body = await response.json()
    const payload = Array.isArray(body?.data?.pools) ? body.data : body
    if (!Array.isArray(payload?.pools)) return { status: 'error' }
    const { plan, pools } = parsePools({ ...payload, pools: payload.pools.slice(0, 32) })
    return projectSenseNovaQuota({ status: 'ready', plan: plan.name, pools, updatedAt: Date.now() })
  } catch { return { status: 'error' } }
}
