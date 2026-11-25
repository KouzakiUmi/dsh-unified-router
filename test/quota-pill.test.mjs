import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createQuotaCallAccounts } from '../lib/quota-call-account.js'
import { publicResult } from '../lib/web-host.js'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  .replace('return { name: \'dsh-unified-router\'', 'return { quotaPillData, quotaRoute, createQuotaSnapshotStore, displayCreditPackages, balancesFrom, name: \'dsh-unified-router\'')
let plugin
const React = { createElement: (type, props, ...children) => ({ type, props, children }),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useCallback: fn => fn,
  useId: () => 'fixture', useState: initial => [initial, () => {}], useEffect() {} }
vm.runInNewContext(source, { AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL,
  window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } } })
const { quotaPillData, quotaRoute, createQuotaSnapshotStore } = plugin
const data = (id, ...entries) => quotaPillData(id, quotaRoute(id).type, { entries, failed: false, loading: false })
const modelData = (id, model, ...entries) => quotaPillData(id, quotaRoute(id).type, { entries }, null, '', model)
const tick = () => new Promise(resolve => setImmediate(resolve))

test('请求账号按会话和模型隔离，实际重试覆盖初选，关闭转为最近调用', async () => {
  const accounts = createQuotaCallAccounts(new Set(['raccoon']))
  const first = { sessionId: 'session-a', provider: 'raccoon', model: 'm' }
  const second = { ...first, sessionId: 'session-b' }
  const stream = (route, id) => accounts.track(route, async function* () {
    await tick()
    accounts.note('raccoon', id, 'm')
    yield 1
    accounts.note('raccoon', id + '-retry', 'm')
    yield 2
  })
  const a = stream(first, 'account-a'), b = stream(second, 'account-b')
  await Promise.all([a.next(), b.next()])
  assert.deepEqual(accounts.read(first), { accountId: 'account-a', live: true })
  assert.deepEqual(accounts.read(second), { accountId: 'account-b', live: true })
  assert.equal(accounts.read({ ...first, model: 'other' }), null)
  accounts.note('raccoon', 'background', 'm')
  await a.next()
  assert.deepEqual(accounts.read(first), { accountId: 'account-a-retry', live: true })
  await Promise.all([a.return(), b.return()])
  assert.deepEqual(accounts.read(first), { accountId: 'account-a-retry', live: false })
  assert.deepEqual(accounts.read(second), { accountId: 'account-b', live: false })
  const background = stream({ ...first, purpose: 'session-title' }, 'title-account')
  await background.next(); await background.return()
  assert.equal(accounts.read(first).accountId, 'account-a-retry')
  // 粘滞（缓存优先）记录：只记前台实际服务账号；后台用途与未知渠道不进记录。
  assert.equal(accounts.lastFor('raccoon', 'm'), 'account-a-retry')
  assert.equal(accounts.lastFor('raccoon', 'other'), null)
  assert.equal(accounts.lastFor('unisound', 'm'), null)
  assert.equal(accounts.lastFor('raccoon', ''), null)
})

test('额度药丸用当前 provider，区分 0、未知和实际额度资源', () => {
  let pill
  const slots = { inject: (_, fn) => fn(), register: (spec, view) => { if (spec.id === 'unified-router-quota') pill = { spec, view } } }
  let current = { provider: 'external', model: 'm' }
  const store = { getSnapshot: () => ({ current }), subscribe: () => () => {} }
  plugin.apply({ slots, connection: { rpc: { call: () => assert.fail('渲染不得触发上游访问') } },
    inject: (_services, fn) => fn({ slots, effect: fn => fn(), modelDirectories: { directoryFor: () => ({ store }) } }) })
  assert.equal(pill.spec.name, 'conversation.input.right')
  const render = () => pill.view(pill.spec.inject('fixture-session'))
  assert.equal(render(), null)
  current = { provider: 'doubaowork', model: '9' }
  assert.equal(render(), null)
  current = { provider: 'sensenova-token-plan', model: 'm' }
  assert.equal(render().props.route.type, 'plan')
  current = { provider: 'codearts', model: 'm' }
  assert.equal(render().props.route.type, 'managed')
  current = { provider: 'unisound', model: 'm' }
  const next = render()
  assert.equal(next.props.route.type, 'api')
  const view = next.type(next.props)
  assert.equal(view.children[0].props.popoverTarget, view.children[1].props.id)
  assert.equal(view.children[1].props.popover, 'auto')
  assert.equal(view.children[1].props.role, 'dialog')
  assert.equal(view.children[0].children[1].children[0], '额度')
  assert.match(view.children[0].props['aria-label'], /^云知声 · 额度/)
  assert.equal(data('unisound', { value: { quota: { status: 'ready', balance: 0 } } }).summary, '¥0.00')
  assert.equal(data('unisound', { value: { quota: { status: 'needs-console' } } }).empty, '未配置控制台会话')
  assert.equal(data('agnes', { value: { quota: { status: 'ready', balance: 0, windows: [{ id: 'pack-credits', remaining: 0 }] } } }).summary, '免费用户')
  assert.equal(data('agnes', { value: { balance: { used: 0, limit: null, unlimited: true, unit: 'USD' }, quota: { status: 'needs-console' } } }).summary, '免费用户')
  assert.equal(data('agnes', { value: { balance: { used: 2.5, limit: 10, unlimited: false, unit: 'USD' }, quota: { status: 'needs-console' } } }).summary, '75%')
})

test('小浣熊按实际套餐分流，停用账号不进入摘要', () => {
  const accounts = [
    { id: 'free', plan: 'free', nickname: '免费账号' }, { id: 'pro', plan: 'pro', nickname: '订阅账号' },
    { id: 'disabled', plan: 'free', enabled: false },
  ].map(account => ({ ...account, provider: 'raccoon' }))
  const balances = [{ accountId: 'free', balance: { total: 0 } },
    { accountId: 'pro', balance: { total: 1250, packages: [{ name: '积分包', remaining: 500, unit: '积分' }] } }]
  const packEntries = [{ value: { accounts } }, { stale: true, value: { accounts: balances } }]
  assert.equal(quotaPillData('raccoon', 'pack', { entries: packEntries }, { accountId: 'free' }).summary, '0 积分')
  const free = quotaPillData('raccoon', 'pack', { entries: packEntries }, { accountId: 'pro' })
  assert.equal(free.serving, null)
  assert.equal(free.summary, '0 积分')
  assert.equal(free.viewed.id, 'free')
  // 统一模型模式下免费面药丸展示全部账号（服务账号可能是任意套餐）；
  // 订阅面（旧会话）仍只看订阅账号。
  const unifiedEntries = [{ value: { accounts } }, { value: { accounts: balances } },
    { value: { config: { raccoonUnifiedModels: true } } }]
  const unifiedFree = quotaPillData('raccoon', 'pack', { entries: unifiedEntries }, { accountId: 'pro' })
  assert.equal(unifiedFree.serving.id, 'pro')
  assert.deepEqual(unifiedFree.rows.map(row => row.id), ['free', 'pro'])
  assert.deepEqual(quotaPillData('raccoon-pro', 'pack', { entries: unifiedEntries }, { accountId: 'pro' }).rows.map(row => row.id), ['pro'])
  const pro = quotaPillData('raccoon-pro', 'pack', { entries: packEntries }, { accountId: 'pro' })
  assert.equal(pro.summary, '1,250 积分')
  assert.equal(pro.rows[0].details[0].value, '500 积分')
  assert.equal(pro.stale, true)
  assert.equal(quotaRoute('raccoon-pro').provider, 'raccoon')
})

test('单账号直接显示额度，多账号纯余额只显示账号数', () => {
  const windows = [{ name: '5 小时', used: 15 }, { name: '周额度', used: 70, resetsAt: '2026-11-24T12:00:00Z' }]
  const row = { id: 'fixture', signedIn: true, windows, balance: 50 }
  const usage = data('workbuddy', { value: { accounts: [row] } })
  assert.equal(usage.serving, null)
  assert.equal(usage.viewed.id, 'fixture')
  assert.equal(usage.summary, '30%')
  assert.ok(Math.abs(usage.tight - .3) < Number.EPSILON)
  assert.equal(usage.metrics.length, 2)
  assert.equal(usage.rows[0].details[1].reset, '2026-11-24T12:00:00Z')
  assert.equal(data('codearts', { value: { accounts: [{ ...row, windows: [] }, { ...row, id: 'other', windows: [] }] } }).summary, '2 个账号')
  assert.equal(data('unisound', { value: { quota: { status: 'ready', windows: [{ id: 'weekly-points', remaining: 0, limit: 100 }] } } }).summary, '0%')
  assert.equal(data('unisound', { value: { quota: { status: 'ready', windows: [{ id: 'weekly-points', used: 39.5, limit: 100 }] } } }).rows[0].details[0].value, '60.5 / 100')
})

test('同账号池共用轮询，仅请求已有宿主快照，失败保留上次数据', async () => {
  const document = Object.assign(new EventTarget(), { hidden: true })
  const focus = new EventTarget()
  const calls = []
  let fail = false, pending = false
  const open = createQuotaSnapshotStore(async (method, { provider, resource }, signal) => {
    calls.push({ method, provider, resource, signal })
    if (pending) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return { ok: !fail, value: { at: 123, value: {} } }
  }, document, focus)
  const store = open(quotaRoute('raccoon'))
  assert.equal(open(quotaRoute('raccoon-pro')), store)
  const release = store.subscribe(() => {})
  const release2 = store.subscribe(() => {})
  try {
    assert.equal(calls.length, 0)
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    assert.deepEqual(calls.map(({ method, provider, resource }) => [method, provider, resource]), [
      ['settings.snapshot', 'raccoon', 'account.list'], ['settings.snapshot', 'raccoon', 'credits.balances'],
      ['settings.snapshot', 'automation', 'automation.status'],
    ])
    const lastGood = store.getSnapshot().entries
    fail = true
    focus.dispatchEvent(new Event('focus'))
    await tick()
    assert.equal(store.getSnapshot().failed, true)
    assert.equal(store.getSnapshot().entries, lastGood)
    pending = true
    store.refresh()
    release()
    assert.equal(calls.at(-1).signal.aborted, false)
    release2()
    assert.equal(calls.at(-1).signal.aborted, true)
  } finally { release(); release2() }
})

test('账号池未选定账号时药丸显示总积分与临时永久分项，点开默认展示当前账号', () => {
  const accounts = [
    { id: 'l1', provider: 'qodercn', nickname: '号一', enabled: true },
    { id: 'l2', provider: 'qodercn', nickname: '号二', enabled: true },
    { id: 'l3', provider: 'qodercn', nickname: '停用', enabled: false },
  ]
  const balances = [
    { accountId: 'l1', updatedAt: 1000, balance: { total: 1200, packages: [
      { name: '永久积分', remaining: 1000, unit: '积分', active: true },
      { name: '每日赠送', remaining: 200, unit: '积分', active: true },
    ] } },
    { accountId: 'l2', updatedAt: 2000, balance: { total: 300, packages: [
      { name: '永久积分', remaining: 200, unit: '积分', active: true },
      { name: '每日赠送', remaining: 100, unit: '积分', active: true },
    ] } },
    { accountId: 'l3', balance: { total: 99999, packages: [{ name: '永久积分', remaining: 99999, unit: '积分', active: true }] } },
  ]
  const packEntries = [{ value: { accounts } }, { value: { accounts: balances } }]
  const unselected = quotaPillData('qodercn', 'pack', { entries: packEntries }, null)
  assert.equal(unselected.serving, null)
  assert.equal(unselected.summary, '1,500 积分')
  assert.equal(unselected.pool.total, 1500)
  assert.equal(unselected.pool.temporary, 300)
  assert.equal(unselected.pool.permanent, 1200)
  assert.equal(unselected.viewed.id, 'l1')
  const selected = quotaPillData('qodercn', 'pack', { entries: packEntries }, { accountId: 'l2', live: true })
  assert.equal(selected.serving.id, 'l2')
  assert.equal(selected.summary, '300 积分')
})

test('命中时使用实际调用账号；无命中按池类型展示摘要并默认查看首号，手动查看不改变摘要', () => {
  const accounts = [
    { id: 'first', signedIn: true, windows: [{ name: '本周', used: 99 }, { name: '5 小时', used: 10 }] },
    { id: 'serving', signedIn: true, windows: [{ name: '本周', used: 39 }] },
  ]
  const snapshot = { entries: [{ value: { accounts } }], failed: false, loading: false }
  const hit = quotaPillData('workbuddy', 'buddy', snapshot, { accountId: 'serving', live: true })
  assert.equal(hit.serving.id, 'serving')
  assert.equal(hit.summary, '61%')
  assert.equal(hit.viewed.id, 'serving')
  const inspect = quotaPillData('workbuddy', 'buddy', snapshot, { accountId: 'serving', live: true }, 'first')
  assert.equal(inspect.serving.id, 'serving')
  assert.equal(inspect.viewed.id, 'first')
  assert.equal(inspect.summary, '61%')
  assert.equal(inspect.accountMetrics.get(inspect.viewed).summary, '1%')
  for (const selection of [null, { accountId: 'missing' }]) {
    const view = quotaPillData('workbuddy', 'buddy', snapshot, selection)
    assert.equal(view.serving, null)
    assert.equal(view.summary, '2 个账号')
    assert.equal(view.viewed.id, 'first')
    assert.equal(view.metrics.length, 0)
    assert.equal(view.at, null)
  }
})

test('WorkBuddy 窗口遵守模型范围，参考额度不主导摘要，数值和条同为余量', () => {
  const accounts = [{ id: 'a', signedIn: true, windows: [
    { name: '总 Credits', amount: 10, limit: 100, unit: 'Credits', notModels: ['free'] },
    { name: '基础 Credits', used: 99, aside: true, notModels: ['free'] },
    { name: '免费窗口', amount: 35, limit: 100, unit: 'Token', models: ['free'] },
    { name: '其他模型', used: 99, models: ['other'] },
  ] }]
  const snapshot = { value: publicResult('workbuddy.snapshot', { accounts }) }
  const paid = modelData('workbuddy', 'paid', snapshot)
  assert.equal(paid.summary, '90 积分')
  assert.equal(paid.viewed.details[0].value, '90 / 100 积分')
  assert.equal(paid.metrics.length, 0)
  assert.equal(paid.tone, 0.9)
  assert.equal(paid.viewed.details.length, 2)
  const free = modelData('workbuddy', 'free', snapshot)
  assert.equal(free.summary, '65%')
  assert.equal(free.metrics[0].label, '免费窗口')
})

test('CodeArts 使用当前模型积分池，重置与到期字段不混用', () => {
  const when = '2032-08-20T12:00:00Z'
  const accounts = [{ id: 'a', signedIn: true, balance: 180, windows: [
    { name: '活动赠送积分', balance: 1, limit: 100, expiresAt: when },
    { name: '会员积分', balance: 179, limit: 200, resetsAt: when },
  ] }]
  // AStudio 段已移除：该渠道停用后 `modelData('astudio', …)` 不再有路由，
  // 它特有的「积分包到期与更新时间不混用」渲染随之失去保证对象。
  const code = { value: { accounts: [{ ...accounts[0], windows: [
    { name: '总积分包', balance: 49, limit: 50, resetsAt: when },
    { name: '赠送积分包', balance: 0, limit: 10 },
    { name: '免费日额度', balance: 750, limit: 1000 },
  ] }] } }
  const catalog = { value: { models: [{ id: 'free', free: true }, { id: 'paid', free: false }] } }
  const paid = modelData('codearts', 'paid', code, catalog)
  assert.equal(paid.summary, '98%')
  assert.equal(paid.metrics[0].cycleEnd, when)
  assert.equal(paid.metrics[0].reset, '')
  assert.equal(modelData('codearts', 'free', code, catalog).summary, '75%')
  assert.equal(modelData('codearts', 'unknown', code, catalog).summary, '')
})

test('商汤当前模型优先展示专属池，重置、赠送到期与采集时间独立', () => {
  const id = 'sensenova-token-plan', updatedAt = Date.now() - 1000
  const snapshot = { value: publicResult('plan.snapshot', { quota: { status: 'ready', updatedAt, pools: [
    { poolType: 'default', name: '通用池', modelIds: ['chat', 'flash-lite'], window5h: { remaining: 0, limit: 100 } },
    { poolType: 'dedicated', name: '专属池', modelIds: ['flash-lite'], window5h: { remaining: 75, limit: 100, resetAt: 1900000000 },
      grantBalance: 12, nearestGrantExpiry: 1900000100 },
  ] } }) }
  const chosen = modelData(id, 'flash-lite', snapshot)
  assert.equal(chosen.viewed.label, '专属池')
  assert.equal(chosen.summary, '75%')
  assert.equal(chosen.at, updatedAt)
  assert.equal(chosen.viewed.details[0].reset, 1900000000000)
  assert.equal(chosen.viewed.details[1].expires, 1900000100000)
  assert.equal(modelData(id, 'chat', snapshot).summary, '0%')
  assert.match(modelData(id, 'other', snapshot).empty, /没有匹配的积分池/)
})

test('云知声倒计时与更新时间分开，过时倒计时停止显示', () => {
  const view = age => modelData('unisound', 'u2-flash', { value: { quota: {
    status: 'ready', updatedAt: Date.now() - age, windows: [{ id: 'window-points', remaining: 100, limit: 500, resetInMs: 60000 }],
  } } })
  assert.equal(view(1000).viewed.details[0].note, '约 1 分钟内重置')
  assert.ok(Number.isFinite(view(1000).at))
  assert.equal(view(65000).viewed.details[0].note, '')
})

test('API 额度按类型和模型匹配，不混用旧请求配额和其他模型赠送量', () => {
  const quota = { status: 'ready', windows: [{ id: 'weekly-requests', remaining: 0, limit: 100 },
    { id: 'window-credits', remaining: 25, limit: 50 }], gifts: [{ modelId: 'mine', remaining: 42, limit: 60 }, { modelId: 'other', remaining: 3 }] }
  assert.equal(modelData('agnes', 'mine', { value: { quota } }).summary, '50%')
  const unisound = modelData('unisound', 'mine', { value: { quota } })
  assert.equal(unisound.viewed.details.filter(row => row.label === '模型赠送额度').length, 1)
  assert.equal(unisound.viewed.details.at(-1).value, '42')
})

test('药丸渲染与设置页共用总积分与数字展示契约（去渠道前缀、当前账号首屏可见）', async () => {
  const treeOf = node => !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(treeOf) : [node, ...treeOf(node.children)]
  const textsOf = node => treeOf(node).flatMap(el => (Array.isArray(el.children) ? el.children : [el.children])
    .flat(Infinity).filter(item => typeof item === 'string'))

  const slotsMap = new Map()
  const accounts = [
    { id: 'l1', provider: 'raccoon', nickname: '号一', enabled: true },
    { id: 'l2', provider: 'raccoon', nickname: '号二', enabled: true },
  ]
  const balances = [
    { accountId: 'l1', updatedAt: 1000, balance: { total: 1200, packages: [
      { name: '永久积分', remaining: 1000, unit: '积分', active: true },
      { name: '每日赠送', remaining: 200, unit: '积分', active: true },
    ] } },
    { accountId: 'l2', updatedAt: 2000, balance: { total: 300, packages: [
      { name: '永久积分', remaining: 200, unit: '积分', active: true },
      { name: '每日赠送', remaining: 100, unit: '积分', active: true },
    ] } },
  ]
  const astudioAccounts = [{
    id: 'a1', name: 'AStudio 主号', signedIn: true, enabled: true, balance: 1600, unit: '积分',
    windows: [{ name: '活动赠送积分', balance: 1600, limit: 1600, used: 0, unit: '积分', expiresAt: '2030-01-01T00:00:00Z' }],
  }]
  const entries = {
    'raccoon/account.list': { at: 1, stale: false, value: { accounts } },
    'raccoon/credits.balances': { at: 1, stale: false, value: { accounts: balances } },
    // 小浣熊药丸额外读全局自动化资源（统一模型开关决定显示口径）；此处保持关闭，
    // 药丸按默认口径展示账号池总积分。
    'automation/automation.status': { at: 1, stale: false, value: { config: {} } },
    'astudio/managed.snapshot': { at: 1, stale: false, value: { enabled: true, registered: true, accounts: astudioAccounts } },
    'astudio/managed.models': { at: 1, stale: false, value: { models: [{ id: 'm', name: 'M', enabled: true }] } },
    'provider.status': { at: 1, stale: false, value: { statuses: { raccoon: { closed: false, accounts: { total: 2, enabled: 2 }, models: { total: 1 } } } } },
  }
  const rpc = async (_p, _s, req) => {
    if (req.method === 'settings.snapshot' && req.payload?.resource) {
      return { ok: true, value: entries[`${req.payload.provider}/${req.payload.resource}`] ?? null }
    }
    if (req.method === 'settings.snapshot') return { ok: true, value: { cursor: 'c', entries } }
    if (req.method === 'account.list') return { ok: true, value: { accounts } }
    if (req.method === 'credits.balances') return { ok: true, value: { accounts: balances } }
    if (req.method === 'provider.status') return { ok: true, value: entries['provider.status'].value }
    if (req.method === 'model.list') return { ok: true, value: { source: 'remote', models: [] } }
    if (req.method === 'model.params') return { ok: true, value: { provider: 'raccoon', params: {} } }
    return { ok: true, value: {} }
  }
  let current = { provider: 'raccoon', model: 'm' }
  const dirStore = { getSnapshot: () => ({ current }), subscribe: () => () => {} }
  let customPlugin
  const hooks = []; const unsubscribes = []; let cursor = 0
  const react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useSyncExternalStore: (subscribe, getSnap) => {
      const idx = cursor++
      if (!hooks[idx]) {
        const stop = subscribe(() => {})
        hooks[idx] = { subscribed: stop }
        if (typeof stop === 'function') unsubscribes.push(stop)
      }
      return getSnap()
    },
    useCallback: fn => fn,
    useId: () => 'fixture',
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
  }
  vm.runInNewContext(source, { AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL,
    window: { __ModuleLoader__: { load: mod => { customPlugin = mod.factory(() => react) } } } })
  const document = { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.document = document
  try {
    customPlugin.apply({
      slots: { inject: (_, fn) => fn(), register: (spec, view) => slotsMap.set(spec.id, { spec, view }) },
      connection: { rpc: { call: rpc } },
      inject: (_deps, fn) => fn({ slots: { inject: (_, f) => f(), register: (s, v) => slotsMap.set(s.id, { spec: s, view: v }) },
        effect: fn => fn(), modelDirectories: { directoryFor: () => ({ store: dirStore }) } }),
    })
    const pillEntry = slotsMap.get('unified-router-quota')
    const expandTree = el => {
      if (!el || typeof el !== 'object') return el
      if (Array.isArray(el)) return el.map(expandTree)
      if (typeof el.type === 'function') return expandTree(el.type(el.props))
      return { ...el, children: Array.isArray(el.children) ? el.children.map(expandTree) : expandTree(el.children) }
    }
    const renderPill = async () => {
      cursor = 0
      const rootEl = pillEntry.view(pillEntry.spec.inject('s1'))
      const firstPass = rootEl.type(rootEl.props)
      await tick()
      cursor = 0
      const secondPass = pillEntry.view(pillEntry.spec.inject('s1'))
      return expandTree(secondPass)
    }
    const raccoonTree = await renderPill()
    const raccoonTrigger = treeOf(raccoonTree).find(n => n.props?.className === 'eac-quota-trigger')
    assert.equal(textsOf(raccoonTrigger).join(''), '1,500 积分')
    assert.match(raccoonTrigger.props['aria-label'], /^Raccoon · 1,500 积分/)
    assert.match(raccoonTrigger.props['aria-label'], /临时 300 · 永久 1,200/)
    const raccoonPopText = textsOf(treeOf(raccoonTree).find(n => n.props?.className === 'eac-quota-popover')).join('|')
    assert.match(raccoonPopText, /账号池总积分/)
    assert.match(raccoonPopText, /总积分\|1,500 积分/)
    assert.match(raccoonPopText, /临时额度\|300 积分/)
    assert.match(raccoonPopText, /永久额度\|1,200 积分/)
    assert.match(raccoonPopText, /号一\|当前账号 · 1,200 积分|号一\|当前账号/)

    // AStudio 段已移除：该渠道已停用（`card: false`），药丸不再渲染它。

    // 云知声 5 小时 + 周额度在药丸和进度条完整呈现（不漏周额度）
    entries['unisound/apikey.snapshot'] = {
      at: 1, stale: false,
      value: {
        provider: 'unisound', hasApiKey: true, registerProvider: true, providerRegistered: true,
        quota: {
          status: 'ready',
          windows: [
            { id: 'window-points', remaining: 2000, limit: 2000 },
            { id: 'weekly-points', remaining: 500, limit: 10000 },
          ],
        },
      },
    }
    current = { provider: 'unisound', model: 'u2-flash' }
    hooks.length = 0
    const unisoundTree = await renderPill()
    const unisoundTrigger = treeOf(unisoundTree).find(n => n.props?.className === 'eac-quota-trigger')
    assert.equal(textsOf(unisoundTrigger).join(''), '5%')
    const unisoundBars = treeOf(unisoundTrigger).filter(n => n.props?.className === 'eac-quota-bar')
    assert.equal(unisoundBars.length, 2)
    assert.deepEqual(unisoundBars.map(bar => bar.props['data-tone']), ['success', 'warn'])
    assert.match(unisoundTrigger.props['aria-label'], /5 小时 100% · 周 5%/)

    // 商汤 5 小时 + 7 天额度完整呈现
    entries['sensenova-token-plan/plan.snapshot'] = {
      at: 1, stale: false,
      value: {
        hasApiKey: true, registerProvider: true, providerRegistered: true,
        quota: {
          status: 'ready', plan: 'Free Plan', updatedAt: 1000,
          pools: [{
            poolType: 'default', name: '通用积分池', modelIds: ['glm-5.3'],
            window5h: { remaining: 120000, limit: 120000 },
            window7d: { remaining: 1188000, limit: 1200000 },
          }],
        },
      },
    }
    current = { provider: 'sensenova-token-plan', model: 'glm-5.3' }
    hooks.length = 0
    const planTree = await renderPill()
    const planTrigger = treeOf(planTree).find(n => n.props?.className === 'eac-quota-trigger')
    assert.equal(textsOf(planTrigger).join(''), '99%')
    assert.equal(treeOf(planTrigger).filter(n => n.props?.className === 'eac-quota-bar').length, 2)
    assert.match(planTrigger.props['aria-label'], /5 小时 100% · 7 天 99%/)
  } finally {
    for (const stop of unsubscribes) stop()
    delete globalThis.document
  }
})

test('多笔同名积分包聚合并统一 credits 单位为积分；多窗口 WorkBuddy 不遗漏周额度', () => {
  const trae = quotaPillData('trae', 'pack', {
    entries: [
      { value: { accounts: [{ id: 't1', provider: 'trae', nickname: 'Trae 号', enabled: true }] } },
      { value: { accounts: [{
        accountId: 't1',
        balance: { total: 400, packages: [
          { name: '每月登录赠送', remaining: 100, unit: 'credits', active: true },
          { name: '签到奖励', remaining: 100, unit: 'credits', expiresAt: 2000, active: true },
          { name: '签到奖励', remaining: 100, unit: 'credits', expiresAt: 1000, active: true },
          { name: '签到奖励', remaining: 100, unit: 'credits', expiresAt: 3000, active: true },
        ] },
      }] } },
    ],
  }, { accountId: 't1', live: true })
  assert.deepEqual(Array.from(trae.viewed.details, d => ({ label: d.label, value: d.value, expires: d.expires })), [
    { label: '每月登录赠送', value: '100 积分', expires: null },
    { label: '签到奖励（3 笔）', value: '300 积分', expires: 1000 },
  ])

  const wb = data('workbuddy', { value: { accounts: [{
    id: 'wb1', signedIn: true, windows: [
      { name: '5 小时', used: 15 },
      { name: '周额度', used: 70, resetsAt: '2026-11-24T12:00:00Z' },
    ],
  }] } })
  assert.equal(wb.windowSummary, '5 小时 85% · 周 30%')

  const wbPool = data('workbuddy', {
    value: {
      accounts: [
        {
          id: 'wb-1', name: '甲', signedIn: true, windows: [
            { name: 'Credits', amount: 0, limit: 500, unit: 'credits', aside: true },
            { name: 'Extra credits', amount: 1374.7, limit: 5000, unit: 'credits', aside: true },
            { name: 'Total credits', amount: 1374.7, limit: 5500, unit: 'credits' },
          ],
        },
        {
          id: 'wb-2', name: '乙', signedIn: true, windows: [
            { name: 'Total credits', amount: 500, limit: 1500, unit: 'credits' },
          ],
        },
      ],
    },
  })
  assert.equal(wbPool.summary, '5,125.3 积分')
  assert.equal(wbPool.showPool, true)
  assert.equal(wbPool.accountMetrics.get(wbPool.rows[0]).summary, '4,125.3 积分')
  assert.equal(wbPool.accountMetrics.get(wbPool.rows[1]).summary, '1,000 积分')
  assert.equal(wbPool.rows[0].details[2].value, '4,125.3 / 5,500 积分')
})
