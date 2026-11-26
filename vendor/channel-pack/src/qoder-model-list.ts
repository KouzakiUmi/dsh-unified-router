/**
 * Qoder 模型目录：**直连上游目录接口**（`GET /algo/api/v2/model/list`）。
 *
 * ## 为什么不再用 `--list-models`
 *
 * CLI 的纯文本表只给「显示名」或「显示名 (key)」，**对部分条目只给显示名**，
 * 而且这些显示名不是可调用 id：
 *
 * | 显示名 | CLI 输出 | 真实 key |
 * |---|---|---|
 * | Qwen4-Max | `Qwen4-Max` | `qmodel_latest` |
 * | GLM-5.4 | `GLM-5.4` | `gmodel_latest` |
 * | Step-5-Preview | `Step-5-Preview` | `jmodel` |
 *
 * 拿显示名当 `model` 发请求时服务端**回落默认模型**，一帧 `reasoning_content`
 * 都不返回（用户报障「Qoder 思考设置无效」）。目录接口还额外给出
 * `price_factor` / `thinking_config.enabled.efforts` / `max_input_tokens`，
 * 这些正是档位选择器与倍率徽标需要的证据，过去只能靠手抄。
 *
 * 签名见 `qoder-cosy.ts`（移植自 MIT 许可的公开实现）。
 *
 * @module dsh-unified-router/qoder-model-list
 */
import type { QoderFallbackModel } from './qoder-product.js'

/**
 * 目录接口路径。
 *
 * ⚠️ 带上 `Encode=1`：与客户端一致（实测两者返回同一份明文 JSON，但照官方
 * 用法走，避免上游日后按 `Encode` 切换编码）。
 */
export const QODER_MODEL_LIST_PATH = '/algo/api/v2/model/list?Encode=1'
/**
 * 取哪一组：按客户端优先级 `assistant` → `developer` → `chat` 取第一个非空组。
 * 三组内容基本一致，但某组可能缺条目（如 `developer` 没有 `jmodel`）。
 */
const QODER_MODEL_GROUPS = ['assistant', 'developer', 'chat'] as const

/** 目录里一行的形状（只声明用到的字段）。 */
interface QoderModelListRow {
  key?: unknown
  display_name?: unknown
  enable?: unknown
  price_factor?: unknown
  is_vl?: unknown
  is_reasoning?: unknown
  max_input_tokens?: unknown
  thinking_config?: {
    enabled?: { efforts?: Record<string, { is_default?: unknown }> }
    disabled?: unknown
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256

/** 把一条目录行转成本插件的模型条目；缺 id 的行返回 `null`。 */
export function toQoderModelRow(entry: unknown): QoderFallbackModel | null {
  if (!object(entry) || !nonEmptyString(entry.key)) return null
  const row = entry as QoderModelListRow
  const efforts = object(row.thinking_config?.enabled?.efforts)
    ? Object.keys(row.thinking_config.enabled.efforts)
    : []
  const defaultEffort = efforts.find(effort => {
    const value = (row.thinking_config?.enabled?.efforts as Record<string, { is_default?: unknown }>)[effort]
    return value?.is_default === true
  })
  // ⚠️ 上下文窗口取 `context_config` 里 `is_default` 那一档（实测 200000），
  // **不是** `max_input_tokens`（实测 180000 —— 那是扣掉输出预留后的可用值）。
  // 客户端展示与档位基准都用 200K，用 180K 会让档位合并对不上、窗口少 10%。
  const defaults = object(row.context_config) ? Object.values(row.context_config) : []
  const preferred = Number((defaults.find(cfg => cfg?.is_default === true) ?? defaults[0])?.token_count)
  const contextWindow = Number.isFinite(preferred) && preferred > 0 ? preferred : Number(row.max_input_tokens)
  const priceFactor = Number(row.price_factor)
  return {
    id: row.key,
    name: nonEmptyString(row.display_name) ? row.display_name : row.key,
    // `0` 是「未知窗口」哨兵（宿主投影按 `> 0` 过滤），不编造。
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 0,
    supportsImage: row.is_vl === true,
    // ⚠️ 上游 `is_reasoning` 与「是否产出 reasoning_content」不完全一致：
    // `dfmodel` 报 `is_reasoning:false` 但实测 50/57 帧有思考，且目录给了
    // 三个档位。有档位即可思考 —— 不要用 `is_reasoning:false` 把档位选择器关掉。
    supportsThinking: row.is_reasoning === true || efforts.length > 0,
    ...(efforts.length > 0 ? { efforts } : {}),
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
    ...(row.thinking_config?.disabled !== undefined ? { supportsDisable: true } : {}),
    // ⚠️ `0` 是合法的「免费」倍率，不能当缺失处理（`Number.isFinite` 判据）。
    ...(Number.isFinite(priceFactor) && priceFactor >= 0 ? { priceFactor } : {}),
  }
}

/** 解析目录响应；形状不认识时返回 `null`（调用方据此判为失败，不猜）。 */
export function parseQoderModelList(json: unknown): QoderFallbackModel[] | null {
  if (!object(json)) return null
  let rows: unknown[] | null = null
  for (const group of QODER_MODEL_GROUPS) {
    const candidate = json[group]
    if (Array.isArray(candidate) && candidate.length > 0) { rows = candidate; break }
  }
  if (rows === null) return null
  const out: QoderFallbackModel[] = []
  const seen = new Set<string>()
  for (const entry of rows) {
    const row = toQoderModelRow(entry)
    if (row === null || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out.length > 0 ? out : null
}
