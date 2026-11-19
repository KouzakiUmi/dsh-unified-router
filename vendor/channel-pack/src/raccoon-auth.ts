/**
 * Raccoon Work 认证服务。
 *
 * ## 与其余 provider 的差异
 *
 * | 维度 | raccoon | 对照 |
 * |---|---|---|
 * | 登录 | 微信扫码 + 短信（本地页承载） | Loomy 同型 |
 * | 续期 | **有** `refresh_token` 轮换 | Loomy 没有（恒 false） |
 * | 凭据过期 | JWT `exp` 本地解码 | 比 Loomy 的「登录时刻 + 14 天推算」更准 |
 *
 * ## 两条硬约束（来自 AGENTS.md 的真实缺陷）
 *
 * 1. **`refreshAll` 只按 `refreshable` 过滤，绝不看 `enabled`** ——
 *    停用只影响账号池的自动选号，与「凭据是否需要保持新鲜」无关。
 *    早期按 `enabled` 过滤导致两个停用账号的 refresh_token 被放到失效。
 * 2. **`refreshAccountCredential(refName)` 只读写传入的 ref** ——
 *    账号卡片要刷的是 `RACCOON_ACCOUNT_XXX`，而 `refresh()` 读写默认单凭据 ref。
 *    错配的后果是「刷了另一个凭据」（本插件在 Cline 上踩过同类坑）。
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountPool } from './account-pool.js'
import type { ClaimOutcome, CreditBalance } from './credits.js'
import {
  isRaccoonExpired,
  isRaccoonRefreshable,
  raccoonCredentialExpiresAtMs,
  raccoonDisplayName,
  decodeJwtExpMs,
  type RaccoonCredential,
  type RaccoonModelMeta,
} from './raccoon.js'
import {
  claimRaccoonLoginReward,
  fetchRaccoonCreditBalance,
  fetchRaccoonOnboardingStatus,
} from './raccoon-credits.js'
import {
  fetchRaccoonUserInfo,
  refreshRaccoonCredential,
} from './raccoon-oauth.js'
import {
  RACCOON,
  parseRaccoonThinking,
  raccoonSupportsImage,
  type RaccoonProduct,
  type RaccoonThinkingInfo,
} from './raccoon-product.js'
import {
  startRaccoonLoginFlow,
  type StartedRaccoonLoginFlow,
} from './raccoon-login-page.js'
import {
  syncAccountExpiry,
  type ExpiryAccessors,
} from './expiry-sync.js'

/**
 * Raccoon 凭据 → 账号池有效期的提取器。
 *
 * 本 provider 是这套回写的**原产地**：早期它是唯一漏掉回写的实现（用户报障后
 * 修好），现把那份逻辑抽到 `src/expiry-sync.ts` 供九个 provider 共用 ——
 * 留两份必然漂移，故这里改为调用共享实现。
 */
const RACCOON_EXPIRY_ACCESSORS: ExpiryAccessors<RaccoonCredential> = {
  expiresAtOf: raccoonCredentialExpiresAtMs,
  refreshableOf: isRaccoonRefreshable,
  identityOf: (credential) => credential.access_token ?? '',
}

/** 默认凭据 ref 名称（与 `RaccoonProduct.defaultCredentialRef` 一致）。 */
export const RACCOON_CREDENTIAL_REF = 'RACCOON_ACCESS_TOKEN'

/**
 * 续期令牌失效。
 *
 * 单独一个类而不是 `Error`：调用方据此区分「需要重新登录」（终态）
 * 与「暂时性失败」（可重试），分别决定 UI 文案与是否继续重试。
 */
export class RefreshTokenExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefreshTokenExpiredError'
  }
}

/** 登录/续期后的结果（与 `LoomyLoginResult` 同构）。 */
export interface RaccoonLoginResult {
  /** 已存储的凭据 JSON 字符串。 */
  access: string
  /** 凭据过期的毫秒时间戳（无法解析时为 0）。 */
  expires: number
  /** 凭据值存储所用的凭据引用。 */
  ref: CredentialRef
  /** 是否可续期（取决于是否存在 refresh_token）。 */
  refreshable: boolean
}

/** 只读登录状态。 */
export interface RaccoonLoginStatus {
  configured: boolean
  source?: string
  expiresAt?: number
  refreshable: boolean
  refreshError?: string
}

/** 远端模型条目（已归一）。 */
export interface RaccoonRemoteModel {
  id: string
  /** **已规范化**的展示名（含倍率）。 */
  name: string
  contextWindow: number
  maxTokens: number
  supportsImage?: boolean
  /**
   * 生效倍率（远端 `billing_effective_multiplier`）。
   *
   * ⚠️ **`0` 与 `undefined` 是两个不同结论**（展示名据此拼「免费」/「x倍率」）：
   * - `0` = 该模型对本账号**免费**；
   * - `>0` = 计费模型；
   * - `undefined` = 远端**没下发**该字段（NaN / 非数字 / 缺失），按「未知」处理。
   *
   * 故这里**不**把缺失折算成 0 —— 那会让「未知」的模型被当成免费展示。
   *
   * ⚠️ **它不是模型归属判据**：免费面与订阅面各自用本侧账号的凭据拉目录，
   * 上游给什么就展示什么，**不按倍率过滤**（按倍率切同一份目录是上一版的缺陷）。
   */
  effectiveMultiplier?: number
  /**
   * 计费状态（远端 `billing_status`，归一为 `normal` / `discount` / `limited_free`）。
   *
   * 供模型选择器徽标区分「限时免费」与「正在打折」—— `effectiveMultiplier`
   * 单看数值分不出这两种促销（见 `model-rate-badge.ts`）。
   *
   * ⚠️ 兜底表条目没有该字段（离线时无上游结论），故为可选。
   */
  status?: RaccoonModelMeta['status']
  /** 原价倍率（远端 `billing_multiplier`）；缺失= 未下发，不折算成 0。 */
  baseMultiplier?: number
  /** 状态角标文案（远端 `billing_status_note`，如「限免一个月」）。 */
  statusNote?: string
  /**
   * 逐模型托管思考档位（远端 `params.raccoon_thinking`，2026-11 上线）。
   *
   * `undefined` = 该模型**没有**托管档位（上游没下发该块、或 `managed !== true`），
   * 适配器据此回退旧方言 `extra_body.thinking`（开 / 关两态）。
   * 解析规则与「两套方言互斥」的实测依据见 `raccoon-product.ts` 的文件头。
   */
  thinking?: RaccoonThinkingInfo
}

/**
 * 账号套餐档位（`GET /api/web/auth/v1/entitlement_info` 的结论）。
 *
 * ⚠️ **`'unknown'` 是合法结论，不是错误**：403/网络失败/响应形状不认识时
 * 都归它，调用方按「不猜」处理（免费侧）。把探测失败折算成 `'free'` 会让
 * 付费账号被当成免费账号去服务 0× 模型（表面上能用，实则错配）。
 */
export type RaccoonPlan = 'free' | 'pro' | 'unknown'

/** `RaccoonAuth` 的构造选项。 */
export interface RaccoonAuthOptions {
  /** 注入的 fetch（测试用）。 */
  fetcher?: typeof fetch
  /** 产品配置；默认 {@link RACCOON}。 */
  product?: RaccoonProduct
  /** 服务名覆盖（默认由产品 id 派生为 `raccoonAuth`）。 */
  serviceName?: string
}

/** 解析凭据 JSON；形状不对返回 undefined（不抛错）。 */
export function parseRaccoonCredential(value: string): RaccoonCredential | undefined {
  try {
    const parsed = JSON.parse(value) as RaccoonCredential
    return typeof parsed === 'object' && parsed !== null && typeof parsed.access_token === 'string'
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

/** 把远端模型条目归一（含展示名）。 */
function normalizeRemoteModel(entry: Record<string, unknown>): RaccoonRemoteModel | undefined {
  const id = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (id.length === 0) return undefined
  // 远端 visible 缺省视为可见（保守：不因字段缺失而隐藏模型）
  if (entry.visible === false) return undefined

  const params = typeof entry.params === 'object' && entry.params !== null
    ? entry.params as Record<string, unknown>
    : {}
  const description = typeof entry.description === 'string' && entry.description.length > 0
    ? entry.description
    : id
  const effective = typeof entry.billing_effective_multiplier === 'number'
    ? entry.billing_effective_multiplier
    : Number.NaN
  const base = typeof entry.billing_multiplier === 'number' ? entry.billing_multiplier : Number.NaN
  const rawStatus = typeof entry.billing_status === 'string' ? entry.billing_status : ''
  const status: RaccoonModelMeta['status'] = rawStatus === 'discount' || rawStatus === 'limited_free'
    ? rawStatus
    : 'normal'
  const statusNote = typeof entry.billing_status_note === 'string' ? entry.billing_status_note : ''

  // 托管思考档位：上游 2026-11 起逐模型下发。解析失败/缺失一律 undefined
  //（适配器回退旧方言两态），**不猜**该模型支持哪些档。
  const thinking = parseRaccoonThinking(params.raccoon_thinking)

  const meta: RaccoonModelMeta = {
    id,
    description,
    effectiveMultiplier: effective,
    baseMultiplier: base,
    status,
    statusNote,
  }

  const readPositiveInt = (value: unknown): number => {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
  }
  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
    : []

  return {
    id,
    name: raccoonDisplayName(meta),
    contextWindow: readPositiveInt(params.context_window ?? entry.context_window),
    maxTokens: readPositiveInt(params.max_tokens),
    // ⚠️ 只保留**有限**数值：NaN / Infinity 一律视为「未下发」，
    // 交给调用方按缺省规则（本插件：缺失 → 订阅版）分流。
    ...Number.isFinite(effective) ? { effectiveMultiplier: effective } : {},
    // 促销判定信息（模型选择器徽标用，见 `model-rate-badge.ts`）：
    // 与 `effectiveMultiplier` 同口径 —— 非有限数视为「未下发」，不折算成 0。
    status,
    ...Number.isFinite(base) ? { baseMultiplier: base } : {},
    ...statusNote.length > 0 ? { statusNote } : {},
    ...thinking === undefined ? {} : { thinking },
    // ⚠️ **不能只看 tags**：`vision` 是客户端「Raccoon-Auto 选模」的偏好标签，
    // 不是服务端能力契约（远端根本没有模态字段，已穷举证实）。`tags` 不含
    // `vision` 的 `sn-deepseek-v4-1-flash` 实测能看图（5/5 读对随机数字），
    // 只认 tags 会让它被 DSH 投影成文本占位符 —— 图片根本发不出去。
    // 证据与取舍见 `raccoon-product.ts` 的 RACCOON_IMAGE_CAPABILITY_OVERRIDES。
    ...(raccoonSupportsImage(id, tags) ? { supportsImage: true } : {}),
  }
}

/** 值为普通对象时原样返回，否则 `undefined`（探测解析用，不抛错）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 取套餐块里的类型字符串（`type` / `plan_type` / `planType` 三种写法都认）。 */
function planTypeOf(value: unknown): string | undefined {
  const plan = asRecord(value)
  if (plan === undefined) return undefined
  for (const key of ['type', 'plan_type', 'planType']) {
    const raw = plan[key]
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim().toLowerCase()
  }
  return undefined
}

/** 非空且非 none/free 的套餐类型即「付费套餐」。 */
function isPaidPlanType(planType: string): boolean {
  return planType !== 'none' && planType !== 'free'
}

/**
 * 解析 `entitlement_info` 响应 → {@link RaccoonPlan}。
 *
 * ## 判据（按优先级，先命中先返回）
 *
 * 1. `pro_enable === true` → `'pro'`；
 * 2. `active_plan.type` / `plan_type` 非空且非 `none`/`free`（如 `subscription`、
 *    `one_time_purchase`）→ `'pro'`；
 * 3. 明确 `pro_enable === false` 且没有付费套餐类型 → `'free'`；
 * 4. 其余（形状不认识、两个信号都没有）→ `'unknown'`。
 *
 * 权益块的位置：上游把它放在 `office` 段，个别响应可能直接在根上或包在
 * `data`/`result`/`code` 里（`code` 在少数网关里被当作容器键）。这些都认，
 * 认不出的形状一律 `'unknown'` —— **不猜**。
 *
 * 导出是为了让测试能直接覆盖解析表（不经过网络）。
 */
export function parseRaccoonPlan(payload: unknown): RaccoonPlan {
  const root = asRecord(payload)
  if (root === undefined) return 'unknown'
  const blocks = [root.office, root.data, root.result, root.code, root]
    .map(asRecord)
    .filter((block): block is Record<string, unknown> => block !== undefined)
  let explicitFree = false
  for (const block of blocks) {
    if (block.pro_enable === true) return 'pro'
    if (block.pro_enable === false) explicitFree = true
    for (const key of ['active_plan', 'activePlan', 'plan', 'subscription']) {
      const planType = planTypeOf(block[key])
      if (planType === undefined) continue
      if (isPaidPlanType(planType)) return 'pro'
      // 明确的 none / free：与 pro_enable === false 同义。
      explicitFree = true
    }
  }
  return explicitFree ? 'free' : 'unknown'
}

/**
 * Raccoon Work 认证服务。
 *
 * 登录走**本地页承载**的扫码/短信双路径（见 `raccoon-login-page.ts`），
 * 续期走 `refresh_token` 轮换（与 Loomy 不同）。
 */
export class RaccoonAuth extends Service {
  /** 本实例所属的产品配置。 */
  readonly product: RaccoonProduct
  /** 本实例默认读写的凭据 ref 名称。 */
  readonly credentialRefName: string

  /** 最近一次续期失败的原因（供 `status()` 暴露给 UI）。 */
  private lastRefreshError: string | undefined

  constructor(ctx: Context, private readonly options: RaccoonAuthOptions = {}) {
    const product = options.product ?? RACCOON
    super(ctx, options.serviceName ?? `${product.id}Auth`)
    this.product = product
    this.credentialRefName = this.product.defaultCredentialRef
  }

  /** 注入的 fetch（测试用）；默认为全局 fetch。 */
  private get fetchImpl(): typeof fetch {
    return this.options.fetcher ?? fetch
  }

  /**
   * 启动登录（微信扫码 + 短信双路径）。
   *
   * 起本地服务器承载弹窗页，**立即返回 `loginUrl`** —— 与其余 provider 的
   * 「两步式」契约一致（`window.open` 只在用户手势窗口内有效，
   * 不能等流程跑完再返回）。
   */
  async startLogin(): Promise<StartedRaccoonLoginFlow> {
    return startRaccoonLoginFlow({
      product: this.product,
      ...this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher },
    })
  }

  /**
   * 把登录结果落盘成凭据。
   *
   * 与 `startLogin` 分开：流程编排（本地服务器 + 轮询 + 表单）在
   * `raccoon-login-page.ts` 里，本方法只负责「补全用户信息 + 写凭据 +
   * 静默领取一次性登录奖励」。
   */
  async persistLogin(
    credential: RaccoonCredential,
    flowOptions: { refName?: string } = {},
  ): Promise<RaccoonLoginResult> {
    const refName = flowOptions.refName ?? this.credentialRefName

    // 尽力补全用户信息（id / 昵称 / 身份 / 手机号）：失败不影响登录。
    let enriched: RaccoonCredential = credential
    if (
      credential.nickname === undefined
      || credential.user_id === undefined
      || credential.phone === undefined
    ) {
      const info = await fetchRaccoonUserInfo(this.product, credential, this.fetchImpl)
      enriched = {
        ...credential,
        ...info.userId !== undefined && credential.user_id === undefined ? { user_id: info.userId } : {},
        ...info.nickname !== undefined && credential.nickname === undefined ? { nickname: info.nickname } : {},
        ...info.officeIdentity !== undefined && credential.office_identity === undefined
          ? { office_identity: info.officeIdentity } : {},
        // ⚠️ 手机号专门为**多账号消歧**而存：远端的 `name` 是自动生成的默认名
        //（实测 `RaccoonAva`），微信扫码不回传微信昵称，故多个账号会重名。
        ...info.phone !== undefined && credential.phone === undefined ? { phone: info.phone } : {},
      }
    }

    const ref = credentialRef(refName)
    await this.ctx.credentials.set(ref, JSON.stringify(enriched))
    this.lastRefreshError = undefined

    // 尽力领取**一次性**登录奖励（3000 分）。幂等：已领过返回 granted:false。
    // 失败不影响登录成功 —— 登录已经完成了，不能因为积分接口抖动而报错。
    try {
      await claimRaccoonLoginReward(this.product, enriched, this.fetchImpl)
    } catch (error) {
      this.ctx.logger?.warn?.(
        `[raccoon] 登录后领取登录奖励失败（不影响登录）：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return {
      access: JSON.stringify(enriched),
      expires: decodeJwtExpMs(enriched.access_token) ?? 0,
      ref,
      refreshable: isRaccoonRefreshable(enriched),
    }
  }

  /** 只读登录状态。 */
  async status(): Promise<RaccoonLoginStatus> {
    const credential = await this.resolveDefaultCredential()
    if (credential === undefined) return { configured: false, refreshable: false }
    const expiresAt = decodeJwtExpMs(credential.access_token)
    return {
      configured: true,
      source: this.credentialRefName,
      ...expiresAt === undefined ? {} : { expiresAt },
      refreshable: isRaccoonRefreshable(credential),
      ...this.lastRefreshError === undefined ? {} : { refreshError: this.lastRefreshError },
    }
  }

  /** 解析默认 ref 的凭据。 */
  private async resolveDefaultCredential(): Promise<RaccoonCredential | undefined> {
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef(this.credentialRefName))
      return resolved === undefined ? undefined : parseRaccoonCredential(resolved.value)
    } catch {
      return undefined
    }
  }

  /**
   * 续期默认单凭据。
   *
   * @throws {RefreshTokenExpiredError} refresh_token 失效（需重新登录）。
   */
  async refresh(): Promise<void> {
    const credential = await this.resolveDefaultCredential()
    if (credential === undefined) throw new RefreshTokenExpiredError('凭据未配置，请先登录')
    if (!isRaccoonRefreshable(credential)) {
      throw new RefreshTokenExpiredError('凭据缺少 refresh_token，请重新登录')
    }
    try {
      const next = await refreshRaccoonCredential(this.product, credential, this.fetchImpl)
      await this.ctx.credentials.set(credentialRef(this.credentialRefName), JSON.stringify(next))
      this.lastRefreshError = undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastRefreshError = message
      if (message.includes('重新登录')) throw new RefreshTokenExpiredError(message)
      throw error
    }
  }

  /**
   * 续期**指定 ref**（RPC `account.refresh` / 定时器）。
   *
   * ⚠️ 只读写传入的 ref，**不碰**默认单凭据 ref —— 账号池里的是
   * `RACCOON_ACCOUNT_XXX`，用 `refresh()` 会刷错凭据。
   * ⚠️ **不触碰** `lastRefreshError`：那属于单凭据路径，
   * 被多账号操作污染会让 UI 显示错误的失效提示。
   *
   * ⚠️ **必须把新过期时间写回账号池**（真实缺陷，用户报障）：
   * 只更新凭据、不更新账号池，会让 Channel Pack 一直显示「已过期」——
   * 因为 UI 读的是账号池的 `expiresAt`，而它停留在续期前的旧值。
   * 实测该账号的 JWT `exp` 已是 15:09（有效），账号池却是 12:02（已过期），
   * **相差 3.1 小时**，UI 显示「已过期」但发消息完全正常。
   *
   * @param pool 账号池；提供时会把新 `expiresAt` / `refreshable` 写回。
   * @param accountId 账号 id。**调用方已知时请显式传入** ——
   *   否则只能按凭据内容反查（`findAccountIdByCredential` 遍历账号、
   *   逐个解析凭据比对，代价高且需要账号池具备凭据访问能力）。
   */
  async refreshAccountCredential(
    refName: string,
    pool?: AccountPool,
    accountId?: string,
  ): Promise<void> {
    const ref = credentialRef(refName)
    const resolved = await this.ctx.credentials.resolve(ref)
    if (!resolved) throw new Error('凭据未配置')
    const credential = parseRaccoonCredential(resolved.value)
    if (!credential) throw new Error('凭据解析失败')
    if (!isRaccoonRefreshable(credential)) {
      throw new RefreshTokenExpiredError('凭据缺少 refresh_token，请重新登录')
    }
    try {
      const next = await refreshRaccoonCredential(this.product, credential, this.fetchImpl)
      await this.ctx.credentials.set(ref, JSON.stringify(next))
      await syncAccountExpiry({
        pool,
        provider: this.product.id,
        credential: next,
        accessors: RACCOON_EXPIRY_ACCESSORS,
        accountId,
        tag: '[raccoon]',
        warn: (message) => this.ctx.logger?.warn?.(message),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('重新登录')) throw new RefreshTokenExpiredError(message)
      throw error
    }
  }

  /**
   * 说明：原先这里有一份私有的 `syncAccountExpiry`（把续期后的过期时间写回
   * 账号池，失败只记日志不上抛）。它已被抽到 `src/expiry-sync.ts` 成为九个
   * provider 共用的实现 —— 三条硬规矩（失败不反噬、优先用调用方的 accountId、
   * 反查要传**凭据内容**而非 ref 名）都随之外移并记在那份文件的注释里。
   */

  /**
   * 批量续期本产品的账号。
   *
   * ⚠️ **只按 `refreshable` 过滤，不看 `enabled`**：停用只影响账号池的
   * 自动选号，与「凭据是否需要保持新鲜」无关。早期按 `enabled` 过滤导致
   * 两个停用账号的 refresh_token 在停用期间被放到失效（真实缺陷，见 AGENTS.md）。
   *
   * 单账号失败不影响其他账号（且**必须留日志**：曾完全静默的实现
   * 让「续期永远失败但 UI 显示可续期」无法排查）。
   */
  async refreshAll(pool: AccountPool): Promise<void> {
    const accounts = await pool.listAccounts(this.product.id)
    for (const entry of accounts) {
      // ⚠️ 判据只看 refreshable
      if (!entry.refreshable) continue

      const resolved = await this.ctx.credentials.resolve(credentialRef(entry.credentialRef))
      if (!resolved) continue
      const credential = parseRaccoonCredential(resolved.value)
      if (credential === undefined) continue

      // ⚠️ **凭据仍在有效期内时也要校正账号池的 `expiresAt`**（真实缺陷的完整修法）：
      //
      // 早期版本续期后不回写账号池，于是账号池停留在旧值（已过期），
      // 而 UI 读的正是账号池 → 一直显示「已过期」但功能完全正常。
      // 修复「续期时回写」之后，**存量账号**仍然是坏的：它们的凭据
      // 早已续期成功（JWT exp 在未来），故这里的判据为 false、
      // 这条 `continue` 会**永远跳过它们** —— 账号池的值再也无人更正。
      //
      // 故这里主动比对：凭据的过期时间与账号池记录**不一致**时以凭据为准回写。
      // 判据用「不一致」而不是「账号池已过期」：后者会漏掉「账号池值偏小但
      // 尚未过期」的情形（同样会让 UI 显示错误的剩余时间）。
      //
      // 判据沿用本 provider 原有的「**已过期**才刷」（不是共享的 1 小时 lead）：
      // raccoon 的 access_token 寿命约 3 小时，30 分钟的定时器足以覆盖，
      // 提前 1 小时刷只会多打请求 —— lead-time 过滤的目的恰恰是**减少**无谓请求。
      if (!isRaccoonExpired(credential)) {
        const actual = raccoonCredentialExpiresAtMs(credential)
        // 容忍 1 秒误差（毫秒时间戳来自 JWT 的秒级 exp，换算后可能有舍入）
        if (actual !== undefined && Math.abs((entry.expiresAt ?? 0) - actual) > 1000) {
          try {
            await pool.updateAccount(entry.id, { expiresAt: actual })
            this.ctx.logger?.info?.(
              `[raccoon] 已校正账号 ${entry.id} 的有效期显示`
              + `（账号池 ${entry.expiresAt === undefined ? '无' : new Date(entry.expiresAt).toISOString()}`
              + ` → ${new Date(actual).toISOString()}）`,
            )
          } catch (error) {
            this.ctx.logger?.warn?.(
              `[raccoon] 校正账号 ${entry.id} 的有效期失败（不影响使用）：`
              + `${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        continue
      }

      try {
        // ⚠️ 必须传 `pool` + `entry.id`：否则续期后不回写 `expiresAt`，
        // UI 会一直显示「已过期」（真实缺陷，见方法注释）。
        await this.refreshAccountCredential(entry.credentialRef, pool, entry.id)
      } catch (error) {
        if (error instanceof RefreshTokenExpiredError) {
          this.ctx.logger?.warn?.(`[raccoon] 账号 ${entry.id} 的 refresh_token 已失效，需重新登录`)
        } else {
          this.ctx.logger?.warn?.(
            `[raccoon] 账号 ${entry.id} 续期失败：${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }

  /** 登出：清除默认单凭据。 */
  async logout(): Promise<void> {
    await this.ctx.credentials.unset(credentialRef(this.credentialRefName))
    this.lastRefreshError = undefined
  }

  /**
   * 拉取远端模型目录。
   *
   * ⚠️ 失败时返回**空数组**：适配器据此回退兜底表。
   * 让模型目录失败不抛错，是为了不让整个 provider 在模型选择器里报错。
   */
  async fetchModels(pool?: AccountPool): Promise<RaccoonRemoteModel[]> {
    const credential = await this.resolveForFetchModels(pool)
    if (credential === undefined) return []
    return this.fetchModelsWithCredential(credential)
  }

  /**
   * 用**指定凭据**拉远端模型目录。
   *
   * 为什么要把 fetch+parse 抽出来：`billing_effective_multiplier` 是**按账号
   * 套餐生效**的 —— 免费账号看到 0× 的那两条，订阅账号看到计费的那几条。
   * 而本插件只有一个账号池（`raccoon`），两个模型 provider 必须各自用
   * 「属于自己那一侧」的账号凭据去拉目录（见 `src/backend.ts` 的
   * `mountRaccoon`），不能像拆分账号池时那样「随便取一个可用账号」。
   *
   * ⚠️ 失败/无令牌时返回**空数组**（调用方回退兜底表），与本类其它目录方法
   * 同约定：目录失败不该让 provider 在模型选择器里报错。
   */
  async fetchModelsWithCredential(credential: RaccoonCredential): Promise<RaccoonRemoteModel[]> {
    if (typeof credential?.access_token !== 'string' || credential.access_token.length === 0) return []
    try {
      const response = await this.fetchImpl(
        `${this.product.apiBase}${this.product.llmApiPrefix}/model_catalog`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${credential.access_token}`,
            'X-Org-Code': credential.office_identity ?? '',
            'X-Raccoon-Language': 'zh',
          },
          signal: AbortSignal.timeout(20_000),
        },
      )
      if (!response.ok) return []
      const payload = await response.json() as unknown
      return parseRaccoonModelCatalog(payload)
    } catch {
      return []
    }
  }

  /**
   * 探测账号的**套餐档位**（免费 / 订阅 / 未知）。
   *
   * 端点：`GET {apiBase}/api/web/auth/v1/entitlement_info`（Bearer access_token，
   * 头与模型目录一致）。判据见 {@link parseRaccoonPlan}。
   *
   * ⚠️ **永不抛错**，失败一律 `'unknown'`：本方法是登录流程的**附加**步骤
   * （登录成功后才探测），探测失败不能让用户看到「登录失败」——那会让一个
   * 只是拿不到套餐信息的账号被反复重登。调用方把 `'unknown'` 归到免费侧。
   */
  async fetchPlan(credential: RaccoonCredential): Promise<RaccoonPlan> {
    if (typeof credential?.access_token !== 'string' || credential.access_token.length === 0) return 'unknown'
    try {
      const response = await this.fetchImpl(
        `${this.product.apiBase}${this.product.authApiPrefix}/entitlement_info`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${credential.access_token}`,
            'X-Org-Code': credential.office_identity ?? '',
            'X-Raccoon-Language': 'zh',
          },
          signal: AbortSignal.timeout(20_000),
        },
      )
      // 403（无权益端点权限）/ 404 / 5xx：没有结论，不猜。
      if (!response.ok) return 'unknown'
      return parseRaccoonPlan(await response.json() as unknown)
    } catch {
      return 'unknown'
    }
  }

  /** 取一个可用凭据（先账号池，再默认 ref）。 */
  private async resolveForFetchModels(pool?: AccountPool): Promise<RaccoonCredential | undefined> {
    if (pool !== undefined) {
      try {
        // ⚠️ 返回类型是 `| null`（不是 undefined）—— 判空必须用 `!= null` 或显式 null。
        const available = await pool.getAvailableAccount(this.product.id, '')
        if (available !== null && available !== undefined) {
          const credential = available.credential as unknown as RaccoonCredential
          if (typeof credential?.access_token === 'string') return credential
        }
      } catch {
        // 落到默认 ref
      }
    }
    return this.resolveDefaultCredential()
  }

  /** 查询积分余额（供 Channel Pack 账号卡片）。 */
  async fetchCreditBalance(credential: RaccoonCredential): Promise<CreditBalance | null> {
    return fetchRaccoonCreditBalance(this.product, credential, this.fetchImpl)
  }

  /** 领取一次性登录奖励。 */
  async claimLoginReward(credential: RaccoonCredential): Promise<ClaimOutcome> {
    return claimRaccoonLoginReward(this.product, credential, this.fetchImpl)
  }

  /** 查询一次性登录奖励是否已领。 */
  async fetchOnboardingStatus(
    credential: RaccoonCredential,
  ): Promise<{ claimed: boolean; points: number }> {
    return fetchRaccoonOnboardingStatus(this.product, credential, this.fetchImpl)
  }

  /**
   * 一次性修复**老账号**的昵称与凭据字段（启动时调用）。
   *
   * ## 为什么需要它
   *
   * 早期实现有两处不足，导致**已登录的账号不会自动更正**：
   *
   * 1. 账号昵称直接用了服务端的 `name`（实测 `RaccoonAva` —— 它是服务端
   *    **自动生成的默认名**，注册第二个账号时会重名、无法区分）；
   * 2. 凭据里**没有存 `phone`**（后来才发现 `user_info.phone` 可用于消歧）。
   *
   * 光改代码只影响**新登录**的账号，老账号的昵称/凭据仍是旧值。
   * 故这里主动补一次：读凭据 → 缺 `phone` 就拉一次 `user_info` 补上 →
   * 用 `buildRaccoonNickname` 重算昵称并写回账号池。
   *
   * ## 语义约束
   *
   * - **幂等**：昵称已是目标形态时不写（避免每次启动都落盘）。
   * - **失败不阻塞启动**：单个账号失败只记日志，抛错由调用方 catch。
   * - **不发写请求**：只调只读的 `user_info`，不碰积分领取端点。
   * - `buildNickname` 由调用方注入（它依赖 `channel-pack-rpc` 里的纯函数，
   *   而那个模块依赖本模块 —— 注入避免循环依赖）。
   *
   * @returns 被修复的账号 id 列表（供日志）。
   */
  async repairAccountNicknames(
    pool: import('./account-pool.js').AccountPool,
    buildNickname: (
      credential: Pick<RaccoonCredential, 'nickname' | 'phone' | 'user_id'>,
      fallbackId: string,
    ) => string,
  ): Promise<string[]> {
    const repaired: string[] = []
    let entries: Awaited<ReturnType<typeof pool.listAccounts>>
    try {
      entries = await pool.listAccounts(this.product.id)
    } catch {
      return repaired
    }

    for (const entry of entries) {
      try {
        const ref = credentialRef(entry.credentialRef)
        const resolved = await this.ctx.credentials.resolve(ref)
        if (!resolved) continue
        const credential = parseRaccoonCredential(resolved.value)
        if (credential === undefined) continue

        // 缺 phone（或 user_id/nickname）时补一次 user_info（只读）。
        let next = credential
        if (credential.phone === undefined || credential.user_id === undefined) {
          const info = await fetchRaccoonUserInfo(this.product, credential, this.fetchImpl)
          const patched: RaccoonCredential = {
            ...credential,
            ...info.phone !== undefined && credential.phone === undefined ? { phone: info.phone } : {},
            ...info.userId !== undefined && credential.user_id === undefined ? { user_id: info.userId } : {},
            ...info.nickname !== undefined && credential.nickname === undefined
              ? { nickname: info.nickname } : {},
            ...info.officeIdentity !== undefined && credential.office_identity === undefined
              ? { office_identity: info.officeIdentity } : {},
          }
          const changed = JSON.stringify(patched) !== JSON.stringify(credential)
          if (changed) {
            await this.ctx.credentials.set(ref, JSON.stringify(patched))
            next = patched
          }
        }

        const target = buildNickname(next, entry.id)
        // ⚠️ 只在**确实变化**时写账号池：否则每次启动都落盘一次
        //（`updateAccount` 是整体 replace，会触发一次文档写）。
        if (target !== entry.nickname) {
          await pool.updateAccount(entry.id, { nickname: target })
          repaired.push(entry.id)
        }
      } catch (error) {
        this.ctx.logger?.warn?.(
          `[raccoon] 修复账号 ${entry.id} 的昵称失败（不影响使用）：`
          + `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return repaired
  }
}

/**
 * 解析 `GET /model_catalog` 响应。
 *
 * 只取 `categories[].type === 'chat'` 的那个分类（实测只有一个），
 * 过滤 `visible === false`，并用 `raccoonDisplayName` 生成含倍率的展示名。
 */
export function parseRaccoonModelCatalog(payload: unknown): RaccoonRemoteModel[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return []
  const root = payload as Record<string, unknown>
  if (root.code !== 0) return []
  const data = typeof root.data === 'object' && root.data !== null && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : undefined
  if (data === undefined) return []

  const categories = Array.isArray(data.categories) ? data.categories : []
  const chat = categories.find((c) => {
    return typeof c === 'object' && c !== null && !Array.isArray(c)
      && (c as Record<string, unknown>).type === 'chat'
  })
  if (chat === undefined) return []

  const models = Array.isArray((chat as Record<string, unknown>).models)
    ? (chat as Record<string, unknown>).models as unknown[]
    : []

  const seen = new Set<string>()
  const out: RaccoonRemoteModel[] = []
  for (const raw of models) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const model = normalizeRemoteModel(raw as Record<string, unknown>)
    if (model === undefined || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}
