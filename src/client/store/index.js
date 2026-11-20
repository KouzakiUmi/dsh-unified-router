// Pure state controller: the view never retains raw credentials or upstream errors.
// 模块化拆分：pending.js（局部非阻塞锁）+ cache.js（首屏轻量缓存）+ sync.js（Host 快照游标同步）+ 本门面。
const LOAD_RETRY_DELAYS_MS = Object.freeze([300, 800, 1800])

export function createRouterStore(call, provider = PROVIDERS[0].id) {
  const persisted = readChannelCache(cacheStorage())
  const cache = createClientCache(persisted)
  const snapshotProviders = PROVIDERS.filter(item => item.snapshot)
  const snapshotReads = new Set(['credits.balances', ...snapshotProviders.flatMap(item => item.snapshot.methods)])
  const sharedFields = ['statuses', 'checkin', 'automation', ...snapshotProviders.flatMap(item => item.snapshot.keep ?? [])]
  let state = restoredRouterState(provider, persisted)
  let disposed = false, readController = null, balanceController = null,
    planController = null, planPollTimer = null, planPollGeneration = 0, planRevision = 0,
    planVisibilityHandler = null,
    revision = 0, balanceRevision = 0, confirmation = 0
  const listeners = new Set(), writes = new Set(), logins = new Map(), loginUrlTimers = new Set()
  const autoRefreshed = new Set()
  const lifetime = new AbortController()
  let writeRevision = 0
  const newestAccountRead = new Map()
  const newestModelRead = new Map()
  const newestStatusReadRef = { current: 0 }

  const loginProviderOf = id => isRaccoonFamily(id) ? RACCOON_FAMILY[0] : id
  const sharedCards = () => Object.fromEntries(sharedFields.map(field => [field, state[field]]))
  const publish = patch => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  const pending = createPendingTracker((map, any) => {
    publish({ pending: map, busy: any })
  })

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
    } else if (method === 'apikey.setKey' && typeof payload?.apiKey !== 'string') {
      throw new Error('API Key 无效')
    } else if (AUTOMATION_METHODS.has(method)) {
      if (payload?.provider !== undefined && !allowed(payload.provider) && !packAllowed(payload.provider)) throw new Error('不支持此渠道')
    } else if (!managedMethod && (method === 'settings.refresh' ? (payload?.provider !== 'all' && !allowed(payload?.provider))
      : method !== 'settings.snapshot' && !packAllowed(payload?.provider))) throw new Error('不支持此渠道')
    let result
    const live = payload?.live === true
    const cleanPayload = live ? (() => { const { live: _drop, ...rest } = payload; return rest })() : payload
    const cached = snapshotReads.has(method) && !cleanPayload.localOnly && !live
    try { result = await call(method, cached ? { ...cleanPayload, snapshot: true } : cleanPayload, signal) } catch { throw new Error('主机请求未完成') }
    if (signal?.aborted || disposed) throw new Error('请求已结束')
    if (result?.ok !== true) throw new Error('主机未能完成此操作')
    if (cached && result.value?.snapshot) sync.markSnapshotProtocol()
    return result.value
  }

  const sync = createHostSync({
    snapshotProviders,
    getState: () => state,
    isDisposed: () => disposed,
    request,
    publish,
    cache,
    getWriteRevision: () => writeRevision,
    getReadRevision: () => revision,
    newestStatusReadRef,
    newestAccountRead,
    newestModelRead,
  })

  const loginFor = target => {
    const login = logins.get(target)
    if (login && Date.now() - login.createdAt < 10 * 60_000) return login
    logins.delete(target)
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
  async function refreshPlan(target = state.provider) {
    if (disposed || target !== PLAN_PROVIDER_ID || state.provider !== PLAN_PROVIDER_ID || state.busy || state.loading || !planVisible()) return false
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
    if (sync.hasSnapshots()) { stopPlanPolling(); return }
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

  async function loadPlan(target = PLAN_PROVIDER_ID, force = false) {
    if (disposed || target !== PLAN_PROVIDER_ID) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    const pendingMap = state.pending
    publish({ ...initial(target), ...sharedCards(), busy, pending: pendingMap, loading: !state.plan,
      notice: busy ? state.notice : '' })
    startPlanPolling()
    if (!planVisible()) {
      publish({ loading: false, notice: '返回页面时将自动读取商汤状态。' })
      return false
    }
    // 普通切渠道且商汤状态已就绪时直接走增量游标；写操作后 force=true 必须强制拉取最新值。
    if (!force && sync.hasSnapshots() && state.plan) {
      publish({ loading: false })
      void sync.readHostSnapshots()
      return true
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
      publish({ plan: merged.plan, planStale: merged.stale, planError: false, loading: false, notice: '' })
      startPlanPolling()
      cache.persistCards(state)
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

  async function loadManaged(target, force = false) {
    const spec = providerById(target)?.snapshot
    if (disposed || !spec) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    const pendingMap = state.pending
    publish({ ...initial(target), ...sharedCards(), busy, pending: pendingMap, loading: !spec.ready(state),
      notice: busy ? state.notice : '' })
    if (!force && sync.hasSnapshots() && spec.ready(state)) {
      publish({ loading: false })
      void sync.readHostSnapshots()
      return true
    }
    try {
      const values = await Promise.all(spec.methods.map(method => request(method, { provider: target, ...(force ? { live: true } : {}) }, controller.signal)))
      if (disposed || current !== revision || controller.signal.aborted) return false
      const main = values[0]?.snapshot
      if (main?.at === null) {
        if (main.stale) publish({ loading: false, ...spec.readFailed?.(state) })
        return true
      }
      publish({ ...spec.fromRead(values, state), loading: false, notice: '' })
      cache.persistCards(state)
      return true
    } catch {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, ...spec.readFailed?.(state), notice: '读取失败。' })
      }
      return false
    }
  }

  async function readChannel(target, controller, selection) {
    const sides = modelProvidersOf(target)
    const started = Date.now()
    try {
      const results = await Promise.all([
        request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal),
        request('account.list', { provider: target }, controller.signal),
        ...sides.map(side => request('model.list', { provider: side }, controller.signal)),
        providerById(target)?.caps?.permanentLock ? request('credits.permanentLock', { provider: target }, controller.signal) : Promise.resolve({ locked: false }),
        ...sides.map(side => request('model.params', { provider: side }, controller.signal)),
      ])
      if (disposed || controller.signal.aborted) return false
      const [statuses, accounts] = results
      const modelValues = results.slice(2, 2 + sides.length)
      const lock = results[2 + sides.length]
      const paramValues = results.slice(3 + sides.length)
      const rows = accountsFrom(accounts, target)
      newestAccountRead.set(target, started)
      for (const side of sides) newestModelRead.set(side, started)
      newestStatusReadRef.current = started
      publish({
        accounts: rows,
        models: sides.flatMap((side, index) => modelsFrom(modelValues[index], side)),
        modelSource: { ...state.modelSource, ...Object.fromEntries(sides.flatMap((side, index) =>
          CACHE_MODEL_SOURCES.has(modelValues[index]?.source) ? [[side, modelValues[index].source]] : [])) },
        ...(target === 'qodercn' ? { qoderCatalogIssue: modelValues[0]?.issue ?? '' } : {}),
        statuses: statusFrom(statuses), locked: lock?.locked === true,
        params: Object.assign({}, ...sides.map((side, index) => paramsFrom(paramValues[index], side))),
        selected: rows.some(a => a.id === selection) ? selection : '', loading: false, loadFailed: false,
        notice: '',
      })
      cache.rememberChannel(target, state)
      cache.persistCards(state)
      return rows
    } catch {
      return undefined
    }
  }

  async function load(target = state.provider, autoBalance = true, force = false) {
    if (disposed || !allowed(target)) return false
    if (!sync.hasSnapshots()) sync.resetCursor()
    if (target === PLAN_PROVIDER_ID) return loadPlan(target, force)
    if (providerById(target)?.snapshot) return loadManaged(target, force)
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const same = target === state.provider
    const cachedEntry = cache.get(target)
    const unloaded = !state.accounts.length && !state.models.length && !state.balances.length
    const cached = !same || unloaded ? cachedEntry : null
    const selected = cached ? (cached.selected || '') : same ? state.selected : ''
    const busy = state.busy
    const pendingMap = state.pending
    const keep = same && !cached ? {
      accounts: state.accounts, models: state.models, params: state.params,
      locked: state.locked, balances: state.balances, modelSource: state.modelSource,
    } : cached ? {
      accounts: cached.accounts, models: cached.models, balances: cached.balances,
      params: cached.params, locked: cached.locked, modelSource: cached.modelSource,
    } : {}
    publish({
      ...initial(target), ...sharedCards(), ...keep, busy, pending: pendingMap, selected, login: loginFor(target), loading: true,
      notice: busy ? state.notice : cached || cachedEntry ? '' : initial(target).notice,
    })
    if (!same) { balanceController?.abort(); balanceController = null }
    let rows = await readChannel(target, controller, selected)
    const contradictory = () => {
      if (rows === undefined || !Array.isArray(rows) || rows.length > 0) return false
      const status = state.statuses?.[target]
      const enabled = status?.accounts && typeof status.accounts === 'object' ? status.accounts.enabled : status?.accounts
      return typeof enabled === 'number' && enabled > 0
    }
    const canRetry = (rows === undefined || contradictory()) && state.models.length === 0
    for (let attempt = 0; canRetry && (rows === undefined || contradictory()) && attempt < LOAD_RETRY_DELAYS_MS.length; attempt++) {
      await new Promise(resolve => { const timer = setTimeout(resolve, LOAD_RETRY_DELAYS_MS[attempt]); loginUrlTimers.add(timer) })
      if (disposed || current !== revision || controller.signal.aborted) return false
      rows = await readChannel(target, controller, selected)
    }
    if (rows === undefined || contradictory()) {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, loadFailed: true, notice: '读取失败，点「刷新」重试。' })
      }
      return false
    }
    if (rows === false) return false
    if (autoBalance && rows.length > 0 && !disposed) void refreshLatestBalances(target)
    return true
  }

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

  async function refreshCatalog(target, options = {}) {
    const silent = options.silent === true
    const channel = state.provider
    const scope = `models:${channel}`
    if (disposed || state.loading || pending.has(scope)) return false
    const sides = typeof target === 'string' && modelProvidersOf(channel).includes(target) ? [target] : modelProvidersOf(channel)
    if (!sides.length) return false
    const controller = new AbortController()
    writes.add(controller)
    const release = silent ? () => {} : pending.enter(scope)
    if (!silent) publish({ notice: '正在向上游拉取模型目录…' })
    try {
      const results = await Promise.allSettled(sides.map(side => request('model.refresh', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted) return false
      const sources = {}
      sides.forEach((side, index) => {
        const result = results[index]
        if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') return
        sources[side] = CACHE_MODEL_SOURCES.has(result.value.source) ? result.value.source : 'fallback'
      })
      const fresh = await Promise.all(sides.map(side => request('model.list', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted || state.provider !== channel) return false
      const refreshedAt = Date.now()
      for (const side of sides) newestModelRead.set(side, refreshedAt)
      const refreshed = new Map(sides.map((side, index) => [side, modelsFrom(fresh[index], side)]))
      publish({
        models: modelProvidersOf(channel).flatMap(side => refreshed.has(side)
          ? refreshed.get(side) : state.models.filter(model => model.provider === side)),
        ...(Object.keys(sources).length ? { modelSource: { ...state.modelSource, ...sources } } : {}),
        ...(silent ? {} : { notice: providerById(channel)?.caps?.cliCatalog && results[0]?.status === 'fulfilled' && sources[channel]
          ? '' : catalogNotice(sides, sources) }),
        ...(channel === 'qodercn' && results[0]?.status === 'fulfilled' ? { qoderCatalogIssue: results[0].value?.issue ?? '' } : {}),
      })
      cache.rememberChannel(channel, state)
      return true
    } catch {
      if (!silent && !disposed && !controller.signal.aborted && state.provider === channel) {
        publish({ notice: '模型目录刷新未完成，可稍后点「刷新目录」重试。' })
      }
      return false
    } finally {
      writes.delete(controller)
      release()
    }
  }

  function autoRefreshCatalog() {
    if (disposed || state.loading) return Promise.resolve(false)
    const channel = state.provider
    if (!packAllowed(channel) || providerById(channel)?.caps?.cliCatalog) return Promise.resolve(false)
    const sides = modelProvidersOf(channel)
    if (!sides.length || autoRefreshed.has(channel)) return Promise.resolve(false)
    if (sides.every(side => state.modelSource[side] === 'remote')) return Promise.resolve(false)
    autoRefreshed.add(channel)
    return refreshCatalog(undefined, { silent: true })
  }

  async function refreshBalances(target, controller, ticket = balanceRevision) {
    try {
      const value = await request('credits.balances', { provider: target }, controller.signal)
      if (value?.snapshot?.at === null) return
      if (disposed || controller.signal.aborted || target !== state.provider) return
      if (ticket !== balanceRevision) return
      publish({ balances: balancesFrom(value).map(balance => ({ ...balance, stale: balance.stale || value?.snapshot?.stale === true })) })
      cache.rememberChannel(target, state)
    } catch {
      if (!disposed && !controller.signal.aborted && target === state.provider && ticket === balanceRevision) {
        publish({ notice: '余额更新失败。' })
      }
    }
  }

  async function refreshLight(backgroundOnly = false) {
    if (disposed || state.busy) return false
    if (sync.hasSnapshots()) return sync.readHostSnapshots()
    if (backgroundOnly || state.loading) return false
    const target = state.provider
    if (target === PLAN_PROVIDER_ID || target === WORKBUDDY_ID || providerById(target)?.snapshot) return false
    const controller = new AbortController()
    sync.setLightController(controller)
    try {
      const statuses = await request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal)
      if (!disposed && !controller.signal.aborted) { publish({ statuses: statusFrom(statuses) }); cache.persistCards(state) }
    } catch { /* 静默：下一轮再试 */ }
    finally { sync.clearLightController(controller) }
    if (state.accounts.length > 0 && state.provider === target) void refreshLatestBalances(target)
    return true
  }

  async function refreshSettings(targetProvider = state.provider) {
    if (!sync.hasSnapshots()) return load()
    const target = targetProvider || state.provider
    if (state.loadFailed && target === state.provider) void load(target)
    try {
      await request('settings.refresh', { provider: target }, lifetime.signal)
      if (!disposed && (target === 'all' || state.provider === target)) publish({ notice: '已请求更新。' })
      return true
    } catch {
      if (!disposed && (target === 'all' || state.provider === target)) publish({ notice: '更新请求失败。' })
      return false
    }
  }

  function refreshLatestBalances(target) {
    balanceController?.abort()
    const controller = new AbortController()
    balanceController = controller
    return refreshBalances(target, controller, ++balanceRevision)
  }

  function scopeOf(method, payload, channel) {
    if (AUTOMATION_METHODS.has(method)) return 'automation'
    if (method.includes('Model') || method.startsWith('model.')) return `models:${payload?.provider || channel}`
    if (method.includes('login') || method.includes('Login') || method === 'account.create' || method === 'login.poll') return `login:${channel}`
    if (payload?.accountId) return `account:${payload.accountId}`
    if (method.endsWith('setEnabled') || method.endsWith('setKey') || method === 'credits.permanentLock') return `channel:${payload?.provider || channel}`
    return `channel:${channel}`
  }

  async function mutate(method, payload = {}, options = {}) {
    const channel = state.provider
    const scope = options.scope || scopeOf(method, payload, channel)
    // 同 scope 防重入；整页 loading 时不插队；不同 scope 可非阻塞并发（非独占）。
    if (disposed || state.loading || pending.has(scope)) return false
    const known = !!payload.accountId && (state.accounts.some(a => a.id === payload.accountId)
      || !!providerById(state.provider)?.managedAccount?.(state, payload.accountId))
    if (payload.accountId && !['account.create', 'login.poll'].includes(method) && !known) {
      publish({ notice: '账号已变化，请刷新后重试。' }); return false
    }
    const account = typeof payload.accountId === 'string'
      ? state.accounts.find(entry => entry.id === payload.accountId) : undefined
    const targetProvider = typeof payload.provider === 'string' ? payload.provider
      : account?.provider || state.provider
    writeRevision++
    const controller = new AbortController()
    writes.add(controller)
    const release = pending.enter(scope)
    publish({ notice: options.progress || '正在应用，请稍候…' })
    try {
      const result = await request(method, { provider: targetProvider, ...payload }, controller.signal)
      try { await options.result?.(result, targetProvider) }
      catch (error) {
        if (!disposed && state.provider === channel) publish({ notice: typeof error?.message === 'string' && error.message ? error.message : '操作未完成，请刷新确认状态后重试。' })
        return false
      }
      if (!disposed && state.provider === channel) {
        let reloaded = null
        if (options.refresh !== false) reloaded = await load(channel, false, true)
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
      release()
      if (!disposed && sync.hasSnapshots()) void sync.readHostSnapshots()
    }
  }

  async function planMutate(method, payload, options = {}) {
    const scope = options.scope || (method.includes('Model') ? `models:${PLAN_PROVIDER_ID}` : `channel:${PLAN_PROVIDER_ID}`)
    if (disposed || pending.has(scope) || state.loading || state.provider !== PLAN_PROVIDER_ID) return false
    const controller = new AbortController()
    planRevision++
    writeRevision++
    planController?.abort()
    planController = null
    writes.add(controller)
    const release = pending.enter(scope)
    publish({ notice: options.progress || '正在应用商汤设置…' })
    try {
      const result = await request(method, { provider: PLAN_PROVIDER_ID, ...payload }, controller.signal)
      if (disposed || state.provider !== PLAN_PROVIDER_ID) return true
      if (options.result) {
        options.result(result)
        cache.persistCards(state)
        publish({ notice: options.message || '商汤设置已保存。' })
      } else {
        const refreshed = await loadPlan(PLAN_PROVIDER_ID, true)
        if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: refreshed ? options.message || '商汤设置已保存。' : '设置已保存，但模型目录读取未完成。' })
      }
      return true
    } catch {
      if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: controller.signal.aborted ? '请求已取消。' : '商汤设置保存失败。' })
      return false
    } finally {
      writes.delete(controller)
      release()
      if (!disposed && sync.hasSnapshots()) void sync.readHostSnapshots()
    }
  }

  const store = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    isPending: scope => pending.has(scope),
    load,
    readHostSnapshots: () => sync.readHostSnapshots(),
    refreshSettings,
    refreshLight,
    prefetchCards: () => sync.prefetchCards(),
    refreshModels(target) { return refreshCatalog(target) },
    autoRefreshModels() { return autoRefreshCatalog() },
    ...Object.assign({}, ...PROVIDERS.map(item => item.createActions?.({
      getState: () => state, isDisposed: () => disposed, hasSnapshots: () => sync.hasSnapshots(),
      request, publish, mutate, planMutate, loadManaged, loginUrlTimers, writes,
      persistCards: () => cache.persistCards(state),
    }))),
    message(notice) { publish({ notice }) },
    async setAutomationConfig(patch) {
      if (disposed || pending.has('automation')) return false
      const controller = new AbortController()
      writes.add(controller)
      const release = pending.enter('automation')
      writeRevision++
      try {
        const value = await request('automation.setConfig', patch, controller.signal)
        if (!disposed) {
          const next = automationFrom(value)
          publish({ ...(next ? { automation: next } : {}), notice: '自动化设置已保存。' })
          if (sync.hasSnapshots()) void sync.readHostSnapshots()
        }
        return true
      } catch {
        if (!disposed) publish({ notice: '自动化设置保存失败。' })
        return false
      } finally {
        writes.delete(controller)
        release()
      }
    },
    async runAutomationTask(targetProvider, mode = 'claimRewards', accountId) {
      const target = targetProvider || state.provider
      const scope = `tasks:${target}:${mode}`
      if (disposed || pending.has(scope)) return false
      const controller = new AbortController()
      writes.add(controller)
      const release = pending.enter(scope)
      writeRevision++
      publish({ notice: mode === 'completeTasks' ? '正在执行自动任务…' : '正在领取奖励…' })
      try {
        const value = await request('automation.run', { provider: target, mode, ...(accountId ? { accountId } : {}) }, controller.signal)
        if (!disposed && state.provider === target) {
          const list = Array.isArray(value?.results) ? value.results : []
          const okCount = list.filter(r => ['claimed', 'completed'].includes(r.outcome?.kind)).length
          const doneCount = list.filter(r => r.outcome?.kind === 'done').length
          const label = mode === 'completeTasks' ? '任务执行' : '奖励领取'
          publish({ notice: `${label}：${okCount} 个新增，${doneCount} 个已完成。` })
          if (sync.hasSnapshots()) void sync.readHostSnapshots()
        }
        return true
      } catch {
        if (!disposed && state.provider === target) publish({ notice: mode === 'completeTasks' ? '任务执行未完成。' : '奖励领取未完成。' })
        return false
      } finally {
        writes.delete(controller)
        release()
      }
    },
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
      return mutate('account.reorder', { provider: account.provider || state.provider,
        orderedIds: [accountId, ...state.accounts.filter(a => a.id !== accountId).map(a => a.id)] })
    },
    requestDelete(accountId) {
      const account = state.accounts.find(a => a.id === accountId)
      const managed = providerById(state.provider)?.managedAccount?.(state, accountId)
      if (account || managed) publish({ pendingDelete: { accountId, nickname: account?.nickname ?? managed.name,
        provider: account?.provider || state.provider, nonce: ++confirmation } })
    },
    cancelDelete() { publish({ pendingDelete: null }) },
    confirmDelete(target) {
      const pendingDel = state.pendingDelete
      if (!pendingDel || !target || target.nonce !== pendingDel.nonce || target.accountId !== pendingDel.accountId || target.provider !== pendingDel.provider || target.provider !== state.provider) {
        publish({ notice: '删除确认已失效，请重新选择账号。' }); return Promise.resolve(false)
      }
      publish({ pendingDelete: null })
      const removeAction = providerById(target.provider)?.removeAction
      if (removeAction) return store[removeAction](target.accountId)
      return mutate('account.delete', { accountId: target.accountId }, { message: '账号已移除。' })
    },
    setEnabled(enabled, target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('provider.setEnabled', { provider: targetProvider, enabled: enabled === true })
    },
    toggleModel(key) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      return mutate(model.dead ? 'model.clearDead' : 'model.setDisabled',
        model.dead ? { provider: model.provider, modelId: model.id }
          : { provider: model.provider, modelId: model.id, disabled: !model.disabled })
    },
    setModels(disabled, target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.setAllDisabled', { provider: targetProvider, disabled: disabled === true })
    },
    resetModels(target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.resetDefaults', { provider: targetProvider }, { message: '已恢复推荐模型。' })
    },
    setModelParams(key, patch) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      const channel = state.provider
      return mutate('model.setParams', { provider: model.provider, modelId: model.id, params: patch }, {
        refresh: false, message: '模型参数已保存。',
        result(value) {
          if (state.provider === channel) publish({ params: { ...state.params, ...paramsFrom(value, model.provider) } })
          if (state.provider === channel) cache.rememberChannel(channel, state)
        },
      })
    },
    balances() {
      if (sync.hasSnapshots()) return refreshSettings()
      balanceController?.abort()
      balanceController = null
      const ticket = ++balanceRevision
      return mutate('credits.balances', {}, { refresh: false, progress: '正在查询余额…', message: '余额已更新。',
        result(value, target) {
          if (state.provider !== target || ticket !== balanceRevision) return
          publish({ balances: balancesFrom(value) })
          cache.rememberChannel(target, state)
        },
      })
    },
    claim() {
      if (providerById(state.provider)?.caps?.dailyReward === false) return Promise.resolve(false)
      const target = state.provider
      return mutate('credits.claimAll', {}, { refresh: false, progress: '正在领取每日额度…', message: value => claimMessage(value, target),
        async result(_value, targetProvider) { if (state.provider === targetProvider) await refreshLatestBalances(targetProvider) } })
    },
    onboarding(accountId) {
      const target = typeof accountId === 'string' && accountId !== '' ? accountId : state.selected
      if (!target || !providerById(state.provider)?.caps?.onboarding) { publish({ notice: '请选择账号。' }); return Promise.resolve(false) }
      if (!state.accounts.some(a => a.id === target)) { publish({ notice: '账号已变化，请刷新后重试。' }); return Promise.resolve(false) }
      return mutate('onboarding.claim', { accountId: target }, { refresh: false, progress: '正在领取任务奖励…',
        message: value => `任务领取：${Array.isArray(value?.claimed) ? value.claimed.length : 0} 项新增，${Array.isArray(value?.skipped) ? value.skipped.length : 0} 项已完成。`,
        async result(_value, targetProvider) { if (state.provider === targetProvider) await refreshLatestBalances(targetProvider) } })
    },
    lock(locked) { return mutate('credits.permanentLock', { locked: locked === true }) },
    startLogin() {
      const channel = state.provider
      const existing = loginFor(channel)
      if (existing) { publish({ login: existing, notice: '已有登录等待中，请继续完成。' }); return Promise.resolve(false) }
      const loginProvider = loginProviderOf(channel)
      return mutate('account.create', { provider: loginProvider }, { refresh: false, progress: '正在准备登录…', message: '登录地址已准备好，请点打开登录页面完成授权。',
        result(value) {
          if (typeof value?.accountId !== 'string') throw new Error('登录未准备好')
          const login = { accountId: value.accountId, url: safeLoginUrl(value.loginUrl), createdAt: Date.now() }
          logins.set(channel, login)
          if (state.provider === channel) publish({ login })
        },
      })
    },
    pollLogin() {
      const channel = state.provider
      const login = loginFor(channel)
      if (!login) { publish({ login: null, notice: '登录等待已结束，请重新添加账号。' }); return Promise.resolve(false) }
      let refreshed = null
      return mutate('login.poll', { provider: loginProviderOf(channel), accountId: login.accountId }, { refresh: false, progress: '正在检查登录…',
        message: value => !value?.done ? '尚未完成，请在登录页继续授权后再检查。'
          : !value.success ? '登录失败，请重新添加账号。'
            : refreshed === false ? '登录成功，但账号列表读取失败，请点「刷新」重试。'
              : '登录成功，账号列表已刷新。',
        async result(value) {
          if (!value?.done) return
          logins.delete(channel)
          if (state.provider !== channel) return
          publish({ login: null })
          if (value.success) refreshed = await load(channel, false, true)
        },
      })
    },
    forgetLogin() { logins.delete(state.provider); publish({ login: null, notice: '已结束等待；已打开的授权流程可能仍在进行。' }) },
    dispose() {
      if (disposed) return
      lifetime.abort()
      disposed = true; revision++
      readController?.abort()
      balanceController?.abort(); balanceController = null
      sync.abort()
      stopPlanPolling()
      if (typeof clearTimeout === 'function') for (const id of loginUrlTimers) clearTimeout(id)
      loginUrlTimers.clear()
      for (const controller of writes) controller.abort()
      writes.clear(); listeners.clear(); logins.clear(); autoRefreshed.clear()
      pending.clear()
      cache.clear()
    },
  }
  return store
}
