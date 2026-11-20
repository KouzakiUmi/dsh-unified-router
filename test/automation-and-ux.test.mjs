import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { createAutomationSettings } from '../lib/automation-settings.js'
import { createDailyCheckin } from '../lib/daily-checkin.js'
import { createAutoTasks } from '../lib/auto-tasks.js'
import { officialModelSpec, channelOutputHardCap } from '../lib/model-catalog.js'
import { TRAE } from '../vendor/channel-pack/src/trae-product.ts'

const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

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

function loadClient(react = reactHarness()) {
  let module
  vm.runInNewContext(clientSource, {
    URL, AbortController, navigator: {},
    window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => react) } } },
  }, { filename: 'client.js' })
  return { module, react }
}

function treeNodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(treeNodes)]
}

test('自动化配置持久化：全局默认（autoCompleteTasks 默认关闭）、分渠道覆盖与恢复继承', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'automation.json')

  const first = createAutomationSettings({ file, allowedProviders: ['loomy', 'astudio', 'doubaowork'] })
  assert.equal(first.isAutoCheckinEnabled('loomy'), true)
  assert.equal(first.isAutoClaimRewardsEnabled('astudio'), true)
  assert.equal(first.isAutoCompleteTasksEnabled('doubaowork'), false, '主动执行完成任务默认必须关闭')

  await first.update({ provider: 'loomy', autoCheckin: false })
  await first.update({ provider: 'doubaowork', autoCompleteTasks: true })
  assert.equal(first.isAutoCheckinEnabled('loomy'), false)
  assert.equal(first.isAutoCheckinEnabled('astudio'), true)
  assert.equal(first.isAutoCompleteTasksEnabled('doubaowork'), true)

  // 重启恢复
  const reopened = createAutomationSettings({ file, allowedProviders: ['loomy', 'astudio', 'doubaowork'] })
  assert.equal(reopened.isAutoCheckinEnabled('loomy'), false)
  assert.equal(reopened.isAutoCompleteTasksEnabled('doubaowork'), true)

  // 恢复跟随全局（设为 null）
  await reopened.update({ provider: 'loomy', autoCheckin: null })
  assert.equal(reopened.isAutoCheckinEnabled('loomy'), true)
})

test('daily-checkin 动态开关：按渠道运行时关闭后 tick 不触发，重新打开后自动执行', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-checkin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const settings = createAutomationSettings({ file: join(dir, 'automation.json'), allowedProviders: ['astudio'] })
  await settings.update({ provider: 'astudio', autoCheckin: false })
  const calls = []
  const checkin = createDailyCheckin({
    dir: join(dir, 'checkin'),
    adapters: new Map([['astudio', {
      list: async () => [{ id: 'a1', name: 'A1' }],
      claim: async id => { calls.push(id); return { kind: 'claimed', credit: 100 } },
    }]]),
    isEnabled: provider => settings.isAutoCheckinEnabled(provider),
    now: () => Date.parse('2026-11-20T06:00:00Z'),
  })
  try {
    await checkin.tick()
    assert.deepEqual(calls, [], '分渠道关闭后自动签到不得触发')
    await settings.update({ provider: 'astudio', autoCheckin: true })
    await checkin.tick()
    assert.deepEqual(calls, ['a1'], '重新开启后 tick 自动补签')
  } finally { checkin.dispose() }
})

test('auto-tasks 调度器：claimRewards 默认可跑，completeTasks 需显式开启才自动跑', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-tasks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const settings = createAutomationSettings({ file: join(dir, 'automation.json'), allowedProviders: ['astudio', 'doubaowork'] })
  const events = []
  const tasks = createAutoTasks({
    dir: join(dir, 'tasks'),
    adapters: new Map([
      ['astudio', {
        list: async () => [{ id: 'a1', name: 'A1' }],
        claimRewards: async () => { events.push('astudio:claim'); return { kind: 'claimed', claimed: 1 } },
      }],
      ['doubaowork', {
        list: async () => [{ id: 'd1', name: 'D1' }],
        completeTasks: async () => { events.push('doubao:complete'); return { kind: 'completed', completed: 2 } },
      }],
    ]),
    isEnabled: (provider, mode) => mode === 'completeTasks'
      ? settings.isAutoCompleteTasksEnabled(provider)
      : settings.isAutoClaimRewardsEnabled(provider),
    now: () => Date.parse('2026-11-20T06:00:00Z'),
  })
  try {
    await tasks.tick()
    assert.deepEqual(events, ['astudio:claim'], 'completeTasks 默认关闭不自动执行')
    await settings.update({ provider: 'doubaowork', autoCompleteTasks: true })
    await tasks.tick()
    assert.deepEqual(events, ['astudio:claim', 'doubao:complete'], '显式开启后自动执行，且不重复执行已领的 astudio')
  } finally { tasks.dispose() }
})

test('客户端局部非阻塞锁与 Host 快照解耦：不同域可并发，且 AStudio/豆包工作渲染自动化开关与多方式登录', async () => {
  const { module, react } = loadClient()
  let resolveSlow
  const slowModelSave = new Promise(resolve => { resolveSlow = resolve })
  const calls = []
  const rpc = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'settings.snapshot') {
      return {
        ok: true,
        value: {
          cursor: 'v1',
          entries: {
            'astudio/managed.snapshot': { value: { provider: 'astudio', enabled: true, registered: false, authMethods: ['local', 'browser', 'credential'], credentialHint: 'JWT', accounts: [] }, at: 100, stale: false },
            'astudio/managed.models': { value: { provider: 'astudio', models: [{ id: 'spark-x2.6', name: 'Spark-X2.6', enabled: true }], source: 'fallback' }, at: 100, stale: false },
            'doubaowork/managed.snapshot': { value: { provider: 'doubaowork', enabled: true, registered: false, authMethods: ['browser', 'credential'], credentialHint: 'Cookie', accounts: [] }, at: 100, stale: false },
            'doubaowork/managed.models': { value: { provider: 'doubaowork', models: [{ id: 'auto', name: '自动', enabled: true }], source: 'fallback' }, at: 100, stale: false },
            'automation/automation.status': { value: { config: { autoCheckin: true, autoClaimRewards: true, autoCompleteTasks: false, providers: {} }, tasks: {} }, at: 100, stale: false },
          },
        },
      }
    }
    if (method === 'managed.setModelEnabled') return slowModelSave
    if (method === 'automation.setConfig') return { ok: true, value: { config: { autoCheckin: false, autoClaimRewards: true, autoCompleteTasks: false, providers: { astudio: { autoCheckin: false } } }, tasks: {} } }
    return { ok: true, value: {} }
  }

  const store = module.createRouterStore(rpc, 'astudio')
  try {
    await store.readHostSnapshots()
    // Host 快照已就绪，切到 doubaowork 不必重发 managed.snapshot RPC
    const beforeSwitch = calls.filter(c => c.method === 'managed.snapshot').length
    await store.load('doubaowork')
    assert.equal(calls.filter(c => c.method === 'managed.snapshot').length, beforeSwitch, 'Host 快照已就绪时切渠道不重拉')

    // 局部非阻塞：models:astudio 在途时，automation 域依然可以并发保存
    await store.load('astudio')
    const p1 = store.astudioSetModelEnabled('spark-x2.6', false)
    assert.equal(store.isPending('models:astudio'), true)
    assert.equal(store.isPending('automation'), false)
    const p2 = store.setAutomationConfig({ provider: 'astudio', autoCheckin: false })
    assert.equal(await p2, true, '不同操作域互不阻塞')
    resolveSlow({ ok: true, value: { provider: 'astudio', models: [{ id: 'spark-x2.6', name: 'Spark-X2.6', enabled: false }], source: 'fallback' } })
    await p1
    assert.equal(store.isPending('models:astudio'), false)

    // 渲染检查：AStudio 账号页包含 3 种登录入口，渠道页包含自动签到和自动领取奖励开关
    let Settings
    const ctx = { slots: { inject(_s, fn) { fn() }, register(_sp, c) { Settings = c } }, connection: { rpc: { call: (_p, _s, req) => rpc(req.method, req.payload) } } }
    module.apply(ctx)
    const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
    render(); await new Promise(r => setImmediate(r))
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 AStudio').props.onClick()
    await new Promise(r => setImmediate(r))
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    let accTree = render()
    const btns = treeNodes(accTree).filter(n => n.type === 'button').flatMap(n => n.children || [])
    assert.ok(btns.includes('导入本机登录'))
    assert.ok(btns.includes('浏览器登录'))
    assert.ok(btns.includes('粘贴凭据'))

    treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
    const chTree = render()
    const switches = treeNodes(chTree).filter(n => n.props?.role === 'switch').map(n => n.props['aria-label'])
    assert.ok(switches.includes('AStudio 自动每日签到'))
    assert.ok(switches.includes('AStudio 自动领取奖励'))
    // 验证：Host 快照协议激活后，登录/导入完成无需关闭设置页即可立即刷新账号列表与已连接状态
    let snapCursor = 'snap-1'
    let loggedIn = false
    const loginRpc = async (method, payload) => {
      if (method === 'settings.snapshot') {
        if (payload.cursor === snapCursor) return { ok: true, value: { cursor: snapCursor, entries: null } }
        return {
          ok: true,
          value: {
            cursor: snapCursor,
            entries: {
              'coze/managed.snapshot': { value: { provider: 'coze', enabled: true, registered: loggedIn, authMethods: ['browser', 'local', 'credential'], accounts: loggedIn ? [{ id: 'coze-12345678', name: 'Coze 测试号', uid: 'u-coze', enabled: true, signedIn: true, windows: [] }] : [] }, at: 100, stale: false },
              'coze/managed.models': { value: { provider: 'coze', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', enabled: true }], source: loggedIn ? 'remote' : 'fallback' }, at: 100, stale: false },
            },
          },
        }
      }
      if (method === 'managed.login') {
        loggedIn = true
        snapCursor = 'snap-2'
        return { ok: true, value: { provider: 'coze', id: 'coze-12345678', signedIn: true, name: 'Coze 测试号', uid: 'u-coze', enabled: true, registered: true } }
      }
      if (method === 'managed.snapshot') {
        assert.equal(payload.snapshot, undefined, '登录后的强制刷新应直接读最新实时状态，不读陈旧快照')
        return { ok: true, value: { provider: 'coze', enabled: true, registered: true, authMethods: ['browser', 'local', 'credential'], accounts: [{ id: 'coze-12345678', name: 'Coze 测试号', uid: 'u-coze', enabled: true, signedIn: true, windows: [] }] } }
      }
      if (method === 'managed.models') {
        return { ok: true, value: { provider: 'coze', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', enabled: true }], source: 'remote' } }
      }
      return { ok: true, value: {} }
    }
    const loginStore = module.createRouterStore(loginRpc, 'coze')
    try {
      await loginStore.readHostSnapshots()
      assert.equal(loginStore.getSnapshot().managed.coze.accounts.length, 0)
      await loginStore.cozeLogin()
      const after = loginStore.getSnapshot().managed.coze
      assert.equal(after.accounts.length, 1, '登录后无需关闭设置页应立即刷新出新账号')
      assert.equal(after.registered, true, '登录后应立即更新已注册状态')
      assert.equal(after.modelSource, 'remote', '登录后应立即刷新远端模型目录')
    } finally { loginStore.dispose() }
  } finally { store.dispose(); react.dispose() }
})

test('参数档位快捷键：按官方规格表单与渠道硬上限生成（Kimi 1M/MiniMax 512K/DeepSeek 384K/GLM 128K/CodeArts 32K）', async () => {
  assert.doesNotMatch(clientSource, /label:\s*'1024K'/)
  assert.equal(officialModelSpec('kimi-k3.1-pro')?.maxOutput, 1_048_576)
  assert.equal(officialModelSpec('person-kimi-k3-1-pro-261111')?.maxOutput, 1_048_576)
  assert.equal(officialModelSpec('person-qwen4-max', 'doubaowork')?.maxOutput, 262_144)
  assert.equal(officialModelSpec('person-qwen3-8-max', 'doubaowork')?.maxOutput, 131_072)
  assert.equal(officialModelSpec('minimax-m3.1-flash')?.maxOutput, 524_288)
  assert.equal(officialModelSpec('deepseek-v4.1-flash')?.maxOutput, 393_216)
  assert.equal(officialModelSpec('glm-5.3')?.maxOutput, 131_072)
  assert.equal(officialModelSpec('hy4std')?.maxOutput, 65_536)
  assert.equal(channelOutputHardCap('codearts'), 32_000)

  const react = reactHarness()
  let module
  vm.runInNewContext(clientSource, {
    URL, AbortController, setTimeout, clearTimeout, navigator: {},
    window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => react) } } },
  }, { filename: 'client.js' })
  const host = async (method) => {
    if (method === 'settings.snapshot') {
      return {
        ok: true,
        value: {
          cursor: 'c1',
          entries: {
            'astudio/managed.snapshot': { value: { provider: 'astudio', enabled: true, registered: true, accounts: [] }, at: 100, stale: false },
            'astudio/managed.models': {
              value: {
                provider: 'astudio',
                source: 'remote',
                models: [
                  { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', enabled: true, contextWindow: 1_048_576, defaultContextWindow: 1_048_576, maxOutputLength: 65_536, defaultMaxOutputLength: 65_536, thinkingLevels: [], params: {} },
                  { id: 'minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', enabled: true, contextWindow: 1_000_000, defaultContextWindow: 1_000_000, maxOutputLength: 65_536, defaultMaxOutputLength: 65_536, thinkingLevels: [], params: {} },
                  { id: 'xdeepseek-flash-in', name: 'DeepSeek V4.1 Flash', enabled: true, contextWindow: 1_048_576, defaultContextWindow: 1_048_576, maxOutputLength: 100_000, defaultMaxOutputLength: 100_000, thinkingLevels: [], params: {} },
                  { id: 'xopglm52', name: 'GLM 5.2', enabled: true, contextWindow: 1_048_576, defaultContextWindow: 1_048_576, maxOutputLength: 100_000, defaultMaxOutputLength: 100_000, thinkingLevels: [], params: {} },
                ],
              },
              at: 100,
              stale: false,
            },
          },
        },
      }
    }
    return { ok: true, value: { models: [], accounts: [], statuses: {} } }
  }
  let Settings
  const ctx = { slots: { inject(_s, fn) { fn() }, register(_sp, c) { Settings = c } }, connection: { rpc: { call: (_p, _s, req) => host(req.method, req.payload) } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  const openEditor = label => {
    treeNodes(render()).find(n => n.props['aria-label'] === `${label} 的参数`).props.onClick()
    const tree = render()
    const editorNode = treeNodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'PlanModelParams')
    let draft = {}
    const planTree = editorNode.type({ ...editorNode.props, value: draft, setValue: v => { draft = v } })
    const groupButtons = groupLabel => {
      const group = treeNodes(planTree).find(n => n.props?.role === 'group' && n.props['aria-label'] === groupLabel)
      return treeNodes(group).filter(n => n.type === 'button')
    }
    return { getDraft: () => draft, groupButtons }
  }
  try {
    render()
    await new Promise(r => setImmediate(r))
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 AStudio').props.onClick()
    await new Promise(r => setImmediate(r))

    // 1. Kimi K3.1 Pro：上下文 1M 绑 1_048_576；输出 64K/128K/256K/1M（顶档绑 1_048_576）
    const kimi = openEditor('Kimi K3.1 Pro')
    const kimiOut = kimi.groupButtons('最大输出 Token档位')
    assert.deepEqual(kimiOut.slice(1).map(b => b.children[0]), ['64K', '128K', '256K', '1M'])
    kimiOut.at(-1).props.onClick()
    assert.equal(kimi.getDraft().maxTokens, 1_048_576, 'Kimi K3.1 Pro 1M 输出按钮应绑定 1_048_576')
    kimi.groupButtons('上下文 Token档位').at(-1).props.onClick()
    assert.equal(kimi.getDraft().contextWindow, 1_048_576)

    // 2. MiniMax M3.1 Flash：上下文 1M 绑 1_000_000；输出 64K/128K/256K/512K（顶档绑 524_288）
    const mm = openEditor('MiniMax M3.1 Flash')
    const mmOut = mm.groupButtons('最大输出 Token档位')
    assert.deepEqual(mmOut.slice(1).map(b => b.children[0]), ['64K', '128K', '256K', '512K'])
    mmOut.at(-1).props.onClick()
    assert.equal(mm.getDraft().maxTokens, 524_288)
    mm.groupButtons('上下文 Token档位').at(-1).props.onClick()
    assert.equal(mm.getDraft().contextWindow, 1_000_000, '1000000 模型点击 1M 按钮应绑定 1_000_000')

    // 3. DeepSeek V4.1 Flash：输出 64K/128K/256K/384K
    const ds = openEditor('DeepSeek V4.1 Flash')
    assert.deepEqual(ds.groupButtons('最大输出 Token档位').slice(1).map(b => b.children[0]), ['64K', '128K', '256K', '384K'])

    // 4. GLM 5.2：官方输出上限 128K，仅显示 64K/128K，不越界显示 256K/384K
    const glm = openEditor('GLM 5.2')
    assert.deepEqual(glm.groupButtons('最大输出 Token档位').slice(1).map(b => b.children[0]), ['64K', '128K'])
  } finally { react.dispose() }
})

test('TRAE 模型参数与思考等级修复：客户端版本升级到 0.1.69，兜底模型带实测思考档位与视觉能力', () => {
  assert.equal(TRAE.ideVersion, '0.1.69')
  assert.equal(TRAE.ideVersionCode, '20260917')
  const ds = TRAE.fallbackModels.find(m => m.id === 'deepseek-v4.1-flash')
  assert.deepEqual(ds?.reasoningConfig?.options, ['light', 'high', 'extra_high'])
  assert.equal(ds?.reasoningConfig?.defaultLevel, 'high')
  assert.equal(ds?.multimodal, true)
  const glm = TRAE.fallbackModels.find(m => m.id === 'glm-5.3')
  assert.equal(glm?.reasoningConfig?.defaultLevel, 'extra_high')
  assert.equal(glm?.multimodal, false)
  assert.match(clientSource, /light:\s*'轻'/)
  assert.match(clientSource, /extra_high:\s*'极高'/)
  const adapterSource = readFileSync(new URL('../vendor/channel-pack/src/trae-adapter.ts', import.meta.url), 'utf8')
  const backendSource = readFileSync(new URL('../lib/backend.js', import.meta.url), 'utf8')
  assert.match(adapterSource, /套餐权益不足或额度受限/, 'TRAE code=1005 空文案需给出明确可操作提示')
  assert.match(backendSource, /fallbackChannels/, 'TRAE code=1005 需具备降级 Max 与备用 function 回退逻辑并已编进 lib/backend.js')
})
