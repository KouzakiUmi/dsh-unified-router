// 设置页和输入栏共用档位逻辑，外观与键盘交互沿用 OpenDesign CoRouter。
// **默认**上下文档位（渠道没有自己声明时用这张表）。
// 渠道差异不写进这张表：各渠道有自己的档位口径，经 `caps.contextTiers` 声明，
// 见 `contextWindowTiers` 的第二个参数。
const CONTEXT_WINDOWS = Object.freeze([
  { label: '256K', tokens: 256_000, nativeMax: 262_144 },
  { label: '500K', tokens: 500_000, nativeMax: 524_288 },
  { label: '1M', tokens: 1_000_000, nativeMax: 1_048_576 },
])

/**
 * 上下文窗口档位。
 *
 * @param capacity 渠道给的当前生效窗口。
 * @param declared 渠道自己声明的档位（`caps.contextTiers`），如 Qoder 的
 *   `200K/400K/1M`。**没声明就用默认表** —— 全局表不该被某个渠道的口径改写。
 */
function contextWindowTiers(capacity, declared) {
  const known = modelTokenValue(capacity)
  const table = Array.isArray(declared) && declared.length > 0
    ? declared.slice().sort((a, b) => a.tokens - b.tokens)
    : CONTEXT_WINDOWS
  const native = known && table.find(tier => capacity === tier.tokens
    || (capacity >= tier.tokens && capacity <= (tier.nativeMax ?? tier.tokens)))
  // 最后一段永远是恢复渠道原值。原值处在标准档位时合并，避免「默认 1M / 1M」。
  return [
    ...table.slice(0, -1).filter(tier => known && capacity > (tier.nativeMax ?? tier.tokens)),
    { label: native?.label ?? '默认', tokens: known ? capacity : null, restore: true },
  ]
}

function moveContextFocus(event) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button[data-tier]:not(:disabled)'))
  const index = buttons.indexOf(event.target)
  if (index < 0) return
  const last = buttons.length - 1
  const next = { ArrowRight: (index + 1) % buttons.length, ArrowDown: (index + 1) % buttons.length,
    ArrowLeft: (index + last) % buttons.length, ArrowUp: (index + last) % buttons.length, Home: 0, End: last }[event.key]
  if (typeof next !== 'number') return
  event.preventDefault()
  buttons[next].focus()
}

function ContextSegments({ capacity, override, reserve, disabled, busy, tiers: declared, onChange }) {
  const tiers = contextWindowTiers(capacity, declared)
  const custom = isCustomContext(override, tiers)
  const limitNote = modelTokenValue(reserve) && tiers.some(tier => modelTokenValue(tier.tokens) && tier.tokens <= reserve)
    ? `输出预留 ${formatTokens(reserve)}，部分档位需要更大的窗口` : undefined
  const segments = tiers.map(({ label, tokens, restore }) => {
    const selected = restore ? !modelTokenValue(override) || override === tokens : override === tokens
    const conflict = modelTokenValue(reserve) && modelTokenValue(tokens) && tokens <= reserve
    const description = restore ? (label === '默认' ? '默认上下文' : `默认上下文 ${label}`) : `上下文 ${label}`
    const writable = !selected || restore && modelTokenValue(override)
    return h('button', {
      key: label, type: 'button', className: 'eac-context-segment', 'aria-pressed': selected, 'data-tier': label,
      'aria-label': description, disabled: disabled || busy || conflict, 'aria-disabled': !writable || undefined,
      tabIndex: tiers.length === 1 && !writable ? -1 : undefined,
      title: conflict ? `输出预留 ${formatTokens(reserve)}，需要更大窗口`
        : tokens ? `${description} · ${tokens.toLocaleString('zh-CN')} tokens（输入与输出合计）` : description,
      onClick: event => { if (!disabled && !busy && !conflict && writable) onChange(restore ? null : tokens, event) },
    }, label)
  })
  return h('span', { className: 'eac-context-control' },
    h('span', { className: 'eac-context-caption' }, '上下文'),
    custom ? h('span', { className: 'eac-context-note', title: `${override.toLocaleString('zh-CN')} tokens` }, `自定义 ${formatTokens(override)}`) : null,
    h('span', { className: 'eac-context-tiers', role: 'group', 'aria-label': '上下文窗口',
      'aria-busy': busy || undefined, 'aria-description': limitNote, title: limitNote, onKeyDown: moveContextFocus }, ...segments))
}

function isCustomContext(override, tiers) {
  return modelTokenValue(override) && !tiers.some(tier => tier.tokens === override)
}

function ContextWindowField(props) {
  return h('div', { className: 'eac-param-group' }, ContextSegments(props))
}

// 会话快捷档位只读宿主快照，只写上下文，不覆盖同模型其它参数。
const CONTEXT_RPC = Object.freeze({
  pack: ['model.list', 'model.setParams'],
  plan: ['plan.snapshot', 'plan.setModelParams'],
  workbuddy: ['workbuddy.models', 'workbuddy.setModelParams'],
  apikey: ['apikey.snapshot', 'apikey.setModelParams'],
  managed: ['managed.models', 'managed.setModelParams'],
})

function pillKindFor(provider) {
  if (packAllowed(provider)) return 'pack'
  if (provider === PLAN_PROVIDER_ID) return 'plan'
  if (provider === WORKBUDDY_ID) return 'workbuddy'
  const methods = providerById(provider)?.snapshot?.methods
  if (methods?.includes('apikey.snapshot')) return 'apikey'
  if (methods?.includes('managed.snapshot')) return 'managed'
  return null
}

async function readContextPill(call, kind, provider, modelId, signal) {
  const [resource] = CONTEXT_RPC[kind]
  const [catalog, params] = await Promise.all([
    call(resource, { provider, snapshot: true }, signal),
    kind === 'pack' ? call('model.params', { provider }, signal) : null,
  ])
  if (catalog?.ok !== true || (kind === 'pack' && params?.ok !== true)) throw new Error('模型参数读取失败')
  if (kind === 'pack' && params.value?.contextQuickWrite !== true) return null
  const rows = catalog.value?.models
  if (!Array.isArray(rows)) throw new Error('模型目录待读取')
  const row = rows.find(entry => entry?.id === modelId)
  if (!row) return null
  const options = (kind === 'pack' ? params.value?.params?.[modelId] : row.params) ?? {}
  const declared = kind === 'pack' ? row.contextWindow : row.defaultContextWindow ?? row.contextWindow
  const capacity = modelTokenValue(declared) ? declared : null
  const reserve = options.maxTokens ?? row.defaultMaxOutputLength ?? row.defaultMaxTokens ?? row.maxOutputLength
  const override = modelTokenValue(options.contextWindow) ? options.contextWindow : null
  return { capacity, reserve: modelTokenValue(reserve) ? reserve : null, override }
}

function ContextTierControl({ call, kind, provider, modelId, selecting, directoryModels }) {
  const [view, setView] = React.useState(null)
  const [attempt, setAttempt] = React.useState(0)
  const [readError, setReadError] = React.useState(false)
  const [feedback, setFeedback] = React.useState(null)
  const [pending, setPending] = React.useState(undefined)
  const busy = pending !== undefined
  const writer = React.useRef(null)
  const section = React.useRef(null)
  const restoreFocus = React.useRef(null)
  React.useEffect(() => () => writer.current?.abort(), [])
  React.useEffect(() => {
    if (busy || selecting || !restoreFocus.current) return
    const target = restoreFocus.current
    restoreFocus.current = null
    const root = section.current
    const doc = root?.ownerDocument
    if (doc && (doc.activeElement === doc.body || root.contains(doc.activeElement))) target.focus()
  }, [busy, selecting])
  React.useEffect(() => {
    const operation = new AbortController()
    void readContextPill(call, kind, provider, modelId, operation.signal).then(next => {
      if (!operation.signal.aborted && !writer.current) { setView(next); setReadError(false) }
    }, () => { if (!operation.signal.aborted && !writer.current) setReadError(true) })
    return () => operation.abort()
  }, [call, kind, provider, modelId, attempt, directoryModels])

  const retry = () => { setReadError(false); setAttempt(n => n + 1) }

  const retryButton = readError ? h('button', { type: 'button', className: 'eac-context-retry', onClick: retry }, '重试读取模型信息') : null
  if (!view) return retryButton ? h('span', { className: 'eac-context-pill' }, retryButton) : null
  if (!view.capacity && view.override === null) return null
  const select = async (tokens, event) => {
    if (writer.current || busy || selecting || view.override === tokens) return
    const target = event?.currentTarget
    if (target && target.ownerDocument?.activeElement === target) restoreFocus.current = target
    const operation = new AbortController()
    writer.current = operation
    const { signal } = operation
    setPending(tokens)
    setFeedback(null)
    try {
      const result = await call(CONTEXT_RPC[kind][1], {
        provider, modelId, params: { contextWindow: tokens },
        ...(kind === 'pack' ? { contextOnly: true } : {}),
      }, signal)
      if (signal.aborted) return
      if (result?.ok !== true) throw new Error('模型参数保存失败')
      setView({ ...view, override: tokens })
      setFeedback({ text: '上下文设置已保存' })
    } catch {
      if (!signal.aborted) setFeedback({ error: true, text: '保存失败 · 可重试' })
    } finally {
      writer.current = null
      if (!signal.aborted) setPending(undefined)
    }
  }
  const error = feedback?.error === true
  const shown = busy ? pending : view.override
  const custom = isCustomContext(shown, contextWindowTiers(view.capacity))
  return h('span', { className: 'eac-context-pill', ref: section, 'data-disabled': busy || selecting,
    'data-error': error, 'data-error-message': error ? feedback.text : undefined,
    title: error ? feedback.text : custom ? `自定义 ${shown.toLocaleString('zh-CN')} tokens` : '此模型的上下文设置在会话间共享' },
    ContextSegments({ ...view, override: shown, busy, disabled: selecting, onChange: select }), retryButton,
    busy || feedback ? h('span', { className: 'eac-context-feedback', role: error ? 'alert' : 'status' },
      busy ? '正在保存上下文设置…' : feedback.text) : null)
}

function ContextTierPill({ directory, call, sessionId }) {
  const subscribe = React.useCallback(listener => directory.subscribe(listener), [directory])
  const getSnapshot = React.useCallback(() => directory.getSnapshot(), [directory])
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const provider = state?.current?.provider
  const modelId = state?.current?.model
  const kind = pillKindFor(provider)
  if (!kind || typeof modelId !== 'string' || !modelId) return null
  return h(ContextTierControl, {
    key: JSON.stringify([sessionId, provider, modelId]), call, kind, provider, modelId,
    selecting: state.status === 'selecting' || state.pending != null, directoryModels: state.groups,
  })
}

export function registerContextPill(ctx) {
  if (typeof ctx.inject !== 'function') return
  const call = (method, payload, signal) => ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal)
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'unified-router-context-tier', order: 8,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, call, sessionId }),
    }, ContextTierPill)), 'unified-router: context tier pill')
  })
}
