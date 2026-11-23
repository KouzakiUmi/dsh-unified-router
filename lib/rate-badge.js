// 独立价签模块：把「当前生效扣费倍率 / 免费」翻译成 DSH 核心原生 `LlmModelInfo.badge`。
//
// ## 覆盖范围
//
// 仓库里有两个渲染面，但只有一份「倍率语义」：
//   1. 会话模型名旁：核心 `buildModelCatalog` 读适配器 `listModels()` 的 `badge`，
//      由 `dsh-client-ui-model-selection` 原生渲染（下拉行在名后、收起态在名前）；
//   2. 设置页模型列表：各渠道快照 / RPC 的 `rate` 字段 → 客户端 `providers/*.js` 的标签。
//
// channel-pack 四渠道（Loomy / Raccoon / Qoder CN / TRAE）已有
// `vendor/channel-pack/src/model-rate-badge.ts` 的 TS 实现。本文件是 **lib 侧**
// （WorkBuddy、四个自管多账号渠道、API Key 渠道）的等价实现：同样的阈值与文案，
// 避免每条 provider 通路各写一套格式化规则。
//
// ## 为什么需要 `withListedRateBadges`
//
// 自管渠道都经 `vendor/sensenova-token-plan/llm-adapter-core.js` 的
// `assemblePiAiAdapter` 装配成 `PiAiAdapter`。已核验（本机 DSH 0.2.2-rc.3 的
// `node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`）：它的 `listModels()`
// 只回 `provider / id / name / inputModalities` 四个字段 —— **模型描述符上的
// `badge` 会在这一步被丢掉**。所以描述符里挂 badge 只对「未来 vendor 透传」有效，
// 真正到会话选择器之前必须在 adapter 外面再补一次。
//
// ## 为什么 `resolveModel` 不补
//
// DSH 核心 `LlmModelInfo.badge` 的注释写明：「Selector label advertised by catalog
// discovery; exact-route resolution omits it, and no model request or Session event
// carries it.」核心 `normalizeModelInfo()` 也只在 `listModels()` 的归一化里复制
// badge。价格只属于选择列表语境，故包装层只重写 `listModels`。

/** 徽标文案：`en` 必填（wire 侧 schema 的硬要求），纯数字/「免费」中英文同形。 */
export function rateBadgeText(zh, en = zh) {
  return { en, zh }
}

/** 倍率格式化：两位小数（徽标宽度有限，且要可比较）。 */
export function formatRate(value) {
  return `x${value.toFixed(2)}`
}

/**
 * 把「当前生效倍率」转成模型选择器徽标（与 channel-pack TS 版同规则）。
 *
 * | 输入 | 输出 |
 * |---|---|
 * | `undefined` / `NaN` / 非有限 / 负数 | `undefined`（**未知不给徽标**，不谎报免费） |
 * | `0` 或 `status === 'limited_free'` | `免费`（en `Free`），tone `success` |
 * | `status === 'discount'` 且 `baseMultiplier > multiplier` | `x{生效价}`，tone `info` |
 * | `promoted`（渠道自报优惠、但没给原价） | `x{生效价}`，tone `info` |
 * | 其余 `> 0` | `x{生效价}`，tone `neutral` |
 *
 * `promoted` 只借 tone 表达「渠道说这是优惠价」，**文案仍是被展示的倍率本身**：
 * 拿不到原价时不编造折扣数字，也不把倍率改写成别的值。
 *
 * `reference: true` 用于兜底/策展表里的倍率（不是按本账号实测的价），文案带
 * 「参考 / Ref.」前缀，来源与实测倍率区分开。
 */
export function modelRateBadge(multiplier, options = {}) {
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0) return undefined
  const status = options.status ?? 'normal'
  if (multiplier === 0 || status === 'limited_free') {
    return { text: rateBadgeText('免费', 'Free'), tone: 'success' }
  }
  const base = options.baseMultiplier
  const discounted = status === 'discount'
    && typeof base === 'number'
    && Number.isFinite(base)
    && base > multiplier
  const text = formatRate(multiplier)
  return {
    text: options.reference ? rateBadgeText(`参考 ${text}`, `Ref. ${text}`) : rateBadgeText(text),
    tone: discounted || options.promoted === true ? 'info' : 'neutral',
  }
}

/**
 * 自管渠道目录行 → 徽标。
 *
 * 行字段（各渠道解析器已归一，见 `lib/managed-providers/*.js`）：
 * - `free`：渠道明说这个模型不消耗额度（点倍率 0、上游免费标记、文案「免费」）；
 * - `rate`：当前生效倍率；`rateWas`：促销前倍率（仅促销时为上游给出）；
 * - `rateLabel` / `rateTone`：上游自带的展示文案与语气；
 *   文案本身只当「免费」证据使用，其余一律按 `rate` 数值重新格式化，避免上游文案
 *   与倍率数字互相矛盾。
 *
 * ⚠️ `rate === 0` 与 `free === false` 同时出现时**不挂**：WorkBuddy 在无法读出
 * 倍率时用 `rate: 0` 兜底并显式写 `free: false`，把它当免费是谎报。
 */
export function rateBadgeFromRow(row) {
  if (!row || typeof row !== 'object') return undefined
  const label = typeof row.rateLabel === 'string' ? row.rateLabel : ''
  if (row.free === true || label === '免费') return modelRateBadge(0)
  const rate = row.rate
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) return undefined
  if (rate === 0 && row.free === false) return undefined
  const was = typeof row.rateWas === 'number' && Number.isFinite(row.rateWas) ? row.rateWas : undefined
  const discounted = was !== undefined && was > rate
  return modelRateBadge(rate, {
    status: discounted ? 'discount' : 'normal',
    baseMultiplier: was,
    promoted: !discounted && row.rateTone === 'info',
  })
}

/** 目录行 → `id → 徽标` 索引（没有可用证据的模型不进索引）。 */
export function rateBadgeIndex(rows) {
  const index = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.id !== 'string' || !row.id) continue
    const badge = rateBadgeFromRow(row)
    if (badge !== undefined) index.set(row.id, badge)
  }
  return index
}

/**
 * 给适配器的 `listModels()` 补徽标（`resolveModel()` 一律不动）。
 *
 * `badgeOf(id)` 返回 `undefined` 时不挂字段 —— 未知模型保持未知，不给「免费」。
 * 已有 `badge` 的行不覆盖：底层将来透传自己的徽标时，那个值才是权威。
 */
export function withListedRateBadges(adapter, badgeOf) {
  if (!adapter || typeof adapter.listModels !== 'function' || typeof badgeOf !== 'function') return adapter
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === 'listModels') {
        return async function listModels(provider) {
          const models = await target.listModels(provider)
          if (!Array.isArray(models)) return models
          return models.map(model => {
            if (!model || typeof model.id !== 'string' || model.badge !== undefined) return model
            const badge = badgeOf(model.id)
            return badge === undefined ? model : { ...model, badge }
          })
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' && prop !== 'constructor' ? value.bind(target) : value
    },
  })
}
