import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function reactHarness() {
  const hooks = []; let cursor = 0; const scheduled = []
  return {
    hooks, begin() { cursor = 0 }, flush() { for (const run of scheduled.splice(0)) run() },
    dispose() { for (const hook of hooks) hook?.cleanup?.() },
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value }]
    },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index] },
    useEffect(run, deps) {
      const index = cursor++, old = hooks[index]
      if (!old || deps.some((value, i) => value !== old.deps[i])) scheduled.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: run() } })
    },
  }
}
function loadClient(react = reactHarness(), extraGlobals = {}) {
  let module
  vm.runInNewContext(source, { URL, AbortController, navigator: {}, ...extraGlobals, window: { __ModuleLoader__: { load(spec) {
    assert.equal(spec.id, 'dsh-unified-router')
    module = spec.factory(name => { assert.equal(name, 'react'); return react })
  } } } }, { filename: 'client.js' })
  return { module, react }
}
function hostFixture() {
  const calls = []; const overrides = new Map()
  const call = async (method, payload, signal) => {
    calls.push({ method, payload, signal })
    if (overrides.has(method)) return overrides.get(method)(payload, signal)
    const p = payload.provider
    if (method === 'provider.status') return { ok: true, value: { statuses: Object.fromEntries(['raccoon', 'qodercn', 'trae'].map(p => [p, { closed: false, accounts: { enabled: 2 }, models: { total: 31 } }])) } }
    if (method === 'account.list') return { ok: true, value: { accounts: [
      { id: `${p}-a`, provider: p, nickname: '账号 A', enabled: true, credentialRef: 'NEVER_DISPLAY', token: 'NEVER_DISPLAY' },
      { id: `${p}-b`, provider: p, nickname: '账号 B', enabled: false },
    ] } }
    if (method === 'model.list') return { ok: true, value: { models: Array.from({ length: 31 }, (_, i) => ({ id: `${p}-m${i}`, name: `模型 ${i}`, disabled: false, dead: i === 1 })) } }
    if (method === 'model.params') return { ok: true, value: { provider: p, params: {} } }
    if (method === 'model.setParams') return { ok: true, value: { provider: p, params: payload.params ? { [payload.modelId]: payload.params } : {} } }
    if (method === 'account.create') return { ok: true, value: { accountId: `${p}-pending`, loginUrl: 'http://127.0.0.1:3311/login?state=fixture' } }
    if (method === 'login.poll') return { ok: true, value: { done: true, success: true } }
    if (method === 'credits.balances') return { ok: true, value: { accounts: [
      { accountId: `${p}-a`, nickname: '账号 A', balance: { total: 0, packages: [{ name: '今日', remaining: 0, unit: '积分' }] } },
      { accountId: `${p}-b`, nickname: '账号 B', balance: null, error: 'NEVER_DISPLAY' },
    ] } }
    if (method === 'credits.claimAll') return { ok: true, value: { results: [{ outcome: { kind: 'inactive', actionRequired: true } }] } }
    if (method === 'automation.run' || method === 'automation.query') return { ok: true, value: { results: [{ verified: true, outcome: { kind: 'done' } }] } }
    return { ok: true, value: {} }
  }
  return { call, calls, overrides }
}
function treeNodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(treeNodes)] }

test('客户端只注册 settings.section，不声明聊天或侧栏入口；实际调用约定 RPC', async () => {
  const { module, react } = loadClient(); const registrations = []; const host = hostFixture(); const transport = []
  const ctx = { slots: { inject(slot, run) { assert.equal(slot, 'settings.section'); run() }, register(spec, component) { registrations.push({ spec, component }) } }, connection: { rpc: { call(...args) {
    transport.push(args); return host.call(args[2].method, args[2].payload, args[3])
  } } } }
  module.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].spec.name, 'settings.section')
  assert.equal(registrations[0].spec.id, 'unified-router')
  assert.equal(registrations[0].spec.label, 'Unified Router')
  assert.equal(registrations[0].spec.inject().ctx, ctx)
  const Settings = registrations[0].component
  react.begin(); const tree = Settings({ ctx }); react.flush(); await tick()
  assert.equal(tree.props.className, 'eac-settings')
  // 首屏基础读取：settings.snapshot、provider.status、account.list、自动查余额各 1 次，
  // Raccoon 家族卡的目录与参数按两侧各读一次（model.list ×2 + model.params ×2），共 8 项。
  // **外加**快照型渠道的卡片预热（商汤 plan.snapshot、WorkBuddy snapshot + models），
  // 否则那两张渠道 tab 在「点进去之前」永远是「未添加账号 / 状态未读取」（用户反复报障）。
  // API Key 渠道（Agnes、云知声）各预热一份 apikey.snapshot，同样不计入基础读取。
  const coreReads = transport.filter(args => !['plan.snapshot', 'workbuddy.snapshot', 'workbuddy.models', 'apikey.snapshot', 'managed.snapshot', 'managed.models'].includes(args[2].method))
  assert.equal(coreReads.length, 8)
  assert.ok(coreReads.some(args => args[2].method === 'settings.snapshot'))
  assert.deepEqual(transport.map(args => args[2].method).filter(m => ['plan.snapshot', 'workbuddy.snapshot', 'workbuddy.models'].includes(m)).sort(),
    ['plan.snapshot', 'workbuddy.models', 'workbuddy.snapshot'], '卡片预热要读两侧快照')
  assert.ok(transport.every(args => args[0] === '/api' && args[1] === 'unified-router' && args[3] instanceof AbortSignal))
  assert.equal(host.calls.some(c => c.method === 'account.create'), false)
  const before = transport.length
  treeNodes(tree).find(n => n.props['aria-label'] === '切换到 Raccoon').props.onClick()
  await tick()
  assert.equal(transport.length, before, '当前渠道已选中，重复点击不应再触发整页读取')
  react.dispose()
  assert.ok(transport.filter(args => args[2].method !== 'settings.snapshot').every(args => args[3].aborted))
})

test('样式模板字面量内部不得出现反引号（会让 CSS 提前闭合、后面的片段被当 JS 执行）', () => {
  const styles = readFileSync(new URL('../src/client/styles.js', import.meta.url), 'utf8')
  const TICK = String.fromCharCode(96) // 反引号：本文件里不直接写它，避免自己也踩同一个坑
  const body = styles.slice(styles.indexOf(TICK) + 1, styles.lastIndexOf(TICK))
  assert.ok(body.length > 1000, 'styles.js 结构变了，先修这条断言')
  assert.equal(body.split(TICK).length - 1, 0, 'CLIENT_STYLES 模板体内不能有反引号（包含注释）')
  assert.match(body, /\.eac-switch::before\{[^}]*inset:-3px 0/, '开关扩大触控热区但不改变视觉尺寸')
})

test('模型只有内部代号时也要有人话名（Qoder CN 的 qmodel/qfmodel 这类 id）', () => {
  const { module, react } = loadClient()
  for (const [id, name] of [['qmodel_38max', 'Qwen 3.8 Max'], ['qfmodel', 'Qwen 3.8 Flash'], ['dfmodel', 'DeepSeek Flash'], ['kmodel_latest', 'Kimi K3.1 Pro'], ['mmodel', 'MiniMax M3.1 Flash']]) {
    assert.equal(module.filterModels([{ id, name: id }], name).length, 1, `${id} 缺少兜底显示名`)
  }
  react.dispose()
})

test('亮暗主题使用语义变量，成功读取不占提示位且操作反馈可关闭', async () => {
  assert.match(source, /@media\(prefers-color-scheme:dark\)/)
  assert.match(source, /\[data-theme=dark\]/)
  assert.match(source, /\[data-theme=light\]/)
  assert.match(source, /--eac-surface:var\(--dsw-alias-bg-layer-1/)
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_path, _service, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  let tree = render()
  assert.equal(treeNodes(tree).find(n => n.props.className === 'eac-notice'), undefined)
  const header = treeNodes(tree).find(n => n.props.className === 'eac-header-actions')
  assert.equal(treeNodes(header).find(n => n.props.className === 'eac-status-chip').props['data-tone'], 'success')
  assert.equal(treeNodes(tree).find(n => n.props.id === 'eac-tab-models').props['aria-selected'], true)
  treeNodes(tree).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  tree = render()
  treeNodes(tree).find(n => n.props.className === 'eac-switch' && n.props['aria-label'] === '启用账号 账号 A').props.onClick()
  await tick()
  tree = render()
  const notice = treeNodes(tree).find(n => n.props.className === 'eac-notice')
  assert.ok(treeNodes(notice).some(n => n.children.includes('账号设置已保存。')))
  treeNodes(notice).find(n => n.props.className === 'eac-notice-close').props.onClick()
  assert.equal(treeNodes(render()).find(n => n.props.className === 'eac-notice'), undefined)
  react.dispose()
})

test('账号紧凑列表：两个账号同时可见，点「管理」展开后表单用 provider:accountId 独立 key', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_path, _service, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  let tree = render()
  treeNodes(tree).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  tree = render()
  // 紧凑列表：不展开也能同时看到两个账号。
  const names = treeNodes(tree).filter(n => n.props.className === 'eac-row-name').map(n => n.children.join(''))
  assert.deepEqual(names, ['账号 A', '账号 B'])
  // 默认不渲染表单。
  assert.equal(treeNodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'AccountForm'), undefined)
  // 点第一个账号的 ⋯ 才出表单。
  const more = treeNodes(tree).filter(n => n.props.className === 'eac-more')[0]
  more.props.onClick()
  tree = render()
  const detail = treeNodes(tree).find(n => n.props.className === 'eac-row-more')
  assert.equal(detail.props.id, more.props['aria-controls'], '展开按钮与详情区域有可访问的关联')
  const form = treeNodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'AccountForm')
  assert.equal(form.props.key, 'raccoon:raccoon-a')
  react.dispose()
})

test('状态灯使用真实配色档；状态未知时渠道开关禁用且文案与动作不相反', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const byText = (tree, text) => treeNodes(tree).filter(n => n.type === 'button' && n.children.includes(text))
  render(); await tick()
  // Raccoon 家族卡的渠道分区是两个「模型提供方」开关；「关闭渠道」开关是单渠道
  // （TRAE）的形状，先切过去再断言。
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 TRAE').props.onClick()
  await tick()
  let tree = render()
  // 运行中：绿色档（CSS 只定义了 success/warn，旧实现的 is-on 没有配色）。
  assert.equal(treeNodes(tree).find(n => n.props.className === 'eac-status-chip').props['data-tone'], 'success')
  // 账号页只有一个余额刷新入口，不再有第二个重复按钮。
  treeNodes(tree).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  tree = render()
  assert.equal(byText(tree, '刷新').length, 1)
  // 渠道启停统一在「渠道」分区：切过去再断言。
  const toAdvanced = () => { const tab = treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced'); tab.props.onClick(); return render() }
  tree = toAdvanced()
  assert.equal(treeNodes(tree).find(n => n.props['aria-label'] === '关闭渠道').props.disabled, false)
  assert.equal(byText(tree, '重新读取').length, 0, '渠道分区不重复提供页头已有的全局刷新')
  // 状态读不到：按钮禁用，避免显示「打开渠道」却发出关闭指令。
  host.overrides.set('provider.status', async () => ({ ok: true, value: { statuses: {} } }))
  byText(tree, '刷新')[0].props.onClick()
  await tick(); tree = toAdvanced()
  const chip = treeNodes(tree).find(n => n.props.className === 'eac-status-chip')
  assert.equal(chip.props['data-tone'], undefined)
  assert.equal(chip.children.includes('状态未知'), true)
  assert.equal(treeNodes(tree).find(n => n.props['aria-label'] === '打开渠道').props.disabled, true)
  react.dispose()
})

test('渠道卡片十张（含千帆与百炼，AStudio 已停用、Loomy 已移除）：旧豆包工作选择回到首项，Raccoon 两个模型面仍只占一张卡片', async () => {
  const { module, react } = loadClient(undefined, {
    localStorage: { getItem: key => key === 'eac-unified-router-last-provider' ? 'doubaowork' : null },
  }); const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  const tabs = treeNodes(render()).filter(n => typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('切换到 '))
  // `raccoon-pro` 是模型层的第二个 provider，不是一张卡片。
  assert.deepEqual(tabs.map(n => n.props['aria-label'].replace('切换到 ', '')),
    ['Raccoon', 'Qoder 中国版', 'TRAE', '商汤 Token Plan', 'WorkBuddy', 'Agnes', '云知声', '千帆 Token Plan', '阿里云百炼', 'CodeArts'])
  assert.equal(tabs[0].props['aria-selected'], true)
  assert.ok(tabs.every(tab => tab.props['aria-controls'] === 'eac-provider-workspace'))
  const workspace = treeNodes(render()).find(n => n.props.id === 'eac-provider-workspace')
  assert.equal(workspace.props.role, 'tabpanel')
  assert.equal(workspace.props['aria-labelledby'], tabs[0].props.id)

  const store = module.createRouterStore(host.call)
  try {
    await store.load('raccoon')
    // 「一键领取每日额度」走 `credits.claimAll`，Raccoon 没有该端点 → 客户端按
    // `dailyReward: false` 直接短路。**签到是另一条路**（`autoCheckin` 能力位 →
    // automation 的 checkin 任务），两者不可共用一个标志。
    assert.equal(await store.claim(), false)
    assert.equal(host.calls.filter(c => c.method === 'credits.claimAll').length, 0)
    // 登录奖励按家族放行，且带**账号所在池**的 provider 与账号 id。
    store.select('raccoon-a')
    await store.onboarding()
    const claim = host.calls.find(c => c.method === 'automation.run')
    assert.equal(claim.payload.provider, 'raccoon')
    assert.equal(claim.payload.accountId, 'raccoon-a')
    await store.queryAutomationTask('raccoon', 'claimRewards', 'raccoon-a')
    assert.equal(host.calls.filter(c => c.method === 'automation.run').length, 1)
    assert.equal(host.calls.find(c => c.method === 'automation.query').payload.mode, 'claimRewards')

    // 签到是**独立能力位**：Raccoon 渠道分区出现「自动每日签到」开关，
    // 而没有 `credits.claimAll` 的一键领取入口（靠 `dailyReward: false` 区分）。
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 Raccoon').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced')?.props.onClick()
    await tick()
    const raccoonSwitches = treeNodes(render()).filter(n => n.props?.role === 'switch').map(n => n.props['aria-label'])
    assert.ok(raccoonSwitches.includes('Raccoon 自动每日签到'), `缺少签到开关：${raccoonSwitches.join(', ')}`)
  } finally { store.dispose(); react.dispose() }
})

test('写操作后的自动重读不再重复查询余额且保留已查结果', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    assert.equal(host.calls.filter(c => c.method === 'credits.balances').length, 1) // 进入渠道自动查一次
    await tick() // 自动查余额是后台请求，等它落地
    assert.ok(store.getSnapshot().balances.length > 0)
    await store.toggleModel('raccoon:raccoon-m2')
    assert.equal(host.calls.filter(c => c.method === 'credits.balances').length, 1) // 启停模型不重复打余额接口
    assert.ok(store.getSnapshot().balances.length > 0, '写操作后的重读保留已查余额，不清空成「待查询」')
    await store.load()
    assert.equal(host.calls.filter(c => c.method === 'credits.balances').length, 2) // 手动刷新仍会查
    await store.load('qodercn')
    assert.equal(store.getSnapshot().balances.some(b => b.accountId.startsWith('raccoon')), false, '切换渠道后不残留旧渠道余额')
  } finally { store.dispose() }
})

test('余额查询在途时写操作不中止它，结果落地后仍显示', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const gate = deferred()
  host.overrides.set('credits.balances', () => gate.promise)
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    await tick()
    const pending = host.calls.find(c => c.method === 'credits.balances')
    assert.ok(pending, '进入渠道应发起余额查询')
    await store.toggleModel('raccoon:raccoon-m2') // 写操作触发后台重读
    assert.equal(pending.signal.aborted, false, '写操作不应中止在途的余额查询')
    assert.equal(store.getSnapshot().balances.length, 0, '余额未返回时保持空，不清成零')
    gate.resolve({ ok: true, value: { accounts: [{ accountId: 'raccoon-a', balance: { total: 7 } }] } })
    await tick(); await tick()
    assert.equal(store.getSnapshot().balances.length, 1)
    assert.equal(store.getSnapshot().balances[0].total, 7)
  } finally { store.dispose() }
})

test('登录成功但账号列表读取失败时提示未刷新', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    await store.startLogin()
    host.overrides.set('account.list', async () => ({ ok: false }))
    await store.pollLogin()
    assert.match(store.getSnapshot().notice, /登录成功/)
    assert.match(store.getSnapshot().notice, /列表读取失败/)
    // 重读失败保留已展示的旧列表：清空配一句「登录成功」会让人误以为账号丢了。
    assert.ok(store.getSnapshot().accounts.length > 0, '重读失败不清空列表')
  } finally { store.dispose() }
})

test('登录地址不可用时给出本地原因，不泄露地址本身', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    host.overrides.set('account.create', async () => ({ ok: true, value: { accountId: 'raccoon-p', loginUrl: 'http://evil.test/login?token=SECRET' } }))
    assert.equal(await store.startLogin(), false)
    assert.match(store.getSnapshot().notice, /登录地址不可用/)
    assert.doesNotMatch(store.getSnapshot().notice, /SECRET|evil\.test/)
    assert.equal(store.getSnapshot().login, null)
  } finally { store.dispose() }
})

test('登录卡片提供复制链接按钮与本机地址提示', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  const storeButton = treeNodes(render()).find(n => n.type === 'button' && n.children.includes('添加账号'))
  storeButton.props.onClick()
  await tick()
  const tree = render()
  const copy = treeNodes(tree).find(n => n.type === 'button' && n.children.includes('复制链接'))
  assert.ok(copy, '等待授权卡片应有复制链接按钮')
  assert.ok(treeNodes(tree).some(n => typeof n.children?.[0] === 'string' && n.children[0].includes('127.0.0.1')), '本机 HTTP 登录应提示地址归属')
  // 测试环境没有剪贴板：走固定中文降级提示，不抛错。
  copy.props.onClick()
  await tick()
  const notice = treeNodes(render()).find(n => n.props.className === 'eac-notice')
  assert.match(JSON.stringify(notice), /复制失败/)
  react.dispose()
})

test('读取及余额只保留展示字段；零余额与未知余额区分，Qoder 未开通有指引', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('qodercn')
    assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /NEVER_DISPLAY|credentialRef|token/)
    await store.balances()
    assert.equal(store.getSnapshot().balances[0].total, 0)
    assert.equal(store.getSnapshot().balances[1].total, null)
    assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /NEVER_DISPLAY/)
    await store.claim()
    assert.match(store.getSnapshot().notice, /1 个暂不可领/)
    assert.match(store.getSnapshot().notice, /Qoder 中国版官方客户端/)
  } finally { store.dispose() }
})

test('切换渠道取消旧读请求，忽略不遵守 AbortSignal 的迟到响应', async () => {
  const { module } = loadClient(); const host = hostFixture(); const wait = deferred()
  host.overrides.set('account.list', async (payload, signal) => payload.provider === 'trae'
    ? wait.promise : { ok: true, value: { accounts: [{ id: 'qodercn-a', provider: 'qodercn', nickname: '新渠道账号', enabled: true }] } })
  const store = module.createRouterStore(host.call)
  try {
    const old = store.load('trae'); await tick(); await store.load('qodercn')
    assert.equal(host.calls.find(c => c.method === 'account.list' && c.payload.provider === 'trae').signal.aborted, true)
    wait.resolve({ ok: true, value: { accounts: [{ id: 'old', provider: 'trae', nickname: '旧渠道账号' }] } }); await old
    assert.equal(store.getSnapshot().provider, 'qodercn')
    assert.equal(store.getSnapshot().accounts[0].nickname, '新渠道账号')
  } finally { store.dispose() }
})

test('保存目标精确，删除确认有账号及 nonce，旧确认不会误删另一账号', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load()
    assert.equal(await store.save('raccoon-a', '', true), false)
    assert.equal(host.calls.filter(c => c.method === 'account.update').length, 0)
    await store.save('raccoon-b', 'B 新备注', false)
    const saved = host.calls.find(c => c.method === 'account.update').payload
    assert.equal(saved.accountId, 'raccoon-b'); assert.equal(saved.patch.nickname, 'B 新备注'); assert.equal(saved.patch.enabled, false)
    store.select('raccoon-a'); store.requestDelete('raccoon-a'); const old = { ...store.getSnapshot().pendingDelete }
    store.select('raccoon-b'); store.requestDelete('raccoon-b')
    assert.equal(await store.confirmDelete(old), false)
    assert.equal(host.calls.filter(c => c.method === 'account.delete').length, 0)
    await store.confirmDelete({ ...store.getSnapshot().pendingDelete })
    assert.equal(host.calls.find(c => c.method === 'account.delete').payload.accountId, 'raccoon-b')
  } finally { store.dispose() }
})

test('登录由显式点击准备、检查；网址可用真正链接打开且只允许 HTTPS 或本机 HTTP', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    for (const url of ['http://example.com/login', 'javascript:alert(1)', 'https://user:password@example.com/', 'http://127.0.0.1.evil.test/']) assert.throws(() => module.safeLoginUrl(url))
    assert.match(module.safeLoginUrl('https://example.com/login'), /^https:/)
    assert.match(module.safeLoginUrl('http://127.0.0.1:3311/login'), /^http:/)
    await store.load(); assert.equal(host.calls.filter(c => c.method === 'account.create').length, 0)
    await store.startLogin(); assert.equal(store.getSnapshot().login.accountId, 'raccoon-pending')
    const before = host.calls.length; await store.startLogin(); assert.equal(host.calls.length, before)
    assert.equal(host.calls.filter(c => c.method === 'login.poll').length, 0)
    await store.pollLogin(); assert.equal(store.getSnapshot().login, null)
    // 重读完成后提示仍可见（提示在重读完成后才发布，不被空提示清掉）
    assert.match(store.getSnapshot().notice, /登录成功/)
    assert.equal(store.getSnapshot().accounts.length, 2) // 成功后列表自动刷新
  } finally { store.dispose() }
  assert.match(source, /target: '_blank', rel: 'noopener noreferrer'/)
})

test('奖励带选中账号，优先级用 orderedIds，模型恢复与显示按组合键发到模型所属 provider', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('raccoon'); assert.equal(await store.onboarding(), false)
    store.select('raccoon-b'); await store.onboarding()
    assert.equal(host.calls.find(c => c.method === 'automation.run').payload.accountId, 'raccoon-b')
    await store.prioritize('raccoon-b')
    assert.deepEqual(Array.from(host.calls.find(c => c.method === 'account.reorder').payload.orderedIds), ['raccoon-b', 'raccoon-a'])
    // 家族卡的模型键是 `provider:modelId`：启停必须打到模型自己所属的 provider。
    await store.toggleModel('raccoon-pro:raccoon-pro-m1')
    const cleared = host.calls.find(c => c.method === 'model.clearDead')
    assert.equal(cleared.payload.modelId, 'raccoon-pro-m1')
    assert.equal(cleared.payload.provider, 'raccoon-pro')
    await store.toggleModel('raccoon:raccoon-m0')
    const written = host.calls.find(c => c.method === 'model.setDisabled')
    assert.equal(written.payload.provider, 'raccoon')
    assert.equal(written.payload.disabled, true)
    assert.equal(module.filterModels(store.getSnapshot().models, 'RACCOON-M30').length, 1)
  } finally { store.dispose() }
})

test('网络失败及服务端错误只显示固定中文，写操作不自动重试', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load()
    host.overrides.set('account.update', async () => { throw new Error('secret token NEVER_DISPLAY') })
    assert.equal(await store.save('raccoon-a', '新备注', true), false)
    assert.equal(host.calls.filter(c => c.method === 'account.update').length, 1)
    assert.doesNotMatch(store.getSnapshot().notice, /NEVER_DISPLAY|token/)
    assert.match(store.getSnapshot().notice, /操作失败/)
    host.overrides.set('account.list', async () => ({ ok: false, error: { code: 'NEVER_DISPLAY', message: 'SECRET' } }))
    await store.load(); assert.match(store.getSnapshot().notice, /读取失败/)
    assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /SECRET|NEVER_DISPLAY/)
  } finally { store.dispose() }
})

test('写操作后的旧渠道刷新被取消时不覆盖新渠道提示，卸载取消所有请求', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load()
    const oldRefresh = deferred()
    host.overrides.set('account.list', async payload => payload.provider === 'raccoon' ? oldRefresh.promise : { ok: true, value: { accounts: [] } })
    const write = store.save('raccoon-a', '旧渠道保存', true)
    await tick(); await store.load('qodercn')
    const notice = store.getSnapshot().notice
    oldRefresh.resolve({ ok: true, value: { accounts: [] } }); await write
    assert.equal(store.getSnapshot().provider, 'qodercn'); assert.equal(store.getSnapshot().notice, notice)
    store.dispose()
    assert.ok(host.calls.filter(c => c.method !== 'account.update').every(c => c.signal.aborted))
    assert.equal(await store.load('raccoon'), false)
  } finally { store.dispose() }
})

test('写操作后的后台重读失败：保留旧列表，提示说明是上次结果', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    assert.ok(store.getSnapshot().accounts.length > 0)
    host.overrides.set('account.list', async () => ({ ok: false }))
    await store.save('raccoon-a', '账号 A', true)
    const snapshot = store.getSnapshot()
    assert.ok(snapshot.accounts.length > 0, '重读失败不应清空账号列表')
    assert.ok(snapshot.models.length > 0, '重读失败不应清空模型列表')
    assert.match(snapshot.notice, /已保存/)
    assert.match(snapshot.notice, /上次结果/, '成功提示不能掩盖重读失败')
  } finally { store.dispose() }
})

test('手动刷新余额不会被慢的自动查询覆盖', async () => {
  const { module } = loadClient(); const host = hostFixture()
  let slow = true
  host.overrides.set('credits.balances', async () => {
    // 第一次是进入渠道的自动查询（慢），第二次是用户手动刷新（快）。
    if (slow) { slow = false; await new Promise(r => setTimeout(r, 40)); return { ok: true, value: { accounts: [{ accountId: 'raccoon-a', balance: { total: 11 } }] } } }
    return { ok: true, value: { accounts: [{ accountId: 'raccoon-a', balance: { total: 99 } }] } }
  })
  const store = module.createRouterStore(host.call)
  try {
    await store.load()
    await store.balances()
    await new Promise(r => setTimeout(r, 80)); await tick(); await tick()
    const snapshot = store.getSnapshot()
    assert.equal(snapshot.balances.length, 1)
    assert.equal(snapshot.balances[0].total, 99, '先发的慢请求不得覆盖后发的新结果')
  } finally { store.dispose() }
})

test('领取每日额度与任务奖励后刷新余额', async () => {
  const { module } = loadClient(); const host = hostFixture()
  let total = 7
  host.overrides.set('credits.balances', async () => ({ ok: true, value: { accounts: [{ accountId: 'trae-a', balance: { total } }] } }))
  host.overrides.set('credits.claimAll', async () => { total = 42; return { ok: true, value: { results: [{ outcome: { kind: 'claimed' } }] } } })
  const store = module.createRouterStore(host.call)
  try {
    // 「一键领取每日额度」是 dailyReward 渠道的动作：Raccoon 没有该端点（claim 直接短路）。
    await store.load('trae'); await tick()
    assert.equal(store.getSnapshot().balances[0].total, 7)
    await store.claim(); await tick(); await tick()
    assert.equal(store.getSnapshot().balances[0].total, 42, '领取后应显示新额度')
  } finally { store.dispose() }
  const fresh = hostFixture()
  // 任务奖励（onboarding.claim）只剩 Raccoon 族：后半段用 Raccoon 断言领取奖励后余额可用。
  fresh.overrides.set('credits.balances', async () => ({ ok: true, value: { accounts: [{ accountId: 'raccoon-a', balance: { total } }] } }))
  const onboarding = module.createRouterStore(fresh.call)
  try {
    await onboarding.load('raccoon'); await tick()
    await onboarding.onboarding('raccoon-a'); await tick(); await tick()
    assert.ok(onboarding.getSnapshot().balances.length > 0, '领取奖励后余额可用')
  } finally { onboarding.dispose() }
})

test('领取后的余额查询纳入统一取消生命周期', async () => {
  const { module } = loadClient(); const host = hostFixture(); const gate = deferred()
  let claiming = false
  host.overrides.set('credits.claimAll', async () => {
    claiming = true
    return { ok: true, value: { results: [{ outcome: { kind: 'claimed' } }] } }
  })
  host.overrides.set('credits.balances', async payload => claiming && payload.provider === 'trae'
    ? gate.promise
    : { ok: true, value: { accounts: [{ accountId: `${payload.provider}-a`, balance: { total: 7 } }] } })
  const store = module.createRouterStore(host.call)
  try {
    await store.load('trae'); await tick()
    const pendingClaim = store.claim()
    await tick(); await tick()
    const pendingBalance = host.calls.filter(c => c.method === 'credits.balances').at(-1)
    assert.ok(pendingBalance, '领取成功后应开始新的余额查询')
    assert.equal(pendingBalance.signal.aborted, false)
    store.dispose()
    assert.equal(pendingBalance.signal.aborted, true, '卸载必须取消领取后的余额查询')
    gate.resolve({ ok: true, value: { accounts: [] } })
    await pendingClaim
  } finally {
    gate.resolve({ ok: true, value: { accounts: [] } })
    store.dispose()
  }
})

test('全部领取在途时按钮按渠道作用域禁用', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); const gate = deferred(); let Settings
  host.overrides.set('credits.claimAll', () => gate.promise)
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const claimButton = tree => treeNodes(tree).find(n => n.type === 'button' && (n.children || []).includes('全部领取'))
  try {
    render(); await tick()
    // 「全部领取」是 dailyReward 渠道的动作：Raccoon 没有该端点（按钮不渲染），
    // 切到 TRAE 再断言按钮的渠道作用域。
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 TRAE').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    assert.equal(!claimButton(render()).props.disabled, true)
    claimButton(render()).props.onClick(); await tick()
    assert.equal(claimButton(render()).props.disabled, true, '领取在途时给出按钮级忙碌反馈')
    gate.resolve({ ok: true, value: { results: [{ outcome: { kind: 'claimed' } }] } })
    await tick(); await tick()
  } finally {
    gate.resolve({ ok: true, value: { results: [] } })
    react.dispose()
  }
})

test('商汤只通过 API Key 管理模型，Key 不进入浏览器快照', async () => {
  const { module } = loadClient()
  const calls = []
  const store = module.createRouterStore(async (method, payload) => {
    calls.push({ method, payload })
    return { ok: true, value: { hasApiKey: true, models: [{ id: 'm1' }] } }
  })
  try {
    await store.load('sensenova-token-plan')
    await store.planSetKey('sk-fixture-only')
    assert.equal(typeof store.planLogin, 'undefined')
    assert.equal(calls.find(call => call.method === 'plan.setKey').payload.provider, 'sensenova-token-plan')
    assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /sk-fixture-only/)
  } finally { store.dispose() }
})

test('切换渠道保留其他渠道卡片的最近状态', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const call = (method, payload, signal) => method === 'plan.snapshot'
    ? Promise.resolve({ ok: true, value: { hasApiKey: true, models: [{ id: 'm1' }], pools: [], trend: {} } })
    : host.call(method, payload, signal)
  const store = module.createRouterStore(call)
  try {
    await store.load('trae')
    const statuses = store.getSnapshot().statuses
    assert.ok(statuses.raccoon && statuses.qodercn && statuses.trae)
    await store.load('sensenova-token-plan')
    assert.equal(store.getSnapshot().statuses, statuses)
    const plan = store.getSnapshot().plan
    assert.equal(plan.hasApiKey, true)
    const loading = store.load('raccoon')
    assert.equal(store.getSnapshot().plan, plan)
    assert.equal(store.getSnapshot().statuses, statuses)
    assert.deepEqual(Array.from(store.getSnapshot().accounts), [], '不能保留其他渠道的账号')
    await loading
    assert.equal(store.getSnapshot().plan, plan)
    await store.load('sensenova-token-plan')
    assert.ok(store.getSnapshot().statuses.raccoon)
  } finally { store.dispose() }
})

test('商汤 Plan 额度请求在切换或卸载时会被取消，旧响应不会回写', async () => {
  const { module } = loadClient(); const gate = deferred(); const calls = []
  const call = async (method, payload, signal) => {
    calls.push({ method, payload, signal })
    if (method === 'plan.snapshot') return gate.promise
    return { ok: true, value: {} }
  }
  const store = module.createRouterStore(call)
  const pending = store.load('sensenova-token-plan')
  await tick()
  const request = calls.find(c => c.method === 'plan.snapshot')
  assert.ok(request)
  store.dispose()
  assert.equal(request.signal.aborted, true)
  gate.resolve({ ok: true, value: { configured: false, hasApiKey: false, registerProvider: false, providerRegistered: false, pools: [], models: [], enabledModelIds: [], catalogAvailable: false, trend: {} } })
  await pending
  assert.equal(store.getSnapshot().provider, 'sensenova-token-plan')
})

// WorkBuddy 多账号的呈现形状：snapshot 给 accounts，models 全局。
const workbuddySnapshot = accounts => ({ ok: true, value: { accounts, loginUrl: '' } })
const accountRow = (id, half, overrides = {}) => ({
  id, name: `账号${half}`, uid: 'u-1', signedIn: true, plan: 'Pro', signIn: 'kept', updatedAt: 1, error: '',
  windows: [{ name: 'Credits', used: 20, amount: 100, display: '400 / 500', resetsAt: '2026-12-01T00:00:00Z' }],
  ...overrides,
})

test('WorkBuddy 读取落地多账号与全局模型，切换渠道后卡片保留而渠道自有数据清空', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([
    accountRow('workbuddy-aaaaaaaa', '甲'),
    accountRow('workbuddy-bbbbbbbb', '乙', { signedIn: false, plan: '', updatedAt: 2, error: 'not_configured', windows: [], uid: 'u-2' }),
  ]))
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { models: [{ id: 'm1', name: '模型一', free: true }] } }))
  const store = module.createRouterStore(host.call)
  try {
    assert.equal(await store.load('workbuddy'), true)
    const wb = store.getSnapshot().workbuddy
    assert.deepEqual(Array.from(wb.accounts, a => a.id), ['workbuddy-aaaaaaaa', 'workbuddy-bbbbbbbb'])
    const [first, second] = wb.accounts
    assert.equal(first.name, '账号甲')
    assert.equal(first.uid, 'u-1')
    assert.equal(first.signedIn, true)
    assert.equal(first.plan, 'Pro')
    assert.equal(first.error, '')
    assert.equal(first.windows.length, 1)
    assert.equal(first.windows[0].name, 'Credits')
    assert.equal(first.windows[0].used, 20)
    assert.equal(first.windows[0].amount, 100)
    assert.equal(first.windows[0].display, '400 / 500')
    assert.equal(first.windows[0].resetsAt, '2026-12-01T00:00:00Z')
    assert.equal(second.signedIn, false)
    assert.equal(second.error, 'not_configured')
    assert.deepEqual(second.windows, [])
    // 模型目录是全局的，不按账号拆。
    assert.deepEqual(Array.from(wb.models, m => m.id), ['m1'])
    assert.equal(wb.models[0].name, '模型一')
    assert.equal(wb.models[0].free, true)
    // 切到 pack 渠道：账号/模型/余额是渠道自有数据，换渠道必须清空……
    assert.equal(await store.load('trae'), true)
    assert.deepEqual(Array.from(store.getSnapshot().accounts, a => a.id), ['trae-a', 'trae-b'])
    // ……而卡片级状态跨渠道保留（sharedCards 保留同一份对象）。
    assert.equal(store.getSnapshot().workbuddy, wb)
    // 切回 WorkBuddy：不能残留 TRAE 的账号与模型。
    assert.equal(await store.load('workbuddy'), true)
    assert.deepEqual(Array.from(store.getSnapshot().accounts), [])
    assert.deepEqual(Array.from(store.getSnapshot().models), [])
    assert.deepEqual(Array.from(store.getSnapshot().balances), [])
    assert.equal(store.getSnapshot().workbuddy.accounts.length, 2)
    // 未知错误码与无 id 的行在客户端也被丢掉。
    host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([
      accountRow('workbuddy-aaaaaaaa', '甲', { error: 'upstream raw text' }),
      { name: '无 id 的行', signedIn: true },
    ]))
    await store.load('workbuddy')
    assert.deepEqual(Array.from(store.getSnapshot().workbuddy.accounts, a => a.id), ['workbuddy-aaaaaaaa'])
    assert.equal(store.getSnapshot().workbuddy.accounts[0].error, '')
  } finally { store.dispose() }
})

test('WorkBuddy 单账号软失败保留上次窗口并标 stale，别的账号不受牵连', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { models: [{ id: 'm1', name: '模型一' }] } }))
  host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([accountRow('workbuddy-aaaaaaaa', '甲')]))
  const store = module.createRouterStore(host.call)
  try {
    assert.equal(await store.load('workbuddy'), true)
    assert.equal(store.getSnapshot().workbuddyStale, false)
    // 甲软失败（上游临时错误）、乙正常：甲的窗口沿用上次并标 stale。
    host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([
      accountRow('workbuddy-aaaaaaaa', '甲', { plan: '', error: 'upstream_error', windows: [] }),
      accountRow('workbuddy-bbbbbbbb', '乙', { uid: 'u-2' }),
    ]))
    assert.equal(await store.load('workbuddy'), true)
    const snapshot = store.getSnapshot()
    assert.equal(snapshot.workbuddyStale, true)
    const [first, second] = snapshot.workbuddy.accounts
    assert.equal(first.error, 'upstream_error')
    assert.equal(first.windows.length, 1, '软失败保留上次窗口')
    assert.equal(first.plan, 'Pro', '软失败保留上次套餐')
    assert.equal(second.error, '')
    assert.equal(second.windows.length, 1)
  } finally { store.dispose() }
})

test('WorkBuddy 签到与退出按账号 id 下发，签到文案按 outcome 枚举', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([accountRow('workbuddy-aaaaaaaa', '甲')]))
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { models: [{ id: 'm1', name: '模型一' }] } }))
  // 主机会把未知 outcome 归一成 failed，这里故意喂未归一值：客户端也不许把它说成成功。
  const outcomes = ['claimed', 'done', 'inactive', 'ineligible', 'failed', 'unexpected']
  let index = 0
  host.overrides.set('workbuddy.checkin', async () => ({ ok: true, value: { outcome: outcomes[index++], credit: 5, streak: 2 } }))
  const store = module.createRouterStore(host.call)
  try {
    await store.load('workbuddy')
    const expected = [
      ['签到成功', '领取 5 积分', '连续 2 天'],
      ['今日已签到'],
      ['活动未开启'],
      ['不支持签到'],
      ['签到未完成'],
      ['签到结果未知'],
    ]
    for (const needles of expected) {
      // mutate 要求非 busy：每次都等上一次（含 result 回调里的快照重读）完成。
      assert.equal(await store.workbuddyCheckin('workbuddy-aaaaaaaa'), true)
      const notice = store.getSnapshot().notice
      for (const needle of needles) assert.match(notice, new RegExp(needle))
    }
    // 每次签到都会补读一次用量：6 次签到 + 进入渠道 1 次。
    const checkins = host.calls.filter(c => c.method === 'workbuddy.checkin')
    assert.equal(checkins.length, expected.length)
    assert.ok(checkins.every(c => c.payload.accountId === 'workbuddy-aaaaaaaa'), '签到必须点名账号')
    assert.equal(host.calls.filter(c => c.method === 'workbuddy.snapshot').length, expected.length + 1)
    // 不点名或点错的账号：不发请求，直接拒绝（多账号没有「当前账号」）。
    assert.equal(await store.workbuddyCheckin(), false)
    assert.equal(await store.workbuddyCheckin('workbuddy-ffffffff'), false)
    assert.equal(host.calls.filter(c => c.method === 'workbuddy.checkin').length, expected.length)
    // 退出登录同样带账号 id，提示说明只退出了该账号。
    assert.equal(await store.workbuddyLogout('workbuddy-aaaaaaaa'), true)
    const logouts = host.calls.filter(c => c.method === 'workbuddy.logout')
    assert.deepEqual(logouts.map(c => c.payload.accountId), ['workbuddy-aaaaaaaa'])
    assert.match(store.getSnapshot().notice, /已退出该 WorkBuddy 账号/)
  } finally { store.dispose() }
})

test('WorkBuddy 使用统一分区、折叠额度明细及按账号确认退出', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([
    accountRow('workbuddy-aaaaaaaa', '甲'),
    accountRow('workbuddy-bbbbbbbb', '乙', { plan: 'Free', uid: 'u-2', updatedAt: 2, windows: [{ name: 'Extra credits', used: 0, amount: 0, limit: 10, display: '0 / 10' }] }),
  ]))
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { models: [{ id: 'm1', name: '模型一', free: true }] } }))
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const hasText = (tree, needle) => treeNodes(tree).some(n => (n.children || []).some(c => typeof c === 'string' && c.includes(needle)))
  const buttons = tree => treeNodes(tree).filter(n => n.type === 'button')
  render(); await tick()
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 WorkBuddy').props.onClick()
  await tick()
  let tree = render()
  const sections = view => treeNodes(view).filter(n => n.props.className === 'eac-section-title').map(n => n.children.join(''))
  const rows = () => treeNodes(tree).filter(n => n.props.className === 'eac-row-item')
  const findButton = label => buttons(tree).find(n => n.props['aria-label'] === label)
  assert.equal(treeNodes(tree).find(n => n.props.className === 'eac-status-chip').children.includes('WorkBuddy 已连接'), true)
  assert.deepEqual(sections(tree), ['模型目录'])
  treeNodes(tree).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  tree = render()
  assert.deepEqual(sections(tree), ['账号与额度'])
  assert.equal(rows().length, 2)
  assert.ok(hasText(tree, '账号甲'))
  assert.ok(hasText(tree, '账号乙'))
  assert.equal(treeNodes(tree).filter(n => n.type === 'progress').length, 2)
  assert.equal(buttons(tree).filter(n => n.children.includes('添加账号')).length, 1)
  assert.equal(findButton('为 账号甲 签到'), undefined, '默认收起账号动作')
  findButton('账号甲 的更多操作').props.onClick()
  tree = render()
  assert.ok(findButton('为 账号甲 签到'))
  assert.equal(findButton('为 账号乙 签到'), undefined)
  findButton('为 账号甲 签到').props.onClick()
  await tick(); await tick()
  assert.equal(host.calls.filter(c => c.method === 'workbuddy.checkin').at(-1).payload.accountId, 'workbuddy-aaaaaaaa')
  tree = render()
  findButton('退出 账号甲').props.onClick()
  tree = render()
  assert.equal(host.calls.some(c => c.method === 'workbuddy.logout'), false)
  assert.ok(hasText(tree, '退出「账号甲」？'))
  buttons(tree).find(n => n.children.includes('退出登录') && !n.props['aria-label']).props.onClick()
  await tick(); await tick()
  assert.equal(host.calls.filter(c => c.method === 'workbuddy.logout').at(-1).payload.accountId, 'workbuddy-aaaaaaaa')
  tree = render()
  const tabs = treeNodes(tree).filter(n => n.props.className === 'eac-panel-tab')
  assert.deepEqual(tabs.map(tab => tab.props.id), ['eac-tab-models', 'eac-tab-accounts', 'eac-tab-advanced'])
  tabs[0].props.onClick()
  tree = render()
  assert.deepEqual(sections(tree), ['模型目录'])
  assert.ok(hasText(tree, '模型一'))
  assert.ok(hasText(tree, '免费'))
  assert.equal(treeNodes(tree).filter(n => n.props.role === 'switch').length, 1)
  assert.ok(buttons(tree).some(n => n.children.includes('参数')))
  tabs[2].props.onClick()
  tree = render()
  assert.deepEqual(sections(tree), ['渠道设置'])
  assert.ok(hasText(tree, '浏览器授权'))
  host.overrides.set('workbuddy.snapshot', async () => workbuddySnapshot([]))
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { source: 'fallback', models: [{ id: 'builtin-1', name: '内置模型' }] } }))
  findButton('刷新账号与额度').props.onClick()
  await tick()
  tabs[1].props.onClick()
  tree = render()
  assert.ok(hasText(tree, '还没有账号'))
  tabs[0].props.onClick()
  tree = render()
  assert.ok(hasText(tree, '内置目录'))
  assert.ok(hasText(tree, '内置模型'))
  react.dispose()
})

// ===== Raccoon 家族：一张卡片 + 单账号池 + 按套餐分流的两个模型面 =====

test('Raccoon 家族卡：账号只读单池，模型与参数读两侧并按 provider 合并分派', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.overrides.set('account.list', async () => ({ ok: true, value: { accounts: [
    { id: 'raccoon-a', provider: 'raccoon', nickname: '免费账号', enabled: true, plan: 'free' },
    { id: 'raccoon-b', provider: 'raccoon', nickname: '订阅账号', enabled: true, plan: 'pro' },
  ] } }))
  const store = module.createRouterStore(host.call)
  try {
    await store.load('raccoon')
    const snapshot = store.getSnapshot()
    // 账号：单池（只发 raccoon 一次），plan 跟着投影进来。
    assert.deepEqual(host.calls.filter(c => c.method === 'account.list').map(c => c.payload.provider), ['raccoon'])
    assert.deepEqual(Array.from(snapshot.accounts, a => a.plan), ['free', 'pro'])
    // 模型：两侧各读一次，合并后每条带自己的 provider 与组合键。
    assert.deepEqual(host.calls.filter(c => c.method === 'model.list').map(c => c.payload.provider).sort(), ['raccoon', 'raccoon-pro'])
    assert.deepEqual([...new Set(Array.from(snapshot.models, m => m.provider))], ['raccoon', 'raccoon-pro'])
    assert.ok(Array.from(snapshot.models).every(m => m.key === `${m.provider}:${m.id}`))
    // 参数：两侧各读一次，键按 provider 隔离。
    assert.deepEqual(host.calls.filter(c => c.method === 'model.params').map(c => c.payload.provider).sort(), ['raccoon', 'raccoon-pro'])
    // 保存参数按模型所属 provider 下发，只替换该侧那一份。
    host.overrides.set('model.setParams', async payload => ({ ok: true, value: { provider: payload.provider, params: { [payload.modelId]: payload.params } } }))
    assert.equal(await store.setModelParams('raccoon-pro:raccoon-pro-m0', { contextWindow: 200000 }), true)
    const write = host.calls.filter(c => c.method === 'model.setParams').at(-1)
    assert.equal(write.payload.provider, 'raccoon-pro')
    assert.equal(write.payload.modelId, 'raccoon-pro-m0')
    assert.equal(store.getSnapshot().params['raccoon-pro:raccoon-pro-m0'].contextWindow, 200000)
    assert.equal(store.getSnapshot().params['raccoon:raccoon-m0'], undefined, '另一侧参数不受影响')
    // 渠道开关按模型面分别下发。
    assert.equal(await store.setEnabled(false, 'raccoon-pro'), true)
    assert.equal(host.calls.filter(c => c.method === 'provider.setEnabled').at(-1).payload.provider, 'raccoon-pro')
  } finally { store.dispose() }
})

test('Raccoon 家族卡界面：套餐徽标、合并状态、两个模型分区与两个开关', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.overrides.set('account.list', async () => ({ ok: true, value: { accounts: [
    { id: 'raccoon-a', provider: 'raccoon', nickname: '免费账号', enabled: true, plan: 'free' },
    { id: 'raccoon-b', provider: 'raccoon', nickname: '订阅账号', enabled: true, plan: 'pro' },
    { id: 'raccoon-c', provider: 'raccoon', nickname: '未知账号', enabled: true },
  ] } }))
  host.overrides.set('provider.status', async () => ({ ok: true, value: { statuses: {
    raccoon: { closed: false, accounts: { enabled: 3, total: 3 }, models: { total: 2 } },
    'raccoon-pro': { closed: true, accounts: { enabled: 0, total: 0 }, models: { total: 4 } },
  } } }))
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const hasText = (tree, needle) => treeNodes(tree).some(n => (n.children || []).some(c => typeof c === 'string' && c.includes(needle)))
  // Raccoon 现在是默认渠道：首屏读取完成后进模型分区就会自动补拉两侧目录，
  // 先配置好两侧的补拉响应再渲染。
  host.overrides.set('model.refresh', async payload => ({ ok: true, value: payload.provider === 'raccoon'
    ? { count: 2, source: 'remote' } : { count: 4, source: 'fallback' } }))
  render(); await tick()
  // 卡片：一张家族卡，副行是「账号数（单池）· 模型数（两侧之和）」。
  const cards = treeNodes(render()).filter(n => typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('切换到 '))
  // 10 张：含千帆 Token Plan 与阿里云百炼；AStudio 已停用（`card: false`）、Loomy 已移除，不再出现在渠道选择器里。
  assert.equal(cards.length, 10)
  assert.ok(hasText(render(), '3 账号 · 6 模型'))
  let tree = render()
  assert.equal(treeNodes(tree).find(n => n.props.id === 'eac-tab-models').props['aria-selected'], true)
  treeNodes(tree).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
  tree = render()
  // 套餐徽标：免费 success / 订阅 info / 未知（含没打过标的）warn。
  const badges = treeNodes(tree).filter(n => n.props.className === 'eac-tag' && ['免费', '订阅', '套餐未知'].includes(n.children[0]))
    .map(n => [n.children[0], n.props['data-tone']])
  assert.deepEqual(badges, [['免费', 'success'], ['订阅', 'info'], ['套餐未知', 'warn']])
  // 两个模型分区（免费 31 / 订阅 31，来自各自的 model.list）。
  // 两侧目录各刷各的：免费面拉到远端目录、订阅面没拉到 → 来源标识必须分别显示。
  treeNodes(tree).find(n => n.props.id === 'eac-tab-models').props.onClick()
  tree = render()
  await tick(); await tick(); await tick()
  tree = render()
  const groups = treeNodes(tree).filter(n => n.props['data-model-provider'])
  assert.deepEqual(groups.map(n => n.props['data-model-provider']), ['raccoon', 'raccoon-pro'])
  assert.ok(hasText(tree, '免费模型 · 31'))
  assert.ok(hasText(tree, '订阅模型 · 31'))
  // 首屏读取完成后自动补拉两侧目录：每侧各一次 model.refresh，各自记来源。
  assert.deepEqual(host.calls.filter(c => c.method === 'model.refresh' && c.payload.provider.startsWith('raccoon')).map(c => c.payload.provider),
    ['raccoon', 'raccoon-pro'])
  const groupText = group => treeNodes(group).flatMap(n => n.children || []).filter(c => typeof c === 'string').join(' ')
  assert.ok(groupText(groups[0]).includes('远端目录'), '免费面拉到上游目录')
  assert.ok(groupText(groups[1]).includes('内置目录'), '订阅面没拉到 → 如实标兜底')
  assert.equal(groupText(groups[0]).includes('内置目录'), false, '拉到远端时不标兜底')
  // 每侧各一个「刷新目录」按钮，按本侧 provider 下发。
  const refreshButtons = treeNodes(tree).filter(n => n.type === 'button' && n.children.includes('刷新目录'))
  assert.equal(refreshButtons.length, 2)
  refreshButtons[1].props.onClick()
  await tick(); await tick()
  assert.equal(host.calls.filter(c => c.method === 'model.refresh').at(-1).payload.provider, 'raccoon-pro')
  // 渠道分区：两个开关，各自对 free / pro 下发。
  treeNodes(tree).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  tree = render()
  assert.ok(hasText(tree, '免费模型提供方'))
  assert.ok(hasText(tree, '订阅模型提供方'))
  const byText = (label) => treeNodes(tree).filter(n => n.type === 'button' && n.props['aria-label'] === label)
  assert.equal(byText('关闭模型提供方').length, 1, '免费面运行中 → 关闭它')
  assert.equal(byText('打开模型提供方').length, 1, '订阅面已关闭 → 打开它')
  byText('关闭模型提供方')[0].props.onClick()
  await tick()
  assert.equal(host.calls.filter(c => c.method === 'provider.setEnabled').at(-1).payload.provider, 'raccoon')
  assert.equal(host.calls.filter(c => c.method === 'provider.setEnabled').at(-1).payload.enabled, false)
  await tick()
  tree = render()
  treeNodes(tree).filter(n => n.type === 'button' && n.props['aria-label'] === '打开模型提供方')[0].props.onClick()
  await tick()
  assert.equal(host.calls.filter(c => c.method === 'provider.setEnabled').at(-1).payload.provider, 'raccoon-pro')
  assert.equal(host.calls.filter(c => c.method === 'provider.setEnabled').at(-1).payload.enabled, true)
  react.dispose()
})

// ===== 模型目录：真正拉取上游（model.refresh）+ 来源标识 =====

test('订阅限定模型挂独立徽标，与倍率/免费徽标并存且不互相覆盖', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  // raccoon 目录（免费面）：一条订阅限定（带倍率）、一条订阅限定（无倍率）、一条普通免费。
  host.overrides.set('model.list', async payload => payload.provider === 'raccoon'
    ? { ok: true, value: { models: [
      { id: 'pro-model', name: '会员模型', disabled: false, subscriptionOnly: true, rate: { label: 'x0.80', tone: 'neutral' } },
      { id: 'pro-free', name: '会员免费模型', disabled: false, subscriptionOnly: true, isFree: true },
      { id: 'normal', name: '普通模型', disabled: false, isFree: true },
    ] } }
    : { ok: true, value: { models: [] } })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const tab = (tree, id) => treeNodes(tree).find(n => n.props.id === id)
  render(); await tick()
  tab(render(), 'eac-tab-models').props.onClick()
  let tree = render(); await tick(); await tick()
  const tags = treeNodes(tree).filter(n => n.props.className === 'eac-tag').map(n => [n.children[0], n.props['data-tone']])
  // 订阅限定徽标出现两次（两条订阅限定模型），tone=info。
  assert.equal(tags.filter(t => t[0] === '订阅限定').length, 2)
  assert.ok(tags.every(t => t[0] !== '订阅限定' || t[1] === 'info'))
  // 倍率与免费徽标不被订阅限定覆盖：x0.80 与 免费 仍在。
  assert.ok(tags.some(t => t[0] === 'x0.80'))
  assert.ok(tags.some(t => t[0] === '免费'))
  // 普通模型不挂订阅限定。
  assert.equal(tags.filter(t => t[0] === '订阅限定').length, 2)
  react.dispose()
})

test('模型目录真拉上游：进模型分区自动补拉一次，兜底/远端来源与刷新按钮如实反映', async () => {
  // 默认渠道 Raccoon 是家族卡（首屏后会对两侧各补拉一次）；这个用例断言单渠道的
  // 补拉次数，把首屏直接落在 TRAE 上。
  const { module, react } = loadClient(reactHarness(), {
    localStorage: { getItem: key => key === 'eac-unified-router-last-provider' ? 'trae' : null },
  }); const host = hostFixture(); let Settings
  // 主机回报：先是内置目录（上游拉不到），手动刷新后变成远端目录。
  let source = 'fallback'
  host.overrides.set('model.refresh', async () => ({ ok: true, value: { count: source === 'remote' ? 31 : 2, source } }))
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const hasText = (tree, needle) => treeNodes(tree).some(n => (n.children || []).some(c => typeof c === 'string' && c.includes(needle)))
  const byText = (tree, text) => treeNodes(tree).filter(n => n.type === 'button' && n.children.includes(text))
  const tab = (tree, id) => treeNodes(tree).find(n => n.props.id === id)
  render(); await tick()
  // 进「模型」分区：后台自动补拉一次（不置 busy、不写提示），静默完成后重读目录。
  tab(render(), 'eac-tab-models').props.onClick()
  let tree = render()
  await tick(); await tick(); await tick()
  assert.equal(host.calls.filter(c => c.method === 'model.refresh').length, 1)
  assert.equal(host.calls.filter(c => c.method === 'model.refresh').at(-1).payload.provider, 'trae')
  tree = render()
  assert.equal(hasText(tree, '内置目录'), true)
  assert.equal(hasText(tree, '远端目录'), false)
  // 自动补拉每渠道只做一次：来回切换分区不会反复打上游。
  tab(tree, 'eac-tab-accounts').props.onClick()
  tree = render()
  tab(tree, 'eac-tab-models').props.onClick()
  tree = render()
  await tick()
  assert.equal(host.calls.filter(c => c.method === 'model.refresh').length, 1)
  // 手动「刷新目录」：来源变远端目录，兜底提示消失，并重读 model.list。
  source = 'remote'
  const readsBefore = host.calls.filter(c => c.method === 'model.list').length
  byText(tree, '刷新目录')[0].props.onClick()
  await tick(); await tick(); await tick()
  tree = render()
  assert.equal(host.calls.filter(c => c.method === 'model.refresh').length, 2)
  assert.equal(hasText(tree, '远端目录'), true)
  assert.equal(hasText(tree, '内置目录'), false)
  assert.equal(host.calls.filter(c => c.method === 'model.list').length, readsBefore + 1, '刷新后必须重读一次目录')
  // 目录本身没变（fixture 恒 31 条），来源结论才是这次刷新的产出。
  assert.equal(host.calls.filter(c => c.method === 'model.list').at(-1).payload.provider, 'trae')
  react.dispose()
})

test('Raccoon 家族卡：两侧目录各自刷新、来源各自记录，只刷一侧不清空另一侧', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.overrides.set('model.refresh', async payload => ({ ok: true, value: payload.provider === 'raccoon'
    ? { count: 2, source: 'remote' } : { count: 4, source: 'fallback' } }))
  const store = module.createRouterStore(host.call)
  try {
    await store.load('raccoon')
    assert.equal(await store.refreshModels('raccoon'), true)
    assert.deepEqual(host.calls.filter(c => c.method === 'model.refresh').map(c => c.payload.provider), ['raccoon'])
    assert.deepEqual({ ...store.getSnapshot().modelSource }, { raccoon: 'remote' })
    // 只刷订阅面：免费面的模型与来源都保持不动。
    const freeModels = store.getSnapshot().models.filter(m => m.provider === 'raccoon').map(m => m.key)
    assert.equal(await store.refreshModels('raccoon-pro'), true)
    assert.deepEqual(host.calls.filter(c => c.method === 'model.refresh').map(c => c.payload.provider), ['raccoon', 'raccoon-pro'])
    assert.deepEqual({ ...store.getSnapshot().modelSource }, { raccoon: 'remote', 'raccoon-pro': 'fallback' })
    assert.deepEqual(store.getSnapshot().models.filter(m => m.provider === 'raccoon').map(m => m.key), freeModels)
    // 不给 target 就是整个渠道两侧一起刷（页头/整卡刷新路径）。
    assert.equal(await store.refreshModels(), true)
    assert.deepEqual(host.calls.filter(c => c.method === 'model.refresh').map(c => c.payload.provider),
      ['raccoon', 'raccoon-pro', 'raccoon', 'raccoon-pro'])
    // 主机失败时不谎报来源：该侧保持上次结论。
    host.overrides.set('model.refresh', async () => ({ ok: false, error: { code: 'bad-request', message: 'x' } }))
    assert.equal(await store.refreshModels('raccoon-pro'), true)
    assert.equal(store.getSnapshot().modelSource['raccoon-pro'], 'fallback')
  } finally { store.dispose() }
})

// ===== 渠道级缓存：切回已读渠道立刻有内容，重进设置页也能恢复 =====

test('切回已读渠道立即恢复缓存：账号可见、无读取提示、后台仍刷新', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('trae'); await tick() // 等自动余额落地，缓存里也带上额度
    const raccoon = store.load('raccoon')
    await tick()
    const loading = store.load('trae') // 不 await：切回的瞬间就要有内容
    const snapshot = store.getSnapshot()
    assert.equal(snapshot.provider, 'trae')
    assert.ok(snapshot.accounts.length > 0, '缓存的账号立刻可见')
    assert.equal(snapshot.loading, true, '后台仍在刷新')
    assert.equal(snapshot.notice, '', '有缓存时不显示「正在读取渠道状态…」')
    assert.equal(host.calls.filter(c => c.method === 'account.list' && c.payload.provider === 'trae').length, 2,
      '缓存只影响显示，不跳过任何 RPC')
    await loading; await raccoon
    assert.deepEqual(Array.from(store.getSnapshot().accounts, a => a.id), ['trae-a', 'trae-b'])
    assert.equal(store.getSnapshot().loading, false)
  } finally { store.dispose() }
})

test('打开设置页直接读上次查看的渠道，不再从第一个渠道点起', async () => {
  // ⚠️ 客户端代码跑在 vm 沙箱里，它看到的 `globalThis` 是沙箱全局 ——
  // 所以 sessionStorage 必须注入沙箱，打在测试进程的 globalThis 上无效。
  const memory = new Map([['eac-unified-router-last-provider', 'qodercn']])
  const sessionStorage = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)) },
  }
  const { module, react } = loadClient(reactHarness(), { sessionStorage })
  const host = hostFixture(); let Settings
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  react.begin(); Settings({ ctx }); react.flush(); await tick()
  // 首个渠道读取必须落在记住的那个渠道上：不再有一次默认渠道（Raccoon）的整轮读取。
  const firstChannelRead = host.calls.find(c => c.method === 'account.list')
  assert.equal(firstChannelRead.payload.provider, 'qodercn')
  assert.equal(host.calls.some(c => c.method === 'account.list' && c.payload.provider === 'raccoon'), false)
  react.dispose()
})

test('静默刷新只打卡片计数与当前渠道余额，不置 busy 也不写提示', async () => {
  const { module } = loadClient()
  const calls = []
  const store = module.createRouterStore(async (method, payload) => {
    calls.push(method)
    if (method === 'provider.status') return { ok: true, value: { statuses: { trae: { closed: false, accounts: { enabled: 1 }, models: { total: 3 } } } } }
    if (method === 'account.list') return { ok: true, value: { accounts: [{ id: 'trae-a', provider: 'trae', nickname: '账号 A', enabled: true }] } }
    if (method === 'model.list') return { ok: true, value: { models: [{ id: 'm1', name: '模型一' }] } }
    if (method === 'credits.balances') return { ok: true, value: { accounts: [{ accountId: 'trae-a', nickname: '账号 A', balance: { total: 42, packages: [] } }] } }
    return { ok: true, value: {} }
  })
  try {
    await store.load('trae')
    calls.length = 0
    const before = store.getSnapshot()
    await store.refreshLight()
    // 只做两件便宜的事：卡片计数 + 当前渠道余额；不重读账号/模型列表。
    assert.deepEqual(calls.filter(c => c !== 'credits.balances'), ['provider.status'])
    assert.equal(store.getSnapshot().busy, false)
    assert.equal(store.getSnapshot().loading, false)
    assert.equal(store.getSnapshot().notice, before.notice)
  } finally { store.dispose() }
})

test('首次进入的渠道无缓存：仍显示读取提示', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('trae')
    const loading = store.load('qodercn') // 该渠道还没读过，没有缓存
    const snapshot = store.getSnapshot()
    assert.deepEqual(Array.from(snapshot.accounts), [])
    assert.match(snapshot.notice, /正在读取渠道状态/)
    await loading
    assert.equal(store.getSnapshot().loading, false)
    assert.deepEqual(Array.from(store.getSnapshot().accounts, a => a.id), ['qodercn-a', 'qodercn-b'])
  } finally { store.dispose() }
})

test('sessionStorage 持久化：重进设置页恢复缓存且只含公开字段', async () => {
  const cells = new Map()
  const sessionStorage = {
    getItem: key => cells.has(key) ? cells.get(key) : null,
    setItem: (key, value) => { cells.set(key, String(value)) },
    removeItem: key => { cells.delete(key) },
  }
  let module
  vm.runInNewContext(source, { URL, AbortController, sessionStorage, navigator: {}, window: { __ModuleLoader__: { load(spec) {
    module = spec.factory(() => reactHarness())
  } } } }, { filename: 'client.js' })
  const host = hostFixture()
  const first = module.createRouterStore(host.call)
  await first.load('trae'); await tick()
  const persisted = cells.get('eac-unified-router-cache-v1')
  assert.equal(typeof persisted, 'string', '读取成功后写入渠道缓存')
  assert.doesNotMatch(persisted, /NEVER_DISPLAY|credentialRef|token/, '缓存只含公开展示字段')
  first.dispose()
  assert.ok(cells.has('eac-unified-router-cache-v1'), 'dispose 只清内存缓存，不清 sessionStorage')
  // 「重进设置页」：同一 context 里新建 store，不 await 就能看到账号。
  const second = module.createRouterStore(host.call)
  const loading = second.load('trae')
  const snapshot = second.getSnapshot()
  assert.deepEqual(Array.from(snapshot.accounts, a => a.id), ['trae-a', 'trae-b'])
  assert.ok(snapshot.statuses.trae, '卡片级状态也恢复，状态点不是一片灰')
  assert.equal(snapshot.notice, '')
  await loading
  second.dispose()
  assert.ok(cells.has('eac-unified-router-cache-v1'))
})

test('卡片级状态存 localStorage：重启后渠道 tab 首屏就有上次的数字（含商汤 / WorkBuddy 快照）', async () => {
  const cells = new Map()
  const localStorage = {
    getItem: key => cells.has(key) ? cells.get(key) : null,
    setItem: (key, value) => { cells.set(key, String(value)) },
    removeItem: key => { cells.delete(key) },
  }
  const { module } = loadClient(reactHarness(), { localStorage })
  const host = hostFixture()
  host.overrides.set('plan.snapshot', async () => ({ ok: true, value: {
    planName: '商汤套餐', configured: true, hasApiKey: true, registerProvider: true, providerRegistered: true,
    quotaKnown: true, models: [{ id: 'sensenova-6.8-flash', name: 'SenseNova 6.8 Flash', enabled: true }], pools: [], trend: null,
  } }))
  host.overrides.set('workbuddy.snapshot', async () => ({ ok: true, value: {
    accounts: [{ id: 'wb-1', name: '账号甲', signedIn: true, plan: 'pro', windows: [], updatedAt: 1 }], models: [], loginUrl: '',
  } }))
  host.overrides.set('workbuddy.models', async () => ({ ok: true, value: { models: [{ id: 'hy4std', name: 'Hy4', free: true }] } }))
  const first = module.createRouterStore(host.call)
  await first.load('trae')
  await first.prefetchCards?.()
  await tick()
  const raw = cells.get('eac-unified-router-cache-v1')
  assert.equal(typeof raw, 'string', '卡片快照要落盘')
  assert.doesNotMatch(raw, /NEVER_DISPLAY|credentialRef|token|loginUrl":"http/, '只存公开字段，不存登录地址与凭据')
  const saved = JSON.parse(raw)
  assert.equal(saved.plan.hasApiKey, true)
  assert.equal(saved.workbuddy.accounts[0].name, '账号甲')
  first.dispose()

  // 「重启 DSH」：新 store 只靠持久化快照就该有卡片级状态，一次 RPC 都不用发。
  const second = module.createRouterStore(host.call)
  const snapshot = second.getSnapshot()
  assert.equal(snapshot.plan?.hasApiKey, true, '商汤卡片状态要跨重启恢复')
  assert.equal(snapshot.workbuddy?.accounts?.length, 1, 'WorkBuddy 账号要跨重启恢复')
  assert.deepEqual(snapshot.workbuddy?.loginUrl, '', '登录地址不落盘')
  assert.ok(snapshot.statuses.trae, 'pack 渠道的卡片计数同样恢复')
  second.dispose()
})

test('缓存不跨渠道串数据', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('trae'); await tick()
    const raccoon = store.load('raccoon') // 该渠道首次进入，没有缓存
    assert.deepEqual(Array.from(store.getSnapshot().accounts), [], '首次进入的渠道不能显示上一渠道的账号')
    await raccoon
    const back = store.load('trae')
    const snapshot = store.getSnapshot()
    assert.equal(snapshot.provider, 'trae')
    assert.ok(snapshot.accounts.length > 0)
    assert.ok(snapshot.accounts.every(a => a.provider === 'trae'), '缓存命中的是 TRAE 自己的账号池')
    await back
  } finally { store.dispose() }
})

test('渠道选择器是小卡片网格（不用横向滚动条）', () => {
  // 用户报障：「最上面的 provider 列表是左右拖动的滚动条，很难看」。
  // 现在是自动换行的卡片网格：任何宽度都不会出现横向滚动，也不会把渠道藏起来。
  assert.match(source, /\.eac-providers\{display:grid/)
  assert.match(source, /\.eac-providers\{[^}]*repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(source, /@container eac \(max-width:470px\)\s*\{\s*\.eac-providers\{[^}]*repeat\(2,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(source, /\.eac-providers\{[^}]*overflow-x:auto/)
})

test('家族卡缓存恢复两侧模型不串 provider', async () => {
  const { module } = loadClient(); const host = hostFixture(); const store = module.createRouterStore(host.call)
  try {
    await store.load('raccoon'); await tick()
    await store.load('qodercn')
    const back = store.load('raccoon') // 不 await：缓存立刻命中
    const models = store.getSnapshot().models
    assert.ok(models.some(m => m.provider === 'raccoon'), '免费侧模型还在')
    assert.ok(models.some(m => m.provider === 'raccoon-pro'), '订阅侧模型还在')
    assert.ok(models.every(m => m.key === `${m.provider}:${m.id}`), '组合键仍与 provider 自洽')
    await back
  } finally { store.dispose() }
})

test('设置批量读取宿主快照，切换时恢复额度并静默更新当前账号', async () => {
  const { module } = loadClient()
  const fixture = hostFixture()
  let cursor = 'one'
  let total = 420
  const snapshotCalls = []
  const store = module.createRouterStore(async (method, payload, signal) => {
    if (method === 'settings.refresh') { snapshotCalls.push(method); return { ok: true, value: null } }
    if (method === 'settings.snapshot') {
      snapshotCalls.push(method)
      return { ok: true, value: { cursor, entries: payload.cursor === cursor ? null : {
        'trae/account.list': { value: { accounts: [{ id: 'trae-a', provider: 'trae', nickname: '后台账号' }] }, at: Date.now() + 1000, stale: false },
        'trae/credits.balances': { value: { accounts: [{ accountId: 'trae-a', balance: { total }, updatedAt: 123 }] }, at: 123, stale: false },
        'workbuddy/workbuddy.snapshot': { value: { accounts: [accountRow('workbuddy-aaaaaaaa', '甲')] }, at: 123, stale: false },
      } } }
    }
    if (method === 'credits.balances') {
      assert.equal(payload.snapshot, true)
      return { ok: true, value: { snapshot: { at: null, stale: false } } }
    }
    return fixture.call(method, payload, signal)
  })
  try {
    await store.load('trae')
    await store.readHostSnapshots()
    assert.equal(store.getSnapshot().accounts[0].nickname, '后台账号')
    assert.equal(store.getSnapshot().balances[0].total, 420)
    assert.equal(store.getSnapshot().workbuddy.accounts.length, 1)
    const reads = fixture.calls.length
    await store.refreshSettings()
    total = 400
    cursor = 'two'
    await store.refreshLight(true)
    assert.deepEqual(snapshotCalls, ['settings.snapshot', 'settings.refresh', 'settings.snapshot'])
    assert.equal(fixture.calls.length, reads)
    assert.equal(store.getSnapshot().balances[0].total, 400)
    assert.equal(store.getSnapshot().busy, false)
    assert.equal(store.getSnapshot().loading, false)
  } finally { store.dispose() }
})

test('输入栏写入的账号池模型参数同步到设置页，恢复默认会移除覆盖', async () => {
  const { module } = loadClient()
  const fixture = hostFixture()
  let cursor = 'one', params = { m0: { contextWindow: 500_000, reasoningEffort: 'high' } }
  const store = module.createRouterStore(async (method, payload, signal) => {
    if (method === 'settings.snapshot') return { ok: true, value: { cursor, entries: {
      'raccoon/model.params': { at: Date.now(), value: { provider: 'raccoon', params } },
      'raccoon-pro/model.params': { at: Date.now(), value: { provider: 'raccoon-pro', params: { m0: { contextWindow: 256_000 } } } },
    } } }
    return fixture.call(method, payload, signal)
  })
  try {
    await store.load('raccoon')
    await store.readHostSnapshots()
    assert.equal(store.getSnapshot().params['raccoon:m0'].contextWindow, 500_000)
    params = {}
    cursor = 'two'
    await store.readHostSnapshots()
    assert.equal(store.getSnapshot().params['raccoon:m0'], undefined)
    assert.equal(store.getSnapshot().params['raccoon-pro:m0'].contextWindow, 256_000)
  } finally { store.dispose() }
})

test('设置发布产物使用操作和状态文案', () => {
  assert.doesNotMatch(source, /不代表|不视为|不构成|仅供参考|以上游为准|请勿视为|不能视为|后台操作可能继续/)
})

test('账号行从宿主签到快照显示已签到并停用当轮领取入口', async () => {
  const { module, react } = loadClient()
  const host = hostFixture()
  let Settings
  const date = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
  host.overrides.set('settings.snapshot', async () => ({
    ok: true, value: { cursor: 'checkin-v1', entries: {
      'daily/checkin.status': { value: { enabled: true, providers: {
        trae: { date, resetHour: 0, enabled: false, accounts: [
          { accountId: 'trae-a', kind: 'claimed' }, { accountId: 'trae-b', kind: 'already-claimed' },
        ] },
      } } },
    } },
  }))
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  try {
    render()
    await tick()
    // 「全部领取」入口与签到徽标按 dailyReward 渠道断言：Raccoon 没有一键领取
    // （`dailyReward: false`），切到 TRAE。
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 TRAE').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    const nodes = treeNodes(render())
    assert.equal(nodes.filter(node => node.props.className === 'eac-tag' && node.children.includes('已签到')).length, 2)
    assert.equal(nodes.some(node => node.children.includes('自动签到已关闭')), true, '账号页按本渠道生效值显示')
    assert.equal(nodes.find(node => node.children.includes('全部领取')).props.disabled, true)
    assert.equal(host.calls.some(call => call.method === 'credits.claimAll'), false, '设置页只读取状态')
  } finally { react.dispose() }
})

test('Qoder CN 进入模型页从上次目录自动静默刷新为远端目录，静默失败不弹未登录告警', async () => {
  const { module, react } = loadClient()
  const host = hostFixture()
  let sourceTag = 'cached'
  let issue = ''
  let refreshMode = 'cached-fail'
  host.overrides.set('model.list', async payload => payload.provider === 'qodercn'
    ? { ok: true, value: { source: sourceTag, issue, models: [{ id: 'qmodel', name: 'Qwen 3.8 Max', disabled: false }] } }
    : { ok: true, value: { models: [{ id: 'm0', name: '模型 0', disabled: false }] } })
  host.overrides.set('model.refresh', async payload => {
    if (payload.provider === 'qodercn') {
      if (refreshMode === 'cached-fail') {
        sourceTag = 'cached'
        issue = 'login-required'
        return { ok: true, value: { count: 1, source: 'cached', issue: 'login-required' } }
      }
      sourceTag = 'remote'
      issue = ''
      return { ok: true, value: { count: 1, source: 'remote' } }
    }
    return { ok: true, value: { count: 1, source: 'remote' } }
  })
  let Settings
  const ctx = {
    slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } },
  }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const hasText = (tree, needle) => treeNodes(tree).some(n => (n.children || []).some(c => typeof c === 'string' && c.includes(needle)))
  try {
    render(); await tick()
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 Qoder 中国版').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-models').props.onClick()
    render(); await tick(); await tick(); await tick()
    const qoderRefreshes = host.calls.filter(c => c.method === 'model.refresh' && c.payload?.provider === 'qodercn')
    assert.equal(qoderRefreshes.length, 1, '切到 Qoder 中国版模型页时，上次目录(cached)应自动静默刷新一次')
    let tree = render()
    assert.equal(hasText(tree, '上次目录'), true)
    assert.equal(hasText(tree, 'qoderclicn login'), false, '静默刷新失败但已有上次目录时，不弹 CLI 未登录告警')

    // 下次手动刷新成功后升级为「远端目录」并清除告警状态
    refreshMode = 'remote-ok'
    treeNodes(tree).find(n => n.type === 'button' && n.children.includes('刷新目录')).props.onClick()
    await tick(); await tick(); await tick()
    tree = render()
    assert.equal(hasText(tree, '远端目录'), true)
    assert.equal(hasText(tree, '上次目录'), false)
  } finally { react.dispose() }
})

test('各渠道设置页统一展示积分单位、同名包聚合、总计汇总与窗口剩余明细', async () => {
  const { module, react } = loadClient()
  const host = hostFixture()
  host.overrides.set('credits.balances', async payload => payload.provider === 'trae' ? {
    ok: true,
    value: {
      accounts: [{
        accountId: 'trae-a', nickname: 'Trae 主号', updatedAt: 1000,
        balance: {
          total: 250,
          packages: [
            { name: '签到奖励', remaining: 100, unit: 'credits', active: true, expiresAt: 2000 },
            { name: '签到奖励', remaining: 150, unit: 'credits', active: true, expiresAt: 1000 },
          ],
        },
      }],
    },
  } : { ok: true, value: { accounts: [] } })
  host.overrides.set('managed.snapshot', async payload => payload.provider === 'codearts' ? {
    ok: true,
    value: {
      provider: 'codearts', enabled: true, registered: true,
      accounts: [{
        id: 'ca-1', name: 'CodeArts 主号', signedIn: true, enabled: true, plan: '体验版',
        balance: 500.25, unit: '积分', updatedAt: 1000,
        windows: [
          { name: '总积分包', used: 17, amount: 99.75, limit: 600, balance: 500.25, unit: '积分' },
          { name: '基础积分包', used: 0, amount: 0, limit: 500, balance: 500, unit: '积分' },
          { name: '赠送积分包', used: 100, amount: 99.75, limit: 100, balance: 0.25, unit: '积分' },
        ],
      }],
    },
  } : { ok: true, value: { provider: payload.provider, enabled: true, registered: false, accounts: [] } })
  host.overrides.set('workbuddy.snapshot', async () => ({
    ok: true,
    value: {
      accounts: [{
        id: 'wb-1', name: 'WB 主号', signedIn: true, plan: 'Free', updatedAt: 1000,
        windows: [
          { name: 'Credits', used: 0, amount: 0, limit: 500, unit: 'credits' },
          { name: 'Total credits', used: 20, amount: 200, limit: 1000, unit: 'credits' },
        ],
      }],
    },
  }))
  let Settings
  const ctx = {
    slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } },
  }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const allText = tree => treeNodes(tree).flatMap(n => (n.children || []).filter(c => typeof c === 'string')).join('|')
  try {
    render(); await tick()
    // 1. TRAE：credits 单位归一为积分，多笔签到奖励合并显示
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 TRAE').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    render(); await tick()
    let t = render()
    const traeMore = treeNodes(t).find(n => n.props.className === 'eac-more')
    if (traeMore) { traeMore.props.onClick(); t = render() }
    assert.match(allText(t), /签到奖励（2 笔）/)

    // 2. CodeArts：顶部展示总计与临时/永久分项，展开展示剩余 / 上限
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 CodeArts').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    t = render()
    assert.match(allText(t), /总计 500\.25 积分（临时 0\.25 · 永久 500）/)
    const caMore = treeNodes(t).find(n => n.props.className === 'eac-more')
    caMore.props.onClick(); t = render()
    assert.match(allText(t), /剩余 500\.25 \/ 600 积分/)

    // 3. WorkBuddy：顶部展示总计积分，账号行优先展示积分数（保留剩余进度条），展开展示剩余 / 上限与剩余百分比
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 WorkBuddy').props.onClick()
    await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    t = render()
    assert.match(allText(t), /总计 800 积分/)
    assert.match(allText(t), /800\|积分/)
    const wbMore = treeNodes(t).find(n => n.props.className === 'eac-more')
    wbMore.props.onClick(); t = render()
    assert.match(allText(t), /800 \/ 1,000\| 积分/)
    assert.match(allText(t), /剩余 80%/)
  } finally { react.dispose() }
})

// 宿主快照协议桩：命中快照读方法时附带 `snapshot: { at, stale }`。
// `at: null` 表示「宿主还没采集过这份资源」——客户端应回落实时读取。
function snapshotHost({ at = null, stale = false } = {}) {
  const host = hostFixture()
  const snapshotMethods = new Set(['provider.status', 'account.list', 'model.list', 'model.params', 'credits.balances'])
  const call = async (method, payload, signal) => {
    const result = await host.call(method, payload, signal)
    if (payload?.snapshot === true && snapshotMethods.has(method) && result?.ok === true) {
      return { ok: true, value: { ...result.value, snapshot: { at, stale } } }
    }
    return result
  }
  return { ...host, call }
}

test('账号池渠道首屏优先读宿主持久化快照：命中即零实时读取，也不打扰宿主补采', async () => {
  const { module } = loadClient()
  const host = snapshotHost({ at: Date.now() - 1_000 })
  const store = module.createRouterStore(host.call)
  const snapshotMethods = ['provider.status', 'account.list', 'model.list', 'model.params', 'credits.balances']
  try {
    assert.equal(await store.load('raccoon'), true)
    const reads = host.calls.filter(call => snapshotMethods.includes(call.method))
    assert.ok(reads.length > 0, '首屏仍要读数据')
    assert.ok(reads.every(call => call.payload?.snapshot === true), '账号 / 目录 / 参数 / 额度都必须走快照读取')
    assert.equal(host.calls.filter(call => call.method === 'settings.refresh').length, 0, '快照已够用时不请宿主补采')
    const state = store.getSnapshot()
    assert.deepEqual(state.accounts.map(account => account.id).sort(), ['raccoon-a', 'raccoon-b'])
    assert.ok(state.models.length >= 2, '目录同样来自快照')
    assert.equal(state.loadFailed, false)
  } finally { store.dispose() }
})

test('宿主尚未采集该资源时回落实时读取，并请它补采一次', async () => {
  const { module } = loadClient()
  const host = snapshotHost({ at: null })
  const store = module.createRouterStore(host.call)
  try {
    assert.equal(await store.load('raccoon'), true)
    const accountReads = host.calls.filter(call => call.method === 'account.list')
    assert.ok(accountReads.some(call => call.payload?.snapshot === true), '先问快照')
    assert.ok(accountReads.some(call => call.payload?.snapshot !== true), '快照为空时回落实时，界面不空转')
    const refreshes = host.calls.filter(call => call.method === 'settings.refresh')
    assert.ok(refreshes.some(call => call.payload?.provider === 'raccoon'), '请宿主补采该渠道，下次打开即由快照供给')
    // 家族卡有免费 / 订阅两个模型面：每个面各补采一次，但同一个面不因为
    // account.list / model.list / model.params / credits.balances 各问一遍而重复请求。
    assert.deepEqual(refreshes.map(call => call.payload.provider).sort(), ['raccoon', 'raccoon-pro'],
      '同一渠道只补采一次（账号 / 目录 / 参数各问一遍也不重复打扰宿主）')
    assert.deepEqual(store.getSnapshot().accounts.map(account => account.id).sort(), ['raccoon-a', 'raccoon-b'])
  } finally { store.dispose() }
})

test('宿主不认快照标记时（共用模式转发给原插件）按实时数据使用，不空转也不报错', async () => {
  // 共用模式下 RPC 经 sharedTransport 转发给原 channel-pack 插件：它没有本插件的
  // 「snapshot: true → 附带 snapshot.at」扩展，因此返回值里**没有 snapshot 标记**。
  // 客户端必须把这种返回当作实时数据直接用（并照常展示），不能因为「没拿到 at」
  // 就回退重读或当成读取失败 —— 否则共用模式首屏会多打一轮上游。
  const { module } = loadClient()
  const host = hostFixture()
  const store = module.createRouterStore(host.call)
  try {
    assert.equal(await store.load('raccoon'), true)
    // 家族卡有免费 / 订阅两个模型面：model.* 按面各读一次，其余每渠道一次。
    const snapshotMethods = ['provider.status', 'account.list', 'model.list', 'model.params', 'credits.balances']
    const perKey = {}
    for (const call of host.calls.filter(entry => snapshotMethods.includes(entry.method))) {
      const key = `${call.method}|${call.payload?.provider ?? ''}`
      perKey[key] = (perKey[key] ?? 0) + 1
    }
    for (const [key, count] of Object.entries(perKey)) {
      assert.equal(count, 1, `${key} 只读一次（先说快照、拿不到标记也不回退）`)
    }
    assert.deepEqual(Object.keys(perKey).sort(), [
      'account.list|raccoon', 'credits.balances|raccoon',
      'model.list|raccoon', 'model.list|raccoon-pro',
      'model.params|raccoon', 'model.params|raccoon-pro',
      'provider.status|',
    ], '该读的资源一个不少、也没多读')
    assert.equal(host.calls.filter(call => call.method === 'settings.refresh').length, 0,
      '没拿到 at 不等于宿主没采集过，不该反过来请它补采')
    const state = store.getSnapshot()
    assert.deepEqual(state.accounts.map(account => account.id).sort(), ['raccoon-a', 'raccoon-b'])
    assert.ok(state.models.length >= 2)
    assert.equal(state.loadFailed, false, '不因缺少快照标记而判读取失败')
  } finally { store.dispose() }
})
