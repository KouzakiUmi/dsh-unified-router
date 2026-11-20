const LAST_PROVIDER_KEY = 'eac-unified-router-last-provider'

function rememberedProvider() {
  try {
    const saved = globalThis.localStorage?.getItem(LAST_PROVIDER_KEY) ?? globalThis.sessionStorage?.getItem(LAST_PROVIDER_KEY)
    if (allowed(saved)) return saved
  } catch { /* Storage unavailable. */ }
  return PROVIDERS[0].id
}

function tabKeys(event, index, ids, activate) {
  const last = ids.length - 1
  const next = {
    ArrowLeft: (index + last) % ids.length,
    ArrowRight: (index + 1) % ids.length,
    Home: 0,
    End: last,
  }[event.key]
  if (typeof next !== 'number') return
  event.preventDefault()
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus()
  activate(ids[next])
}

const panelsFor = id => {
  const available = providerById(id)?.panelIds
  return available ? SETTINGS_PANELS.filter(panel => available.includes(panel.id)) : SETTINGS_PANELS
}

export function Settings({ ctx }) {
  const storeRef = React.useRef(null)
  const [state, setState] = React.useState(() => restoredRouterState(rememberedProvider()))
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [enabledFirst, setEnabledFirst] = React.useState(true)
  const [selection, setSelection] = React.useState({ provider: state.provider, panel: panelsFor(state.provider)[0].id })
  const [more, setMore] = React.useState({})
  const [drafts, setDrafts] = React.useState({})
  const [editParams, setEditParams] = React.useState('')
  const [importOpen, setImportOpen] = React.useState('')
  const panels = panelsFor(state.provider)
  const panel = selection.provider === state.provider && panels.some(item => item.id === selection.panel) ? selection.panel : panels[0].id
  const setPanel = (tab, open) => {
    setSelection({ provider: state.provider, panel: tab })
    if (open) setMore(previous => ({ ...previous, [`${state.provider}:channel:${open}`]: true }))
  }
  React.useEffect(() => installStyles(), [])
  React.useEffect(() => {
    const store = createRouterStore((method, payload, signal) =>
      ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal), rememberedProvider())
    storeRef.current = store
    const unsubscribe = store.subscribe(setState)
    void store.load(rememberedProvider())
    void store.readHostSnapshots().then(found => { if (!found) void store.prefetchCards() })
    return () => { unsubscribe(); store.dispose(); if (storeRef.current === store) storeRef.current = null }
  }, [ctx])
  React.useEffect(() => { setQuery(''); setPage(0); setEditParams('') }, [state.provider])
  React.useEffect(() => {
    if (panel === 'models') void storeRef.current?.autoRefreshModels()
  }, [panel, state.provider, state.loading])
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof globalThis.setInterval !== 'function') return
    let ticks = 0
    const tick = (backgroundOnly = false) => {
      if (document.hidden) return
      const store = storeRef.current
      void store?.refreshLight(backgroundOnly)
      if (!backgroundOnly) void store?.prefetchCards()
    }
    const timer = globalThis.setInterval(() => tick(++ticks % 12 !== 0), 5000)
    const onVisible = () => tick()
    document.addEventListener?.('visibilitychange', onVisible)
    globalThis.addEventListener?.('focus', onVisible)
    return () => {
      globalThis.clearInterval?.(timer)
      document.removeEventListener?.('visibilitychange', onVisible)
      globalThis.removeEventListener?.('focus', onVisible)
    }
  }, [])
  const invoke = (method, ...args) => storeRef.current?.[method](...args)
  const act = (method, ...args) => {
    if (method === 'toggleParams') return setEditParams(previous => previous === args[0] ? '' : args[0])
    if (method === 'toggleMore') return setMore(previous => ({ ...previous, [args[0]]: !previous[args[0]] }))
    if (method === 'toggleImportForm') return setImportOpen(previous => previous === args[0] ? '' : (args[0] || ''))
    void invoke(method, ...args)
  }
  function selectProvider(id) {
    try { globalThis.localStorage?.setItem(LAST_PROVIDER_KEY, id) } catch { /* Storage unavailable. */ }
    setQuery(''); setPage(0); setEditParams(''); setImportOpen(''); setSelection({ provider: id, panel: panelsFor(id)[0].id })
    void invoke('load', id)
  }
  const provider = providerById(state.provider)
  const status = provider.statusFrom(state)
  const disabled = state.busy || state.loading
  const isPending = scope => !!(scope ? state.pending?.[scope] : state.busy)
  const toneFor = value => value?.tone ?? (value ? value.closed || value.accounts === 0 ? 'warn' : 'success' : undefined)
  const statusLabel = status?.label ?? (status ? status.closed ? '渠道已关闭'
    : status.accounts === 0 ? (status.totalAccounts > 0 ? '账号已停用' : '待添加账号') : '渠道运行中'
    : state.loading ? '读取中…' : '状态未知')
  const ui = { providerId: provider.id, invoke, act, disabled, isPending, loading: state.loading,
    failed: state.loadFailed || provider.snapshot?.failed(state), importOpen,
    query, setQuery, page, setPage, enabledFirst, setEnabledFirst, more, drafts, setDrafts, editParams, setPanel }
  return h('div', { className: 'eac-settings' },
    h('nav', { className: 'eac-providers', role: 'tablist', 'aria-label': '选择渠道' },
      ...PROVIDERS.map((item, index) => {
        const value = item.statusFrom(state)
        const selected = state.provider === item.id
        return h('button', { key: item.id, type: 'button', role: 'tab', className: 'eac-provider',
          'aria-selected': selected, tabIndex: selected ? 0 : -1, 'aria-label': `切换到 ${item.title}`,
          onClick: () => { if (!selected) selectProvider(item.id) },
          onKeyDown: event => tabKeys(event, index, PROVIDERS.map(value => value.id), id => { if (id !== state.provider) selectProvider(id) }) },
          h('span', { className: 'eac-provider-name' }, item.title),
          h('span', { className: 'eac-provider-meta' },
            h('span', { className: 'eac-provider-dot', 'data-tone': toneFor(value) }),
            value ? value.cardMeta ?? (value.closed ? '已关闭' : `${value.totalAccounts ?? value.accounts ?? '—'} 账号 · ${value.models ?? '—'} 模型`) : '待读取'))
      })),
    h('div', { className: 'eac-workspace', 'data-panel': panel },
      h('header', { className: 'eac-header' },
        h('h2', { className: 'eac-title' }, provider.title),
        h('div', { className: 'eac-header-actions' },
          h('span', { className: 'eac-status-chip', 'data-tone': toneFor(status) }, statusLabel),
          provider.panelIds || panel === 'models' ? null : button('刷新', () => act('refreshSettings'), state.busy, { 'aria-label': '刷新账号与额度' }))),
      h('div', { className: 'eac-panels', role: 'tablist', 'aria-label': '设置分区' },
        ...panels.map((item, index) =>
          h('button', { key: item.id, id: `eac-tab-${item.id}`, type: 'button', role: 'tab', className: 'eac-panel-tab',
            'aria-selected': panel === item.id, tabIndex: panel === item.id ? 0 : -1, 'aria-controls': `eac-panel-${item.id}`,
            onKeyDown: event => tabKeys(event, index, panels.map(value => value.id), setPanel),
            onClick: () => setPanel(item.id) }, item.label))),
      h('div', { className: 'eac-panel-body', role: 'tabpanel', id: `eac-panel-${panel}`, 'aria-labelledby': `eac-tab-${panel}` },
        state.notice ? h('div', { className: 'eac-notice', role: 'status', 'aria-live': 'polite' },
          h('p', null, state.notice),
          h('button', { type: 'button', className: 'eac-notice-close', 'aria-label': '关闭提示', onClick: () => act('message', '') }, '×')) : null,
        renderSettingsPanel(panel, provider, state, ui)))
  )
}

export function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'unified-router', order: 23, label: 'Unified Router', inject: () => ({ ctx }) }, Settings))
}
