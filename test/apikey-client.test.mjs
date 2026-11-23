import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
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
function memoryStorage() {
  const data = new Map()
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)) }, removeItem: key => { data.delete(key) } }
}
function loadClient(extraGlobals = {}) {
  const react = reactHarness(); let module
  vm.runInNewContext(source, { URL, AbortController, navigator: {}, ...extraGlobals, window: { __ModuleLoader__: { load(spec) {
    module = spec.factory(() => react)
  } } } }, { filename: 'client.js' })
  return { module, react }
}
const model = (id, extra = {}) => ({ id, name: id, enabled: true, vision: false, contextWindow: 524288, maxOutputLength: 65536,
  thinkingLevels: ['off', 'low'], defaultEffort: 'off', defaultVision: false, defaultContextWindow: 524288, defaultMaxOutputLength: 65536, params: {}, ...extra })
const snapshotOf = (provider, patch = {}) => ({ provider, hasApiKey: true, registerProvider: true, providerRegistered: true,
  catalogSource: 'remote', catalogError: false, updatedAt: 1, models: [model(provider + '-a'), model(provider + '-b', { enabled: false })], balance: null, ...patch })
function hostFixture() {
  const calls = []; const state = {}; const overrides = new Map()
  const snapshot = provider => (state[provider] ??= snapshotOf(provider))
  const call = async (method, payload, signal) => {
    calls.push({ method, payload })
    if (overrides.has(method)) return overrides.get(method)(payload, signal)
    const p = payload.provider
    if (method === 'apikey.snapshot') return { ok: true, value: snapshot(p) }
    if (method === 'apikey.setKey') { state[p] = { ...snapshot(p), hasApiKey: true }; return { ok: true, value: { hasApiKey: true } } }
    if (method === 'apikey.setEnabled') { state[p] = { ...snapshot(p), registerProvider: payload.enabled }; return { ok: true, value: { enabled: payload.enabled, providerRegistered: payload.enabled } } }
    if (method === 'apikey.setModelEnabled') return { ok: true, value: { modelId: payload.modelId, enabled: payload.enabled } }
    if (method === 'apikey.setModelParams') return { ok: true, value: { modelId: payload.modelId, ...model(payload.modelId), params: payload.params, contextWindow: payload.params.contextWindow ?? 524288 } }
    if (method === 'apikey.resetModels') return { ok: true, value: { enabledModelIds: [p + '-a'] } }
    if (method === 'provider.status') return { ok: true, value: { statuses: {} } }
    if (method === 'settings.snapshot') return { ok: true, value: { cursor: 'c1', entries: Object.fromEntries(Object.keys(state).map(id => [id + '/apikey.snapshot', { at: 5, stale: false, value: state[id] }])) } }
    return { ok: true, value: {} }
  }
  return { call, calls, state, overrides }
}
const treeNodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(treeNodes)]
const textOf = tree => treeNodes(tree).flatMap(node => (node.children || []).filter(child => typeof child === 'string')).join('|')
const buttons = tree => treeNodes(tree).filter(node => node.type === 'button')

async function credentialFormFixture(providerId, providerTitle, rowName, componentName) {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state[providerId] = snapshotOf(providerId, providerId === 'unisound'
    ? { hasConsoleSession: false, consoleLoginUrl: '', toolsSupported: true } : {})
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  treeNodes(render()).find(n => n.props['aria-label'] === `切换到 ${providerTitle}`).props.onClick(); await tick()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  treeNodes(render()).find(n => n.props['aria-label'] === `${rowName} 的更多操作`).props.onClick()
  const node = treeNodes(render()).find(n => n.type?.name === componentName)
  assert.ok(node, `找不到 ${componentName}`)
  return { node, react }
}

async function assertClearsOnlyAfterSuccess(node, react) {
  let succeeds = false
  const props = { ...node.props, onSave: async () => succeeds }
  const render = () => { react.begin(); const tree = node.type(props); react.flush(); return tree }
  const input = () => treeNodes(render()).find(n => n.type === 'input' && n.props.type === 'password')
  input().props.onChange({ target: { value: 'fixture-secret' } })
  await render().props.onSubmit({ preventDefault() {} })
  assert.equal(input().props.value, 'fixture-secret', '保存失败必须保留输入供修正或重试')
  succeeds = true
  await render().props.onSubmit({ preventDefault() {} })
  assert.equal(input().props.value, '', '保存成功后才清空凭据')
}

test('渠道快照按渠道 id 收编：只留白名单字段，Key 与脏值不进状态', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.state.agnes = { ...snapshotOf('agnes'), apiKey: 'NEVER_DISPLAY', token: 'NEVER_DISPLAY', catalogSource: 'bogus',
    balance: { used: 1.25, limit: 10, unlimited: false, unit: 'EUR' },
    models: [model('agnes-a', { secret: 'NEVER_DISPLAY' }), { id: '' }, null] }
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes')
    const entry = store.getSnapshot().apikeys.agnes
    assert.equal(entry.ready, true)
    assert.equal(entry.catalogSource, 'fallback', '未知目录来源按离线兜底')
    assert.equal(entry.balance, null, '未知单位的用量丢弃')
    assert.deepEqual(entry.models.map(row => row.id), ['agnes-a'])
    assert.equal(JSON.stringify(store.getSnapshot()).includes('NEVER_DISPLAY'), false)
    assert.deepEqual(host.calls.filter(c => c.method === 'apikey.snapshot').map(c => c.payload.provider), ['agnes'])
  } finally { store.dispose() }
})

test('两个渠道的快照互不覆盖：切换渠道保留另一家已读到的状态', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.state.unisound = snapshotOf('unisound', { hasApiKey: false, registerProvider: false, providerRegistered: false })
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes'); await store.load('unisound')
    const { apikeys } = store.getSnapshot()
    assert.equal(apikeys.agnes.hasApiKey, true)
    assert.equal(apikeys.unisound.hasApiKey, false)
  } finally { store.dispose() }
})

test('宿主快照同时更新两个渠道（后一个渠道看得到前一个的写入）', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.state.agnes = snapshotOf('agnes', { models: [model('agnes-a')] })
  host.state.unisound = snapshotOf('unisound', { models: [model('u2'), model('u2-flash')] })
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    assert.equal(await store.readHostSnapshots(), true)
    const { apikeys } = store.getSnapshot()
    assert.equal(apikeys.agnes.models.length, 1)
    assert.equal(apikeys.unisound.models.length, 2)
  } finally { store.dispose() }
})

test('保存 Key：提供方未启用时自动启用；空 Key 不发请求', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.state.agnes = snapshotOf('agnes', { hasApiKey: false, registerProvider: false, providerRegistered: false })
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes')
    host.calls.length = 0
    assert.equal(await store.agnesSetKey('   '), false)
    assert.equal(host.calls.length, 0)
    assert.match(store.getSnapshot().notice, /请输入 Agnes API Key/)
    assert.equal(await store.agnesSetKey('sk-fixture-key'), true)
    const methods = host.calls.map(c => c.method).filter(method => method !== 'apikey.snapshot')
    assert.deepEqual(methods, ['apikey.setKey', 'apikey.setEnabled'])
    assert.equal(JSON.stringify(host.calls.find(c => c.method === 'apikey.setKey').payload), JSON.stringify({ provider: 'agnes', apiKey: 'sk-fixture-key' }))
    assert.equal(store.getSnapshot().apikeys.agnes.registerProvider, true)
    assert.equal(JSON.stringify(store.getSnapshot()).includes('sk-fixture-key'), false)
  } finally { store.dispose() }
})

test('保存 Key：提供方已启用时不重复启用', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call, 'unisound')
  try {
    await store.load('unisound')
    host.calls.length = 0
    assert.equal(await store.unisoundSetKey('sk-fixture-key'), true)
    assert.equal(host.calls.some(c => c.method === 'apikey.setEnabled'), false)
  } finally { store.dispose() }
})

test('模型开关与参数：成功后就地更新，未知模型与异常响应不落状态', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes')
    host.calls.length = 0
    assert.equal(await store.agnesSetModelEnabled('missing', true), false)
    assert.equal(host.calls.length, 0)
    assert.equal(await store.agnesSetModelEnabled('agnes-b', true), true)
    assert.equal(store.getSnapshot().apikeys.agnes.models.find(row => row.id === 'agnes-b').enabled, true)
    assert.equal(host.calls.filter(c => c.method === 'apikey.snapshot').length, 0, '开关不触发重读')
    assert.equal(await store.agnesSetModelParams('agnes-a', { contextWindow: 200000 }), true)
    assert.equal(store.getSnapshot().apikeys.agnes.models.find(row => row.id === 'agnes-a').contextWindow, 200000)
    assert.equal(await store.agnesSetModelParams('agnes-a', { contextWindow: -1 }), false)
    assert.match(store.getSnapshot().notice, /模型参数无效/)
    host.overrides.set('apikey.setModelEnabled', async () => ({ ok: true, value: { modelId: 'other', enabled: true } }))
    assert.equal(await store.agnesSetModelEnabled('agnes-a', false), false)
    assert.equal(store.getSnapshot().apikeys.agnes.models.find(row => row.id === 'agnes-a').enabled, true)
    host.overrides.delete('apikey.setModelEnabled')
    assert.equal(await store.agnesResetModels(), true)
    assert.deepEqual(store.getSnapshot().apikeys.agnes.models.map(row => row.enabled), [true, false])
  } finally { store.dispose() }
})

test('其他渠道的方法与 provider 被拒：apikey 方法只认注册的渠道', async () => {
  const { module } = loadClient(); const host = hostFixture()
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes')
    assert.equal(typeof store.unisoundSetKey, 'function')
    assert.equal(typeof store.agnesSetKey, 'function')
    assert.equal(store.sensenovaSetKey, undefined)
  } finally { store.dispose() }
})

test('设置页：卡片状态、模型分区与渠道分区按快照呈现', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state.agnes = snapshotOf('agnes', { balance: { used: 1.25, limit: 10, unlimited: false, unit: 'USD', updatedAt: 3 } })
  host.state.unisound = snapshotOf('unisound', { hasApiKey: false, registerProvider: false, providerRegistered: false })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req) { return host.call(req.method, req.payload) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  const tabs = treeNodes(render()).filter(n => typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('切换到 '))
  const tab = name => tabs.find(n => n.props['aria-label'] === '切换到 ' + name)
  await tick()
  const cards = textOf(render())
  assert.match(cards, /Key 已配置 · 2 模型/)
  assert.match(cards, /待配置 Key · 2 模型/)

  tab('Agnes').props.onClick(); await tick(); render()
  let screen = textOf(render())
  assert.match(screen, /2 个模型|1 \/ 2 已启用/)
  assert.match(screen, /渠道运行中/)
  assert.ok(treeNodes(render()).some(n => n.props.role === 'switch' && /^启用模型 /.test(n.props['aria-label'] ?? '')), '模型行带开关')
  // 渠道分区：提供方开关、API Key、用量。
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick(); render()
  screen = textOf(render())
  assert.match(screen, /模型提供方/); assert.match(screen, /API Key/); assert.match(screen, /api\.agnes-ai\.cn/)
  assert.match(screen, /账户用量/); assert.match(screen, /已用 \$1\.25 \/ \$10\.00/)

  tab('云知声').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick(); render()
  screen = textOf(render())
  assert.match(screen, /待配置 Key/); assert.match(screen, /先配置 API Key/)
  assert.doesNotMatch(screen, /账户用量/)
  const providerSwitch = treeNodes(render()).find(n => n.props.role === 'switch' && n.props['aria-label'] === '模型提供方')
  assert.equal(providerSwitch.props.disabled, true, '没有 Key 时提供方开关不可用')
})

test('云知声渠道：能力工具开关与控制台会话行按快照呈现，开关走对应 RPC', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state.unisound = snapshotOf('unisound', {
    toolsSupported: true, toolsEnabled: false, toolsRegistered: false,
    hasConsoleSession: false, consoleLoginUrl: '',
    quota: { status: 'needs-console' },
  })
  host.state.agnes = snapshotOf('agnes', { toolsSupported: true, toolsEnabled: false, toolsRegistered: false })
  host.overrides.set('apikey.setToolsEnabled', async payload => {
    host.state[payload.provider] = { ...host.state[payload.provider], toolsEnabled: payload.enabled, toolsRegistered: payload.enabled }
    return { ok: true, value: { toolsEnabled: payload.enabled, toolsRegistered: payload.enabled } }
  })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req) { return host.call(req.method, req.payload) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  let screen = render()
  let text = textOf(screen)
  // 工具行与控制台会话行都在；额度行显示未配置会话。
  assert.match(text, /多模态能力工具/)
  assert.match(text, /控制台会话/)
  assert.match(text, /未配置控制台会话/)
  const toolsSwitch = treeNodes(screen).find(n => n.props.role === 'switch' && n.props['aria-label'] === '多模态能力工具')
  assert.ok(toolsSwitch, '工具行带开关')
  assert.equal(toolsSwitch.props['aria-checked'], false)
  // 控制台会话行有「浏览器登录」动作。
  assert.ok(treeNodes(screen).some(n => n.type === 'button' && (n.children || []).includes('浏览器登录')))
  // Agnes 显示独立的图像工具开关，不继承云知声文案及控制台会话。
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 Agnes').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  assert.doesNotMatch(textOf(render()), /多模态能力工具/)
  assert.doesNotMatch(textOf(render()), /控制台会话/)
  const imageSwitch = () => treeNodes(render()).find(n => n.props.role === 'switch' && n.props['aria-label'] === '图像生成与编辑')
  assert.equal(imageSwitch().props['aria-checked'], false)
  imageSwitch().props.onClick(); await tick()
  assert.equal(imageSwitch().props['aria-checked'], true)
  assert.ok(host.calls.some(c => c.method === 'apikey.setToolsEnabled' && c.payload.provider === 'agnes' && c.payload.enabled))
})

test('Agnes 不渲染控制台会话行；含空白 Key 本地拒绝不发请求；行内动作与展开按钮同容器不重叠', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  // Agnes 快照不含 hasConsoleSession（宿主只对云知声透出）→ 不应出现控制台行。
  host.state.agnes = snapshotOf('agnes')
  host.state.unisound = snapshotOf('unisound', { hasConsoleSession: false, toolsSupported: true })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req) { return host.call(req.method, req.payload) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 Agnes').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  const agnesScreen = render()
  assert.doesNotMatch(textOf(agnesScreen), /控制台会话/)
  assert.doesNotMatch(textOf(agnesScreen), /浏览器登录/)
  // 云知声有控制台行，且「浏览器登录」与「配置」展开按钮同处一个 eac-row-controls 容器（不叠格）。
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  const uScreen = render()
  assert.match(textOf(uScreen), /控制台会话/)
  const controlsBoxes = treeNodes(uScreen).filter(n => n.props.className === 'eac-row-controls')
  const consoleBox = controlsBoxes.find(box => treeNodes(box).some(n => n.type === 'button' && (n.children || []).includes('浏览器登录')))
  assert.ok(consoleBox, '控制台动作在 eac-row-controls 容器内')
  assert.ok(treeNodes(consoleBox).some(n => n.props.className === 'eac-more'), '展开按钮与动作同容器，不再各占 more 格')
  // 含内部空白的 Key：本地拒绝，不发 setKey。
  const store = module.createRouterStore(host.call, 'agnes')
  try {
    await store.load('agnes')
    host.calls.length = 0
    assert.equal(await store.agnesSetKey('sk-' + 'a'.repeat(24) + ' ' + 'a'.repeat(24)), false)
    assert.equal(host.calls.filter(c => c.method === 'apikey.setKey').length, 0)
    assert.match(store.getSnapshot().notice, /含空格或换行/)
    // 首尾换行的合法 Key 仍可保存（trim 后无空白）。
    assert.equal(await store.agnesSetKey('sk-' + 'a'.repeat(48) + '\n'), true)
    assert.ok(host.calls.some(c => c.method === 'apikey.setKey'))
  } finally { store.dispose() }
})

test('云知声动作：工具开关/控制台会话粘贴/清除/浏览器登录走对应 RPC 且不泄凭据', async () => {
  const { module } = loadClient(); const host = hostFixture()
  host.state.unisound = snapshotOf('unisound', { toolsSupported: true, toolsEnabled: false, toolsRegistered: false, hasConsoleSession: false })
  host.overrides.set('apikey.setToolsEnabled', async payload => ({ ok: true, value: { toolsEnabled: payload.enabled, toolsRegistered: payload.enabled } }))
  host.overrides.set('apikey.setConsoleSession', async () => ({ ok: true, value: { hasConsoleSession: true } }))
  host.overrides.set('apikey.clearConsoleSession', async () => ({ ok: true, value: { hasConsoleSession: false } }))
  host.overrides.set('apikey.consoleLogin', async () => ({ ok: true, value: { signedIn: true, hasConsoleSession: true } }))
  const store = module.createRouterStore(host.call, 'unisound')
  try {
    await store.load('unisound')
    assert.equal(await store.unisoundSetToolsEnabled(true), true)
    assert.ok(host.calls.some(c => c.method === 'apikey.setToolsEnabled' && c.payload.enabled === true))
    // 空 Cookie 不发请求。
    host.calls.length = 0
    assert.equal(await store.unisoundSetConsole('  '), false)
    assert.equal(host.calls.filter(c => c.method === 'apikey.setConsoleSession').length, 0)
    assert.equal(await store.unisoundSetConsole('sessionid=abc'), true)
    assert.ok(host.calls.some(c => c.method === 'apikey.setConsoleSession'))
    assert.equal(await store.unisoundClearConsole(), true)
    assert.ok(host.calls.some(c => c.method === 'apikey.clearConsoleSession'))
    assert.equal(await store.unisoundConsoleLogin(), true)
    assert.ok(host.calls.some(c => c.method === 'apikey.consoleLogin'))
    assert.equal(store.getSnapshot().apikeys.unisound.hasConsoleSession, true)
    assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /sessionid=abc/)
  } finally { store.dispose() }
})

test('渠道展示控制台额度和可到期的限速提醒', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state.unisound = snapshotOf('unisound', {
    quota: {
      status: 'ready',
      windows: [
        { id: 'window-points', remaining: 300, limit: 500 },
        { id: 'weekly-points', remaining: 10000, limit: 10000 },
      ],
      gifts: [
        { modelId: 'u2-asr', remaining: 30, limit: 30, unit: '小时' },
        { modelId: 'u2-tts', remaining: 150000, limit: 150000, unit: '字' },
      ],
    },
    rateLimit: { until: Date.now() + 60_000, reason: 'tpm', estimated: true },
  })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req) { return host.call(req.method, req.payload) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick(); render()
  treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
  const screen = render()
  const text = textOf(screen)
  assert.match(text, /5 小时积分\|剩余 300 \/ 500/)
  assert.match(text, /周积分\|剩余 10,000 \/ 10,000/)
  assert.match(text, /u2-asr 赠送额度\|剩余 30 \/ 30 小时/)
  assert.match(text, /u2-tts 赠送额度\|剩余 150,000 \/ 150,000 字/)
  const cooldown = treeNodes(screen).find(n => n.type?.name === 'ApiKeyCooldown')
  assert.equal(cooldown.props.limit.reason, 'tpm')
  assert.equal(cooldown.props.limit.estimated, true)
})

test('无限额度、免费用户与读取失败的用量行', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state.agnes = snapshotOf('agnes', { balance: { used: 1.5, limit: null, unlimited: true, unit: 'USD' } })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } }, connection: { rpc: { call(_p, _s, req) { return host.call(req.method, req.payload) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  render(); await tick()
  const open = async () => {
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 Agnes').props.onClick(); await tick(); render()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick(); return textOf(render())
  }
  let screen = await open()
  assert.match(screen, /已用 \$1\.50/); assert.match(screen, /无限额度/)
  host.state.agnes = snapshotOf('agnes', { balance: { used: 0, limit: null, unlimited: true, unit: 'USD' } })
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick(); render()
  screen = await open()
  assert.match(screen, /免费用户/)
  host.state.agnes = snapshotOf('agnes', { balance: { error: true } })
  treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick(); render()
  screen = await open()
  assert.match(screen, /读取失败/)
})

test('重进设置页：卡片快照从本地缓存恢复，只含公开字段', async () => {
  const storage = memoryStorage()
  const first = loadClient({ localStorage: storage }); const host = hostFixture()
  host.state.agnes = snapshotOf('agnes', { balance: { used: 2, limit: 10, unlimited: false, unit: 'USD' } })
  const store = first.module.createRouterStore(host.call, 'agnes')
  try { await store.load('agnes') } finally { store.dispose() }
  const raw = storage.getItem('eac-unified-router-cache-v1')
  assert.ok(raw, '快照落盘')
  assert.equal(JSON.parse(raw).apikeys.agnes.ready, undefined, '缓存里不存运行期标记')
  assert.equal(raw.includes('NEVER_DISPLAY'), false)
  const second = loadClient({ localStorage: storage })
  const restored = second.module.createRouterStore(async () => ({ ok: false }), 'agnes')
  try {
    const entry = restored.getSnapshot().apikeys.agnes
    assert.equal(entry.ready, true)
    assert.equal(entry.models.length, 2)
    assert.equal(restored.getSnapshot().loading, false, '有缓存时首屏不显示读取中')
  } finally { restored.dispose() }
})

test('API Key 与控制台会话表单只在保存成功后清空', async () => {
  for (const fixture of [
    ['agnes', 'Agnes', 'API Key', 'PlanKeyForm'],
    ['unisound', '云知声', '控制台会话', 'ConsoleCookieForm'],
  ]) {
    const { node, react } = await credentialFormFixture(...fixture)
    try { await assertClearsOnlyAfterSuccess(node, react) } finally { react.dispose() }
  }
})

test('云知声控制台登录可取消，在途时禁用粘贴且渠道页提供刷新', async () => {
  const { module, react } = loadClient(); const host = hostFixture(); let Settings
  host.state.unisound = snapshotOf('unisound', { hasConsoleSession: false, consoleLoginUrl: '', toolsSupported: true })
  let loginSignal
  host.overrides.set('apikey.consoleLogin', (_payload, signal) => {
    loginSignal = signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  const ctx = { slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_p, _s, req, signal) { return host.call(req.method, req.payload, signal) } } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  try {
    render(); await tick()
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 云知声').props.onClick(); await tick()
    treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
    assert.ok(treeNodes(render()).find(n => n.props['aria-label'] === '刷新渠道与用量'), '渠道页可直接刷新渠道与用量')
    treeNodes(render()).find(n => n.props['aria-label'] === '控制台会话 的更多操作').props.onClick()
    buttons(render()).find(n => (n.children || []).includes('浏览器登录')).props.onClick(); await tick()
    let tree = render()
    const cancel = buttons(tree).find(n => (n.children || []).includes('取消登录'))
    assert.ok(cancel, '登录在途时提供取消入口')
    assert.equal(buttons(tree).some(n => (n.children || []).includes('浏览器登录')), false)
    assert.equal(treeNodes(tree).find(n => n.type?.name === 'ConsoleCookieForm')?.props.disabled, true, '登录在途时禁止粘贴另一份会话')
    cancel.props.onClick(); await tick(); await tick()
    assert.equal(loginSignal.aborted, true, '取消必须中止实际在途请求')
    tree = render()
    assert.ok(buttons(tree).some(n => (n.children || []).includes('浏览器登录')))
    assert.equal(buttons(tree).some(n => (n.children || []).includes('取消登录')), false)
  } finally { react.dispose() }
})
