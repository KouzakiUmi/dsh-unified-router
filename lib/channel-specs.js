// 渠道规格表 —— **渠道清单的唯一事实源**。
//
// 为什么是「纯数据模块」：宿主（lib/rpc.js、lib/settings-providers.js、lib/web-host.js）
// 与客户端（构建期拼接进 lib/client.js）必须消费同一份清单。任何 Node API 都会让客户端
// 拼不进去，因此本文件只允许字面量、`Object.freeze` 与纯函数。
//
// 接入纪律（见 docs/CHANNEL-ARCHITECTURE.md）：
// - 新增渠道 = 这里加一条 + `channels/<id>.js` 实现 + 客户端 `providers/<id>.js` 视图。
// - 移除渠道 = 删上面那三处；**中心分派文件不需要改**。
// - 方法集合按 `kind` 归类：同一类别内第二个渠道不复制方法名，也不新增位置形参。
//
// 能力位（`capabilities`）是**声明**，不是分支依据：共享层只读声明，不得写
// `provider === '<某个渠道>'`。单渠道专属能力放 `methods.extra`，并在该渠道实现里处理。

/** 渠道接入范式。决定共用哪一套实现、哪一组 RPC 方法。 */
export const CHANNEL_KINDS = Object.freeze(['pack', 'managed', 'apikey', 'plan', 'workbuddy'])

/**
 * 每类渠道共用的 RPC 方法集。
 *
 * ⚠️ 这里只放**类别级**方法。单渠道专属的端点（如 `raccoon.checkin`）写在规格的
 * `methods.extra` 里，否则同类别新增渠道会被迫声明自己不需要的端点。
 */
export const KIND_METHODS = Object.freeze({
  /** 账号池渠道（vendor channel-pack）：多账号轮换 + 目录 + 额度 + 签到 + 新手奖励。 */
  pack: Object.freeze({
    read: Object.freeze([
      'provider.status', 'account.list', 'model.list', 'model.params',
      'credits.balances', 'credits.status', 'onboarding.status',
    ]),
    write: Object.freeze([
      'provider.setEnabled', 'account.create', 'account.update', 'account.delete',
      'account.reorder', 'account.refresh', 'account.retest', 'account.reset', 'login.poll',
      'model.refresh', 'model.setDisabled', 'model.clearDead', 'model.setAllDisabled',
      'model.resetDefaults', 'model.setParams', 'credits.claimAll', 'onboarding.claim',
    ]),
  }),
  /** 自管多账号渠道（本插件 multi-account 框架）。 */
  managed: Object.freeze({
    read: Object.freeze(['managed.snapshot', 'managed.models']),
    write: Object.freeze([
      'managed.refreshModels', 'managed.login', 'managed.importLocal', 'managed.importCredential',
      'managed.updateAccount', 'managed.logout', 'managed.setEnabled',
      'managed.checkin', 'managed.claimRewards', 'managed.completeTasks',
      'managed.setModelEnabled', 'managed.setModelParams', 'managed.resetModels',
    ]),
  }),
  /** API Key 渠道（单 Key + 目录 + 额度 + 可选的工具/控制台会话）。 */
  apikey: Object.freeze({
    read: Object.freeze(['apikey.snapshot']),
    write: Object.freeze([
      'apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams',
      'apikey.resetModels', 'apikey.setToolsEnabled', 'apikey.setConsoleSession',
      'apikey.consoleLogin', 'apikey.clearConsoleSession',
    ]),
  }),
  /** 单 Key 订阅渠道（商汤 Token Plan 控制器）。 */
  plan: Object.freeze({
    read: Object.freeze(['plan.snapshot']),
    write: Object.freeze([
      'plan.setKey', 'plan.setEnabled', 'plan.setModelEnabled', 'plan.setModelParams',
      'plan.resetModels', 'plan.consoleLogin',
    ]),
  }),
  /** 自管单渠道路由（WorkBuddy）。 */
  workbuddy: Object.freeze({
    read: Object.freeze(['workbuddy.snapshot', 'workbuddy.models']),
    write: Object.freeze([
      'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.setAccountEnabled',
      'workbuddy.setModelEnabled', 'workbuddy.setModelParams', 'workbuddy.resetModels',
    ]),
  }),
})

/** 与渠道无关的全局方法（设置快照、自动化调度）。 */
export const GLOBAL_METHODS = Object.freeze([
  'settings.snapshot', 'settings.refresh',
  'automation.status', 'automation.setConfig', 'automation.run', 'automation.query',
])

/**
 * 渠道规格。
 *
 * 字段：
 * - `id` / `title`：provider id 与状态行标题。
 * - `kind`：接入范式，决定共用实现与方法集（见 {@link KIND_METHODS}）。
 * - `card`：是否作为设置页渠道卡片（`false` = 只作为某张卡片的模型面存在）。
 * - `registered`：实现是否已注册（`false` = 停用：RPC 白名单、快照、签到与客户端卡片都不装配）。
 * - `claim`：是否参与签到/领取调度（同一账号池只允许一个代表 id）。
 * - `accountPool`：是否拥有独立账号池（`false` = 复用家族账号池）。
 * - `family`：同一张卡片下的多个模型面（Raccoon 族）。
 * - `capabilities`：能力声明，供界面与自动化读取。
 * - `methods.extra`：该渠道专属的额外方法。
 */
export const CHANNEL_SPECS = Object.freeze([
  // Raccoon 家族：同一上游账号体系拆成免费版 / 订阅版两个 provider（两侧各自用本侧
  // 账号凭据拉上游目录，不做倍率过滤；账号只有一个池）。签到是**账号级**事项，
  // 只有代表账号池的 `raccoon` 置 claim —— `raccoon-pro` 再跑一次会重复调度同一账号。
  Object.freeze({
    id: 'raccoon',
    title: 'Raccoon 免费版',
    kind: 'pack',
    card: true,
    claim: true,
    accountPool: true,
    // vendor `registerChannelPackRpc` 里承接 Raccoon 家族 auth 的形参位（见 lib/pack-slots.js）。
    packSlot: 'raccoon',
    family: Object.freeze([
      Object.freeze({ id: 'raccoon', title: '免费模型' }),
      Object.freeze({ id: 'raccoon-pro', title: '订阅模型' }),
    ]),
    capabilities: Object.freeze({
      accounts: true, models: true, quota: true, planTag: true, unifiedModels: true,
      checkin: 'dedicated', onboarding: 'claim',
    }),
    methods: Object.freeze({
      extra: Object.freeze(['raccoon.checkin']),
    }),
  }),
  Object.freeze({
    id: 'raccoon-pro',
    title: 'Raccoon 订阅版',
    kind: 'pack',
    card: false,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: false }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'qodercn',
    title: 'Qoder 中国版',
    kind: 'pack',
    card: true,
    claim: true,
    accountPool: true,
    packSlot: 'qoderCn',
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: 'credits', onboarding: false }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'trae',
    title: 'TRAE',
    kind: 'pack',
    card: true,
    claim: true,
    accountPool: true,
    packSlot: 'trae',
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: 'credits', onboarding: false }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'sensenova-token-plan',
    title: '商汤 Token Plan',
    kind: 'plan',
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'workbuddy',
    title: 'WorkBuddy',
    kind: 'workbuddy',
    card: true,
    claim: true,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: 'dedicated' }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'agnes',
    title: 'Agnes',
    kind: 'apikey',
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'unisound',
    title: '云知声',
    kind: 'apikey',
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true, consoleSession: true }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'qianfan',
    title: '千帆 Token Plan',
    kind: 'apikey',
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, consoleSession: true }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'bailian',
    title: '阿里云百炼',
    kind: 'apikey',
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, consoleSession: true }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'astudio',
    title: 'AStudio',
    kind: 'managed',
    // 停用：上游无法回报正确积分（用尽后仍显示满值，用户以为有额度却调不动）。
    // 实现与契约保留在 lib/managed-providers/astudio.js，恢复时把 registered 与 card
    // 一起改回 true，并在 lib/managed-providers/index.js 的注册表里加回来。
    card: false,
    registered: false,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: 'credits', onboarding: false }),
    methods: Object.freeze({}),
  }),
  Object.freeze({
    id: 'codearts',
    title: 'CodeArts',
    kind: 'managed',
    card: true,
    claim: true,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: 'credits', onboarding: false }),
    methods: Object.freeze({}),
  }),
])

/** 按 id 取规格；未知渠道返回 `null`（调用方自行拒绝，不猜）。 */
export function channelSpec(id) {
  return CHANNEL_SPECS.find(spec => spec.id === id) ?? null
}

/** 某类别共用的读方法 + 写方法（未知类别返回空表，不抛错）。 */
export function methodsOfKind(kind) {
  return KIND_METHODS[kind] ?? { read: [], write: [] }
}

/** 某渠道的全部读方法（类别级 + 渠道专属）。 */
export function readMethodsOf(spec) {
  const base = methodsOfKind(spec?.kind).read
  return [...base, ...(spec?.methods?.extra ?? [])]
}

/** 某渠道的全部可写方法。 */
export function writeMethodsOf(spec) {
  const base = methodsOfKind(spec?.kind).write
  return [...base, ...(spec?.methods?.write ?? [])]
}

/** 全部渠道方法（读 + 写 + 渠道专属 + 全局）。宿主与客户端各建一份 Set 比对。 */
export function allChannelMethods() {
  const methods = new Set(GLOBAL_METHODS)
  for (const spec of CHANNEL_SPECS) {
    for (const method of readMethodsOf(spec)) methods.add(method)
    for (const method of writeMethodsOf(spec)) methods.add(method)
  }
  return methods
}

/**
 * **只在宿主内部使用**的渠道方法：客户端从不调用，因此不在它的白名单里。
 *
 * - `credits.status` / `onboarding.status`：签到与奖励调度的**只读核实端点**，
 *   由 `settings-providers.js` 的 checkin / task 适配器独占（回答「这个号今天
 *   签过没 / 领过没」），界面没有任何入口需要直连；
 * - `raccoon.checkin`：小浣熊的**每日签到执行端点**，由宿主 `daily-checkin`
 *   调度器按日调用；客户端只从 `checkin.status` 快照读结果、渲染「已签到」标签。
 *
 * 客户端白名单比宿主窄这一档，是「界面只能调它真的需要的方法」这条安全属性的
 * 基础 —— 不要为了「一张表更短」而把它们放给客户端。
 */
export const HOST_INTERNAL_METHODS = Object.freeze(['credits.status', 'onboarding.status', 'raccoon.checkin'])

/**
 * 客户端可调用的方法集（按类别派生，**不再由 `core.js` 手写第二份**）。
 *
 * 为什么要有它：`src/client/core.js` 过去手写了 `PLAN_METHODS` /
 * `WORKBUDDY_METHODS` / `APIKEY_METHODS` / `MANAGED_METHODS` /
 * `AUTOMATION_METHODS` / `METHODS` 六张表，与宿主这份并行维护。加一个渠道或
 * 改一个端点名，漏改客户端那张表的后果是「按钮点了报『不支持此操作』」，
 * 而漏改宿主那张表的后果是「界面能点但后端拒绝」—— 同一处事实被抄成两份。
 *
 * 返回的是**新 Set**（调用方各自持有；本函数每次调用都重建，不共享可变状态）。
 */
export function clientMethodSets() {
  const omit = new Set(HOST_INTERNAL_METHODS)
  const kindSet = kind => new Set(
    [...methodsOfKind(kind).read, ...methodsOfKind(kind).write].filter(method => !omit.has(method)),
  )
  const pack = kindSet('pack')
  const plan = kindSet('plan')
  return {
    plan,
    workbuddy: kindSet('workbuddy'),
    apikey: kindSet('apikey'),
    managed: kindSet('managed'),
    automation: new Set(GLOBAL_METHODS.filter(method => method.startsWith('automation.'))),
    /** 渠道池主路径 + 全局方法 + 单 Key 订阅：与历史手写表逐项一致（回归锁死）。 */
    all: new Set([...pack, ...GLOBAL_METHODS, ...plan]),
  }
}

/**
 * **已退役的渠道**：实现与规格都已删除，但用户磁盘上可能还留着它们的账号、
 * 黑名单、目录缓存与账本目录。
 *
 * 宿主在独立模式下启动时会把这张表交给 `lib/retired-channels.js` 清理一次
 *（幂等）。加到这里而不是零散写在清扫逻辑里，是为了「移除一个渠道」仍然只有
 * 一处需要记得改 —— 删规格的同时往这里追加一行即可。
 *
 * ⚠️ 共用模式不清理：那时 `channel-pack` 状态由**原插件**拥有，它可能仍然支持
 * 这些渠道，删它的账号等于破坏别人的数据。
 */
export const RETIRED_CHANNEL_IDS = Object.freeze(['loomy'])


/**
 * **写后失效规则**：某个写方法成功后，宿主应当重新采集哪些资源。
 *
 * 为什么做成数据表：过去这张清单是一串 `if (method.startsWith('account.'))` 分支，
 * 新增一个写方法时忘记同步的后果是「界面显示的还是旧状态，用户以为没生效」——
 * 不报错、不掉数据，只是静默不刷新，最难被发现。做成表以后，新增写方法必须显式
 * 登记，`test/channel-method-parity.test.mjs` 会核对「每个写方法都有归属」。
 *
 * 只声明**通用**规则（账号池的账号 / 模型 / 额度）。各类别的乐观补丁（把结果直接
 * 打在投影形状上）仍由 `lib/settings-providers.js` 的类别分支负责 —— 那是业务逻辑，
 * 不适合塞进数据表。
 *
 * 字段：
 * - `id`：规则名（诊断与用例用）。
 * - `methods`：触发该规则的方法。
 * - `resources`：需要重新采集的资源键（`provider` 取自 `payload.provider`）。
 * - `whenSuccess`：`true` 表示该方法只有成功时才算写操作（`login.poll` 本身是轮询读）。
 */
export const INVALIDATE_RULES = Object.freeze([
  Object.freeze({ id: 'channel-toggle', methods: Object.freeze(['provider.setEnabled']), resources: Object.freeze(['provider.status']) }),
  Object.freeze({ id: 'model-params', methods: Object.freeze(['model.setParams']), resources: Object.freeze(['model.params']) }),
  Object.freeze({
    id: 'model-catalog',
    methods: Object.freeze(['model.refresh', 'model.setDisabled', 'model.clearDead', 'model.setAllDisabled', 'model.resetDefaults']),
    resources: Object.freeze(['provider.status', 'model.list']),
  }),
  Object.freeze({
    id: 'account-change',
    methods: Object.freeze(['account.create', 'account.update', 'account.delete', 'account.reorder', 'account.refresh', 'account.retest', 'account.reset']),
    resources: Object.freeze(['provider.status', 'account.list', 'credits.balances']),
  }),
  Object.freeze({
    id: 'login-success',
    methods: Object.freeze(['login.poll']),
    resources: Object.freeze(['provider.status', 'account.list', 'credits.balances']),
    whenSuccess: true,
  }),
  // 领取与签到都会改积分余额：`onboarding.claim` 是一次性登录奖励，
  // `raccoon.checkin` 是每日签到（宿主调度专用），三者共用同一条规则。
  Object.freeze({
    id: 'credits-change',
    methods: Object.freeze(['credits.claimAll', 'onboarding.claim', 'raccoon.checkin']),
    resources: Object.freeze(['credits.balances']),
  }),
])

/** 某方法命中的失效规则；没有规则返回 `null`（调用方不得猜要刷新什么）。 */
export function invalidationRule(method) {
  return INVALIDATE_RULES.find(rule => rule.methods.includes(method)) ?? null
}
