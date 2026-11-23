import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { reportLedgerAccount } from '../../../vendor/channel-pack/src/token-ledger.js'
import { RaccoonAuth } from '../../../vendor/channel-pack/src/raccoon-auth.js'
import { RACCOON, RACCOON_PRO, type RaccoonProduct } from '../../../vendor/channel-pack/src/raccoon-product.js'
import { registerRaccoonLlm } from '../../../vendor/channel-pack/src/raccoon-adapter.js'
import type { RaccoonRemoteModel } from '../../../vendor/channel-pack/src/raccoon-adapter.js'
import { type RaccoonCredential } from '../../../vendor/channel-pack/src/raccoon.js'
import { type AccountPool } from '../../../vendor/channel-pack/src/account-pool.js'
import type { ProviderContext } from './context.js'

/**
 * 统一模式的目录合并：订阅侧条目去掉 `-p` 后缀并入免费侧目录。
 *
 * - **免费侧条目优先**：免费面是统一模型的默认服务面（选号免费优先），
 *   徽标与思考档位以它为准；订阅侧同 id 的条目不覆盖。
 * - **订阅独有模型**（免费账号目录里没有的）补进差集，id 用去 `-p` 的统一名。
 * - 不在此过滤倍率：`billing_effective_multiplier` 只是展示信息（沿用
 *   「两侧目录只认上游」的既有规则）。
 */
export function mergeUnifiedRaccoonCatalogs(
  freeModels: readonly RaccoonRemoteModel[],
  proModels: readonly RaccoonRemoteModel[],
): RaccoonRemoteModel[] {
  const seen = new Set(freeModels.map(model => model.id))
  const extra = proModels.flatMap(model => {
    const id = model.id.endsWith('-p') ? model.id.slice(0, -2) : model.id
    return seen.has(id) ? [] : [{ ...model, id }]
  })
  return [...freeModels, ...extra]
}

export function mountRaccoon(
  { ctx, pool, throwIfAllAccountsRateLimited, readImage, readImageRequest, catalogFile, noteQuotaAccount }: ProviderContext,
  /** 「统一免费与订阅模型」开关（live getter：切换即时生效，无需重启）。 */
  isUnifiedModels?: () => boolean,
) {
  type RaccoonSide = 'free' | 'pro'
  // ===== Raccoon（商汤小浣熊）：免费版 `raccoon` + 订阅版 `raccoon-pro` =====
  // 第九个产品线，模型层是**两个 provider**（同一上游账号体系的两个模型面），
  // 账号层只有**一个池**（`raccoon`）。
  // 登录与 Loomy 同型（**本地页承载**的微信扫码 + 短信双路径），但**有** refresh
  // 端点（凭据可静默续期），且客户端可能未安装。
  //
  // ⚠️ **不依赖客户端**：官方桌面端靠 `office-raccoon://auth/callback` 自定义协议
  // 回调，本插件（宿主侧 Node 进程）收不到；故改为「宿主本地生成 code + 自行轮询」，
  // 完全绕开该回调。凭据存插件自有的 ctx.credentials，不读客户端任何文件。
  // 见 tests/unit/raccoon-client-independence.spec.ts 的回归防线。
  //
  // 服务名由 RaccoonAuth 依 product.id 派生（免费版 → ctx.raccoonAuth）；
  // 订阅版显式给 `raccoonProAuth`（`raccoon-proAuth` 带连字符，不便按属性访问）。
  // 不注册斜杠命令：入口在设置页的渠道卡片。
  //
  // ## 两个模型 provider + 一个账号池（2026-11 架构三次修订）
  //
  // **两侧模型池完全独立**：免费面与订阅面各自用**本侧账号的凭据**去上游拉目录
  //（`RaccoonAuth.fetchModelsWithCredential`），上游对该账号返回什么模型就展示
  // 什么模型，**不做任何倍率过滤**。目录的独立性来自「用不同账号拉取」，不是
  // 来自把同一份目录按 `billing_effective_multiplier` 劈成两半（上一版的做法，
  // 会把免费账号看得到的计费模型从目录里删掉）。
  //
  // ⚠️ **账号不再分池**：所有小浣熊账号都在 `raccoon` 池，靠 `plan` 字段
  //（登录后由 `RaccoonAuth.fetchPlan` 探测写入）决定服务哪一面：
  // - 免费侧只取 `plan !== 'pro'`（`free` / `unknown` / 缺省都算免费侧 ——
  //   探测失败时宁可用免费模型，也不能误扣付费额度）；
  // - 订阅侧只取 `plan === 'pro'`。
  //
  // 分池方案（上一版）的病根是「用户选错卡片 → 账号永久错配」，而套餐是会变的；
  // 单池 + 打标让登录与选号解耦：登录一律进同一个池，探测失败只降级不丢账号。
  //
  // 限流/停用过滤仍由 `getAvailableAccount` 负责：plan 只用来**圈定候选**
  // （把另一侧的账号放进 `excludeAccountIds`），选号核心一行不改。
  // 目录侧同样只做「用本侧凭据拉」这一件事：`fetchRemoteModels` 直接返回
  // `auth.fetchModelsWithCredential(credential)` 的完整结果，**不改**
  // `raccoon-adapter.ts` 的协议行为（它仍是上游 vendored 实现）。
  /** 账号属于哪一侧：`'pro'` 之外的取值（含缺省/unknown）一律归免费侧。 */
  const raccoonSideOf = (entry: { plan?: 'free' | 'pro' | 'unknown' }): RaccoonSide =>
    entry.plan === 'pro' ? 'pro' : 'free'
  /** 统一模式是否生效（未注入 getter 时恒为关：保持两侧独立的老行为）。 */
  const unified = () => isUnifiedModels?.() === true
  /** 单池里属于某一侧的账号（保持池内手动顺序）。 */
  const raccoonAccountsOf = (side: RaccoonSide) =>
    pool.listAccountsByProvider(RACCOON.id).filter(entry => raccoonSideOf(entry) === side)
  /**
   * 交给 `getAvailableAccount` 的**排除集合**：对侧账号的 id。
   *
   * 这是「按 plan 筛候选」与「复用池的选号逻辑」两件事的接缝 —— 池的
   * `getAvailableAccount(provider, modelId, excludeAccountIds)` 已经负责
   * 启用过滤、模型限流过滤与手动顺序，故只需把不属于本侧的账号排除掉。
   */
  const raccoonOtherSideIds = (side: RaccoonSide): Set<string> =>
    new Set(raccoonAccountsOf(side === 'free' ? 'pro' : 'free').map(entry => entry.id))
  /** 合并两个 id 集合（统一选号要同时排除「对侧账号」与「已试账号」）。 */
  const unionIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => {
    const out = new Set(a)
    for (const id of b) out.add(id)
    return out
  }
  /**
   * 按 plan 门控的账号池视图（**两侧都用**，但订阅侧是必需的）。
   *
   * 适配器的 `listModels` 会先问 `providerCatalogVisible(accountPool, product.id)`，
   * 而单池之后 `raccoon-pro` 池**恒为空** —— 直接用真池会让订阅侧模型在对话
   * 模型选择器里整组消失（DSH 会隐藏空目录的 provider，设置页目录走
   * `listAllModels` 不受影响，于是表现为「设置页看得到、对话里选不到」）。
   * 免费侧同理：池里若只有订阅账号，免费面也没有可用号，如实隐藏比让它报
   * 「没有可用凭据」更清楚。
   *
   * 只覆盖 `hasLoggedInAccount` 的判据（该侧在单池里是否真有可用账号）；
   * 黑名单、限流、凭据读写等其余方法全部转发到真池。
   */
  const raccoonSidePool = (side: RaccoonSide): AccountPool => new Proxy(pool, {
    get(target, prop) {
      if (prop === 'hasLoggedInAccount') {
        return async () => {
          // 统一模式：免费面代表整个家族（订阅账号同样能服务它），订阅面
          // 整体隐藏（`listModels` 据此返回空 → 宿主把 raccoon-pro 分组收起）。
          if (unified() && side === 'pro') return false
          const entries = unified() && side === 'free'
            ? pool.listAccountsByProvider(RACCOON.id)
            : raccoonAccountsOf(side)
          for (const entry of entries) {
            if (await target.resolveCredentialForAccount(entry.id) !== undefined) return true
          }
          return false
        }
      }
      const value = Reflect.get(target, prop)
      // 方法一律绑到真池上：让 `this.cache` 等私有状态照旧落在真实例里。
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  /**
   * 统一模式选号：**免费侧优先**（沿用「宁可用免费模型也不误扣付费额度」），
   * 免费侧无可用账号再用订阅账号。两侧的限流键各按本侧真实 id 记
   * （免费 = 统一 id，订阅 = 统一 id + `-p`），与出站翻译一一对应。
   */
  const raccoonUnifiedPick = async (modelId: string, exclude: ReadonlySet<string>) => {
    if (modelId.length === 0) {
      const free = await pool.getAvailableAccount(RACCOON.id, '', unionIds(exclude, raccoonOtherSideIds('free')))
      return free ? { pick: free, wire: '' } : null
    }
    const free = await pool.getAvailableAccount(RACCOON.id, modelId, unionIds(exclude, raccoonOtherSideIds('free')))
    if (free) return { pick: free, wire: modelId }
    const pro = await pool.getAvailableAccount(RACCOON.id, `${modelId}-p`, unionIds(exclude, raccoonOtherSideIds('pro')))
    return pro ? { pick: pro, wire: `${modelId}-p` } : null
  }
  /**
   * 取某一侧的可用凭据（供远端目录使用）。
   *
   * 上游的模型目录是**按账号套餐**下发的（免费账号与订阅账号看到的目录不同），
   * 故必须用本侧账号的凭据去拉；没有本侧账号时返回 `undefined`（调用方返回空
   * 目录，由适配器回退兜底表 —— 绝不借用另一侧的凭据，那会拿到另一侧的目录）。
   */
  const raccoonSideCredential = async (side: RaccoonSide): Promise<RaccoonCredential | undefined> => {
    try {
      const available = await pool.getAvailableAccount(RACCOON.id, '', raccoonOtherSideIds(side))
      if (available === null || available === undefined) return undefined
      return available.credential as unknown as RaccoonCredential
    } catch {
      return undefined
    }
  }
  const mountRaccoon = (
    product: RaccoonProduct,
    auth: RaccoonAuth,
    /** 本适配器服务的那一侧（决定按 plan 圈定候选）。 */
    side: RaccoonSide,
    /** 另一侧（订阅面）的远端目录拉取；统一模式合并目录用。仅免费面注入。 */
    proRemoteFetch?: () => Promise<RaccoonRemoteModel[]>,
  ) => registerRaccoonLlm(ctx, {
    catalogFile: catalogFile(product.id),
    credentialRef: credentialRef(product.defaultCredentialRef),
    resolveCredential: async (modelId?: string) => {
      let available: Awaited<ReturnType<typeof pool.getAvailableAccount>> = null
      if (side === 'free' && unified()) {
        // 统一模式：跨两侧选号（免费优先），`modelId` 是统一 id（出站翻译由
        // `outboundModelId` 完成；这里只决定「用哪个账号」）。
        const pick = await raccoonUnifiedPick(modelId ?? '', new Set<string>())
        available = pick?.pick ?? null
      } else {
        // 只从**单池里属于本侧**的账号取号（`modelId` 照透传：限流按模型记）。
        available = await pool.getAvailableAccount(
          RACCOON.id, modelId ?? '', raccoonOtherSideIds(side),
        )
      }

      // 联合（历史遗留），与 `RaccoonCredential` 无充分重叠，故经 `unknown` 转换。
      if (available) {
        // Token 账本（第 2 期）：回报「本笔请求解析出的账号」。
        reportLedgerAccount(product.id, available.entry.id)
        if (modelId) noteQuotaAccount?.(product.id, available.entry.id, modelId)
        return available.credential as unknown as RaccoonCredential
      }
      if (side === 'free' && unified()) {
        // 两侧分别核：能证明「全是限流」的那一侧给出精确的解禁时间；
        // 两侧都证不出（如凭据缺失）则静默走单凭据回退。
        throwIfAllAccountsRateLimited(product, modelId, raccoonAccountsOf('free'))
        throwIfAllAccountsRateLimited(product, `${modelId ?? ''}-p`, raccoonAccountsOf('pro'))
      } else {
        throwIfAllAccountsRateLimited(product, modelId, raccoonAccountsOf(side))
      }
      const resolved = await ctx.credentials.resolve(credentialRef(product.defaultCredentialRef))
      if (!resolved) return undefined
      try {
        return JSON.parse(resolved.value) as RaccoonCredential
      } catch {
        return undefined
      }
    },
    refresh: async (accountId?: string) => {
      // 账号都在 `raccoon` 池，故按池查（不能按 product.id 查，订阅侧查不到）。
      const entry = accountId === undefined ? undefined
        : pool.listAccountsByProvider(RACCOON.id).find(account => account.id === accountId)
      if (accountId !== undefined && entry === undefined) throw new Error(`${product.id}: account no longer exists`)
      if (entry) await auth.refreshAccountCredential(entry.credentialRef, pool, entry.id)
      else await auth.refresh()
      const resolved = await ctx.credentials.resolve(credentialRef(entry?.credentialRef ?? product.defaultCredentialRef))
      if (!resolved) throw new Error(`${product.id}: credential no longer exists`)
      return JSON.parse(resolved.value) as RaccoonCredential
    },
    nextAccount: async (modelId, tried) => {
      let next: Awaited<ReturnType<typeof pool.getAvailableAccount>> = null
      if (side === 'free' && unified()) {
        const pick = await raccoonUnifiedPick(modelId, tried)
        next = pick?.pick ?? null
      } else {
        // 「本侧 + 未试过」：对侧与已试账号都进排除集合。
        const excluded = raccoonOtherSideIds(side)
        for (const id of tried) excluded.add(id)
        next = await pool.getAvailableAccount(RACCOON.id, modelId, excluded)
      }
      if (!next) return undefined
      reportLedgerAccount(product.id, next.entry.id)
      noteQuotaAccount?.(product.id, next.entry.id, modelId)
      return { accountId: next.entry.id, credential: next.credential as unknown as RaccoonCredential }
    },
    // 远端模型目录：用**本侧账号**的凭据拉（`fetchModelsWithCredential` 负责
    // Bearer 头 + visible 过滤 + 含倍率的展示名）。上游给这个账号返回什么模型，
    // 本产品就展示什么模型 —— **不做倍率过滤**：计费倍率只是展示信息，不是归属
    // 判据，按它劈目录会让免费账号看得到的计费模型整条消失。
    // 远端返回空（无本侧账号 / 失败）时，适配器回退到本产品自己的兜底表；
    // 两侧目录的独立性来自「用不同账号拉」，而不是来自过滤。
    fetchRemoteModels: async () => {
      const credential = await raccoonSideCredential(side)
      const own = credential === undefined ? [] : await auth.fetchModelsWithCredential(credential)
      if (side !== 'free' || !unified() || proRemoteFetch === undefined) return own
      // 统一模式：订阅侧目录去 `-p` 后并入（免费侧条目优先 —— 免费面是
      // 默认服务面，徽标/思考档以它为准；订阅独有模型补进差集）。
      // 订阅侧拉取失败只损失「订阅独有」的条目，不影响免费侧目录。
      let proModels: RaccoonRemoteModel[] = []
      try { proModels = await proRemoteFetch() } catch { proModels = [] }
      return mergeUnifiedRaccoonCatalogs(own, proModels)
    },
    // 图片字节桥接：按模型能力判定（远端 tags 含 vision）。
    readImage: readImage,
    // ⚠️ raccoon 尤其需要请求版本：该网关按**请求体字节**设限
    // （实测 `HTTP_413: request body exceeds 10MB`，两张大截图就占掉大半配额）。
    readImageRequest: readImageRequest,
    // 两侧都传「按 plan 门控」的池视图：门控只影响目录可见性判定，
    // 黑名单/限流/凭据读写仍落在真池上。
    accountPool: raccoonSidePool(side),
    // 统一模式出站翻译：订阅账号把统一 id 还原成上游订阅线（`<id>-p`），
    // 免费账号原样。适配器据此构造请求体与限流标记，选号/账本仍记统一 id。
    ...(side === 'free' ? {
      outboundModelId: (modelId: string, accountId: string | undefined): string => {
        if (!unified() || accountId === undefined) return modelId
        const entry = pool.listAccountsByProvider(RACCOON.id).find(account => account.id === accountId)
        return raccoonSideOf(entry ?? {}) === 'pro' ? `${modelId}-p` : modelId
      },
    } : {}),
    product,
  })

  /** 免费版：目录 = 免费账号在上游看到的那一份（不按倍率过滤）。 */
  const raccoon = new RaccoonAuth(ctx)
  /** 订阅版：目录 = 订阅账号在上游看到的那一份（同样不按倍率过滤）。 */
  const raccoonPro = new RaccoonAuth(ctx, { product: RACCOON_PRO, serviceName: 'raccoonProAuth' })
  /** 订阅侧远端目录（统一模式给免费面合并用；独立模式下无人调用）。 */
  const proRemoteFetch = async () => {
    const credential = await raccoonSideCredential('pro')
    if (credential === undefined) return []
    return await raccoonPro.fetchModelsWithCredential(credential)
  }
  const raccoonAdapter = mountRaccoon(RACCOON, raccoon, 'free', proRemoteFetch)
  const raccoonProAdapter = mountRaccoon(
    RACCOON_PRO,
    raccoonPro,
    'pro',
  )

  return { auth: raccoon, subscriptionAuth: raccoonPro, adapters: { [RACCOON.id]: raccoonAdapter, [RACCOON_PRO.id]: raccoonProAdapter },
    maintain: () => raccoon.refreshAll(pool) }
}
