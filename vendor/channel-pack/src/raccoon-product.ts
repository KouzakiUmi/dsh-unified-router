/**
 * Raccoon Work（商汤小浣熊）产品配置。
 *
 * ## 数据来源
 *
 * - API 基址与各前缀：`app.asar` 的 `.env.electron`
 * - 手机号加密密钥：渲染层模块 68284 的 `yv(e, t = "senseraccoon2023")`
 * - 阿里云验证码：渲染层模块 37907 的 `q3`（SceneId）/ `$j`（prefix）
 * - 兜底模型表：**2026-11-18** 用本机登录态实测
 *   `GET /api/web/llm/v2/model_catalog`（免费账号 7 条 / 订阅账号 7 条）
 * - 思考档位：同一次目录拉取的 `params.raccoon_thinking`
 * - 请求字段：2026-11-18 实测 `POST /chat/completions` 三层对照（见下）
 */

import { RACCOON_API_BASE, RACCOON_PHONE_CIPHER_SECRET, raccoonDisplayName } from './raccoon.js'
import { RACCOON_REQUEST_IMAGE_MAX_BYTES } from './image-budget.js'

/**
 * 思考档位有**两套方言**，按模型分流 —— 这是本文件最容易搞错的地方。
 *
 * ## 一、目录托管档位（`params.raccoon_thinking`，2026-11 上线）
 *
 * 上游在模型目录里逐模型下发：
 *
 * ```json
 * { "managed": true, "supported": true, "can_disable": false,
 *   "display_levels": [{ "value": "level_1", "label": "Minimal" }, ...],
 *   "default_level": "level_1" }
 * ```
 *
 * **请求字段是顶层 `raccoon_thinking_level`**，取值原样透传
 * （`level_1`…`level_5`，关闭时为 `off`）。2026-11-18 实测三层对照
 * （模型 `sn-qwen4-max-p`，pro 目录生效倍率 0，不产生扣费）：
 *
 * | 请求 | 结果 |
 * |---|---|
 * | 不发音思参数 | `delta.content` 有值、**无** `reasoning_content`，`reasoning_tokens=0` |
 * | 顶层 `raccoon_thinking_level:"level_3"` | ✅ `reasoning_content` 独立成通道，`reasoning_tokens=6` |
 * | `extra_body:{"raccoon_thinking_level":"level_3"}` | ❌ `HTTP 400 param raccoon_thinking_level invalid` |
 *
 * ⇒ 顶层字段才有效，放进 `extra_body` 会被判为非法参数。
 * 官方客户端同口径：box-agent 给 OpenAI SDK 传
 * `extra_body={'raccoon_thinking_level': level}`，SDK 把它**平铺进顶层 body**。
 *
 * ## 二、旧方言（`extra_body.thinking.type`）—— 仅用于没有托管档位的模型
 *
 * 报错原文：``thinking.type: expected one of `adaptive`, `enabled`, `disabled` ``。
 * 实测（每组 6~8 次，判据为服务端上报的 `reasoning_tokens`）：
 *
 * | 请求 | 结果 |
 * |---|---|
 * | 基线（不发参数） | 均值 **222**，6/6 有思考 |
 * | `extra_body.thinking={type:'disabled'}` | **6/6、8/8 全为 0** → ✅ 真关闭 |
 * | `extra_body.thinking={type:'enabled'}` | 均值 **218** → ✅ 与默认等价 |
 *
 * 而 `reasoning_effort`（8 个枚举值）**被接受但无效果**：8 轮配对实验里
 * `max - minimal` 正差 4 次 / 负差 4 次（纯随机），且 `none` 不关闭思考。
 * 故旧方言只暴露「开 / 关」两态。
 *
 * ## ⚠️ 两套方言**不能同时发**
 *
 * 官方 box-agent 在托管路径上会**跳过**旧路径（不再发 `thinking.type` 与
 * `reasoning_effort`），且两者互斥。本插件照此分流：模型有托管档位就只发
 * `raccoon_thinking_level`，没有才发 `extra_body.thinking`。
 *
 * ## ⚠️ 为什么默认档不照抄上游 `default_level: "off"`
 *
 * 实测会话记录（2026-11-17~18，`sn-qwen4-max-p`）里有 **18 处**正文
 * 泄漏规划：`assistant` 消息只有 `text` 块（无 `reasoning` 块），内容是
 * 「Let me add the new design facts to AGENTS.md: 1. …」这类逐步计划。
 *
 * 机制：这类推理模型在**思考关闭**时没有隐藏草稿区，规划就写进正文 ——
 * 探针 A 证实关闭时 `reasoning_content` 完全为空、`reasoning_tokens=0`，
 * 而文档型回答照样产出。用户看到的就是「CoT 泄漏到 assistant」。
 *
 * 故 `default_level` 为 `off` 时，本插件的 DSH 默认档取**最低思考档**
 * （`level_1`）而不是 `off`；`off` 仍可手动选择（有人要最快速度）。
 */

/**
 * 旧方言档位 id：**开启**思考（`extra_body.thinking:{type:'enabled'}`）。
 *
 * ⚠️ id 用 `on` 而不是 `high`：服务端虽接受 `high` 字样，但它走的是
 * `reasoning_effort` 通道、**实测无效果**。用 `on` 避免让用户误以为
 * 「选的是高强度档」—— 旧方言能表达的只有「开 / 关」。
 */
export const RACCOON_EFFORT_ON = 'on'

/**
 * 「关闭」档位 id。
 *
 * 两套方言共用这一个字面量：旧方言映射成
 * `extra_body.thinking:{type:'disabled'}`，托管档位直接发
 * `raccoon_thinking_level:"off"`（`can_disable` 为 false 的模型不发该值，
 * 上游客户端会钳到 `level_1`，本插件干脆不暴露 `off`）。
 */
export const RACCOON_EFFORT_OFF = 'off'

/**
 * 旧方言档位展示名（DSH 直接渲染 `efforts[].name`，不本地化）。
 *
 * ⚠️ 用「开启 / 关闭」而非「深度思考 / 关闭思考」（用户 2026-09-28 要求：
 * 「现在开启档位显示的深度思考，就显示开启就行了」）—— 旧方言只有布尔维度。
 */
export const RACCOON_EFFORT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [RACCOON_EFFORT_ON]: '开启',
  [RACCOON_EFFORT_OFF]: '关闭',
})

/**
 * 托管档位展示名。
 *
 * 上游 `display_levels[].label` 是英文（Minimal / Low / Medium / High / Max），
 * `level_N` 与服务端的对应关系在**所有模型上都一致**（实测 7 条目录逐条核对：
 * `level_1`=Minimal … `level_5`=Max），故这里用固定中文名，与
 * `src/client/ui.js` 的 `EFFORT_LABELS` 保持一致（两处都要有）。
 */
export const RACCOON_THINKING_LEVEL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [RACCOON_EFFORT_OFF]: '关闭',
  level_1: '极少',
  level_2: '低',
  level_3: '中',
  level_4: '高',
  level_5: '最大',
})

/**
 * 一个模型的托管思考档位（来自目录 `params.raccoon_thinking`）。
 */
export interface RaccoonThinkingInfo {
  /** 可选档位，按上游顺序；`can_disable` 为 true 时 `off` 在最前。 */
  levels: readonly string[]
  /**
   * 逐模型默认档（已按本插件口径修正）：
   * 上游 `default_level` 是具体档位时照抄；是 `off` 时改取最低思考档
   * （理由见文件头「为什么默认档不照抄 upstream off」）。
   */
  defaultLevel: string
}

/** 托管档位的合法取值（顺序即强度顺序）。 */
const RACCOON_THINKING_LEVELS: readonly string[] = Object.freeze([
  'level_1', 'level_2', 'level_3', 'level_4', 'level_5',
])

/**
 * 解析目录里的 `params.raccoon_thinking`。
 *
 * 返回 `undefined` 的情形（都按「该模型没有托管档位」处理 → 回退旧方言）：
 * - 没有该字段 / 不是对象 / `managed !== true`（上游明确说不是托管模型）；
 * - `supported === false`（声明不支持思考）；
 * - 既没有可选档位、又不允许关闭（那就没有任何可选项，不编造）。
 *
 * ⚠️ 这是**外部输入**：`display_levels` 可能含未知 value（上游改档位命名），
 * 只采纳 `level_1`…`level_5`，其余丢弃；重复项去重保序。
 */
export function parseRaccoonThinking(value: unknown): RaccoonThinkingInfo | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.managed !== true) return undefined
  if (raw.supported === false) return undefined

  const levels: string[] = []
  if (Array.isArray(raw.display_levels)) {
    for (const entry of raw.display_levels) {
      const level = typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).value
        : entry
      if (typeof level !== 'string') continue
      const normalized = level.trim()
      if (!RACCOON_THINKING_LEVELS.includes(normalized) || levels.includes(normalized)) continue
      levels.push(normalized)
    }
    // 上游顺序即强度顺序；万一被乱序下发，按强度重排（避免 UI 出现「最大→极少」）。
    levels.sort((a, b) => RACCOON_THINKING_LEVELS.indexOf(a) - RACCOON_THINKING_LEVELS.indexOf(b))
  }

  const canDisable = raw.can_disable === true
  if (levels.length === 0 && !canDisable) return undefined

  const options = canDisable ? [RACCOON_EFFORT_OFF, ...levels] : [...levels]
  const upstreamDefault = typeof raw.default_level === 'string' ? raw.default_level.trim() : ''
  // 上游默认档是具体档位时照抄；是 off（或缺失）时取最低思考档，见文件头。
  const defaultLevel = levels.includes(upstreamDefault)
    ? upstreamDefault
    : levels[0] ?? RACCOON_EFFORT_OFF
  return { levels: options, defaultLevel: options.includes(defaultLevel) ? defaultLevel : options[0]! }
}

/**
 * 该模型的 DSH 档位表（`{ id, name }` 数组）+ 默认档。
 *
 * 没有托管档位时回退旧方言两态（开 / 关），保证每个模型都有可选档。
 */
export function raccoonThinkingEfforts(info: RaccoonThinkingInfo | undefined): {
  efforts: readonly string[]
  defaultEffort: string
} {
  if (info === undefined) {
    return { efforts: RACCOON_REASONING_EFFORTS, defaultEffort: RACCOON_DEFAULT_EFFORT }
  }
  return { efforts: info.levels, defaultEffort: info.defaultLevel }
}

/** 档位 id → 展示名（托管档位与旧方言共用一张表）。 */
export function raccoonThinkingEffortName(id: string): string {
  return RACCOON_THINKING_LEVEL_NAMES[id] ?? RACCOON_EFFORT_NAMES[id] ?? id
}

/**
 * 旧方言可选的思考档位（按展示顺序）。
 *
 * ⚠️ 只给**没有托管档位**的模型用（`raccoonThinkingEfforts` 的回退分支）。
 */
export const RACCOON_REASONING_EFFORTS: readonly string[] = Object.freeze([
  RACCOON_EFFORT_ON,
  RACCOON_EFFORT_OFF,
])

/**
 * 旧方言默认档位 = `on`。
 *
 * 依据：实测「不发参数」与「显式 `{type:'enabled'}`」的思考量**等价**
 * （均值 222 vs 218），即**服务端默认就是开启**。故默认标成 `on`
 * 是**如实描述**，不是我们强行改变行为。
 */
export const RACCOON_DEFAULT_EFFORT = RACCOON_EFFORT_ON

/**
 * 兜底模型目录中的一个条目。
 */
export interface RaccoonFallbackModel {
  /** 模型 ID（传给 `chat/completions` 的 `model`）。 */
  id: string
  /** **已规范化**的展示名（含倍率，` · ` 分隔；免费显示「免费」）。 */
  name: string
  /** 上下文窗口。 */
  contextWindow: number
  /** 单次输出上限（远端 `params.max_tokens`）。 */
  maxTokens: number
  /** 是否支持图片输入（远端 `tags` 含 `vision`）。 */
  supportsImage: boolean
  /** 生效倍率（`billing_effective_multiplier`）；离线时也如实带上，供徽标显示。 */
  effectiveMultiplier?: number
  /** 原价倍率（`billing_multiplier`）。 */
  baseMultiplier?: number
  /** 计费状态（促销区分用，见 `model-rate-badge.ts`）。 */
  status?: 'normal' | 'discount' | 'limited_free'
  /** 状态角标文案（远端 `billing_status_note`）。 */
  statusNote?: string
  /** 托管思考档位；缺失 = 该模型走旧方言两态。 */
  thinking?: RaccoonThinkingInfo
  /** 默认禁用的备选模型；用户仍可手动启用。 */
  stale?: boolean
  /** 默认禁用的具体原因。 */
  staleReason?: string
}

/** Raccoon 产品配置。 */
export interface RaccoonProduct {
  /**
   * provider 标识：注册到 `ctx.llm` 的路由名，也是账号列表的 provider 字段值。
   *
   * ⚠️ 两个取值对应**同一上游账号体系**的两个产品面：`raccoon` = 免费版、
   * `raccoon-pro` = 订阅版。它们共用 API 基址与登录协议，只在「展示哪些模型」
   * 与「凭据默认 ref」上分叉，故用同一 `RaccoonProduct` 形状、两个实例表达。
   */
  id: 'raccoon' | 'raccoon-pro'
  /** 设置页 / 模型选择器展示名。 */
  displayName: string
  /** API 基址。 */
  apiBase: string
  /** 认证端点前缀。 */
  authApiPrefix: string
  /** 推理与模型目录前缀。 */
  llmApiPrefix: string
  /** 积分端点前缀。 */
  pointsApiPrefix: string
  /** 桌面端端点前缀。 */
  desktopApiPrefix: string
  /**
   * 单张请求图片的像素预算（issue !IKITT9 的 raccoon 变体）。
   */
  imagePixelBudget?: number
  /**
   * 单张请求图片的**编码字节目标**（base64 展开前）。
   *
   * 取 **512 KB**：base64 膨胀 4/3 → 每张约占 683 KB，
   * 10 MB 的配额可放约 **14 张**（原图只能放 2 张）。
   * ⚠️ 这是"每张固定预算"路线的固有上限：图再多仍会 413。
   * 按张数分摊总配额会把每张压到 600×400 以下、UI 小字直接糊掉，
   * 权衡后选择「保住可辨认性 + 覆盖到 14 张」（用户 2026-09-28 定，方案 A）。
   */
  imageMaxBytes?: number
  /** User-Agent（仅记录用；实测该端点不校验 UA）。 */
  userAgent: string
  /**
   * 客户端平台标识。
   *
   * ⚠️ 取值必须是 `desktop-windows` / `desktop-macos` / `desktop-linux`
   * —— 依据主进程 `desktopDeviceIdentity.js` 的 `resolveDesktopClientPlatform`
   * （`win32` → `desktop-windows`）。`desktop/v1/login/points/grant`
   * **要求**该头，猜错会被拒。
   */
  clientPlatform: string
  /** 客户端版本（带 `v` 前缀，如 `v1.0.35`）。 */
  clientVersion: string
  /** 默认凭据 ref（无账号池时的单凭据回退）。 */
  defaultCredentialRef: string
  /** 手机号传输层加密密钥（见 `raccoon.ts` 的说明：公开常量，非安全边界）。 */
  phoneCipherSecret: string
  /** 阿里云滑块验证码配置（短信登录必需）。 */
  aliyunCaptcha: { sceneId: string; prefix: string }
  /** 远端模型列表不可用时的兜底目录（只放本产品这一侧的模型，见下方拆表说明）。 */
  fallbackModels: readonly RaccoonFallbackModel[]
}

/** 兜底表条目构造器：展示名由 `raccoonDisplayName` 生成，避免与倍率字段漂移。 */
function fallbackModel(entry: {
  id: string
  displayName: string
  contextWindow: number
  maxTokens: number
  supportsImage: boolean
  effectiveMultiplier: number
  baseMultiplier: number
  status: 'normal' | 'discount' | 'limited_free'
  statusNote?: string
  thinking: RaccoonThinkingInfo
  stale?: boolean
  staleReason?: string
}): RaccoonFallbackModel {
  return {
    id: entry.id,
    name: raccoonDisplayName({
      id: entry.id,
      description: entry.displayName,
      effectiveMultiplier: entry.effectiveMultiplier,
      baseMultiplier: entry.baseMultiplier,
      status: entry.status,
      statusNote: entry.statusNote ?? '',
    }),
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    supportsImage: entry.supportsImage,
    effectiveMultiplier: entry.effectiveMultiplier,
    baseMultiplier: entry.baseMultiplier,
    status: entry.status,
    ...entry.statusNote === undefined ? {} : { statusNote: entry.statusNote },
    thinking: entry.thinking,
    ...entry.stale === undefined ? {} : { stale: entry.stale },
    ...entry.staleReason === undefined ? {} : { staleReason: entry.staleReason },
  }
}

/** 五档全开（`level_1`…`level_5`），不允许关闭。 */
const THINKING_5_NO_OFF: RaccoonThinkingInfo = { levels: ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'], defaultLevel: 'level_1' }
/** 四档（无 Medium），允许关闭；上游默认 off → 按插件口径改取最低思考档。 */
const THINKING_4_OFF: RaccoonThinkingInfo = { levels: ['off', 'level_1', 'level_2', 'level_4', 'level_5'], defaultLevel: 'level_1' }
/** 三档（Minimal / Medium / Max），允许关闭。 */
const THINKING_3_OFF: RaccoonThinkingInfo = { levels: ['off', 'level_1', 'level_3', 'level_5'], defaultLevel: 'level_1' }
/** 三档，不允许关闭。 */
const THINKING_3_NO_OFF: RaccoonThinkingInfo = { levels: ['level_1', 'level_3', 'level_5'], defaultLevel: 'level_1' }

/**
 * 兜底模型目录（**2026-11-18** 实测 `GET /api/web/llm/v2/model_catalog`，
 * 免费账号看到 7 条 `visible:true`）。
 *
 * 顺序**照抄远端返回顺序**，不重排 —— 重排会让「与远端对比」这类排查失去可比性。
 *
 * ## 免费版 / 订阅版是两个 provider
 *
 * 两侧是**两个独立的模型池**：联机时各自用本侧账号的凭据去上游拉目录
 * （`RaccoonAuth.fetchModelsWithCredential`），上游给该账号什么模型就展示什么
 * 模型，**不做任何倍率过滤**（`billing_effective_multiplier` 只是展示信息）。
 *
 * 这里的拆表只针对**离线兜底**：拉不到远端目录时，免费面用下面这份、
 * 订阅面用 {@link RACCOON_PRO_FALLBACK_MODELS}（id 带 `-p` 的订阅侧模型）。
 * ⚠️ **不要**把这份兜底的拆分方式套回远端目录：按倍率过滤同一份远端目录
 * 会删掉免费账号明明看得到的计费模型（上一版的实际缺陷）。
 *
 * ⚠️ 早期这份表只有 2 条（「免费版只列 0× 模型」），与实测不符：免费账号
 * 在上游看到的就是**全部 7 条**，其中 4 条计费。兜底表对齐实测，倍率照实标注。
 */
export const RACCOON_FREE_FALLBACK_MODELS: readonly RaccoonFallbackModel[] = [
  fallbackModel({
    id: 'sn-sensenova-6-8-flash',
    displayName: 'SenseNova-6.8-Flash',
    contextWindow: 256_000,
    maxTokens: 63_999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: 'limited_free',
    statusNote: '限免到11月30日',
    thinking: THINKING_5_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-sensenova-6-8-flash-lite',
    displayName: 'SenseNova-6.8-Flash-Lite',
    contextWindow: 256_000,
    maxTokens: 63_999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: 'limited_free',
    statusNote: '限免到11月30日',
    thinking: THINKING_4_OFF,
  }),
  fallbackModel({
    id: 'sn-qwen4-max',
    displayName: 'Qwen4-Max',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.5,
    baseMultiplier: 0.75,
    status: 'discount',
    statusNote: '限时折扣至11月22日',
    thinking: THINKING_3_OFF,
  }),
  fallbackModel({
    id: 'sn-glm-5-3',
    displayName: 'GLM-5-3',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    // 远端 tags 无 `vision`，但实测能看图（1/3 成功，另两次是节点侧纯文本
    // fallback 组，属 provider 缺陷；见 RACCOON_IMAGE_CAPABILITY_OVERRIDES）。
    supportsImage: true,
    effectiveMultiplier: 0.75,
    baseMultiplier: 0.75,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-kimi-k3-1-pro',
    displayName: 'Kimi-K3.1-Pro',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 1,
    baseMultiplier: 1,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-glm-5-3-flash',
    displayName: 'GLM-5-3-Flash',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.2,
    baseMultiplier: 0.2,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-deepseek-v4-1-flash-1017',
    displayName: 'DeepSeek-V4.1-Flash-1017',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.25,
    baseMultiplier: 0.25,
    status: 'normal',
    thinking: THINKING_3_OFF,
  }),
]

/**
 * 「Raccoon 订阅版」（`raccoon-pro`）的兜底目录：订阅账号在上游看到的 7 条，
 * id 一律带 `-p` 后缀（**订阅专属**）。
 *
 * ⚠️ 旧版这份表用的是**不带 `-p`** 的免费侧 id，已实测确认是缺陷：
 * 订阅面把免费 id 发出去会走到另一条模型线上。id 必须以订阅目录为准。
 * 与免费侧同源同时刻实测；倍率按订阅账号所见（`sn-qwen4-max-p` 活动限免中）。
 */
export const RACCOON_PRO_FALLBACK_MODELS: readonly RaccoonFallbackModel[] = [
  fallbackModel({
    id: 'sn-sensenova-6-8-flash-p',
    displayName: 'SenseNova-6.8-Flash',
    contextWindow: 256_000,
    maxTokens: 63_999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: 'limited_free',
    statusNote: '限免到11月30日',
    thinking: THINKING_5_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-sensenova-6-8-flash-lite-p',
    displayName: 'SenseNova-6.8-Flash-Lite',
    contextWindow: 256_000,
    maxTokens: 63_999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: 'limited_free',
    statusNote: '限免到11月30日',
    thinking: THINKING_4_OFF,
  }),
  fallbackModel({
    id: 'sn-qwen4-max-p',
    displayName: 'Qwen4-Max',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.75,
    status: 'limited_free',
    statusNote: '活动限免至11月22日',
    thinking: THINKING_3_OFF,
  }),
  fallbackModel({
    id: 'sn-glm-5-3-p',
    displayName: 'GLM-5-3',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.75,
    baseMultiplier: 0.75,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-kimi-k3-1-pro-p',
    displayName: 'Kimi-K3.1-Pro',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 1,
    baseMultiplier: 1,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-glm-5-3-flash-p',
    displayName: 'GLM-5-3-Flash',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.2,
    baseMultiplier: 0.2,
    status: 'normal',
    thinking: THINKING_3_NO_OFF,
  }),
  fallbackModel({
    id: 'sn-deepseek-v4-1-flash-1017-p',
    displayName: 'DeepSeek-V4.1-Flash-1017',
    contextWindow: 1_000_000,
    maxTokens: 100_000,
    supportsImage: true,
    effectiveMultiplier: 0.25,
    baseMultiplier: 0.25,
    status: 'normal',
    thinking: THINKING_3_OFF,
  }),
]

/**
 * 远端 `tags` 缺 `vision`、但**实测能看图**的模型。
 *
 * ## ⚠️ 为什么需要它：`tags` 不是能力契约（真实缺陷，用户 2026-10-03 报障）
 *
 * 症状：给 `sn-deepseek-v4-1-flash` 发图，模型回「无法读取图片 / 不支持图片」。
 *
 * ### 根因链
 *
 * 1. 我们把「远端 `tags` 含 `vision`」当成了服务端能力声明；
 * 2. `sn-deepseek-v4-1-flash` 的 `tags` 是
 *    `["general","code","html","analysis","reasoning","auto"]` —— **没有** `vision`
 *    （`display_description` 也只写「通用对话、代码开发、复杂分析」，不提图像识别）；
 * 3. ⇒ `inputModalities` 播报 `['text']`；
 * 4. ⇒ **DSH 在 `LlmRuntime` 里把图片替换成文本占位符**
 *    （`dsh-llm/lib/index.js` 的 `projectImagesForTextModel`，产出
 *    `[image omitted because this model accepts text only; attachment sha256:…]`）
 *    —— **图片根本没发出去**；
 * 5. ⇒ 用户看到模型说「读不到图片」，而端点其实完全正常。
 *
 * ### 决定性证据：带图实测 6/6 全部读对
 *
 * 同一张「随机 6 位数字」图（模型无法猜）打 `POST /api/web/llm/v2/chat/completions`：
 *
 * | 模型 | 远端 tags 含 vision | 实测读图 |
 * |---|---|---|
 * | `sn-deepseek-v4-1-flash` | ❌ | ✅ **5/5**（208063/942977/999889/123015/478368） |
 * | `sn-glm-5-3-flash` | ❌ | ✅ 1/1 |
 * | `sn-sensenova-6-8-flash` | ✅ | ✅ 2/2 |
 * | `sn-sensenova-6-8-flash-lite` | ✅ | ✅ 1/1 |
 * | `sn-kimi-k3` | ✅ | ✅ 1/1 |
 * | `sn-glm-5-3` | ✅ | ⚠️ 1/3（**provider 侧节点不一致**，见下） |
 *
 * ### 为什么不能指望远端补字段
 *
 * 已穷举条目的**键并集**：顶层 14 个键，`params` 里原本只有 `context_window`
 * 与 `max_tokens`（2026-11 起多出 `raccoon_thinking`，仍无模态字段）。
 * 用 `/modal|vision|image|img|multimodal|media|type|capab|support|input|output/i`
 * 扫描，**命中 0 个**。⇒ 远端从未下发模态字段，`tags` 是唯一信号，而它被证伪。
 *
 * `tags` 的真实用途是**客户端「Raccoon-Auto 选模」的偏好标签**
 * （`TASK_TAG_PATTERNS` 给消息打 vision 标记后，挑一个带 `vision` 的模型）——
 * 它回答的是「该模型适不适合处理这类任务」，**不是**「能不能吃图」。
 *
 * ### ⚠️ 顺带发现：`sn-glm-5-3` 节点不一致（provider 侧缺陷，不归我们）
 *
 * 它 3 次里只对 1 次，两次回「当前模型不支持图片或视频输入」。错误体暴露网关有
 * 3 个 fallback 组（`raccoon-4eb26a` / `raccoon-0c119c` / `raccoon-ecc5fd`），
 * **部分节点是纯文本的**。它本来就带 `vision` 标签、我们一直在发图，
 * **本次修复不改变它的行为**，故按「已知 provider 缺陷」记录而不特殊处理。
 */
export const RACCOON_IMAGE_CAPABILITY_OVERRIDES: ReadonlySet<string> = new Set([
  'sn-deepseek-v4-1-flash',
  'sn-deepseek-v4-1-flash-1017',
  'sn-glm-5-3-flash',
])

/**
 * 远端目录条目的图片能力判定 —— **远端解析路径专用**。
 *
 * ⚠️ 兜底表路径（`fallbackToRemote`）不走本函数：它的真相源是
 * 兜底条目的 `supportsImage`（已按同一批实测证据修正为 `true`）。
 * 两个真相源由测试的「兜底表与远端判定必须一致」一条锁死 —— **别让它们分叉**。
 *
 * ⚠️ **订阅侧 id 带 `-p`**（`sn-glm-5-3-flash-p` 等），白名单里存的是免费侧
 * 形态；故先去后缀再比对，否则订阅面永远命中不了白名单。
 *
 * @param modelId 模型 id。
 * @param tags 远端 `tags`（`normalizeRemoteModel` 已小写化；无标签时传空数组）。
 */
export function raccoonSupportsImage(modelId: string, tags: readonly string[]): boolean {
  const bare = modelId.replace(/-p$/u, '')
  if (RACCOON_IMAGE_CAPABILITY_OVERRIDES.has(bare)) return true
  return tags.includes('vision') || tags.includes('image') || tags.includes('image-understanding')
}

/** Raccoon **免费版**（`raccoon`）产品配置。 */
export const RACCOON: RaccoonProduct = {
  id: 'raccoon',
  // ⚠️ 展示名必须能一眼区分免费版 / 订阅版：两者是**同一上游账号体系**的两个
  // 产品面（同 API 基址、同登录协议），只按套餐分流模型。名字若都叫
  // 「Raccoon (商汤)」，模型选择器与设置页里会出现两张分不清的卡片。
  // ⚠️ 也不要用『Raccoon Work (商汤)』—— 那个词组在 Channel Pack 的 provider
  // Tab 里**触发换行**（用户报障）。
  displayName: 'Raccoon 免费版',
  apiBase: RACCOON_API_BASE,
  authApiPrefix: '/api/web/auth/v1',
  llmApiPrefix: '/api/web/llm/v2',
  pointsApiPrefix: '/api/web/points/v1',
  desktopApiPrefix: '/api/web/desktop/v1',
  userAgent: 'Raccoon Work/1.0.35 (Windows)',
  clientPlatform: 'desktop-windows',
  clientVersion: 'v1.0.35',
  defaultCredentialRef: 'RACCOON_ACCESS_TOKEN',
  // 实测该网关按**请求体字节**卡（`HTTP_413: request body exceeds 10MB`），
  // 所以字节目标是主约束；像素预算保证图不至于大到压不进那个字节目标。
  imagePixelBudget: 640_000,
  imageMaxBytes: RACCOON_REQUEST_IMAGE_MAX_BYTES,
  phoneCipherSecret: RACCOON_PHONE_CIPHER_SECRET,
  aliyunCaptcha: { sceneId: '1pkmy0x3', prefix: 'hk1r5l' },
  fallbackModels: RACCOON_FREE_FALLBACK_MODELS,
}

/**
 * Raccoon **订阅版**（`raccoon-pro`）产品配置。
 *
 * ## 与免费版的差异只有三处
 *
 * | 字段 | 免费版 | 订阅版 |
 * |---|---|---|
 * | `id` | `raccoon` | `raccoon-pro` |
 * | `displayName` | Raccoon 免费版 | Raccoon 订阅版 |
 * | `defaultCredentialRef` | `RACCOON_ACCESS_TOKEN` | `RACCOON_PRO_ACCESS_TOKEN` |
 * | `fallbackModels` | 免费目录 7 条 | 订阅目录 7 条（id 带 `-p`） |
 *
 * 其余（API 基址、各前缀、UA、设备标识、验证码、图片预算、手机号密钥）**完全
 * 相同** —— 上游是同一套服务，账号体系也是同一个：两个 provider 的差别只是
 * 「展示哪批模型」，不是「连不同后端」。故这里用 `...RACCOON` 派生，避免把
 * 十几个字段抄两遍后悄悄漂移。
 *
 * ## 为什么账号池天然隔离
 *
 * channel-pack 的账号池按 `provider` 字段隔离（`pool.listAccountsByProvider` /
 * `getAvailableAccount` 都以 provider 为键），因此两个产品**各自独立**：
 * 选号互不影响。这里不做套餐自动探测 —— 用户选哪个卡片就进哪个账号池。
 */
export const RACCOON_PRO: RaccoonProduct = {
  ...RACCOON,
  id: 'raccoon-pro',
  displayName: 'Raccoon 订阅版',
  defaultCredentialRef: 'RACCOON_PRO_ACCESS_TOKEN',
  fallbackModels: RACCOON_PRO_FALLBACK_MODELS,
}

/** 全部 Raccoon 产品配置（免费版 + 订阅版）。 */
export const ALL_RACCOON_PRODUCTS: readonly RaccoonProduct[] = [RACCOON, RACCOON_PRO]

/**
 * 按 provider id 取产品配置；未知 id 返回 undefined。
 */
export function raccoonProductById(id: string): RaccoonProduct | undefined {
  return ALL_RACCOON_PRODUCTS.find((product) => product.id === id)
}
