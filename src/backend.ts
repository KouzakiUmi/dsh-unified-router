// Extracted from OFM 999e9f784ea3ea7a11cae383b142697b1ff2c42f (MIT).
export { mergeUnifiedRaccoonCatalogs }
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AccountPool, allAccountsRateLimitedForModel } from '../vendor/channel-pack/src/account-pool.js'
import { configureDeadModelStore, withDeadModelPruning } from '../vendor/channel-pack/src/dead-model-store.js'
import { attachTokenLedgerStore } from '../vendor/channel-pack/src/token-ledger.js'
import { createTokenLedgerStore } from '../vendor/channel-pack/src/token-ledger-store.js'
import { registerPackRpc } from './backend/pack-bridge.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageRequestTarget } from '../vendor/channel-pack/src/image-budget.js'
import { mergeUnifiedRaccoonCatalogs } from './backend/providers/raccoon.js'
import { PACK_MOUNTS } from './backend/providers/pack-registry.js'
import type { ProviderContext } from './backend/providers/context.js'
import { join } from 'node:path'

/**
 * 图片附件桥接：把持久化图片读成原始字节供适配器内联。
 */
export function makeReadImage(ctx: Context) {
  return async (attachment: unknown): Promise<{ data: Uint8Array; mediaType: string }> => {
    const attachments = ctx.get('attachments') as
      { readImage?: (ref: never) => Promise<{ data: Uint8Array; ref: { mediaType: string } }> } | undefined
    if (attachments?.readImage === undefined) {
      throw new Error(
        'channel-pack: 附件服务（attachments）不可用，无法把图片内联进请求；'
        + '请确认当前 profile 已装载 @deepseek-ai/dsh-attachment-local。',
      )
    }
    const stored = await attachments.readImage(attachment as never)
    return { data: stored.data, mediaType: stored.ref.mediaType }
  }
}

/**
 * 图片「请求版本」桥接（issue !IKITT9）。
 *
 * 走 `ctx.attachments.readImageRequest(ref, target)`：由附件服务按目标尺寸与
 * 字节目标产出**确定性、可缓存**的缩放版本（alpha 走 WebP、不透明走 JPEG、
 * 85/75/60 质量阶梯），适配器只负责选目标。
 *
 * ⚠️ **任何不可用都返回 `undefined`，绝不抛错**，调用方据此回退原图。三种
 * 真实成因都必须容忍，否则「加上缩放」本身会变成新的故障源：
 *
 * 1. 宿主 profile 没装附件服务，或该版本没有 `readImageRequest`（老契约）；
 * 2. 附件后端明确拒绝投影（`ATTACHMENT_PROJECTION_UNSUPPORTED`）；
 * 3. 派生过程中的其它错误（缓存不可写、字节校验失败…）。
 *
 * 回退方向是刻意选 conservative 的一侧：宁可发一张大图（顶多触发网关的
 * 图片 token 上限），也不能因为「想缩图」而把一次本来能成功的请求打死。
 */
export function makeReadImageRequest(ctx: Context) {
  return async (
    attachment: unknown,
    target: ImageRequestTarget,
  ): Promise<{ data: Uint8Array; mediaType: string } | undefined> => {
    const attachments = ctx.get('attachments') as {
      readImageRequest?: (
        ref: never,
        requestTarget: never,
      ) => Promise<{ data: Uint8Array; mediaType?: string; attachment?: { mediaType?: string } }>
    } | undefined
    if (attachments?.readImageRequest === undefined) return undefined
    try {
      const projected = await attachments.readImageRequest(attachment as never, target as never)
      const mediaType = projected.mediaType ?? projected.attachment?.mediaType
      if (mediaType === undefined) return undefined
      return { data: projected.data, mediaType }
    } catch (error) {
      // 只记日志、随后回退原图：缩放是优化，不是请求的前置条件。
      ctx.logger?.warn?.(
        '[channel-pack] 图片请求版本派生失败，回退原图：'
        + `${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    }
  }
}

export function mountBackend(ctx: Context, onRpc: (call: Function) => void, options: {
  qoderCatalogFile?: string; catalogDir?: string
  quotaAccountOrder?: (provider: string, ids: string[], context?: { modelId?: string; model?: unknown }) => readonly string[]
  /** 智能选号模式（live getter）：manual / free / expiring / sticky。 */
  routingMode?: () => string
  isRaccoonUnifiedModels?: () => boolean
  noteQuotaAccount?: (provider: string, accountId: string, model?: string) => void
} = {}) {
  const pool = new AccountPool(ctx, options.quotaAccountOrder, (provider, accountId, model) => {
    if (provider === 'trae' || provider === 'qodercn') options.noteQuotaAccount?.(provider, accountId, model)
  })
  /**
   * 图片支持开关：在 `listModels` 的返回值上按用户设置覆盖。
   *
   * ⚠️ **必须在 listModels 这一层改**，不能只改请求参数：宿主是拿
   * 注册时声明的 `inputModalities` 判断「这个模型能不能收图」的，
   * 没声明 image 时图片会被替换成占位符，请求根本到不了上游。
   * 所以关掉图片 = 让 listModels 不再声明 image。
   *
   * 每层都容错：拿不到适配器或返回值异常时原样透传，绝不因这个开关让列表炸掉。
   */
  const wrapImagePreference = (adapter: any) => {
    if (typeof adapter?.listModels !== 'function') return adapter
    const original = adapter.listModels.bind(adapter)
    return new Proxy(adapter, {
      get(target, prop, receiver) {
        if (prop !== 'listModels') return Reflect.get(target, prop, receiver)
        return async (provider: string) => {
          const models = await original(provider)
          if (!Array.isArray(models)) return models
          return models.map(model => {
            try {
              const pref = pool.modelParamsFor(provider, model.id)?.supportsImage
              if (pref === undefined || !Array.isArray(model.inputModalities)) return model
              const rest = model.inputModalities.filter((m: string) => m !== 'image')
              return { ...model, inputModalities: pref ? [...rest, 'image'] : rest }
            } catch {
              return model
            }
          })
        }
      },
    })
  }

  /**
   * 上下文窗口、输出默认值和思考默认档都从 `resolveModel` 交给宿主。
   *
   * ⚠️ **直接打在被注册的那个适配器实例上**（monkey-patch 实例方法），不是
   * `wrapImagePreference` 那种外层 Proxy：注册链路里的
   * `withDeadModelPruning` / 记账包装只拦 `listModels`/`listAllModels`/`stream`/
   * `prepareCall`，`resolveModel` 原样透传到实例；`prepareCall` 内部的
   * `this.resolveModel` 也落在同一个实例上。打在实例方法上一次覆盖两条路径。
   *
   * 宿主补齐请求时使用这些元数据；`llm/stream` 的 `next()` 不接收新参数。
   * - `contextWindow`：宿主 compaction-basic 读 `info.context.contextWindow` 做预算/裁剪；
   * - `reasoning.defaultEffort`：设置页「思考深度」保存的是**该模型的默认档**
   *   （客户端按钮文案就是「默认（X）」，见 `src/client/ui.js` 的
   *   `ModelParams`）。显式选择始终优先于模型默认档。
   *   只在该模型确实声明了这个档位时才投影（不编造档位）。
   * - `defaultMaxTokens`：用于没有显式指定输出预算的请求。
   */
  const patchAdapterContext = (adapter: any) => {
    if (!adapter || typeof adapter.resolveModel !== 'function') return adapter
    const original = adapter.resolveModel.bind(adapter)
    adapter.resolveModel = async (...args: any[]) => {
      const info = await original(...args)
      try {
        const override = pool.modelParamsFor(args[0], args[1])
        if (!info || override === undefined) return info
        const next = {
          ...info,
          ...(override.contextWindow === undefined ? {} : { context: { ...info.context, contextWindow: override.contextWindow } }),
          ...(override.maxTokens === undefined ? {} : { defaultMaxTokens: override.maxTokens }),
        }
        const effort = override.reasoningEffort
        const efforts = next.reasoning?.efforts
        if (effort === undefined || !Array.isArray(efforts)) return next
        // 档位必须真的存在：给一个模型不支持的默认档，DSH 会拿它直接发请求。
        if (!efforts.some((item: any) => String(item?.id) === effort)) return next
        return { ...next, reasoning: { ...next.reasoning, defaultEffort: effort } }
      } catch {
        return info
      }
    }
    return adapter
  }

  const accountForRefresh = async (provider: string, accountId?: string) => {
    if (accountId === undefined) return pool.getAvailableAccount(provider, '')
    const entry = pool.listAccountsByProvider(provider).find(account => account.id === accountId)
    if (entry === undefined) throw new LlmError(`${provider}: 当前请求的账号已移除`, 'MISSING_CREDENTIAL')
    return { entry }
  }

  // 「已失效模型」剔除：注入 ctx 只为把日志接进 DSH logger 并复用同一份 home
  // 解析。必须在任何 `registerXxxLlm` 之前调用 —— 各适配器经
  // `registerAdapterIdempotent` 注册时就会包装上剔除逻辑（见该函数注释）。
  configureDeadModelStore(ctx)

  // ===== Token 账本持久化（第 2 期 · 日聚合落盘）=====
  //
  // ⚠️ 账本本体是模块级单例（`token-ledger.ts`），没有 ctx 可拿 —— 故在启动时
  // 把后端挂进去（`attachTokenLedgerStore`）。挂载发生在**任何适配器注册之前**：
  // 启动早期就有模型请求（标题生成等）时，落盘已在位。
  //
  // ⚠️ 后端契约是**绝不抛错**（`recordTokenUsage` 的调用点在推理关键路径上，
  // 见其函数注释），`FileLedgerStore` 内部已按此实现。
  //
  // ⚠️ dispose **必须用返回的 disposer**（不能无条件 `attach(undefined)`）：
  // 插件 fiber 重启时新 apply 与旧 fiber 的异步 dispose **交错执行**
  //（本仓库已确证的事故，见 `llm-register-compat.ts` 模块头），无条件摘会把
  // **新实例刚挂上**的后端摘空 ⇒ 落盘停摆且历史视图恒为空。disposer 自带所有权
  // 校验（只摘自己的），并顺带 `flush` 当前这份数据。
  const tokenLedgerStore = createTokenLedgerStore(ctx)
  const detachTokenLedger = attachTokenLedgerStore(tokenLedgerStore)
  ctx.effect(() => () => {
    try {
      tokenLedgerStore.flush()
    } finally {
      detachTokenLedger()
    }
  }, 'token-ledger-persistence')

  /**
   * 在「候选为空、即将退到单凭据 ref」这一刻，先证明失败原因是不是**限流**。
   *
   * ## 它修的是什么（真实缺陷，2026-10-03）
   *
   * 即：**凭据问题被误报成「没登录」，而真实原因是限流**。用户据此去重新
   * 登录，方向完全错。这与本仓库已记录的同类病根一致 —— 用默认归类代替了
   * 对业务语义的判断（qoder 的 `110` 被误归 `SERVER`、`10605` 排队被漏判）。
   *
   * ⚠️ 这里**只改错误语义，不改可用性**：没有账号可用就是没有，压缩该失败
   * 仍然失败；修的是「用户看到的原因」。绝不静默换模型、也绝不绕过限流标记。
   */
  const throwIfAllAccountsRateLimited = (
    product: { id: string; displayName: string },
    modelId?: string,
    /**
     * 候选账号来源覆盖。
     *
     * 默认按 `product.id` 取整个池；Raccoon 家族需要传**按 plan 筛过**的
     * 子集（单池两个模型面），否则会把另一侧的账号算进「全部限流」的判断里。
     */
    entries?: readonly { enabled: boolean; modelRateLimits?: Record<string, number> }[],
  ): void => {
    const limited = allAccountsRateLimitedForModel(
      // 只统计**启用**账号：停用账号本就不参与自动选号，把它们算进来会
      // 让「有一个号被停用」的普通情况被误报成「全部限流」。
      (entries ?? pool.listAccountsByProvider(product.id)).filter(a => a.enabled),
      modelId ?? '',
    )
    if (limited === undefined) return
    throw new LlmError(
      `${product.displayName}：模型 ${modelId} 的可用账号均在限流中，`
      + `最近一个将于 ${new Date(limited.resetAtMs).toLocaleString('zh-CN')} 解禁。`
      + `可改用其它 provider / 模型，或等待解禁后再试（无需重新登录）。`,
      'QUOTA_EXCEEDED',
    )
  }
  const providerContext: ProviderContext = {
    ctx, pool, accountForRefresh, throwIfAllAccountsRateLimited, noteQuotaAccount: options.noteQuotaAccount,
    readImage: makeReadImage(ctx), readImageRequest: makeReadImageRequest(ctx),
    catalogFile: provider => options.catalogDir && join(options.catalogDir, `${provider}-catalog.json`),
  }
  // 账号池渠道按**注册表**装配（`src/backend/providers/pack-registry.ts`）：
  // 挂载、vendor 形参名、适配器与维护钩子都由那一条登记声明，这里不再手写渠道名。
  const mounted = PACK_MOUNTS.map(entry => ({
    entry,
    result: entry.mount(providerContext, {
      qoderCatalogFile: options.qoderCatalogFile,
      isRaccoonUnifiedModels: options.isRaccoonUnifiedModels,
    }),
  }))
  const providers = mounted.map(item => item.result)
  const modelAdapters = Object.fromEntries(providers.flatMap(provider => Object.entries(provider.adapters).map(([id, adapter]) =>
    [id, wrapImagePreference(withDeadModelPruning([id], patchAdapterContext(adapter)))])))
  const allowedProviders = Object.keys(modelAdapters)
  const slots = Object.fromEntries(mounted.map(item => [item.entry.slot, item.result.auth]))
  const subscriptionAuth = mounted.find(item => item.result.subscriptionAuth !== undefined)?.result.subscriptionAuth
  registerPackRpc(ctx, pool, slots as Record<string, unknown>, modelAdapters, {
    disableOpencode: true, nativeOnly: true, allowedProviders, onRpc,
      ...(subscriptionAuth === undefined ? {} : { raccoonPro: subscriptionAuth }),
  })
  // 模型选择器读取的是 llm.listModels（适配器注册时已定型）。在这里包一层的
  // 目的：关掉图片后，**模型选择器与宿主的能力判断**都不再看到 image，
  // 图片会走占位符路径而不是发一个注定失败的请求。
  try {
    const llm: any = (ctx as any).get?.('llm')
    if (llm && typeof llm.listModels === 'function' && !(llm as any).__unifiedRouterImagePatched) {
      const baseListModels = llm.listModels.bind(llm)
      // ⚠️ llm 是全局服务：这个包装对**所有**渠道生效，包括别的插件注册的。
      // 只处理本插件自己的渠道（raccoon / raccoon-pro / qodercn / trae），
      // 其余原样透传——否则等于替别人改了模型能力。
      const managed = new Set(allowedProviders)
      llm.listModels = async (provider: string) => {
        const models = await baseListModels(provider)
        if (!managed.has(provider) || !Array.isArray(models)) return models
        return models.map((model: any) => {
          try {
            const pref = pool.modelParamsFor(provider, model.id)?.supportsImage
            if (pref === undefined || !Array.isArray(model.inputModalities)) return model
            const rest = model.inputModalities.filter((m: string) => m !== 'image')
            return { ...model, inputModalities: pref ? [...rest, 'image'] : rest }
          } catch {
            return model
          }
        })
      }
      ;(llm as any).__unifiedRouterImagePatched = true
    }
  } catch {
    // 包装失败不影响后端其余能力：图片开关退化为「只在目录里体现」。
  }
  ctx.provide('unifiedRouterPool', pool)
  const maintenance = new Set<(typeof providers)[number]>()
  const timer = setInterval(() => {
    for (const provider of providers) {
      if (maintenance.has(provider)) continue
      maintenance.add(provider)
      void provider.maintain().catch(() => {}).finally(() => maintenance.delete(provider))
    }
  }, 60_000)
  timer.unref?.()
  ctx.effect(() => () => clearInterval(timer))
  return pool
}
