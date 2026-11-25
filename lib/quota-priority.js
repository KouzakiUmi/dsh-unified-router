// Requests read already-projected quota snapshots. Ranking never fetches quota,
// rewrites account preference, or adds candidates to the existing account pool.
//
// 智能选号模式（routingMode，全局单选）：
// - 'manual'   手动顺序（默认）：候选保持池内手动顺序，直接原样返回。
// - 'free'     免费额度优先：只按「今日刷新的每日额度 → 免费赠送」排序，
//              计费额度临期与否不参与（先花不扣钱的）。
// - 'expiring' 临期额度优先（原 preferExpiringQuota）：每日 → 免费赠送 →
//              7 天内到期的计费额度，同档先到期先用。
// - 'sticky'   缓存优先（粘滞）：同一模型沿用最近实际服务的前台账号
//              （lastAccount 记录来自 llm/stream 的 note），无记录回手动顺序。
const MAX_AGE = 3 * 60_000
const SOON = 7 * 24 * 60 * 60_000
const DAY = 24 * 60 * 60_000
const dayInChina = time => Math.floor((time + 8 * 60 * 60_000) / DAY)
const PACK = new Map([
  ['raccoon', ['每日积分', '注册礼包']],
  ['qodercn', []], ['trae', ['签到奖励', '免费', '每月登录赠送']],
])
const MANAGED = new Map([
  ['astudio', ['活动赠送积分', '会员积分', '购买积分']],
  ['codearts', ['免费日额度', '赠送积分包']],
])
const DAILY = new Set(['每日积分', '免费日额度'])
const FREE = new Set(['签到奖励', '免费', '注册礼包', '每月登录赠送', '活动赠送积分', '赠送积分包'])
export const quotaPriorityProviders = standalone => [...(standalone ? [...PACK.keys()] : []), ...MANAGED.keys()]

const live = (at, now) => Number.isFinite(at) && at > 0 && at <= now && now - at <= MAX_AGE
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const deadline = value => typeof value === 'number' ? value : typeof value === 'string' && value ? Date.parse(value) : NaN

function score({ name, amount, at, end }, now, isGift, mode) {
  if (!positive(amount)) return null
  const until = deadline(end)
  if (positive(until) && until <= now) return null
  if (isGift && DAILY.has(name)) return dayInChina(at) === dayInChina(now) ? [3, until || Infinity] : null
  if (isGift && FREE.has(name)) return [2, until || Infinity]
  // 免费额度优先不把「计费额度临期」当加分项：先花不扣钱的，计费额度保持手动顺序。
  if (mode === 'free') return null
  return positive(until) && until - now <= SOON ? [1, until] : null
}

const compare = (a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)

function scoresFor(provider, snapshot, now, model, mode) {
  const scores = new Map()
  if (!snapshot?.value || snapshot.stale || !live(snapshot.at, now) || !Array.isArray(snapshot.value.accounts)) return scores
  const pack = PACK.get(provider)
  for (const row of snapshot.value.accounts) {
    if (row?.error || !live(row?.updatedAt, now)) continue
    const candidates = pack ? (Array.isArray(row.balance?.packages) ? row.balance.packages : [])
      .filter(pkg => pkg?.active === true)
      .map(pkg => score({ name: pkg.name, amount: pkg.remaining, at: row.updatedAt, end: pkg.expiresAt }, now, pack.includes(pkg.name), mode))
      : managedScores(provider, row, now, model, mode)
    const best = candidates.filter(Boolean).sort(compare)[0]
    if (best) scores.set(pack ? row.accountId : row.id, best)
  }
  return scores
}

function managedScores(provider, row, now, model, mode) {
  if (row.enabled === false || row.signedIn !== true || !Array.isArray(row.windows)) return []
  const codeartsFree = model?.free === true || model?.meta?.maasType === 'benefit'
  return row.windows.flatMap(window => {
    if (!MANAGED.get(provider)?.includes(window?.name)) return []
    if (provider === 'codearts' && (window.name === '免费日额度') !== codeartsFree) return []
    // CodeArts package end_date describes the aggregate subscription, not an
    // individual gift's deduction deadline. Older AStudio snapshots used resetsAt for expiry.
    const end = provider === 'codearts' ? undefined : window.expiresAt || window.resetsAt
    return [score({ name: window.name, amount: window.balance, at: row.updatedAt, end }, now, true, mode)]
  })
}

/**
 * 选号重排器：只重排调用方已过滤的候选，绝不新增候选或改写账号偏好。
 *
 * 第三参 context：`{ modelId?: string, model?: unknown }` —— 池路径带 modelId
 * （粘滞键），自管渠道另带 model 对象（CodeArts 免费/付费窗口分流）。
 */
export function createQuotaAccountOrder({ read, mode, lastAccount, clock = Date.now }) {
  return (provider, ids, context) => {
    const current = typeof mode === 'function' ? mode(provider) : 'manual'
    if (current === 'manual' || !Array.isArray(ids) || ids.length < 2) return ids
    if (current === 'sticky') {
      const modelId = typeof context?.modelId === 'string' ? context.modelId : ''
      const last = modelId && typeof lastAccount === 'function' ? lastAccount(provider, modelId) : null
      // 记录的账号仍在本轮候选里才置顶；已停用/受限/被排除时自然回退手动顺序。
      return last && ids.includes(last) ? [last, ...ids.filter(id => id !== last)] : ids
    }
    const model = context?.model
    const resource = PACK.has(provider) ? 'credits.balances' : MANAGED.has(provider) ? 'managed.snapshot' : null
    if (!resource) return ids
    const scores = scoresFor(provider, read(`${provider}/${resource}`), clock(), model, current)
    const fallback = [0, Infinity]
    return scores.size ? [...ids].sort((a, b) => compare(scores.get(a) ?? fallback, scores.get(b) ?? fallback)) : ids
  }
}
