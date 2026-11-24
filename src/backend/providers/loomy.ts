import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { reportLedgerAccount } from '../../../vendor/channel-pack/src/token-ledger.js'
import { LoomyAuth } from '../../../vendor/channel-pack/src/loomy-auth.js'
import { LOOMY } from '../../../vendor/channel-pack/src/loomy-product.js'
import { registerLoomyLlm, parseLoomyRemoteModels } from '../../../vendor/channel-pack/src/loomy-adapter.js'
import { type LoomyCredential } from '../../../vendor/channel-pack/src/loomy.js'
import { LoomyBalanceSelector } from '../../../vendor/channel-pack/src/loomy-balance-selector.js'
import type { ProviderContext } from './context.js'

export interface LoomyRouteController {
  hasUserIdRoutes?: () => boolean
  getAccountRoute?: (accountId: string, userId?: string) => unknown
  isAccountExcluded: (accountId: string, userId?: string) => boolean
  observeServedModel?: (accountId: string | undefined, requestedModel: string, servedModel: string, userId?: string) => void
}

/**
 * Loomy 渠道**已停用**（2026-11-24）。
 *
 * 全部账号被上游标记为受限：请求一律落到 `spark-x2.6-low`，响应体仍谎报
 * `DeepSeek-V4.1-Flash`，1:1 复制官方客户端请求同样被降级——换请求形态救不回
 * 账号级限制。因此关闭适配器注册（模型选择器不再出现 Loomy 模型）。
 *
 * **实现完整保留**：认证、目录、余额选择器、路由检测、签到都还在。恢复时把本常量
 * 改回 `true`，并把 `lib/rpc.js` 的 `PROVIDERS` 条目与客户端 `card` 一并恢复。
 */
const LOOMY_CHANNEL_ENABLED = false

export function mountLoomy(
  { ctx, pool, throwIfAllAccountsRateLimited, readImage, catalogFile, noteQuotaAccount }: ProviderContext,
  useQuotaPriority = () => false,
  loomyRoute?: LoomyRouteController,
) {
  const loomy = new LoomyAuth(ctx)

  /**
   * 按凭据 ref 解析 Loomy 凭据（供选号器与兜底路径共用）。
   *
   * 抽成局部函数而非内联两遍：选号器需要它查余额，而解析最终凭据又要用它 ——
   * 两处若各写一遍 JSON 解析，格式一变就会只改一处。
   */
  const resolveLoomyCredentialByRef = async (refName: string): Promise<LoomyCredential | undefined> => {
    const resolved = await ctx.credentials.resolve(credentialRef(refName))
    if (!resolved) return undefined
    try {
      return JSON.parse(resolved.value) as LoomyCredential
    } catch {
      return undefined
    }
  }

  /**
   * Loomy 的**按余额优先选号器**（负载均衡）。
   *
   * ⚠️ **为什么需要它**（真实缺陷）：实测 Loomy 的今日赠送额度（每天 5000）
   * 耗尽后，服务端**继续扣永久积分且不报错** —— 「耗尽」是**静默降级**而非错误。
   * 而本插件既有的「限流 → 换号」只在服务端返回限流错误时触发，
   * 故对 Loomy **完全无效**：会一直烧同一个号（用户报障）。
   *
   * 开启全局额度优先后使用：有今日额度 → 有永久积分 → 无/查不到。
   * 永久积分锁独立启用此选择器，且只接收第一档。
   * 档内保持手动拖拽顺序（详见 `loomy-balance-rank.ts`）。
   */
  const loomyBalanceSelector = new LoomyBalanceSelector({
    product: LOOMY,
    resolveCredential: resolveLoomyCredentialByRef,
  })

  const routedExcludedIds = async (): Promise<Set<string>> => {
    const excluded = new Set<string>()
    if (!loomyRoute) return excluded
    const checkUserId = loomyRoute.hasUserIdRoutes?.() === true
    for (const entry of pool.listAccountsByProvider(LOOMY.id)) {
      if (!entry.enabled) continue
      let userId: string | undefined
      if (checkUserId && loomyRoute.getAccountRoute?.(entry.id) == null) {
        userId = (await resolveLoomyCredentialByRef(entry.credentialRef))?.userid
      }
      if (loomyRoute.isAccountExcluded(entry.id, userId)) {
        excluded.add(entry.id)
      }
    }
    return excluded
  }

  const loomyAdapter = LOOMY_CHANNEL_ENABLED ? registerLoomyLlm(ctx, {
    credentialRef: credentialRef(LOOMY.defaultCredentialRef),
    onServedModel: loomyRoute?.observeServedModel
      ? (accountId, requestedModel, servedModel, userId) => {
        loomyRoute.observeServedModel?.(accountId, requestedModel, servedModel, userId)
      }
      : undefined,
    /**
     * 解析本轮该用哪个账号的凭据。
     *
     * ⚠️ `modelId` 由适配器传入（见 `LoomyAdapterOptions.resolveCredential`
     * 的签名说明）—— **必须透传给 `getAvailableAccount`**，否则模型级限流
     * 过滤失效（早期实现传空串 `''`，等于「不按模型过滤」）。
     */
    resolveCredential: async (modelId?: string) => {
      const excluded = await routedExcludedIds()
      const allowPermanent = !pool.permanentLocked(LOOMY.id)
      if (allowPermanent && !useQuotaPriority()) {
        const available = await pool.getAvailableAccount(
          LOOMY.id,
          modelId ?? '',
          excluded.size > 0 ? excluded : undefined,
        )
        if (available) {
          reportLedgerAccount(LOOMY.id, available.entry.id)
          if (modelId) noteQuotaAccount?.(LOOMY.id, available.entry.id, modelId)
          return available.credential as LoomyCredential
        }
        const enabledAccounts = pool.listAccountsByProvider(LOOMY.id).filter(a => a.enabled)
        const unroutedEnabled = excluded.size > 0 ? enabledAccounts.filter(a => !excluded.has(a.id)) : enabledAccounts
        if (unroutedEnabled.length > 0 || excluded.size === 0) {
          throwIfAllAccountsRateLimited(LOOMY, modelId, excluded.size > 0 ? unroutedEnabled : undefined)
        }
        if (excluded.size > 0) {
          throw new LlmError(
            'Loomy：当前启用账号均已被「避开上游改路由账号」排除。可在 Loomy 渠道设置重测路由或关闭该开关。',
            'MISSING_CREDENTIAL',
          )
        }
        return resolveLoomyCredentialByRef(LOOMY.defaultCredentialRef)
      }
      // 只从 Loomy 自己的账号池取账号，回退到自己的单凭据 ref，
      // 保证不会串用其它 provider 的凭据。
      // provider 实参用 LOOMY.id 而非字面量 'loomy'：写死字面量在

      //
      // ⚠️ 先按「模型未受限 + 未停用 + 未被改路由排除」筛出候选，**再**按余额分档选号。
      // 余额排序只在这批候选内部进行 —— 即你的要求：
      // 「策略建立在模型没有受限且账户没有被设置为停用的基础上」。
      const unroutedEnabled = pool
        .listAccountsByProvider(LOOMY.id)
        .filter(a => a.enabled && !excluded.has(a.id))
      const candidates = unroutedEnabled
        .filter((a) => {
          // 与 `getAvailableAccount` 的限流判据保持一致（空 modelId = 不过滤）。
          const key = modelId ?? ''
          if (key.length === 0) return true
          if (!a.modelRateLimits) return true
          const resetAt = a.modelRateLimits[key]
          return resetAt === undefined || resetAt === 0 || Date.now() >= resetAt
        })
        .map(a => ({ id: a.id, credentialRef: a.credentialRef }))

      // 「锁定永久积分」：只允许消耗今日赠送额度（用户要求，且持久化）。

      if (candidates.length > 0) {
        const picked = await loomyBalanceSelector.select(candidates, { allowPermanent })
        if (picked.ok) {
          const credential = await resolveLoomyCredentialByRef(picked.account.credentialRef)
          // Token 账本（第 2 期）：回报「本笔请求解析出的账号」。
          if (credential !== undefined) {
            reportLedgerAccount(LOOMY.id, picked.account.id)
            if (modelId) noteQuotaAccount?.(LOOMY.id, picked.account.id, modelId)
            return credential
          }
        } else if (!allowPermanent) {
          // ⚠️ **锁定时绝不可落到下面的单凭据兜底** —— 那会绕过锁定、
          // 照样消耗永久积分，锁定形同虚设。这里直接抛明确错误（用户要求）。
          //
          // ⚠️ **必须区分「真的用尽」与「查不到」**（真实缺陷，用户报障
          // 2026-09-29）：曾把两者混成一句「今日额度都已用尽」，于是
          // **一次网络抖动**就让用户被告知"钱花完了"（实测当时 4 个号里
          // 3 个还有 4965/5000/5000）—— 用户会去解锁或白等一天，而号其实有钱。
          const reason = picked.reason
          if (reason.kind === 'unknown') {
            throw new Error(
              'Loomy：无法确认是否有可用账号。已锁定永久积分，而部分账号的余额查询失败'
              + `（${reason.errors.slice(0, 2).join('；')}）。这些账号**可能仍有**今日额度 —— `
              + '请重试，或在 Channel Pack 的 Loomy 面板检查凭据是否失效。',
            )
          }
          throw new Error(
            'Loomy：没有可用账号。已锁定永久积分，而所有账号的今日赠送额度都已用尽。'
            + '请在 Channel Pack 的 Loomy 面板解锁永久积分，或等待明日额度刷新。',
          )
        }
      }

      if (unroutedEnabled.length > 0 || excluded.size === 0) {
        throwIfAllAccountsRateLimited(LOOMY, modelId, excluded.size > 0 ? unroutedEnabled : undefined)
      }
      if (!allowPermanent) throw new Error('Loomy：已锁定永久积分，当前没有可使用每日额度的账号。')
      if (excluded.size > 0) {
        throw new LlmError(
          'Loomy：当前启用账号均已被「避开上游改路由账号」排除。可在 Loomy 渠道设置重测路由或关闭该开关。',
          'MISSING_CREDENTIAL',
        )
      }
      // 兜底：账号池为空/全部不可解析时，退回单凭据 ref。
      const resolved = await ctx.credentials.resolve(credentialRef(LOOMY.defaultCredentialRef))
      if (!resolved) return undefined
      try {
        return JSON.parse(resolved.value) as LoomyCredential
      } catch {
        return undefined
      }
    },
    refresh: async (accountId?: string) => {
      const entry = accountId === undefined ? undefined
        : pool.listAccountsByProvider(LOOMY.id).find(account => account.id === accountId)
      if (accountId !== undefined && entry === undefined) throw new Error('loomy: account no longer exists')
      if (entry) await loomy.refreshAccountCredential(entry.credentialRef, pool, entry.id)
      else await loomy.refresh()
      const resolved = await ctx.credentials.resolve(credentialRef(entry?.credentialRef ?? LOOMY.defaultCredentialRef))
      if (!resolved) throw new Error('loomy: credential no longer exists')
      return JSON.parse(resolved.value) as LoomyCredential
    },
    nextAccount: async (modelId, tried) => {
      const excluded = await routedExcludedIds()
      const combinedTried = new Set(tried)
      for (const id of excluded) combinedTried.add(id)
      const allowPermanent = !pool.permanentLocked(LOOMY.id)
      if (allowPermanent && !useQuotaPriority()) {
        const available = await pool.getAvailableAccount(LOOMY.id, modelId, combinedTried)
        if (!available) return undefined
        reportLedgerAccount(LOOMY.id, available.entry.id)
        noteQuotaAccount?.(LOOMY.id, available.entry.id, modelId)
        return { accountId: available.entry.id, credential: available.credential as LoomyCredential }
      }
      const candidates = pool.listAccountsByProvider(LOOMY.id)
        .filter(account => account.enabled && !combinedTried.has(account.id))
        .filter(account => !account.modelRateLimits?.[modelId] || Date.now() >= account.modelRateLimits[modelId]!)
        .map(account => ({ id: account.id, credentialRef: account.credentialRef }))
      const picked = await loomyBalanceSelector.select(candidates, { allowPermanent })
      if (!picked.ok) return undefined
      const credential = await resolveLoomyCredentialByRef(picked.account.credentialRef)
      if (!credential) return undefined
      reportLedgerAccount(LOOMY.id, picked.account.id)
      noteQuotaAccount?.(LOOMY.id, picked.account.id, modelId)
      return { accountId: picked.account.id, credential }
    },
    // 远端模型目录：GET /api/v1/models。
    // ⚠️ 必须用 **token 头**（业务端点），不是 Bearer —— 带错会得到
    // `100002 缺少 token`，表现为「模型列表永远停在兜底表」。
    // 失败时返回空数组，由适配器回退兜底表。
    fetchRemoteModels: async () => {
      const available = await pool.getAvailableAccount(LOOMY.id, '')
      const resolved = available !== null && available !== undefined
        ? { value: JSON.stringify(available.credential) }
        : await ctx.credentials.resolve(credentialRef(LOOMY.defaultCredentialRef))
      if (resolved === undefined) return []
      let credential: LoomyCredential
      try {
        credential = JSON.parse(resolved.value) as LoomyCredential
      } catch {
        return []
      }
      const response = await fetch(`${LOOMY.apiBase}/models`, {
        headers: { Accept: 'application/json', token: credential.access_token },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) return []
      return parseLoomyRemoteModels(await response.json())
    },
    catalogFile: catalogFile(LOOMY.id),
    // 图片字节桥接：按模型能力判定（远端 capabilities.input_modalities 含 image）。
    readImage: readImage,
    accountPool: pool,
    product: LOOMY,
  }) : undefined

  return {
    auth: loomy,
    adapters: LOOMY_CHANNEL_ENABLED && loomyAdapter ? { [LOOMY.id]: loomyAdapter } : {},
    maintain: () => loomy.refreshAll(pool),
  }
}
