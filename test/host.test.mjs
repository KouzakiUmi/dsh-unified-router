import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, publicResult } from '../lib/web-host.js'
import { guardedRpc, PROVIDERS, loginUrl } from '../lib/rpc.js'
import { createSettingsSnapshots, SNAPSHOT_INTERVAL_MS } from '../lib/settings-snapshots.js'
import { createDailyCheckin } from '../lib/daily-checkin.js'
import { settingsCheckinAdapters } from '../lib/settings-providers.js'

function fixture({ autoCollect = false, snapshotFile, balance, testDeps, requestRejection } = {}) {
  const routes = new Map(); const calls = []; const cleanup = []; let disposed = false
  const account = { id: 'a', provider: 'loomy', nickname: '测试', enabled: true, credentialRef: 'PRIVATE_REF', token: 'NEVER_DISPLAY', refreshToken: 'PRIVATE_REFRESH' }
  const raw = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'account.list') return { ok: true, value: { accounts: [account] } }
    if (method === 'account.update') return { ok: true, value: account }
    if (method === 'credits.balances') return balance ? balance(payload) : { ok: true, value: { accounts: [{ accountId: 'a', balance: null, error: 'token=NEVER_DISPLAY' }] } }
    return { ok: false, error: { code: 'upstream', message: 'secret=NEVER_DISPLAY' } }
  }
  const connection = {
    requestRejection,
    createPeer() { return { dispose() { disposed = true } } },
    createSharedFetchHandler(base) { assert.equal(base, '/api'); return { async fetch(request) { const body = await request.json(); return Response.json({ type: 'server-response', rpcId: body.rpcId, result: await raw(body.payload.method, body.payload.payload) }) } } },
    fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  }
  const streamHooks = []
  const ctx = { connection, credentials: {}, llm: {}, get: key => ctx[key], inject(_deps, fn) { fn(this) }, effect(fn) { cleanup.push(fn()) },
    on(name, fn) { if (name === 'llm/stream') streamHooks.push(fn); return () => {} } }
  apply(ctx, { backend: 'shared' }, { autoCollect, snapshotFile, ...testDeps })
  const route = routes.get('/api/unified-router')
  const call = async (method, payload) => { const response = await route.fetch(new Request('http://dsh.internal/api/unified-router', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: 'unified-router', payload: { method, payload } }) })); return response.json() }
  return { routes, calls, call, route, streamHooks, dispose() { for (const stop of cleanup.reverse()) stop?.() }, get disposed() { return disposed } }
}

test('额度账号 RPC 仅返回命中的会话和模型，不写入设置快照，且经宿主授权', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-quota-account-'))
  let note, reject, order
  const f = fixture({ snapshotFile: join(dir, 'settings.json'), requestRejection: () => reject,
    testDeps: { createManagedManager(_host, _spec, deps) {
      note = deps.noteQuotaAccount
      order = deps.quotaAccountOrder
      return { call: async () => ({ accounts: [] }), dispose() {} }
    } } })
  const route = { provider: 'codearts', model: 'test-model', sessionId: 'session-one' }
  try {
    await f.call('managed.snapshot', { provider: route.provider })
    assert.equal(typeof note, 'function')
    assert.equal(typeof order, 'function')
    const stream = f.streamHooks[0](route, async function* () { note('codearts', 'account-two', route.model); yield 1 })
    await stream.next()
    assert.deepEqual((await f.call('quota.account', route)).result, { ok: true, value: { accountId: 'account-two', live: true } })
    // 智能选号模式接线：sticky 下 managed 的选号重排把最近服务账号置顶，
    // manual 下原样返回（模式经 automation.setConfig 动态切换，无需重启）。
    assert.equal((await f.call('automation.setConfig', { routingMode: 'sticky' })).result.ok, true)
    assert.deepEqual(order('codearts', ['account-one', 'account-two', 'account-three'], { modelId: route.model }),
      ['account-two', 'account-one', 'account-three'])
    assert.deepEqual(order('codearts', ['account-one', 'account-three'], { modelId: route.model }), ['account-one', 'account-three'])
    assert.equal((await f.call('automation.setConfig', { routingMode: 'manual' })).result.ok, true)
    assert.deepEqual(order('codearts', ['account-one', 'account-two'], { modelId: route.model }), ['account-one', 'account-two'])
    assert.equal((await f.call('quota.account', { ...route, sessionId: 'session-two' })).result.value, null)
    assert.equal((await f.call('quota.account', { ...route, model: 'other' })).result.value, null)
    await stream.return()
    assert.equal((await f.call('quota.account', route)).result.value.live, false)
    assert.doesNotMatch(JSON.stringify(await f.call('settings.snapshot', {})), /session-one|account-two/)
    reject = 403
    assert.equal((await f.call('quota.account', route)).result.error.code, 'unified-router/forbidden')
  } finally { f.dispose(); await rm(dir, { recursive: true, force: true }) }
})
test('安装清单仅提供 Web 设置客户端，没有原生胶囊或面板贡献', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dshGo, undefined); assert.equal(pkg.main, 'lib/web-host.js')
  assert.equal(pkg.exports['./client'], './lib/client.js'); assert.equal(pkg.dsh.client.platform, 'web')
  // Raccoon 家族在**模型层**是两个 provider（免费面 / 订阅面），宿主仍按两个 id
  // 做 provider.status 与模型 RPC；账号只有一个池（`raccoon`），卡片也只有一张。
  assert.deepEqual(PROVIDERS.map(p => p.id), ['loomy','raccoon','raccoon-pro','qodercn','trae'])
})
test('宿主忽略退役渠道快照，拒绝转发旧模型、账号和自动化调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-retired-provider-'))
  const snapshotFile = join(dir, 'settings.json')
  const prior = JSON.stringify({ version: 1, entries: {
    'coze/managed.models': { at: 1, value: { provider: 'coze', models: [{ id: 'legacy' }] } },
    'coze/managed.snapshot': { at: 1, value: { provider: 'coze', accounts: [{ id: 'legacy' }] } },
    'doubaowork/managed.models': { at: 1, value: { provider: 'doubaowork', models: [{ id: '9' }] } },
    'doubaowork/managed.snapshot': { at: 1, value: { provider: 'doubaowork', accounts: [{ id: 'legacy' }] } },
    'codearts/managed.models': { at: 1, value: { provider: 'codearts', models: [{ id: 'openpangu-2.0-flash' }] } },
  } })
  await writeFile(snapshotFile, prior)
  const host = fixture({ snapshotFile })
  try {
    const { result } = await host.call('settings.snapshot', {})
    assert.equal(result.ok, true)
    assert.ok(result.value.entries['codearts/managed.models'])
    for (const provider of ['coze', 'doubaowork']) {
      assert.ok(!Object.keys(result.value.entries).some(key => key.startsWith(`${provider}/`)))
      for (const method of ['managed.models', 'managed.snapshot', 'managed.login', 'automation.run']) {
        assert.equal((await host.call(method, { provider })).result.ok, false)
      }
      assert.equal((await host.call('quota.account', { provider, sessionId: 'old', model: '9' })).result.value, null)
      assert.ok(!host.calls.some(call => call.payload?.provider === provider))
    }
    assert.equal(await readFile(snapshotFile, 'utf8'), prior, '只读检查不清理历史状态盘')
  } finally { host.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('account.list 投影白名单带 plan，枚举外的值一律丢弃', async () => {
  const { publicResult } = await import('../lib/web-host.js')
  const rows = publicResult('account.list', { accounts: [
    { id: 'a', provider: 'raccoon', nickname: '甲', enabled: true, plan: 'pro' },
    { id: 'b', provider: 'raccoon', nickname: '乙', enabled: true, plan: 'free' },
    { id: 'c', provider: 'raccoon', nickname: '丙', enabled: true, plan: 'unknown' },
    { id: 'd', provider: 'raccoon', nickname: '丁', enabled: true, plan: 'PRO; DROP TABLE' },
    { id: 'e', provider: 'raccoon', nickname: '戊', enabled: true },
  ] }).accounts
  assert.deepEqual(rows.map(a => a.plan), ['pro', 'free', 'unknown', undefined, undefined])
})
test('共享主机注册独立接口，保持 RPC 信封并投影公开账号字段', async () => {
  const f = fixture()
  try {
    assert.equal(f.routes.size, 1)
    const body = await f.call('account.list', { provider: 'loomy' })
    assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, 'test-rpc'); assert.equal(body.result.ok, true)
    assert.equal(body.result.value.accounts[0].nickname, '测试')
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_REF|NEVER_DISPLAY|PRIVATE_REFRESH|credentialRef|refreshToken/)
  } finally { f.dispose() }
  assert.equal(f.disposed, true); assert.equal(f.routes.size, 0)
})
test('共用模式不向外部旧后端转发上下文单字段写入', async () => {
  const f = fixture()
  try {
    const body = await f.call('model.setParams', { provider: 'loomy', modelId: 'm1', contextOnly: true, params: { contextWindow: 200_000 } })
    assert.equal(body.result.ok, false)
    assert.ok(!f.calls.some(call => call.method === 'model.setParams'))
  } finally { f.dispose() }
})

test('接口拒绝其它渠道和跨渠道账号', async () => {
  const f = fixture()
  try {
    assert.equal((await f.call('model.list', { provider: 'qoder' })).result.ok, false)
    assert.equal((await f.call('account.delete', { provider: 'raccoon', accountId: 'a' })).result.ok, false)
    assert.deepEqual(f.calls.map(c => c.method), ['account.list'])
  } finally { f.dispose() }
})
test('账号设置只允许昵称和启停，禁止修改凭据引用与归属', async () => {
  const f = fixture()
  try {
    assert.equal((await f.call('account.update', { provider: 'loomy', accountId: 'a', patch: { credentialRef: 'OTHER' } })).result.ok, false)
    assert.equal((await f.call('account.update', { provider: 'loomy', accountId: 'a', patch: { provider: 'trae' } })).result.ok, false)
    assert.equal(f.calls.length, 0)
    const body = await f.call('account.update', { provider: 'loomy', accountId: 'a', patch: { nickname: '新名称', enabled: false } })
    assert.equal(body.result.ok, true); assert.equal(body.result.value, null)
    assert.deepEqual(f.calls.at(-1).payload.patch, { nickname: '新名称', enabled: false })
  } finally { f.dispose() }
})
test('上游错误和余额失败不会向 Web 回显密钥或响应正文', async () => {
  const f = fixture()
  try {
    const failure = await f.call('credits.claimAll', { provider: 'loomy' })
    assert.equal(failure.result.ok, false); assert.doesNotMatch(JSON.stringify(failure), /NEVER_DISPLAY/)
    const balance = await f.call('credits.balances', { provider: 'loomy' })
    assert.equal(balance.result.value.accounts[0].balance, null); assert.doesNotMatch(JSON.stringify(balance), /NEVER_DISPLAY/)
  } finally { f.dispose() }
})
test('HTTP 接口拒绝错误方法、格式和超大请求', async () => {
  const f = fixture()
  try {
    assert.equal((await f.route.fetch(new Request('http://dsh.internal/api/unified-router'))).status, 405)
    assert.equal((await f.route.fetch(new Request('http://dsh.internal/api/unified-router', { method: 'POST', body: '{}' }))).status, 415)
    assert.equal((await f.route.fetch(new Request('http://dsh.internal/api/unified-router', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' }))).status, 400)
    assert.equal((await f.route.fetch(new Request('http://dsh.internal/api/unified-router', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) }))).status, 413)
    assert.equal(f.calls.length, 0)
  } finally { f.dispose() }
})
test('登录地址只允许 HTTPS 或本机 HTTP，不接受用户信息和脚本', () => {
  assert.match(loginUrl('http://127.0.0.1:3311/login'), /^http:/)
  for (const url of ['http://example.com/login','https://user:pass@example.com','javascript:alert(1)']) assert.throws(() => loginUrl(url))
})
test('渠道后端就绪前不得直接抛「未就绪」：首屏请求要等挂载完成（真实缺陷）', () => {
  // 症状：每次打开设置页都是「未识别 / 无账号」，必须手动刷新。
  // 根因：独立后端是异步 import + mountBackend，设置页先挂载时 channelRpc 还是 null，
  // 旧实现立刻抛「渠道后端未就绪」→ 首屏那批 RPC 全失败。
  // 现在请求先 await 就绪信号（有 15s 上限），拿到 channelRpc 再转发。
  const source = readFileSync(new URL('../lib/web-host.js', import.meta.url), 'utf8')
  const dispatchAt = source.indexOf('const dispatch = async (method, payload, signal) => {')
  assert.ok(dispatchAt > 0, 'dispatch 实现变了，先修这条断言')
  const body = source.slice(dispatchAt, source.indexOf('const rpc = guardedRpc(dispatch)', dispatchAt))
  const waitAt = body.indexOf('await Promise.race([ready')
  const throwAt = body.indexOf("throw new Error('渠道后端未就绪')")
  assert.ok(waitAt > 0, 'dispatch 必须先等后端就绪')
  assert.ok(throwAt > waitAt, '「未就绪」只能在等待超时之后抛出')
})

test('Qoder 未开通每日额度与零余额保留真实语义', () => {
  const claim = publicResult('credits.claimAll', { results: [{ outcome: { kind: 'inactive', actionRequired: true, message: 'secret=NEVER_DISPLAY' } }] })
  assert.equal(claim.results[0].outcome.kind, 'inactive'); assert.equal(claim.results[0].outcome.actionRequired, true)
  assert.doesNotMatch(JSON.stringify(claim), /NEVER_DISPLAY/)
  assert.equal(publicResult('credits.balances', { accounts: [{ balance: { total: 0, packages: [] } }] }).accounts[0].balance.total, 0)
})
test('已取消的调用不触发上游；服务拒绝未支持方法', async () => {
  let calls = 0; const call = guardedRpc(async () => { calls++; return { ok: true } })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(call('credits.claimAll', { provider: 'loomy' }, abort.signal))
  await assert.rejects(call('gateway.setEnabled', { provider: 'loomy' }))
  assert.equal(calls, 0)
})

test('模型参数方法穿过全部白名单层：rpc 守卫、投影与后端', async () => {
  const { guardedRpc } = await import('../lib/rpc.js')
  const { publicResult } = await import('../lib/web-host.js')
  // 1) 守卫层放行（否则抛「不支持此操作」）
  const seen = []
  const raw = async (method, payload) => {
    seen.push(method)
    if (method === 'account.list') return { ok: true, value: { accounts: [] } }
    return { ok: true, value: { provider: payload.provider, params: { m0: { maxTokens: 4096, contextWindow: 200000, reasoningEffort: 'high' } } } }
  }
  const rpc = guardedRpc(raw)
  const read = await rpc('model.params', { provider: 'loomy' })
  assert.equal(read.params.m0.maxTokens, 4096)
  const written = await rpc('model.setParams', { provider: 'loomy', modelId: 'm0', params: { maxTokens: 1024 } })
  assert.equal(written.provider, 'loomy')
  // 2) 投影层保留界面真正会用的字段，丢弃其余（含未支持的 temperature）
  const projected = publicResult('model.params', { provider: 'loomy', params: { m0: { maxTokens: 4096, contextWindow: 200000, reasoningEffort: 'high', temperature: 0.7, extra: 'DROP' } } })
  assert.equal(projected.params.m0.maxTokens, 4096)
  assert.equal(projected.params.m0.contextWindow, 200000)
  assert.equal(projected.params.m0.reasoningEffort, 'high')
  // 后端 setModelParams 与客户端 paramsFrom 都不认 temperature：投影放行它会让人误以为已支持。
  assert.equal(projected.params.m0.temperature, undefined, '未落盘的参数不应投影给前端')
  assert.equal(projected.params.m0.extra, undefined)
  // 3) 非法渠道仍被拒绝
  await assert.rejects(() => rpc('model.params', { provider: 'evil' }))
})

test('模型目录刷新穿过全部白名单层：rpc 守卫、家族 provider 与投影来源归一', async () => {
  const { guardedRpc } = await import('../lib/rpc.js')
  const { publicResult } = await import('../lib/web-host.js')
  const seen = []
  const rpc = guardedRpc(async (method, payload) => { seen.push(method); return { ok: true, value: { count: 5, source: 'remote' } } })
  // 1) 守卫层放行：普通渠道与 Raccoon 订阅面（`raccoon-pro`）都在 PROVIDERS 内。
  assert.deepEqual(await rpc('model.refresh', { provider: 'loomy' }), { count: 5, source: 'remote' })
  assert.deepEqual(await rpc('model.refresh', { provider: 'raccoon-pro' }), { count: 5, source: 'remote' })
  assert.deepEqual(seen, ['model.refresh', 'model.refresh'])
  // 未接入的渠道仍被守卫拒绝（不发请求）。
  await assert.rejects(() => rpc('model.refresh', { provider: 'devin' }))
  assert.deepEqual(seen, ['model.refresh', 'model.refresh'])
  // 2) 投影层：只回 count + 白名单 source；未知/非法 source 一律按离线兜底，
  //    非法 count 归一成 null（界面显示「—」，不虚报条数）。
  assert.deepEqual(publicResult('model.refresh', { count: 3, source: 'remote' }), { count: 3, source: 'remote' })
  assert.deepEqual(publicResult('model.refresh', { count: 2, source: 'fallback' }), { count: 2, source: 'fallback' })
  assert.deepEqual(publicResult('model.refresh', { count: Number.NaN, source: 'upstream' }), { count: null, source: 'fallback' })
  assert.deepEqual(publicResult('model.refresh', { count: '9', source: 'remote', models: ['NEVER_DISPLAY'] }),
    { count: null, source: 'remote' })
})

test('商汤 Plan RPC 走独立白名单，快照只投影公开字段', async () => {
  const { guardedRpc, PLAN_PROVIDER_ID } = await import('../lib/rpc.js')
  const { publicResult } = await import('../lib/web-host.js')
  const seen = []
  const rpc = guardedRpc(async (method, payload) => { seen.push(method); return { ok: true, value: { accepted: payload.provider === PLAN_PROVIDER_ID } } })
  const result = await rpc('plan.setEnabled', { provider: PLAN_PROVIDER_ID, enabled: true })
  assert.equal(result.accepted, true)
  assert.deepEqual(seen, ['plan.setEnabled'])
  await assert.rejects(() => rpc('provider.status', { providers: [PLAN_PROVIDER_ID] }))
  const projected = publicResult('plan.snapshot', {
    now: 1700000000000,
    auth: { configured: true, error: 'password=NEVER_DISPLAY' },
    llm: { hasApiKey: true, registerProvider: true, providerRegistered: true, models: [], enabledModelIds: [] },
    pools: { plan: { name: 'Token Plan', secret: 'NEVER_DISPLAY' }, pools: [{ id: 'p', name: '主池', window5h: { limit: 100, used: 0, remaining: 0, resetAt: 1 }, window7d: { limit: 200, used: 0, remaining: 200, resetAt: 2 }, grantBalance: 3 }] },
    quotaError: { code: 'auth_error', message: 'Bearer NEVER_DISPLAY' },
    shapeWarnings: [], trend: { hours: 24, models: [{ model: 'm', credits: 0 }] },
  })
  assert.equal(projected.quotaError, undefined)
  assert.equal(projected.pools, undefined)
  assert.doesNotMatch(JSON.stringify(projected), /NEVER_DISPLAY|Bearer|password/)
})

test('商汤 Plan 写操作拒绝跨 Origin 请求，不触发后端或旧渠道', async () => {
  const f = fixture()
  try {
    for (const method of ['plan.setEnabled', 'plan.consoleLogin', 'automation.query']) {
      const response = await f.route.fetch(new Request('http://dsh.internal/api/unified-router', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'plan-rpc', method: 'unified-router', payload: { method, payload: { provider: 'sensenova-token-plan', enabled: true } } }),
      }))
      const body = await response.json()
      assert.equal(body.result.ok, false)
      assert.equal(body.result.error.code, 'unified-router/forbidden')
      assert.deepEqual(body.result.error.details, {}, '失败信封须符合 DSH 客户端 RPC 协议')
    }
    assert.equal(f.calls.length, 0)
  } finally { f.dispose() }
})

test('宿主手动查询只触发渠道核实，已确认的签到不再提交', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-query-'))
  const calls = []
  let deny
  const host = fixture({ snapshotFile: join(dir, 'settings.json'), requestRejection: () => deny, testDeps: {
    createManagedManager(_ctx, spec) {
      return {
        async listAccounts() { return [{ id: 'fixture-account', name: '测试' }] },
        async call(method) {
          calls.push([spec.id, method])
          return { outcome: 'done', credit: 80, token: 'NEVER_DISPLAY' }
        },
        dispose() {},
      }
    },
  } })
  const target = { provider: 'codearts', mode: 'checkin', accountId: 'fixture-account' }
  try {
    deny = 403
    assert.equal((await host.call('automation.query', target)).result.error.code, 'unified-router/forbidden')
    deny = undefined
    const { result } = await host.call('automation.query', target)
    assert.equal(result.ok, true)
    assert.equal(result.value.results[0].verified, true)
    assert.equal(result.value.results[0].outcome.kind, 'already-claimed')
    assert.doesNotMatch(JSON.stringify(result), /NEVER_DISPLAY/)
    const ledger = (await host.call('automation.query', target)).result.value.results[0]
    assert.equal(ledger.outcome.kind, 'already-claimed')
    assert.equal((await host.call('managed.checkin', target)).result.value.outcome, 'done')
    assert.ok(calls.length >= 1)
    assert.ok(calls.every(([id, method]) => id === 'codearts' && method === 'managed.checkinStatus'))
  } finally { host.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('WorkBuddy 投影逐账号白名单：错误码、窗口与登录地址过滤，凭据与上游原文不外放', () => {
  // 上游/损坏的凭据对象可能整块被带进来，投影层是最后一道白名单。
  const snapshot = publicResult('workbuddy.snapshot', {
    accounts: [
      {
        id: 'workbuddy-aaaaaaaa', name: '账号甲', uid: 'u-1', signedIn: true, plan: 'Pro', signIn: 'renewed',
        updatedAt: 1700000000000, access: 'NEVER_DISPLAY', refresh: 'NEVER_DISPLAY', error: '上游原文 NEVER_DISPLAY',
        windows: [
          { name: 'Credits', used: 20, amount: 100, display: '400 / 500', resetsAt: '2026-12-01T00:00:00Z', token: 'NEVER_DISPLAY' },
          { used: 1, token: 'NEVER_DISPLAY' },
        ],
        models: [{ id: 'm1', name: '模型一', free: true, api: { key: 'NEVER_DISPLAY' } }],
      },
      { id: 'workbuddy-bbbbbbbb', name: '账号乙', uid: 'u-2', signedIn: false, error: 'not_configured' },
      // 无 id 的行不是账号，投影层直接丢弃（客户端也有同样的兜底）。
      { signedIn: true, access: 'NEVER_DISPLAY' },
    ],
    loginUrl: 'https://copilot.tencent.com/login',
    // 旧单账号字段与模型目录不再出现在快照面（目录走 workbuddy.models）。
    signedIn: true, plan: 'Pro', access: 'NEVER_DISPLAY',
    models: [{ id: 'm1', name: '模型一', free: true, api: { key: 'NEVER_DISPLAY' } }],
  })
  assert.doesNotMatch(JSON.stringify(snapshot), /NEVER_DISPLAY/)
  assert.equal(snapshot.loginUrl, 'https://copilot.tencent.com/login')
  assert.equal(snapshot.models, undefined, '快照不带模型目录')
  assert.equal(snapshot.accounts.length, 2)
  const [first, second] = snapshot.accounts
  // 非白名单错误码丢弃成空串，不让上游原文借着 error 字段流出。
  assert.equal(first.id, 'workbuddy-aaaaaaaa')
  assert.equal(first.name, '账号甲')
  assert.equal(first.uid, 'u-1')
  assert.equal(first.signedIn, true)
  assert.equal(first.plan, 'Pro')
  assert.equal(first.signIn, 'renewed')
  assert.equal(first.error, '')
  assert.equal(first.updatedAt, 1700000000000)
  // 窗口逐字段白名单：夹带的 token 不出现在任何一行。
  assert.equal(first.windows.length, 2)
  assert.ok(first.windows.every(w => w.token === undefined))
  // 缺 name 的窗口投影层仍保留结构，客户端 workbuddyWindowFrom 会再丢掉。
  assert.equal(first.windows[1].name, '')
  assert.equal(first.windows[0].name, 'Credits')
  assert.equal(first.windows[0].display, '400 / 500')
  assert.equal(second.signedIn, false)
  assert.equal(second.error, 'not_configured')
  // 白名单内的错误码保留；非法登录地址只丢地址，不拖垮整次快照。
  const errored = publicResult('workbuddy.snapshot', { accounts: [{ id: 'workbuddy-cccccccc', signedIn: true, error: 'auth_error' }] })
  assert.equal(errored.accounts[0].error, 'auth_error')
  const badUrl = publicResult('workbuddy.snapshot', { accounts: [], error: '', loginUrl: 'javascript:alert(1)' })
  assert.equal(badUrl.loginUrl, '')
  assert.deepEqual(badUrl.accounts, [])
  // 模型目录单独投影（能力字段白名单）。
  const models = publicResult('workbuddy.models', { models: [{
    id: 'm1', name: '模型一', free: true, enabled: false, defaultEffort: 'high',
    params: { maxTokens: 16384, compat: { supportsStore: false }, secret: 'NEVER_DISPLAY' }, api: { key: 'NEVER_DISPLAY' },
  }] })
  assert.equal(models.models[0].enabled, false)
  assert.equal(models.models[0].defaultEffort, 'high')
  assert.deepEqual(models.models[0].params, { maxTokens: 16384 })
  assert.equal(models.models[0].api, undefined)
  assert.doesNotMatch(JSON.stringify(models), /NEVER_DISPLAY/)
  const paid = publicResult('workbuddy.models', { models: [{ id: 'm2', rate: 0.135, attachment: null }] })
  assert.equal(paid.models[0].rate.multiplier, 0.135)
  assert.equal(paid.models[0].attachment, null)
  assert.deepEqual(publicResult('workbuddy.models', JSON.parse(JSON.stringify(paid))), paid)
  // 签到：上游 message 原文不透出，未知 outcome 归一成 failed。
  assert.deepEqual(publicResult('workbuddy.checkin', { outcome: 'claimed', credit: 5, streak: 2, message: 'NEVER_DISPLAY' }),
    { outcome: 'claimed', credit: 5, streak: 2 })
  assert.equal(publicResult('workbuddy.checkin', { outcome: ' bogus' }).outcome, 'failed')
  // login/logout 只回账号标识与登录状态，不回凭据。
  assert.deepEqual(publicResult('workbuddy.login', { id: 'workbuddy-aaaaaaaa', signedIn: true, accountId: 'acc', uid: 'u1', access: 'NEVER_DISPLAY' }),
    { id: 'workbuddy-aaaaaaaa', signedIn: true, accountId: 'acc', uid: 'u1' })
  assert.deepEqual(publicResult('workbuddy.logout', { signedIn: false, access: 'NEVER_DISPLAY' }), { signedIn: false })
})

test('WorkBuddy 写操作拒绝跨 Origin 请求，管理器与后端都不会被触达', async () => {
  const f = fixture()
  try {
    // snapshot 名为读，但 token 续期会落盘凭据，所以四个方法都在写门禁里。
    for (const method of ['workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.snapshot']) {
      const response = await f.route.fetch(new Request('http://dsh.internal/api/unified-router', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ type: 'client-request', rpcId: `wb-${method}`, method: 'unified-router', payload: { method, payload: { provider: 'workbuddy' } } }),
      }))
      const body = await response.json()
      assert.equal(body.result.ok, false, `${method} 必须被写门禁拦下`)
      assert.equal(body.result.error.code, 'unified-router/forbidden', method)
      assert.deepEqual(body.result.error.details, {}, '失败信封须符合 DSH 客户端 RPC 协议')
    }
    // 跨 Origin 在到达管理器之前就返回：没走到快照（未登录时会正常返回 ok）也没到渠道后端。
    assert.equal(f.calls.length, 0)
  } finally { f.dispose() }
})

test('WorkBuddy 无账号时快照经真实管理器返回空账户列表', async () => {
  const f = fixture()
  try {
    // fixture 的 credentials 是空对象：管理器读不到账号索引与旧单账号引用，
    // 按空账号处理，不抛错、不去碰渠道后端。
    const body = await f.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.equal(body.result.ok, true)
    const value = body.result.value
    assert.deepEqual(value.accounts, [])
    assert.equal(value.loginUrl, '')
    assert.equal(f.calls.length, 0)
  } finally { f.dispose() }
})

test('WorkBuddy 带 accountId 的方法不触发账号池归属检查', async () => {
  const f = fixture()
  try {
    // 陷阱：guardedRpc 对带 accountId 的方法会先 raw('account.list') 验证归属，
    // 而 WorkBuddy 的账号不在 channel-pack 账号池里——未豁免时 checkin/logout 必然失败。
    for (const method of ['workbuddy.checkin', 'workbuddy.logout', 'workbuddy.models']) {
      const body = await f.call(method, { provider: 'workbuddy', accountId: 'workbuddy-aaaaaaaa' })
      // 管理器本身不认这个账号（索引为空）而失败，但**没有**去问账号池。
      assert.equal(body.result.ok, false, method)
      assert.equal(body.result.error.code, 'unified-router/operation-failed', method)
    }
    assert.equal(f.calls.some(c => c.method === 'account.list'), false, '不得为 WorkBuddy 调用 account.list')
  } finally { f.dispose() }
})

test('宿主后台按分钟采集，删除后的旧请求不能复活账号', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-snapshots-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  t.mock.timers.enable({ apis: ['setInterval'] })
  const key = 'fixture/account.list'
  let count = 0
  let finish
  const stalled = new Promise(resolve => { finish = resolve })
  const resource = {
    restore: value => value,
    async collect() {
      count++
      if (count === 2) return stalled
      return { accounts: count === 1 ? [{ id: 'old' }] : [] }
    },
  }
  const snapshots = createSettingsSnapshots(join(dir, 'settings.json'), new Map([[key, resource]]))
  try {
    await snapshots.refresh([key])
    assert.deepEqual((await snapshots.read(key)).value.accounts, [{ id: 'old' }])
    t.mock.timers.tick(SNAPSHOT_INTERVAL_MS)
    await Promise.resolve()
    assert.equal(count, 2)
    assert.deepEqual((await snapshots.read(key)).value.accounts, [{ id: 'old' }], '上游挂起时仍可读上次快照')
    await snapshots.changed(key, () => ({ accounts: [] }))
    finish({ accounts: [{ id: 'old' }] })
    await snapshots.refresh([key])
    assert.equal(count, 3)
    assert.deepEqual((await snapshots.read(key)).value.accounts, [])
    const first = await snapshots.readAll()
    assert.deepEqual((await snapshots.readAll(first.cursor)).entries, null)
  } finally { finish({ accounts: [] }); snapshots.dispose() }
})

test('设置读取只读宿主快照，失败保留独立账号的上次额度，重启可恢复', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-snapshots-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const snapshotFile = join(dir, 'settings.json')
  let mode = 'offline'
  const live = fixture({
    autoCollect: true, snapshotFile,
    async balance({ provider }) {
      if (provider !== 'loomy') return { ok: true, value: { accounts: [] } }
      if (mode === 'offline') return { ok: false }
      return { ok: true, value: { accounts: mode === 'partial'
        ? [{ accountId: 'a', balance: null, error: 'upstream secret=NEVER_DISPLAY' }]
        : [{ accountId: 'a', balance: { total: 420, packages: [] } }] } }
    },
  })
  const read = host => host.call('credits.balances', { provider: 'loomy', snapshot: true })
  const until = async callback => {
    for (let i = 0; i < 100; i++) {
      const value = await callback()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('快照未完成')
  }
  try {
    await until(async () => (await read(live)).result.value.snapshot.stale)
    mode = 'online'
    assert.equal((await live.call('settings.refresh', { provider: 'loomy' })).result.ok, true)
    await until(async () => (await read(live)).result.value.accounts?.[0]?.balance?.total === 420)
    const upstreamCalls = live.calls.filter(call => call.method === 'credits.balances' && call.payload.provider === 'loomy').length
    const stored = await live.call('settings.snapshot', {})
    const accounts = stored.result.value.entries['loomy/account.list'].value.accounts
    assert.equal(accounts[0].id, 'a')
    assert.doesNotMatch(JSON.stringify(stored), /NEVER_DISPLAY|PRIVATE_REF|PRIVATE_REFRESH|loginUrl/)
    await read(live)
    assert.equal(live.calls.filter(call => call.method === 'credits.balances' && call.payload.provider === 'loomy').length, upstreamCalls)
    mode = 'partial'
    assert.equal((await live.call('settings.refresh', { provider: 'loomy' })).result.ok, true)
    const cached = await until(async () => {
      try {
        const saved = JSON.parse(await readFile(snapshotFile, 'utf8'))
        return saved.entries['loomy/credits.balances'].value.accounts[0].error ? saved : null
      } catch { return null }
    })
    assert.equal(cached.entries['loomy/credits.balances'].value.accounts[0].balance.total, 420)
    assert.doesNotMatch(JSON.stringify(cached), /NEVER_DISPLAY|PRIVATE_REF|PRIVATE_REFRESH|loginUrl/)
  } finally { live.dispose() }
  const reopened = fixture({ snapshotFile })
  try {
    assert.equal((await read(reopened)).result.value.accounts[0].balance.total, 420)
    assert.equal(reopened.calls.length, 0)
  } finally { reopened.dispose() }
})

test('自动签到共用逐账号持久记录，手动并发和重启都不会重复提交', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-checkin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let resume
  let started
  const startedClaim = new Promise(resolve => { started = resolve })
  const claimResponse = new Promise(resolve => { resume = resolve })
  const calls = []
  const adapters = new Map([['loomy', {
    list: async () => [{ id: 'first' }, { id: 'second' }],
    async claim(id) {
      calls.push(id)
      if (id === 'first') { started(); return claimResponse }
      throw new Error('private response')
    },
  }]])
  const options = { dir, adapters, now: () => Date.parse('2026-11-18T07:00:00Z') }
  const first = createDailyCheckin(options)
  const nextHost = createDailyCheckin(options)
  try {
    const automatic = first.tick()
    await startedClaim
    const manual = first.claim('loomy', 'first')
    // Simulates a plugin reload while the previous host's request is in flight.
    const [pending] = await nextHost.claim('loomy', 'first')
    assert.equal(pending.outcome.kind, 'pending')
    assert.equal(pending.repeated, true)
    resume({ kind: 'claimed', credit: 20 })
    await automatic
    assert.equal((await manual)[0].outcome.kind, 'claimed')
    assert.equal((await nextHost.claim('loomy', 'first'))[0].repeated, true)
    await nextHost.tick()
    assert.deepEqual(calls, ['first', 'second'])
    const status = (await nextHost.status()).providers.loomy
    assert.deepEqual(Object.fromEntries(status.accounts.map(row => [row.accountId, row.kind])), { first: 'claimed', second: 'failed' })
    assert.doesNotMatch(JSON.stringify(status), /private response/)
  } finally { resume({ kind: 'failed' }); first.dispose(); nextHost.dispose() }
})

test('每日定时任务跨日继续运行，Qoder 在 10:00 港时开始当轮签到', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-checkin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let clock = Date.parse('2026-11-18T01:59:00Z')
  const calls = []
  const adapters = new Map([['loomy', 0], ['qodercn', 10]].map(([provider, resetHour]) => [provider, {
    resetHour,
    list: async () => [{ id: provider }],
    claim: async () => { calls.push(provider); return { kind: 'already-claimed' } },
  }]))
  const checkin = createDailyCheckin({ dir, adapters, now: () => clock })
  try {
    checkin.start(0)
    t.mock.timers.tick(0)
    await checkin.tick()
    assert.deepEqual(calls, ['loomy'])
    const [yesterday] = await checkin.claim('qodercn', 'qodercn')
    assert.equal(yesterday.outcome.kind, 'already-claimed')
    assert.equal((await checkin.status()).providers.qodercn.date, '2026-11-17')
    clock += 60_000
    t.mock.timers.tick(60_000)
    await checkin.tick()
    assert.deepEqual(calls, ['loomy', 'qodercn', 'qodercn'])
    assert.equal((await checkin.status()).providers.qodercn.date, '2026-11-18')
    clock = Date.parse('2026-11-18T16:01:00Z')
    t.mock.timers.tick(60_000)
    await checkin.tick()
    assert.deepEqual(calls, ['loomy', 'qodercn', 'qodercn', 'loomy'])
  } finally { checkin.dispose() }
})

test('独立模式使用四个签到渠道，共用模式由原后端负责共用账号池', () => {
  const standalone = settingsCheckinAdapters({ standalone: true })
  assert.deepEqual([...standalone.keys()], ['loomy', 'qodercn', 'trae', 'workbuddy'])
  assert.deepEqual([...settingsCheckinAdapters({ standalone: false }).keys()], ['workbuddy'])
})

test('只读预检暂不可领时隔一段时间重查，提交成功后停止', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'router-checkin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let clock = Date.parse('2026-11-18T03:00:00Z')
  let calls = 0
  const adapters = new Map([['qodercn', {
    resetHour: 10,
    list: async () => [{ id: 'account' }],
    claim: async () => ++calls === 1 ? { kind: 'inactive', unsubmitted: true } : { kind: 'claimed' },
  }]])
  const checkin = createDailyCheckin({ dir, adapters, now: () => clock })
  try {
    await checkin.tick()
    assert.deepEqual((await checkin.status()).providers.qodercn.accounts, [{ accountId: 'account', kind: 'inactive', retryable: true }])
    clock += 60_000
    await checkin.tick()
    assert.equal(calls, 1)
    clock += 15 * 60_000
    await checkin.tick()
    await checkin.tick()
    assert.equal(calls, 2)
    assert.deepEqual((await checkin.status()).providers.qodercn.accounts, [{ accountId: 'account', kind: 'claimed', retryable: false }])
  } finally { checkin.dispose() }
})
