// 客户端轻量首屏恢复缓存：只用于冷启动秒开展示公开快照字段，权威数据与持久化仍在 Host 侧。
export function cacheStorage() {
  try { if (globalThis.localStorage) return globalThis.localStorage } catch { /* Storage unavailable. */ }
  try { if (globalThis.sessionStorage) return globalThis.sessionStorage } catch { /* Storage unavailable. */ }
  return null
}

export function restoredRouterState(provider, cache = readChannelCache(cacheStorage())) {
  const channel = cache?.channels[provider]
  const hasManaged = providerById(provider)?.rpcMethods === MANAGED_METHODS && !!cache?.managed?.[provider]
  return {
    ...initial(provider), ...channel, notice: '',
    loading: !channel && (packAllowed(provider) || !(provider === PLAN_PROVIDER_ID ? cache?.plan
      : provider === WORKBUDDY_ID ? cache?.workbuddy : hasManaged ? cache?.managed?.[provider] : cache?.apikeys?.[provider])),
    statuses: cache?.statuses ?? {},
    ...(cache?.apikeys ? { apikeys: cache.apikeys } : {}),
    ...(cache?.managed ? { managed: cache.managed } : {}),
    ...(cache?.plan ? { plan: cache.plan, planStale: !!cache.plan.catalogError } : {}),
    ...(cache?.workbuddy ? { workbuddy: cache.workbuddy, workbuddyReady: true } : {}),
  }
}

export function createClientCache(persisted) {
  const channelCache = new Map(Object.entries(persisted?.channels ?? {}))

  function persistCards(state) {
    writeChannelCache(cacheStorage(), Object.fromEntries(channelCache), state.statuses, {
      plan: state.plan,
      workbuddy: state.workbuddyReady ? state.workbuddy : null,
      apikeys: Object.fromEntries(Object.entries(state.apikeys ?? {}).filter(([, entry]) => entry?.ready === true)),
      managed: Object.fromEntries(Object.entries(state.managed ?? {}).filter(([, entry]) => entry?.ready === true)),
    })
  }

  function rememberChannel(provider, state) {
    if (!packAllowed(provider) || provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) return
    channelCache.set(provider, {
      accounts: state.accounts, models: state.models, balances: state.balances,
      params: state.params, locked: state.locked, modelSource: state.modelSource, selected: state.selected,
      at: Date.now(),
    })
    persistCards(state)
  }

  return {
    get: provider => channelCache.get(provider) ?? null,
    clear: () => channelCache.clear(),
    rememberChannel,
    persistCards,
  }
}
