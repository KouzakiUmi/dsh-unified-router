/**
 * 模型选择器徽标：**当前价格倍率**。
 *
 * ## 为什么用 DSH 核心原生字段，而不是自绘 UI
 *
 * DSH 0.2.2+ 的 `LlmModelInfo` 带可选 `badge`（`LlmModelBadge`），
 * `dsh-client-ui-model-selection` 的 ModelSelect **原生**把它渲染成模型名旁的
 * 彩色 `Tag`（下拉行渲染在名字**后面**，收起态渲染在名字**前面**），
 * 文案按 `LocalizedText` 本地化。适配器只要在 `listModels()` 里挂上该字段即可，
 * 不碰设置页、不碰 RPC 契约、不改任何客户端代码。
 *
 * 已核验（2026-11，本机 DSH 0.2.2-rc.3 安装的 `app.asar`）：
 * - `@deepseek-ai/dsh-llm/src/types.ts`：`LlmModelInfo.badge?: LlmModelBadge`，
 *   `LlmModelBadge = { text: LocalizedText; tone: 'neutral'|'info'|'success'|'warning' }`；
 * - `@deepseek-ai/dsh-llm/lib/index.js`：核心在 `listModels()` 归一化时**原样透传**
 *   `badge`（`...(badge === void 0 ? {} : { badge: { text, tone } })`）；
 * - `@deepseek-ai/dsh-api-session-controller`：模型目录投影同样透传 `badge`；
 * - `@deepseek-ai/dsh-api-remotes`：wire 侧 zod schema 校验 `badge.text` 为
 *   `string | { en: string } & Record<string, string>`（**`en` 必填**，缺了校验不过、
 *   徽标整条消失）、`tone` 为四值枚举；
 * - `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js`：真正渲染
 *   `Tag({ tone, children: resolveText(badge.text) })`。
 *
 * ## 为什么本地声明接口而不 import 核心类型
 *
 * 本包对 `@deepseek-ai/dsh-llm` 的 peer 范围低至 0.2.1-rc.2，那版没有 `badge`。
 * 直接 import 会把编译期依赖压到新核心上；而 `badge` 是**附加字段**，老核心
 * 直接忽略它（`listModels()` 的返回值里多一个键不报错）。故与参考插件同款做法：
 * 本地声明最小结构 + spread 写入，新旧核心都不报错。
 */

/** 徽标强调程度（与核心 `LlmModelBadgeTone` 同值）。 */
export type ModelRateBadgeTone = 'neutral' | 'info' | 'success' | 'warning'

/**
 * 徽标文案：**本地化表**，`en` 必填（wire 侧 schema 的硬要求）。
 *
 * 纯数字（`x0.75`）的中英文同形，仍然给表 —— 省掉两条分支，也让未来换文案
 * （如「限免」）只改一处。
 */
export interface ModelRateBadgeText {
  readonly en: string
  readonly zh: string
}

/** 与核心 `LlmModelBadge` 结构等价的最小声明。 */
export interface ModelRateBadge {
  text: ModelRateBadgeText
  tone: ModelRateBadgeTone
}

/**
 * 促销状态（各渠道的「上游促销语义」统一归到这里）。
 *
 * - `normal`：常规价；
 * - `discount`：**正在打折**（配 `baseMultiplier` 给出原价，用于判定是否真的降了）；
 * - `limited_free`：限时免费（上游明确说「免费」，即便 `multiplier > 0`）。
 */
export type ModelRatePromotionStatus = 'normal' | 'discount' | 'limited_free'

/** {@link modelRateBadge} 的附加信息。 */
export interface ModelRateBadgeOptions {
  /** 促销状态；缺省按 `normal`（纯倍率）。 */
  status?: ModelRatePromotionStatus
  /** 促销前原价倍率（仅 `status === 'discount'` 时有意义）。 */
  baseMultiplier?: number
  /** Reference multiplier published by the provider, without account-specific pricing. */
  reference?: boolean
}

/** 倍率格式化：两位小数（徽标宽度有限，且要可比较）。 */
function formatRate(value: number): string {
  return `x${value.toFixed(2)}`
}

/**
 * 把「当前生效倍率」转成模型选择器徽标。
 *
 * 规则（全渠道一致，四个渠道共用本函数）：
 *
 * | 输入 | 输出 |
 * |---|---|
 * | `undefined` / `NaN` / 非有限 / 负数 | `undefined`（**未知不给徽标**，不谎报免费） |
 * | `0` 或 `status === 'limited_free'` | `免费`（en `Free`），tone `success` |
 * | `status === 'discount'` 且 `baseMultiplier > multiplier` | `x{生效价}`，tone `info` |
 * | 其余 `> 0` | `x{生效价}`，tone `neutral` |
 *
 * ⚠️ **`0` 与 `undefined` 是两个结论**：`0` 是「这个模型对本账号免费」，
 * `undefined` 是「上游没下发倍率」。把后者当 0 会给未知模型挂上「免费」——
 * 那是谎报（与 `raccoonDisplayName` 的同款取舍一致）。
 *
 * ⚠️ 名字里已有倍率文本（`GLM-5-3 · x0.75`）时**保留**：徽标是附加信息，
 * 不属于本次改动要去重的范围（去重会让既有展示与测试一起变）。
 */
export function modelRateBadge(
  multiplier: number | undefined,
  options: ModelRateBadgeOptions = {},
): ModelRateBadge | undefined {
  // 未知 / 非法一律不给徽标（见上表：不谎报免费）。
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0) return undefined

  const status = options.status ?? 'normal'
  if (multiplier === 0 || status === 'limited_free') {
    return { text: { en: 'Free', zh: '免费' }, tone: 'success' }
  }

  // 促销：只有在**原价确实更高**时才是「打折」，否则按常规价（不伪造折扣）。
  const base = options.baseMultiplier
  const discounted = status === 'discount'
    && typeof base === 'number'
    && Number.isFinite(base)
    && base > multiplier

  const text = formatRate(multiplier)
  return {
    text: options.reference ? { en: `Ref. ${text}`, zh: `参考 ${text}` } : { en: text, zh: text },
    tone: discounted ? 'info' : 'neutral',
  }
}
