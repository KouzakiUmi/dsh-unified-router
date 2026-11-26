/**
 * Channel Pack 多账号管理的 RPC 端点注册。
 *
 * 使用 DSH 的 connection.fetch.register() 模式注册 HTTP API 端点，
 * 与 dsh-im 的 registerManagementRpc 一致。
 * 通道名 channel-pack → 路径 /api/channel-pack
 * 端点方法：account.list / account.create / account.update / account.delete /
 *           account.reorder / account.refresh / account.retest / account.retestAll /
 *           account.test / account.reset / account.resetAll / login.poll /
 *           credits.status / credits.claimAll / credits.balances /
 *           model.list / model.setDisabled / model.refresh /
 *           captcha.demand / captcha.carrierUrl / captcha.contribute（内部载体，
 *           载体页与供给槽已随渠道重写移除）/
 *           backup.export / backup.import / backup.status
 * 另有一条 GET 路由 `/api/channel-pack/captcha-carrier`：渲染内部载体的载体页
 * （⚠ 手工诊断用；guest 加载不到它，见该路由注释里的主进程取证）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { isSupportedProvider } from './channel-pack-store.js'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { AccountPool } from './account-pool.js'
import { isModelDisabled } from './model-selection.js'
import { modelRecommendationExclusions, readableModelName } from '../../../lib/model-catalog.js'
import type { ModelRateBadge } from './model-rate-badge.js'
import { isGatewayEnabled } from './openai-gateway/config.js'
import { collectGatewayEffortViews, collectGatewayModels, toGatewayModelIds, type GatewayModelSource } from './openai-gateway/models.js'
import {
  applyGatewayDesiredState,
  gatewayAddress,
  gatewayApiKey,
  isGatewayRunning,
  setGatewayDesiredEnabled,
} from './openai-gateway/runtime.js'
import type { QoderAuth } from './qoder-auth.js'
import type { TraeAuth } from './trae-auth.js'
import { creditExpiringWindowDays } from './credit-expiry-window.js'
import { RACCOON, RACCOON_PRO, type RaccoonProduct } from './raccoon-product.js'
import type { RaccoonAuth } from './raccoon-auth.js'
import type { RaccoonCredential } from './raccoon.js'
import type { StartedRaccoonLoginFlow } from './raccoon-login-page.js'
import { QODER, QODER_CN, type QoderProduct } from './qoder-product.js'
import { TRAE } from './trae-product.js'
import {
  fetchQoderUserNickname,
  isQoderRefreshable,
  qoderCredentialExpiresAtMs,
  withQoderNickname,
} from './qoder.js'
import type { QoderCredential } from './qoder.js'
import { claimQoderDailyCheckin, fetchQoderCheckinStatus, fetchQoderCreditBalance } from './qoder-credits.js'
import { isTraeRefreshable, traeCredentialExpiresAtMs, traeDisplayNickname } from './trae.js'
import type { TraeCredential } from './trae.js'
import { readTokenLedger, readTokenLedgerDayMap, readTokenLedgerHistory, TOKEN_LEDGER_HISTORY_MAX_DAYS } from './token-ledger.js'
import {
  claimUnitOf,
  type CheckinStatus,
  type ClaimOutcome,
  type CreditBalance,
} from './credits.js'
import {
  claimTraeDailyCheckin,
  fetchTraeCheckinStatus,
  fetchTraeCreditBalance,
  fetchTraePayStatus,
} from './trae-credits.js'
import {
  pickTestModel,
  pickTestModels,
  testAccountCandidates,
  resetAccount,
  resetAllAccounts,
  retestAccount,
  retestAllAccounts,
} from './account-probe.js'
import { exportBackup, importBackup } from './backup.js'
import { clearDeadModels, deadModelIdsFor } from './dead-model-store.js'
import type {
  ProviderAccountEntry,
  RpcBackupExportResponse,
  RpcBackupImportRequest,
  RpcBackupImportResponse,
  RpcBackupStatusResponse,
  RpcListAccountsRequest,
  RpcListAccountsResponse,
  RpcCreateAccountRequest,
  RpcCreateAccountResponse,
  RpcPollLoginRequest,
  RpcPollLoginResponse,
  RpcUpdateAccountRequest,
  RpcDeleteAccountRequest,
  RpcReorderAccountsRequest,
  RpcGetProviderOrderResponse,
  RpcSetProviderOrderRequest,
  RpcRefreshAccountRequest,
  RpcRefreshAccountResponse,
  RpcRetestAccountRequest,
  RpcRetestAllRequest,
  RpcTestAccountRequest,
  RpcTestAccountResponse,
  RpcResetAccountRequest,
  RpcResetAllRequest,
  RpcCreditsStatusRequest,
  RpcCreditsStatusResponse,
  RpcCreditsClaimAllRequest,
  RpcCreditsClaimAllResponse,
  RpcCreditsClaimSummary,
  RpcCreditsBalancesRequest,
  RpcCreditsBalanceExtra,
  RpcCreditsBalancesResponse,
  RpcCreditsClaimAccountResult,
  RpcOnboardingStatusRequest,
  RpcOnboardingStatusResponse,
  RpcOnboardingClaimRequest,
  RpcOnboardingClaimResponse,
  RpcModelListRequest,
  RpcModelListResponse,
  RpcModelParamsRequest,
  RpcModelParamsResponse,
  RpcModelSetParamsRequest,
  RpcModelSetParamsResponse,
  RpcModelSetDisabledRequest,
  RpcModelSetDisabledResponse,
  RpcModelSetAllDisabledRequest,
  RpcModelSetAllDisabledResponse,
  RpcModelSetDisabledManyRequest,
  RpcModelSetDisabledManyResponse,
  RpcModelClearDeadRequest,
  RpcModelClearDeadResponse,
  RpcProviderStatusRequest,
  RpcProviderStatusResponse,
  RpcProviderSetEnabledRequest,
  RpcProviderSetEnabledResponse,
  RpcGatewayStatusResponse,
  RpcGatewaySetEnabledRequest,
  RpcGatewayModel,
  RpcCaptchaDemandResponse,
  RpcCaptchaCarrierUrlResponse,
  RpcCaptchaContributeRequest,
  RpcCaptchaContributeResponse,
  RpcUsageBadgeRequest,
  RpcUsageBadgeResponse,
  RpcUsageBadgePreferenceRequest,
  RpcUsageBadgePreferenceResponse,
  RpcUsageTokenLedgerRequest,
  RpcUsageTokenLedgerResponse,
  RpcUsageTokenLedgerHistoryRequest,
  RpcUsageTokenLedgerHistoryResponse,
  RpcUsageAutoCheckinRequest,
  RpcUsageAutoCheckinResponse,
  ProviderStatus,

  ProviderAccountStatus,
} from './types.js'
import {
  BADGE_PREFERENCES,
  createBadgePreferenceStore,
} from './badge-preferences.js'
import { createUsageBadge, type BadgeRpcResult } from './usage-badge.js'
import { createAutoCheckin, createAutoCheckinStore } from './auto-checkin.js'

/** Channel Pack RPC API 路径 */
export const CHANNEL_PACK_API_PATH = '/api/channel-pack'
/**
 * 内部 captcha **载体页**的 GET 路径（与 GUI 同源，故 `<webview>` 能导航过来）。
 *
 * ⚠ 它挂在 `/api/` 前缀下，因而不是「随便一个静态页」：DSH 的 `/api` 路由会先过
 *   Connection 的 Host/Origin 栏与**浏览器会话认证**（`dsh-client-connection` 的
 *   `admit()` ⇒ 未认证回 401）。桌面版的 guest 与 GUI 是否同 partition、
 *   因而带得上那份会话 cookie，属 Task 5 的**实测项**，不在这里放宽。
 */

/** Gateway RPC 端点名（connection.rpc.call 的 endpoint 参数） */
const CHANNEL_PACK_ENDPOINT = 'channel-pack'

/** 生成 8 字符随机短 ID（小写 hex） */
function shortId(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 解析 Qoder 凭据 JSON；解析失败返回 undefined。 */
function parseQoderCredential(raw: string): QoderCredential | undefined {
  try {
    const parsed = JSON.parse(raw) as QoderCredential
    return typeof parsed === 'object' && parsed !== null && typeof parsed.access_token === 'string'
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

/** 解析 TRAE 凭据 JSON；解析失败返回 undefined。 */
function parseTraeCredential(raw: string): TraeCredential | undefined {
  try {
    const parsed = JSON.parse(raw) as TraeCredential
    return typeof parsed === 'object' && parsed !== null && typeof parsed.access_token === 'string'
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 构造 Raccoon 账号的**展示名**：`RaccoonAva (1100)`。
 *
 * ## 为什么要追加手机号尾号
 *
 * 服务端的 `name` 是**自动生成的默认名**（实测本机账号为 `RaccoonAva`，
 * 即「Raccoon」+ 随机串）。实证：
 *
 * - `GET /user_info` 的 `data.name = "RaccoonAva"`；
 * - JWT payload 里同样带 `name: "RaccoonAva"`（官方客户端就是读这个：
 *   `M = () => { ... userName: t.name, id: t.sid }`）；
 * - `wechat_bindings` 只有 `[{id, bound_at}]` —— **没有微信昵称/头像**。
 *   微信扫码走 `snsapi_login`（只给 openid），要昵称需额外申请
 *   `snsapi_userinfo`，这里显然没申请。
 *
 * 所以「显示 `RaccoonAva`」本身与官方一致、**不是取错字段**；但它是默认名，
 * 注册第二个账号时服务端很可能又给一个相近的名字 → 多账号重名、无法区分。
 *
 * 修法：**保留服务端原名再挂尾号**，
 * 兼顾「看得出服务端原名字」与「多账号可区分」。
 *
 * 退化顺序：昵称 + 手机号尾号 → 昵称 + 用户 id → 昵称 → 账号 id。
 * ⚠️ 手机号取**后 4 位**（够区分且不完整暴露号码）。
 */
export function buildRaccoonNickname(
  credential: Pick<RaccoonCredential, 'nickname' | 'phone' | 'user_id'>,
  fallbackId: string,
): string {
  const nickname = typeof credential.nickname === 'string' ? credential.nickname.trim() : ''
  const phone = typeof credential.phone === 'string' ? credential.phone.trim() : ''
  const userId = typeof credential.user_id === 'string' ? credential.user_id.trim() : ''

  // 消歧后缀：优先手机号尾号（更利于用户辨认是哪个号），否则用户 id
  const suffix = phone.length >= 4
    ? phone.slice(-4)
    : userId.length > 0 ? userId : ''

  if (nickname.length > 0) {
    // 已有该后缀时不重复追加（例如服务端名字里本就带手机号尾号）
    return suffix.length > 0 && !nickname.includes(suffix) ? `${nickname} (${suffix})` : nickname
  }
  if (suffix.length > 0) return `Raccoon ${suffix}`
  return fallbackId
}

/**
 * 汇总一次批量领取的结果。
 * 纯函数，便于单测；inactive（无资格/活动结束）与 failed 分开计数，
 * 因为前者是正常的业务状态、后者才是需要用户关注的问题。
 *
 * ★ **按单位分开累加**（2026-10-04，真实缺陷）：`totalCredit` 这个标量会把
 * 不同量纲加在一起（ZCode 的 1 亿 token + 100 积分 = `100000100`），单位信息
 * 一旦在这一层丢掉，下游无论怎么写文案都只能标一个「积分」。故同时产出
 * `totalByUnit`，消费方一律用它（见 `RpcCreditsClaimSummary.totalByUnit`）。
 *
 * ⚠️ `totalCredit` **保留原语义**（跨单位求和），只为不破坏既有契约；
 * **不要**在展示路径上用它 —— 那正是本缺陷的成因。
 */
export function computeClaimSummary(outcomes: readonly ClaimOutcome[]): RpcCreditsClaimSummary {
  const summary: RpcCreditsClaimSummary = {
    claimed: 0, totalCredit: 0, alreadyClaimed: 0, inactive: 0, failed: 0, coversToday: 0,
    totalByUnit: { token: 0, credit: 0 },
  }
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'claimed':
        summary.claimed += 1
        summary.totalCredit += outcome.credit
        // ⚠️ 单位缺省按 `credit`（与 `ClaimOutcome.unit` 的声明一致）——
        // 只有 ZCode 显式传 `'token'`，其余 11 个渠道逐字不变。
        summary.totalByUnit[claimUnitOf(outcome.unit)] += outcome.credit
        // ⚠️ 只有**覆盖今天**的领取才算「今天已处理」。`coversToday:false` 是
        // 渠道自己标的（当前是 Qoder 刷新前那一轮），见 `credits.ts` 的字段说明。
        if (outcome.coversToday !== false) summary.coversToday += 1
        break
      case 'already-claimed':
        summary.alreadyClaimed += 1
        if (outcome.coversToday !== false) summary.coversToday += 1
        break
      case 'inactive':
        summary.inactive += 1
        break
      case 'failed':
        summary.failed += 1
        break
      default: {
        // 编译期穷尽性检查：ClaimOutcome 未来新增 kind 时此处会报错，
        // 迫使作者显式决定它该计入哪一栏，而不是被静默漏计。
        const exhaustive: never = outcome
        void exhaustive
        // 运行期兜底：类型声明与运行时不符（未知 kind）时按 failed 计入，
        // 宁可多报一个失败，也不让结果凭空消失。
        summary.failed += 1
        break
      }
    }
  }
  return summary
}

/**
 * 积分端点的可注入依赖。
 *
 * 抽出这一层是为了让「逐账号处理」能脱离 `ctx.connection.fetch` 注册流程
 * 单独单测：端点内不做任何业务判断，只负责取账号列表并转交下面的纯函数。
 */
export interface CreditsEndpointDeps<
  TCredential = unknown,
  TProduct = unknown,
> {
  /**
   * 解析凭据引用。
   * 按设计该接口**不可信**（凭据可能已被外部删除、provider 后端异常），
   * 实现允许抛错，调用方必须把异常算在单个账号头上。
   */
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
  /** 查询对应渠道的签到状态。 */
  fetchStatus?: (credential: TCredential, product: TProduct) => Promise<CheckinStatus | null>
  /** 执行对应渠道的签到领取。 */
  claim?: (credential: TCredential, product: TProduct, entry: ProviderAccountEntry) => Promise<ClaimOutcome>
  /** 查询对应渠道的积分余额。 */
  fetchBalance?: (credential: TCredential, product: TProduct) => Promise<CreditBalance | null>
  /**
   * 余额查询的**带原因**版本（优先于 {@link fetchBalance}）。
   */
  fetchBalanceDetailed?: (
    credential: TCredential,
    product: TProduct,
  ) => Promise<{ balance: CreditBalance | null; error?: string; extra?: RpcCreditsBalanceExtra }>
  /** 单账号异常时的告警出口（不参与控制流）。 */
  warn?: (message: string) => void
  /**
   * 领取前是否先查一次签到状态（默认 `true`）。
   *
   * LobsterAI 的领取流程**自身就是多步的**（slot → context → check_in），
   * `claimedToday` / `actions` 判断已在内部完成并会返回对应的
   * `already-claimed` / `inactive`，外部再查一次纯属重复请求 ——
   * 故它传 `false` 跳过预检，直接交给 `claim`。
   */
  precheckStatus?: boolean
  requireStatus?: boolean
  signal?: AbortSignal
}

/**
 * 逐账号收集签到状态（顺序执行，避免并发触发风控）。
 *
 * **包含已停用账号**：停用只影响账号池的自动选择与限流切换，不改变账号本身
 * 是否已签到。用户要看到的是「这个账号今天领了没」，因此这里不过滤 enabled。
 *
 * 关键约束：**凭据解析也在 try 之内**。`credentialRef()` 会对名称做正则校验
 * （非法名称抛 TypeError），`deps.resolve()` 也可能抛错。若把它们留在 try
 * 之外，任一账号的异常都会冒泡到 handleMethod 外层 catch，使整批请求以
 * `channel-pack/handler-failed` 失败——违背「单个账号失败不中断整体」的设计。
 */
export async function collectCreditsStatus<TCredential = unknown, TProduct = unknown>(
  accounts: readonly ProviderAccountEntry[],
  product: TProduct,
  deps: CreditsEndpointDeps<TCredential, TProduct>,
): Promise<RpcCreditsStatusResponse['accounts']> {
  const fetchStatus = deps.fetchStatus ?? (async () => { throw new Error('该渠道未提供签到状态查询') })
  const results: RpcCreditsStatusResponse['accounts'] = []
  // 顺序查询，避免并发触发风控
  for (const entry of accounts) {
    let status: CheckinStatus | null = null
    try {
      const resolved = await deps.resolve(credentialRef(entry.credentialRef))
      if (resolved !== undefined) {
        const credential = JSON.parse(resolved.value) as TCredential
        status = await fetchStatus(credential, product)
      }
    } catch (error) {
      // 单个账号的凭据缺失 / JSON 损坏 / 名称非法 / 网络失败都不影响其余账号
      deps.warn?.(`[channel-pack] credits.status 账号 ${entry.id} 失败: ${String(error)}`)
      status = null
    }
    results.push({ accountId: entry.id, nickname: entry.nickname, status })
  }
  return results
}

/**
 * 逐账号执行一键领取（顺序执行，单个账号失败不中断整体）。
 *
 * **包含已停用账号**：签到领取与「是否参与账号池自动选择」无关 —— 停用的
 * 账号同样有当日积分可领，用户点「一键领取」时期望所有账号都尝试一遍。
 * 停用只影响限流切换时的候选集合，不影响这里。
 *
 * 与 collectCreditsStatus 同理：凭据解析位于每个账号自己的 try 之内，
 * 异常只让该账号记为 failed。
 */
export async function collectClaimResults<TCredential = unknown, TProduct = unknown>(
  accounts: readonly ProviderAccountEntry[],
  product: TProduct,
  deps: CreditsEndpointDeps<TCredential, TProduct>,
): Promise<RpcCreditsClaimAllResponse> {
  const fetchStatus = deps.fetchStatus ?? (async () => { throw new Error('该渠道未提供签到状态查询') })
  const claim = deps.claim ?? (async () => { throw new Error('该渠道未提供签到领取') })
  const precheck = deps.precheckStatus !== false
  const results: RpcCreditsClaimAllResponse['results'] = []
  const outcomes: ClaimOutcome[] = []
  for (const entry of accounts) {
    deps.signal?.throwIfAborted()
    let outcome: ClaimOutcome
    try {
      const resolved = await deps.resolve(credentialRef(entry.credentialRef))
      if (resolved === undefined) {
        outcome = { kind: 'failed', code: -1, message: '凭据未配置' }
      } else {
        const credential = JSON.parse(resolved.value) as TCredential
        if (!precheck) {
          // 领取流程自带状态判断（LobsterAI 的 slot/context 检查在 claim 内部）。
          outcome = await claim(credential, product, entry)
        } else {
          // 先查状态：活动未开启或今日已领则跳过领取请求，减少无效调用
          const status = await fetchStatus(credential, product)
          if (status !== null && !status.active) {
            outcome = { kind: 'inactive', message: '签到活动未开启', unsubmitted: true }
          } else if (status !== null && status.todayCheckedIn) {
            outcome = { kind: 'already-claimed', message: '今天已签到' }
          } else if (status === null && deps.requireStatus) {
            outcome = { kind: 'failed', code: -1, message: '签到状态读取失败', unsubmitted: true }
          } else {
            // 状态查询失败（status 为 null）时仍然尝试领取：
            // 无法确认不代表不能领，交给领取接口以响应体 code 定夺。
            outcome = await claim(credential, product, entry)
          }
        }
      }
    } catch (error) {
      deps.warn?.(`[channel-pack] credits.claimAll 账号 ${entry.id} 失败: ${String(error)}`)
      outcome = {
        kind: 'failed', code: -1,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    outcomes.push(outcome)
    results.push({ accountId: entry.id, nickname: entry.nickname, outcome })
  }
  return { results, summary: computeClaimSummary(outcomes) }
}

/**
 * 逐账号收集积分余额（顺序执行，避免并发触发风控）。
 *
 * 与 {@link collectCreditsStatus} 的关键差异：**这里保留失败原因**。
 * 余额查不到时用户最需要知道"为什么"（凭据过期？网络不通？），把它降级成
 * 一个 null 会让账号卡片显示成空白或 0 分，反而误导。因此失败时带上 error 文案。
 *
 * **包含已停用账号**：停用只影响账号池的自动选择，与"这个账号还剩多少积分"
 * 无关——用户就是想在同一个列表里看全部账号的余额。
 *
 * 凭据解析同样位于每个账号自己的 try 之内：单个账号的凭据缺失/损坏/名称非法
 * 都不会冒泡中断整批。
 */
export async function collectCreditBalances<TCredential = unknown, TProduct = unknown>(
  accounts: readonly ProviderAccountEntry[],
  product: TProduct,
  deps: CreditsEndpointDeps<TCredential, TProduct>,
): Promise<RpcCreditsBalancesResponse['accounts']> {
  const fetchBalance = deps.fetchBalance ?? (async () => { throw new Error('该渠道未提供余额查询') })
  const fetchDetailed = deps.fetchBalanceDetailed
  const results: RpcCreditsBalancesResponse['accounts'] = []
  // 顺序查询，避免并发触发风控
  for (const entry of accounts) {
    let balance: CreditBalance | null = null
    let error: string | undefined
    let extra: RpcCreditsBalanceExtra | undefined
    try {
      const resolved = await deps.resolve(credentialRef(entry.credentialRef))
      if (resolved === undefined) {
        error = '凭据未配置'
      } else {
        const credential = JSON.parse(resolved.value) as TCredential
        if (fetchDetailed !== undefined) {
          // 带原因的查询：实现自己决定「非积分账户」等业务状态的文案。
          const detailed = await fetchDetailed(credential, product)
          balance = detailed.balance
          error = detailed.error
          extra = detailed.extra
          if (balance === null && error === undefined) error = '余额查询失败'
        } else {
          balance = await fetchBalance(credential, product)
          // 查询函数以 null 表示"查不到"（网络/业务码异常），与"余额为 0"不同
          if (balance === null) error = '余额查询失败'
        }
      }
    } catch (caught) {
      deps.warn?.(`[channel-pack] credits.balances 账号 ${entry.id} 失败: ${String(caught)}`)
      error = caught instanceof Error ? caught.message : String(caught)
      balance = null
    }
    results.push({
      accountId: entry.id,
      nickname: entry.nickname,
      balance,
      ...error === undefined ? {} : { error },
      ...extra === undefined ? {} : { extra },
    })
  }
  return results
}

/** `ctx.llm` 上本模块实际用到的部分。 */
type LlmServiceLike = {
  listProviders?(): readonly { id: string }[]
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>
  listAllModels?(provider: string): readonly { id: string; name: string }[]
  /**
   * 可选：解析单个模型的精确元信息（**思考档位**只在这里）。
   *
   * ⚠️ 声明为可选：网关的档位对照表是附加能力，宿主没提供时目录照常返回，
   * 只是每个模型不带档位字段。
   */
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
  /** Host notification that makes the conversation picker re-read listModels. */
  emitAdaptersUpdated?: () => void
}

/**
 * 读取 `ctx.llm` 用于枚举 provider 的模型目录。
 *
 * ## ⚠️ 必须**优先属性访问** `ctx.llm`
 *
 * `src/index.ts` 里 `mountOpenAiGateway` 传的是 `ctx.llm`（属性），而本模块
 * 原先只走 `ctx.get('llm')`。在 connection 上下文里后者可能拿不到
 * `listProviders` —— 结果是**同一时刻**两个页面给出矛盾答案：
 * `/v1/models` 正常返回 36 个模型，而设置页的清单恒为 0 个。
 * 两处服务来源不一致还会让「纠错建议里给的 ID」与「网关实际接受的 ID」可能不同。
 *
 * 用 `ctx.get`（而非插件级 `inject`）作回退：Channel Pack 的账号管理是主要职责，
 * 模型开关只是附加能力；llm 服务完全缺失时账号面板仍应可用。
 *
 * `listAllModels` 是本插件适配器额外提供的**不受用户黑名单影响**的完整目录
 * （见各适配器的同名方法）。DSH 的 `llm` 服务只保证 `listModels`，故它与
 * `listProviders` 都声明为可选。
 */
function llmServiceOf(ctx: Context): LlmServiceLike | undefined {
  const direct = (ctx as unknown as { llm?: LlmServiceLike }).llm
  if (direct !== undefined && direct !== null) return direct
  return ctx.get('llm') as LlmServiceLike | undefined
}

/**
 * 采集网关目录（**含思考档位视图**）。
 *
 * ⚠️ 两个 RPC 分支（`gateway.getEnabled` / `gateway.setEnabled`）必须共用本函数：
 * 设置页看到的档位与 `/v1/reasoning-efforts` 返回的必须同源，各算一遍必然漂移，
 * 而漂移的症状是「照着设置页填的对不上网关实际接受的」—— 本功能存在的全部理由
 * 就是消灭这种对照错误，自己再造一个就毫无意义了。
 *
 * 档位要逐模型 `resolveModelInfo` 才拿得到（`listModels` 不带），成本是每个模型
 * 一次**读缓存**的调用（远端目录刚被 `listModels` 拉过），与 DSH 自己
 * `buildModelCatalog` 的形状一致。
 */
async function collectGatewayCatalog(
  llm: LlmServiceLike | undefined,
  providers: readonly { id: string }[],
  onError: (provider: string, error: unknown) => void,
): Promise<RpcGatewayModel[]> {
  const source: GatewayModelSource = {
    listProviders: () => providers,
    listModels: (provider) => llm!.listModels(provider),
  }
  const resolve = llm?.resolveModelInfo
  if (typeof resolve === 'function') {
    source.resolveModelInfo = (provider, model) => resolve.call(llm, provider, model)
  }
  const groups = await collectGatewayModels(source, onError)
  const views = await collectGatewayEffortViews(source, groups, onError)
  return toGatewayModelIds(groups, views)
}

/**
 * 列出可用于枚举目录的 provider。
 *
 * ⚠️ `listProviders` 取不到时**用已注册适配器的 key 兜底** —— 那些 key 就是本
 * 插件注册的 provider 全集，比「什么都没有」有用得多。仍取不到才返回
 * `undefined`（调用方据此给出明确原因，而不是显示一个空清单让用户去猜）。
 */
function providerIdsOf(
  llm: LlmServiceLike | undefined,
  modelAdapters: Readonly<Record<string, ModelCatalogSource>> | undefined,
): readonly { id: string }[] | undefined {
  if (llm?.listProviders !== undefined) {
    try {
      const listed = llm.listProviders()
      if (Array.isArray(listed) && listed.length > 0) return listed
    } catch {
      // 落到下面的兜底。
    }
  }
  const keys = Object.keys(modelAdapters ?? {})
  return keys.length > 0 ? keys.map((id) => ({ id })) : undefined
}

/** RPC 的可选配置；追加字段以兼容现有 provider / modelAdapters 的位置参数调用。 */
export interface ChannelPackRpcConfig {
  nativeOnly?: boolean
  allowedProviders?: readonly string[]
  onRpc?: (call: (method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>) => void
  /**
   * Raccoon **订阅版**（`raccoon-pro`）认证实例。
   *
   * ⚠️ 走 `config` 而不是新增**位置形参**：`registerChannelPackRpc` 的历史
   * 事故全是位置传参错位（本文件上方已记录）。免费版实例仍是既有形参
   * `raccoon`（保持不变），订阅版作为可选项从 config 注入，家族数组据此组装；
   * 省略时家族里只有免费版，`raccoon-pro` 的请求会被判为不支持渠道。
   */
  raccoonPro?: RaccoonAuth
}

/**
 * 注册 Channel Pack 管理 API 端点。
 *
 * `connection` 服务只存在于 Web bundle；这里用**惰性注入**而非插件级静态
 * `inject`，因此在 headless / CLI profile 下本模块正常加载、只是不注册端点，
 * 而不是把整个插件树卡在 pending（那会让 profile 启动直接失败）。
 */
export function registerChannelPackRpc(
  ctx: Context,
  pool: AccountPool,
  qoder: QoderAuth,
  /** Qoder **中国版**实例（与 `qoder` 同协议、不同 product；RPC 分支按注册表分派）。 */
  qoderCn: QoderAuth,
  trae: TraeAuth,
  raccoon: RaccoonAuth,
  /**
   * provider → 适配器实例（可选）。
   *
   * 用于「显示列表」拿到**不受用户黑名单影响**的全量目录（`listAllModels`），
   * 使被关闭的模型也能显示正确的展示名（含倍率），而不是退化成裸 id。
   * 省略时退化为只用 `ctx.llm.listModels()` 的历史行为。
   */
  modelAdapters?: Readonly<Record<string, ModelCatalogSource>>,
  config: ChannelPackRpcConfig = {},
): void {
  ctx.inject(['connection'], (connectionCtx) => {
    registerChannelPackEndpoints(
      connectionCtx as Context, pool,
      qoder, qoderCn, trae, raccoon, modelAdapters, config,
    )
  })
}

/**
 * 「显示列表」所需的最小适配器接口：能给出**不套用户黑名单**的完整目录。
 *
 * 只声明用到的方法（结构化类型），避免让本模块依赖五个具体适配器类。
 */
export interface ModelCatalogSource {
  listAllModels(): readonly {
    id: string; name: string; isFree?: boolean; subscriptionOnly?: boolean; stale?: boolean; staleReason?: string
    contextWindow?: number; maxTokens?: number; defaultMaxTokens?: number; efforts?: readonly string[]
    defaultEffort?: string; supportsImage?: boolean; rateBadge?: ModelRateBadge
  }[]
  /**
   * 手动刷新远端目录（可选能力）。返回本次目录的来源与条数。
   *
   * ⚠️ **可选**：外部/旧适配器没有这个方法，`model.refresh` 会明确拒绝，
   * 而不是静默返回空结果让界面以为「刷新成功但没模型」。
   */
  refreshRemoteModels?(): Promise<{ count: number; source: 'remote' | 'fallback' }>
  /**
   * 当前目录是否来自**远端真拉**（可选能力）。
   *
   * `model.list` 用它决定能否按目录剪掉历史遗留的模型黑名单条目：只有远端目录
   * 才是「上游全量」的证据，离线兜底表只是精选子集。
   */
  isRemoteCatalog?(): boolean
  catalogStatus?(): { source: 'remote' | 'cached' | 'fallback'; issue?: string }
}

/**
 * 广播「模型目录可能已变化」。
 *
 * ⚠️ **改黑名单后必须调用**，否则「关闭后选择器里仍能看到该模型，重启后才消失」
 * （真实缺陷，用户报障）。根因在客户端而非适配器：
 * `dsh-client-ui-model-selection` 的 `ModelCatalogDirectory` 把 `modelCatalog`
 * 响应存进一个 `status === 'ready'` 即**短路返回缓存**的 store，只在三个转发的
 * 宿主事件上 `refresh()`：`llm/adapters-updated` / `settings/document-updated`
 * / `credentials/reference-updated`。
 *
 * 0.1.7 起黑名单落在插件自有文档 `$DSH_HOME/channel-pack/state.json`（不再经 settings
 * 文档，见 channel-pack-store.ts），因此写开关**不会**触发上述任何一个事件 → 客户端
 * 一直复用旧目录，直到重启（`connection/reset` → `resetGeneration()`）才重拉。
 *
 * 三者中 `llm/adapters-updated` 最贴合：按契约它是**无载荷**的「目录可能变了，
 * 请重新读 listModels」通知（dsh-llm README：*consumers re-read the registries*），
 * 正是这里要表达的语义。它也在 `API_REMOTE_FORWARDED_EVENTS` 白名单里，故会真的
 * 送达浏览器。不改变拓扑，故 dsh-llm 的 invariant 监听（对每个 provider 读一次
 * `retryPolicy`）必然通过，不会误报 INVARIANT。
 *
 * ⚠️ **通知失败不能反噬已经落盘的开关**：否则用户看到「切换失败」而实际已生效，
 * 再点一次又因幂等而看似「无效」，比不提示更难排查。故这里自行吞掉异常只记日志。
 */
function llmEmitAdaptersUpdated(ctx: Context): void {
  const read = (target: Context | undefined) => {
    if (target == null) return undefined
    try { return llmServiceOf(target) } catch { return undefined }
  }
  const root = (ctx as Context & { root?: Context }).root
  const llm = read(ctx) ?? (root != null && root !== ctx ? read(root) : undefined)
  llm?.emitAdaptersUpdated?.()
}

function broadcastCatalogChanged(ctx: Context): void {
  // `ctx.emit` from the connection fiber does not reach the composer. The host
  // LLM service's `emitAdaptersUpdated` is what refreshes `session.modelCatalog`.
  // The plain emit stays so a composition without that method, and tests that
  // capture `llm/adapters-updated`, still observe the change.
  try {
    llmEmitAdaptersUpdated(ctx)
  } catch (error) {
    ctx.logger.warn(`[channel-pack] 通知模型目录刷新失败：${String(error)}`)
  }
  try {
    ctx.emit('llm/adapters-updated')
  } catch (error) {
    ctx.logger.warn(`[channel-pack] 广播模型目录变更事件失败：${String(error)}`)
  }
}

/**
 * 取某 provider 的**全量模型 id**（不套黑名单），供「关闭全部」与「关闭供应商」共用。
 *
 * 两条路径的优先级（与 `model.list` 保持一致的取舍，但**不需要展示名**：
 * 这里只要 id 来写黑名单，故不走 `model.list` 那套回填 disabled 的复杂逻辑）：
 * 1. 优先 `modelAdapters[provider].listAllModels()` —— **同步**，不触发远端拉取；
 * 2. 缺失时退化 `llm.listModels(provider)` —— 异步，且**结果已被黑名单过滤**。
 *
 * ⚠️ 第 2 条路径拿不到「已关闭」的模型（它们不在 `listModels` 返回值里），
 * 故它写出的黑名单是**不完整**的。这对「关闭全部」无影响（已关闭的本就无需再关），
 * 但意味着**不能用它判断「是否全部已关闭」** —— 状态判定必须用
 * `listAllModels()` 的全量目录（见 `provider.status`）。
 *
 * @returns `{ ids }` 成功；`{ error }` 失败原因（调用方据此拒绝且**不落盘**）。
 */
async function fullCatalogIds(
  ctx: Context,
  modelAdapters: Readonly<Record<string, ModelCatalogSource>> | undefined,
  provider: string,
): Promise<{ ids: string[] } | { error: string }> {
  const all = modelAdapters?.[provider]?.listAllModels()
  if (all !== undefined) return { ids: all.map((model) => model.id) }
  const llm = llmServiceOf(ctx)
  if (llm === undefined) return { error: 'llm 服务不可用' }
  try {
    return { ids: (await llm.listModels(provider)).map((model) => model.id) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { error: `读取模型列表失败：${reason}` }
  }
}

/** 注册 Channel Pack 管理 API 端点。使用 ctx.connection.fetch.register() 注册 HTTP POST 端点。 */
function registerChannelPackEndpoints(
  ctx: Context,
  pool: AccountPool,
  qoder: QoderAuth,
  qoderCn: QoderAuth,
  trae: TraeAuth,
  raccoon: RaccoonAuth,
  modelAdapters?: Readonly<Record<string, ModelCatalogSource>>,
  config: ChannelPackRpcConfig = {},
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connection = config.nativeOnly
    ? { fetch: { register: (_route: unknown) => {} } }
    : (ctx as any).connection ?? ctx.get('connection')
  if (!connection || typeof connection.fetch?.register !== 'function') {
    ctx.logger.warn('[channel-pack] connection.fetch not available, RPC endpoints not registered')
    return
  }

  /**
   * Qoder **同协议族**成员：国际版与中国版共用同一组 RPC 实现，只换 `product`
   * 与 `auth` 实例。
   */
  interface QoderFamilyMember {
    readonly product: QoderProduct
    readonly auth: QoderAuth
  }
  const qoderFamily: readonly QoderFamilyMember[] = [
    { product: QODER, auth: qoder },
    { product: QODER_CN, auth: qoderCn },
  ]
  /** 该 provider 是否属于 Qoder 同族（国际版或中国版）。 */
  const isQoderFamily = (provider: string): boolean =>
    qoderFamily.some((member) => member.product.id === provider)
  /**
   * 取同族成员；不存在时抛错。
   *
   * ⚠️ 调用方**必须**先用 `isQoderFamily()` 判定。这里抛错而不是返回
   * `undefined`，是为了让分支内部不必写 `!` 或 `as` —— 那两类断言会在
   * 将来有人把判定改成别的条件时静默失效。
   */
  const requireQoderFamily = (provider: string): QoderFamilyMember => {
    const member = qoderFamily.find((item) => item.product.id === provider)
    if (member === undefined) throw new Error(`Unknown Qoder family provider: ${provider}`)
    return member
  }

  /**
   * Raccoon **同协议族**成员：免费版（`raccoon`）与订阅版（`raccoon-pro`）共用
   * 同一套登录 / 续期 / 奖励 / 余额实现，只换 `product` 与 `auth` 实例。
   *
   * ⚠️ 与 Qoder 家族的差别：那边的两个实例都是**位置形参**（`qoder` /
   * `qoderCn`），这里的订阅版来自 `config.raccoonPro`（可选）。因此数组长度
   * 取决于装配：没注入订阅版实例时，`raccoon-pro` 的请求按「不支持此渠道」拒绝，
   * 不会静默落到免费版的账号池 —— 那是比报错更坏的串号。
   *
   * ⚠️ 两个产品的账号池天然隔离（账号池按 `provider` 字段分组），故这里的
   * 分派**只决定用哪个 auth 实例**，不需要额外做隔离。
   */
  interface RaccoonFamilyMember {
    readonly product: RaccoonProduct
    readonly auth: RaccoonAuth
  }
  const raccoonFamily: readonly RaccoonFamilyMember[] = [
    { product: RACCOON, auth: raccoon },
    ...config.raccoonPro === undefined ? [] : [{ product: RACCOON_PRO, auth: config.raccoonPro }],
  ]
  /** 该 provider 是否属于 Raccoon 同族（免费版或订阅版）。 */
  const isRaccoonFamily = (provider: string): boolean =>
    raccoonFamily.some((member) => member.product.id === provider)
  /**
   * 取 Raccoon 同族成员；不存在时抛错（理由与 `requireQoderFamily` 一致：
   * 调用方必须先用 `isRaccoonFamily()` 判定，这里抛错以免分支内出现
   * 将来会静默失效的 `!` / `as` 断言）。
   */
  const requireRaccoonFamily = (provider: string): RaccoonFamilyMember => {
    const member = raccoonFamily.find((item) => item.product.id === provider)
    if (member === undefined) throw new Error(`Unknown Raccoon family provider: ${provider}`)
    return member
  }

  /**
   * 登录后台失败的终态（账号占位条目会被清掉，所以不能再靠 account.list
   * 判断失败）。短暂保留失败原因，让前端下一次 login.poll 能收到可读反馈，
   * 而不是继续等待十分钟直到超时。
   */
  const pendingLoginFailures = new Map<string, string>()

  /**
   * 用量徽标的显示偏好（`$DSH_HOME/channel-pack/ui-preferences.json`）。
   *
   * ⚠️ 与账号池**分开**的独立文档：`state.json` 是整体替换语义，同机另一条工作区
   * 里的旧版本代码整体重写它时不会带上不认识的键 —— 理由与后果见
   * `badge-preferences.ts` 的文件头。
   */
  const badgePreferences = createBadgePreferenceStore(ctx)

  /**
   * 「每日首次启动自动签到」（独立文档 `auto-checkin.json`）。
   *
   * ⚠️ **不维护第二份「哪些渠道能签到」的名单**：判据交给下面的 `claim` ——
   * `credits.claimAll` 对不支持的渠道会**不发上游请求**就返回明确错误，本执行体
   * 把它计为「跳过」。客户端的能力表（`credits-capabilities.js`）仍是唯一权威。
   *
   * ⚠️ 「有账号的渠道」由账号池派生（`pool.listAllAccounts()` 只是同步内存副本
   * 的异步外壳），不遍历 12 个渠道里没账号的那些 —— 那些调下去只会拿到空结果。
   */
  const autoCheckin = createAutoCheckin({
    store: createAutoCheckinStore(ctx),
    listProviderIds: async () => {
      const accounts = await pool.listAllAccounts()
      return [...new Set(accounts.filter((entry) => isSupportedProvider(entry.provider) && (!config.allowedProviders || config.allowedProviders.includes(entry.provider))).map((entry) => entry.provider))].sort()
    },
    claim: (provider) =>
      handleMethod('credits.claimAll', { provider }) as Promise<BadgeRpcResult<RpcCreditsClaimAllResponse>>,
    warn: (message) => ctx.logger?.warn?.(message),
  })
  // 启动时排定一轮（延迟 30s；内部自己判开关与「今天是否已跑」）。
  if (!config.nativeOnly) autoCheckin.start()
  /**
   * ⚠️ `ctx.effect` 必须**可选调用**：本文件此前没用过它，而大量单测的 ctx 桩是
   * 最小化的（没有 `effect`）—— 直接调用会让 138 条无关用例报
   * `ctx.effect is not a function`（2026-10-02 实测到）。真实宿主里它一定存在，
   * 故这里的降级只影响桩环境，不影响生产环境的清理语义。
   */
  ctx.effect?.(() => () => autoCheckin.stop(), 'channel-pack: auto checkin')

  /**
   * 用量徽标读数服务（宿主侧 TTL 缓存 + 只保留启用账号）。
   *
   * ⚠️ 必须有这一层：`usage.badge` 端点直接调 `usageBadge.read(...)`，
   * 装配缺失会在该端点被调用时抛 ReferenceError（本仓库真实踩过 —— 删渠道时
   * 连装配块一起删了，而调用点还在）。
   *
   * `collectQuota` 留给「有独立额度窗口接口」的渠道：本插件当前没有这样的渠道
   * （原 Cline 的订阅窗口随它一并移除），恒返回 undefined 即表示「本次没有额外读数」。
   */
  const usageBadge = createUsageBadge({
    collectBalances: (provider) =>
      handleMethod('credits.balances', { provider }) as Promise<BadgeRpcResult<RpcCreditsBalancesResponse>>,
    collectQuota: () => undefined,
    listAccounts: (provider) => pool.listAccountsByProvider(provider),
    readPreference: () => badgePreferences.load(),
    readAutoCheckin: () => autoCheckin.state(),
    warn: (message) => ctx.logger?.warn?.(message),
  })

  config.onRpc?.(handleMethod)
  connection.fetch.register({
    path: CHANNEL_PACK_API_PATH,
    methods: ['POST'],
    requestBody: 'buffered' as const,
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 })
      }
      const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let message: Record<string, unknown>
      try {
        message = await request.json() as Record<string, unknown>
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const rpcId = typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request'
      const call = message.payload as Record<string, unknown> | undefined
      if (
        message.type !== 'client-request' || typeof message.rpcId !== 'string'
        || message.method !== CHANNEL_PACK_ENDPOINT
        || !call || typeof call.method !== 'string'
        || !Object.prototype.hasOwnProperty.call(call, 'payload')
      ) {
        return reply(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: 'Invalid Channel Pack management request.' } })
      }

      try {
        const result = await handleMethod(call.method as string, call.payload, request.signal)
        return reply(rpcId, result)
      } catch (error) {
        // 必须返回规范的 RPC 错误响应（而不是裸 500 文本），
        // 否则客户端 unwrapRpcResult 无法识别错误，表现为"点击无反应"。
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[channel-pack] ${String(call.method)} failed: ${message}`)
        return reply(rpcId, {
          ok: false,
          error: { code: 'channel-pack/handler-failed', message },
        })
      }
    },
  })

  /**
   * 分发端点方法到对应的处理器。
   *
   * 顺序纪律：先做**渠道归属校验**（allowedProviders / isSupportedProvider），
   * 再进 `switch`。校验必须在前面 —— 否则退役或未注册的 provider 会先被某个
   * case 误吞，用户看到的错误就变成「方法不存在」而不是真正的「渠道不支持」。
   */
  async function handleMethod(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    // 旧客户端仍可能携带退役 provider 或历史账号 id。拒绝调用但不删除数据。
    const request = payload !== null && typeof payload === 'object'
      ? payload as Record<string, unknown> : undefined
    const account = typeof request?.accountId === 'string' ? pool.findAccount(request.accountId) : undefined
    if (config.allowedProviders) {
      const allowed = config.allowedProviders
      if ((request?.provider !== undefined && !allowed.includes(String(request.provider)))
        || (account !== undefined && !allowed.includes(account.provider))
        || (Array.isArray(request?.providers) && request.providers.some(id => !allowed.includes(String(id))))) {
        return { ok: false, error: { code: 'provider-unsupported', message: '仅支持已启用的渠道。' } }
      }
    }
    if ((request?.provider !== undefined && !isSupportedProvider(request.provider)) || (account !== undefined && !isSupportedProvider(account.provider))) {
      return { ok: false, error: { code: 'provider-unsupported', message: '不支持此渠道。' } }
    }
    switch (method) {
      case 'account.list': {
        const req = payload as RpcListAccountsRequest
        const accounts = await pool.listAccounts(req.provider)
        // TRAE：为每个启用中的账号附上订阅类型（`Free` / `Pro` / `Pro+` / `Ultra` /
        // `Express`）。只读 + 60s 缓存 + 失败静默，绝不让账号列表整体失败。
        if (req.provider === TRAE.id) {
          for (const account of accounts) {
            if (account.enabled === false) continue
            try {
              // `resolveCredentialForAccount` 返回**已解析的凭据对象**（非 { value } 包装）。
              const resolved = await pool.resolveCredentialForAccount(account.id)
              const credential = resolved as TraeCredential | undefined
              if (credential === undefined || typeof credential.access_token !== 'string' || credential.access_token.length === 0) continue
              const payStatus = await fetchTraePayStatus(credential, TRAE)
              if (payStatus !== null) account.planLabel = payStatus.identity
            } catch {
              // 付费状态只是展示信息：拿不到就不显示，不阻塞账号列表。
            }
          }
        }
        if (config.nativeOnly && (payload as { forCheckin?: boolean }).forCheckin === true) {
          const ready = await Promise.all(accounts.map(async account =>
            (account.expiresAt == null || account.expiresAt > Date.now()) &&
            !!await pool.resolveCredentialForAccount(account.id)))
          return { ok: true, value: { accounts: accounts.filter((_account, index) => ready[index]) } }
        }
        return { ok: true, value: { accounts } }
      }

      case 'account.create': {
        const req = payload as RpcCreateAccountRequest
        const { provider } = req
        const id = `${provider}-${shortId()}`
        const suffix = shortId().toUpperCase()
        // ⚠️ 凭据 ref 前缀只允许 `A-Z0-9`（既有全部 ref 都是这个字符集），而
        // provider id 可能带连字符（如 `raccoon-pro`）—— 直接 `toUpperCase()`
        // 会得到 `RACCOON-PRO_ACCOUNT_XXX`。故去掉非字母数字字符：
        // `raccoon-pro` → `RACCOONPRO_ACCOUNT_XXX`。
        // ⚠️ 必须与 `channel-pack-store.ts` 的 REF_PREFIX_TO_PROVIDER 表一致，
        // 否则 `state.json` 丢失时该 provider 的账号无法从凭据文件恢复。
        const refName = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '')}_ACCOUNT_${suffix}`
        if (isQoderFamily(provider)) {

          // 但登录机制不同：它是**设备码轮询**（不开本地回调服务器，见 src/qoder-oauth.ts），

          //
          // ⚠️ 分支内一律用 `product` / `auth`，**不要**出现 `QODER` 字面量 ——
          // 否则中国版会拿国际版的域名与 client_id 发请求。
          const { product, auth } = requireQoderFamily(provider)
          const started = await auth.startLogin({ refName })
          // 先登记启用的占位条目（无凭据），使前端 login.poll 能立即看到该账号；
          // 登录成功后再回填昵称/有效期等真实字段。
          await pool.addAccount({
            id,
            provider: product.id,
            nickname: id,
            enabled: true,
            credentialRef: refName,
            refreshable: false,
            createdAt: Date.now(),
          })
          started.result.then(async (loginResult) => {
            const credential = parseQoderCredential(loginResult.access)
            // ⚠️ 设备码轮询响应**不带 `user_name`**，故 `credential.nickname` 恒为空
            // —— 必须补一次 userinfo 才能拿到真实名字，否则账号卡片只能显示
            // `qodercn-xxxx`（多账号无法区分）。见 `fetchQoderUserNickname` 的说明。
            //
            // ⚠️ **失败不阻塞登录**：昵称只是展示信息，拿不到就退回账号 id
            //（与 `toLoginFlowResult` 对过期时间的处理同原则）。
            let nickname = credential?.nickname
            if ((nickname === undefined || nickname.length === 0) && credential !== undefined) {
              nickname = await fetchQoderUserNickname(credential, product)
              // 写回**凭据**（不只账号条目）：账号条目会随 Channel Pack 的账号操作
              // 整体重写，而凭据里存一份才能在续期后与其它面板都稳定拿到。
              if (nickname !== undefined && loginResult.access.length > 0) {
                const updated = withQoderNickname(credential, nickname)
                await ctx.credentials.set(credentialRef(refName), JSON.stringify(updated))
              }
            }
            await pool.updateAccount(id, {
              nickname: nickname !== undefined && nickname.length > 0 ? nickname : id,
              expiresAt: credential !== undefined ? qoderCredentialExpiresAtMs(credential) : undefined,
              refreshable: credential !== undefined && isQoderRefreshable(credential),
            })
          }).catch((error: unknown) => {
            ctx.logger.warn(`[channel-pack] background ${product.id} login failed for ${id}: ${String(error)}`)
            // 登录失败：移除占位条目，避免留下无凭据的幽灵账号
            void pool.removeAccount(id).catch(() => {})
          })
          return { ok: true, value: { accountId: id, loginUrl: started.loginUrl } }
        } else if (provider === TRAE.id) {

          const started = await trae.startLogin({ refName })
          // 先登记启用的占位条目（无凭据），使前端 login.poll 能立即看到该账号；
          // 登录成功后再回填昵称/有效期等真实字段。
          await pool.addAccount({
            id,
            provider: TRAE.id,
            nickname: id,
            enabled: true,
            credentialRef: refName,
            refreshable: false,
            createdAt: Date.now(),
          })
          started.result.then(async (loginResult) => {
            const credential = parseTraeCredential(loginResult.access)
            await pool.updateAccount(id, {
              // ⚠️ 用 `traeDisplayNickname`（手机号优先）而非直接取 `nickname`：
              // 服务端 ScreenName 是**按 uid 自动生成的默认名**，多账号无法区分
              // （用户报障 2026-09-27）。见该函数的说明。
              nickname: traeDisplayNickname(credential, id),
              expiresAt: credential !== undefined ? traeCredentialExpiresAtMs(credential) : undefined,
              refreshable: credential !== undefined && isTraeRefreshable(credential),
            })
          }).catch((error: unknown) => {
            ctx.logger.warn(`[channel-pack] background ${TRAE.id} login failed for ${id}: ${String(error)}`)
            // 登录失败：移除占位条目，避免留下无凭据的幽灵账号
            void pool.removeAccount(id).catch(() => {})
          })
          return { ok: true, value: { accountId: id, loginUrl: started.loginUrl } }
        } else if (isRaccoonFamily(provider)) {
          // raccoon（免费版 / 订阅版同族）走**本地页承载**的微信扫码 / 短信双路径登录：
          // `startLogin` 立即返回指向 127.0.0.1 的 `loginUrl`，后台 await 结果。
          //
          // ⚠️ 绝不能在用户授权完成后才返回 loginUrl —— `window.open` 只在
          //    用户手势窗口内有效，那时手势早已过期、弹窗必被拦截。
          //
          // ⚠️ 先登记**占位条目**（无凭据），使前端 `login.poll` 能立即看到该账号；
          //    登录成功后再回填昵称与 refreshable。失败则删除占位条目。
          //
          // ⚠️ **单池**（2026-11 架构二次修订）：无论请求来自免费版还是订阅版，
          //    账号一律进 `raccoon` 池，凭据 ref 也用 `RACCOON_ACCOUNT_*` 前缀。
          //    哪个账号服务哪个模型面由**登录后的套餐探测**写进 `plan` 字段决定
          //    （见下面的后台任务与 `src/backend.ts` 的 `mountRaccoon`）——
          //    把账号分池会让「用户选错卡片」永久错配，而套餐是会变的。
          //    登录页/短信等中间态由 `startLogin` 内部的本地页承载、按流程实例
          //    持有，不经 RPC 或 provider 键控的状态表，故两变体不会串。
          const raccoonMember = requireRaccoonFamily(provider)
          const raccoonRefName = `${RACCOON.id.toUpperCase().replace(/[^A-Z0-9]+/g, '')}_ACCOUNT_${suffix}`
          await pool.addAccount({
            id,
            provider: RACCOON.id,
            nickname: id,
            enabled: true,
            credentialRef: raccoonRefName,
            refreshable: false,
            createdAt: Date.now(),
          })

          let raccoonStarted: StartedRaccoonLoginFlow
          try {
            raccoonStarted = await raccoonMember.auth.startLogin()
          } catch (error) {
            // 起本地服务器失败：删掉占位条目，不留幽灵账号。
            void pool.removeAccount(id).catch(() => {})
            const reason = error instanceof Error ? error.message : String(error)
            throw new Error(`无法启动 Raccoon 登录（本地登录页启动失败）：${reason}`)
          }

          raccoonStarted.result.then(async (credential) => {
            const result = await raccoonMember.auth.persistLogin(credential, { refName: raccoonRefName })
            const saved = JSON.parse(result.access) as RaccoonCredential
            // 套餐探测：登录**已成功**，探测只决定这个账号服务哪一侧的模型
            //（免费 / 订阅）。⚠️ 失败一律 `'unknown'`（按免费侧处理）且
            // **不阻塞登录** —— 拿不到套餐不该让用户反复重登。
            const plan = await raccoonMember.auth.fetchPlan(saved)
            await pool.updateAccount(id, {
              // ⚠️ 服务端的 `name` 是**自动生成的默认名**（本机账号是
              // `RaccoonAva`，即「Raccoon」+ 随机串），微信扫码**不回传微信昵称**
              //（`wechat_bindings` 只有绑定 id 与时间，无昵称/头像）。
              // 它是账号的**正式名字**（JWT payload 里也有 `name`，官方客户端
              // 就显示它），故**保留**；但若注册第二个账号，服务端很可能又给一个
              // 相近的默认名 → 多账号重名、无法区分。
              //
              // 故追加**手机号尾号**消歧：`RaccoonAva (1100)`。
              // 保留服务端原名，再挂手机号尾号消歧。
              nickname: buildRaccoonNickname(saved, id),
              expiresAt: result.expires > 0 ? result.expires : undefined,
              // ⚠️ raccoon **有** refresh 端点，这里是真续期。
              refreshable: result.refreshable,
              // 与昵称/有效期**同一次落盘**：分两次写会多一次整文档重写，
              // 且中途失败会留下「有昵称无套餐」的半态。
              plan,
            })
            ctx.logger.info(`[channel-pack] raccoon 账号 ${id} 套餐探测结果：${plan}`)
          }).catch((error: unknown) => {
            ctx.logger.warn(`[channel-pack] background ${provider} login failed for ${id}: ${String(error)}`)
            // 登录失败：移除占位条目，避免留下无凭据的幽灵账号
            void pool.removeAccount(id).catch(() => {})
          })

          return { ok: true, value: { accountId: id, loginUrl: raccoonStarted.loginUrl } }
        } else {
          return { ok: false, error: { code: 'bad-request', message: `unknown provider: ${provider}` } }
        }
      }

      case 'account.update': {
        const req = payload as RpcUpdateAccountRequest
        await pool.updateAccount(req.accountId, req.patch)
        return { ok: true, value: undefined }
      }

      case 'account.delete': {
        const req = payload as RpcDeleteAccountRequest
        await pool.removeAccount(req.accountId)
        return { ok: true, value: undefined }
      }

      // 拖拽排序：重写该 provider 账号在池中的顺序。
      // 该顺序是自动选号与限流换号的候选优先级，因此不是纯 UI 操作。
      case 'account.reorder': {
        const req = payload as RpcReorderAccountsRequest
        if (typeof req.provider !== 'string' || req.provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        if (!Array.isArray(req.orderedIds) || req.orderedIds.some(id => typeof id !== 'string')) {
          return { ok: false, error: { code: 'bad-request', message: 'orderedIds 必须是字符串数组' } }
        }
        try {
          await pool.reorderAccounts(req.provider, req.orderedIds)
        } catch (error) {
          // 集合不一致（前端列表过期）是可预期的并发情况，回可读错误让用户
          // 刷新重试，而不是抛成 channel-pack/handler-failed 那种「未知故障」。
          return {
            ok: false,
            error: {
              code: 'bad-request',
              message: error instanceof Error ? error.message : String(error),
            },
          }
        }
        return { ok: true, value: undefined }
      }

      case 'account.refresh': {
        const req = payload as RpcRefreshAccountRequest
        try {
          const accounts = await pool.listAllAccounts()
          const entry = accounts.find((a) => a.id === req.accountId)
          if (!entry) throw new Error(`Account ${req.accountId} not found`)

          // 按 **entry.provider** 分派到对应服务，并调用**按凭据 ref 的**
          // 续期入口 —— 三处都是修复既有缺陷的关键：
          //

          // 2. 原实现调的是 `service.refresh()`，它读写的是该 provider 的

          //    结果要么报错要么静默改了错的对象。
          // 3. ⚠️ **每个分支都必须传 `pool` + `entry.id`**（issue !IKIRTT）：
          //    续期成功后要把新的 `expiresAt` 写回账号池，UI 才不再显示
          //    「已过期」。早先只有 raccoon 分支传了，其余七个分支漏传，
          //    凭据续好了、界面纹丝不动，用户没有任何自救手段。
          //
          // ⚠⚠ **本端点没有面板入口**（issue IKJOZA 取证）：账号卡片上并没有
          // 「刷新」按钮（按钮是 测试/重测/重置/停用/代理/指纹/删除），
          // 调用方是仓库外的脚本/手工 RPC。下面三处历史注释曾把它写成
          // 「账号卡片的刷新按钮」——那是失实的，会把排障的人引到不存在的 UI。
          switch (entry.provider) {
            case QODER.id:
            case QODER_CN.id:
              // 同协议族：按 provider 找到对应实例。
              // ⚠️ 只刷传入的这个 ref，不碰默认单凭据 ref（历史缺陷同因）。
              // ⚠️ **不要**图省事写 `qoder.refreshAccountCredential(...)` ——
              // 那会让中国版账号的续期去刷国际版的凭据（两站 token 不通用，
              // CN 永远续不动而国际版被无谓刷一次）。该串用由
              // 行为级用例锁死（已做反向验证）。
              await requireQoderFamily(entry.provider).auth.refreshAccountCredential(entry.credentialRef, pool, entry.id)
              break
            case TRAE.id:
              await trae.refreshAccountCredential(entry.credentialRef, pool, entry.id)
              break
            case RACCOON.id:
            case RACCOON_PRO.id:
              // raccoon（免费版 / 订阅版同族）**有** refresh 端点（refresh_token
              // 轮换），这里是真续期。
              // ⚠️ 只读写传入的 ref，不碰默认单凭据 ref。
              // ⚠️ **必须传 pool + entry.id**：续期后要把新的 `expiresAt` 写回
              // 账号池，否则 UI 一直显示「已过期」（真实缺陷：JWT 已续到 15:09、
              // 账号池仍是 12:02，相差 3.1 小时，但功能完全正常）。
              // ⚠️ 按 provider 取 auth 实例（照 Qoder 家族）：写死 `raccoon` 会让
              // 订阅版账号的续期去读写免费版的默认 ref。
              await requireRaccoonFamily(entry.provider).auth.refreshAccountCredential(entry.credentialRef, pool, entry.id)
              break
            default:
              throw new Error(`Unknown provider: ${entry.provider}`)
          }
          return { ok: true, value: { success: true } }
        } catch (error) {
          /**
           * ⚠⚠ **失败必须回 `ok: false`**，不得包成 `ok:true + value.success:false`
           * （Gitee issue IKJOZA，真实缺陷）。
           *
           * ## 为什么这里不能学那四处「catch 仍回 ok:true」
           * 本文件确有四处 catch 后仍 `ok:true`，它们**都有额外的判别字段**，
           * 调用方不判它就会误读，本端点没有 —— 逐条对照：
           *
           * | 位置 | 形态 | 为何安全 |
           * |---|---|---|
           * | `login.poll` | `{done:false}` | 「用户尚未授权完」是正常中间态 |
           * | `login.submitSms` | `{done:false, error}` | 验证码输错可重试，前端必判 `done` |
           * | `credits.permanentLock` | 广播失败仍 `ok:true` | 广播失败不影响已落盘 |
           * | `credits.claimAll` | 单号失败进 `results[]` | 「单个失败不中断整体」是设计语义 |
           *
           * 本分支只有 `success` 一个布尔：**失败是业务终态，不是可自愈的中间态**，
           * 与上述四者不同类。
           *
           * ## 为什么 `ok:false` 不会打破仓库内任何调用方
           * `account.refresh` **全仓库零调用方**：面板 `plugin-src/client/channel-pack.js`
           * 的 42 处 `rpcCall(` 里没有它（账号卡片的按钮是 测试/重测/重置/停用/代理/
           * 指纹/删除，**没有「刷新」**）；另两处 `rpcCall(变量)` 的实参经追溯只有
           * 仓库外脚本/手工 RPC 用的端点。
           * ⇒ 这是**对外部调用方的破坏性契约变更**：原先误判的调用方会从「静默错」
           * 变成 `unwrapRpcResult` 抛错，属预期的「提前炸」。成功路径仍是
           * `ok:true + value.success:true`，未变。
           *
           * ⚠⚠ **复现这条取证不要用 `git log -S "rpcCall('account.refresh'"`**：
           * 本注释自身引用了该字面量，`-S` 会**自匹配修复提交本身**（返回 `68fb567`），
           * 那正是 `AGENTS.md` 明令禁止的「注释与实测脱节」。在 `origin/master`
           * （修复前）上该命令零命中，这本身是它曾有效的证据。稳定写法是只搜
           * **不含注释**的客户端源码：
           * `Select-String -Path plugin-src\client\*.js -Pattern "rpcCall\('account\."`
           * （应零命中；`account.refreshable` 是另一个字段名，不是端点）。
           *
           * 回归用例在行为级用例的
           * 「issue IKJOZA」段（锁死「失败不得是 ok:true」+「失败必须带原因」）。
           */
          return {
            ok: false,
            error: {
              code: 'bad-request',
              message: error instanceof Error ? error.message : String(error),
            },
          }
        }
      }

      case 'login.poll': {
        const req = payload as RpcPollLoginRequest
        const failure = pendingLoginFailures.get(req.accountId)
        if (failure !== undefined) {
          pendingLoginFailures.delete(req.accountId)
          return { ok: true, value: { done: true, success: false, error: failure } }
        }
        const accounts = await pool.listAllAccounts()
        const entry = accounts.find((a) => a.id === req.accountId)
        if (!entry) return { ok: true, value: { done: false } }
        // 检查凭据是否已实际写入（占位条目没有凭据）。
        const ref = credentialRef(entry.credentialRef)
        const resolved = await ctx.credentials.resolve(ref)
        if (!resolved) return { ok: true, value: { done: false } }
        return { ok: true, value: { done: true, success: true } }
      }

      /**
       * 查询一次性奖励状态（Raccoon 族免费版 / 订阅版的登录奖励，只读）。
       *
       * ⚠️ 只读：**不得**在此触发任何 `complete`/`claim`（面板挂载时会调用它）。
       */
      case 'onboarding.status': {
        const req = payload as RpcOnboardingStatusRequest
        if (!isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
        }
        const account = pool.findAccount(req.accountId)
        if (account === undefined) {
          return { ok: false, error: { code: 'bad-request', message: '账号不存在' } }
        }
        const resolved = await ctx.credentials.resolve(credentialRef(account.credentialRef))
        if (!resolved) {
          return { ok: false, error: { code: 'bad-request', message: '凭据未配置' } }
        }
        if (isRaccoonFamily(req.provider)) {
          // raccoon 只有**一项**一次性奖励（桌面端登录奖励 3000 分），
          // 把它映射成统一的「任务」形状的一项，复用同一个 RPC 与 UI。
          // ⚠️ 已领状态靠**账单反查**（服务端没有单独的状态端点）。
          // ⚠️ 用**该 provider 自己的** auth 实例：两个产品账号池独立，
          // 借免费版实例会读另一个池的默认凭据。
          const credential = JSON.parse(resolved.value) as RaccoonCredential
          const status = await requireRaccoonFamily(req.provider).auth.fetchOnboardingStatus(credential)
          return {
            ok: true,
            value: {
              // ⚠️ `tasks` 是 `Record<key, boolean>`（完成状态），不是数组。
              tasks: { desktop_login_reward: status.claimed },
              earned: status.claimed ? status.points : 0,
              total: status.points,
              titles: { desktop_login_reward: '桌面端登录奖励（每号一次）' },
              points: { desktop_login_reward: status.points },
            } satisfies RpcOnboardingStatusResponse,
          }
        }
      }

      /**
       * 领取一次性奖励（Raccoon 族的登录奖励）。
       *
       * ⚠️ 这是**写**操作，且**每号只能领一次** —— 与 `credits.claimAll`
       *（每日签到）语义完全不同，故独立端点。
       */
      case 'onboarding.claim': {
        const req = payload as RpcOnboardingClaimRequest
        if (!isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
        }
        const account = pool.findAccount(req.accountId)
        if (account === undefined) {
          return { ok: false, error: { code: 'bad-request', message: '账号不存在' } }
        }
        const resolved = await ctx.credentials.resolve(credentialRef(account.credentialRef))
        if (!resolved) {
          return { ok: false, error: { code: 'bad-request', message: '凭据未配置' } }
        }
        if (isRaccoonFamily(req.provider)) {
          // raccoon 的领取端点是**幂等**的：已领过返回 `granted:false`，
          // 此时 claimed 为空数组、skipped 含该项。
          //
          // ⚠️ **已领时 `earned` 必须报满分，不是 0**（真实缺陷，用户报障）。
          // `earned` 回答的是「该项目**累计**领到多少」，与「本次请求是否新增」
          // 无关。早期在 `already-claimed` 分支写 `earned: 0`，于是 UI 显示
          // 「✅ 1 个此前已完成 / 累计已领 0 / 3000」—— **自相矛盾**：
          // 既然「此前已完成」，那 3000 分显然已经拿到手了。
          // ⚠️ 与 `onboarding.status` 同理：用该 provider 自己的 auth 实例，
          // 两个产品的领取互不影响（账号池独立，但默认凭据 ref 不同）。
          const raccoonAuth = requireRaccoonFamily(req.provider).auth
          const credential = JSON.parse(resolved.value) as RaccoonCredential
          const outcome = await raccoonAuth.claimLoginReward(credential)
          if (outcome.kind === 'failed') {
            return { ok: false, error: { code: 'bad-request', message: outcome.message } }
          }
          const claimed = outcome.kind === 'claimed'
            ? [{ key: 'desktop_login_reward', title: '桌面端登录奖励', points: outcome.credit }]
            : []
          // 已领时的金额从**账单反查**取得（领取响应体里没有它），
          // 与 `onboarding.status` 同一数据源 —— 否则两处会显示不同的数字
          //（例如活动金额变化后，一处 3000、一处 3500）。
          // 只读 GET，且仅在「点按钮时已领」这一低频路径上发生。
          const points = outcome.kind === 'claimed'
            ? outcome.credit
            : (await raccoonAuth.fetchOnboardingStatus(credential)).points
          return {
            ok: true,
            value: {
              claimed,
              skipped: outcome.kind === 'already-claimed' ? ['desktop_login_reward'] : [],
              // 该项目累计已领 = 满分（无论本次是否新增）。
              earned: points,
              total: points,
            } satisfies RpcOnboardingClaimResponse,
          }
        }
      }

      // ── 每日签到（Raccoon 家族）：触发服务端当日积分发放 ──
      case 'raccoon.checkin': {
        const req = payload as { provider?: string; accountId?: string }
        if (req.provider !== undefined && !isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
        }
        if (typeof req.accountId !== 'string' || req.accountId.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: '缺少账号' } }
        }
        const account = pool.findAccount(req.accountId)
        if (account === undefined) {
          return { ok: false, error: { code: 'bad-request', message: '账号不存在' } }
        }
        const resolved = await ctx.credentials.resolve(credentialRef(account.credentialRef))
        if (!resolved) {
          return { ok: false, error: { code: 'bad-request', message: '凭据未配置' } }
        }
        // ⚠️ 签到是**账号级**：同一账号池只有 `raccoon` 一方代表签到。
        // `raccoon-pro` 只是同一账号的订阅面视图，两侧各跑一次会重复调度
        // 同一账号（服务端虽幂等，但账本会记两条）。
        const raccoonAuth = requireRaccoonFamily(req.provider ?? account.provider).auth
        const credential = JSON.parse(resolved.value) as RaccoonCredential
        const outcome = await raccoonAuth.checkIn(credential)
        if (outcome.kind === 'failed') {
          return { ok: false, error: { code: 'upstream-error', message: outcome.message } }
        }
        return {
          ok: true,
          value: outcome.kind === 'claimed'
            ? { outcome: 'claimed', credit: outcome.credit, message: outcome.delayedMessage ?? '' }
            : { outcome: outcome.kind === 'already-claimed' ? 'done' : outcome.kind, message: outcome.message },
        }
      }

      // ── 限流标记：重测（发真实请求验证）──
      // 标记只反映"上一次 429 时的快照"，服务端常在重置时间前提前放行。
      // 重测发一次最小对话请求：正常返回才清除标记，仍受限则保留并回报原因。
      case 'account.retest': {
        const req = payload as RpcRetestAccountRequest
        const account = await retestAccount(pool, req.accountId)
        return {
          ok: true,
          value: { accounts: [account], clearedCount: account.cleared.length },
        }
      }

      // 重测该 provider 下的全部账号。**包含已停用账号**——用户明确要求
      // 停用账号也能重测（停用只影响自动选择，不影响手动排查）。
      case 'account.retestAll': {
        const req = payload as RpcRetestAllRequest
        const value = await retestAllAccounts(pool, req.provider)
        return { ok: true, value }
      }

      // ── 限流标记：测试（**无条件**发一次真实请求）──
      //
      // ⚠️ 与 `account.retest` 的区别是**触发条件**，不是措辞：
      // `retestAccount` 只测那些已经有 `modelRateLimits` 标记的模型，没有标记时
      // 在 `modelIds.length === 0` 处提前返回、一次请求都不发。于是「这个账号
      // 到底还能不能用」在**没有历史 429** 时没有手动探活入口 —— 用户点「重测」
      // 看到瞬间返回，会以为按钮失灵（真实报障：「重测按钮你确认过会发请求吗，
      // 为什么响应这么快？」）。`account.test` 补齐的就是这个缺口。
      //
      // ⚠️ 它**不写任何存储**：不清标记、不写回新的重置时刻。测出「仍受限」只
      // 如实回报给用户看，不落盘 —— 落盘会把「一次手动探活」变成「改变选号
      // 状态」，那是重测的语义。
      case 'account.test': {
        const req = payload as RpcTestAccountRequest
        const accountId = req.accountId
        if (typeof accountId !== 'string' || accountId === '') {
          return { ok: false, error: { code: 'bad-request', message: '缺少 accountId' } }
        }
        const entry = pool.findAccount(accountId)
        if (entry === undefined) {
          return { ok: false, error: { code: 'bad-request', message: `账号 ${accountId} 不存在` } }
        }

        // 模型推断：显式指定 > 已有的限流标记（用户最可能想看的就是它）> 全量目录第一个。
        // ⚠️ 只有前两者都拿不到时才去读目录 —— `fullCatalogIds` 在读不到时返回
        // `{ error }`，若无条件先读它，一个「明明有标记可测」的账号会因为目录服务
        // 暂时不可用而被拒，属于自造的失败。
        //
        // 目录也读不出来时如实报错，**不**猜一个模型名发出去（猜错会得到与账号
        // 无关的 404，把「账号不可用」和「模型名不对」两件事混成一条报错）。
        // ⚠️ 拿到的是**候选链**而不是单个模型：目录第一个未必可调用
        //（TRAE 的 `doubao-for-auto` 是自动路由占位模型，回 3003），只测它
        // 会把好好的账号报成不可用（#681）。显式指定时链长为 1。
        let candidates = pickTestModels(entry, [], req.modelId)
        if (candidates.length === 0) {
          const catalog = await fullCatalogIds(ctx, modelAdapters, entry.provider)
          if ('error' in catalog) {
            return {
              ok: false,
              error: { code: 'bad-request', message: `无法确定要测试的模型：${catalog.error}` },
            }
          }
          candidates = pickTestModels(entry, catalog.ids, req.modelId)
        }
        if (candidates.length === 0) {
          return {
            ok: false,
            error: { code: 'bad-request', message: `${entry.provider} 没有可测试的模型` },
          }
        }

        const value: RpcTestAccountResponse = await testAccountCandidates(pool, accountId, candidates)
        return { ok: true, value }
      }

      // ── 限流标记：重置（不发请求，直接清除）──
      case 'account.reset': {
        const req = payload as RpcResetAccountRequest
        const value = await resetAccount(pool, req.accountId)
        return { ok: true, value }
      }

      case 'account.resetAll': {
        const req = payload as RpcResetAllRequest
        const value = await resetAllAccounts(pool, req.provider)
        return { ok: true, value }
      }

      // ── 每日签到（积分领取）──
      // 查询某 provider 下全部启用账号的签到状态。
      //
      // 各渠道显式分派协议，未知或退役渠道不调用任何默认端点。
      case 'credits.status': {
        const req = payload as RpcCreditsStatusRequest & { accountId?: string }
        if (req.provider === TRAE.id || isQoderFamily(req.provider)) {
          const accounts = (await pool.listAccounts(req.provider)).filter(entry => req.accountId === undefined || entry.id === req.accountId)
          const value = await collectCreditsStatus(accounts, undefined, {
            resolve: ref => ctx.credentials.resolve(ref),
            fetchStatus: credential => req.provider === TRAE.id
              ? fetchTraeCheckinStatus(credential as TraeCredential, TRAE)
              : fetchQoderCheckinStatus(credential as QoderCredential, requireQoderFamily(req.provider).product),
          })
          return { ok: true, value: { accounts: value } satisfies RpcCreditsStatusResponse }
        }
        return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
      }

      // 一键领取：逐账号顺序执行（并发易触发风控），单个账号失败不中断整体。
      case 'credits.claimAll': {
        const req = payload as RpcCreditsClaimAllRequest
        const targeted = config.nativeOnly && Array.isArray(req.accountIds)
        const all = await pool.listAccounts(req.provider)
        const accounts = targeted ? all.filter(account => req.accountIds?.includes(account.id)) : all
        if (isQoderFamily(req.provider)) {
          const { product } = requireQoderFamily(req.provider)
          // Qoder 的领取流程**自带活动列表查询**（loadCampaigns → 逐个 claim），
          // 故 precheckStatus: false 跳过外部那次检查 —— 否则会重复发一次 GET
          // （与 LobsterAI 传 false 的理由同类）。
          //
          // ⚠️ Qoder 的幂等判据是响应体的 `replayed:true`（重复领取同样返回
          // HTTP 200），已在 claimQoderCampaign 内部处理。
          const value = await collectClaimResults<QoderCredential, undefined>(accounts, undefined, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            claim: (credential) => claimQoderDailyCheckin(credential, product),
            signal,
            precheckStatus: false,
            warn: (msg) => ctx.logger?.warn?.(msg),
          })
          return { ok: true, value: value satisfies RpcCreditsClaimAllResponse }
        }
        if (req.provider === TRAE.id) {
          const value = await collectClaimResults<TraeCredential, undefined>(accounts, undefined, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            signal,
            requireStatus: targeted,
            // ⚠️ **必须开启状态预检**（`precheckStatus` 默认为 true，不要传 false）。
            //
            // TRAE 的 claim 对「今天已签到」是**幂等**的：实测重复领取同样返回
            // `{code:0, message:"success"}`，与真正领取成功**无法区分**。
            // 早期照抄 LobsterAI 传了 `precheckStatus: false`（那是「领取流程内部
            // 已做 slot/context 预检」的理由，TRAE 没有这回事），于是已签到的账号
            // 被报成「领取成功」（用户报障：显示成功但 +0 积分）。
            // 判据只能是 status 端点的 `checked_in`。
            fetchStatus: (credential) =>
              fetchTraeCheckinStatus(credential as TraeCredential, TRAE, fetch),
            claim: (credential, _product, entry) =>
              claimTraeDailyCheckin(
                credential as TraeCredential,
                TRAE,
                fetch,
                pool.traeCheckinDeviceGenerationFor(entry.id),
                (next) => pool.updateTraeCheckinDeviceGeneration(entry.id, next),
                undefined,
                targeted ? 0 : undefined,
              ),
            warn: (msg) => ctx.logger?.warn?.(msg),
          })
          return { ok: true, value: value satisfies RpcCreditsClaimAllResponse }
        }
        if (isRaccoonFamily(req.provider)) {
          // raccoon（免费版 / 订阅版同族）**没有签到端点**：每日 300 积分由服务端按日自动发放
          //（账单里的 `daily_grant`，实测注册后 1 分钟即到账），
          // 客户端按能力矩阵（`raccoon: { balance: true, onboardingTasks: true }`，
          // **无** `dailyCheckin`）根本不会渲染「一键领取积分」按钮、也不会发起本调用。
          // 这里显式返回可读错误，而不是落到下面 `productById` 的
          // `unsupported provider` 泛化文案 —— 后者会让排查者以为是
          //「provider 没注册」，而真相是「该产品无此能力」。
          return {
            ok: false,
            error: {
              code: 'bad-request',
              message: 'Raccoon Work 不支持每日签到（每日积分由服务端自动发放；登录奖励请在「新手任务」中领取）',
            },
          }
        }
        return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
      }

      // 积分余额（Credits Balance）：逐账号顺序查询。
      //
      // 独立于 account.list 的原因：余额要为每个账号发一次网络请求，而
      // account.list 是打开面板就会调的轻量操作。混在一起会让账号列表被
      // 网络耗时拖慢，且一次查询失败会让整份列表都取不到。
      case 'credits.balances': {
        const req = payload as RpcCreditsBalancesRequest
        const accounts = await pool.listAccounts(req.provider)
        if (isQoderFamily(req.provider)) {
          const { product } = requireQoderFamily(req.provider)
          // 余额来自 `GET {product.openApiBase}/sash/api/v2/me/usage`（实测只需
          // Bearer + Cosy-ClientType，**不需要**模型列表那样的 WASM 签名）。
          // `fetchQoderCreditBalance` 只吃 QoderCredential，故这里不用
          // collectCreditBalances 的泛型（它会把产品配置转发给 fetchBalance）。
          const values: RpcCreditsBalancesResponse['accounts'] = []
          for (const account of accounts) {
            signal?.throwIfAborted()
            const resolved = await ctx.credentials.resolve(credentialRef(account.credentialRef))
            if (!resolved) {
              values.push({
                accountId: account.id, nickname: account.nickname,
                balance: null, error: '凭据未配置',
              })
              continue
            }
            let credential: QoderCredential
            try {
              credential = JSON.parse(resolved.value) as QoderCredential
            } catch {
              values.push({
                accountId: account.id, nickname: account.nickname,
                balance: null, error: '凭据解析失败',
              })
              continue
            }
            const balance = await fetchQoderCreditBalance(credential, product)
            values.push({
              accountId: account.id,
              nickname: account.nickname,
              balance,
              // 查不到时带上原因，卡片显示原因而非 0（与其它 provider 同约定）。
              ...balance === null ? { error: '积分查询失败（凭据失效或响应异常）' } : {},
            })
          }
          return { ok: true, value: { accounts: values } satisfies RpcCreditsBalancesResponse }
        }
        if (req.provider === TRAE.id) {
          const values = await collectCreditBalances(accounts, TRAE, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            fetchBalance: (credential, product) => fetchTraeCreditBalance(credential as TraeCredential, product),
            warn: (msg) => ctx.logger?.warn?.(msg),
          })
          // ⚠️ TRAE 也回传窗口天数：它的资源包现在带 `deductionEndTime`
          // （条目级 `expire_time`，秒→毫秒），面板要按「长期 / 临时」分桶显示。
          // 没有窗口天数前端会拒绝渲染分类行（见 credit-expiry.js 的

          // "没有作废维度"，这是防止凭空渲染假分类行的门禁）。

          return {
            ok: true,
            value: {
              accounts: values,
              windowDays: creditExpiringWindowDays(),
            } satisfies RpcCreditsBalancesResponse,
          }
        }
        return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${req.provider}` } }
      }

      // ── 模型列表可见性（黑名单开关）──
      //
      // 列表来自 `ctx.llm.listModels()`——**适配器播报的权威目录**，正是
      // 对话框模型选择器读的同一份数据（会话控制器的 buildModelCatalog）。
      // 这样设置页展示的模型集合与实际可选集合永远一致，不会出现
      // 「设置在某个模型上，选择器里却找不到它」。
      case 'model.list': {
        const req = payload as RpcModelListRequest
        const llm = llmServiceOf(ctx)
        if (llm === undefined) {
          return { ok: false, error: { code: 'bad-request', message: 'llm 服务不可用' } }
        }
        const catalogSource = modelAdapters?.[req.provider]
        const all = catalogSource?.listAllModels()
        let models: Array<{ id: string; name: string }> = []
        if (all === undefined) {
          try {
            models = await llm.listModels(req.provider)
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            return { ok: false, error: { code: 'bad-request', message: `读取模型列表失败：${reason}` } }
          }
        }
        // 目录若来自远端真拉，顺手剪掉**目录里已不存在的历史黑名单条目**
        //（模型下架后开关记录会永远留在 state.json 里，越积越多）。
        // ⚠️ 只在远端目录成立时剪：离线兜底表只是精选子集，用它当「上游全量」
        // 会误删用户对表外模型的偏好。
        if (catalogSource?.isRemoteCatalog?.() === true) {
          if (all !== undefined && all.length > 0) {
            const removed = await pool.pruneDisabledModels(req.provider, new Set(all.map((model) => model.id)))
            if (removed.length > 0) {
              ctx.logger.info(`[channel-pack] 清理 ${req.provider} 的过期模型黑名单：${removed.join(', ')}`)
            }
          }
        }
        // 黑名单直接读账号池的进程内副本：开关写入后无需重建适配器，
        // 下一次 listModels 就会应用新的过滤结果。
        const disabledMap = pool.listDisabledModels(req.provider)
        // ⚠️ `llm.listModels()` 返回的目录**已被适配器过滤掉黑名单**：所有适配器
        // 的 listModels 内部都会实时 `filter(m => !disabledModelsFor(provider).has(m.id))`。
        // 若直接对这个结果回填 disabled，就形成闭环矛盾——`disabledMap` 里的键恰好是
        // `models` 中已被移除的那些元素，`.map()` 永远匹配不到它们，被关闭的
        // 模型连同它的开关一起从设置页消失，用户**再也无法重新打开**（只能手工
        // 编辑 settings.yaml）。这正是「关掉后彻底找不到该模型」的根因。
        //
        // 因此设置页的目录必须以**未过滤**的全量为准：
        // - 优先用适配器提供的 `listAllModels()`（不套黑名单，且带**最终展示名**，
        //   含倍率与同名消歧）；
        // - 它不存在时（外部/旧适配器）退化为「listModels 结果 + 黑名单补回裸 id」，
        //   此时关闭项只能显示 id（历史行为）。
        //
        // ⚠️ 展示名必须来自**不套黑名单**的全量目录而非裸 id：用户报障
        // 「关闭的就没有显示倍率，关闭的应该也显示倍率」—— 根因正是补回时只有
        // id 可用。适配器实例由 `registerChannelPackRpc` 的 `modelAdapters` 传入
        // （DSH 的 `ctx.llm` 只保证 `listModels`，不透传自定义方法）。
        // 对话框模型选择器读的仍是过滤后的 `listModels`，可见性行为完全不变。
        // ⚠️ 类型必须完整声明所有要透出的能力字段：`catalog = [...all]` 之后这份
        // 类型就是唯一真相，缺失的键会在编译产物里被直接丢掉（stale/efforts 都因此
        // 丢过一次，表现为「设置页看不到分组」）。
        let catalog: Array<{
          id: string; name: string; isFree?: boolean; subscriptionOnly?: boolean
          contextWindow?: number; maxTokens?: number; defaultMaxTokens?: number; stale?: boolean; staleReason?: string
          efforts?: readonly string[]; defaultEffort?: string; supportsImage?: boolean; rateBadge?: ModelRateBadge
        }>
        if (all !== undefined) {
          catalog = [...all]
          // ⚠️ **不再补回「黑名单里有、目录里没有」的裸 id**（2026-11-18 修正，用户报障
          // 「设置页里怎么还有上游不存在的 qwen3.8-max」）。
          //
          // 旧实现在这里 `catalog.push({ id, name: id })`，本意是「万一全量目录漏了
          // 某个被关掉的模型，至少还能看到并重新打开」。但 `disabledModels` 是**历史
          // 累积**的用户状态：模型下架后它仍留在 state.json 里，于是那些**上游早已
          // 不存在**的 id 被这条保底逻辑重新变回一行模型，出现在设置页里。
          // 这不是兜底，是把过期状态复活成幽灵条目。
          //
          // 现在只认目录（`listAllModels()` 是适配器不做黑名单过滤的全量目录，被关掉的
          // 模型本来就在里面），黑名单仅用于标记 `disabled`。真正「已失效」的模型有
          // 独立的 dead 表路径（见下方 `dead` 段），那条路径才是用户恢复入口。
        } else {
          const listedIds = new Set(models.map((model) => model.id))
          const filteredOut = Object.keys(disabledMap)
            .filter((id) => disabledMap[id] === true && !listedIds.has(id))
          catalog = [
            ...models.map((model) => ({ id: model.id, name: model.name })),
            // 这些模型已被适配器过滤掉，拿不到原始 name，回退为 id。
            ...filteredOut.map((id) => ({ id, name: id })),
          ]
        }
        // ⚠️⚠️ 「已失效模型」必须**显式列出且可恢复**（2026-10-06 复审 !66 实测）。
        //
        // 背景：`withDeadModelPruning` 会把已失效模型从 `listModels` / `listAllModels`
        // 两侧剔除，于是它既不在 `all` 里、也不在 `disabledMap` 里 —— 上面的两条
        // 补回路径都救不回它。结果是**模型从设置页彻底消失，连开关都摸不着**，
        // 用户永远无法自行恢复（这正是本段注释在 `:3370-3375` 列为必须避免的根因：
        // 「用户再也无法重新打开」）。
        //
        // ⇒ 这里把 dead 表里的 id 补回目录，并带上 `dead: true` 让客户端灰显 +
        // 提供「重新显示」入口（`model.clearDead`）。**方向必须与黑名单相反**：
        // 失效模型**永远**列出（哪怕被用户关着），否则用户没有恢复路径。
        const dead = deadModelIdsFor(req.provider)
        if (dead.size > 0) {
          const known = new Set(catalog.map((model) => model.id))
          for (const id of dead) {
            if (!known.has(id)) catalog.push({ id, name: id })
          }
        }
        const exclusions = modelRecommendationExclusions(catalog.filter(model => !dead.has(model.id)), req.provider)
        const value: RpcModelListResponse = {
          ...modelAdapters?.[req.provider]?.catalogStatus?.(),
          models: catalog.map((model) => ({
            id: model.id,
            name: readableModelName(model.id, model.name),
            disabled: isModelDisabled(model, disabledMap, exclusions),
            // ⚠️ **照实透传**：缺失即 false，**不推导**（黑名单命中也算用户主动关的，
            // 不是失效）。客户端据它灰显并显示「重新显示」按钮。
            dead: dead.has(model.id),
            // ⚠️ 免费标记**照原样透传，缺失就不写**（不编造 `false`）：Channel Pack 的
            // 模型列表按「计费/来源」分组，把「适配器没报」当成「按量计费」是
            // 保守归组，但字段本身仍保持「未知」语义（与全仓约定一致）。
            ...model.isFree === undefined ? {} : { isFree: model.isFree },
            ...model.subscriptionOnly === undefined ? {} : { subscriptionOnly: model.subscriptionOnly },
            ...model.rateBadge === undefined ? {} : { rateBadge: model.rateBadge },
            // 能力元数据：界面据此只渲染该模型真正支持的档位（不猜、不给做不到的选项）。
            ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
            ...model.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: model.defaultMaxTokens },
            ...model.stale === true ? { stale: true } : {},
            ...model.staleReason === undefined ? {} : { staleReason: model.staleReason },
            ...model.efforts === undefined ? {} : { efforts: [...model.efforts] },
            ...model.defaultEffort === undefined ? {} : { defaultEffort: model.defaultEffort },
            // 默认能力优先取未应用用户覆盖的完整目录，避免把手动关图误标为不支持。
            ...model.supportsImage !== undefined ? { supportsImage: model.supportsImage } : {}
          })),
        }
        return { ok: true, value }
      }

      // ── 手动刷新远端模型目录 ──
      //
      // 设置页模型目录读的是 `model.list`，而它是**同步读缓存**（`listAllModels()`
      // 只返回当前目录，不触发拉取）。缓存为空时它退到适配器的硬编码兜底表，
      // 于是「设置页只看到几条老模型、也没有刷新入口」成了常态。
      //
      // 本方法把「真去上游拉一次」这一步单独暴露出来：客户端点「刷新目录」
      // （或首次进入模型分区）时调用，成功后再重读 `model.list`。
      // 适配器侧解析见各自 `refreshRemoteModels()`（会清缓存并突破失败冷却）。
      //
      // ⚠️ 目录按**适配器**分派（`modelAdapters[provider]`），Raccoon 家族的两个
      // provider 各取自己的适配器：`raccoon` 用免费账号凭据拉、`raccoon-pro` 用
      // 订阅账号凭据拉，两侧目录天然独立，不做倍率过滤。
      case 'model.refresh': {
        const req = payload as { provider?: unknown; broadcast?: unknown }
        const provider = typeof req?.provider === 'string' ? req.provider : ''
        if (provider === '') {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        const adapter = modelAdapters?.[provider]
        if (adapter === undefined) {
          return { ok: false, error: { code: 'bad-request', message: `该渠道没有模型适配器：${provider}` } }
        }
        const refresh = adapter.refreshRemoteModels
        if (typeof refresh !== 'function') {
          return { ok: false, error: { code: 'bad-request', message: `该渠道不支持刷新模型目录：${provider}` } }
        }
        try {
          const result = await refresh.call(adapter)
          const count = typeof result?.count === 'number' && Number.isFinite(result.count) ? result.count : 0
          const source = adapter.catalogStatus?.().source ?? (result?.source === 'remote' ? 'remote' : 'fallback')
          // `broadcast: true`（宿主切换「统一免费与订阅模型」后主动刷新）：即使本次
          // 落到兜底目录也要广播 —— 隐藏 raccoon-pro 分组依赖宿主收到变更事件。
          if (source === 'remote' || req.broadcast === true) broadcastCatalogChanged(ctx)
          ctx.logger.info(`[channel-pack] 刷新模型目录 ${provider}：${source}（${count}）`)
          return { ok: true, value: { count, source, ...(result && 'issue' in result ? { issue: result.issue } : {}) } }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return { ok: false, error: { code: 'bad-request', message: `刷新模型目录失败：${reason}` } }
        }
      }

      // 打开/关闭某个模型。写入后**不重建适配器**：适配器的 listModels 每次
      // 都直接读账号池的黑名单，因此下一次调用即返回新目录。
      //
      // ⚠️ 但「适配器立刻返回新目录」**不等于**「界面立刻更新」—— 客户端把
      // `modelCatalog` 的响应缓存在带 `status === 'ready'` 短路的 store 里，
      // 只在转发事件上失效（详见下方 emit 的注释）。不广播就等于开关只写进了
      // 磁盘、界面一直显示旧目录。
      case 'model.setDisabled': {
        const req = payload as RpcModelSetDisabledRequest
        if (typeof req.provider !== 'string' || typeof req.modelId !== 'string' || req.modelId.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 与 modelId 必填' } }
        }
        await pool.setModelDisabled(req.provider, req.modelId, req.disabled === true)
        ctx.logger.info(
          `[channel-pack] ${req.disabled === true ? '关闭' : '打开'}模型 ${req.provider}/${req.modelId}`,
        )
        // 必须广播：否则开关只写进磁盘、界面一直显示旧目录（成因见该函数注释）。
        broadcastCatalogChanged(ctx)
        const value: RpcModelSetDisabledResponse = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider),
        }
        return { ok: true, value }
      }

      /** 清空显示偏好，恢复当前推荐列表；不改账号、参数或失效记录。 */
      case 'model.resetDefaults': {
        const req = payload as RpcModelListRequest
        if (typeof req.provider !== 'string' || req.provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        await pool.clearDisabledModels(req.provider)
        broadcastCatalogChanged(ctx)
        return { ok: true, value: { provider: req.provider, disabledModels: pool.listDisabledModels(req.provider) } }
      }

      /** 读取某 provider 的模型参数覆盖表。 */
      case 'model.params': {
        const req = payload as RpcModelParamsRequest
        if (typeof req.provider !== 'string' || req.provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        const value: RpcModelParamsResponse = {
          provider: req.provider,
          params: pool.listModelParams(req.provider),
        }
        return { ok: true, value }
      }

      /**
       * 写入某个模型的参数覆盖（默认**整份替换**，与设置页保存一致）。
       *
       * 输入栏 `contextOnly: true` 与设置页 `field` 都在服务端合并一个字段；
       * 清除该字段时仍保留同模型的其它覆盖。
       *
       * ⚠️ **必须广播 adapters-updated**：contextWindow 覆盖经 `resolveModel`
       * 投影进 `info.context.contextWindow`，宿主压缩/预算直接读它；不广播
       * 的话已开会话直到下次目录刷新都沿用旧窗口（其余渠道的同名字段写后
       * 都走同一约定）。
       */
      case 'model.setParams': {
        const req = payload as RpcModelSetParamsRequest
        if (typeof req.provider !== 'string' || req.provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        if (typeof req.modelId !== 'string' || req.modelId.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'modelId 必填' } }
        }
        const previous = pool.modelParamsFor(req.provider, req.modelId)
        const field = req.contextOnly === true ? 'contextWindow' : req.field
        if (field !== undefined && !['contextWindow', 'maxTokens', 'reasoningEffort', 'supportsImage'].includes(field)) {
          return { ok: false, error: { code: 'bad-request', message: '模型参数无效' } }
        }
        if (field === 'contextWindow') {
          const value = req.contextOnly === true ? req.params?.contextWindow : req.params?.contextWindow ?? null
          if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 10_000_000)) {
            return { ok: false, error: { code: 'bad-request', message: 'contextWindow 必须是正整数或 null' } }
          }
          const row = modelAdapters?.[req.provider]?.listAllModels().find(model => model.id === req.modelId)
          const capacity = row?.contextWindow
          const output = previous?.maxTokens ?? row?.defaultMaxTokens
          const target = value ?? capacity
          if (capacity === undefined || capacity <= 0 || target === undefined || target > capacity || (output !== undefined && target <= output)) {
            return { ok: false, error: { code: 'bad-request', message: '上下文窗口超出目录容量范围或小于等于输出预留' } }
          }
          const merged = { ...previous }
          if (value === null) delete merged.contextWindow
          else merged.contextWindow = value
          await pool.setModelParams(req.provider, req.modelId, merged)
        } else {
          // 思考档位必须是该模型**真实声明**的档位：设置页的档位同时是该模型的
          // 默认档（会被投影进 `resolveModel().reasoning.defaultEffort`，DSH 再拿
          // 它直接发请求），写进一个目录里不存在的档位会让选中它的会话报
          // `UNSUPPORTED_REASONING_EFFORT`。目录行拿不到时按原样放行（不猜）。
          const params = req.contextOnly === true ? undefined : req.params
          const next = field === undefined ? params : { ...previous, [field]: params?.[field] }
          const requestedEffort = field === undefined || field === 'reasoningEffort' ? next?.reasoningEffort : undefined
          if (typeof requestedEffort === 'string' && requestedEffort.length > 0) {
            const row = modelAdapters?.[req.provider]?.listAllModels().find(model => model.id === req.modelId)
            if (row !== undefined && Array.isArray(row.efforts) && !row.efforts.includes(requestedEffort)) {
              return { ok: false, error: { code: 'bad-request', message: '该模型不支持此思考档位' } }
            }
          }
          await pool.setModelParams(req.provider, req.modelId, next)
        }
        // 能影响宿主预算和默认档的元数据变化要广播，避免会话继续使用旧目录。
        const next = pool.modelParamsFor(req.provider, req.modelId)
        if (previous?.contextWindow !== next?.contextWindow
            || previous?.maxTokens !== next?.maxTokens
            || previous?.reasoningEffort !== next?.reasoningEffort) {
          broadcastCatalogChanged(ctx)
        }
        ctx.logger.info(`[channel-pack] 更新模型参数 ${req.provider}/${req.modelId}`)
        const value: RpcModelSetParamsResponse = {
          provider: req.provider,
          params: pool.listModelParams(req.provider),
        }
        return { ok: true, value }
      }

      /**
       * 把模型从「已失效」表里移除，让它重新出现在目录中。
       *
       * ## 为什么必须有这个端点（2026-10-06 复审 !66 确认）
       *
       * 失效记录的唯一自愈路径是 TTL 过期（默认 30 天）—— 因为模型被剔除后用户
       * **选不到**，不可能靠「再成功一次」触发清除。所以**误判一次 = 该模型被
       * 藏 30 天且用户毫无办法**，这与 Channel Pack 已有的模型开关完全不对等
       * （用户能一键关，却不能一键复活）。
       *
       * ⚠️ **不动黑名单**：`disabledModels` 是用户主动选择，失效表是系统推断，
       * 两者必须分开清除 —— 否则「重新显示」会顺带打开用户特意关着的模型。
       *
       * ⚠️ `modelId` **没有默认值**：传 `""`/非字符串一律拒绝（避免字段名写错
       * 导致「静默清空全表」）。省略该字段才是「清空该 provider 全部」。
       */
      case 'model.clearDead': {
        const req = payload as RpcModelClearDeadRequest
        if (typeof req.provider !== 'string' || req.provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 必填' } }
        }
        if (req.modelId !== undefined && (typeof req.modelId !== 'string' || req.modelId.length === 0)) {
          return {
            ok: false,
            error: { code: 'bad-request', message: 'modelId 必须是非空字符串，或省略以恢复全部' },
          }
        }
        const removed = clearDeadModels(req.provider, req.modelId)
        // 必须广播：与三个开关端点同约定，否则客户端目录（`llm/adapters-updated`
        // 三个触发源之一）不复位，用户点了「重新显示」界面却不动。
        broadcastCatalogChanged(ctx)
        ctx.logger.info(
          `[channel-pack] 恢复 ${removed} 个失效模型：${req.provider}`
          + `${req.modelId === undefined ? '' : `/${req.modelId}`}`,
        )
        const value: RpcModelClearDeadResponse = {
          provider: req.provider,
          deadModels: [...deadModelIdsFor(req.provider)],
        }
        return { ok: true, value }
      }

      /**
       * 批量打开/关闭**指定的一批**模型（Channel Pack 模型列表里「按分组」的
       * 本组全开 / 本组全关）。
       *
       * ⚠️ **不能复用 `model.setAllDisabled`**：那个的范围是「该 provider 的
       * 全部模型」，且打开方向会清空整张黑名单（含用户特意关着的其它组）。
       * 分组开关只动本组的 id，故服务端需要一个「按子集清除」的路径
       * （`AccountPool.clearModelsDisabled`）。
       *
       * 与另外两个开关端点同约定：`disabled` 不做默认值猜测、只落盘一次、
       * 只广播一次（逐条调用会写 N 次文档、广播 N 次）。
       */
      case 'model.setDisabledMany': {
        const req = payload as RpcModelSetDisabledManyRequest
        if (
          typeof req.provider !== 'string' || req.provider.length === 0
          || !Array.isArray(req.modelIds)
          || typeof req.disabled !== 'boolean'
        ) {
          return {
            ok: false,
            error: { code: 'bad-request', message: 'provider、modelIds（数组）与 disabled（布尔）必填' },
          }
        }
        // 去重 + 剔除非字符串/空串：前端按组传 id，重复项或脏值只会白写一次文档。
        const ids = [...new Set(req.modelIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
        if (ids.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'modelIds 不能为空' } }
        }
        if (req.disabled) await pool.setModelsDisabled(req.provider, ids)
        else await pool.clearModelsDisabled(req.provider, ids)
        ctx.logger.info(
          `[channel-pack] ${req.disabled ? '关闭' : '打开'} ${req.provider} 的 ${ids.length} 个模型（按分组）`,
        )
        // 与其它开关端点一致：必须广播，否则界面一直显示旧目录。
        broadcastCatalogChanged(ctx)
        const value: RpcModelSetDisabledManyResponse = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider),
        }
        return { ok: true, value }
      }

      /**
       * 按当前全量目录批量打开/关闭，包含默认禁用的备选项，只广播一次。
       * 恢复推荐使用 model.resetDefaults；批量打开必须记录显式 false。
       */
      case 'model.setAllDisabled': {
        const req = payload as RpcModelSetAllDisabledRequest
        // ⚠️ `disabled` **不做默认值猜测**：缺失或非布尔一律拒绝。默认成 true 会
        // 让一次字段名写错的前端改动静默关闭用户全部模型；默认成 false 则反向
        // 静默打开 —— 两个方向都是灾难性且难察觉的。
        if (typeof req.provider !== 'string' || typeof req.disabled !== 'boolean') {
          return {
            ok: false,
            error: { code: 'bad-request', message: 'provider 与 disabled（布尔）必填' },
          }
        }
        if (req.disabled) {
          // 关闭全部：先取全量目录，再一次性写入黑名单。
          // 目录读取的三条分支（适配器 → llm → 失败即拒绝）与「关闭供应商」
          // 完全一致，故共用 fullCatalogIds；⚠️ 失败时**不落盘** ——
          // 否则会写入一个不完整的黑名单，用户看到「关了一半」且无从判断原因。
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider)
          if ('error' in catalog) {
            return { ok: false, error: { code: 'bad-request', message: catalog.error } }
          }
          await pool.setModelsDisabled(req.provider, catalog.ids)
          ctx.logger.info(`[channel-pack] 关闭 ${req.provider} 的全部 ${catalog.ids.length} 个模型`)
        } else {
          // 显式全部启用也包含默认禁用项；清空覆盖另由 resetDefaults 负责。
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider)
          if ('error' in catalog) return { ok: false, error: { code: 'bad-request', message: catalog.error } }
          await pool.clearModelsDisabled(req.provider, catalog.ids)
          ctx.logger.info(`[channel-pack] 打开 ${req.provider} 的全部模型`)
        }
        // 只广播一次：批量不等于逐条广播。
        broadcastCatalogChanged(ctx)
        const value: RpcModelSetAllDisabledResponse = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider),
        }
        return { ok: true, value }
      }

      /**
       * 读取多个供应商的汇总状态（Channel Pack 左侧导航分组 + 一键开关据此渲染）。
       *
       * 为什么一次取全部：8 个供应商若逐个查，就是 16 次往返，且每次都要走
       * 异步凭据解析。这里**全程只用同步的内存副本**，不产生任何网络请求：
       * - 模型目录用 `modelAdapters[provider].listAllModels()`（同步；它内部
       *   在冷缓存时会**后台**补拉，但不阻塞本次返回）；
       * - 账号用 `pool.listAccountsByProvider()`（同步读内存）。
       *
       * ⚠️ **不得**改用 `pool.listAccounts()` —— 那个方法会对每个账号调
       * `credentials.describe()`（异步 IO），8 个供应商逐个解析凭据会明显
       * 拖慢设置页首屏，而我们**只需要计数**，不需要凭据状态。
       *
       * 适配器缺失（外部/旧适配器）时 `total = 0`、`closed = false`：
       * 保守判为「未关闭」，让用户可以尝试操作，而不是误报成已关闭。
       */
      case 'provider.status': {
        const req = payload as RpcProviderStatusRequest
        if (!Array.isArray(req.providers) || req.providers.some((id) => typeof id !== 'string')) {
          return { ok: false, error: { code: 'bad-request', message: 'providers 必须是字符串数组' } }
        }
        const statuses: Record<string, ProviderStatus> = {}
        for (const provider of req.providers) {
          // 空 id 不进结果：它不可能对应任何 provider，留着只会让前端多一个
          // 无意义的键（前端按 PROVIDERS 取，多出来的键会被忽略，但脏数据不该产生）。
          if (provider.length === 0 || !isSupportedProvider(provider)) continue
          const catalog = modelAdapters?.[provider]?.listAllModels()
          const total = catalog?.length ?? 0
          // ⚠️ `listAllModels()` **不带 disabled 字段**，故必须另取黑名单再按 id 计数。
          const disabledMap = pool.listDisabledModels(provider)
          let disabled = 0
          if (catalog !== undefined) {
            const exclusions = modelRecommendationExclusions(catalog, provider)
            for (const model of catalog) {
              // 与适配器和设置页使用相同的默认禁用/手动覆盖规则。
              if (isModelDisabled(model, disabledMap, exclusions)) disabled++
            }
          }
          const entries = pool.listAccountsByProvider(provider)
          statuses[provider] = {
            models: { total, disabled },
            accounts: {
              total: entries.length,
              // 与适配器一致的判据：`enabled !== false` 视为启用
              //（老文档可能缺该字段，缺省语义等同启用）。
              enabled: entries.filter((entry) => entry.enabled !== false).length,
            },
            closed: total > 0 && disabled === total,
          }
        }
        const value: RpcProviderStatusResponse = { statuses }
        return { ok: true, value }
      }

      /**
       * 供应商级一键开关（Channel Pack 左侧每个供应商行尾的开关）。
       *
       * ## 语义（用户已确认）
       *
       * - `enabled: false`（关闭）= **关闭它的全部模型** + **停用它的全部账号**；
       * - `enabled: true`（打开）= 恢复推荐模型 + 启用它的全部账号。
       *
       * ## ⚠️ 关闭方向的顺序不可颠倒：先关模型，再停账号
       *
       * 「是否已关闭」的判据是**模型是否全关**（见 `provider.status` 的 `closed`）。
       * 先关模型可保证：即使随后停账号失败，状态判定依然自洽（该供应商确实已关闭），
       * 用户重试一次即可补齐账号。反过来先停账号、再关模型，中途失败会留下
       * 「账号全停用但模型仍可见」的中间态 —— 用户在对话框里还能选到它的模型，
       * 却没有任何可用账号，这正是本次要消除的落差。
       *
       * ## ⚠️ 「不关闭模型就不关闭供应商」
       *
       * 关闭方向必须拿到模型目录：读失败、或目录**为空**时**整个操作失败**，
       * 既不落盘也不广播。绝不能「关不掉模型就只停账号」—— 那会让供应商
       * 显示成已关闭而模型其实还在，用户按关闭的预期却仍能选到它。
       *
       * ## 打开方向不读目录
       *
       * 打开渠道时恢复推荐列表：直接清空本渠道的显示偏好，这样
       * 「曾被关闭、后来从服务端目录下线」的历史遗留键才能被清掉；且目录故障时
       * 用户仍可恢复本渠道的默认推荐模型。
       */
      case 'provider.setEnabled': {
        const req = payload as RpcProviderSetEnabledRequest
        // ⚠️ `enabled` 不做默认值猜测：缺失或非布尔一律拒绝。默认成 true 会静默
        // 打开用户特意关闭的供应商；默认成 false 则反向静默关闭 —— 两个方向都是
        // 灾难性且难察觉的（与 model.setAllDisabled 同约定）。
        if (typeof req.provider !== 'string' || req.provider.length === 0 || typeof req.enabled !== 'boolean') {
          return {
            ok: false,
            error: { code: 'bad-request', message: 'provider 与非空布尔 enabled 必填' },
          }
        }
        let modelCount = 0
        if (req.enabled) {
          // 打开：清空黑名单（返回被清掉的条目数，供提示）。null 表示本就无关闭项。
          const cleared = pool.listDisabledModels(req.provider)
          await pool.clearDisabledModels(req.provider)
          modelCount = Object.keys(cleared).length
        } else {
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider)
          if ('error' in catalog) {
            // 目录读不出来 → 整个关闭操作失败，**不落盘、不广播**。
            return { ok: false, error: { code: 'bad-request', message: catalog.error } }
          }
          if (catalog.ids.length === 0) {
            // 「不关闭模型就不关闭供应商」的落点。
            return {
              ok: false,
              error: { code: 'bad-request', message: '该供应商没有可关闭的模型，未做任何变更' },
            }
          }
          await pool.setModelsDisabled(req.provider, catalog.ids)
          modelCount = catalog.ids.length
        }
        // 账号状态**在模型之后**处理（顺序理由见上）。返回实际变更数，
        // 已是目标状态的账号不计入，避免提示夸大成「已停用 N 个」。
        const accountCount = await pool.setAccountsEnabled(req.provider, req.enabled)
        // 两个方向都改变 listModels 的结果（关/开黑名单），**必须广播**，
        // 否则对话框的模型选择器要重启才更新（成因见 broadcastCatalogChanged）。
        broadcastCatalogChanged(ctx)
        ctx.logger.info(
          `[channel-pack] ${req.enabled ? '打开' : '关闭'}供应商 ${req.provider}：`
          + `${req.enabled ? '清空' : '写入'} ${modelCount} 个模型、`
          + `${req.enabled ? '启用' : '停用'} ${accountCount} 个账号`,
        )
        const value: RpcProviderSetEnabledResponse = {
          provider: req.provider,
          enabled: req.enabled,
          models: modelCount,
          accounts: accountCount,
        }
        return { ok: true, value }
      }

      // ── 供应商自定义显示顺序（「供应商开关」弹窗的拖拽排序）──
      case 'provider.getOrder': {
        // 与 provider.status 同级的轻量读取：池内进程内存副本，无任何 IO。
        const value: RpcGetProviderOrderResponse = { order: pool.providerOrder() }
        return { ok: true, value }
      }
      case 'provider.setOrder': {
        const req = payload as RpcSetProviderOrderRequest
        if (!Array.isArray(req?.order) || req.order.some(id => typeof id !== 'string')) {
          return {
            ok: false,
            error: { code: 'bad-request', message: 'order 必须是字符串数组' },
          }
        }
        // ⚠️ 与 account.reorder 不同：这里**不校验**「必须恰好等于当前供应商
        // 清单」——展示侧（provider-toggle.js 的 sortOpenProvidersByOrder）对
        // 数组中不认识 / 缺失的 id 都有稳定兜底，并发下列表过期也不需要让用户
        // 重试，接受最后一次拖拽的结果即可。
        await pool.setProviderOrder(req.order)
        ctx.logger.info(`[channel-pack] 已更新供应商自定义显示顺序（${req.order.length} 项）`)
        return { ok: true, value: undefined }
      }

      // ── 本机 OpenAI 网关（`src/openai-gateway/`）──
      case 'gateway.getEnabled': {
        // ⚠️ **每个字段独立降级**：这里是设置页唯一的网关状态来源，任何一个附属
        // 字段采集失败都不该让**整个面板变空白**（开关、地址、密钥全看不到），
        // 更不该把用户挡在「关掉网关」这条自救路径之外。
        // 失败一律降级为 null / []，并在 logger 里带上是哪一步失败的。
        const degrade = async <T,>(step: string, run: () => T | Promise<T>, fallback: T): Promise<T> => {
          try {
            return await run()
          } catch (error) {
            ctx.logger.warn(
              `[channel-pack] gateway.getEnabled 的「${step}」读取失败，该字段降级为默认值：${String(error)}`,
            )
            return fallback
          }
        }
        const blockedByEnv = await degrade('env 开关', () => !isGatewayEnabled(process.env), true)
        const apiKey = await degrade('API Key', () => gatewayApiKey(), null)
        const address = await degrade('监听地址', () => (blockedByEnv ? null : gatewayAddress() ?? null), null)
        const llm = llmServiceOf(ctx)
        const listed = llm?.listProviders !== undefined
          ? (() => {
            try {
              const value = llm.listProviders!()
              return Array.isArray(value) && value.length > 0 ? value : undefined
            } catch { return undefined }
          })()
          : undefined
        const adapters = Object.keys(modelAdapters ?? {}).map((id) => ({ id }))
        const providers = listed ?? (adapters.length > 0 ? adapters : undefined)
        // 目录来源要让**空状态能自解释**：用户看到空清单时必须能分辨「我没登录」
        // 与「宿主没给出任何可枚举的 provider」。
        const modelsSource: RpcGatewayStatusResponse['modelsSource'] =
          listed !== undefined ? 'catalog' : (adapters.length > 0 ? 'adapters' : 'none')
        const value: RpcGatewayStatusResponse = {
          enabled: await degrade('开关状态', () => pool.gatewayEnabled(), true),
          running: await degrade('运行态', () => isGatewayRunning(), false),
          blockedByEnv,
          // 被 env 停用时即使 `enabled` 为真也不会监听，此时**不**回显地址，
          // 否则设置页会显示一个根本连不上的 URL。
          address,
          // ⚠️ 明文凭据：只用于设置页展示与复制，**不进日志**。
          apiKey: apiKey === null
            ? null
            : { value: apiKey.value, fromEnv: apiKey.fromEnv, path: apiKey.path },
          // 有些 agent（如 ZCode）不会主动扫目录，要靠用户手工填 ID，
          // 故这里把目录一并回传，让设置页内嵌展示。
          models: await degrade('模型目录', async () => {
            if (providers === undefined) {
              // ⚠️ 不能静默返回空：那会让用户以为是自己没登录，而真实原因是
              // 宿主根本没给出任何可枚举的 provider。modelsSource 会把这件事
              // 如实带到 UI 上。
              ctx.logger.warn('[channel-pack] gateway.getEnabled：既取不到 llm.listProviders，也没有任何已注册适配器可作兜底，模型清单为空')
              return [] as RpcGatewayModel[]
            }
            return collectGatewayCatalog(llm, providers, (provider, error) => {
              ctx.logger.warn(`[channel-pack] ${provider} 模型目录读取失败，已从网关列表跳过：${String(error)}`)
            })
          }, [] as RpcGatewayModel[]),
          modelsSource,
        }
        return { ok: true, value }
      }

      case 'gateway.setEnabled': {
        const req = payload as RpcGatewaySetEnabledRequest
        // ⚠️ 不做默认值猜测，与 `provider.setEnabled` 同约定：
        // 默认成 true 会静默打开用户特意关闭的网关。
        if (typeof req.enabled !== 'boolean') {
          return { ok: false, error: { code: 'bad-request', message: '非空布尔 enabled 必填' } }
        }
        // 先落盘再启停：启停失败（端口冲突）不该让已写入的开关回滚成
        // 「看起来没生效」——状态与运行态分开，由 status 的 running 字段区分。
        await pool.setGatewayEnabled(req.enabled)
        setGatewayDesiredEnabled(req.enabled)
        await applyGatewayDesiredState()
        const blockedByEnv = !isGatewayEnabled(process.env)
        ctx.logger.info(
          `[channel-pack] ${req.enabled ? '打开' : '关闭'}本机 OpenAI 网关`
          + `${blockedByEnv ? '（已被 DSH_OPENAI_GATEWAY_ENABLED 阻止）' : isGatewayRunning() ? '' : '（未在监听）'}`,
        )
        // 开关切换会创建/销毁实例，密钥随之可能从「尚无」变成「已生成」。
        const key = gatewayApiKey()
        const llm = llmServiceOf(ctx)
        // 刚打开网关 ⇒ 目录可能刚从空变成有值，必须重新采集。
        // ⚠️ 同样不让目录采集拖垮整个响应：它只是回传的附加值。
        const providers = req.enabled ? providerIdsOf(llm, modelAdapters) : undefined
        const modelsSource: RpcGatewayStatusResponse['modelsSource'] = !req.enabled
          ? 'none'
          : (llm?.listProviders !== undefined ? 'catalog' : (Object.keys(modelAdapters ?? {}).length > 0 ? 'adapters' : 'none'))
        const models = providers === undefined
          ? []
          : await collectGatewayCatalog(llm, providers, (provider, error) => {
            ctx.logger.warn(`[channel-pack] ${provider} 模型目录读取失败，已从网关列表跳过：${String(error)}`)
          }).catch((error: unknown) => {
            ctx.logger.warn(`[channel-pack] gateway.setEnabled 的模型目录刷新失败：${String(error)}`)
            return [] as RpcGatewayModel[]
          })
        const value: RpcGatewayStatusResponse = {
          enabled: req.enabled,
          running: isGatewayRunning(),
          blockedByEnv,
          address: blockedByEnv ? null : gatewayAddress() ?? null,
          apiKey: key === null ? null : { value: key.value, fromEnv: key.fromEnv, path: key.path },
          models,
          modelsSource,
        }
        return { ok: true, value }
      }

      // ── 账号备份（导出 / 导入）──
      //
      // 目的：更换 DSH 版本时迁移账号凭据。备份文件是**自包含**的 JSON
      // （账号索引 + 凭据原文 + 模型黑名单，见 src/backup.ts），与 DSH 版本
      // 无关 —— 导入时按**当前版本**的存储契约重建，天然跨版本。
      //
      // 安全约定：加密在浏览器侧完成（PBKDF2 + AES-GCM），RPC 只接收/返回
      // 明文载荷；明文 JSON 不经过本层持久化与日志。
      case 'backup.export': {
        const result = await exportBackup(pool, ctx.credentials)
        const value: RpcBackupExportResponse = {
          payload: result.payload,
          warnings: result.warnings,
        }
        return { ok: true, value }
      }

      // 导入 = 整体替换（还原快照，不是合并）。写入顺序刻意「先凭据、后账号池」：
      // 账号池整体替换成功后，门控（hasLoggedInAccount）与黑名单立即反映新状态；
      // 若凭据写入中途失败（非法 ref 等），只跳过该条、不中断整体。
      case 'backup.import': {
        const req = payload as RpcBackupImportRequest
        const result = await importBackup(ctx.credentials, pool, req.payload)
        // 导入会改变账号集合（门控依赖 hasLoggedInAccount）与模型黑名单，
        // 必须广播目录变更，否则界面仍显示旧目录。
        broadcastCatalogChanged(ctx)
        const value: RpcBackupImportResponse = {
          credentialsImported: result.credentialsImported,
          accountsImported: result.accountsImported,
          skipped: result.skipped,
          expiredAccounts: result.expiredAccounts,
          missingCredentials: result.missingCredentials,
        }
        return { ok: true, value }
      }

      // 账号池统计（导入前的覆盖提示用）：缺 expiresAt 的条目疑似 DSH 版本
      // 切换后自动恢复的产物（反推不读凭据值，故无有效期）。前端据此在
      // 确认导入前提示用户「有 N 个自动恢复的账号将被整体覆盖」。
      case 'backup.status': {
        const state = pool.getStateSnapshot()
        const value: RpcBackupStatusResponse = {
          accounts: state.accounts.length,
          withoutExpiry: state.accounts.filter((entry) => entry.expiresAt === undefined).length,
        }
        return { ok: true, value }
      }

      /**
       * 用量徽标读数（会话输入区、模型选择器旁那枚）。
       *
       * ## 与 `credits.balances` 的关系
       *
       * 读数是**同一份**（本分支内部直接复用 `credits.balances` 的实现，见
       * `usageBadge` 的装配注释），差别只有三处：
       * 1. 只返回**启用**账号，并给出 `disabledCount`（停用账号不进合计）；
       * 2. 多带一份订阅读数（窗口 / 套餐），判定表在 `src/badge-subscription.ts`；
       * 3. 带**宿主侧 TTL 缓存**（`cached` 标出来）—— 徽标按分钟轮询，而余额是
       *    逐账号顺序打上游的（`collectCreditBalances` 的「顺序查询，避免并发
       *    触发风控」），不缓存会让上游请求数随轮询线性放大。
       *
       * ⚠️ 未知 provider 的 `bad-request` 由内层 `credits.balances` 给出（那里
       * 已有 12 条分派与 `unsupported provider` 的统一文案），本分支**原样透传**，
       * 不另立一份 provider 名单 —— 两份名单必然漂移。
       *
       * ⚠️ `force: true` = 绕过缓存（手动刷新、签到之后）。
       */
      case 'usage.badge': {
        const req = payload as RpcUsageBadgeRequest
        const provider = typeof req.provider === 'string' ? req.provider.trim() : ''
        if (provider.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'provider 不能为空' } }
        }
        const value = await usageBadge.read(provider, req.force === true ? { force: true } : {})
        // `read()` 返回的就是本端点的响应信封（`{ ok, value|error }`），直接透传。
        return value
      }

      /**
       * **Token 账本**快照（「Token 用量」面板）。
       *
       * 纯内存读（`readTokenLedger`），不打上游、不做任何 I/O —— 面板可以
       * 随意刷新。数据在重启后为空是**既定行为**（第 1 期不持久化），UI 负责
       * 把「进程内存账本」这一事实讲清楚。
       *
       * ⚠️ 这里**不**做渠道/provider 过滤：账本条数上限 500，全量下发即可，
       * 过滤维度（渠道、provider、模型）都由 UI 在聚合树上展开，避免为每个
       * 维度各造一个 RPC 端点。
       */
      case 'usage.tokenLedger': {
        const req = payload as RpcUsageTokenLedgerRequest
        const snapshot = readTokenLedger(
          typeof req?.limit === 'number' && Number.isFinite(req.limit) && req.limit > 0
            ? { limit: Math.trunc(req.limit) }
            : {},
        )
        const value: RpcUsageTokenLedgerResponse = { snapshot }
        return { ok: true, value }
      }

      /**
       * **历史日聚合**（第 4 期 · 「Token 用量」弹窗的历史视图）。
       *
       * 数据源是落盘的日聚合表（`token-ledger.json`，重启保留）—— 纯内存
       * 计算（Map 树 → 数组），不打上游、不做额外 I/O。
       *
       * ⚠️ `sinceDays` 钳制在 `[1, TOKEN_LEDGER_HISTORY_MAX_DAYS]`：0/负数
       * 按「仅今日」处理（省略 = 全部历史），超过上限裁到上限 —— 落盘本身
       * 只保留 90 天，更大的窗口只会白算。
       */
      case 'usage.tokenLedgerHistory': {
        const req = payload as RpcUsageTokenLedgerHistoryRequest
        const raw = req?.sinceDays
        const sinceDays = typeof raw === 'number' && Number.isFinite(raw)
          ? Math.min(Math.max(Math.trunc(raw), 1), TOKEN_LEDGER_HISTORY_MAX_DAYS)
          : undefined
        const result = readTokenLedgerHistory(readTokenLedgerDayMap(), { sinceDays })
        const value: RpcUsageTokenLedgerHistoryResponse = { history: result.days, totals: result.totals }
        return { ok: true, value }
      }

      /**
       * 用量徽标的显示偏好（读 / 写，**全局一个**，不分渠道）。
       *
       * ⚠️ `preference` 省略时**只读**（徽标首次渲染与设置面板初始化都用它）；
       * 给出时必须是 `auto` / `subscription` / `credits` 之一。
       *
       * ⚠️ 非法值**拒绝**而不是静默回落：回落会让「设置没生效」看起来像
       * 「保存成功」（用户改完刷新，界面仍按旧口径显示，且没有任何提示）。
       * 磁盘脏数据的容错在 `sanitizeBadgePreference`（那条路径面对的不是用户输入）。
       */
      case 'usage.badgePreference': {
        const req = payload as RpcUsageBadgePreferenceRequest
        if (req.preference === undefined) {
          const value: RpcUsageBadgePreferenceResponse = { preference: badgePreferences.load() }
          return { ok: true, value }
        }
        if (!(BADGE_PREFERENCES as readonly unknown[]).includes(req.preference)) {
          return {
            ok: false,
            error: {
              code: 'bad-request',
              message: `preference 必须是 ${BADGE_PREFERENCES.join(' / ')} 之一（收到：${JSON.stringify(req.preference)}）`,
            },
          }
        }
        await badgePreferences.save(req.preference)
        const value: RpcUsageBadgePreferenceResponse = { preference: badgePreferences.load() }
        return { ok: true, value }
      }

      /**
       * 「每日首次启动自动签到」开关（读 / 写，**全局一个**，不分渠道）。
       *
       * ⚠️ `enabled` 省略时**只读**；给出时必须是布尔值。非法值拒绝而不是静默
       * 回落 —— 理由与 `usage.badgePreference` 完全一致（回落会让「设置没生效」
       * 看起来像「保存成功」）。
       *
       * ⚠️ 写入 `true` 时宿主会**立刻尝试跑一轮**（今天已跑过则由执行体内部拦住）：
       * 否则用户今天打开开关要等到明天才有动作，看起来像没生效。返回值里的
       * `running` 会立刻为 `true`，界面据此显示「进行中」。
       */
      case 'usage.autoCheckin': {
        const req = payload as RpcUsageAutoCheckinRequest
        /**
         * 关闭那行**常驻**的自动签到状态文字。
         *
         * ⚠️ 与 `enabled` 分开判而不是「先 dismiss 再 enabled」：两者语义独立，
         * 一次请求只该做一件事 —— 否则 `{ dismiss: true, enabled: true }` 会
         * 既关文字又改开关，客户端将来误传就难查。
         */
        if (req.dismiss !== undefined) {
          if (typeof req.dismiss !== 'boolean') {
            return {
              ok: false,
              error: {
                code: 'bad-request',
                message: `dismiss 必须是布尔值（收到：${JSON.stringify(req.dismiss)}）`,
              },
            }
          }
          if (req.dismiss) {
            const value: RpcUsageAutoCheckinResponse = { autoCheckin: await autoCheckin.dismiss() }
            return { ok: true, value }
          }
        }
        if (req.enabled === undefined) {
          const value: RpcUsageAutoCheckinResponse = { autoCheckin: autoCheckin.state() }
          return { ok: true, value }
        }
        if (typeof req.enabled !== 'boolean') {
          return {
            ok: false,
            error: {
              code: 'bad-request',
              message: `enabled 必须是布尔值（收到：${JSON.stringify(req.enabled)}）`,
            },
          }
        }
        const value: RpcUsageAutoCheckinResponse = { autoCheckin: await autoCheckin.setEnabled(req.enabled) }
        return { ok: true, value }
      }

      default:
        return { ok: false, error: { code: 'bad-request', message: `unknown method: ${method}` } }
    }
  }
}

/** 构造带 rpcId 的响应 JSON */
function reply(rpcId: string, result: unknown): Response {
  const value = typeof result === 'object' && result !== null && (result as Record<string, unknown>).ok === false
    ? { ...result as Record<string, unknown>, error: { ...(result as Record<string, unknown>).error as Record<string, unknown>, details: {} } }
    : result
  return Response.json({ type: 'server-response', rpcId, result: value })
}
