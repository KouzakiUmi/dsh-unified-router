/**
 * Loomy（讯飞）产品配置。
 *
 * ## 为什么新建 `LoomyProduct` 而不复用既有类型
 *
 * ## 数据来源
 *
 * - base URL / AccessKey / appId：`C:\Program Files\Loomy\resources\.env.prod`
 *   Loomy 官方也只是「随客户端分发 + AES 混淆」，本质同样是公开的。
 * - 兜底模型表：2026-11-18 用本机登录态实测 `GET /api/v1/models` 取得
 *   （10 条中 `type==='chat'` 的 7 条）。
 *
 * ## ⚠️ AccessKey 的定位
 *
 * 它只用于**讯飞账号**端点（`account.xfinfr.com`）的 HMAC-SHA1 签名
 * （短信验证码登录）。业务与推理端点用的是用户登录后的 `session`，
 * 与 AccessKey 无关。故 AccessKey 泄露不涉及任何用户数据。
 */

import { LOOMY_ACCOUNT_BASE, LOOMY_API_BASE } from './loomy.js'

/** 兜底模型目录中的一个条目。 */
export interface LoomyFallbackModel {
  /** 模型 ID（传给 `POST /chat/completions` 的 `model`）。 */
  id: string
  /** **已规范化**的展示名（含倍率，` · x{n}` 分隔）。 */
  name: string
  /** 上下文窗口。 */
  contextWindow: number
  /**
   * 可选思考档位（远端 `reasoning_efforts` 的实测值）。
   *
   * ⚠️ 与远端**同名字段、同一口径**：远端可用时优先用它，兜底表只在远端整体
   * 失败时顶替。实测 6 个全字段 chat 模型全部是
   * `['none','low','medium','high','xhigh']`、默认 `low`（`auto` 不下发，不声明）。
   */
  efforts?: string[]
  /** 远端声明的默认档位（`default_reasoning_effort`）。 */
  defaultEffort?: string
  /** 单次输出上限；仅在渠道已核实时声明。 */
  maxTokens?: number
  /** 默认禁用的备选模型；用户可在设置页手动启用。 */
  stale?: boolean
  /** 默认禁用的具体原因（选型判断，不代表上游不可用）。 */
  staleReason?: string
}

/**
 * Loomy 产品配置。
 */
export interface LoomyProduct {
  /** provider 标识：注册到 `ctx.llm` 的路由名，也是账号列表的 provider 字段值。 */
  id: 'loomy'
  /** 设置页 / 模型选择器展示名。 */
  displayName: string
  /** 业务基址（推理 / 模型列表 / 积分 / 新手任务）。 */
  apiBase: string
  /** 讯飞账号（CAccount）基址。 */
  accountBase: string
  /** 讯飞账号 AccessKeyId（HMAC-SHA1 签名的 `account {ak}:{sig}` 前半）。 */
  accessKeyId: string
  /** 讯飞账号 AccessKeySecret（HMAC-SHA1 的密钥）。 */
  accessKeySecret: string
  /** 讯飞 appId（账号请求体 `base.appid`）。 */
  appId: string
  /** 默认凭据 ref（无账号池时的单凭据回退）。 */
  defaultCredentialRef: string
  /** 远端模型列表不可用时的兜底模型目录（7 个 chat 条目）。 */
  fallbackModels: readonly LoomyFallbackModel[]
}

/**
 * 兜底模型目录（7 条：6 个全字段 chat 模型 + `auto`）。
 *
 * 来源：2026-11-18 用本机登录态实测 `GET {apiBase}/models`
 * （`loomyad.xunfei.cn`）。`data[]` 共 10 条：7 条 `type === 'chat'`（含 `auto`）
 * + 3 条 `type === 'image'`。只收 chat 条目（官方同样不看 `type` 以外字段；
 * chat 条目的 `output_modalities` 均为 `['text']`）。
 * 顺序**照抄远端返回顺序**，不重排 —— 重排会让「与远端对比」这类排查失去可比性。
 *
 * ⚠️ `name` 已按 `loomyDisplayName` 规范化（远端原值是全角/半角括号混用）。
 * ⚠️ `contextWindow` 用远端 `context_length`；`auto` 远端不下发该值 → 0
 * （与远端路径 `parseLoomyRemoteModels` 的归一结果一致，不回填旧估值）。
 * ⚠️ 远端不再下发 `limit`/`modalities` 字段：本表不声明 `maxTokens`
 * （旧表的 393216 已无上游依据）。`spark-x2.6` 倍率已由 x0.0（限时免费）变为
 * x2.5；`mimo-v2.5` 的 context_length 由 1048576 变为 1024000。
 * ⚠️ `auto` 远端不下发 `capabilities`/`reasoning_efforts` → 不声明档位
 * （与远端路径行为一致：缺失即「未提供推理等级」，不编造）。
 */
/**
 * 实测的思考档位（6 个全字段 chat 模型**完全一致**，2026-11-18 用真实凭据采集；
 * `auto` 不下发 `reasoning_efforts`，不在本常量覆盖范围）。
 *
 * ⚠️ 抽成常量而不是逐条重复：远端对全部 chat 模型下发同一份档位，
 * 逐条重复只会让将来上游变更时漏改其中几条。
 * ⚠️ 远端可用时**优先用远端的 `reasoning_efforts`**，本常量只在远端整体失败时
 * 顶替（与 `contextWindow` 同策略）。
 */
export const LOOMY_EFFORTS: readonly string[] = ['low', 'medium', 'high']

/**
 * 本插件选用的默认档位（**用户要求 `high`**）。
 *
 * ⚠️ 远端 `default_reasoning_effort` 声明的是 **`low`**，这里**有意不沿用** ——
 * DSH 的「用户没选时发哪个档」完全取适配器声明的 `defaultEffort`
 * （见 `loomy-adapter.ts` 的 `LOOMY_PREFERRED_DEFAULT_EFFORT` 说明）。
 * 兜底表与适配器常量必须一致，否则「远端可用」与「远端失败」两条路径默认档不同。
 */
const LOOMY_DEFAULT_EFFORT = 'high'

// 目录为 2026-11-18 真拉采样；默认选型依据见根目录 MODEL-CURATION.md。
// 价格只在同渠道内比较，避免把不同渠道的积分倍率当成同一种货币。
const LOOMY_FALLBACK_MODELS: readonly LoomyFallbackModel[] = [
  { id: 'spark-x2.6', name: 'Spark-X2.6 正式版 · x2.5', contextWindow: 1_048_576, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash · x2.0', contextWindow: 1_048_576, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'deepseek-v4-flash-1017', name: 'DeepSeek V4.1 Flash 1017 · x2.0', contextWindow: 1_048_576, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'GLM-5.3-Flash', name: 'GLM 5.3 Flash · x0.8', contextWindow: 1_048_576, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'qwen3.8-flash', name: 'qwen 3.8 flash · x0.8', contextWindow: 1_000_000, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'mimo-v2.5', name: 'MiMo V2.5 · x3.3', contextWindow: 1_024_000, efforts: [...LOOMY_EFFORTS], defaultEffort: LOOMY_DEFAULT_EFFORT },
  { id: 'auto', name: '自动 · 均衡', contextWindow: 0 },
]

/**
 * Loomy provider 配置。
 */
export const LOOMY: LoomyProduct = {
  id: 'loomy',
  displayName: 'Loomy (讯飞)',
  apiBase: LOOMY_API_BASE,
  accountBase: LOOMY_ACCOUNT_BASE,
  // 取自 `.env.prod`（VITE_XFYUN_ACCESS_KEY_ID / _SECRET / _APP_ID）。
  accessKeyId: '2thryby66wxi53sk',
  accessKeySecret: 'zsak6eadrbawz683wf5r3m2snrwj868r',
  appId: 'GM3LOOMY',
  defaultCredentialRef: 'LOOMY_ACCESS_TOKEN',
  fallbackModels: LOOMY_FALLBACK_MODELS,
}

/** 全部 Loomy 产品配置（当前只有一个，保留数组以便将来扩展）。 */
export const ALL_LOOMY_PRODUCTS: readonly LoomyProduct[] = [LOOMY]

/**
 * 按 provider id 取 Loomy 产品配置；未知 id 返回 undefined。
 */
export function loomyProductById(id: string): LoomyProduct | undefined {
  return ALL_LOOMY_PRODUCTS.find((product) => product.id === id)
}
