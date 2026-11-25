import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

function loadClient(react = reactHarness(), globals = {}) {
  let module
  vm.runInNewContext(clientSource, {
    URL, AbortController, navigator: {},
    ...globals,
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

  const first = createAutomationSettings({ file, allowedProviders: ['raccoon', 'astudio', 'codearts'] })
  assert.equal(first.isAutoCheckinEnabled('raccoon'), true)
  assert.equal(first.isAutoClaimRewardsEnabled('astudio'), true)
  assert.equal(first.isAutoCompleteTasksEnabled('codearts'), false, '主动执行完成任务默认必须关闭')
  assert.equal(first.isQuotaPriorityEnabled(), false)
  assert.equal(first.isRaccoonUnifiedModels(), false, '统一免费与订阅模型默认关闭')
  assert.equal(first.routingMode(), 'manual', '选号模式默认手动顺序')
  await first.update({ preferExpiringQuota: true })
  await assert.rejects(first.update({ provider: 'raccoon', preferExpiringQuota: false }), /全局设置/)
  await assert.rejects(first.update({ provider: 'raccoon', raccoonUnifiedModels: true }), /自动化设置无效/)
  await assert.rejects(first.update({ provider: 'raccoon', routingMode: 'sticky' }), /全局设置/)
  await assert.rejects(first.update({ routingMode: 'fast' }), /选号模式无效/)
  await first.update({ raccoonUnifiedModels: true })
  assert.equal(first.isRaccoonUnifiedModels(), true)
  assert.equal(first.snapshot().raccoonUnifiedModels, true)
  // 旧布尔开关与新模式双向同步：preferExpiringQuota=true 已把模式推到 expiring。
  assert.equal(first.routingMode(), 'expiring')
  await first.update({ routingMode: 'sticky' })
  assert.equal(first.routingMode(), 'sticky')
  assert.equal(first.isQuotaPriorityEnabled(), false, '粘滞模式下旧开关读作关闭')

  await first.update({ provider: 'raccoon', autoCheckin: false })
  await first.update({ provider: 'codearts', autoCompleteTasks: true })
  assert.equal(first.isAutoCheckinEnabled('raccoon'), false)
  assert.equal(first.isAutoCheckinEnabled('astudio'), true)
  assert.equal(first.isAutoCompleteTasksEnabled('codearts'), true)

  // 重启恢复
  const reopened = createAutomationSettings({ file, allowedProviders: ['raccoon', 'astudio', 'codearts'] })
  assert.equal(reopened.isAutoCheckinEnabled('raccoon'), false)
  assert.equal(reopened.isAutoCompleteTasksEnabled('codearts'), true)
  assert.equal(reopened.routingMode(), 'sticky', '粘滞模式随 automation.json 重启恢复')
  assert.equal(reopened.snapshot().routingMode, 'sticky')
  assert.equal(reopened.snapshot().preferExpiringQuota, false, '旧布尔字段由模式派生')
  assert.equal(reopened.isRaccoonUnifiedModels(), true, '统一模型开关随 automation.json 重启恢复')
  await reopened.update({ preferExpiringQuota: false })
  assert.equal(reopened.isQuotaPriorityEnabled(), false)
  assert.equal(reopened.routingMode(), 'sticky', '旧开关关闭不推翻 sticky 模式')
  await reopened.update({ routingMode: 'free' })
  assert.equal(reopened.routingMode(), 'free')
  await reopened.update({ preferExpiringQuota: false })
  assert.equal(reopened.routingMode(), 'free', '旧开关关闭不推翻 free 模式')
  await reopened.update({ preferExpiringQuota: true })
  assert.equal(reopened.routingMode(), 'expiring', '旧开关开启把模式推回临期优先')
  await reopened.update({ raccoonUnifiedModels: false })
  assert.equal(reopened.isRaccoonUnifiedModels(), false)

  // 旧版文件只有布尔 preferExpiringQuota：读入迁移为临期优先
  const legacyFile = join(dir, 'legacy-automation.json')
  await writeFile(legacyFile, JSON.stringify({ version: 1, autoCheckin: true, preferExpiringQuota: true }))
  const legacy = createAutomationSettings({ file: legacyFile, allowedProviders: ['raccoon'] })
  assert.equal(legacy.routingMode(), 'expiring')
  assert.equal(legacy.snapshot().preferExpiringQuota, true)

  // 恢复跟随全局（设为 null）
  await reopened.update({ provider: 'raccoon', autoCheckin: null })
  assert.equal(reopened.isAutoCheckinEnabled('raccoon'), true)
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
  const settings = createAutomationSettings({ file: join(dir, 'automation.json'), allowedProviders: ['astudio', 'codearts'] })
  const events = []
  const tasks = createAutoTasks({
    dir: join(dir, 'tasks'),
    adapters: new Map([
      ['astudio', {
        list: async () => [{ id: 'a1', name: 'A1' }],
        claimRewards: async () => { events.push('astudio:claim'); return { kind: 'claimed', claimed: 1 } },
      }],
      ['codearts', {
        list: async () => [{ id: 'd1', name: 'D1' }],
        completeTasks: async () => { events.push('codearts:complete'); return { kind: 'completed', completed: 2 } },
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
    await settings.update({ provider: 'codearts', autoCompleteTasks: true })
    await tasks.tick()
    assert.deepEqual(events, ['astudio:claim', 'codearts:complete'], '显式开启后自动执行，且不重复执行已领的 astudio')
  } finally { tasks.dispose() }
})

test('客户端局部非阻塞锁与 Host 快照解耦：不同域可并发，且 CodeArts渲染自动化开关与多方式登录', async () => {
  const { module, react } = loadClient()
  let resolveSlow
  const slowModelSave = new Promise(resolve => { resolveSlow = resolve })
  const calls = []
  const rpc = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'settings.snapshot') {
      if (payload.cursor === 'v1') return { ok: true, value: { cursor: 'v1', entries: null } }
      return {
        ok: true,
        value: {
          cursor: 'v1',
          entries: {
            'codearts/managed.snapshot': { value: { provider: 'codearts', enabled: true, registered: false, authMethods: ['local', 'browser', 'credential'], credentialHint: '凭据', accounts: [] }, at: 100, stale: false },
            'codearts/managed.models': { value: { provider: 'codearts', models: [{ id: 'auto', name: '自动', enabled: true }], source: 'fallback' }, at: 100, stale: false },
            'automation/automation.status': { value: { config: { autoCheckin: true, autoClaimRewards: true, autoCompleteTasks: false, providers: {} }, tasks: {}, quotaProviders: ['codearts'] }, at: 100, stale: false },
          },
        },
      }
    }
    if (method === 'managed.setModelEnabled') return slowModelSave
    if (method === 'automation.setConfig') return { ok: true, value: { config: { autoCheckin: false, autoClaimRewards: true, autoCompleteTasks: false, preferExpiringQuota: payload.routingMode === 'expiring', routingMode: payload.routingMode ?? (payload.preferExpiringQuota === true ? 'expiring' : 'manual'), providers: { codearts: { autoCheckin: false } } }, tasks: {}, quotaProviders: ['codearts'] } }
    return { ok: true, value: {} }
  }

  const store = module.createRouterStore(rpc, 'codearts')
  try {
    await store.readHostSnapshots()
    // Host 快照已就绪，切到 codearts 不必重发 managed.snapshot RPC
    const beforeSwitch = calls.filter(c => c.method === 'managed.snapshot').length
    await store.load('codearts')
    assert.equal(calls.filter(c => c.method === 'managed.snapshot').length, beforeSwitch, 'Host 快照已就绪时切渠道不重拉')

    // 局部非阻塞：models:codearts 在途时，automation 域依然可以并发保存
    await store.load('codearts')
    const p1 = store.codeartsSetModelEnabled('auto', false)
    assert.equal(store.isPending('models:codearts'), true)
    assert.equal(store.isPending('automation'), false)
    const p2 = store.setAutomationConfig({ provider: 'codearts', autoCheckin: false })
    assert.equal(await p2, true, '不同操作域互不阻塞')
    resolveSlow({ ok: true, value: { provider: 'codearts', models: [{ id: 'auto', name: '自动', enabled: false }], source: 'fallback' } })
    await p1
    assert.equal(store.isPending('models:codearts'), false)

    // 渲染检查：CodeArts 账号页包含 3 种登录入口，渠道页包含自动签到和自动领取奖励开关
    let Settings
    const ctx = { slots: { inject(_s, fn) { fn() }, register(_sp, c) { Settings = c } }, connection: { rpc: { call: (_p, _s, req) => rpc(req.method, req.payload) } } }
    module.apply(ctx)
    const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
    render(); await new Promise(r => setImmediate(r))
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 CodeArts').props.onClick()
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
    assert.ok(switches.includes('CodeArts 自动每日签到'))
    // ⚠️ CodeArts 只有签到、没有 claimRewards（原 AStudio 才有），故此处不再断言
    // 「自动领取奖励」开关 —— 该能力随 AStudio 停用而失去测试载体。
    // 智能选号模式：四档分段控件（aria-pressed 标记当前档）
    const modeTiers = tree => treeNodes(tree).filter(n => n.type === 'button' && n.props?.className === 'eac-tier'
      && ['手动', '免费优先', '临期优先', '缓存优先'].includes(n.children?.[0]))
    assert.equal(modeTiers(chTree).find(n => n.props['aria-pressed'] === true).children[0], '手动')
    modeTiers(chTree).find(n => n.children[0] === '临期优先').props.onClick()
    await new Promise(r => setImmediate(r))
    assert.equal(modeTiers(render()).find(n => n.props['aria-pressed'] === true).children[0], '临期优先')
    // 「立即领取」按钮属 claimRewards，CodeArts 无此能力（见上），故不再断言。
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
              'codearts/managed.snapshot': { value: { provider: 'codearts', enabled: true, registered: loggedIn, authMethods: ['browser', 'local', 'credential'], accounts: loggedIn ? [{ id: 'codearts-12345678', name: 'CodeArts 测试号', uid: 'u-codearts', enabled: true, signedIn: true, windows: [] }] : [] }, at: 100, stale: false },
              'codearts/managed.models': { value: { provider: 'codearts', models: [{ id: 'auto-4b', name: 'Spark X2.6', enabled: true }], source: loggedIn ? 'remote' : 'fallback' }, at: 100, stale: false },
            },
          },
        }
      }
      if (method === 'managed.login') {
        loggedIn = true
        snapCursor = 'snap-2'
        return { ok: true, value: { provider: 'codearts', id: 'codearts-12345678', signedIn: true, name: 'CodeArts 测试号', uid: 'u-codearts', enabled: true, registered: true } }
      }
      if (method === 'managed.snapshot') {
        assert.equal(payload.snapshot, undefined, '登录后的强制刷新应直接读最新实时状态，不读陈旧快照')
        return { ok: true, value: { provider: 'codearts', enabled: true, registered: true, authMethods: ['browser', 'local', 'credential'], accounts: [{ id: 'codearts-12345678', name: 'CodeArts 测试号', uid: 'u-codearts', enabled: true, signedIn: true, windows: [] }] } }
      }
      if (method === 'managed.models') {
        return { ok: true, value: { provider: 'codearts', models: [{ id: 'auto-4b', name: 'Spark X2.6', enabled: true }], source: 'remote' } }
      }
      return { ok: true, value: {} }
    }
    const loginStore = module.createRouterStore(loginRpc, 'codearts')
    try {
      await loginStore.readHostSnapshots()
      assert.equal(loginStore.getSnapshot().managed.codearts.accounts.length, 0)
      await loginStore.codeartsLogin()
      const after = loginStore.getSnapshot().managed.codearts
      assert.equal(after.accounts.length, 1, '登录后无需关闭设置页应立即刷新出新账号')
      assert.equal(after.registered, true, '登录后应立即更新已注册状态')
      assert.equal(after.modelSource, 'remote', '登录后应立即刷新远端模型目录')
    } finally { loginStore.dispose() }
  } finally { store.dispose(); react.dispose() }
})

test('自管渠道导入凭据失败保留输入，成功后才清空', async () => {
  const { module, react } = loadClient(); let Settings
  const rpc = async method => {
    if (method === 'managed.snapshot') return { ok: true, value: { provider: 'codearts', enabled: true, registered: false,
      authMethods: ['local', 'browser', 'credential'], credentialHint: 'JWT', accounts: [] } }
    if (method === 'managed.models') return { ok: true, value: { provider: 'codearts', models: [], source: 'fallback' } }
    if (method === 'provider.status') return { ok: true, value: { statuses: {} } }
    return { ok: true, value: {} }
  }
  const ctx = { slots: { inject(_s, fn) { fn() }, register(_sp, component) { Settings = component } },
    connection: { rpc: { call: (_p, _s, req) => rpc(req.method) } } }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  try {
    render(); await new Promise(setImmediate)
    treeNodes(render()).find(n => n.props['aria-label'] === '切换到 CodeArts').props.onClick()
    await new Promise(setImmediate)
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    treeNodes(render()).find(n => n.type === 'button' && (n.children || []).includes('粘贴凭据')).props.onClick()
    const node = treeNodes(render()).find(n => n.type?.name === 'CredentialImportForm')
    assert.ok(node, '展开粘贴凭据表单')
    let succeeds = false
    const props = { ...node.props, onSave: async () => succeeds }
    const renderForm = () => { react.begin(); const tree = node.type(props); react.flush(); return tree }
    const input = () => treeNodes(renderForm()).find(n => n.type === 'input' && n.props.type === 'password')
    input().props.onChange({ target: { value: 'fixture-credential' } })
    await renderForm().props.onSubmit({ preventDefault() {} })
    assert.equal(input().props.value, 'fixture-credential')
    succeeds = true
    await renderForm().props.onSubmit({ preventDefault() {} })
    assert.equal(input().props.value, '')
  } finally { react.dispose() }
})

test('自管渠道浏览器登录只读临时状态，取消会终止请求并清除登录地址', async () => {
  const timers = new Map()
  const { module } = loadClient(undefined, {
    setTimeout(fn) { const key = Symbol(); timers.set(key, fn); return key },
    clearTimeout(key) { timers.delete(key) },
  })
  let loginSignal
  const store = module.createRouterStore(async (method, payload, signal) => {
    if (method === 'settings.snapshot') return { ok: true, value: { cursor: 'browser-login-fixture', entries: {
      'codearts/managed.snapshot': { at: 1, value: { authMethods: ['browser', 'local', 'credential'], accounts: [] } },
    } } }
    if (method === 'managed.login') {
      loginSignal = signal
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
    assert.equal(method, 'managed.snapshot')
    assert.equal(payload.localOnly, true)
    return { ok: true, value: { loginUrl: 'https://example.com/login' } }
  }, 'codearts')
  try {
    await store.readHostSnapshots()
    const pending = store.codeartsLogin()
    const [key, poll] = [...timers][0]
    timers.delete(key)
    await poll()
    assert.equal(store.getSnapshot().managed.codearts.loginUrl, 'https://example.com/login')
    store.codeartsCancelLogin()
    assert.equal(await pending, false)
    assert.equal(loginSignal.aborted, true)
    assert.equal(store.getSnapshot().managed.codearts.loginUrl, '')
    assert.equal(timers.size, 0)
  } finally { store.dispose() }
})

test('模型输出规格与渠道硬上限：官方规格表正确，CodeArts 遵守 65,536 上限', async () => {
  assert.doesNotMatch(clientSource, /label:\s*'1024K'/)
  assert.equal(officialModelSpec('kimi-k3.1-pro')?.maxOutput, 1_048_576)
  assert.equal(officialModelSpec('person-kimi-k3-1-pro-261111')?.maxOutput, 1_048_576)
  assert.equal(officialModelSpec('minimax-m3.1-flash')?.maxOutput, 524_288)
  assert.equal(officialModelSpec('deepseek-v4.1-flash')?.maxOutput, 393_216)
  assert.equal(officialModelSpec('glm-5.3')?.maxOutput, 131_072)
  assert.equal(officialModelSpec('hy4std')?.maxOutput, 65_536)
  assert.equal(channelOutputHardCap('codearts'), 65_536)

  // UI 档位交互（原 Kimi 512K / GLM 5.2 快捷档）已随 AStudio 停用移除：
  // 这些模型只存在于 AStudio 目录，而 CodeArts 受 65,536 硬上限约束，
  // 无法承载高上限档位断言。上面的模型规格与渠道硬上限断言保持不变。
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

test('签到：pending 记录绝不重放（陈旧/重启/手动均不重复提交），仅明确"未提交"才按退避释放', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pending-never-replay-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let now = Date.parse('2026-11-20T02:00:00Z') // 2026-11-20 10:00 +08
  const { mkdir, utimes, writeFile } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const sha = id => createHash('sha256').update(id).digest('hex')
  const folder = join(dir, 'astudio', '2026-11-20')
  const pathOf = id => join(folder, sha(id))

  // 1) 主流程：提交中途中断 → 只有 pending 预留；陈旧、重启（新实例）、手动一律不得再发。
  const calls = []
  const makeAdapter = claim => ({
    list: async () => [{ id: 'a1', name: 'A1' }],
    claim,
  })
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', makeAdapter(async id => { calls.push(id); return { kind: 'claimed', credit: 100 } })]]),
    now: () => now,
  })
  const checkinRestarted = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', makeAdapter(async id => { calls.push(id + ':restart'); return { kind: 'claimed' } })]]),
    now: () => now,
  })
  try {
    await mkdir(folder, { recursive: true })
    const writePending = async ageMs => {
      await writeFile(pathOf('a1'), JSON.stringify({ id: 'a1', outcome: { kind: 'pending' } }))
      const stamp = new Date(Date.now() - ageMs)
      await utimes(pathOf('a1'), stamp, stamp)
    }
    // 中断残留（一小时前的陈旧 pending）→ 手动与重启实例都不得重放
    await writePending(60 * 60_000)
    assert.deepEqual((await checkin.claim('astudio', 'a1')).map(r => ({ kind: r.outcome.kind, repeated: r.repeated })),
      [{ kind: 'pending', repeated: true }], '陈旧 pending 不得再提交')
    assert.deepEqual((await checkinRestarted.claim('astudio', 'a1')).map(r => r.outcome.kind),
      ['pending'], '重启后残留 pending 仍不得再提交')
    assert.deepEqual(calls, [], '任何已有 pending 记录都不得触发上游提交')

    // 2) 终态记录同样拦截：failed 之后手动 claim 不再重放（没有明确"未提交"证据）
    const failCalls = []
    const checkinFailed = createDailyCheckin({
      dir,
      adapters: new Map([['astudio2', {
        list: async () => [{ id: 'b1', name: 'B1' }],
        claim: async id => { failCalls.push(id); return { kind: 'failed' } },
      }]]),
      now: () => now,
    })
    try {
      assert.deepEqual((await checkinFailed.claim('astudio2', 'b1')).map(r => r.outcome.kind), ['failed'])
      assert.deepEqual((await checkinFailed.claim('astudio2', 'b1')).map(r => ({ kind: r.outcome.kind, repeated: r.repeated })),
        [{ kind: 'failed', repeated: true }], 'failed 终态手动不得重放')
      assert.deepEqual(failCalls, ['b1'])
    } finally { checkinFailed.dispose() }

    // 3) 仅 preflight 明确"未提交"（unsubmitted）才允许撤预留转退避票据；退避内自动路径不提交，到期后自动放行
    const retryCalls = []
    let unsubmitted = true
    const checkinRetry = createDailyCheckin({
      dir,
      adapters: new Map([['astudio3', {
        list: async () => [{ id: 'c1', name: 'C1' }],
        claim: async id => {
          retryCalls.push(id)
          if (unsubmitted) return { kind: 'failed', unsubmitted: true }
          return { kind: 'claimed', credit: 50 }
        },
      }]]),
      now: () => now,
    })
    try {
      assert.deepEqual((await checkinRetry.claim('astudio3', 'c1')).map(r => r.outcome.kind), ['failed'])
      // 自动路径：.retry 票据未到期 → 拦截，不再发
      assert.deepEqual((await checkinRetry.claim('astudio3', 'c1', undefined, true)).map(r => r.outcome.kind), ['failed'])
      assert.deepEqual(retryCalls, ['c1'], '退避期内自动路径不得重复提交')
      // 退避到期 + 上游仍报未提交 → 自动路径允许重新提交一次
      unsubmitted = false
      now += 16 * 60_000
      assert.deepEqual((await checkinRetry.claim('astudio3', 'c1', undefined, true)).map(r => r.outcome.kind), ['claimed'])
      assert.deepEqual(retryCalls, ['c1', 'c1'], '退避到期后自动路径放行一次')
    } finally { checkinRetry.dispose() }
  } finally { checkin.dispose(); checkinRestarted.dispose() }
})

test('签到只读核实：done 只写 .confirmed 票据不覆盖预留；open/失败不落账；票据让后续 run 不提交', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-query-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let now = Date.parse('2026-11-20T02:00:00Z')
  const { mkdir, writeFile, readFile, readdir, access } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const sha = id => createHash('sha256').update(id).digest('hex')
  const folder = join(dir, 'qoder', '2026-11-20')
  await mkdir(folder, { recursive: true })
  const exists = path => access(path).then(() => true, () => false)
  // stuck：中断残留的 pending 预留，上游核实已签；lost：pending 但上游查询失败；
  // proof：pending 且上游显式声明"未提交"；open：无记录且上游确认未签
  await writeFile(join(folder, sha('stuck')), JSON.stringify({ id: 'stuck', outcome: { kind: 'pending' } }))
  await writeFile(join(folder, sha('lost')), JSON.stringify({ id: 'lost', outcome: { kind: 'pending' } }))
  await writeFile(join(folder, sha('proof')), JSON.stringify({ id: 'proof', outcome: { kind: 'pending' } }))
  const verifyCalls = []
  let stuckRepaired = false
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['qoder', {
      resetHour: 10,
       list: async () => [{ id: 'stuck', name: 'S' }, { id: 'lost', name: 'L' }, { id: 'proof', name: 'P' }, { id: 'open', name: 'O' }, { id: 'confirmed-only', name: 'C' }],
      claim: async id => { throw new Error('不应被调用: ' + id) },
      async verify(id) {
        verifyCalls.push(id)
        if (id === 'stuck') {
          // 首次核实确认已签；之后再查回报 pending，检验已确认票据不被 open 推翻
          if (!stuckRepaired) { stuckRepaired = true; return { kind: 'already-claimed', credit: 100 } }
          return { kind: 'pending' }
        }
        if (id === 'lost') return { kind: 'failed' } // 上游查询失败 → 无结论
         if (id === 'confirmed-only') return { kind: 'already-claimed' }
        if (id === 'proof') return { kind: 'pending', unsubmitted: true } // 显式"未提交"证明
        return { kind: 'pending' } // open：上游确认未签
      },
    }]]),
    now: () => now,
  })
  try {
    const rows = await checkin.query('qoder')
    const byId = Object.fromEntries(rows.map(row => [row.accountId, row]))
    assert.equal(byId.stuck.outcome.kind, 'already-claimed')
    assert.equal(byId.stuck.verified, true, '上游确认已签 → verified')
    assert.equal(byId.lost.outcome.kind, 'pending')
    assert.equal(byId.lost.verified, false, '查询失败 → 不写账本，标 verified:false')
    assert.equal(byId.proof.outcome.kind, 'pending')
    assert.equal(byId.proof.verified, true, '上游应答本身可核实，但只读核实绝不撤预留')
    assert.equal(byId.open.outcome.kind, 'pending')
    assert.equal(byId.open.verified, true, '上游明确未达成 → verified，但无本地记录可改')
    assert.equal(byId.stuck.repeated, true, 'query 行均为只读回放，非新提交')
    // 票据契约：stuck 主记录仍是 pending（绝不覆盖/删除），另有 .confirmed 观察票据
    const stuckMain = JSON.parse(await readFile(join(folder, sha('stuck')), 'utf8'))
    assert.equal(stuckMain.outcome.kind, 'pending', '核实不覆盖既有预留')
    const stuckConfirmed = JSON.parse(await readFile(join(folder, sha('stuck') + '.confirmed'), 'utf8'))
    assert.equal(stuckConfirmed.outcome.kind, 'already-claimed')
    // proof 账号：显式"未提交"也不在 query 侧撤票 —— 只有持有预留的 run 可自行释放
    const lostRecord = JSON.parse(await readFile(join(folder, sha('lost')), 'utf8'))
    assert.equal(lostRecord.outcome.kind, 'pending')
    assert.equal(await exists(join(folder, sha('proof') + '.retry')), false, 'query 不产生退避票据')
    assert.equal((await readFile(join(folder, sha('proof')), 'utf8')).includes('pending'), true, '预留原样保留')
    assert.equal(await readdir(folder).then(files => files.filter(name => name.endsWith('.retry')).length), 0, 'query 路径绝不写退避票据')

    // 已确认 done 不被 open 核实推翻（stuck 已有确认票据，再查 pending 不得回写）
    const rows3 = await checkin.query('qoder', 'stuck')
    assert.equal(rows3[0].outcome.kind, 'already-claimed', '确认票据优先于 open 结论')
    assert.equal(rows3[0].verified, false, 'open 结论与已确认事实冲突 → 不标 verified')
    // 核实票据让后续 run 在 reserve 前就应答，绝不提交
    const claimRows = await checkin.claim('qoder', 'stuck')
    assert.equal(claimRows[0].outcome.kind, 'already-claimed')
    assert.equal(claimRows[0].repeated, true, 'reserve 前见核实票据即答，不提交')
    // lost/proof 的 pending 预留依旧拦截重放（open 核实不改变账本）
    const lostClaim = await checkin.claim('qoder', 'lost')
    assert.equal(lostClaim[0].outcome.kind, 'pending')
    assert.equal(lostClaim[0].repeated, true)
    // 状态页经确认票据如实显示已核实结果
    const statusAfter = await checkin.status()
    assert.equal(statusAfter.providers.qoder.accounts.find(a => a.accountId === 'stuck').kind, 'already-claimed')
    assert.equal(statusAfter.providers.qoder.accounts.find(a => a.accountId === 'confirmed-only').kind, 'already-claimed')
    assert.deepEqual(verifyCalls.length > 0, true)
    assert.equal(statusAfter.providers.qoder.date, '2026-11-20')
  } finally { checkin.dispose() }
})

test('签到 query：无 verify 通道时只回账本现状（verified:false），指定账号含账外账号', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-query-nv-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', {
      list: async () => [{ id: 'a1', name: 'A1' }],
      claim: async () => ({ kind: 'claimed' }),
    }]]),
    now: () => Date.parse('2026-11-20T02:00:00Z'),
  })
  try {
    const rows = await checkin.query('astudio')
    assert.deepEqual(rows.map(row => ({ accountId: row.accountId, kind: row.outcome.kind, verified: row.verified })),
      [{ accountId: 'a1', kind: 'pending', verified: false }], '无 verify 时不得编造核实结论')
    const row = await checkin.query('astudio', 'ghost')
    assert.equal(row[0].accountId, 'ghost')
    assert.equal(row[0].verified, false)
  } finally { checkin.dispose() }
})

test('一次性奖励暂不可领不写入完成记录，之后仍可领取', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-empty-query-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let claims = 0
  const tasks = createAutoTasks({ dir, adapters: new Map([['astudio', {
    doneScope: 'account',
    list: async () => [{ id: 'account' }],
    verifyClaimRewards: async () => ({ kind: 'empty' }),
    claimRewards: async () => { claims++; return { kind: 'claimed' } },
  }]]) })
  try {
    assert.equal((await tasks.query('astudio', 'claimRewards'))[0].outcome.kind, 'empty')
    assert.equal((await tasks.run('astudio', 'claimRewards'))[0].outcome.kind, 'claimed')
    assert.equal((await tasks.run('astudio', 'claimRewards'))[0].repeated, true)
    assert.equal(claims, 1)
  } finally { tasks.dispose() }
})

test('自动任务：account 账本跨日+跨模式(claimRewards)采纳，核实只写票据，退避由持有人释放', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-account-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { mkdir, writeFile, readFile, readdir, access } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const sha = id => createHash('sha256').update(id).digest('hex')
  const exists = path => access(path).then(() => true, () => false)
  let now = Date.parse('2026-11-20T02:00:00Z')

  // 旧版按日账本：acc-2 留有昨天的 pending（中断残留）、acc-old 有前天的完成记录
  const legacyDir = join(dir, 'codearts', 'completeTasks', '2026-11-19')
  await mkdir(legacyDir, { recursive: true })
  await writeFile(join(legacyDir, sha('acc-2')), JSON.stringify({ id: 'acc-2', outcome: { kind: 'pending' } }))
  const olderDir = join(dir, 'codearts', 'completeTasks', '2026-11-18')
  await mkdir(olderDir, { recursive: true })
  await writeFile(join(olderDir, sha('acc-old')), JSON.stringify({ id: 'acc-old', outcome: { kind: 'done', completed: 3, points: 60 } }))
  // 老 claimRewards 按日账本：acc-cross 前天的 claimed 记录 → completeTasks 采纳为 completed
  const crossDir = join(dir, 'codearts', 'claimRewards', '2026-11-18')
  await mkdir(crossDir, { recursive: true })
  await writeFile(join(crossDir, sha('acc-cross')), JSON.stringify({ id: 'acc-cross', outcome: { kind: 'claimed', claimed: 5, points: 100 } }))

  const calls = []
  const verifyCalls = []
  let acc3Unsubmitted = true
  const tasks = createAutoTasks({
    dir,
    adapters: new Map([['codearts', {
      doneScope: 'account',
      adoptFrom: ['claimRewards'],
      list: async () => [
        { id: 'acc-1', name: '新号' }, { id: 'acc-2', name: '中断号' },
        { id: 'acc-3', name: '退避号' }, { id: 'acc-cross', name: '跨模式' },
      ],
      completeTasks: async id => {
        calls.push(id)
        if (id === 'acc-3' && acc3Unsubmitted) return { kind: 'failed', unsubmitted: true }
        return { kind: 'completed', completed: 1, points: 10 }
      },
      async verifyCompleteTasks(id) {
        verifyCalls.push(id)
        if (id === 'acc-2') return { kind: 'done', completed: 4, points: 80 }
        if (id === 'acc-3' || id === 'ghost') return { kind: 'pending', unsubmitted: true }
        return { kind: 'done', completed: 3, points: 60 }
      },
    }]]),
    now: () => now,
  })
  try {
    // 1) 自动执行：acc-1 提交并记 completed；acc-2 采纳昨天的 pending → 永不重放；
    //    acc-3 首次应答"未提交" → 持有预留的 run 自行转退避；acc-cross 采纳跨模式 claimed → completed，不提交
    const results = await tasks.run('codearts', 'completeTasks', undefined, undefined, true)
    const byId = Object.fromEntries(results.map(row => [row.accountId, row]))
    assert.deepEqual(calls, ['acc-1', 'acc-3'], '只有账本为空的账号允许提交；跨模式采纳不触发提交')
    assert.equal(byId['acc-1'].outcome.kind, 'completed')
    assert.equal(byId['acc-2'].outcome.kind, 'pending')
    assert.equal(byId['acc-2'].repeated, true, '跨日采纳的 pending 属于重复，不是新提交')
    assert.equal(byId['acc-3'].outcome.kind, 'failed', 'run 持有人依据上游应答自行撤预留转退避')
    assert.equal(byId['acc-cross'].outcome.kind, 'completed')
    assert.equal(byId['acc-cross'].outcome.completed, 5, 'claimed 计数换算为 completed')
    assert.equal(byId['acc-cross'].repeated, true)
    // 采纳落账到 account 目录
    assert.equal(await exists(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-2'))), true)
    assert.equal(await exists(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-cross'))), true)
    const crossRecord = JSON.parse(await readFile(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-cross')), 'utf8'))
    assert.equal(crossRecord.outcome.kind, 'completed')
    assert.equal(await exists(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-3') + '.retry')), true, '退避票据由持有人释放产生')

    // 2) status：account 作用域并入旧版按日记录（acc-old）与跨模式记录（acc-cross），date 保持日界键
    const status = await tasks.status()
    const completeRows = status.providers.codearts.completeTasks
    assert.equal(status.providers.codearts.doneScope, 'account')
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(status.providers.codearts.date), 'date 保持日界格式供投影')
    assert.equal(completeRows.find(row => row.accountId === 'acc-old')?.kind, 'done', '旧版记录并入状态，不丢已确认结果')
    assert.equal(completeRows.find(row => row.accountId === 'acc-2')?.kind, 'pending')
    assert.equal(completeRows.find(row => row.accountId === 'acc-cross')?.kind, 'completed')
    assert.equal(completeRows.find(row => row.accountId === 'acc-3')?.retryable, true)

    // 3) query：done 核实只写 .confirmed 票据（不覆盖 pending 主记录）；open/证明不落账
    const q = await tasks.query('codearts', 'completeTasks')
    const qById = Object.fromEntries(q.map(row => [row.accountId, row]))
    assert.equal(qById['acc-1'].verified, true)
    assert.equal(qById['acc-1'].outcome.kind, 'completed', '本地已确认终态保留细节，不被核实结论覆盖')
    assert.equal(qById['acc-2'].verified, true)
    assert.equal(qById['acc-2'].outcome.kind, 'done')
    assert.equal(qById['acc-3'].verified, true, '显式"未提交"证明如实应答')
    assert.equal(qById['acc-3'].outcome.kind, 'pending')
    assert.equal(qById['acc-cross'].outcome.kind, 'completed')
    // acc-2：pending 主记录原样保留 + .confirmed 票据
    const acc2Main = JSON.parse(await readFile(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-2')), 'utf8'))
    assert.equal(acc2Main.outcome.kind, 'pending', '核实绝不覆盖/删除既有预留')
    const acc2Confirmed = JSON.parse(await readFile(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-2') + '.confirmed'), 'utf8'))
    assert.equal(acc2Confirmed.outcome.kind, 'done')
    // 显式"未提交"证明也不在 query 侧撤票/补票
    assert.equal(await exists(join(dir, 'codearts', 'completeTasks', 'account', sha('acc-3'))), false)
    assert.equal(await readdir(join(dir, 'codearts', 'completeTasks', 'account'))
      .then(files => files.filter(name => name === sha('acc-3') + '.confirmed').length), 0, 'open 结论不写核实票据')

    // 4) acc-2 有核实票据 → run 在 reserve 前应答不提交；acc-3 退避到期由持有人路径放行一次
    now += 31 * 60_000
    acc3Unsubmitted = false
    const rerun = await tasks.run('codearts', 'completeTasks', undefined, undefined, true)
    const rerun2 = Object.fromEntries(rerun.map(row => [row.accountId, row]))
    assert.deepEqual(calls, ['acc-1', 'acc-3', 'acc-3'], '核实票据拦截 acc-2；退避到期自动路径仅放行 acc-3')
    assert.equal(rerun2['acc-2'].outcome.kind, 'done')
    assert.equal(rerun2['acc-2'].repeated, true)
    assert.equal(rerun2['acc-3'].outcome.kind, 'completed')
    // 指定 accountId 查询账外账号：行仍返回（只读），昵称回退 id
    const ghost = await tasks.query('codearts', 'completeTasks', 'ghost')
    assert.equal(ghost[0].accountId, 'ghost')
    assert.equal(ghost[0].nickname, 'ghost')
    assert.equal(ghost[0].verified, true)
    assert.equal(ghost[0].outcome.kind, 'pending')
    assert.equal(await exists(join(dir, 'codearts', 'completeTasks', 'account', sha('ghost'))), false, '账外账号 open 核实不落账')
    assert.deepEqual(calls, ['acc-1', 'acc-3', 'acc-3'], 'query 绝不触发提交')
    assert.ok(verifyCalls.length > 0)
  } finally { tasks.dispose() }
})

test('签到：pending 主记录在后续 tick 中自动只读核实，确认入账后落 .confirmed 票据并通知刷新（不重放 claim）', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-checkin-pending-verify-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let clock = Date.parse('2026-11-26T04:00:00Z')
  let claimCalls = 0
  let verifyCalls = 0
  let upstreamSettled = false
  const changes = []
  const checkin = createDailyCheckin({
    dir,
    now: () => clock,
    onChange: (provider, outcome) => { changes.push([provider, outcome.kind]) },
    adapters: new Map([['codearts', {
      resetHour: 0,
      list: async () => [{ id: 'acc-1', name: '甲' }],
      claim: async () => { claimCalls++; return { kind: 'pending' } },
      verify: async () => { verifyCalls++; return { kind: upstreamSettled ? 'already-claimed' : 'pending' } },
    }]]),
  })
  try {
    // 1) 首轮 tick 提交 claim → 返回 pending 写主记录
    await checkin.tick()
    assert.equal(claimCalls, 1)
    assert.equal(verifyCalls, 0)
    assert.equal((await checkin.status()).providers.codearts.accounts[0].kind, 'pending')

    // 2) 次轮 tick（防抖内先核实一次，上游尚未结算 → 仍 pending，绝不重放 claim）
    clock += 6 * 60_000
    await checkin.tick()
    assert.equal(claimCalls, 1, 'pending 绝不重放 claim')
    assert.equal(verifyCalls, 1)
    assert.equal((await checkin.status()).providers.codearts.accounts[0].kind, 'pending')

    // 3) 5 分钟内再 tick 不重复打 verify（防抖）
    clock += 2 * 60_000
    await checkin.tick()
    assert.equal(verifyCalls, 1)

    // 4) 上游已结算，超过防抖后 tick 自动只读核实 → 落 .confirmed 票据并通知刷新
    upstreamSettled = true
    clock += 4 * 60_000
    await checkin.tick()
    assert.equal(claimCalls, 1, '核实确认仍不重放 claim')
    assert.equal(verifyCalls, 2)
    assert.equal((await checkin.status()).providers.codearts.accounts[0].kind, 'already-claimed')
    assert.deepEqual(changes.at(-1), ['codearts', 'already-claimed'])
  } finally { checkin.dispose() }
})
