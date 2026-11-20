export const APIKEY_CONSOLES = Object.freeze({
  agnes: 'https://platform.agnes-ai.cn/subscribe/subscription',
  unisound: 'https://maas.unisound.com/admin/subscript',
})

export const apiQuotaAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export function apiQuotaWindow(id, used, limit, remaining) {
  used = apiQuotaAmount(used); limit = apiQuotaAmount(limit); remaining = apiQuotaAmount(remaining)
  if (remaining === null && used !== null && limit !== null) remaining = Math.max(0, limit - used)
  return used === null && remaining === null ? null : { id, used, limit, remaining }
}

export function projectApiKeyQuota(value) {
  if (!value || typeof value !== 'object') return null
  if (['needs-console', 'unavailable', 'expired', 'error'].includes(value.status)) return { status: value.status }
  if (value.status !== 'ready') return null
  const windows = (Array.isArray(value.windows) ? value.windows : []).slice(0, 8)
    .filter(row => ['weekly-points', 'window-points', 'monthly-credits', 'window-credits', 'pack-credits', 'weekly-requests', 'window-requests'].includes(row?.id))
    .map(row => apiQuotaWindow(row.id, row.used, row.limit, row.remaining)).filter(Boolean)
  return { status: 'ready', windows, balance: apiQuotaAmount(value.balance), updatedAt: apiQuotaAmount(value.updatedAt) }
}

export function projectApiKeyRateLimit(value) {
  if (!Number.isSafeInteger(value?.until) || value.until <= 0) return null
  return { until: value.until, reason: ['rpm', 'tpm'].includes(value.reason) ? value.reason : 'unknown', estimated: value.estimated === true }
}
