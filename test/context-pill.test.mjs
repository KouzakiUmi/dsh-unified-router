import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
const texts = tree => nodes(tree).flatMap(node => (node.children || []).filter(value => typeof value === 'string'))

function harness() {
  const hooks = [], effects = []; let cursor = 0
  const api = {
    begin() { cursor = 0 }, flush() { for (const effect of effects.splice(0)) effect() },
    dispose() { for (const hook of hooks) hook?.cleanup?.(); hooks.length = 0 },
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
  api.useCallback = callback => callback
  api.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  return api
}

/**
 * 挂载 lib/client.js 并拿到 ContextTierPill：
 * apply() 会注册 settings.section（忽略）+ conversation.input.right（捕获视图）。
 */
function setup({ directory, rpc }) {
  const react = harness()
  let Pill = null, slot
  const ctx = {
    slots: {
      inject(_slot, callback) { callback() },
      register(spec, view) { if (spec.id === 'unified-router-context-tier') { Pill = view; slot = spec } },
    },
    inject(deps, fn) { if (deps.every(d => depsServices[d])) fn(depsServices) },
    connection: { rpc: { call(_path, _service, req, signal) { return rpc(req.method, req.payload, signal) } } },
  }
  const depsServices = {
    modelDirectories: { directoryFor: () => ({ store: directory }) },
    effect(fn) { return typeof fn === 'function' ? fn() : undefined },
    slots: ctx.slots,
  }
  vm.runInNewContext(source, { URL, AbortController, window: { __ModuleLoader__: { load(spec) {
    spec.factory(() => react).apply(ctx)
  } } } })
  assert.ok(Pill, 'apply() 未注册 conversation.input.right 药丸')
  let key
  const render = () => {
    const entry = Pill(slot.inject('s1'))
    if (entry?.props.key !== key) { react.dispose(); key = entry?.props.key }
    if (!entry) return null
    react.begin()
    const tree = entry.type(entry.props)
    react.flush()
    return tree
  }
  const tierButtons = tree => nodes(tree).filter(node => node.props.className === 'eac-context-segment')
  return { react, ctx, render, tierButtons }
}

const store = initial => {
  let state = initial
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { state = next; for (const listener of listeners) listener() },
  }
}

test('药丸只对 Unified Router 渠道出现，非本插件 provider 渲染 null', async () => {
  const calls = []
  const f = setup({
    directory: store({ current: { provider: 'some-other-plugin', model: 'm' } }),
    rpc: async (method, payload) => { calls.push(method); return { ok: true, value: {} } },
  })
  const tree = f.render()
  await tick()
  assert.equal(tree, null)
  assert.deepEqual(calls, [], '外部渠道不得发起本插件 RPC')
})

test('pack 渠道按目录容量出档，覆盖档位高亮，点击发 contextOnly 单字段写', async () => {
  const calls = []
  const directory = store({ current: { provider: 'loomy', model: 'm1' } })
  const f = setup({
    directory,
    rpc: async (method, payload) => {
      calls.push({ method, payload })
      if (method === 'model.list') return { ok: true, value: { models: [
        { id: 'm1', name: 'm1', contextWindow: 1_000_000 },
        { id: 'm2', name: 'm2', contextWindow: 400_000 },
      ] } }
      if (method === 'model.params') return { ok: true, value: { contextQuickWrite: true, provider: 'loomy', params: { m1: { contextWindow: 500_000 } } } }
      if (method === 'model.setParams') return { ok: true, value: { provider: 'loomy', params: { m1: { contextWindow: payload.params?.contextWindow } } } }
      return { ok: false, error: { code: 'x', message: 'x' } }
    },
  })
  let tree = f.render()
  await tick(); tree = f.render()
  const buttons = f.tierButtons(tree)
  const labels = buttons.map(b => b.children.join(''))
  assert.deepEqual(labels, ['256K', '500K', '1M'])
  assert.equal(nodes(tree).find(node => node.props.role === 'group').props.className, 'eac-context-tiers')
  assert.equal(calls.find(call => call.method === 'model.list').payload.snapshot, true)
  assert.equal(buttons.find(b => b.children.includes('500K')).props['aria-pressed'], true, '覆盖 500K 应高亮')
  const pick = buttons.find(b => b.children.includes('256K'))
  assert.ok(!pick.props.disabled, '256K 档应可点击')
  // pack 写必须带 contextOnly，不替换整行参数。
  pick.props.onClick()
  await tick(); tree = f.render()
  const write = calls.find(c => c.method === 'model.setParams')
  // payload 在 VM 内构造，原型不同，逐字段断言
  assert.equal(write.payload.provider, 'loomy')
  assert.equal(write.payload.modelId, 'm1')
  assert.equal(write.payload.contextOnly, true)
  assert.equal(write.payload.params.contextWindow, 256_000)
  assert.equal(Object.keys(write.payload.params).length, 1)
  tree = f.render()
  assert.equal(f.tierButtons(tree).find(b => b.children.includes('256K')).props['aria-pressed'], true, '写后高亮跟随新档位')
})

test('已设输出上限时冲突档位置灰，默认档在默认窗口装不下时同样不可选', async () => {
  const directory = store({ current: { provider: 'loomy', model: 'm1' } })
  const calls = []
  const f = setup({
    directory,
    rpc: async (method, payload) => {
      calls.push({ method, payload })
      if (method === 'model.list') return { ok: true, value: { models: [{ id: 'm1', contextWindow: 200_000 }] } }
      if (method === 'model.params') return { ok: true, value: { contextQuickWrite: true, provider: 'loomy', params: { m1: { maxTokens: 300_000, contextWindow: 500_000 } } } }
      return { ok: true, value: {} }
    },
  })
  let tree = f.render()
  await tick(); tree = f.render()
  const buttons = f.tierButtons(tree)
  const def = buttons.find(b => b.props['aria-label'] === '默认上下文')
  assert.equal(def.props.disabled, true)
  assert.match(def.props.title, /输出预留 300K/)
  assert.equal(buttons.length, 1, '恢复默认与默认档应为同一按钮')
})

test('plan 渠道走 plan.snapshot/plan.setModelParams，恢复默认写 contextWindow:null', async () => {
  const calls = []
  const directory = store({ current: { provider: 'sensenova-token-plan', model: 'glm' } })
  const f = setup({
    directory,
    rpc: async (method, payload) => {
      calls.push({ method, payload })
      if (method === 'plan.snapshot') return { ok: true, value: { models: [
        { id: 'glm', name: 'glm', contextWindow: 256_000, defaultContextWindow: 500_000, params: { contextWindow: 256_000 } },
      ] } }
      if (method === 'plan.setModelParams') return { ok: true, value: {} }
      return { ok: false, error: { code: 'x', message: 'x' } }
    },
  })
  let tree = f.render()
  await tick(); tree = f.render()
  assert.equal(f.tierButtons(tree).find(b => b.children.includes('256K')).props['aria-pressed'], true)
  // 默认档 = 清除覆盖（merge 语义：contextWindow:null）
  f.tierButtons(tree).find(b => b.props['aria-label'] === '默认上下文 500K').props.onClick()
  await tick()
  const write = calls.find(c => c.method === 'plan.setModelParams')
  assert.equal(calls.find(call => call.method === 'plan.snapshot').payload.snapshot, true, '输入栏不触发额度采集')
  assert.equal(write.payload.provider, 'sensenova-token-plan')
  assert.equal(write.payload.modelId, 'glm')
  assert.equal(write.payload.params.contextWindow, null)
  assert.equal('contextWindow' in write.payload.params, true, '恢复默认必须显式写 null 而不是省略字段')
})

test('切换 provider/模型会重新取数，不沿用旧档位', async () => {
  const calls = []
  const directory = store({ current: { provider: 'loomy', model: 'm1' } })
  const f = setup({
    directory,
    rpc: async (method, payload) => {
      calls.push({ method, payload })
      if (method === 'model.list') return { ok: true, value: { models: [
        { id: 'm1', contextWindow: 1_000_000 },
        { id: 'm2', contextWindow: 400_000 },
      ] } }
      if (method === 'model.params') return { ok: true, value: { contextQuickWrite: true, params: { m1: { contextWindow: 1_000_000 } } } }
      return { ok: false, error: { code: 'x', message: 'x' } }
    },
  })
  let tree = f.render()
  await tick(); tree = f.render()
  assert.equal(f.tierButtons(tree).find(b => b.children.includes('1M')).props['aria-pressed'], true)
  // 换到 m2（无覆盖、容量 400K）：不得沿用 m1 的 1M 高亮
  directory.set({ current: { provider: 'loomy', model: 'm2' } })
  await tick()
  assert.equal(f.render(), null, '切换后新目录准备好前不能点旧模型的档位')
  await tick(); tree = f.render()
  const labels = f.tierButtons(tree).map(b => b.children.join(''))
  assert.deepEqual(labels, ['256K', '默认'], '非标准容量放在默认档，不另造 400K')
  assert.equal(f.tierButtons(tree)[1].props['aria-pressed'], true, 'm2 无覆盖应高亮默认')
  assert.ok(calls.filter(c => c.method === 'model.list').length >= 2, '换模型应重新取目录')
})

test('managed 渠道走 managed.models/managed.setModelParams', async () => {
  const calls = []
  const directory = store({ current: { provider: 'codearts', model: 'openpangu-2.0-flash' } })
  const f = setup({
    directory,
    rpc: async (method, payload) => {
      calls.push({ method, payload })
      if (method === 'managed.models') return { ok: true, value: { provider: 'codearts', models: [
        { id: 'openpangu-2.0-flash', name: 'OpenPangu 2.0 Flash', contextWindow: 524_288, params: {} },
      ] } }
      if (method === 'managed.setModelParams') return { ok: true, value: {} }
      return { ok: false, error: { code: 'x', message: 'x' } }
    },
  })
  let tree = f.render()
  await tick(); tree = f.render()
  const pick = f.tierButtons(tree).find(b => b.children.includes('256K'))
  assert.ok(pick)
  pick.props.onClick()
  await tick()
  const write = calls.find(c => c.method === 'managed.setModelParams')
  assert.equal(write.payload.provider, 'codearts')
  assert.equal(write.payload.modelId, 'openpangu-2.0-flash')
  assert.equal(write.payload.params.contextWindow, 256_000)
})

test('重试读取与保存失败都可恢复；1M 默认按渠道原值绑定', async () => {
  let readFails = true, writeFails = true
  const writes = []
  const f = setup({
    directory: store({ current: { provider: 'agnes', model: 'agnes-3.0-flash' } }),
    rpc: async (method, payload) => {
      if (method === 'apikey.snapshot') {
        assert.equal(payload.snapshot, true)
        return readFails ? { ok: false } : { ok: true, value: { models: [{
          id: 'agnes-3.0-flash', defaultContextWindow: 1_048_576, params: { contextWindow: 500_000 },
        }] } }
      }
      assert.equal(method, 'apikey.setModelParams')
      writes.push(payload.params.contextWindow)
      return { ok: !writeFails }
    },
  })
  f.render(); await tick()
  const retry = nodes(f.render()).find(n => n.props.className === 'eac-context-retry')
  assert.deepEqual(retry.children, ['重试读取模型信息'])
  readFails = false; retry.props.onClick()
  f.render(); await tick()
  const buttons = f.tierButtons(f.render())
  assert.match(buttons.at(-1).props.title, /1,048,576/)
  buttons[0].props.onClick(); await tick()
  const unsuccessful = f.render()
  assert.equal(unsuccessful.props['data-error'], true)
  assert.equal(unsuccessful.props['data-error-message'], '保存失败 · 可重试')
  assert.ok(texts(unsuccessful).includes('保存失败 · 可重试'))
  assert.equal(f.tierButtons(unsuccessful).find(b => b.children.includes('500K')).props['aria-pressed'], true)
  writeFails = false
  f.tierButtons(unsuccessful)[0].props.onClick(); await tick()
  assert.deepEqual(writes, [256_000, 256_000])
  assert.equal(f.tierButtons(f.render())[0].props['aria-pressed'], true)
  assert.ok(nodes(f.render()).some(n => n.props.role === 'status' && n.children.includes('上下文设置已保存')))
})

test('分段方向键和 Home/End 只导航，不提交；跳过不可用档', async () => {
  const f = setup({ directory: store({ current: { provider: 'agnes', model: 'm' } }), rpc: async method => {
    assert.equal(method, 'apikey.snapshot')
    return { ok: true, value: { models: [{ id: 'm', defaultContextWindow: 1_000_000, params: { maxTokens: 300_000 } }] } }
  } })
  f.render(); await tick()
  const tree = f.render()
  assert.equal(f.tierButtons(tree)[0].props.disabled, true)
  const group = nodes(tree).find(n => n.props.role === 'group')
  const focused = []
  const options = ['500K', '1M'].map(label => ({ focus: () => focused.push(label) }))
  const event = (key, target) => ({ key, currentTarget: { querySelectorAll: () => options }, target,
    preventDefault: () => focused.push('prevented') })
  group.props.onKeyDown(event('ArrowRight', options[0]))
  group.props.onKeyDown(event('Home', options[1]))
  group.props.onKeyDown(event('End', options[0]))
  group.props.onKeyDown(event('Enter', options[1]))
  assert.deepEqual(focused, ['prevented', '1M', 'prevented', '500K', 'prevented', '1M'])
  f.react.dispose()
})

test('等待保存时立即高亮目标档并锁定组，结算后只在原控件内恢复焦点', async () => {
  let finish
  const f = setup({ directory: store({ current: { provider: 'agnes', model: 'm' } }), rpc: async method => {
    return method === 'apikey.snapshot'
      ? { ok: true, value: { models: [{ id: 'm', defaultContextWindow: 1_000_000 }] } }
      : new Promise(resolve => { finish = resolve })
  } })
  f.render(); await tick()
  let tree = f.render()
  let focused = 0
  const doc = { body: {} }
  const target = { ownerDocument: doc, focus: () => { focused++ } }
  doc.activeElement = target
  tree.props.ref.current = { ownerDocument: doc, contains: el => el === target }
  f.tierButtons(tree)[0].props.onClick({ currentTarget: target })
  tree = f.render()
  assert.equal(tree.props['data-disabled'], true)
  assert.equal(f.tierButtons(tree)[0].props['aria-pressed'], true)
  assert.ok(f.tierButtons(tree).every(button => button.props.disabled))
  doc.activeElement = {}
  finish({ ok: false }); await tick()
  tree = f.render()
  assert.equal(f.tierButtons(tree).at(-1).props['aria-pressed'], true)
  assert.equal(focused, 0)
  doc.activeElement = target
  f.tierButtons(tree)[0].props.onClick({ currentTarget: target })
  f.render()
  doc.activeElement = doc.body
  finish({ ok: true }); await tick()
  assert.equal(f.tierButtons(f.render())[0].props['aria-pressed'], true)
  assert.equal(focused, 1)
  f.react.dispose()
})

test('共用渠道后端未确认单字段写能力时不显示药丸', async () => {
  const f = setup({
    directory: store({ current: { provider: 'loomy', model: 'm1' } }),
    rpc: async method => method === 'model.list'
      ? { ok: true, value: { models: [{ id: 'm1', contextWindow: 500_000 }] } }
      : { ok: true, value: { params: {} } },
  })
  f.render(); await tick()
  assert.equal(f.render(), null)
})

test('不超过 256K 只有一个渠道默认档，不为同一窗口发出覆盖写入', async () => {
  for (const [capacity, label] of [[200_000, '默认'], [256_000, '256K'], [262_144, '256K']]) {
    const calls = []
    const f = setup({
      directory: store({ current: { provider: 'agnes', model: 'm1' } }),
      rpc: async method => {
        calls.push(method)
        return { ok: true, value: { models: [{ id: 'm1', defaultContextWindow: capacity, params: {} }] } }
      },
    })
    f.render(); await tick()
    const [only, ...rest] = f.tierButtons(f.render())
    assert.deepEqual(rest, [])
    assert.deepEqual(only.children, [label])
    assert.equal(only.props['aria-pressed'], true)
    only.props.onClick()
    assert.deepEqual(calls, ['apikey.snapshot'])
    f.react.dispose()
  }
})

test('同一模型的目录刷新后会重新读取设置页写入的档位', async () => {
  const current = { provider: 'agnes', model: 'm1' }
  const directory = store({ current, groups: [] })
  let override = 500_000
  const f = setup({ directory, rpc: async () => ({ ok: true, value: { models: [
    { id: 'm1', defaultContextWindow: 1_048_576, params: { contextWindow: override } },
  ] } }) })
  f.render(); await tick()
  assert.equal(f.tierButtons(f.render())[1].props['aria-pressed'], true)
  override = 256_000
  directory.set({ current, groups: [] })
  f.render(); await tick()
  assert.equal(f.tierButtons(f.render())[0].props['aria-pressed'], true)
  f.react.dispose()
})
