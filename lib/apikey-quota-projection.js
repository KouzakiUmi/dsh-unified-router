export const APIKEY_CONSOLES = Object.freeze({
  agnes: 'https://platform.agnes-ai.cn/subscribe/subscription',
  unisound: 'https://maas.unisound.com/admin/subscript',
})

const GIFT_UNITS = Object.freeze({
  TOKEN: 'Token',
  HOUR: '小时',
  HOURS: '小时',
  DURATION: '小时',
  CHAR: '字',
  CHARS: '字',
  CHARACTER: '字',
  CREDIT: '积分',
  CREDITS: '积分',
  小时: '小时',
  字: '字',
  积分: '积分',
})

// 上游控制台接口（如云知声 U Plan 的 weeklyPointsTotal/Remain/Used）常把数值
// 序列化为十进制字符串；统一接受非负有限数字及纯非负十进制数字字符串。
export const apiQuotaAmount = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || !/^\d+(?:\.\d+)?$/.test(trimmed)) return null
    value = Number(trimmed)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
export const apiQuotaClampedAmount = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-\d+(?:\.\d+)?$/.test(trimmed)) return 0
  } else if (typeof value === 'number' && Number.isFinite(value) && value < 0) {
    return 0
  }
  return apiQuotaAmount(value)
}
export function apiQuotaWindow(id, used, limit, remaining, resetInMs) {
  used = apiQuotaAmount(used); limit = apiQuotaAmount(limit); remaining = apiQuotaAmount(remaining)
  if (remaining === null && used !== null && limit !== null) remaining = Math.max(0, limit - used)
  const hint = Number.isSafeInteger(resetInMs) && resetInMs > 0 && resetInMs <= 7 * 86400000 ? { resetInMs } : {}
  return used === null && remaining === null ? null : { id, used, limit, remaining, ...hint }
}
export function apiQuotaGift(modelId, used, limit, remaining, unit) {
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(modelId)) return null
  used = apiQuotaAmount(used); limit = apiQuotaAmount(limit); remaining = apiQuotaAmount(remaining)
  if (remaining === null && used !== null && limit !== null) remaining = Math.max(0, limit - used)
  if (used === null && remaining === null) return null
  const rawUnit = typeof unit === 'string' ? unit.trim() : ''
  const normalizedUnit = GIFT_UNITS[rawUnit] ?? GIFT_UNITS[rawUnit.toUpperCase()] ?? ''
  return { modelId, used, limit, remaining, unit: normalizedUnit }
}

export function projectApiKeyQuota(value) {
  if (!value || typeof value !== 'object') return null
  if (['needs-console', 'unavailable', 'expired', 'error'].includes(value.status)) return { status: value.status }
  if (value.status !== 'ready') return null
  const windows = (Array.isArray(value.windows) ? value.windows : []).slice(0, 8)
    .filter(row => ['weekly-points', 'window-points', 'monthly-credits', 'window-credits', 'pack-credits', 'weekly-requests', 'window-requests'].includes(row?.id))
    .map(row => apiQuotaWindow(row.id, row.used, row.limit, row.remaining, row.resetInMs)).filter(Boolean)
  const gifts = (Array.isArray(value.gifts) ? value.gifts : []).slice(0, 16)
    .map(row => apiQuotaGift(row?.modelId, row?.used, row?.limit, row?.remaining, row?.unit)).filter(Boolean)
  return {
    status: 'ready',
    windows,
    ...(gifts.length ? { gifts } : {}),
    balance: apiQuotaAmount(value.balance),
    updatedAt: apiQuotaAmount(value.updatedAt),
  }
}

export function projectApiKeyRateLimit(value) {
  if (!Number.isSafeInteger(value?.until) || value.until <= 0) return null
  return { until: value.until, reason: ['rpm', 'tpm'].includes(value.reason) ? value.reason : 'unknown', estimated: value.estimated === true }
}
