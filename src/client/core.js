// 共享常量、输入校验与 wire 归一化：把主机投影后的数据收编成视图状态。
// 视图绝不保留原始凭据或上游错误（accountsFrom/modelsFrom 等只收编白名单字段）。
// 渠道注册表在 providers/index.js；本模块不定义渠道清单，全部按注册表推导。
// （拼接机制下跨模块按名引用，注册表晚于本模块定义没关系——只在运行时取用。）

export const MODEL_PAGE_SIZE = 15
// 方法集**全部由 `lib/channel-specs.js` 派生**（与宿主同一份规格表）：
// 过去这里手写了六张表与宿主并行维护，漏改任一处的表现是「按钮点了报不支持此操作」。
// 客户端白名单比宿主窄一档 —— `HOST_INTERNAL_METHODS`（签到 / 奖励的只读核实端点）
// 只给宿主调度用，见规格表里的同名常量。
const CLIENT_METHODS = clientMethodSets()
/** 单 Key 订阅渠道（商汤 Token Plan）。 */
export const PLAN_METHODS = CLIENT_METHODS.plan
/** 自管单渠道（WorkBuddy）。 */
export const WORKBUDDY_METHODS = CLIENT_METHODS.workbuddy
/** API Key 渠道（Agnes、云知声）共用；渠道 id 在 `payload.provider` 里带。 */
export const APIKEY_METHODS = CLIENT_METHODS.apikey
/** 自管多账号渠道（AStudio / CodeArts）共用。 */
export const MANAGED_METHODS = CLIENT_METHODS.managed
/** 自动化调度（与渠道无关的全局方法）。 */
export const AUTOMATION_METHODS = CLIENT_METHODS.automation
/** 客户端可发起的全部方法（渠道池主路径 + 全局 + 单 Key 订阅）。 */
export const METHODS = CLIENT_METHODS.all
export const WORKBUDDY_ID = 'workbuddy'
export const allowed = id => PROVIDERS.some(p => p.id === id)
export const packAllowed = id => PACK_PROVIDERS.some(p => p.id === id)
export const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
export const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
export const initial = provider => ({ provider, accounts: [], models: [], balances: [], statuses: {}, selected: '', loadFailed: false,
  checkin: null,
  automation: null,
  login: null, pendingDelete: null, params: {}, plan: null, planStale: false, planError: false,
  // WorkBuddy 是自管多账号快照：accounts 逐账号、models 全局、loginUrl 属登录窗口。
    workbuddy: { accounts: [], models: [], loginUrl: '' }, workbuddyReady: false, workbuddyStale: false, workbuddyError: false, workbuddyLoginUrl: null,
  // API Key 渠道快照按渠道 id 存放：{ [id]: 快照 + ready / stale / error }。
  apikeys: {},
  // 自管多账号渠道快照按渠道 id 存放：{ [id]: 快照 + ready / stale / error / loginUrl }。
  managed: {},
  // 模型目录来源（按模型 provider）：'remote' = 真拉到上游目录，'fallback' = 离线兜底，
  // 缺省 = 未知（还没刷过）。设置页据此显示来源标识并决定是否自动补拉一次。
  modelSource: {},
  // 局部非阻塞进行中标记：{ [scope]: true }；busy 为是否有在途写操作的兼容汇总。
  pending: {},
  loading: false, busy: false, notice: '正在读取渠道状态…' })

export function safeLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址不可用')
  let url
  try { url = new URL(value) } catch { throw new Error('登录地址不可用') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址不可用')
  return url.href
}
// 账号行的字段与缺省值由契约层定义（`lib/channel-contract.js` 的 `accountView`）：
// 宿主投影与客户端收编共用同一份白名单，改字段只改契约。
export function accountsFrom(value, provider) {
  return (Array.isArray(value?.accounts) ? value.accounts : [])
    .filter(a => a && a.provider === provider && typeof a.id === 'string')
    .map(a => accountView(a, provider))
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
  // 模型行的能力字段、倍率徽标与 `key` 组合键都由契约层定义（`modelView`）：
  // wire 层缺席即未知，界面据此不给对应控件（不猜模型有什么能力）。
  return (Array.isArray(value?.models) ? value.models : [])
    .filter(m => m && typeof m.id === 'string')
    .map(m => modelView({ ...m, provider: owner }, owner))
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
export function replaceProviderParams(params, value, provider) {
  return {
    ...Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith(`${provider}:`))),
    ...paramsFrom(value, provider),
  }
}
export function windowRemainingAmount(window) {
  if (!window) return null
  if (typeof window.balance === 'number' && Number.isFinite(window.balance)) return window.balance
  if (typeof window.amount === 'number' && Number.isFinite(window.amount) && window.limit > 0) {
    return Math.max(0, Math.round((window.limit - window.amount) * 10000) / 10000)
  }
  return null
}
export function windowRemainingNote(window, unitText = window?.unit || '') {
  const remaining = windowRemainingAmount(window)
  if (remaining === null) return false
  return `剩余 ${displayNumber(remaining)}${window.limit > 0 ? ` / ${displayNumber(window.limit)}` : ''}${unitText ? ` ${unitText}` : ''}`
}
export const displayCreditUnit = unit => /^credits?$/i.test(String(unit || '').trim()) ? '积分' : String(unit || '').trim()
export function balancesFrom(value) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && typeof a.accountId === 'string').map(a => ({
    accountId: a.accountId, nickname: text(a.nickname, 80) || '未命名账号', total: number(a.balance?.total),
    updatedAt: number(a.updatedAt), stale: Boolean(a.error),
    packages: (Array.isArray(a.balance?.packages) ? a.balance.packages : []).slice(0, 40).map(p => {
      const rawUnit = text(p.unit, 20)
      return {
        name: text(p.name, 80), remaining: number(p.remaining),
        unit: displayCreditUnit(rawUnit),
        expiresAt: number(p.expiresAt), active: p.active !== false,
      }
    }),
  }))
}
export function displayCreditPackages(packages) {
  const grouped = new Map()
  const ordered = []
  for (const pkg of Array.isArray(packages) ? packages : []) {
    if (!pkg) continue
    const rawName = pkg.name || ''
    const key = `${rawName}\0${pkg.active !== false ? '1' : '0'}\0${pkg.unit || ''}`
    let entry = grouped.get(key)
    if (!entry) {
      entry = { base: pkg, count: 0, knownRemaining: false, remaining: 0, expiresAt: null }
      grouped.set(key, entry)
      ordered.push(entry)
    }
    entry.count += 1
    if (typeof pkg.remaining === 'number' && Number.isFinite(pkg.remaining)) {
      entry.knownRemaining = true
      entry.remaining += pkg.remaining
    }
    if (typeof pkg.expiresAt === 'number' && Number.isFinite(pkg.expiresAt) && pkg.expiresAt > 0) {
      entry.expiresAt = entry.expiresAt === null ? pkg.expiresAt : Math.min(entry.expiresAt, pkg.expiresAt)
    }
  }
  return ordered.map(({ base, count, knownRemaining, remaining, expiresAt }) => count === 1 ? base : {
    ...base,
    name: `${base.name || '额度包'}（${count} 笔）`,
    remaining: knownRemaining ? Math.round(remaining * 100) / 100 : null,
    expiresAt,
  })
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
    quota: source.quota ?? null,
    models: rows.filter(model => typeof model?.id === 'string' && model.id.length <= 256 && model.id).slice(0, 512)
      .map(model => ({ id: model.id, name: text(model.name), enabled: model.enabled !== false, ...planModelFields(model) })),
  }
}

export function mergePlanSnapshot(value) {
  const plan = planSnapshotFrom(value)
  return { plan, stale: value?.snapshot?.stale === true || plan.catalogError }
}

// API Key 渠道快照：模型字段与商汤同形（planModelFields），另带目录来源与可选的用量。
// 用量只收 { error } 或 { used, limit, unlimited, unit }；单位只认 USD / CNY。
export function apikeyBalanceFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.error === true) return { error: true }
  if (value.unit !== 'USD' && value.unit !== 'CNY') return null
  return { used: number(value.used), limit: number(value.limit), unlimited: value.unlimited === true,
    unit: value.unit, updatedAt: number(value.updatedAt) }
}
export function apikeySnapshotFrom(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rows = Array.isArray(source.models) ? source.models : []
  return {
    hasApiKey: source.hasApiKey === true, registerProvider: source.registerProvider === true,
    providerRegistered: source.providerRegistered === true,
    catalogSource: ['remote', 'cached', 'fallback'].includes(source.catalogSource) ? source.catalogSource : 'fallback',
    catalogError: source.catalogError === true, updatedAt: number(source.updatedAt),
    models: rows.filter(model => typeof model?.id === 'string' && model.id.length <= 256 && model.id).slice(0, 512)
      .map(model => ({
        id: model.id, name: text(model.name), enabled: model.enabled !== false,
        ...(model.free === true ? { free: true } : {}),
        ...(model.paidOnly === true ? { paidOnly: true } : {}),
        ...planModelFields(model),
      })),
    balance: apikeyBalanceFrom(source.balance),
    quota: projectApiKeyQuota(source.quota),
    rateLimit: projectApiKeyRateLimit(source.rateLimit),
    toolsSupported: source.toolsSupported === true,
    toolsEnabled: source.toolsEnabled === true,
    toolsRegistered: source.toolsRegistered === true,
    // 控制台会话能力按渠道声明：宿主只对配了 consoleCredentialRef 的渠道透出
    // hasConsoleSession，这里保留「字段是否存在」语义，避免给 Agnes 也渲染控制台行。
    ...(typeof source.hasConsoleSession === 'boolean' ? { hasConsoleSession: source.hasConsoleSession } : {}),
    consoleLoginUrl: typeof source.consoleLoginUrl === 'string' ? source.consoleLoginUrl : '',
  }
}
// 重进设置页时恢复的渠道快照：按注册表里的渠道 id 逐个重建，未知 id 丢弃。
export function apikeySnapshotsFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, entry]) => allowed(id) && providerById(id)?.rpcMethods === APIKEY_METHODS
    && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => [id, apikeySnapshotFrom(entry)]))
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
    expiresAt: text(value.expiresAt, 48), aside: value.aside === true,
    models: Array.isArray(value.models) ? value.models.slice(0, 256).map(id => text(id, 256)).filter(Boolean) : [],
    notModels: Array.isArray(value.notModels) ? value.notModels.slice(0, 256).map(id => text(id, 256)).filter(Boolean) : [],
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
      free: m.free === true, enabled: m.enabled !== false, rate: viewRate(m.rate),
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
    // 账号开关（缺省启用）：与宿主投影、索引三处同一判据。
    enabled: value.enabled !== false,
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

// 自管多账号渠道快照收编（与 WorkBuddy 同构，额外支持 balance / source / authMethods / enabled / registered）。
export const MANAGED_ERROR_CODES = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error', 'task_error', 'import_error', 'unsupported', 'no_web_session'])
export function managedAccountFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = text(value.id, 64)
  if (!id) return null
  const rawError = text(value.error, 40)
  return {
    id, name: text(value.name, 80) || id, uid: text(value.uid, 120),
    enabled: value.enabled !== false,
    source: ['browser', 'local', 'credential'].includes(value.source) ? value.source : 'browser',
    signedIn: value.signedIn === true, plan: text(value.plan, 120),
    balance: number(value.balance), unit: text(value.unit, 24),
    windows: Array.isArray(value.windows) ? value.windows.slice(0, 16).map(workbuddyWindowFrom).filter(Boolean) : [],
    updatedAt: number(value.updatedAt),
    error: MANAGED_ERROR_CODES.has(rawError) ? rawError : '',
  }
}
export function managedSnapshotFrom(value, previous) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 8)
    .map(managedAccountFrom).filter(Boolean)
  const models = Array.isArray(source.models) ? workbuddyModelsFrom(source.models) : (previous?.models ?? [])
  let stale = false
  const merged = accounts.map(account => {
    const softFailed = account.error === 'upstream_error' || account.error === 'auth_error'
    const old = (previous?.accounts ?? []).find(row => row.id === account.id)
    if (softFailed && old?.signedIn && account.signedIn && (old.windows.length || old.balance !== null)) {
      stale = true
      return {
        ...account,
        plan: account.plan || old.plan,
        windows: old.windows.length ? old.windows : account.windows,
        balance: old.balance !== null ? old.balance : account.balance,
        unit: old.unit || account.unit,
        updatedAt: old.updatedAt,
      }
    }
    return account
  })
  const modelSource = ['remote', 'cached', 'fallback'].includes(source.modelSource) ? source.modelSource : previous?.modelSource
  return {
    managed: {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : (previous?.enabled !== false),
      registered: typeof source.registered === 'boolean' ? source.registered : (previous?.registered === true),
      authMethods: Array.isArray(source.authMethods) ? source.authMethods.filter(m => ['browser', 'local', 'credential'].includes(m)) : (previous?.authMethods ?? ['browser']),
      credentialHint: text(source.credentialHint, 160) || (previous?.credentialHint ?? ''),
      accounts: merged,
      models,
      modelSource,
      loginUrl: text(source.loginUrl, 4096),
    },
    stale,
  }
}
export function managedSnapshotsFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([id, entry]) => allowed(id) && providerById(id)?.rpcMethods === MANAGED_METHODS && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => [id, managedSnapshotFrom({ ...entry, loginUrl: '' }).managed]))
}

// 自动化配置与任务状态收编
export function automationFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const cfg = value.config && typeof value.config === 'object' ? value.config : {}
  const providers = {}
  if (cfg.providers && typeof cfg.providers === 'object' && !Array.isArray(cfg.providers)) {
    for (const [id, entry] of Object.entries(cfg.providers)) {
      if (!entry || typeof entry !== 'object') continue
      const clean = {}
      if (typeof entry.autoCheckin === 'boolean') clean.autoCheckin = entry.autoCheckin
      if (typeof entry.autoClaimRewards === 'boolean') clean.autoClaimRewards = entry.autoClaimRewards
      if (typeof entry.autoCompleteTasks === 'boolean') clean.autoCompleteTasks = entry.autoCompleteTasks
      if (typeof entry.cotLoopGuard === 'boolean') clean.cotLoopGuard = entry.cotLoopGuard
      // 分渠道默认输出上限：只在上游缺输出规格时生效。
      if (Number.isSafeInteger(entry.defaultMaxOutput) && entry.defaultMaxOutput > 0) clean.defaultMaxOutput = entry.defaultMaxOutput
      if (Object.keys(clean).length) providers[id] = clean
    }
  }
  const tasks = {}
  if (value.tasks && typeof value.tasks === 'object' && !Array.isArray(value.tasks)) {
    for (const [id, entry] of Object.entries(value.tasks)) {
      if (!entry || typeof entry !== 'object') continue
      tasks[id] = {
        date: text(entry.date, 16),
        capabilities: {
          claimRewards: entry.capabilities?.claimRewards === true,
          completeTasks: entry.capabilities?.completeTasks === true,
        },
        claimRewards: Array.isArray(entry.claimRewards) ? entry.claimRewards : [],
        completeTasks: Array.isArray(entry.completeTasks) ? entry.completeTasks : [],
      }
    }
  }
  return {
    config: {
      autoCheckin: cfg.autoCheckin !== false,
      autoClaimRewards: cfg.autoClaimRewards !== false,
      autoCompleteTasks: cfg.autoCompleteTasks === true,
      cotLoopGuard: cfg.cotLoopGuard !== false,
      preferExpiringQuota: cfg.preferExpiringQuota === true,
      raccoonUnifiedModels: cfg.raccoonUnifiedModels === true,
      routingMode: ['manual', 'free', 'expiring', 'sticky'].includes(cfg.routingMode) ? cfg.routingMode
        : cfg.preferExpiringQuota === true ? 'expiring' : 'manual',
      providers,
    },
    tasks,
    quotaProviders: (Array.isArray(value.quotaProviders) ? value.quotaProviders : []).filter(id => typeof id === 'string' && providerById(id)),
    unifiedModelProviders: (Array.isArray(value.unifiedModelProviders) ? value.unifiedModelProviders : []).filter(id => typeof id === 'string' && providerById(id)),
  }
}
export function automationEffective(state, providerId, field) {
  const cfg = state.automation?.config
  if (!cfg) return undefined
  const override = cfg.providers?.[providerId]?.[field]
  if (typeof override === 'boolean') return override
  return cfg[field] === true
}
export const checkinEnabled = (state, id) => state.checkin?.providers?.[id]?.enabled
  ?? (state.checkin?.providers?.[id] ? state.checkin.enabled : undefined)
export const taskScope = (provider, mode) => `tasks:${provider}:${mode}`

export function taskMessage(value, mode, querying = false) {
  const records = Array.isArray(value?.results) ? value.results : []
  if (!records.length) return '没有可操作的账号。'
  const counts = new Map()
  for (const record of records) {
    const kind = record.outcome?.kind
    const label = kind === 'claimed' || kind === 'completed' ? record.repeated ? '已完成' : '成功'
      : ({ done: '已完成', 'already-claimed': '已签到', inactive: '活动未开启', ineligible: '暂不符合条件', empty: '暂无可领', failed: '失败', pending: '待确认', unsupported: '暂无记录' })[kind] ?? '待确认'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const topic = mode === 'checkin' ? '签到' : mode === 'completeTasks' ? '任务' : '奖励'
  const local = querying && records.every(record => record.verified !== true) ? '（本地记录）' : ''
  return `${topic}${querying ? '状态' : mode === 'completeTasks' ? '执行' : '领取'}${local}：${Array.from(counts, ([label, count]) => `${count} 个${label}`).join('，')}。`
}
const TASK_LABELS = {
  claimed: '奖励已领', completed: '任务已完成', done: '已完成',
  empty: '暂无可领', failed: '任务失败', pending: '待确认', unsupported: '暂不支持',
}
export function taskEntry(state, providerId, mode, accountId) {
  const row = state.automation?.tasks?.[providerId]?.[mode]?.find(item => item.accountId === accountId)
  if (!row) return null
  const label = Object.hasOwn(TASK_LABELS, row.kind) ? TASK_LABELS[row.kind] : null
  if (!label) return null
  const ok = row.kind === 'claimed' || row.kind === 'completed' || row.kind === 'done'
  return { tag: [label, ok ? 'success' : row.kind === 'empty' ? undefined : 'warn'], row, locked: ok || row.kind === 'pending' || row.kind === 'failed' && !row.retryable }
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
  const label = provider === 'codearts' && kind === 'inactive' ? '未查到今日签到记录'
    : Object.hasOwn(CHECKIN_LABELS, kind) ? CHECKIN_LABELS[kind] : null
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
 * - modelSource / selected / at：白名单取值，非法值退回缺省。
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
  return { accounts, models, balances, params, modelSource, selected, at: number(entry.at) ?? 0 }
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
    plan: cards.plan ?? null, workbuddy: cards.workbuddy ?? null,
    // 读回的快照是上次的结果：标记 ready 让首屏直接显示，随后由实时读取覆盖。
    apikeys: Object.fromEntries(Object.entries(cards.apikeys).map(([id, entry]) => [id, { ...entry, ready: true, stale: false, error: false }])),
    managed: Object.fromEntries(Object.entries(cards.managed).map(([id, entry]) => [id, { ...entry, ready: true, stale: false, error: false, loginUrl: '' }])) }
}
/**
 * 写持久化缓存。存储不可用（隐私模式、配额满、宿主无 sessionStorage）时静默忽略：
 * 缓存只是体验优化，写失败不该影响任何一次读取。
 */
/**
 * 卡片快照的**白名单收编**（商汤 plan / WorkBuddy / API Key / 自管多账号渠道）。
 *
 * 快照里没有任何凭据（登录令牌在凭据服务里），读回时逐字段重建。
 */
export function sanitizeCardSnapshots(parsed) {
  const plan = parsed?.plan && planSnapshotFrom(parsed.plan)
  const workbuddy = parsed?.workbuddy && workbuddySnapshotFrom({
    accounts: parsed.workbuddy.accounts, models: parsed.workbuddy.models,
  }).workbuddy
  return { plan, workbuddy, apikeys: apikeySnapshotsFrom(parsed?.apikeys), managed: managedSnapshotsFrom(parsed?.managed) }
}

export const percentMetric = fraction => typeof fraction === 'number' && Number.isFinite(fraction)
  ? { value: Math.round(fraction * 100), unit: '% 剩余', fraction }
  : undefined

/**
 * 「免费额度面」渠道的空额度识别。
 *
 * 有的渠道给免费用户一个额度恒为 0 的账户面（Agnes）：这既不是读取失败，也不能
 * 当成「没额度」显示 —— 界面要说「免费用户（额度读取为 0）」，否则用户会以为出了问题。
 *
 * 判据只看数据形状，**与渠道名无关**。是否启用由渠道视图的能力声明 `freeTier` 决定
 * （见 `providers/apikey.js` 的 `apiKeyChannel`），共享层不写 `id === 'agnes'`。
 */
export function isFreeTierIdle(quota, balance) {
  if (quota?.status === 'ready') {
    const bal = typeof quota.balance === 'number' && Number.isFinite(quota.balance) ? quota.balance : 0
    const windows = Array.isArray(quota.windows) ? quota.windows : []
    const hasPositive = windows.some(w =>
      (typeof w?.remaining === 'number' && w.remaining > 0) ||
      (typeof w?.limit === 'number' && w.limit > 0) ||
      (typeof w?.used === 'number' && w.used > 0))
    const hasZero = quota.balance === 0 || windows.some(w => w?.remaining === 0 || w?.limit === 0 || w?.used === 0)
    return bal <= 0 && !hasPositive && hasZero
  }
  if (balance && typeof balance === 'object' && !balance.error) {
    return balance.used === 0 && (balance.limit === null || balance.limit <= 0)
  }
  return false
}

export function isPermanentCreditPackage(pkg, providerId) {
  if (!pkg || pkg.active === false) return false
  const expires = pkg.expiresAt ?? pkg.expires
  if (typeof expires === 'number' && Number.isFinite(expires) && expires > 0) return false
  if (typeof expires === 'string' && expires.trim() && Number.isFinite(Date.parse(expires))) return false
  const name = String(pkg.name || pkg.label || '').trim()
  if (/每日|赠送|活动|签到|会员|套餐|月度|周|日额度|体验|福利|新手|邀请|资源包|daily|gift|trial|member|monthly|weekly/i.test(name)) return false
  if (/永久|充值|购买|预付|星火|基础积分|按需积分|加购|permanent|prepaid|top[\s-]?up|buy/i.test(name)) return true
  const raccoon = typeof isRaccoonFamily === 'function' ? isRaccoonFamily(providerId) : (providerId === 'raccoon' || providerId === 'raccoon-pro')
  if (raccoon && name === '奖励积分') return true
  return false
}

export function workbuddyAccountCredits(windows) {
  const list = Array.isArray(windows) ? windows : []
  const creditWindows = list.filter(win => win && (!win.unit || /^credits?$/i.test(win.unit)) && windowRemainingAmount(win) !== null)
  if (!creditWindows.length) return null
  const totalWin = creditWindows.find(win => /^(?:Total credits|总 Credits)$/i.test(win.name))
  const creditsWin = creditWindows.find(win => /^Credits$/i.test(win.name))
  const extraWin = creditWindows.find(win => /^Extra credits$/i.test(win.name))
  const prepaidWin = creditWindows.find(win => /^Prepaid credits$/i.test(win.name))
  let selected
  if (totalWin) {
    selected = [totalWin, ...(prepaidWin && prepaidWin !== totalWin ? [prepaidWin] : [])]
  } else if (creditsWin) {
    selected = [
      creditsWin,
      ...(prepaidWin && prepaidWin !== creditsWin ? [prepaidWin] : []),
      ...creditWindows.filter(win => win !== creditsWin && win !== prepaidWin && !win.aside),
    ]
  } else {
    const primary = creditWindows.filter(win => !win.aside)
    selected = primary.length ? primary : creditWindows
  }
  const amount = Math.round(selected.reduce((sum, win) => sum + windowRemainingAmount(win), 0) * 100) / 100
  const rawUnit = selected.find(win => win.unit)?.unit || creditWindows.find(win => win.unit)?.unit || 'credits'
  const unit = displayCreditUnit(rawUnit) || '积分'
  const nonAsideFracs = creditWindows.filter(win => !win.aside && win.limit > 0)
    .map(win => Math.min(1, Math.max(0, windowRemainingAmount(win) / win.limit)))
  const allFracs = nonAsideFracs.length ? nonAsideFracs : creditWindows.filter(win => win.limit > 0)
    .map(win => Math.min(1, Math.max(0, windowRemainingAmount(win) / win.limit)))
  const fraction = allFracs.length ? Math.min(...allFracs) : null
  const subWindows = prepaidWin
    ? (totalWin && creditsWin && extraWin ? [creditsWin, extraWin, prepaidWin]
      : [totalWin ?? creditsWin, extraWin && !totalWin ? extraWin : null, prepaidWin].filter((w, i, arr) => w && arr.indexOf(w) === i))
    : []
  const packages = subWindows.length > 1
    ? subWindows.map(win => ({
      name: win.name,
      remaining: windowRemainingAmount(win),
      unit,
      expiresAt: win.expiresAt || win.runsOutAt || (win === prepaidWin ? '' : win.resetsAt) || '',
      active: true,
    }))
    : []
  return { amount, unit, fraction, packages }
}

export function summarizePoolCredits(rows, providerId) {
  const validRows = Array.isArray(rows) ? rows : []
  let total = 0, knownCount = 0, temporary = 0, permanent = 0, packageCount = 0
  let unit = '积分'
  for (const row of validRows) {
    if (row?.unit) unit = row.unit
    const rowAmount = typeof row?.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null
    if (rowAmount !== null) {
      total += rowAmount
      knownCount += 1
    }
    const pkgs = Array.isArray(row?.packages) ? row.packages : []
    let rowPkgSum = 0, rowHasPkg = false
    for (const pkg of pkgs) {
      if (!pkg || pkg.active === false) continue
      const rem = typeof pkg.remaining === 'number' && Number.isFinite(pkg.remaining)
        ? pkg.remaining
        : (typeof pkg.balance === 'number' && Number.isFinite(pkg.balance) ? pkg.balance : null)
      if (rem === null || rem < 0) continue
      rowHasPkg = true
      packageCount += 1
      rowPkgSum += rem
      if (isPermanentCreditPackage(pkg, providerId)) permanent += rem
      else temporary += rem
    }
    if (!rowHasPkg && rowAmount !== null && rowAmount > 0) {
      temporary += rowAmount
    } else if (rowHasPkg && rowAmount !== null && rowAmount > rowPkgSum + 1e-6) {
      permanent += (rowAmount - rowPkgSum)
    }
  }
  const known = knownCount > 0
  const hasPackages = packageCount > 0
  const fmt = value => `${displayNumber(Math.round(value * 100) / 100)}`
  const totalText = `${fmt(total)}${unit ? ` ${unit}` : ''}`
  const splitText = `临时 ${fmt(temporary)} · 永久 ${fmt(permanent)}`
  return {
    known,
    count: validRows.length,
    unit,
    total: Math.round(total * 100) / 100,
    temporary: Math.round(temporary * 100) / 100,
    permanent: Math.round(permanent * 100) / 100,
    hasPackages,
    splitText,
    summary: !known ? '' : hasPackages ? `${totalText}（${splitText}）` : totalText,
  }
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
