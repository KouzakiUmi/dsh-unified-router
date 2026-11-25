import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]

function setup({ saveParams, model = {}, paged = false, catalog } = {}) {
  const hooks = [], effects = [], calls = []
  const params = {}
  let cursor = 0, Settings
  // 目录=上游原样：**没有 stale / 备选 / 默认禁用**（策展层已整体移除）。
  const models = catalog ?? (paged
    ? Array.from({ length: 40 }, (_, i) => ({ id: `m-${i}`, name: `模型 ${i}`, disabled: false }))
    : [
      { id: 'main', name: '免费本家', disabled: false },
      { id: 'second', name: '第二个模型', disabled: false, contextWindow: 1000000, supportsImage: true, ...model },
    ])
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value }]
    },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial } },
    useEffect(run, deps) {
      const i = cursor++, old = hooks[i]
      if (!old || deps.some((d, k) => d !== old.deps[k])) effects.push(() => {
        old?.cleanup?.(); hooks[i] = { deps, cleanup: run() }
      })
    },
  }
  const ctx = {
    slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
    connection: { rpc: { async call(_path, _service, req) {
      calls.push(req)
      const { method, payload } = req
      if (method === 'model.setDisabled') models.find(m => m.id === payload.modelId).disabled = payload.disabled
      // 恢复推荐 = 清空显示偏好：全部回到「跟随目录」（目录里没有推荐标记，即全部启用）。
      if (method === 'model.resetDefaults') for (const m of models) m.disabled = false
      if (method === 'model.setParams') {
        if (saveParams) await saveParams(payload)
        params[payload.modelId] = payload.params
      }
      const value = method === 'model.list'
        ? { models }
        : method === 'provider.status' ? { statuses: {} }
        : method === 'account.list' ? { accounts: [] }
        : ['model.params', 'model.setParams'].includes(method) ? { params } : {}
      return { ok: true, value }
    } } },
  }
  // 默认渠道用单面渠道（TRAE）：Raccoon 家族是两张模型面，客户端对多组模型不分页，
  // 而本文件验的正是单列表分页。
  const localStorage = { getItem: key => key === 'eac-unified-router-last-provider' ? 'trae' : null, setItem() {}, removeItem() {} }
  vm.runInNewContext(source, { URL, AbortController, localStorage, window: { __ModuleLoader__: { load(spec) {
    spec.factory(() => react).apply(ctx)
  } } } })
  const render = () => {
    cursor = 0
    const tree = Settings({ ctx })
    for (const run of effects.splice(0)) run()
    return tree
  }
  return { render, calls, cleanup() { for (const h of hooks) h?.cleanup?.() } }
}

function modelRows(tree) { return nodes(tree).filter(n => n.props.className === 'eac-model') }
function switchOf(tree, label) { return nodes(tree).find(n => n.props.role === 'switch' && n.props['aria-label'] === `启用模型 ${label}`) }
async function openModels(f) {
  f.render(); await tick()
  const tree = f.render()
  nodes(tree).find(n => n.props.id === 'eac-tab-models').props.onClick()
  return f.render()
}

test('无排除项的目录可手动关闭模型，恢复推荐会清空显示偏好', async () => {
  const f = setup()
  try {
    let tree = await openModels(f)
    // 目录里没有「推荐/备选」标记，所有模型默认都是启用态。
    assert.equal(modelRows(tree).length, 2)
    assert.equal(switchOf(tree, '第二个模型').props['aria-checked'], true)
    switchOf(tree, '第二个模型').props.onClick()
    // 在途写操作期间该项禁用，防止连点。
    assert.equal(switchOf(f.render(), '第二个模型').props.disabled, true)
    await tick()
    tree = f.render()
    assert.equal(switchOf(tree, '第二个模型').props['aria-checked'], false)
    assert.equal(f.calls.find(c => c.method === 'model.setDisabled').payload.disabled, true)
    nodes(tree).find(n => n.type === 'button' && n.children.includes('恢复推荐')).props.onClick()
    await tick()
    tree = f.render()
    assert.ok(f.calls.some(c => c.method === 'model.resetDefaults'))
    assert.equal(switchOf(tree, '第二个模型').props['aria-checked'], true)
    assert.equal(modelRows(tree).length, 2, '恢复推荐只改显示偏好，不改变目录内容')
  } finally { f.cleanup() }
})

test('启用优先在分页前执行，旧版与倍率提示在共用列表中绘制', async () => {
  const f = setup({ catalog: [
    ...Array.from({ length: 16 }, (_, i) => ({ id: `old-${i}`, name: `模型 ${i}`, disabled: true })),
    { id: 'qwen-3-8-max', disabled: true },
    { id: 'qwen4-max', contextWindow: 1_000_000, supportsImage: true, rate: { label: 'x0.50', tone: 'neutral' } },
    { id: 'glm-5-3-flash', contextWindow: 1_000_000, supportsImage: true, rate: { label: 'x0.25', tone: 'neutral' } },
    { id: 'step-5-preview', contextWindow: 1_000_000, supportsImage: true, rate: { label: '参考 x0.75', tone: 'neutral' } },
  ] })
  try {
    let tree = await openModels(f)
    assert.equal(switchOf(tree, 'Qwen 4 Max').props['aria-checked'], true)
    assert.ok(nodes(tree).some(n => n.children.includes('性价比偏低')))
    assert.ok(nodes(tree).some(n => n.children.includes('参考 x0.75')))
    const old = nodes(tree).find(n => n.props.type === 'search')
    old.props.onChange({ target: { value: '3.8' } })
    tree = f.render()
    assert.ok(nodes(tree).some(n => n.children.includes('旧版')))
    old.props.onChange({ target: { value: '' } })
    tree = f.render()
    nodes(tree).find(n => n.props.type === 'checkbox' && n.props.checked).props.onChange({ target: { checked: false } })
    assert.equal(switchOf(f.render(), 'Qwen 4 Max'), undefined)
  } finally { f.cleanup() }
})

test('搜索按名称/ID 命中，清空后回到完整列表且不误报没有匹配', async () => {
  const f = setup()
  try {
    let tree = await openModels(f)
    nodes(tree).find(n => n.props.type === 'search').props.onChange({ target: { value: '第二个' } })
    tree = f.render()
    assert.equal(nodes(tree).some(n => n.children.includes('没有匹配的模型。')), false)
    assert.equal(modelRows(tree).length, 1)
    nodes(tree).find(n => n.props.type === 'search').props.onChange({ target: { value: 'second' } })
    assert.equal(modelRows(f.render()).length, 1, '按模型 ID 也能搜到')
    nodes(tree).find(n => n.props.type === 'search').props.onChange({ target: { value: '' } })
    assert.equal(modelRows(f.render()).length, 2)
  } finally { f.cleanup() }
})

function paramsNode(tree) {
  return nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'ModelParams')
}
function tier(tree, label) {
  const component = paramsNode(tree)
  assert.ok(component, '参数编辑器应保持展开')
  return nodes(component.type(component.props)).find(n => ['eac-tier', 'eac-context-segment'].includes(n.props.className) && n.children.includes(label))
}
/** 打开「第二个模型」的参数编辑器（列表是扁平的，参数按钮在行内）。 */
async function editSecond(f) {
  let tree = await openModels(f)
  nodes(tree).find(n => n.props.type === 'search').props.onChange({ target: { value: '第二个' } })
  tree = f.render()
  nodes(tree).find(n => n.type === 'button' && n.children.includes('参数')).props.onClick()
  return f.render()
}

test('单一列表分页，搜索后回到第一页', async () => {
  const f = setup({ paged: true })
  const pager = tree => nodes(tree).find(n => n.props['aria-label'] === '模型分页')
  const pageText = tree => nodes(pager(tree)).find(n => n.type === 'span').children.join('')
  const next = tree => nodes(pager(tree)).find(n => n.type === 'button' && n.children.includes('下一页'))
  try {
    let tree = await openModels(f)
    assert.equal(modelRows(tree).length, 15, '一页 15 条')
    assert.equal(pageText(tree), '1 / 3')
    next(tree).props.onClick()
    tree = f.render()
    assert.equal(pageText(tree), '2 / 3')
    assert.equal(modelRows(tree).length, 15)
    const search = nodes(tree).find(n => n.props.type === 'search')
    search.props.onChange({ target: { value: '模型 3' } })
    tree = f.render()
    // 「模型 3」命中 11 条（模型 3 与 30-39）：不足一页时分页整块消失。
    assert.equal(pager(tree), undefined, '结果不足一页不显示分页')
    assert.equal(modelRows(tree).length, 11)
    search.props.onChange({ target: { value: '' } })
    tree = f.render()
    assert.equal(pageText(tree), '1 / 3', '清空搜索回到第一页')
  } finally { f.cleanup() }
})

test('保存模型配置不收起编辑器、不重拉列表，连续修改保留搜索与模型启停', async () => {
  let resolveSave
  const pending = new Promise(resolve => { resolveSave = resolve })
  let saves = 0
  const f = setup({ saveParams: () => ++saves === 1 ? pending : Promise.resolve() })
  try {
    let tree = await editSecond(f)
    // 进「模型」分区会自动补拉一次目录（后台，晚于首次渲染落地），补拉完成后还会
    // 重读一次 model.list。这里先等它结算：本用例要断言的是「**保存参数**不重拉
    // 列表」，不能把自动补拉的那次读取算进来。
    await tick(); await tick()
    tree = f.render()
    const initialReads = f.calls.filter(c => c.method === 'model.list').length
    tier(tree, '256K').props.onClick()
    tree = f.render()
    assert.ok(paramsNode(tree), '保存期间不能自动收起参数')
    assert.equal(tier(tree, '500K').props.disabled, true)
    assert.equal(nodes(tree).find(n => n.props.type === 'search').props.value, '第二个')
    resolveSave(); await tick()
    tree = f.render()
    assert.equal(tier(tree, '256K').props['aria-pressed'], true)
    assert.equal(f.calls.filter(c => c.method === 'model.list').length, initialReads)
    assert.equal(switchOf(tree, '第二个模型').props['aria-checked'], true)
    tier(tree, '500K').props.onClick()
    await tick()
    tree = f.render()
    assert.equal(tier(tree, '500K').props['aria-pressed'], true)
    assert.equal(f.calls.filter(c => c.method === 'model.setParams').length, 2)
    assert.equal(nodes(tree).find(n => n.props.id === 'eac-tab-models').props['aria-selected'], true)
  } finally { resolveSave(); f.cleanup() }
})

test('保存配置失败仍留在原模型编辑器，并保留原配置供重试', async () => {
  const f = setup({ saveParams: async () => { throw new Error('fixture failure') } })
  try {
    let tree = await editSecond(f)
    tier(tree, '500K').props.onClick()
    await tick()
    tree = f.render()
    assert.ok(paramsNode(tree))
    assert.equal(paramsNode(tree).props.value, undefined)
    assert.equal(nodes(tree).find(n => n.props.type === 'search').props.value, '第二个')
    assert.equal(tier(tree, '500K').props.disabled, false)
    assert.ok(nodes(tree).some(n => n.children.some(c => typeof c === 'string' && c.includes('操作失败'))))
  } finally { f.cleanup() }
})


test('显示真实默认参数，自定义后默认值不被覆盖，点击默认恢复跟随', async () => {
  const f = setup({ model: { maxTokens: 131072, defaultMaxTokens: 65536, efforts: ['low', 'high'], defaultEffort: 'high' } })
  try {
    let tree = await editSecond(f)
    assert.equal(tier(tree, '1M').props['aria-pressed'], true)
    assert.equal(tier(tree, '64K').props['aria-pressed'], true)
    assert.equal(tier(tree, '高').props['aria-pressed'], true)
    assert.equal(tier(tree, '开').props['aria-pressed'], true)
    assert.equal(tier(tree, '默认（64K）'), undefined)
    assert.equal(tier(tree, '默认（高）'), undefined)
    const defaults = () => nodes(tree).find(n => n.props.className === 'eac-model-defaults').children.join('')
    assert.match(defaults(), /上下文 1M · 输出 64K · 思考 高 · 支持图片/)
    tier(tree, '256K').props.onClick(); await tick()
    tree = f.render()
    assert.equal(tier(tree, '256K').props['aria-pressed'], true)
    assert.equal(tier(tree, '1M').props['aria-pressed'], false)
    assert.match(defaults(), /上下文 1M/)
    assert.ok(nodes(tree).some(n => n.children.some(c => typeof c === 'string' && c.includes('自定义 上下文 256K'))))
    tier(tree, '1M').props.onClick(); await tick()
    tree = f.render()
    assert.equal(tier(tree, '1M').props['aria-pressed'], true)
    const writes = f.calls.filter(c => c.method === 'model.setParams')
    assert.equal(writes.at(-1).payload.params.contextWindow, undefined)
  } finally { f.cleanup() }
})

test('未公布的默认值不冒充已确认的参数', async () => {
  const f = setup({ model: { maxTokens: 131072, efforts: ['low', 'high'], defaultEffort: 'invalid' } })
  try {
    const tree = await editSecond(f)
    const component = paramsNode(tree)
    const editor = component.type(component.props)
    const groups = nodes(editor).filter(n => n.props.className === 'eac-param-group')
    const output = groups.find(n => nodes(n).some(child => child.children.includes('输出上限')))
    assert.ok(nodes(output).some(n => n.children.includes('清除覆盖')))
    assert.equal(nodes(output).some(n => n.children.includes('默认（128K）')), false)
    assert.ok(nodes(editor).some(n => n.children.includes('清除覆盖')))
    const summary = nodes(tree).find(n => n.props.className === 'eac-model-defaults').children.join('')
    assert.doesNotMatch(summary, /输出|思考|invalid/)
  } finally { f.cleanup() }
})
