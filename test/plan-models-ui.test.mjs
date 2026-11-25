import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
const texts = tree => nodes(tree).flatMap(node => (node.children || []).filter(value => typeof value === 'string'))
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function harness() {
  const hooks = [], effects = []; let cursor = 0
  return {
    begin() { cursor = 0 }, flush() { for (const effect of effects.splice(0)) effect() },
    dispose() { for (const hook of hooks) hook?.cleanup?.() },
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) } },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial } },
    useState(initial) {
      const i = cursor++
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value }]
    },
    useEffect(run, deps) {
      const i = cursor++, old = hooks[i]
      if (!old || deps.some((dep, j) => dep !== old.deps[j])) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: run() } })
    },
  }
}

function setup() {
  const react = harness(), calls = []; let Settings, module
  const models = [
    { id: 'glm-5.2', name: 'glm-5.2', enabled: true, maxOutputLength: 65536, maxTokensOverride: null },
    { id: 'opaque-123', name: '厂商展示名称', enabled: true, maxOutputLength: 8192, maxTokensOverride: null },
    ...Array.from({ length: 36 }, (_, i) => ({ id: `model-${String(i).padStart(2, '0')}`, name: '', enabled: true, maxOutputLength: 16384, maxTokensOverride: null })),
  ]
  let failSave = false
  let quota = null
  const plan = () => ({ configured: true, hasApiKey: true, registerProvider: false, providerRegistered: false,
    planName: '计划', quotaError: '', shapeWarning: false, quotaKnown: true, pollSeconds: 60, pools: [], models, enabledModelIds: [], catalogAvailable: true, trend: { hours: 24, models: [] },
    quota })
  const rpc = async (method, payload, signal) => {
    calls.push({ method, payload, signal })
    if (method === 'plan.snapshot') return { ok: true, value: plan() }
    if (method === 'plan.setModelEnabled') {
      const model = models.find(item => item.id === payload.modelId)
      model.enabled = payload.enabled
      return { ok: true, value: { modelId: model.id, enabled: model.enabled } }
    }
    if (method === 'plan.setModelParams') {
      if (failSave) return { ok: false, error: { code: 'fixture', message: 'secret', details: {} } }
      const model = models.find(item => item.id === payload.modelId)
      model.maxTokensOverride = payload.params.maxTokens
      return { ok: true, value: { modelId: model.id, maxTokensOverride: model.maxTokensOverride, maxOutputLength: model.maxTokensOverride ?? model.maxOutputLength } }
    }
    if (method === 'provider.status') return { ok: true, value: { statuses: {} } }
    if (method === 'account.list') return { ok: true, value: { accounts: [] } }
    if (method === 'model.list') return { ok: true, value: { models: [] } }
    return { ok: true, value: {} }
  }
  const ctx = {
    slots: { inject(_slot, callback) { callback() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { call(_path, _service, req, signal) { return rpc(req.method, req.payload, signal) } } },
  }
  vm.runInNewContext(source, { URL, AbortController, window: { __ModuleLoader__: { load(spec) {
    module = spec.factory(() => react); module.apply(ctx)
  } } } })
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const clickTab = (tree, id) => {
    const tab = nodes(tree).find(node => node.props.id === id)
    assert.ok(tab, `找不到 ${id}`)
    tab.props.onClick()
    return render()
  }
  async function enterPlan() {
    render(); await tick()
    let tree = render()
    nodes(tree).find(node => node.props['aria-label'] === '切换到 商汤 Token Plan').props.onClick()
    await tick(); tree = render(); tree = render()
    return tree
  }
  return { react, calls, models, plan, rpc, module, render, clickTab, enterPlan, fail(value) { failSave = value }, setQuota(value) { quota = value } }
}

test('商汤默认打开模型，渠道分区分开提供 API Key 和控制台登录', async () => {
  const f = setup()
  try {
    let tree = await f.enterPlan()
    assert.deepEqual(nodes(tree).filter(n => n.props.role === 'tab' && n.props.id?.startsWith('eac-tab-')).map(n => n.props.id), ['eac-tab-models', 'eac-tab-advanced'])
    assert.ok(texts(tree).includes('模型目录'))
    assert.equal(texts(tree).includes('模型 API Key'), false)
    tree = f.clickTab(tree, 'eac-tab-advanced')
    assert.ok(nodes(tree).some(n => n.props['aria-label'] === '刷新渠道与用量'))
    assert.ok(texts(tree).includes('模型 API Key'))
    assert.ok(texts(tree).includes('浏览器登录'))
    assert.ok(texts(tree).includes('控制台额度'))
    assert.equal(texts(tree).includes('额度账号'), false)
    assert.equal(nodes(tree).some(n => n.props['aria-label'] === '搜索全部模型'), false)
    f.setQuota({ status: 'ready', plan: 'Free Plan', updatedAt: Date.now(), pools: [{
      name: '通用积分池', poolType: 'default', modelIds: ['glm-5.2'],
      window5h: { limit: 120000, remaining: 90000, resetAt: 1900000000 },
      window7d: { limit: 1200000, remaining: 1080000, resetAt: 1900100000 },
      grantBalance: 0,
    }] })
    nodes(tree).find(n => n.props['aria-label'] === '切换到 Raccoon').props.onClick()
    await tick(); f.render()
    tree = await f.enterPlan()
    tree = f.clickTab(tree, 'eac-tab-advanced')
    assert.ok(texts(tree).includes('5 小时积分'))
    assert.ok(texts(tree).includes('7 天积分'))
  } finally { f.react.dispose() }
})

test('商汤模型优先展示上游名称，已知 ID 使用友好别名并保留精确 ID', async () => {
  const f = setup()
  try {
    let tree = await f.enterPlan()
    tree = f.clickTab(tree, 'eac-tab-models')
    assert.ok(texts(tree).includes('GLM 5.2'))
    assert.ok(texts(tree).includes('glm-5.2'))
    assert.ok(texts(tree).includes('厂商展示名称'))
    assert.ok(texts(tree).includes('opaque-123'))
    assert.ok(texts(tree).includes('model-00'), '未知 ID 原样展示')
    assert.equal(nodes(tree).filter(n => n.props.className === 'eac-model').length, 15)
    const search = () => nodes(f.render()).find(n => n.props['aria-label'] === '搜索全部模型')
    search().props.onChange({ target: { value: 'GLM 5.2' } })
    tree = f.render()
    assert.ok(texts(tree).includes('glm-5.2'))
    search().props.onChange({ target: { value: 'opaque-123' } })
    tree = f.render()
    assert.ok(texts(tree).includes('厂商展示名称'))
    search().props.onChange({ target: { value: '' } })
    tree = f.render()
    const pager = nodes(tree).find(n => n.props['aria-label'] === '模型分页')
    assert.ok(pager)
    nodes(pager).find(n => n.type === 'button' && n.children.includes('下一页')).props.onClick()
    tree = f.render()
    assert.ok(texts(tree).includes('2 / 3'))
    nodes(nodes(tree).find(n => n.props['aria-label'] === '模型分页')).find(n => n.type === 'button' && n.children.includes('下一页')).props.onClick()
    tree = f.render()
    assert.ok(texts(tree).includes('model-35'), '超过 30 个模型也必须可访问')
  } finally { f.react.dispose() }
})

test('商汤逐模型开关与参数发送专用 RPC，保存失败保留编辑位置', async () => {
  const f = setup()
  try {
    let tree = f.clickTab(await f.enterPlan(), 'eac-tab-models')
    nodes(tree).find(n => n.props['aria-label'] === '搜索全部模型').props.onChange({ target: { value: 'glm-5.2' } })
    tree = f.render()
    nodes(tree).find(n => n.props['aria-label'] === '启用模型 GLM 5.2').props.onClick()
    await tick(); tree = f.render()
    assert.equal(f.calls.find(c => c.method === 'plan.setModelEnabled').payload.modelId, 'glm-5.2')
    assert.equal(nodes(tree).find(n => n.props['aria-label'] === '启用模型 GLM 5.2').props['aria-checked'], false)
    nodes(tree).find(n => n.type === 'button' && n.children.includes('参数')).props.onClick()
    tree = f.render()
    let editor = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    assert.ok(editor, '编辑器保持展开')
    editor.props.setValue({ maxTokens: '32000', contextWindow: '128000' })
    tree = f.render()
    editor = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    f.fail(true)
    await editor.props.onSave({ maxTokens: 32000, contextWindow: 128000 })
    tree = f.render()
    editor = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    assert.ok(editor, '保存失败后编辑器不收起')
    assert.equal(editor.props.value.maxTokens, '32000', '保存失败保留草稿')
    tree = f.clickTab(tree, 'eac-tab-advanced')
    tree = f.clickTab(tree, 'eac-tab-models')
    editor = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    assert.equal(editor.props.value.maxTokens, '32000', '切换分区也保留草稿')
    assert.equal(nodes(tree).find(n => n.props['aria-label'] === '搜索全部模型').props.value, 'glm-5.2')
    assert.equal(f.calls.filter(c => c.method === 'plan.setModelParams').at(-1).payload.params.maxTokens, 32000)
    assert.equal(f.calls.filter(c => c.method === 'plan.setModelParams').at(-1).payload.params.compat, undefined)
    f.fail(false)
    await editor.props.onSave({ maxTokens: 32000, contextWindow: 128000 })
    tree = f.render()
    editor = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    assert.equal(editor.props.model.maxTokensOverride, 32000)
    await editor.props.onSave(null)
    assert.equal(f.calls.filter(c => c.method === 'plan.setModelParams').at(-1).payload.params.maxTokens, null)
    assert.equal(f.calls.some(c => c.method === 'model.setParams'), false, '不得调用三渠道参数接口')
  } finally { f.react.dispose() }
})

test('在途额度轮询不能覆盖刚保存的模型设置', async () => {
  const f = setup(), pending = gate(); let snapshotCount = 0, visibility
  const document = { visibilityState: 'visible', addEventListener(_type, callback) { visibility = callback }, removeEventListener() {} }
  const react = harness(); let module
  vm.runInNewContext(source, { URL, AbortController, document, window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => react) } } } })
  const call = async (method, payload, signal) => {
    if (method === 'plan.snapshot' && ++snapshotCount > 1) return pending.promise
    return f.rpc(method, payload, signal)
  }
  const store = module.createRouterStore(call)
  try {
    await store.load('sensenova-token-plan')
    visibility()
    await tick()
    const write = store.planSetModelEnabled('glm-5.2', false)
    await write
    pending.resolve({ ok: true, value: { ...f.plan(), models: [{ id: 'glm-5.2', name: 'glm-5.2', enabled: true }] } })
    await tick()
    assert.equal(store.getSnapshot().plan.models.find(model => model.id === 'glm-5.2').enabled, false)
  } finally { store.dispose(); f.react.dispose(); react.dispose() }
})

test('首次读取失败后保留重试轮询，恢复成功清除失败提示', async () => {
  const f = setup(), timers = new Map(); let attempts = 0, module, nextTimer = 0
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id }
  const clearTimeout = id => timers.delete(id)
  vm.runInNewContext(source, { URL, AbortController, document, setTimeout, clearTimeout, window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => f.react) } } } })
  const call = async (method, payload, signal) => {
    if (method === 'plan.snapshot' && ++attempts === 1) throw new Error('offline')
    return f.rpc(method, payload, signal)
  }
  const store = module.createRouterStore(call)
  try {
    await store.load('sensenova-token-plan')
    assert.equal(store.getSnapshot().planError, true)
    assert.equal(timers.size, 1, '失败后仍应等待下一次轮询')
    const [[id, retry]] = timers; timers.delete(id)
    await retry()
    assert.equal(store.getSnapshot().planError, false)
    assert.equal(store.getSnapshot().notice, '')
  } finally { store.dispose(); f.react.dispose() }
})

test('后台初次加载不轮询，返回前台后恢复读取', async () => {
  const f = setup(), timers = []; let listener, module
  const document = { visibilityState: 'hidden', addEventListener(_type, callback) { listener = callback }, removeEventListener() {} }
  const setTimeout = callback => { timers.push(callback); return timers.length }
  vm.runInNewContext(source, { URL, AbortController, document, setTimeout, clearTimeout() {}, window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => f.react) } } } })
  const store = module.createRouterStore(f.rpc)
  try {
    await store.load('sensenova-token-plan')
    assert.equal(timers.length, 0)
    assert.equal(typeof listener, 'function')
    document.visibilityState = 'visible'; listener(); await tick()
    assert.equal(f.calls.filter(call => call.method === 'plan.snapshot').length, 1)
    assert.ok(timers.length > 0)
  } finally { store.dispose(); f.react.dispose() }
})

test('旧轮询无视取消且切回商汤，不清除新页面的定时器', async () => {
  const f = setup(), timers = new Map(), pending = gate(); let module, nextTimer = 0, snapshots = 0
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id }
  const clearTimeout = id => timers.delete(id)
  vm.runInNewContext(source, { URL, AbortController, document, setTimeout, clearTimeout, window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => f.react) } } } })
  const call = async (method, payload, signal) => {
    if (method === 'plan.snapshot' && ++snapshots === 2) return pending.promise
    return f.rpc(method, payload, signal)
  }
  const store = module.createRouterStore(call)
  try {
    await store.load('sensenova-token-plan')
    const [[oldId, oldTimer]] = timers; timers.delete(oldId)
    const oldPolling = oldTimer()
    await tick(); await store.load('raccoon'); await store.load('sensenova-token-plan')
    const currentTimers = [...timers.keys()]
    assert.equal(currentTimers.length, 1)
    pending.resolve({ ok: true, value: f.plan() })
    await oldPolling
    assert.deepEqual([...timers.keys()], currentTimers, '旧回调不能取消新轮询')
  } finally { store.dispose(); f.react.dispose() }
})

test('首次额度请求途中隐藏页面会取消，重新显示后恢复', async () => {
  const f = setup(), pending = gate(); let listener, module, firstSignal, attempts = 0
  const document = { visibilityState: 'visible', addEventListener(_type, callback) { listener = callback }, removeEventListener() {} }
  vm.runInNewContext(source, { URL, AbortController, document, window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => f.react) } } } })
  const call = async (method, payload, signal) => {
    if (method === 'plan.snapshot' && ++attempts === 1) { firstSignal = signal; return pending.promise }
    return f.rpc(method, payload, signal)
  }
  const store = module.createRouterStore(call)
  try {
    const initial = store.load('sensenova-token-plan'); await tick()
    document.visibilityState = 'hidden'; listener()
    assert.equal(firstSignal.aborted, true)
    assert.equal(store.getSnapshot().loading, false)
    pending.resolve({ ok: true, value: f.plan() }); await initial
    assert.equal(store.getSnapshot().plan, null)
    document.visibilityState = 'visible'; listener(); await tick()
    assert.ok(store.getSnapshot().plan)
  } finally { store.dispose(); f.react.dispose() }
})

test('商汤写操作延迟完成时切换渠道，不强行跳回商汤', async () => {
  const f = setup(), wait = gate()
  const call = async (method, payload, signal) => method === 'plan.setKey' ? wait.promise : f.rpc(method, payload, signal)
  const store = f.module.createRouterStore(call)
  try {
    await store.load('sensenova-token-plan')
    const pending = store.planSetKey('sk-fixture')
    await tick()
    await store.load('raccoon')
    wait.resolve({ ok: true, value: { hasApiKey: true } })
    await pending
    assert.equal(store.getSnapshot().provider, 'raccoon')
  } finally { store.dispose(); f.react.dispose() }
})
