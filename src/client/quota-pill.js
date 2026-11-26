function QuotaDetail({ detail }) {
  return h('div', { className: 'eac-quota-detail' },
    h('span', null, detail.label), h('strong', null, detail.value || '—'),
    detail.meter !== false && Number.isFinite(detail.fraction)
      ? quotaMeter(`${detail.label}剩余比例`, detail.fraction, 'eac-quota-track', quotaTone(detail.fraction)) : null,
    detail.note ? h('small', null, detail.note) : null,
    [[detail.reset, '重置'], [detail.expires, '到期'], [detail.cycleEnd, '周期结束']].map(([when, text]) =>
      displayTime(when) !== '—' ? h('small', { key: text }, `${text} ${displayTime(when)}${text === '到期' && detail.expiringAmount ? ` · ${detail.expiringAmount}` : ''}`) : null))
}

const quotaMeter = (label, value, className, tone) => h('progress', { max: 1, value, className, 'aria-label': label, 'data-tone': tone })
const quotaTone = fraction => fraction === null ? 'neutral' : fraction === 0 ? 'danger' : fraction <= .2 ? 'warn' : 'success'
const quotaAmountText = row => row.money ? apikeyMoney(row.amount, 'CNY') : quotaValue(row.amount, row.unit)

// 收起态迷你余量条（与 dsh-subusage 药丸同款）：一个窗口一根，
// 各按该窗口自身档位着色；根数越多条越细。窗口名与枚举进悬浮提示。
function quotaMiniBars(metrics) {
  return h('span', { className: 'eac-quota-mini', 'data-count': String(metrics.length), 'aria-hidden': true },
    metrics.map((metric, i) => {
      const value = Math.max(0, Math.min(1, metric.fraction))
      return h('span', { key: i, className: 'eac-quota-bar', 'data-tone': quotaTone(metric.fraction) },
        h('span', { className: 'eac-quota-bar-fill', style: { width: `${Math.round(value * 1000) / 10}%`, minWidth: value > 0 ? 3 : 0 } }))
    }))
}

function QuotaAccount({ row, titled, badge, stale }) {
  const planBadge = badge || row.plan
  return h('section', { className: 'eac-quota-account' },
    titled ? h('header', null, h('strong', null, row.label), planBadge ? h('span', { className: 'eac-quota-plan' }, planBadge) : null) : null,
    h('div', { className: 'eac-quota-group', 'aria-label': '额度明细' },
      row.amount !== null ? QuotaDetail({ detail: { label: row.money ? '控制台余额' : '剩余额度', value: quotaAmountText(row) } }) : null,
      row.details.map((detail, i) => h(QuotaDetail, { key: i, detail })),
      row.amount === null && !row.details.length ? h('span', { className: 'eac-quota-status' }, stale ? '额度读取失败' : '暂无适用额度数据') : null))
}

function QuotaAccountList({ rows, accountMetrics, activeId, viewedId, onView }) {
  return h('div', { className: 'eac-quota-account-list', role: 'group', 'aria-label': '账号明细' },
    rows.map(row => {
      const { summary, windowSummary, tight, tone } = accountMetrics.get(row)
      const pressed = activeId === row.id
      return h('button', { key: row.id, type: 'button', className: 'eac-quota-account-row', 'aria-pressed': pressed,
        'data-tone': row.stale ? 'neutral' : quotaTone(tone ?? tight), title: [row.label, windowSummary].filter(Boolean).join(' · '),
        onClick: () => onView(row.id === viewedId ? '' : row.id) },
        // 账号身份信息（名称 + 订阅类型）必须可见：它解释「哪些账号能调用订阅限定模型」。
        h('span', null, row.label,
          row.plan ? h('span', { className: 'eac-quota-plan', style: { marginLeft: '6px' } }, row.plan) : null),
        h('strong', null, summary || '暂无额度'))
    }))
}

function QuotaPill({ provider, route, store, sessionId, model, call }) {
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panelId = `eac-quota-${React.useId()}`
  const [open, setOpen] = React.useState(false)
  const [selection, setSelection] = React.useState(null)
  const [viewedId, setViewedId] = React.useState('')
  const [refreshVersion, refreshRoute] = React.useState(0)
  React.useEffect(() => {
    if (!sessionId || !model || !call || route.type === 'api' || route.type === 'plan') return
    let running = null, alive = true
    const read = async () => {
      if (!alive || running || globalThis.document?.hidden) return
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), 8_000)
      running = controller
      try {
        const reply = await call('quota.account', { provider, model, sessionId }, controller.signal)
        if (alive) setSelection(!controller.signal.aborted && reply?.ok === true && typeof reply.value?.accountId === 'string' ? reply.value : null)
      } catch { if (alive) setSelection(null) }
      finally { clearTimeout(deadline); running = null }
    }
    const timer = setInterval(read, 5_000)
    globalThis.document?.addEventListener?.('visibilitychange', read)
    void read()
    return () => { alive = false; clearInterval(timer); running?.abort(); globalThis.document?.removeEventListener?.('visibilitychange', read) }
  }, [sessionId, provider, model, call, route.type, refreshVersion, open])
  const { rows, serving, viewed, pool, showPool, accountMetrics, summary, windowSummary, tight, tone: pillTone, metrics, at, stale, detailStale, empty } = quotaPillData(provider, route.type, snapshot, selection, viewedId, model)
  const tone = quotaTone(pillTone ?? tight)
  const detailMetric = accountMetrics.get(viewed)
  const detailTone = quotaTone(detailMetric?.tone ?? detailMetric?.tight ?? null)
  const headline = viewed && detailStale && (viewed.amount !== null || viewed.details.length) ? '显示上次结果' : ''
  const label = summary || '额度'
  const tip = [route.title, label, serving?.label,
    metrics.length === 1 ? metrics[0]?.label : windowSummary,
    showPool && pool?.hasPackages ? pool.splitText : '',
    stale && summary ? '额度数据有更新延迟' : ''].filter(Boolean).join(' · ')
  const other = serving ? rows.filter(row => row !== serving) : rows
  const activeId = viewed?.id ?? ''
  const list = rows.length > 1 ? QuotaAccountList({ rows: other, accountMetrics, activeId, viewedId, onView: setViewedId }) : null
  const viewedBadge = !serving && viewed
    ? [viewedId && viewedId !== rows[0]?.id ? '查看中' : rows.length > 1 ? '当前账号' : '', viewed.plan].filter(Boolean).join(' · ')
    : viewed?.plan
  return h('span', { className: 'eac-quota-pill', 'data-tone': tone },
    h('button', { className: 'eac-quota-trigger', type: 'button', popoverTarget: panelId,
      'aria-label': tip, 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': panelId,
      'data-stale': !!summary && stale, title: tip },
    metrics.length ? quotaMiniBars(metrics) : null,
    h('span', { className: 'eac-quota-trigger-text' }, label)),
    h('div', { className: 'eac-quota-popover', id: panelId, popover: 'auto', role: 'dialog', 'aria-label': `${route.title}额度详情`, 'data-tone': detailTone,
      onToggle: event => {
        const next = event.nativeEvent?.newState === 'open' || event.currentTarget.matches(':popover-open')
        setOpen(next)
        if (!next) setViewedId('')
      } },
      h('header', { className: 'eac-quota-header' },
        h('strong', null, route.title), viewed?.plan && viewed === serving ? h('span', { className: 'eac-quota-plan' }, viewed.plan) : null),
      serving ? QuotaDetail({ detail: {
        label: selection?.live === true ? '当前调用账号' : '最近调用账号', value: serving.label,
      } }) : null,
      showPool ? h('section', { className: 'eac-quota-account' },
        h('header', null, h('strong', null, '账号池总积分'), rows.length > 1 ? h('span', { className: 'eac-quota-plan' }, `${rows.length} 个账号`) : null),
        h('div', { className: 'eac-quota-group', 'aria-label': '账号池总积分明细' },
          QuotaDetail({ detail: { label: '总积分', value: quotaValue(pool.total, pool.unit) } }),
          pool.hasPackages ? QuotaDetail({ detail: { label: '临时额度', value: quotaValue(pool.temporary, pool.unit) } }) : null,
          pool.hasPackages ? QuotaDetail({ detail: { label: '永久额度', value: quotaValue(pool.permanent, pool.unit) } }) : null)) : null,
      headline ? h('p', { className: 'eac-quota-status', 'data-stale': detailStale || !viewed, role: 'status' }, headline) : null,
       viewed ? h(QuotaAccount, { row: viewed, titled: viewed !== serving && route.type !== 'api', badge: viewedBadge, stale: detailStale })
        : !rows.length ? h('p', { className: 'eac-quota-status', role: 'status' }, empty) : null,
      serving && list ? h('details', { className: 'eac-quota-others', key: serving.id },
        h('summary', null, `其他账号 · ${other.length}`), list) : list,
      h('footer', { className: 'eac-quota-footer' },
        h('span', null, at ? `更新于 ${displayTime(at)}` : ''),
        h('button', { type: 'button', className: 'eac-button', onClick: () => { store.refresh(); refreshRoute(v => v + 1) }, disabled: snapshot.loading || snapshot.refreshing },
           snapshot.refreshing ? '读取中…' : snapshot.failed ? '重试' : '重新读取'))))
}

function QuotaPillEntry({ directory, storeFor, sessionId, call }) {
  const subscribe = React.useCallback(notify => directory.subscribe(notify), [directory])
  const read = React.useCallback(() => directory.getSnapshot(), [directory])
  const state = React.useSyncExternalStore(subscribe, read, read)
  const provider = state?.current?.provider
  const model = state?.current?.model
  const route = model ? quotaRoute(provider) : null
  return route ? h(QuotaPill, { key: `${sessionId}:${provider}:${model}`, sessionId, model, call, provider, route, store: storeFor(route) }) : null
}

function registerQuotaPill(ctx) {
  if (typeof ctx.inject !== 'function') return
  const call = (method, payload, signal) => ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal)
  const storeFor = createQuotaSnapshotStore(call)
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'unified-router-quota', order: 1001,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, storeFor, sessionId, call }),
    }, QuotaPillEntry)), 'unified-router: quota pill')
  })
}
