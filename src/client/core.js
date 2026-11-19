// 共享常量、输入校验与 wire 归一化：把主机投影后的数据收编成视图状态。
// 视图绝不保留原始凭据或上游错误（accountsFrom/modelsFrom 等只收编白名单字段）。
// 渠道注册表在 providers/index.js；本模块不定义渠道清单，全部按注册表推导。
// （拼接机制下跨模块按名引用，注册表晚于本模块定义没关系——只在运行时取用。）

export const MODEL_PAGE_SIZE = 15
export const PLAN_METHODS = new Set(['plan.snapshot', 'plan.setEnabled', 'plan.setKey', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels'])
export const WORKBUDDY_METHODS = new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.models', 'workbuddy.setModelEnabled', 'workbuddy.setModelParams', 'workbuddy.resetModels'])
export const METHODS = new Set(['provider.status', 'account.list', 'model.list', 'credits.permanentLock',
  'account.create', 'login.poll', 'account.update', 'account.delete', 'account.reorder', 'account.refresh',
  'account.reset', 'account.retest', 'provider.setEnabled', 'model.setDisabled', 'model.clearDead',
  'model.setAllDisabled', 'model.resetDefaults', 'model.refresh', 'model.params', 'model.setParams',
  'credits.balances', 'credits.claimAll', 'onboarding.claim', 'settings.snapshot', 'settings.refresh', ...PLAN_METHODS])
export const WORKBUDDY_ID = 'workbuddy'
export const allowed = id => PROVIDERS.some(p => p.id === id)
export const packAllowed = id => PACK_PROVIDERS.some(p => p.id === id)
export const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
export const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
export const initial = provider => ({ provider, accounts: [], models: [], balances: [], statuses: {}, selected: '', loadFailed: false,
  checkin: null,
  locked: false, login: null, pendingDelete: null, params: {}, plan: null, planStale: false, planError: false,
  // WorkBuddy 是自管多账号快照：accounts 逐账号、models 全局、loginUrl 属登录窗口。
    workbuddy: { accounts: [], models: [], loginUrl: '' }, workbuddyReady: false, workbuddyStale: false, workbuddyError: false, workbuddyLoginUrl: null,
  // 模型目录来源（按模型 provider）：'remote' = 真拉到上游目录，'fallback' = 离线兜底，
  // 缺省 = 未知（还没刷过）。设置页据此显示来源标识并决定是否自动补拉一次。
  modelSource: {},
  loading: false, busy: false, notice: '正在读取渠道状态…' })

export function safeLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址不可用')
  let url
  try { url = new URL(value) } catch { throw new Error('登录地址不可用') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址不可用')
  return url.href
}
export function accountsFrom(value, provider) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && a.provider === provider && typeof a.id === 'string').map(a => ({
    id: a.id, provider, nickname: text(a.nickname, 80) || '未命名账号', enabled: a.enabled !== false,
    expiresAt: number(a.expiresAt),
    // 套餐档位（Raccoon 家族按它分流：免费模型侧 / 订阅模型侧）。缺省不是错误：
    // 老账号可能还没被探测打过标，界面按「未知」显示。
    plan: a.plan === 'free' || a.plan === 'pro' || a.plan === 'unknown' ? a.plan : '',
    modelRateLimits: Object.fromEntries(Object.entries(a.modelRateLimits ?? {}).filter(([, time]) => Number.isFinite(time) && time > Date.now())),
  }))
}
/**
 * 模型在界面状态里的**唯一键**：`provider:modelId`。
 *
 * 家族卡（Raccoon）的模型来自两个 provider，而两边的模型 id 原则上互斥、
 * 但「同一 id 在免费侧 0× / 订阅侧 >0×」这种事并不受我们控制。用组合键可以
 * 保证：模型启停、参数覆盖、React key、编辑位置都精确落到**那一个** provider
 * 的那一个模型上，不会串到另一侧。
 */
export const modelKey = (provider, id) => `${text(provider, 64)}:${text(id, 256)}`
/**
 * 模型目录收编。`provider` 必传：同一份状态里可能同时存在两个 provider 的模型
 * （家族卡），每条都带上自己的 provider 与组合键。
 */
export function modelsFrom(value, provider) {
  const owner = text(value?.provider, 64) || text(provider, 64)
  return (Array.isArray(value?.models) ? value.models : []).filter(m => m && typeof m.id === 'string').map(m => ({
    id: m.id, provider: owner, key: modelKey(owner, m.id),
    name: text(m.name) || text(m.id), disabled: m.disabled === true, dead: m.dead === true, isFree: m.isFree === true,
    // 模型真实能力：缺省时界面不给对应控件（不猜它有什么能力）。
    contextWindow: number(m.contextWindow),
    maxTokens: number(m.maxTokens),
    defaultMaxTokens: number(m.defaultMaxTokens),
    efforts: Array.isArray(m.efforts) ? m.efforts.filter(x => typeof x === 'string').slice(0, 8) : [],
    defaultEffort: typeof m.defaultEffort === 'string' ? m.defaultEffort : '',
    supportsImage: typeof m.supportsImage === 'boolean' ? m.supportsImage : null,
    stale: m.stale === true,
    staleReason: text(m.staleReason, 240),
    rate: modelRateFrom(m.rate),
  }))
}
function modelRateFrom(value) {
  return typeof value?.label === 'string' && (value.label === '免费' || /^(?:参考 )?x\d+(?:\.\d+)?$/.test(value.label))
    && ['neutral', 'info', 'success', 'warning'].includes(value.tone) ? {
      label: value.label, tone: value.tone,
      ...(Number.isFinite(value.multiplier) && value.multiplier > 0 ? { multiplier: value.multiplier } : {}),
    } : null
}
/**
 * 模型参数覆盖收编。键是 {@link modelKey}（`provider:modelId`），与
 * `state.models[].key` 一一对应 —— 参数编辑、摘要、分派都靠它。
 */
export function paramsFrom(value, provider) {
  const source = value?.params
  if (!source || typeof source !== 'object') return {}
  const owner = text(value?.provider, 64) || text(provider, 64)
  return Object.fromEntries(Object.entries(source).filter(([id, entry]) => typeof id === 'string' && entry && typeof entry === 'object')
    .map(([id, entry]) => [modelKey(owner, id), {
      ...(number(entry.contextWindow) !== null ? { contextWindow: entry.contextWindow } : {}),
      ...(number(entry.maxTokens) !== null ? { maxTokens: entry.maxTokens } : {}),
      ...(typeof entry.reasoningEffort === 'string' && entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
      ...(typeof entry.supportsImage === 'boolean' ? { supportsImage: entry.supportsImage } : {}),
    }]))
}
export function balancesFrom(value) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && typeof a.accountId === 'string').map(a => ({
    accountId: a.accountId, nickname: text(a.nickname, 80) || '未命名账号', total: number(a.balance?.total),
    updatedAt: number(a.updatedAt), stale: Boolean(a.error),
    packages: (Array.isArray(a.balance?.packages) ? a.balance.packages : []).slice(0, 40).map(p => ({
      name: text(p.name, 80), remaining: number(p.remaining), unit: text(p.unit, 20),
      expiresAt: number(p.expiresAt), active: p.active !== false,
    })),
  }))
}
// 渠道运行状态按注册表逐渠道收编（channel-pack 渠道才有；商汤由 plan 快照推导）。
export function statusFrom(value) {
  return Object.fromEntries(PACK_PROVIDERS.map(({ id }) => {
    const status = value?.statuses?.[id]
    return [id, status ? { closed: status.closed === true,
      accounts: number(status.accounts?.enabled ?? status.accounts),
      totalAccounts: number(status.accounts?.total ?? status.totalAccounts ?? status.accounts?.enabled ?? status.accounts),
      models: number(status.models?.total ?? status.models) } : null]
  }))
}
export const planNumber = number
export function planModelFields(value) {
  return {
    vision: value?.vision === true, contextWindow: number(value?.contextWindow),
    maxOutputLength: number(value?.maxOutputLength), maxTokensOverride: number(value?.maxTokensOverride),
    thinkingLevels: Array.isArray(value?.thinkingLevels) ? PLAN_EFFORTS.filter(level => value.thinkingLevels.includes(level)) : [],
    params: { maxTokens: number(value?.maxTokensOverride), ...normalizePlanParams(value?.params) },
    defaultEffort: text(value?.defaultEffort, 40), defaultVision: typeof value?.defaultVision === 'boolean' ? value.defaultVision : null,
    defaultContextWindow: number(value?.defaultContextWindow), defaultMaxOutputLength: number(value?.defaultMaxOutputLength),
  }
}

export function planSnapshotFrom(value) {
  const source = value ?? {}
  const rows = Array.isArray(source.models) ? source.models : []
  return {
    hasApiKey: source.hasApiKey === true, registerProvider: source.registerProvider === true,
    providerRegistered: source.providerRegistered === true, catalogAvailable: source.catalogAvailable === true,
    catalogError: source.catalogError === true, pollSeconds: number(source.pollSeconds), updatedAt: number(source.updatedAt),
    models: rows.filter(model => typeof model?.id === 'string' && model.id.length <= 256 && model.id).slice(0, 512)
      .map(model => ({ id: model.id, name: text(model.name), enabled: model.enabled !== false, ...planModelFields(model) })),
  }
}

export function mergePlanSnapshot(value) {
  const plan = planSnapshotFrom(value)
  return { plan, stale: value?.snapshot?.stale === true || plan.catalogError }
}

// WorkBuddy 用量快照：白名单字段收编（窗口、套餐、登录地址），凭据与上游
// 响应体不进快照。字段形状与 lib/workbuddy.js 的 publicWindow/publicModel 对齐：
// resetsAt 是 ISO 字符串；模型是 {id, name, 能力字段}。
export const WORKBUDDY_ERROR_CODES = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error'])
export function workbuddyWindowFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const window = {
    name: text(value.name, 80), used: number(value.used), amount: number(value.amount),
    limit: number(value.limit), balance: number(value.balance), display: text(value.display, 120),
    unit: text(value.unit, 40), resetsAt: text(value.resetsAt, 40), span: number(value.span),
    runsOutAt: text(value.runsOutAt, 40), runsOut: number(value.runsOut),
  }
  return window.name ? window : null
}
export function workbuddyModelsFrom(value) {
  return (Array.isArray(value) ? value : []).filter(m => m && typeof m === 'object' && typeof m.id === 'string' && m.id)
    .map(m => ({ id: text(m.id, 256), name: text(m.name, 160) || text(m.id, 256),
      context: number(m.context), output: number(m.output),
      attachment: typeof m.attachment === 'boolean' ? m.attachment : null, reasoning: m.reasoning === true,
      efforts: Array.isArray(m.efforts) ? m.efforts.filter(e => typeof e === 'string').slice(0, 8) : [],
      free: m.free === true, enabled: m.enabled !== false, rate: modelRateFrom(m.rate),
      ...planModelFields({ ...m, thinkingLevels: m.efforts }) }))
}
// 单账号快照收编：id 缺失或非对象直接丢弃（脏行不进界面）；窗口逐条白名单归一。
export function workbuddyAccountFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = text(value.id, 64)
  if (!id) return null
  const rawError = text(value.error, 40)
  return {
    id, name: text(value.name, 80) || id, uid: text(value.uid, 120),
    signedIn: value.signedIn === true, plan: text(value.plan, 160),
    signIn: text(value.signIn, 20) === 'renewed' ? 'renewed' : 'kept',
    windows: Array.isArray(value.windows) ? value.windows.slice(0, 16).map(workbuddyWindowFrom).filter(Boolean) : [],
    updatedAt: number(value.updatedAt),
    error: WORKBUDDY_ERROR_CODES.has(rawError) ? rawError : '',
  }
}
// 多账号快照：{accounts:[...], models:[全局目录], loginUrl}。软失败（上游/鉴权临时
// 错误）且该账号已有读数时按 id 保留上次窗口，身份字段用本次的，整体标 stale。
export function workbuddySnapshotFrom(value, previous) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 8)
    .map(workbuddyAccountFrom).filter(Boolean)
  // 模型目录是全局的：本次没带（如只补读快照）就沿用上次。
  const models = Array.isArray(source.models) ? workbuddyModelsFrom(source.models) : (previous?.models ?? [])
  let stale = false
  const merged = accounts.map(account => {
    const softFailed = account.error === 'upstream_error' || account.error === 'auth_error'
    const old = (previous?.accounts ?? []).find(row => row.id === account.id)
    if (softFailed && old?.signedIn && account.signedIn && old.windows.length) {
      stale = true
      return { ...account, plan: account.plan || old.plan, windows: old.windows }
    }
    return account
  })
  const modelSource = ['remote', 'cached', 'fallback'].includes(source.modelSource) ? source.modelSource : previous?.modelSource
  return { workbuddy: { accounts: merged, models, modelSource, loginUrl: text(source.loginUrl, 4096) }, stale }
}
export function claimMessage(value, provider) {
  const results = Array.isArray(value?.results) ? value.results : []
  if (!results.length) return '没有可领取的账号。'
  const count = kind => results.filter(r => r.outcome?.kind === kind).length
  let result = `领取结果：${count('claimed')} 个成功，${count('already-claimed')} 个已领，${count('inactive')} 个暂不可领，${count('failed')} 个失败。`
  if (count('pending')) result += `${count('pending')} 个待确认。`
  if (results.some(r => r.outcome?.actionRequired)) result += provider === 'qodercn'
    ? '每日额度开通入口：Qoder 中国版官方客户端。' : '每日额度开通入口：官方客户端。'
  return result
}
const CHECKIN_LABELS = {
  claimed: '已签到', 'already-claimed': '已签到', inactive: '签到活动未开启',
  ineligible: '签到条件未满足', failed: '签到失败', pending: '签到待确认',
}
export function checkinEntry(state, provider, accountId) {
  const current = state.checkin?.providers?.[provider]
  if (!current) return null
  const date = new Date(Date.now() + (8 - current.resetHour) * 3_600_000).toISOString().slice(0, 10)
  if (current.date !== date) return null
  const account = current.accounts?.find(account => account.accountId === accountId)
  const kind = account?.kind
  const label = Object.hasOwn(CHECKIN_LABELS, kind) ? CHECKIN_LABELS[kind] : null
  if (!label) return null
  return { tag: [label, kind === 'claimed' || kind === 'already-claimed' ? 'success' : 'warn'], locked: account.retryable !== true }
}
export function modelDisplayName(model) {
  return readableModelName(text(model?.id, 256), text(model?.name, 160)) || '未命名模型'
}
export function filterModels(models, query) {
  const needle = String(query || '').trim().toLowerCase()
  return models.filter(m => !needle || `${m.id} ${m.name} ${modelDisplayName(m)}`.toLowerCase().includes(needle))
}

// ===== 渠道级缓存（sessionStorage）=====
//
// 解决的就是用户报的这句：「每次点进去都『没有信息，正在拉取』」。
// 切回**已经读过的**渠道时先用上次的数据把界面填上，后台照常静默刷新；
// 重进设置页（宿主重挂载）也恢复上次结果。
//
// 缓存里只放**公开投影后**的渠道自有字段（accountsFrom / modelsFrom /
// balancesFrom / paramsFrom 的产物）——凭据与上游原始错误从来不在这些形状里，
// 所以读回来的条目也不需要额外脱敏，只需按白名单重新收编一次（防手改/脏数据）。
export const CACHE_STORAGE_KEY = 'eac-unified-router-cache-v1'
// 目录来源只有主机回报的两个结论；其它值一律不收。
const CACHE_MODEL_SOURCES = new Set(['remote', 'cached', 'fallback'])
/**
 * 把持久化条目收编成可信的渠道自有数据。`provider` 是条目所属渠道（卡片 id）。
 *
 * 非对象 → null（调用方直接丢弃）。逐字段白名单：
 * - accounts：`accountsFrom` 已按 `a.provider === provider` 过滤并收编；
 * - models：缓存里的模型是**已归一形状**（带 provider/key），不能整体喂
 *   `modelsFrom`——那样会把家族卡两侧都归到宿主 provider。这里先过滤脏行，
 *   按 `m.provider` 分组，只保留本渠道的模型面，每侧各自 `modelsFrom`；
 * - balances：缓存形状 {accountId, nickname, total, packages}，适配回 wire 形状后
 *   复用 `balancesFrom`；
 * - params：只保留键命中收编后模型的条目，值按 paramsFrom 的字段口径挑；
 * - locked / modelSource / selected / at：白名单取值，非法值退回缺省。
 */
export function sanitizeCacheEntry(entry, provider) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const accounts = accountsFrom({ accounts: Array.isArray(entry.accounts) ? entry.accounts : [] }, provider)
  // 模型按 provider 分组：家族卡（raccoon）两侧各一份目录，键是 `provider:modelId`。
  const sides = modelProvidersOf(provider)
  const grouped = new Map(sides.map(side => [side, []]))
  for (const row of Array.isArray(entry.models) ? entry.models : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    if (typeof row.id !== 'string' || !row.id || typeof row.provider !== 'string') continue
    // 组合键必须与 id/provider 自洽，否则这一行不知道自己属于哪一侧。
    if (row.key !== modelKey(row.provider, row.id)) continue
    grouped.get(row.provider)?.push(row)
  }
  const models = sides.flatMap(side => modelsFrom({ models: grouped.get(side) }, side))
  const balances = balancesFrom({ accounts: (Array.isArray(entry.balances) ? entry.balances : [])
    .filter(b => b && typeof b === 'object' && !Array.isArray(b) && typeof b.accountId === 'string')
    .map(b => ({ accountId: b.accountId, nickname: b.nickname, updatedAt: b.updatedAt, error: b.stale === true,
      balance: { total: b.total, packages: b.packages } })) })
  const knownKeys = new Set(models.map(model => model.key))
  const rawParams = entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params) ? entry.params : {}
  const params = Object.fromEntries(Object.entries(rawParams)
    .filter(([key, value]) => knownKeys.has(key) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, value]) => [key, {
      ...(number(value.contextWindow) !== null ? { contextWindow: value.contextWindow } : {}),
      ...(number(value.maxTokens) !== null ? { maxTokens: value.maxTokens } : {}),
      ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
      ...(typeof value.supportsImage === 'boolean' ? { supportsImage: value.supportsImage } : {}),
    }]))
  const rawSource = entry.modelSource && typeof entry.modelSource === 'object' ? entry.modelSource : {}
  const modelSource = Object.fromEntries(sides
    .filter(side => CACHE_MODEL_SOURCES.has(rawSource[side]))
    .map(side => [side, rawSource[side]]))
  const selected = typeof entry.selected === 'string' && accounts.some(a => a.id === entry.selected) ? entry.selected : ''
  return { accounts, models, balances, params, locked: entry.locked === true, modelSource, selected, at: number(entry.at) ?? 0 }
}
/**
 * 读持久化缓存。storage 无效 / 读或解析失败 → null（调用方按「没有缓存」处理）。
 *
 * 只收 channel-pack 渠道，且排除商汤、WorkBuddy：它们的数据在 plan / workbuddy
 * 快照里（已由 sharedCards 跨渠道保留），不属于本案的渠道自有缓存。
 */
export function readChannelCache(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let raw
  try { raw = storage.getItem(CACHE_STORAGE_KEY) } catch { return null }
  if (typeof raw !== 'string' || !raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const source = parsed.channels && typeof parsed.channels === 'object' && !Array.isArray(parsed.channels) ? parsed.channels : {}
  // 卡片快照（商汤 / WorkBuddy）：只有它们能让那两张渠道 tab 在**点进去之前**也有数字。
  const cards = sanitizeCardSnapshots(parsed)
  const channels = {}
  for (const [provider, entry] of Object.entries(source)) {
    if (!packAllowed(provider) || provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) continue
    const clean = sanitizeCacheEntry(entry, provider)
    if (clean) channels[provider] = clean
  }
  return { channels, statuses: statusFrom({ statuses: parsed.statuses }),
    plan: cards.plan ?? null, workbuddy: cards.workbuddy ?? null }
}
/**
 * 写持久化缓存。存储不可用（隐私模式、配额满、宿主无 sessionStorage）时静默忽略：
 * 缓存只是体验优化，写失败不该影响任何一次读取。
 */
/**
 * 卡片快照的**白名单收编**（商汤 plan / WorkBuddy workbuddy）。
 *
 * 这两份快照里没有任何凭据（登录令牌在凭据服务里），但为了不把上游原文或未来新增
 * 字段直接回灌界面，读回时逐字段重建。
 */
export function sanitizeCardSnapshots(parsed) {
  const plan = parsed?.plan && planSnapshotFrom(parsed.plan)
  const workbuddy = parsed?.workbuddy && workbuddySnapshotFrom({
    accounts: parsed.workbuddy.accounts, models: parsed.workbuddy.models,
  }).workbuddy
  return { plan, workbuddy }
}

export function writeChannelCache(storage, channels, statuses, cards = {}) {
  if (!storage || typeof storage.setItem !== 'function') return
  try {
    storage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
      v: 2, channels: channels || {}, statuses: statuses || {},
      // 卡片快照：只存展示所需的计数字段（见 sanitizeCardSnapshots）。
      ...sanitizeCardSnapshots(cards),
      at: Date.now(),
    }))
  } catch { /* 缓存写失败不提示用户：下次进页面照常读一次。 */ }
}
