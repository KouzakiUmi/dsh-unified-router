// 渠道 wire 契约 —— 账号行与模型行的**唯一字段事实源**。
//
// 方向：
//   原始数据（vendor 适配器 / 各管理器）
//     └─ `accountWire` / `modelWire`  ← 宿主产出的**公开 wire 形状**（白名单字段、缺席不写属性）
//          └─ `accountView` / `modelView` ← 客户端收编的**视图形状**（固定字段、给 UI 的缺省值）
//
// 为什么要有这一层：过去同一份字段在宿主 `publicResult()` 里投影一遍、在客户端
// `core.js` 里再收编一遍，改一个字段要同时改两处（漏一处就是「宿主发了、界面读不到」
// 或「界面显示、宿主没授权」）。现在字段名、上限、白名单只在这里定义。
//
// 纪律（与 subusage 的 wire 口径一致）：
// - **wire 层字段缺席就不写属性**：`undefined` / `NaN` / `-0` 会让宿主 typert 逐值校验
//   整条作废，所以一律条件展开，不写 `x: undefined`。
// - **view 层给缺省值**：界面需要确定的形状（`''` / `null` / `[]`），由本层补齐。
// - 本文件是**纯函数模块**（无 Node 依赖），宿主直接 import，客户端由 `scripts/build.mjs`
//   拼接进 `lib/client.js`。
// - 平台/渠道差异只以**数据字段**表达（`plan` / `rate` / `stale`…），不得在这里写
//   `if (provider === 'xxx')`。

const MAX_TEXT = 160

/** 文本归一：非字符串 → 空串；超长截断。 */
const wireText = (value, max = MAX_TEXT) => typeof value === 'string' ? value.slice(0, max) : ''
/** 数字归一：非有限数 → `null`。 */
const wireFinite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
/** 套餐档位白名单（Raccoon 家族按它分流；缺省不是错误）。 */
const WIRE_PLANS = ['free', 'pro', 'unknown']

/**
 * 账号行 wire 投影（宿主用）。
 *
 * 字段：
 * - `id` / `provider`：身份。
 * - `nickname`：显示名（≤80）。
 * - `enabled`：是否参与选号（缺省 true）。
 * - `expiresAt`：凭据到期毫秒数；`null` 表示未知（**保留属性**，客户端据此区分「未知」与「无过期」）。
 * - `refreshable`：是否有续期端点。
 * - `plan`：套餐档位（白名单枚举，脏值不参与展示与分流）。
 * - `planLabel`：订阅类型文案（TRAE `Free`/`Pro`/…、WorkBuddy `Free plan` 等）。
 *   仅展示用，不参与 Raccoon 家族按套餐分流的 `plan` 枚举。
 * - `modelRateLimits`：模型 → 解禁时刻（只保留有限正数）。
 */
export function accountWire(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const plan = source.plan
  const planLabel = wireText(source.planLabel, 40)
  return {
    id: wireText(source.id, 256),
    provider: wireText(source.provider, 64),
    nickname: wireText(source.nickname, 80),
    enabled: source.enabled !== false,
    expiresAt: wireFinite(source.expiresAt),
    refreshable: source.refreshable === true,
    ...(WIRE_PLANS.includes(plan) ? { plan: wireText(plan, 20) } : {}),
    ...(planLabel ? { planLabel } : {}),
    modelRateLimits: Object.fromEntries(Object.entries(source.modelRateLimits ?? {})
      .filter(([, at]) => Number.isFinite(at) && at > 0)),
  }
}

/**
 * 账号行视图收编（客户端用）。
 *
 * 与 wire 的差别只在**给 UI 的缺省值**：昵称空值补「未命名账号」、套餐空串、
 * 已过期的限流标记不再带出（不显示「受限」）。
 */
export function accountView(wire, provider) {
  const source = wire && typeof wire === 'object' ? wire : {}
  return {
    id: wireText(source.id, 256),
    provider: wireText(provider, 64) || wireText(source.provider, 64),
    nickname: wireText(source.nickname, 80) || '未命名账号',
    enabled: source.enabled !== false,
    expiresAt: wireFinite(source.expiresAt),
    plan: WIRE_PLANS.includes(source.plan) ? source.plan : '',
    planLabel: wireText(source.planLabel, 40),
    modelRateLimits: Object.fromEntries(Object.entries(source.modelRateLimits ?? {})
      .filter(([, at]) => Number.isFinite(at) && at > Date.now())),
  }
}

/**
 * 模型行 wire 投影（宿主用）。
 *
 * ⚠️ 能力字段（`contextWindow` / `maxTokens` / `efforts` / `supportsImage`）**缺席即未知**：
 * 界面据此不给对应控件，不猜模型有什么能力。`stale` / `subscriptionOnly` 同理。
 */
export function modelWire(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const contextWindow = wireFinite(source.contextWindow)
  const maxTokens = wireFinite(source.maxTokens)
  const defaultMaxTokens = wireFinite(source.defaultMaxTokens)
  // ⚠️ 倍率必须先算成值再决定要不要展开：写成
  // `...(source.rate ? { rate: wireRate(source.rate) } : {})` 会在「形状像倍率但
  // 文案不合法」时给出 `{ rate: undefined }` —— 字段存在但值为 undefined，正是
  // 本层要杜绝的那种 wire 违规（宿主 typert 逐值校验会整条作废）。
  const rate = source.rate && typeof source.rate === 'object' ? wireRate(source.rate) : undefined
  return {
    id: wireText(source.id, 256),
    name: wireText(source.name),
    disabled: source.disabled === true,
    dead: source.dead === true,
    isFree: source.isFree === true,
    ...(source.subscriptionOnly === true ? { subscriptionOnly: true } : {}),
    ...(contextWindow !== null && contextWindow > 0 ? { contextWindow } : {}),
    ...(maxTokens !== null && maxTokens > 0 ? { maxTokens } : {}),
    ...(defaultMaxTokens !== null && defaultMaxTokens > 0 ? { defaultMaxTokens } : {}),
    ...(Array.isArray(source.efforts) ? { efforts: source.efforts.filter(x => typeof x === 'string').slice(0, 8) } : {}),
    ...(typeof source.defaultEffort === 'string' && source.defaultEffort ? { defaultEffort: wireText(source.defaultEffort, 20) } : {}),
    ...(typeof source.supportsImage === 'boolean' ? { supportsImage: source.supportsImage } : {}),
    ...(rate ? { rate } : {}),
    ...(source.stale === true ? { stale: true } : {}),
    ...(typeof source.staleReason === 'string' && source.staleReason ? { staleReason: wireText(source.staleReason, 240) } : {}),
  }
}

/**
 * 倍率徽标 wire 投影。
 *
 * 只认「免费」、单倍率或多档倍率区间；区间不携带可比较的单一 multiplier。
 */
export function wireRate(value) {
  const label = value?.label ?? value?.text?.zh
  if (typeof label !== 'string' || label.length > 24) return undefined
  const scalar = /^(?:参考 )?x\d+(?:\.\d+)?$/.test(label)
  const range = /^x(\d+(?:\.\d+)?)–x(\d+(?:\.\d+)?)$/.exec(label)
  if (label !== '免费' && !scalar && !(range && Number(range[1]) < Number(range[2]))) return undefined
  if (!['neutral', 'info', 'success', 'warning'].includes(value?.tone)) return undefined
  const multiplier = wireFinite(value?.multiplier)
  return {
    label,
    tone: value.tone,
    ...(!range && multiplier !== null && multiplier > 0 ? { multiplier } : {}),
  }
}

/**
 * 模型行视图收编（客户端用）。
 *
 * `key` 是「模型在界面状态里的唯一键」（`provider:modelId`）：家族卡两侧 id 可能撞，
 * 启停、参数覆盖、React key、编辑位置都靠它精确定位到某一个 provider 的某一个模型。
 */
export function modelView(wire, provider) {
  const source = wire && typeof wire === 'object' ? wire : {}
  const owner = wireText(provider, 64) || wireText(source.provider, 64)
  const id = wireText(source.id, 256)
  return {
    id,
    provider: owner,
    key: `${owner}:${id}`,
    name: wireText(source.name) || id,
    disabled: source.disabled === true,
    dead: source.dead === true,
    isFree: source.isFree === true,
    subscriptionOnly: source.subscriptionOnly === true,
    contextWindow: wireFinite(source.contextWindow),
    maxTokens: wireFinite(source.maxTokens),
    defaultMaxTokens: wireFinite(source.defaultMaxTokens),
    efforts: Array.isArray(source.efforts) ? source.efforts.filter(x => typeof x === 'string').slice(0, 8) : [],
    defaultEffort: typeof source.defaultEffort === 'string' ? source.defaultEffort : '',
    supportsImage: typeof source.supportsImage === 'boolean' ? source.supportsImage : null,
    stale: source.stale === true,
    staleReason: wireText(source.staleReason, 240),
    rate: viewRate(source.rate),
  }
}

/** 倍率徽标视图收编（幂等：wire 形状再进一次也不变形）。 */
export function viewRate(value) {
  return wireRate(value) ?? null
}

/**
 * 深度净化：去掉 `undefined` / `NaN` / `±Infinity` / `-0` 与非普通对象。
 *
 * 宿主 typert 对返回值逐值校验，任一违规整条作废（subusage 踩过：`resetsAt: undefined`
 * 让工具全量报错）。契约层产出的 wire 已保证不写 `undefined`，这个函数是出口兜底。
 */
export function wireJson(value) {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const out = []
    for (const item of value) {
      const clean = wireJson(item)
      if (clean !== undefined) out.push(clean)
    }
    return out
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const clean = wireJson(item)
      if (clean !== undefined) out[key] = clean
    }
    return out
  }
  return undefined
}
