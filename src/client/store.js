// Pure state controller: the view never retains raw credentials or upstream errors.
// RPC 校验、渠道切换、请求生命周期（读 / 写 / 余额 / 商汤轮询）全部在这里；
// 视图只消费 getSnapshot() 的公开状态。渠道清单来自 providers/index.js 注册表，
// 没有核心渠道白名单——pack 渠道走通用读路径，商汤走 plan 读路径。
/**
 * 首次读取失败时的自动重试退避（毫秒）。
 *
 * 覆盖的是「设置页刚挂载、宿主侧 RPC 尚未就绪」这个窗口：那颗第一次整体请求会
 * 直接失败，几百毫秒后就正常。以前不重试，用户看到的就是「点开是未识别/无账号，
 * 必须手动刷新」（用户报障过多次）。
 */
const LOAD_RETRY_DELAYS_MS = Object.freeze([300, 800, 1800])
function cacheStorage() {
  try { if (globalThis.localStorage) return globalThis.localStorage } catch { /* Storage unavailable. */ }
  try { if (globalThis.sessionStorage) return globalThis.sessionStorage } catch { /* Storage unavailable. */ }
  return null
}

export function restoredRouterState(provider, cache = readChannelCache(cacheStorage())) {
  const channel = cache?.channels[provider]
  return {
    ...initial(provider), ...channel, notice: '',
    loading: !channel && (packAllowed(provider) || !(provider === PLAN_PROVIDER_ID ? cache?.plan : cache?.workbuddy)),
    statuses: cache?.statuses ?? {},
    ...(cache?.plan ? { plan: cache.plan, planStale: !!cache.plan.catalogError } : {}),
    ...(cache?.workbuddy ? { workbuddy: cache.workbuddy, workbuddyReady: true } : {}),
  }
}

export function createRouterStore(call, provider = PROVIDERS[0].id) {
  const persisted = readChannelCache(cacheStorage())
  const snapshotProviders = PROVIDERS.filter(provider => provider.snapshot)
  const snapshotReads = new Set(['credits.balances', ...snapshotProviders.flatMap(provider => provider.snapshot.methods)])
  const sharedFields = ['statuses', 'checkin', ...snapshotProviders.flatMap(provider => provider.snapshot.keep ?? [])]
  const channelCache = new Map(Object.entries(persisted?.channels ?? {}))
  let state = restoredRouterState(provider, persisted)
  let disposed = false, readController = null, balanceController = null, lightController = null, cardController = null,
    planController = null, planPollTimer = null, planPollGeneration = 0, planRevision = 0,
    planVisibilityHandler = null,
    revision = 0, balanceRevision = 0, confirmation = 0
  const listeners = new Set(), writes = new Set(), logins = new Map(), loginUrlTimers = new Set()
  // 已经为哪些渠道自动补拉过目录（每渠道一次，避免「进模型分区 → 仍是兜底 → 再拉」
  // 这个循环；用户手动点「刷新目录」不受此限制）。
  const autoRefreshed = new Set()
  let snapshotProtocol = false
  let hostCursor = null
  const lifetime = new AbortController()
  let writeRevision = 0
  const newestAccountRead = new Map()
  let newestStatusRead = 0
  /**
   * 当前渠道**登录时**要下发的 provider。
   *
   * 家族卡（Raccoon）只发账号池所在的 provider（`raccoon`）：登录一律进同一个池，
   * 套餐由主机在登录成功后自动探测打标。若照 `state.provider` 原样发，将来新增
   * 只作为模型面的家族成员时会把账号送进一个不该有账号的池。
   */
  const loginProviderOf = id => isRaccoonFamily(id) ? RACCOON_FAMILY[0] : id
  /**
   * 五张渠道卡片的**共享状态**：各渠道的运行状态与商汤的用量快照。
   *
   * 用户报障：「选完一家，别家已经读到的状态就被清空了」。
   * 成因是各条 load 路径各自只保留一部分。故这里统一成同一份 keep，
   * 所有路径都用它：账号/模型/参数/额度是**渠道自己的**数据，换渠道必须清空；
   * 卡片级状态则跨渠道保留，否则每次切换都要重新读一遍。
   */
  const sharedCards = () => Object.fromEntries(sharedFields.map(field => [field, state[field]]))
  const publish = patch => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  /**
   * 把**当前渠道**的自有数据记进缓存（只在读取/刷新成功后调用）。
   *
   * 只收 channel-pack 渠道，且排除商汤与 WorkBuddy：它们的数据在 `plan` /
   * `workbuddy` 快照里，已经由 sharedCards() 跨渠道保留，不属于本案的缓存对象。
   * 卡片级状态（statuses）一并写：重进设置页时卡片状态点立刻有值。
   */
  function rememberChannel(provider) {
    if (!packAllowed(provider) || provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) return
    channelCache.set(provider, { accounts: state.accounts, models: state.models, balances: state.balances,
      params: state.params, locked: state.locked, modelSource: state.modelSource, selected: state.selected,
      at: Date.now() })
    persistCards()
  }
  /** 只落「卡片级」状态（计数 + 商汤/WorkBuddy 快照），让下次启动首屏就是上次的样子。 */
  function persistCards() {
    writeChannelCache(cacheStorage(), Object.fromEntries(channelCache), state.statuses,
      { plan: state.plan, workbuddy: state.workbuddyReady ? state.workbuddy : null })
  }
  const request = async (method, payload, signal) => {
    if (disposed || signal?.aborted) throw new Error('请求已结束')
    const managedMethod = providerById(payload?.provider)?.rpcMethods?.has(method)
    if (!METHODS.has(method) && !managedMethod) throw new Error('不支持此操作')
    if (method === 'provider.status') {
      if (!Array.isArray(payload?.providers) || payload.providers.some(p => !packAllowed(p))) throw new Error('不支持此渠道')
    } else if (PLAN_METHODS.has(method)) {
      if (payload?.provider !== PLAN_PROVIDER_ID) throw new Error('不支持此渠道')
      if (method === 'plan.setEnabled' && typeof payload.enabled !== 'boolean') throw new Error('渠道开关无效')
      if (method === 'plan.setKey' && typeof payload.apiKey !== 'string') throw new Error('API Key 无效')
    } else if (!managedMethod && (method === 'settings.refresh' ? !allowed(payload?.provider)
      : method !== 'settings.snapshot' && !packAllowed(payload?.provider))) throw new Error('不支持此渠道')
    let result
    const cached = snapshotReads.has(method) && !payload.localOnly
    try { result = await call(method, cached ? { ...payload, snapshot: true } : payload, signal) } catch { throw new Error('主机请求未完成') }
    if (signal?.aborted || disposed) throw new Error('请求已结束')
    if (result?.ok !== true) throw new Error('主机未能完成此操作')
    if (cached && result.value?.snapshot) snapshotProtocol = true
    return result.value
  }
  const loginFor = provider => {
    const login = logins.get(provider)
    if (login && Date.now() - login.createdAt < 10 * 60_000) return login
    logins.delete(provider)
    return null
  }
  function planVisible() {
    return typeof document === 'undefined' || document.visibilityState === undefined || document.visibilityState === 'visible'
  }
  function planPollSeconds() {
    const value = state.plan?.pollSeconds
    return Math.min(300, Math.max(30, typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 60))
  }
  function stopPlanPolling() {
    planPollGeneration++
    if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
    planPollTimer = null
    planController?.abort()
    planController = null
    if (planVisibilityHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', planVisibilityHandler)
    planVisibilityHandler = null
  }
  function schedulePlanPoll(generation = planPollGeneration) {
    if (disposed || generation !== planPollGeneration || state.provider !== PLAN_PROVIDER_ID || !planVisible() || typeof setTimeout !== 'function') return
    if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
    planPollTimer = setTimeout(async () => {
      planPollTimer = null
      if (disposed || generation !== planPollGeneration || state.provider !== PLAN_PROVIDER_ID || !planVisible()) return
      await refreshPlan(PLAN_PROVIDER_ID)
      schedulePlanPoll(generation)
    }, planPollSeconds() * 1000)
  }
  async function refreshPlan(provider = state.provider) {
    if (disposed || provider !== PLAN_PROVIDER_ID || state.provider !== PLAN_PROVIDER_ID || state.busy || state.loading || !planVisible()) return false
    planController?.abort()
    const controller = new AbortController(), ticket = ++planRevision
    planController = controller
    try {
      const value = await request('plan.snapshot', { provider: PLAN_PROVIDER_ID }, controller.signal)
      if (disposed || controller.signal.aborted || ticket !== planRevision || state.provider !== PLAN_PROVIDER_ID) return false
      const merged = mergePlanSnapshot(value, state.plan)
      publish({ plan: merged.plan, planStale: merged.stale, planError: false, ...(state.planError ? { notice: '' } : {}) })
      return true
    } catch {
      if (!disposed && !controller.signal.aborted && ticket === planRevision && state.provider === PLAN_PROVIDER_ID) {
        publish({ planStale: true, planError: true, notice: '模型目录更新失败。' })
      }
      return false
    } finally {
      if (planController === controller) planController = null
    }
  }
  function startPlanPolling({ refresh = false } = {}) {
    if (snapshotProtocol) { stopPlanPolling(); return }
    if (state.provider !== PLAN_PROVIDER_ID) return
    if (!planVisibilityHandler && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      planVisibilityHandler = () => {
        if (state.provider !== PLAN_PROVIDER_ID) return
        if (planVisible()) { void refreshPlan(PLAN_PROVIDER_ID); schedulePlanPoll(planPollGeneration) }
        else {
          if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
          planPollTimer = null
          planController?.abort()
          if (state.loading && readController) {
            readController.abort(); readController = null
            publish({ loading: false, notice: state.plan ? '' : '返回页面时将自动读取商汤状态。' })
          }
        }
      }
      document.addEventListener('visibilitychange', planVisibilityHandler)
    }
    if (!planVisible()) return
    const generation = planPollGeneration
    if (refresh) void refreshPlan(PLAN_PROVIDER_ID)
    schedulePlanPoll(generation)
  }
  // autoBalance：进入/切换渠道与手动刷新时自动查一次余额；写操作后的
  // 后台 reload 传 false——连续启停模型/账号不应反复打余额接口。
  async function loadPlan(provider = PLAN_PROVIDER_ID) {
    if (disposed || provider !== PLAN_PROVIDER_ID) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    // 卡片级状态跨渠道保留（见 sharedCards），换渠道只清空渠道自己的数据。
    publish({ ...initial(provider), ...sharedCards(), busy, loading: !state.plan,
      notice: busy ? state.notice : '' })
    // 提前监听页面可见性，首个请求在隐藏时也必须终止。
    startPlanPolling()
    if (!planVisible()) {
      publish({ loading: false, notice: '返回页面时将自动读取商汤状态。' })
      return false
    }
    try {
      const value = await request('plan.snapshot', { provider: PLAN_PROVIDER_ID }, controller.signal)
      if (disposed || current !== revision || controller.signal.aborted) return false
      if (value?.snapshot?.at === null) {
        if (value.snapshot.stale) publish({ loading: false, planStale: true, planError: true })
        startPlanPolling()
        return true
      }
      const merged = mergePlanSnapshot(value, state.plan)
      publish({ plan: merged.plan, planStale: merged.stale, planError: false, loading: false, notice: '' }); startPlanPolling(); persistCards()
      return true
    } catch {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, planStale: true, planError: true,
          notice: '商汤 Token Plan 暂时无法读取，请检查网络或配置后重试。' })
        startPlanPolling()
      }
      return false
    }
  }
  async function loadManaged(provider) {
    const spec = providerById(provider)?.snapshot
    if (disposed || !spec) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    // 卡片级状态跨渠道保留（见 sharedCards），换渠道只清空渠道自己的数据。
    publish({ ...initial(provider), ...sharedCards(), busy, loading: !spec.ready(state),
      notice: busy ? state.notice : '' })
    try {
      const values = await Promise.all(spec.methods.map(method => request(method, { provider }, controller.signal)))
      if (disposed || current !== revision || controller.signal.aborted) return false
      const main = values[0]?.snapshot
      if (main?.at === null) {
        if (main.stale) publish({ loading: false, ...spec.readFailed?.(state) })
        return true
      }
      publish({ ...spec.fromRead(values, state), loading: false, notice: '' })
      persistCards()
      return true
    } catch {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, ...spec.readFailed?.(state), notice: '读取失败。' })
      }
      return false
    }
  }
  // Compatibility for a host still serving the per-provider RPCs.
  async function prefetchCards() {
    if (disposed || snapshotProtocol) return false
    const controller = new AbortController()
    const mutation = writeRevision
    cardController?.abort()
    cardController = controller
    const missing = snapshotProviders.filter(provider => !provider.snapshot.ready(state))
    await Promise.all(missing.map(async ({ id, snapshot }) => {
      try {
        const values = await Promise.all(snapshot.methods.map(method => request(method, { provider: id }, controller.signal)))
        if (disposed || controller.signal.aborted || mutation !== writeRevision || values[0]?.snapshot?.at === null) return
        publish(snapshot.fromRead(values, state))
        persistCards()
      } catch { /* Retry on the next visit. */ }
    }))
    return missing.length > 0
  }

  /**
   * 读一个渠道的状态（账号 / 模型 / 参数 / 卡片计数）并发布。
   *
   * @returns `true` 成功、`false` 已作废（切渠道/销毁/中止）、`undefined` 失败**可重试**。
   * 拆出来是为了让 {@link load} 能在失败时自动重试，而不必把整段逻辑抄一遍。
   */
  async function readChannel(provider, controller, selection) {
    const sides = modelProvidersOf(provider)
    const started = Date.now()
    try {
      const results = await Promise.all([
        request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal),
        request('account.list', { provider }, controller.signal),
        ...sides.map(side => request('model.list', { provider: side }, controller.signal)),
        providerById(provider)?.caps?.permanentLock ? request('credits.permanentLock', { provider }, controller.signal) : Promise.resolve({ locked: false }),
        ...sides.map(side => request('model.params', { provider: side }, controller.signal)),
      ])
      if (disposed || controller.signal.aborted) return false
      const [statuses, accounts] = results
      const modelValues = results.slice(2, 2 + sides.length)
      const lock = results[2 + sides.length]
      const paramValues = results.slice(3 + sides.length)
      const rows = accountsFrom(accounts, provider)
      newestAccountRead.set(provider, started)
      newestStatusRead = started
      publish({ accounts: rows,
        models: sides.flatMap((side, index) => modelsFrom(modelValues[index], side)),
        modelSource: { ...state.modelSource, ...Object.fromEntries(sides.flatMap((side, index) =>
          CACHE_MODEL_SOURCES.has(modelValues[index]?.source) ? [[side, modelValues[index].source]] : [])) },
        ...(provider === 'qodercn' ? { qoderCatalogIssue: modelValues[0]?.issue ?? '' } : {}),
        statuses: statusFrom(statuses), locked: lock?.locked === true,
        params: Object.assign({}, ...sides.map((side, index) => paramsFrom(paramValues[index], side))),
        selected: rows.some(a => a.id === selection) ? selection : '', loading: false, loadFailed: false,
        notice: '' })
      // 读取成功即记住这次结果：下次切回这个渠道立刻有内容可显示。
      rememberChannel(provider)
      persistCards()
      return rows
    } catch {
      return undefined
    }
  }

  async function load(provider = state.provider, autoBalance = true) {
    if (disposed || !allowed(provider)) return false
    hostCursor = null
    if (provider === PLAN_PROVIDER_ID) return loadPlan(provider)
    if (providerById(provider)?.snapshot) return loadManaged(provider)
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const same = provider === state.provider
    // 切到**读过的**渠道时用缓存先把界面填上（后台照常刷新）。
    // 同渠道重读只用当前状态——当前状态本来就是最新的；**唯一例外**是「这次会话
    // 还没读到任何东西」（重进设置页的第一读：初始状态只恢复了卡片级状态），
    // 那种情况下缓存才是这个渠道上次的结果。
    const cachedEntry = channelCache.get(provider) ?? null
    const unloaded = !state.accounts.length && !state.models.length && !state.balances.length
    const cached = !same || unloaded ? cachedEntry : null
    const selected = cached ? (cached.selected || '') : same ? state.selected : ''
    const busy = state.busy
    // 同渠道重读**不清空已展示的数据**：后台 reload 失败时旧列表继续可见，
    // 否则会整页空白配一句「已保存」，用户会误以为账号被删了。
    // 只有切换渠道才是真的换了上下文，那时才回到 initial（余额按账号 join，
    // 换渠道必须清空，否则已删账号的余额会残留显示）——但**有缓存的渠道**例外：
    // 缓存命中的正是该渠道自己的上次数据，直接展示比空白配「正在读取」有用得多。
    // 写操作触发的后台重读不要覆盖「正在应用」提示，它比「正在读取」更贴近用户刚做的事。
    const keep = same && !cached ? { accounts: state.accounts, models: state.models,
      params: state.params, locked: state.locked, balances: state.balances,
      // 目录来源属于渠道自有结论：同渠道重读不能把它清回「未知」，
      // 否则每次启停模型后来源标识都会闪回未读状态。
      modelSource: state.modelSource }
      : cached ? { accounts: cached.accounts, models: cached.models, balances: cached.balances,
        params: cached.params, locked: cached.locked, modelSource: cached.modelSource } : {}
    // 卡片级状态跨渠道保留（见 sharedCards）；selected 换渠道时用目标渠道自己的选号。
    publish({ ...initial(provider), ...sharedCards(), ...keep, busy, selected, login: loginFor(provider), loading: true,
      // 命中缓存时不显示「正在读取渠道状态…」：界面已经有内容，这句只会让人以为
      // 又要重来一次。刷新失败仍会照常改成错误提示（下面的 catch）。
      notice: busy ? state.notice : cached || cachedEntry ? '' : initial(provider).notice })
    // 余额请求用独立控制器：写操作后的后台 reload 不能中止在途的余额查询，
    // 否则刚打开页面就点开关会让余额一直停在「待查询」。只有切换渠道才作废旧余额。
    if (!same) { balanceController?.abort(); balanceController = null }
    let rows = await readChannel(provider, controller, selected)
    // ⚠️ **失败要自己重试，别让用户去点刷新**（用户报障：「每次点开都是未识别/无账号，
    // 必须手动刷新」）。设置页刚挂载时宿主侧 RPC 可能还没就绪，第一次整体失败，
    // 几百毫秒后就正常——这不是用户该处理的事。
    //
    // ⚠️ 只在「这一读**没有任何可展示的数据**」时重试（首次打开 / 无缓存）。
    // 有旧数据时的重读（写操作后的后台 reload、手动刷新）不重试：那时旧列表还在，
    // 静默重试只会让「操作已完成但列表是旧的」这个结论迟迟不落地。
    // 「结果自相矛盾」也要重试：`account.list` 说这个渠道没有账号，但同一轮的
    // `provider.status` 明确报了 N 个启用账号 —— 那不是真实情况，是读取时序问题
    // （宿主刚启动时账号池还没就绪）。用户看到的「点开是无账号」多半就是这个。
    const contradictory = () => {
      if (rows === undefined || !Array.isArray(rows) || rows.length > 0) return false
      const status = state.statuses?.[provider]
      const enabled = status?.accounts && typeof status.accounts === 'object' ? status.accounts.enabled : status?.accounts
      return typeof enabled === 'number' && enabled > 0
    }
    const canRetry = (rows === undefined || contradictory()) && state.models.length === 0
    for (let attempt = 0; canRetry && (rows === undefined || contradictory()) && attempt < LOAD_RETRY_DELAYS_MS.length; attempt++) {
      await new Promise(resolve => { const timer = setTimeout(resolve, LOAD_RETRY_DELAYS_MS[attempt]); loginUrlTimers.add(timer) })
      if (disposed || current !== revision || controller.signal.aborted) return false
      rows = await readChannel(provider, controller, selected)
    }
    if (rows === undefined || contradictory()) {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, loadFailed: true, notice: '读取失败，点「刷新」重试。' })
      }
      return false
    }
    if (rows === false) return false
    // 余额随打开页面自动查一次：余额是打开设置页最想知道的东西，
    // 让用户每次先点一次「刷新余额」纯属多余。
    // 失败**不影响主流程**（余额查询会打上游，可能超时或未登录），
    // 单独降级成一行提示，而不是让整页「读取失败」。
    if (autoBalance && rows.length > 0 && !disposed) void refreshLatestBalances(provider)
    return true
  }

  /**
   * 刷新模型目录的来源提示文案（按各侧结果如实说明，不美化）。
   */
  function catalogNotice(sides, sources) {
    if (!Object.keys(sources).length) return '模型目录刷新未完成，可稍后点「刷新目录」重试。'
    if (sides.every(side => sources[side] === 'cached')) return '本次刷新失败，显示上次成功拉取的目录。'
    if (sides.some(side => sources[side] === 'cached')) return '部分模型面显示上次成功拉取的目录。'
    const fallback = sides.filter(side => sources[side] === 'fallback').length
    if (fallback === 0) return '模型目录已从上游刷新。'
    return fallback === sides.length
      ? '未拉取到上游目录，显示离线兜底。'
      : '部分模型面未拉取到上游目录，显示离线兜底。'
  }
  /**
   * 刷新模型目录：先让主机真去上游拉（`model.refresh`），再重读 `model.list`。
   *
   * 为什么需要这样一个动作：`model.list` 是**同步读缓存**，缓存为空时直接返回
   * 适配器的硬编码兜底表 —— 设置页因此永远只显示兜底那几条，且没有任何入口能
   * 把真目录拉下来（对话选择器走的是另一条 `llm.listModels` 路径）。
   *
   * @param target 只刷某一侧（家族卡的免费 / 订阅各一个按钮）；不给就是当前渠道
   *   的全部模型面（家族卡两侧一起）。
   * @param options.silent 进入模型分区时的后台补拉：不置 busy、不写提示。
   */
  async function refreshCatalog(target, options = {}) {
    const silent = options.silent === true
    // 加载/写入期间不插队：二者都会整体重写 models，交叉发布会让目录与来源错位。
    if (disposed || state.loading || state.busy) return false
    const channel = state.provider
    // 只认当前渠道的模型面：家族卡的两个 id 各有按钮，别的渠道的 id 落回整渠道刷新。
    const sides = typeof target === 'string' && modelProvidersOf(channel).includes(target) ? [target] : modelProvidersOf(channel)
    if (!sides.length) return false
    const controller = new AbortController()
    writes.add(controller)
    if (!silent) publish({ busy: true, notice: '正在向上游拉取模型目录…' })
    try {
      // 逐侧独立结算：家族卡一侧没有本侧账号时那侧会是 fallback，不该连累另一侧。
      const results = await Promise.allSettled(sides.map(side => request('model.refresh', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted) return false
      const sources = {}
      sides.forEach((side, index) => {
        const result = results[index]
        if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') return
        // 主机只回 'remote' / 'fallback' 两个结论；其它值一律按离线兜底（不谎报远端）。
        sources[side] = CACHE_MODEL_SOURCES.has(result.value.source) ? result.value.source : 'fallback'
      })
      const fresh = await Promise.all(sides.map(side => request('model.list', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted || state.provider !== channel) return false
      // 只替换刷新的那几侧，其余侧的模型沿用当前列表（家族卡只刷一侧时不能清空另一侧）。
      const refreshed = new Map(sides.map((side, index) => [side, modelsFrom(fresh[index], side)]))
      publish({
        models: modelProvidersOf(channel).flatMap(side => refreshed.has(side)
          ? refreshed.get(side) : state.models.filter(model => model.provider === side)),
        ...(Object.keys(sources).length ? { modelSource: { ...state.modelSource, ...sources } } : {}),
        ...(silent ? {} : { notice: providerById(channel)?.caps?.cliCatalog && results[0]?.status === 'fulfilled' && sources[channel]
          ? '' : catalogNotice(sides, sources) }),
        ...(channel === 'qodercn' && results[0]?.status === 'fulfilled' ? { qoderCatalogIssue: results[0].value?.issue ?? '' } : {}),
      })
      // 目录来源与模型列表都属于渠道自有结论，一起记住。
      rememberChannel(channel)
      return true
    } catch {
      if (!silent && !disposed && !controller.signal.aborted && state.provider === channel) {
        publish({ notice: '模型目录刷新未完成，可稍后点「刷新目录」重试。' })
      }
      return false
    } finally {
      writes.delete(controller)
      if (!silent && !disposed) publish({ busy: false })
    }
  }
  /**
   * 进入模型分区时的**后台补拉**：来源未知或上次是离线兜底时补刷一次。
   *
   * 每渠道只自动尝试一次（`autoRefreshed`）：兜底同样会写 `modelSource`，
   * 若以「来源不是 remote」为条件就会形成「刷新 → 仍是兜底 → 再刷新」的死循环。
   * 已经确认是远端目录的渠道不重复打上游。加载中则**不消费**这次机会，
   * 等加载结束后由设置页的依赖变化再次触发（见 settings.js 的 useEffect）。
   */
  function autoRefreshCatalog() {
    if (disposed || state.loading) return Promise.resolve(false)
    const channel = state.provider
    // Qoder 目录走官方 CLI（第三方驱动官方组件，ToS 谨慎）：只在用户手动点
    // 「刷新目录」时 spawn，silent 自动补拉不触发官方进程。
    if (!packAllowed(channel) || providerById(channel)?.caps?.cliCatalog) return Promise.resolve(false)
    const sides = modelProvidersOf(channel)
    if (!sides.length || autoRefreshed.has(channel)) return Promise.resolve(false)
    if (sides.every(side => state.modelSource[side] === 'remote')) return Promise.resolve(false)
    autoRefreshed.add(channel)
    return refreshCatalog(undefined, { silent: true })
  }
  // 序号保护：手动「刷新余额」与自动查询是两条独立链路，谁后到谁生效会让
  // 慢的旧结果盖掉用户刚刷出来的新值（实测可复现）。只接受最新一份结果。
  async function refreshBalances(provider, controller, ticket = balanceRevision) {
    try {
      const value = await request('credits.balances', { provider }, controller.signal)
      if (value?.snapshot?.at === null) return
      // 余额是渠道级数据：只要渠道没换、请求没被终止就接受结果，
      // 写操作触发的重读不会让在途的余额查询作废。
      if (disposed || controller.signal.aborted || provider !== state.provider) return
      if (ticket !== balanceRevision) return
      publish({ balances: balancesFrom(value).map(balance => ({ ...balance, stale: balance.stale || value?.snapshot?.stale === true })) })
      // 余额也进缓存：切回渠道时额度栏不是「待查询」。
      rememberChannel(provider)
    } catch {
      // 自动查询失败只做提示；已有余额数据保持不动（不清空成「零」）。
      if (!disposed && !controller.signal.aborted && provider === state.provider && ticket === balanceRevision) {
        publish({ notice: '余额更新失败。' })
      }
    }
  }
  // 新的余额查询取代旧查询：统一保存控制器，切换渠道与卸载都能取消；
  // 序号同时阻止不遵守 AbortSignal 的旧响应或失败提示覆盖新状态。
  /**
   * **静默轻量刷新**（设置页可见期间定时 / 回到前台时调用）。
   *
   * 为什么需要它：`load()` 只在「打开设置页 / 切渠道 / 手动刷新」时跑一次，
   * 之后额度与卡片计数就一直是打开那一刻的快照 —— 用户得反复点「刷新余额」
   * 或来回切渠道才能看到新数字（用户报障：「点进去才刷新，太蠢了」）。
   *
   * 这里只做两件便宜的事：
   * 1. `provider.status`（全部渠道的账号数/模型数/开关状态）；
   * 2. 当前渠道的 `credits.balances`（账号行上的额度数字）。
   *
   * ⚠️ 三条纪律：
   * - **不置 busy、不写 notice**：静默刷新不该让界面闪「读取中」，也不该顶掉
   *   用户刚看到的操作提示；
   * - **不重读账号/模型列表**：那些只在登录、删除、启停后才变，磁盘扫描没必要；
   * - 写操作或整页读取在途时**直接跳过**，避免和它抢同一个状态位。
   */
  async function refreshLight(backgroundOnly = false) {
    if (disposed || state.busy) return false
    if (snapshotProtocol) return readHostSnapshots()
    if (backgroundOnly || state.loading) return false
    const provider = state.provider
    // 商汤 / WorkBuddy 是快照型渠道，各有自己的读取路径，不走这里。
    if (provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) return false
    const controller = new AbortController()
    lightController?.abort()
    lightController = controller
    try {
      const statuses = await request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal)
      if (!disposed && !controller.signal.aborted) { publish({ statuses: statusFrom(statuses) }); persistCards() }
    } catch { /* 静默：下一轮再试 */ }
    finally { if (lightController === controller) lightController = null }
    if (state.accounts.length > 0 && state.provider === provider) void refreshLatestBalances(provider)
    return true
  }
  async function readHostSnapshots() {
    if (lightController) return false
    const controller = new AbortController()
    const mutation = writeRevision, selection = revision
    lightController = controller
    try {
      const result = await request('settings.snapshot', { cursor: hostCursor }, controller.signal)
      if (mutation !== writeRevision || selection !== revision || state.busy) return false
      if (typeof result?.cursor !== 'string') return false
      snapshotProtocol = true
      hostCursor = result.cursor
      const snapshots = result.entries
      const get = (method, provider = state.provider) => snapshots?.[method === 'provider.status' ? method : `${provider}/${method}`]
      const status = get('provider.status')
      const accounts = get('account.list')
      const credits = get('credits.balances')
      const checkin = get('checkin.status', 'daily')
      const patch = {}
      if (checkin?.value) patch.checkin = checkin.value
      if (status?.value && status.at >= newestStatusRead) patch.statuses = statusFrom(status.value)
      if (accounts?.value && accounts.at >= (newestAccountRead.get(state.provider) ?? 0) && (!state.loading || !state.accounts.length)) {
        patch.accounts = accountsFrom(accounts.value, state.provider)
      }
      if (credits?.value) patch.balances = balancesFrom(credits.value).map(balance => ({ ...balance, stale: credits.stale || balance.stale }))
      else if (credits?.stale) patch.balances = state.balances.map(balance => ({ ...balance, stale: true }))
      for (const provider of snapshotProviders) {
        Object.assign(patch, provider.snapshot.apply(method => get(method, provider.id), state))
      }
      if (Object.keys(patch).length) {
        publish(patch)
        if (packAllowed(state.provider) && (accounts || credits)) rememberChannel(state.provider)
        else persistCards()
      }
      return true
    } catch { return false } finally {
      if (lightController === controller) lightController = null
    }
  }
  async function refreshSettings() {
    if (!snapshotProtocol) return load()
    const provider = state.provider
    if (state.loadFailed) void load(provider)
    try {
      await request('settings.refresh', { provider }, lifetime.signal)
      if (!disposed && state.provider === provider) publish({ notice: '已请求更新。' })
      return true
    } catch {
      if (!disposed && state.provider === provider) publish({ notice: '更新请求失败。' })
      return false
    }
  }
  function refreshLatestBalances(provider) {
    balanceController?.abort()
    const controller = new AbortController()
    balanceController = controller
    return refreshBalances(provider, controller, ++balanceRevision)
  }
  async function mutate(method, payload = {}, options = {}) {
    if (disposed || state.busy || state.loading) return false
    // WorkBuddy 的账号在它自己的快照里（state.workbuddy.accounts），不在账号池 state.accounts。
    const known = !!payload.accountId && (state.accounts.some(a => a.id === payload.accountId)
      || !!providerById(state.provider)?.managedAccount?.(state, payload.accountId))
    if (payload.accountId && !['account.create', 'login.poll'].includes(method) && !known) {
      publish({ notice: '账号已变化，请刷新后重试。' }); return false
    }
    // ⚠️ **目标 provider 不再写死成当前渠道**：家族卡（Raccoon）的模型来自两个
    // provider，模型启停/参数/渠道开关必须打到模型自己所属的那个 id 上；
    // 账号类操作则跟随**账号所在的池**（`state.accounts[].provider`）。
    // 优先级：显式 payload.provider > 账号所在 provider > 当前渠道。
    const account = typeof payload.accountId === 'string'
      ? state.accounts.find(entry => entry.id === payload.accountId) : undefined
    const provider = typeof payload.provider === 'string' ? payload.provider
      : account?.provider || state.provider
    // 渠道上下文：busy 提示、重读与「结果是否还属于当前页面」都按它判断，
    // 而不是按目标 provider（否则给订阅模型改参数会静默丢掉成功提示）。
    const channel = state.provider
    writeRevision++
    const controller = new AbortController()
    writes.add(controller)
    publish({ busy: true, notice: options.progress || '正在应用，请稍候…' })
    try {
      const result = await request(method, { provider, ...payload }, controller.signal)
      // await result 回调：回调里的 load 完成后再发布成功提示，
      // 否则 load 的重读会把提示清掉（登录成功刷新列表就走这条路）。
      // 回调抛的是本地构造的中文原因（如「登录地址不可用」），直接展示，不并进通用文案。
      try { await options.result?.(result, provider) }
      catch (error) {
        if (!disposed && state.provider === channel) publish({ notice: typeof error?.message === 'string' && error.message ? error.message : '操作未完成，请刷新确认状态后重试。' })
        return false
      }
      if (!disposed && state.provider === channel) {
        // 记下重读是否成功：失败时旧数据仍在（load 已不再清空），但必须告诉用户
        // 这是上一次的结果，不能只报「已保存」让他以为看到的是最新状态。
        let reloaded = null
        // 重读的是**当前渠道**（家族卡两侧一起读），不是目标 provider。
        if (options.refresh !== false) reloaded = await load(channel, false)
        if (!disposed && state.provider === channel) {
          const done = typeof options.message === 'function' ? options.message(result) : options.message || '已应用。'
          publish({ notice: reloaded === false ? `${done}列表更新失败，显示上次结果。` : done })
        }
      }
      return true
    } catch {
      if (!disposed && state.provider === channel) publish({ notice: controller.signal.aborted
        ? '请求已取消。' : '操作失败。' })
      return false
    } finally {
      writes.delete(controller)
      if (!disposed) publish({ busy: false })
    }
  }
  async function planMutate(method, payload, options = {}) {
    if (disposed || state.busy || state.loading || state.provider !== PLAN_PROVIDER_ID) return false
    const controller = new AbortController()
    // 旧轮询可能稍后返回，不能覆盖刚保存的逐模型设置。
    planRevision++
    writeRevision++
    planController?.abort()
    planController = null
    writes.add(controller)
    publish({ busy: true, notice: options.progress || '正在应用商汤设置…' })
    try {
      const result = await request(method, { provider: PLAN_PROVIDER_ID, ...payload }, controller.signal)
      if (disposed || state.provider !== PLAN_PROVIDER_ID) return true
      if (options.result) {
        options.result(result)
        persistCards()
        publish({ notice: options.message || '商汤设置已保存。' })
      } else {
        const refreshed = await loadPlan(PLAN_PROVIDER_ID)
        if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: refreshed ? options.message || '商汤设置已保存。' : '设置已保存，但模型目录读取未完成。' })
      }
      return true
    } catch {
      if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: controller.signal.aborted ? '请求已取消。' : '商汤设置保存失败。' })
      return false
    } finally {
      writes.delete(controller)
      if (!disposed) publish({ busy: false })
    }
  }
  const store = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    load,
    readHostSnapshots,
    refreshSettings,
    /** 静默刷新卡片计数与当前渠道余额（可见期间的定时器 / 回到前台时调用）。 */
    refreshLight,
    /** 卡片级预热：补读快照型渠道（商汤 / WorkBuddy）的状态，让渠道 tab 首屏就准。 */
    prefetchCards,
    /** 手动刷新模型目录：`target` 只刷某一侧（家族卡各一个按钮），缺省刷整个渠道。 */
    refreshModels(target) { return refreshCatalog(target) },
    /** 进入模型分区时的后台补拉（设置页调用；结果写进 `modelSource`）。 */
    autoRefreshModels() { return autoRefreshCatalog() },
    ...Object.assign({}, ...PROVIDERS.map(provider => provider.createActions?.({
      getState: () => state, isDisposed: () => disposed, hasSnapshots: () => snapshotProtocol,
      request, publish, mutate, planMutate, loadManaged, loginUrlTimers, writes,
    }))),
    message(notice) { publish({ notice }) },
    select(accountId) {
      if (state.accounts.some(a => a.id === accountId)) publish({ selected: accountId, pendingDelete: null })
    },
    save(accountId, nickname, enabled) {
      if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 80 || typeof enabled !== 'boolean') {
        publish({ notice: '请填写 1–80 个字的账号备注。' }); return Promise.resolve(false)
      }
      return mutate('account.update', { accountId, patch: { nickname: nickname.trim(), enabled } }, { message: '账号设置已保存。' })
    },
    accountAction(method, accountId) {
      if (!['account.refresh', 'account.reset', 'account.retest'].includes(method)) return Promise.resolve(false)
      return mutate(method, { accountId })
    },
    prioritize(accountId) {
      const account = state.accounts.find(a => a.id === accountId)
      if (!account) return Promise.resolve(false)
      // 顺序是**池内**概念：带账号所在 provider，别写死当前渠道（家族卡两个
      // 模型面共用一个池，将来若某面单独有池也不会串）。
      return mutate('account.reorder', { provider: account.provider || state.provider,
        orderedIds: [accountId, ...state.accounts.filter(a => a.id !== accountId).map(a => a.id)] })
    },
    requestDelete(accountId) {
      const account = state.accounts.find(a => a.id === accountId)
      // 删除确认记**账号所在 provider**：家族卡的两个模型面共用一个池，
      // 但账号行本身仍带 provider 字段，确认时按它比对而不是按当前渠道写死。
      const managed = providerById(state.provider)?.managedAccount?.(state, accountId)
      if (account || managed) publish({ pendingDelete: { accountId, nickname: account?.nickname ?? managed.name,
        provider: account?.provider || state.provider, nonce: ++confirmation } })
    },
    cancelDelete() { publish({ pendingDelete: null }) },
    confirmDelete(target) {
      const pending = state.pendingDelete
      if (!pending || !target || target.nonce !== pending.nonce || target.accountId !== pending.accountId || target.provider !== pending.provider || target.provider !== state.provider) {
        publish({ notice: '删除确认已失效，请重新选择账号。' }); return Promise.resolve(false)
      }
      publish({ pendingDelete: null })
      const removeAction = providerById(target.provider)?.removeAction
      if (removeAction) return store[removeAction](target.accountId)
      return mutate('account.delete', { accountId: target.accountId }, { message: '账号已移除。' })
    },
    /**
     * 渠道开关。`target` 用于家族卡的**两个**模型面开关（免费 / 订阅各一个）：
     * 不给就是当前渠道自己。
     */
    setEnabled(enabled, target) {
      const provider = typeof target === 'string' && target ? target : state.provider
      return mutate('provider.setEnabled', { provider, enabled: enabled === true })
    },
    /** 启停模型：`key` 是 {@link modelKey}（`provider:modelId`），按模型所属 provider 下发。 */
    toggleModel(key) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      return mutate(model.dead ? 'model.clearDead' : 'model.setDisabled',
        model.dead ? { provider: model.provider, modelId: model.id }
          : { provider: model.provider, modelId: model.id, disabled: !model.disabled })
    },
    setModels(disabled, target) {
      const provider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.setAllDisabled', { provider, disabled: disabled === true })
    },
    resetModels(target) {
      const provider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.resetDefaults', { provider }, { message: '已恢复推荐模型。' })
    },
    /**
     * 保存模型参数覆盖。
     *
     * 键同样是 {@link modelKey}；写回时只替换该 provider 那一份参数表，
     * 另一侧的覆盖保持不动（否则改免费模型会把订阅模型的设置清空）。
     */
    setModelParams(key, patch) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      const channel = state.provider
      return mutate('model.setParams', { provider: model.provider, modelId: model.id, params: patch }, {
        refresh: false, message: '模型参数已保存。',
        result(value) {
          if (state.provider === channel) publish({ params: { ...state.params, ...paramsFrom(value, model.provider) } })
          if (state.provider === channel) rememberChannel(channel)
        } })
    },
    balances() {
      if (snapshotProtocol) return refreshSettings()
      // 手动刷新走同一条余额链路：先中止在途的自动查询，避免它后到盖掉这次结果。
      balanceController?.abort()
      balanceController = null
      const ticket = ++balanceRevision
      return mutate('credits.balances', {}, { refresh: false, progress: '正在查询余额…', message: '余额已更新。',
        result(value, provider) {
          if (state.provider !== provider || ticket !== balanceRevision) return
          publish({ balances: balancesFrom(value) })
          rememberChannel(provider)
        } })
    },
    claim() {
      // Raccoon 家族没有每日签到端点：不发注定被拒的请求，也不显示误导性提示。
    if (providerById(state.provider)?.caps?.dailyReward === false) return Promise.resolve(false)
      const provider = state.provider
      // 领取会真的改变额度：成功后顺手刷一次，否则用户领完看到的还是旧数字。
      return mutate('credits.claimAll', {}, { refresh: false, progress: '正在领取每日额度…', message: value => claimMessage(value, provider),
        async result(value, provider) { if (state.provider === provider) await refreshLatestBalances(provider) } })
    },
    onboarding(accountId) {
      // 显式收账号 id：平铺列表里每个领取按钮直接指向自己的账号，
      // 不再依赖「先选中再点」这个隐藏的前置步骤。
      const target = typeof accountId === 'string' && accountId !== '' ? accountId : state.selected
      if (!target || !providerById(state.provider)?.caps?.onboarding) { publish({ notice: '请选择账号。' }); return Promise.resolve(false) }
      if (!state.accounts.some(a => a.id === target)) { publish({ notice: '账号已变化，请刷新后重试。' }); return Promise.resolve(false) }
      // 奖励同样会改变额度，领取后一起刷新余额。
      return mutate('onboarding.claim', { accountId: target }, { refresh: false, progress: '正在领取任务奖励…',
        message: value => `任务领取：${Array.isArray(value?.claimed) ? value.claimed.length : 0} 项新增，${Array.isArray(value?.skipped) ? value.skipped.length : 0} 项已完成。`,
        async result(value, provider) { if (state.provider === provider) await refreshLatestBalances(provider) } })
    },
    lock(locked) { return mutate('credits.permanentLock', { locked: locked === true }) },
    startLogin() {
      const channel = state.provider
      const existing = loginFor(channel)
      if (existing) { publish({ login: existing, notice: '已有登录等待中，请继续完成。' }); return Promise.resolve(false) }
      // 家族卡只发账号池所在的 provider（见 loginProviderOf 的注释）。
      const loginProvider = loginProviderOf(channel)
      return mutate('account.create', { provider: loginProvider }, { refresh: false, progress: '正在准备登录…', message: '登录地址已准备好，请点打开登录页面完成授权。',
        result(value) {
          if (typeof value?.accountId !== 'string') throw new Error('登录未准备好')
          const login = { accountId: value.accountId, url: safeLoginUrl(value.loginUrl), createdAt: Date.now() }
          logins.set(channel, login)
          if (state.provider === channel) publish({ login })
        } })
    },
    pollLogin() {
      const channel = state.provider
      const login = loginFor(channel)
      if (!login) { publish({ login: null, notice: '登录等待已结束，请重新添加账号。' }); return Promise.resolve(false) }
      // 成功就顺手把账号列表拉回来；记下读取结果，失败时别谎报「已刷新」。
      let refreshed = null
      return mutate('login.poll', { provider: loginProviderOf(channel), accountId: login.accountId }, { refresh: false, progress: '正在检查登录…',
        message: value => !value?.done ? '尚未完成，请在登录页继续授权后再检查。'
          : !value.success ? '登录失败，请重新添加账号。'
            : refreshed === false ? '登录成功，但账号列表读取失败，请点「刷新」重试。'
              : '登录成功，账号列表已刷新。',
        // 返回 load 让 mutate 等重读完成再发布提示，不被重读清掉。
        async result(value) {
          if (!value?.done) return
          logins.delete(channel)
          if (state.provider !== channel) return
          publish({ login: null })
          if (value.success) refreshed = await load(channel, false)
        } })
    },
    forgetLogin() { logins.delete(state.provider); publish({ login: null, notice: '已结束等待；已打开的授权流程可能仍在进行。' }) },
    dispose() {
      if (disposed) return
      lifetime.abort()
      disposed = true; revision++; readController?.abort(); balanceController?.abort(); balanceController = null; lightController?.abort(); lightController = null; cardController?.abort(); cardController = null; stopPlanPolling()
      if (typeof clearTimeout === 'function') for (const id of loginUrlTimers) clearTimeout(id)
      loginUrlTimers.clear()
      for (const controller of writes) controller.abort()
      writes.clear(); listeners.clear(); logins.clear(); autoRefreshed.clear()
      // 只清内存缓存：sessionStorage 里的条目留给下次进入设置页恢复。
      channelCache.clear()
    },
  }
  return store
}
