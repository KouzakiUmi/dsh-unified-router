// Host 快照同步器：Client 只通过增量游标消费 Host 快照，与 Host 后台定时采集彻底解耦。
export function createHostSync({
  snapshotProviders, getState, isDisposed, request, publish, cache,
  getWriteRevision, getReadRevision, newestStatusReadRef, newestAccountRead,
}) {
  let snapshotProtocol = false
  let hostCursor = null
  let lightController = null
  let cardController = null

  function hasSnapshots() {
    return snapshotProtocol
  }

  function markSnapshotProtocol() {
    snapshotProtocol = true
  }

  function resetCursor() {
    hostCursor = null
  }

  async function readHostSnapshots() {
    if (lightController || isDisposed()) return false
    const controller = new AbortController()
    const mutation = getWriteRevision(), selection = getReadRevision()
    lightController = controller
    try {
      const result = await request('settings.snapshot', { cursor: hostCursor }, controller.signal)
      const state = getState()
      if (isDisposed() || mutation !== getWriteRevision() || selection !== getReadRevision() || state.busy) return false
      if (typeof result?.cursor !== 'string') return false
      snapshotProtocol = true
      hostCursor = result.cursor
      const snapshots = result.entries
      if (!snapshots) return true
      const get = (method, provider = state.provider) => snapshots?.[method === 'provider.status' ? method : `${provider}/${method}`]
      const status = get('provider.status')
      const accounts = get('account.list')
      const credits = get('credits.balances')
      const checkin = get('checkin.status', 'daily')
      const automation = get('automation.status', 'automation')
      const patch = {}
      if (checkin?.value) patch.checkin = checkin.value
      if (automation?.value) patch.automation = automationFrom(automation.value)
      if (status?.value && status.at >= newestStatusReadRef.current) patch.statuses = statusFrom(status.value)
      if (accounts?.value && accounts.at >= (newestAccountRead.get(state.provider) ?? 0) && (!state.loading || !state.accounts.length)) {
        patch.accounts = accountsFrom(accounts.value, state.provider)
      }
      if (credits?.value) patch.balances = balancesFrom(credits.value).map(balance => ({ ...balance, stale: credits.stale || balance.stale }))
      else if (credits?.stale) patch.balances = state.balances.map(balance => ({ ...balance, stale: true }))
      for (const provider of snapshotProviders) {
        Object.assign(patch, provider.snapshot.apply(method => get(method, provider.id), { ...state, ...patch }))
      }
      if (Object.keys(patch).length) {
        publish(patch)
        const next = getState()
        if (packAllowed(next.provider) && (accounts || credits)) cache.rememberChannel(next.provider, next)
        else cache.persistCards(next)
      }
      return true
    } catch { return false } finally {
      if (lightController === controller) lightController = null
    }
  }

  // 兼容未提供统一 settings.snapshot 的旧宿主或离线测试桩。
  async function prefetchCards() {
    if (isDisposed() || snapshotProtocol) return false
    const controller = new AbortController()
    const mutation = getWriteRevision()
    cardController?.abort()
    cardController = controller
    const state = getState()
    const missing = snapshotProviders.filter(provider => !provider.snapshot.ready(state))
    await Promise.all(missing.map(async ({ id, snapshot }) => {
      try {
        const values = await Promise.all(snapshot.methods.map(method => request(method, { provider: id }, controller.signal)))
        if (isDisposed() || controller.signal.aborted || mutation !== getWriteRevision() || values[0]?.snapshot?.at === null) return
        publish(snapshot.fromRead(values, getState()))
        cache.persistCards(getState())
      } catch { /* 下次切入时重试 */ }
    }))
    return missing.length > 0
  }

  function abort() {
    lightController?.abort()
    lightController = null
    cardController?.abort()
    cardController = null
  }

  return {
    hasSnapshots,
    markSnapshotProtocol,
    resetCursor,
    readHostSnapshots,
    prefetchCards,
    abort,
    isReadingLight: () => !!lightController,
    setLightController(controller) { lightController?.abort(); lightController = controller },
    clearLightController(controller) { if (lightController === controller) lightController = null },
  }
}
