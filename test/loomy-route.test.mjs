import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { registerHooks } from 'node:module'
import vm from 'node:vm'
import {
  LOOMY_API_BASE,
  classifyLoomyServedModel,
  createLoomyRouteService,
  probeLoomyRoute,
  publicLoomyRouteStatus,
} from '../lib/loomy-route.js'
import { apply, publicResult } from '../lib/web-host.js'

const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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
  vm.runInNewContext(clientSource, { URL, AbortController, navigator: {}, ...extraGlobals, window: { __ModuleLoader__: { load(spec) {
    module = spec.factory(() => react)
  } } } }, { filename: 'client.js' })
  return { module, react }
}

function treeNodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(treeNodes)]
}

test('probeLoomyRoute：0 积分只读判定链覆盖目录缺失、账本各族模型、多副本去漂移与停用/失效状态', async () => {
  const seen = []
  const makeFetch = (modelsResp, recordsList) => {
    let idx = 0
    return async (url, init) => {
      seen.push({ url: String(url), method: init?.method || 'GET', token: init?.headers?.token })
      assert.equal(init?.method || 'GET', 'GET', '只读检测绝不发送 POST /chat/completions')
      assert.ok(String(url).startsWith(LOOMY_API_BASE))
      if (String(url).includes('/models')) return modelsResp()
      const fn = recordsList[Math.min(idx++, recordsList.length - 1)]
      return fn()
    }
  }

  // 1) 目录缺少 DeepSeek-V4.1-Flash → 直接判 routed
  const missingDs = await probeLoomyRoute('SECRET_SESSION', {
    fetchImpl: makeFetch(
      () => jsonResponse({ code: '000000', data: [{ id: 'spark-x2.6' }, { id: 'GLM-5.3-Flash' }] }),
      [() => assert.fail('目录已否证时不应再读账本')],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.equal(missingDs.verdict, 'routed')
  assert.equal(missingDs.reason, 'catalog-missing-ds41')
  assert.equal(missingDs.servedModel, 'spark-x2.6, GLM-5.3-Flash')
  assert.equal(seen[0].token, 'SECRET_SESSION')

  // 2) 目录 100003 + 账号已停用 vs 100002 登录失效
  const disabled = await probeLoomyRoute('S1', {
    fetchImpl: makeFetch(() => jsonResponse({ code: '100003', desc: '账号已被停用' }), []),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: disabled.verdict, reason: disabled.reason }, { verdict: 'expired', reason: 'account-disabled' })

  const expired = await probeLoomyRoute('S2', {
    fetchImpl: makeFetch(() => jsonResponse({ code: '100002', desc: '登录已失效' }), []),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: expired.verdict, reason: expired.reason }, { verdict: 'expired', reason: 'session-expired' })

  // 3) 余额 <= 0 → exhausted
  const exhausted = await probeLoomyRoute('S3', {
    fetchImpl: makeFetch(
      () => jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      [() => jsonResponse({ code: '000000', data: { availableBalance: 0, list: [{ modelName: 'deepseek-v4-flash-1017', createdAt: 100 }] } })],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: exhausted.verdict, reason: exhausted.reason }, { verdict: 'exhausted', reason: 'no-quota' })

  // 4) 多副本去漂移：取 createdAt 最大且含 modelName 的扣费记录（跳过无 modelName 的签到记录）
  const drifted = await probeLoomyRoute('S4', {
    fetchImpl: makeFetch(
      () => jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      [
        () => jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [{ modelName: 'deepseek-v4-flash-1017', createdAt: 100 }] } }),
        () => jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [{ modelName: '', createdAt: 300 }, { modelName: 'spark-x2.6-low', createdAt: 200 }] } }),
        () => jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [] } }),
      ],
    ),
    ledgerReads: 3,
    ledgerIntervalMs: 0,
  })
  assert.equal(drifted.verdict, 'routed')
  assert.equal(drifted.reason, 'ledger-spark')
  assert.equal(drifted.servedModel, 'spark-x2.6-low')

  // 5) 其它模型族（glm/qwen）与健康 deepseek
  const otherFamily = await probeLoomyRoute('S5', {
    fetchImpl: makeFetch(
      () => jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      [() => jsonResponse({ code: '000000', data: { balance: 1000, dailyBalance: 200, list: [{ modelName: 'glm-5.3', createdAt: 100 }] } })],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: otherFamily.verdict, reason: otherFamily.reason, servedModel: otherFamily.servedModel },
    { verdict: 'routed', reason: 'ledger-other-family', servedModel: 'glm-5.3' })

  const clean = await probeLoomyRoute('S6', {
    fetchImpl: makeFetch(
      () => jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      [() => jsonResponse({ code: '000000', data: { availableBalance: 4900, list: [{ modelName: 'deepseek-v4-flash-1017', createdAt: 100 }] } })],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: clean.verdict, reason: clean.reason, servedModel: clean.servedModel },
    { verdict: 'clean', reason: 'ledger-deepseek', servedModel: 'deepseek-v4-flash-1017' })

  // 6) 目录偶发 5xx、账本读通但无扣费记录 → unknown；全部失败 → error
  const noRecords = await probeLoomyRoute('S7', {
    fetchImpl: makeFetch(
      () => new Response('upstream error', { status: 503 }),
      [() => jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [] } })],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.deepEqual({ verdict: noRecords.verdict, reason: noRecords.reason }, { verdict: 'unknown', reason: 'no-ledger-records' })

  const transient = await probeLoomyRoute('S8', {
    fetchImpl: makeFetch(
      () => new Response('timeout', { status: 502 }),
      [() => new Response('rate limit', { status: 429 })],
    ),
    ledgerReads: 1,
    ledgerIntervalMs: 0,
  })
  assert.equal(transient.verdict, 'error')
})

test('createLoomyRouteService：持久化、Magpie 状态只读采纳、流式落地分类及定论保护', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loomy-route-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const stateFile = join(dir, 'loomy-route-state.json')
  const magpieFile = join(dir, 'magpie-loomy-route.json')
  const magpieData = {
    '261030022321722555': { verdict: 'routed', reason: 'ledger-spark', servedModel: 'spark-x2.6-low', checkedAt: 1700000000000 },
    '261105093118230694': { verdict: 'clean', reason: 'ledger-deepseek', servedModel: 'deepseek-v4-flash-1017', checkedAt: 1700000001000 },
  }
  await writeFile(magpieFile, JSON.stringify(magpieData), 'utf8')

  let mode = 'routed'
  const service = createLoomyRouteService({
    file: stateFile,
    magpieFile,
    ledgerReads: 1,
    ledgerIntervalMs: 0,
    listAccounts: async () => [
      { id: 'loomy-a', userId: '261030022321722555', session: 'TOK_A' },
      { id: 'loomy-b', userId: '261105093118230694', session: 'TOK_B' },
      { id: 'loomy-c', userId: '261199999999999999', session: 'TOK_C' },
    ],
    async fetch(url, init) {
      if (String(url).includes('/models')) return jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] })
      const tok = init?.headers?.token
      if (tok === 'TOK_C') {
        if (mode === 'routed') return jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [{ modelName: 'spark-x2.6-low', createdAt: 100 }] } })
        if (mode === 'unknown') return jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [] } })
        return new Response('err', { status: 502 })
      }
      return jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [{ modelName: 'deepseek-v4-flash-1017', createdAt: 100 }] } })
    },
  })

  // 通过 userid 自动采纳 Magpie 的已有结论，且不修改 magpieFile 原文
  assert.equal(service.isAccountExcluded('loomy-a', '261030022321722555'), true)
  assert.equal(service.isAccountExcluded('loomy-b', '261105093118230694'), false)
  assert.equal(await readFile(magpieFile, 'utf8'), JSON.stringify(magpieData))

  // 检测单号 loomy-c → routed
  const res = await service.call('loomy.checkRoute', { provider: 'loomy', accountId: 'loomy-c' })
  assert.equal(res.accounts['loomy-c'].verdict, 'routed')
  assert.equal(service.isAccountExcluded('loomy-c'), true)

  // unknown 与 error 不得覆盖已有定论
  mode = 'unknown'
  await service.call('loomy.checkRoute', { provider: 'loomy', accountId: 'loomy-c' })
  assert.equal(service.getAccountRoute('loomy-c')?.verdict, 'routed')
  mode = 'error'
  await service.call('loomy.checkRoute', { provider: 'loomy', accountId: 'loomy-c' })
  assert.equal(service.getAccountRoute('loomy-c')?.verdict, 'routed')

  // 流式落地分类：DS4.1 -> deepseek* 判 clean，DS4.1 -> spark* 判 routed，spark -> spark 不误判 clean
  assert.equal(classifyLoomyServedModel('DeepSeek-V4.1-Flash', 'deepseek-v4-flash-1017')?.verdict, 'clean')
  assert.equal(classifyLoomyServedModel('DeepSeek-V4.1-Flash', 'spark-x2.6-low')?.verdict, 'routed')
  assert.equal(classifyLoomyServedModel('spark-x2.6', 'spark-x2.6-low'), null)

  service.observeServedModel('loomy-c', 'DeepSeek-V4.1-Flash', 'deepseek-v4-flash-1017', '261199999999999999')
  assert.equal(service.getAccountRoute('loomy-c')?.verdict, 'clean')
  assert.equal(service.isAccountExcluded('loomy-c'), false)

  await service.call('loomy.setRouteConfig', { provider: 'loomy', skipRouted: false })
  assert.equal(service.isAccountExcluded('loomy-a', '261030022321722555'), false)

  // 重启恢复
  await new Promise(resolve => setTimeout(resolve, 20))
  const reloaded = createLoomyRouteService({ file: stateFile, magpieFile: '' })
  assert.equal(reloaded.isSkipRoutedEnabled(), false)
  assert.equal(reloaded.getAccountRoute('loomy-c')?.verdict, 'clean')

  // 公开投影过滤安全边界
  const projected = publicLoomyRouteStatus({
    skipRouted: true,
    accounts: {
      __proto__: { verdict: 'routed' },
      'loomy-x': { verdict: 'routed', reason: 'ledger-spark', servedModel: 'spark-x2.6-low', token: 'NEVER_DISPLAY' },
      'loomy-bad': { verdict: 'bogus', servedModel: 'SECRET' },
    },
  })
  assert.equal(projected.accounts['loomy-bad'], undefined)
  assert.doesNotMatch(JSON.stringify(projected), /NEVER_DISPLAY|SECRET/)
})

test.skip('后端集成与选号隔离（Loomy 适配器已停用注册，装配链路无对象）', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'unified-router-loomy-route-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier.startsWith('@deepseek-ai/') ? { url: kernel, shortCircuit: true } : next(specifier, context)
    },
  })
  const originalHome = process.env.DSH_HOME
  const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR
  const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch
  process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch

  const cleanup = []
  const adapters = new Map()
  const credentials = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: {
      resolve: async ref => credentials.get(ref),
      describe: async () => undefined,
      set: async (ref, value) => { credentials.set(ref, { value }) },
      unset: async ref => credentials.delete(ref),
    },
    llm: {
      registerAdapter(ids, adapter) { for (const id of ids) adapters.set(id, adapter) },
      listProviders: () => [...adapters.keys()].map(id => ({ id })),
      listModels: async id => adapters.get(id).listModels(id),
    },
    connection: { fetch: { register() {} } },
  }
  const ctx = {
    ...services,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get: key => services[key],
    provide(key, value) { this[key] = services[key] = value },
    effect(fn) { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
    inject(deps, fn) { if (deps.every(d => services[d])) fn(this) },
    emit() {},
  }

  const encoder = new TextEncoder()
  const seenTokens = []
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/models')) {
      return jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash', capabilities: {} }] })
    }
    seenTokens.push(init?.headers?.token)
    const served = init?.headers?.token === 'SECRET_TOK_1' ? 'spark-x2.6-low' : 'deepseek-v4-flash-1017'
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: served, choices: [{ delta: { content: 'hi' } }] })}\n\n`))
        if (served.startsWith('deepseek')) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })
  }

  try {
    const routeService = createLoomyRouteService({
      file: join(scratch, 'loomy-route-state.json'),
      ledgerReads: 1,
      ledgerIntervalMs: 0,
    })
    let rpc
    const { mountBackend } = await import('../lib/backend.js')
    const pool = mountBackend(ctx, call => { rpc = call }, { loomyRoute: routeService })

    credentials.set('REF_1', { value: JSON.stringify({ access_token: 'SECRET_TOK_1', userid: 'u-1', phone: '13800000001' }) })
    credentials.set('REF_2', { value: JSON.stringify({ access_token: 'SECRET_TOK_2', userid: 'u-2', phone: '13800000002' }) })
    credentials.set('LOOMY_ACCESS_TOKEN', { value: JSON.stringify({ access_token: 'FALLBACK_SHOULD_NOT_BE_USED' }) })
    await pool.addAccount({ id: 'loomy-1', provider: 'loomy', nickname: '号1', credentialRef: 'REF_1', enabled: true, refreshable: false, createdAt: 1 })
    await pool.addAccount({ id: 'loomy-2', provider: 'loomy', nickname: '号2', credentialRef: 'REF_2', enabled: true, refreshable: false, createdAt: 2 })

    // 默认两个都未检测，按顺序选号1；号1 SSE 响应返回 spark-x2.6-low → 记录 routed 并中断响应
    const adapter = adapters.get('loomy')

    await assert.rejects(adapter.stream({ model: 'DeepSeek-V4.1-Flash', messages: [] })[Symbol.asyncIterator]().next(), { code: 'INVALID_REQUEST' })
    assert.equal(routeService.getAccountRoute('loomy-1')?.verdict, 'routed')
    assert.equal(routeService.getAccountRoute('loomy-1')?.servedModel, 'spark-x2.6-low')

    // 下一次请求自动避开 loomy-1，选中 loomy-2，且号2返回 deepseek-v4-flash-1017 记为 clean
    const chunks = await Array.fromAsync(adapter.stream({ model: 'DeepSeek-V4.1-Flash', messages: [] }))
    assert.match(JSON.stringify(chunks), /hi/)
    assert.deepEqual(seenTokens, ['SECRET_TOK_1', 'SECRET_TOK_2'])
    assert.equal(routeService.getAccountRoute('loomy-2')?.verdict, 'clean')

    // 若把 loomy-2 也标为 routed（开启 skipRouted），则全部被排除且不回退单凭据
    routeService.observeServedModel('loomy-2', 'DeepSeek-V4.1-Flash', 'glm-5.3', 'u-2')
    await assert.rejects(
      adapter.stream({ model: 'DeepSeek-V4.1-Flash', messages: [] })[Symbol.asyncIterator]().next(),
      /避开上游改路由账号/,
    )
    assert.equal(seenTokens.length, 2, '不得发出回退凭据请求')

    // 关闭「避开上游改路由账号」开关后恢复可选用
    await routeService.call('loomy.setRouteConfig', { provider: 'loomy', skipRouted: false })
    assert.ok(rpc)
    const nextCred = await adapter.options.resolveCredential('DeepSeek-V4.1-Flash')
    assert.equal(nextCred?.userid, 'u-1')
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR; else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
  }
})

test('宿主 HTTP 与快照集成：写鉴权、零首屏网络请求、account.list 脱敏投影与删号清理', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-loomy-host-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const snapshotFile = join(dir, 'settings.json')
  const magpieFile = join(dir, 'magpie.json')
  await writeFile(magpieFile, JSON.stringify({
    'uid-1': { verdict: 'routed', reason: 'ledger-spark', servedModel: 'spark-x2.6-low', checkedAt: 1700000000000 },
  }))

  let networkCalls = 0
  let accounts = [{ id: 'loomy-1', provider: 'loomy', nickname: '号1', enabled: true, credentialRef: 'LOOMY_REF_1' }]
  const routes = new Map()
  const cleanup = []
  const credentials = new Map([
    ['LOOMY_REF_1', { value: JSON.stringify({ access_token: 'SECRET_SESSION_TOKEN', userid: 'uid-1', phone: '13900001111' }) }],
  ])
  const connection = {
    createPeer() { return { dispose() {} } },
    createSharedFetchHandler() {
      return {
        async fetch(request) {
          const body = await request.json()
          const { method, payload } = body.payload
          if (method === 'account.list') return jsonResponse({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { accounts } } })
          if (method === 'account.delete') {
            accounts = accounts.filter(a => a.id !== payload.accountId)
            return jsonResponse({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: {} } })
          }
          return jsonResponse({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: {} } })
        },
      }
    },
    fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  }
  const ctx = {
    connection,
    credentials: { resolve: async ref => credentials.get(ref) },
    llm: {},
    get: key => ctx[key],
    inject(_deps, fn) { fn(this) },
    effect(fn) { cleanup.push(fn()) },
    on() { return () => {} },
  }

  apply(ctx, { backend: 'shared' }, {
    autoCollect: false,
    snapshotFile,
    magpieRouteFile: magpieFile,
    loomyLedgerReads: 1,
    loomyLedgerIntervalMs: 0,
    async fetch(url) {
      networkCalls += 1
      if (String(url).includes('/models')) return jsonResponse({ code: '000000', data: [{ id: 'DeepSeek-V4.1-Flash' }] })
      return jsonResponse({ code: '000000', data: { availableBalance: 5000, list: [{ modelName: 'deepseek-v4-flash-1017', createdAt: 999 }] } })
    },
  })

  try {
    const route = routes.get('/api/unified-router')
    const call = async (method, payload, origin) => {
      const resp = await route.fetch(new Request('http://dsh.internal/api/unified-router', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'unified-router', payload: { method, payload } }),
      }))
      return resp.json()
    }

    // 跨 Origin 写入被拒绝
    for (const method of ['loomy.checkRoute', 'loomy.clearRoute', 'loomy.setRouteConfig']) {
      const denied = await call(method, { provider: 'loomy', skipRouted: false }, 'https://evil.example')
      assert.equal(denied.result.error.code, 'unified-router/forbidden')
    }
    assert.equal(networkCalls, 0)

    // account.list 仅本地匹配 Magpie 已测结论，0 上游请求，不透出凭据，并同步绑定到 loomy.routeStatus 与本地状态文件
    const listed = await call('account.list', { provider: 'loomy' })
    assert.equal(listed.result.ok, true)
    assert.equal(listed.result.value.accounts[0].route?.verdict, 'routed')
    assert.equal(networkCalls, 0)
    assert.doesNotMatch(JSON.stringify(listed), /SECRET_SESSION_TOKEN|LOOMY_REF_1/)
    const adoptedStatus = await call('loomy.routeStatus', { provider: 'loomy' })
    assert.equal(adoptedStatus.result.value.accounts['loomy-1']?.verdict, 'routed')
    await new Promise(resolve => setTimeout(resolve, 25))
    const persisted = JSON.parse(readFileSync(join(dirname(snapshotFile), 'loomy-route-state.json'), 'utf8'))
    assert.equal(persisted.accounts['loomy-1']?.verdict, 'routed')

    // 手动触发检测后变为 clean，且结果不泄密
    const checked = await call('loomy.checkRoute', { provider: 'loomy', accountId: 'loomy-1' })
    assert.equal(checked.result.ok, true)
    assert.equal(checked.result.value.accounts['loomy-1'].verdict, 'clean')
    assert.equal(networkCalls, 2)
    assert.doesNotMatch(JSON.stringify(checked), /SECRET_SESSION_TOKEN|LOOMY_REF_1/)

    // publicResult 过滤 account.list 中的非法 route
    assert.equal(publicResult('account.list', { accounts: [{ id: 'a', provider: 'loomy', route: { verdict: 'hacked' } }] }).accounts[0].route, undefined)

    // 删号同步清除该账号路由记录
    assert.equal((await call('account.delete', { provider: 'loomy', accountId: 'loomy-1' })).result.ok, true)
    const afterDelete = await call('loomy.routeStatus', { provider: 'loomy' })
    assert.equal(afterDelete.result.value.accounts['loomy-1'], undefined)
  } finally {
    for (const stop of cleanup.reverse()) stop?.()
  }
})

test('设置页客户端 UI：Loomy 账号页与渠道页呈现完整路由检测入口、徽标、展开详情与开关交互', async () => {
  const { module, react } = loadClient()
  const calls = []
  let routeState = {
    skipRouted: true,
    accounts: {
      'loomy-a': { verdict: 'clean', reason: 'ledger-deepseek', servedModel: 'deepseek-v4-flash-1017', checkedAt: 1700000000000 },
      'loomy-b': { verdict: 'routed', reason: 'ledger-spark', servedModel: 'spark-x2.6-low', checkedAt: 1700000001000 },
    },
  }
  const rpc = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'settings.snapshot') {
      return {
        ok: true,
        value: {
          cursor: 'c1',
          entries: {
            'loomy/loomy.routeStatus': { value: routeState, at: 100, stale: false },
          },
        },
      }
    }
    if (method === 'provider.status') return { ok: true, value: { statuses: { loomy: { closed: false, accounts: { enabled: 3 }, models: { total: 7 } } } } }
    if (method === 'account.list') {
      return {
        ok: true,
        value: {
          accounts: [
            { id: 'loomy-a', provider: 'loomy', nickname: '健康号', enabled: true },
            { id: 'loomy-b', provider: 'loomy', nickname: '限流改路由号', enabled: true },
            { id: 'loomy-c', provider: 'loomy', nickname: '未测新号', enabled: true },
          ],
        },
      }
    }
    if (method === 'model.list') return { ok: true, value: { models: [{ id: 'deepseek-v4-flash-1017', name: 'DS4.1', disabled: false }] } }
    if (method === 'model.params') return { ok: true, value: { provider: 'loomy', params: {} } }
    if (method === 'credits.permanentLock') return { ok: true, value: { locked: false } }
    if (method === 'credits.balances') return { ok: true, value: { accounts: [] } }
    if (method === 'loomy.checkRoute') {
      routeState = {
        ...routeState,
        accounts: {
          ...routeState.accounts,
          'loomy-c': { verdict: 'routed', reason: 'catalog-missing-ds41', servedModel: 'spark-x2.6', checkedAt: 1700000002000 },
        },
      }
      return { ok: true, value: { ...routeState, summary: { total: 3, tested: payload.accountId ? 1 : 3, clean: 1, routed: 2, exhausted: 0, expired: 0, unknown: 0, error: 0 } } }
    }
    if (method === 'loomy.setRouteConfig') {
      routeState = { ...routeState, skipRouted: payload.skipRouted === true }
      return { ok: true, value: routeState }
    }
    if (method === 'loomy.clearRoute') {
      routeState = { ...routeState, accounts: {} }
      return { ok: true, value: routeState }
    }
    return { ok: true, value: {} }
  }

  let Settings
  const ctx = {
    slots: { inject(_slot, run) { run() }, register(_spec, component) { Settings = component } },
    connection: { rpc: { call: (_p, _s, req) => rpc(req.method, req.payload) } },
  }
  module.apply(ctx)
  const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
  try {
    render()
    await tick()
    // 1) 首屏不新增核心 RPC 数量
    const coreReads = calls.filter(c => !['plan.snapshot', 'workbuddy.snapshot', 'workbuddy.models', 'apikey.snapshot', 'managed.snapshot', 'managed.models'].includes(c.method))
    assert.equal(coreReads.length, 7)

    // 2) 切换到「账号与额度」：汇总、总览状态卡、头部按钮、每账号标签
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    let accTree = render()
    const summaryText = treeNodes(accTree).filter(n => n.props.className === 'eac-summary').map(n => n.children.join('')).join(' ')
    assert.match(summaryText, /路由 正常 1 · 改路由 1 · 未检测 1/)
    const overview = treeNodes(accTree).find(n => n.props['aria-label'] === 'Loomy 上游路由状态')
    assert.ok(overview, '顶部应呈现上游路由状态总览卡片')
    const overviewTags = treeNodes(overview).filter(n => n.props.className === 'eac-tag').map(n => n.children.join(''))
    assert.ok(overviewTags.includes('正常 1'))
    assert.ok(overviewTags.includes('改路由 1'))
    assert.ok(overviewTags.includes('未检测 1'))
    assert.ok(overviewTags.includes('自动避开改路由'))

    const buttons = treeNodes(accTree).filter(n => n.type === 'button')
    assert.ok(buttons.some(b => b.children.includes('检测路由')))
    assert.ok(buttons.some(b => b.children.includes('重测异常')))
    assert.ok(buttons.some(b => b.children.includes('路由设置')))

    const tagTexts = treeNodes(accTree).filter(n => n.props.className === 'eac-tag').map(n => [n.children.join(''), n.props['data-tone']])
    assert.ok(tagTexts.some(([label, tone]) => label === '路由正常' && tone === 'success'))
    assert.ok(tagTexts.some(([label, tone]) => label === '改路由 → spark-x2.6-low' && tone === 'error'))
    assert.ok(tagTexts.some(([label, tone]) => label === '路由未检测' && tone === undefined))

    // 3) 展开未检测第 3 账号（仍显示上游路由状态提示），再展开第 2 账号（显示详情分组与单号检测/清除路由按钮）
    treeNodes(accTree).filter(n => n.props.className === 'eac-more')[2].props.onClick()
    accTree = render()
    assert.ok(treeNodes(accTree).some(n => n.props.className === 'eac-group-title' && n.children.includes('上游路由')))
    assert.ok(treeNodes(accTree).some(n => n.children.includes('未检测')))
    treeNodes(accTree).filter(n => n.props.className === 'eac-more')[1].props.onClick()
    accTree = render()
    assert.ok(treeNodes(accTree).some(n => n.props.className === 'eac-group-title' && n.children.includes('上游路由')))
    assert.ok(treeNodes(accTree).some(n => n.children.includes('spark-x2.6-low')))
    const rowLinks = treeNodes(accTree).find(n => n.props.className === 'eac-row-links')
    const rowCheckBtn = rowLinks ? treeNodes(rowLinks).find(n => n.type === 'button' && n.children.includes('检测路由')) : null
    const rowClearBtn = rowLinks ? treeNodes(rowLinks).find(n => n.type === 'button' && n.children.includes('清除路由')) : null
    assert.ok(rowCheckBtn, '展开区应包含单号「检测路由」动作')
    assert.ok(rowClearBtn, '已检测账号展开区应包含单号「清除路由」动作')

    // 4) 点击「路由设置」快捷按钮可直达渠道区并自动展开「各账号路由状态」明细
    buttons.find(b => b.children.includes('路由设置')).props.onClick()
    let chShortcutTree = render()
    assert.ok(treeNodes(chShortcutTree).some(n => n.props.className === 'eac-group-title' && n.children.includes('各账号路由状态')))
    assert.ok(treeNodes(chShortcutTree).some(n => n.children.includes('健康号')))
    treeNodes(render()).find(n => n.props.id === 'eac-tab-accounts').props.onClick()
    accTree = render()

    // 5) 点击检测未测号（或头部检测全部），状态更新
    treeNodes(accTree).filter(n => n.type === 'button').find(b => b.children.includes('检测路由')).props.onClick()
    await tick()
    accTree = render()
    const afterTags = treeNodes(accTree).filter(n => n.props.className === 'eac-tag').map(n => n.children.join(''))
    assert.ok(afterTags.includes('改路由 · 目录无 DS4.1'))

    // 6) 切换到「渠道」：开关默认开启 + 检测全部/重测异常/清空记录
    treeNodes(render()).find(n => n.props.id === 'eac-tab-advanced').props.onClick()
    let chTree = render()
    const routeSwitch = treeNodes(chTree).find(n => n.props.role === 'switch' && n.props['aria-label'] === '避开上游改路由账号')
    assert.equal(routeSwitch.props['aria-checked'], true)
    routeSwitch.props.onClick()
    await tick()
    chTree = render()
    assert.equal(treeNodes(chTree).find(n => n.props.role === 'switch' && n.props['aria-label'] === '避开上游改路由账号').props['aria-checked'], false)

    const chButtons = treeNodes(chTree).filter(n => n.type === 'button')
    assert.ok(chButtons.some(b => b.children.includes('检测全部')))
    assert.ok(chButtons.some(b => b.children.includes('清空记录')))
    chButtons.find(b => b.children.includes('清空记录')).props.onClick()
    await tick()
    chTree = render()
    assert.equal(treeNodes(chTree).find(n => n.type === 'button' && bIs('清空记录', n)).props.disabled, true)
  } finally {
    react.dispose()
  }
})

function bIs(label, node) {
  return Array.isArray(node.children) && node.children.includes(label)
}
