import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, publicResult } from '../lib/web-host.js'
import { APIKEY_METHODS, APIKEY_PROVIDER_IDS } from '../lib/rpc.js'

// lib/apikey-providers.js / lib/apikey-channel.js 由另一分支实现，本文件一律不
// 静态引用：渠道规格与工厂经 testDeps.apiKeyProviders / testDeps.createApiKeyManager
// 注入（宿主懒装配在首次 apikey.* 调用时才解析，模块缺失只影响该次调用）。
const APIKEY_SPECS = {
  agnes: { id: 'agnes', credentialRef: 'UNIFIED_ROUTER_AGNES_KEY', endpoint: 'https://agnes.example/v1' },
  unisound: { id: 'unisound', credentialRef: 'UNIFIED_ROUTER_UNISOUND_KEY', endpoint: 'https://unisound.example/v1' },
}
const apiKeyProviders = id => APIKEY_SPECS[id]

const modelRow = id => ({
  id, name: `模型 ${id}`, context: 128000, output: 8192, attachment: true, reasoning: true,
  efforts: ['off', 'low', 'high', 'insane'], defaultEffort: 'low',
  enabled: true, contextWindow: 131072, maxOutputLength: 4096, vision: true,
  effectiveEffort: 'high', params: { thinking: { type: 'enabled' } },
  defaultContextWindow: 128000, defaultMaxOutputLength: 8192, defaultVision: false,
  apiKey: 'NEVER_DISPLAY', apiBase: 'https://secret.example', authorization: 'Bearer NEVER_DISPLAY',
})

function makeManager(id, { snapshot } = {}) {
  const state = {
    calls: [], collected: 0, invalidated: 0, disposed: 0,
    snapshot: snapshot ?? {
      hasKey: true, enabled: true, registered: true,
      catalogSource: 'remote', catalogError: '', updatedAt: 1700000000000,
      models: [modelRow(`${id}-a`), modelRow(`${id}-b`)],
      balance: { used: 12.5, limit: 100, unlimited: false, unit: 'CNY', updatedAt: 1700000001000 },
      apiKey: 'NEVER_DISPLAY', rawError: 'upstream 500 secret=NEVER_DISPLAY',
    },
    error: null,
    returnFor(method) {
      if (this.error) throw this.error
      if (method === 'apikey.setKey') return { hasApiKey: true }
      if (method === 'apikey.setEnabled') return { enabled: true, providerRegistered: true }
      if (method === 'apikey.setModelEnabled') return { modelId: `${id}-a`, enabled: false }
      if (method === 'apikey.setModelParams') return { modelId: `${id}-a`, ...modelRow(`${id}-a`), enabled: true }
      if (method === 'apikey.resetModels') return { enabledModelIds: [`${id}-b`] }
      return undefined
    },
    async call(method, payload, _signal) {
      this.calls.push({ method, payload })
      return this.returnFor(method)
    },
    async collectSnapshot(_signal) {
      this.collected += 1
      return this.snapshot
    },
    async invalidate() { this.invalidated += 1 },
    dispose() { this.disposed += 1 },
  }
  return state
}

function fixture({ autoCollect = false, snapshotFile, managers, providers = apiKeyProviders } = {}) {
  const routes = new Map(); const calls = []; const cleanup = []
  const created = managers ?? new Map()
  const raw = async (method, payload) => {
    calls.push({ method, payload })
    return { ok: false, error: { code: 'upstream', message: 'secret=NEVER_DISPLAY' } }
  }
  const connection = {
    createPeer() { return { dispose() {} } },
    createSharedFetchHandler(base) {
      assert.equal(base, '/api')
      return { async fetch(request) {
        const body = await request.json()
        return Response.json({ type: 'server-response', rpcId: body.rpcId, result: await raw(body.payload.method, body.payload.payload) })
      } }
    },
    fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  }
  const ctx = { connection, credentials: {}, llm: {}, get: key => ctx[key], inject(_deps, fn) { fn(this) }, effect(fn) { cleanup.push(fn()) } }
  const deps = { autoCollect, snapshotFile, apiKeyProviders: providers,
    createApiKeyManager: async (host, spec, managerDeps) => {
      const manager = created.get(spec.id) ?? (() => { const m = makeManager(spec.id); created.set(spec.id, m); return m })()
      manager.factoryArgs = { spec, managerDeps, host }
      return manager
    } }
  apply(ctx, { backend: 'shared' }, deps)
  const route = routes.get('/api/unified-router')
  const call = async (method, payload, headers = {}) => {
    const response = await route.fetch(new Request('http://dsh.internal/api/unified-router', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'client-request', rpcId: 'apikey-rpc', method: 'unified-router', payload: { method, payload } }),
    }))
    return response.json()
  }
  const until = async callback => {
    for (let i = 0; i < 100; i++) {
      const value = await callback()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('快照未完成')
  }
  return {
    route, call, calls, created, until,
    manager(id) { return created.get(id) },
    dispose() { for (const stop of cleanup.reverse()) stop?.() },
  }
}

const forbiddenCall = (f, method, payload) => f.call(method, payload, { origin: 'https://evil.example' })

test('APIKEY 方法白名单与渠道 id 与规格表一致', () => {
  assert.deepEqual([...APIKEY_PROVIDER_IDS], ['agnes', 'unisound'])
  assert.deepEqual([...APIKEY_METHODS].sort(), [
    'apikey.resetModels', 'apikey.setEnabled', 'apikey.setKey',
    'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.snapshot',
  ])
})

test('未知 provider 的 apikey.* 被拒且不创建管理器', async () => {
  const f = fixture()
  try {
    for (const method of APIKEY_METHODS) {
      const body = await f.call(method, { provider: 'evil-apikey', modelId: 'm' })
      assert.equal(body.result.ok, false, method)
      assert.equal(body.result.error.code, 'unified-router/operation-failed', method)
      assert.deepEqual(body.result.error.details, {})
    }
    assert.equal(f.created.size, 0, '白名单外的 provider 不得触发懒装配')
  } finally { f.dispose() }
})

test('未知方法与非法 payload 被拒', async () => {
  const f = fixture()
  try {
    assert.equal((await f.call('apikey.explode', { provider: 'agnes' })).result.ok, false)
    const bad = await f.route.fetch(new Request('http://dsh.internal/api/unified-router', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'x', method: 'unified-router', payload: { method: 'apikey.snapshot', payload: ['agnes'] } }),
    }))
    assert.equal((await bad.json()).result.error.code, 'unified-router/bad-request')
    assert.equal(f.created.size, 0)
  } finally { f.dispose() }
})

test('apikey 写操作拒绝跨 Origin 请求且不进管理器', async () => {
  const f = fixture()
  try {
    const writes = ['apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels']
    for (const method of writes) {
      const body = await forbiddenCall(f, method, { provider: 'agnes', modelId: 'agnes-a' })
      assert.equal(body.result.ok, false, method)
      assert.equal(body.result.error.code, 'unified-router/forbidden', method)
      assert.deepEqual(body.result.error.details, {}, '失败信封须符合 DSH 客户端 RPC 协议')
    }
    assert.equal(f.created.size, 0, '跨源写不得触发管理器加载')
    // apikey.snapshot 是纯读，不做同源门禁（但跨源请求仍走同一 RPC 校验）。
    const snap = await forbiddenCall(f, 'apikey.snapshot', { provider: 'agnes' })
    assert.equal(snap.result.ok, true)
    assert.equal(snap.result.value.provider, 'agnes')
  } finally { f.dispose() }
})

test('apikey 方法直通本渠道管理器，不经账号池归属检查', async () => {
  const f = fixture()
  try {
    // accountId 是 apikey 方法的无意义字段：不得因此触发 account.list 归属检查。
    const body = await f.call('apikey.setEnabled', { provider: 'agnes', enabled: true, accountId: 'wb-123' })
    assert.equal(body.result.ok, true)
    assert.deepEqual(body.result.value, { enabled: true, providerRegistered: true })
    assert.equal(f.calls.filter(call => call.method === 'account.list').length, 0)
    const agnes = f.manager('agnes')
    assert.equal(agnes.calls.length, 1)
    assert.deepEqual(agnes.calls[0], { method: 'apikey.setEnabled', payload: { provider: 'agnes', enabled: true, accountId: 'wb-123' } })
    // 每渠道独立管理器：provider 决定路由目标，文件 deps 按渠道 id 命名。
    assert.equal(agnes.factoryArgs.spec.credentialRef, 'UNIFIED_ROUTER_AGNES_KEY')
    assert.match(agnes.factoryArgs.managerDeps.stateFile, /agnes-state\.json$/)
    assert.match(agnes.factoryArgs.managerDeps.catalogFile, /agnes-catalog\.json$/)
    assert.match(agnes.factoryArgs.managerDeps.modelSettingsFile, /agnes-models\.json$/)
    const other = await f.call('apikey.setKey', { provider: 'unisound', apiKey: 'x' })
    assert.equal(other.result.ok, true)
    assert.equal(f.manager('unisound').calls.length, 1)
    assert.equal(agnes.calls.length, 1, 'unisound 调用不得串到 agnes')
  } finally { f.dispose() }
})

test('apikey.snapshot 经 collectSnapshot 且投影内部字段名', async () => {
  const f = fixture()
  try {
    const body = await f.call('apikey.snapshot', { provider: 'agnes' })
    assert.equal(body.result.ok, true)
    const agnes = f.manager('agnes')
    assert.equal(agnes.collected, 1, '快照必须走 collectSnapshot，不得走 call')
    assert.equal(agnes.calls.length, 0)
    const value = body.result.value
    assert.equal(value.provider, 'agnes')
    assert.equal(value.hasApiKey, true)
    assert.equal(value.registerProvider, true)
    assert.equal(value.providerRegistered, true)
    assert.equal(value.catalogSource, 'remote')
    assert.equal(value.catalogError, false)
    assert.equal(value.updatedAt, 1700000000000)
    assert.equal(value.models.length, 2)
    const model = value.models[0]
    assert.equal(model.id, 'agnes-a')
    assert.equal(model.enabled, true)
    assert.equal(model.contextWindow, 131072)
    assert.deepEqual(model.thinkingLevels, ['off', 'low', 'high'], 'efforts 按 PLAN_EFFORTS 白名单顺序过滤')
    assert.equal(model.defaultVision, false)
    assert.deepEqual(value.balance, { used: 12.5, limit: 100, unlimited: false, unit: 'CNY', updatedAt: 1700000001000 })
    assert.doesNotMatch(JSON.stringify(body), /NEVER_DISPLAY|apiKey|apiBase|authorization|rawError|hasKey|registered/)
  } finally { f.dispose() }
})

test('apikey 写方法投影返回值且外泄字段被过滤', async () => {
  const f = fixture()
  try {
    const params = await f.call('apikey.setModelParams', { provider: 'agnes', modelId: 'agnes-a', params: {} })
    assert.equal(params.result.ok, true)
    assert.equal(params.result.value.modelId, 'agnes-a')
    assert.equal(params.result.value.contextWindow, 131072)
    assert.deepEqual(params.result.value.thinkingLevels, ['off', 'low', 'high'])
    assert.equal((await f.call('apikey.setModelEnabled', { provider: 'agnes', modelId: 'agnes-a', enabled: false })).result.value.enabled, false)
    assert.deepEqual((await f.call('apikey.resetModels', { provider: 'agnes' })).result.value, { enabledModelIds: ['agnes-b'] })
    assert.equal((await f.call('apikey.setKey', { provider: 'agnes', apiKey: 'sk-x' })).result.value.hasApiKey, true)
    for (const method of ['apikey.setModelParams', 'apikey.setModelEnabled', 'apikey.resetModels', 'apikey.setKey']) {
      assert.doesNotMatch(JSON.stringify(await f.call(method, { provider: 'agnes', modelId: 'agnes-a', apiKey: 'sk-x' })), /NEVER_DISPLAY|apiKey|apiBase/)
    }
  } finally { f.dispose() }
})

test('balance 投影三种形状：null / {error:true} / 正常值', async () => {
  const managers = new Map()
  for (const [id, snapshot] of [
    ['agnes', { hasKey: true, enabled: true, registered: true, catalogSource: 'fallback', catalogError: 'HTTP 503 upstream=NEVER_DISPLAY', updatedAt: null, models: [], balance: null }],
    ['unisound', { hasKey: true, enabled: true, registered: true, catalogSource: 'cached', catalogError: true, updatedAt: null, models: [], balance: { error: true } }],
  ]) managers.set(id, makeManager(id, { snapshot }))
  const f = fixture({ managers })
  try {
    const agnes = (await f.call('apikey.snapshot', { provider: 'agnes' })).result.value
    assert.equal(agnes.balance, null)
    assert.equal(agnes.catalogError, true, '字符串错误投影成布尔')
    const unisound = (await f.call('apikey.snapshot', { provider: 'unisound' })).result.value
    assert.deepEqual(unisound.balance, { error: true })
    assert.doesNotMatch(JSON.stringify(agnes) + JSON.stringify(unisound), /NEVER_DISPLAY|HTTP 503/)
  } finally { f.dispose() }
})

test('模型列表过滤非法 id、截断到 512、脏字段不外泄', () => {
  const models = Array.from({ length: 520 }, (_, i) => modelRow(`m-${i}`))
  models.push(modelRow('  '), modelRow('__proto__'), modelRow('x'.repeat(300)), { name: '无 id' }, null)
  const projected = publicResult('apikey.snapshot', {
    provider: 'agnes', hasKey: true, enabled: true, registered: true, catalogSource: 'remote',
    catalogError: false, updatedAt: 1, models, balance: null, apiKey: 'NEVER_DISPLAY',
  })
  assert.equal(projected.models.length, 512)
  assert.equal(projected.models.at(-1).id, 'm-511')
  assert.doesNotMatch(JSON.stringify(projected), /NEVER_DISPLAY|apiKey|apiBase|authorization/)
})

test('已投影形状幂等：内部与投影字段名可互相恢复', () => {
  for (const source of [
    { provider: 'agnes', hasKey: true, enabled: true, registered: true, catalogSource: 'cached', models: [{ id: 'm', enabled: true }], balance: null },
    { provider: 'agnes', hasApiKey: true, registerProvider: true, providerRegistered: true, catalogSource: 'cached', models: [{ id: 'm', enabled: true }], balance: null },
  ]) {
    const value = publicResult('apikey.snapshot', source)
    assert.equal(value.hasApiKey, true)
    assert.equal(value.registerProvider, true)
    assert.equal(value.providerRegistered, true)
    assert.equal(value.models[0].enabled, true)
  }
})

test('设置快照采集 apikey.snapshot 并经 settings.snapshot/settings.refresh 读取', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'apikey-host-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const f = fixture({ autoCollect: true, snapshotFile: join(dir, 'settings.json') })
  try {
    // settings.snapshot 返回整条快照条目 {at, value, stale}；投影在 entry.value 里。
    const stored = await f.until(async () => {
      const body = await f.call('settings.snapshot', { resource: 'apikey.snapshot', provider: 'agnes' })
      return body.result.value?.value?.provider === 'agnes' ? body.result.value.value : null
    })
    assert.equal(stored.hasApiKey, true)
    assert.equal(stored.models.length, 2)
    assert.equal(stored.models[0].id, 'agnes-a')
    assert.equal(f.manager('agnes').collected >= 1, true)
    const all = await f.call('settings.snapshot', {})
    assert.equal(all.result.value.entries['agnes/apikey.snapshot'].value.provider, 'agnes')
    assert.equal(all.result.value.entries['unisound/apikey.snapshot'].value.provider, 'unisound')
    assert.doesNotMatch(JSON.stringify(all), /NEVER_DISPLAY/)
    // settings.refresh：先 invalidate 再重采集。
    const agnes = f.manager('agnes')
    const before = { collected: agnes.collected, invalidated: agnes.invalidated }
    assert.equal((await f.call('settings.refresh', { provider: 'agnes' })).result.ok, true)
    assert.equal(agnes.invalidated, before.invalidated + 1)
    await f.until(async () => agnes.collected > before.collected || null)
    // snapshot:true 读取缓存条目并附带采集元数据。
    const cached = await f.call('apikey.snapshot', { provider: 'agnes', snapshot: true })
    assert.equal(cached.result.value.provider, 'agnes')
    assert.equal(typeof cached.result.value.snapshot.at, 'number')
  } finally { f.dispose() }
})

test('写操作后 apikey 快照随 autoCollect 更新', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'apikey-host-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const agnes = makeManager('agnes')
  const f = fixture({ autoCollect: true, snapshotFile: join(dir, 'settings.json'), managers: new Map([['agnes', agnes]]) })
  try {
    await f.until(async () => (await f.call('settings.snapshot', { resource: 'apikey.snapshot', provider: 'agnes' })).result.value?.value?.provider === 'agnes')
    assert.equal((await f.call('apikey.setEnabled', { provider: 'agnes', enabled: true })).result.ok, true)
    // 乐观补丁立刻可见（registerProvider/providerRegistered 由投影值合入）。
    const patched = await f.until(async () => {
      const body = await f.call('settings.snapshot', { resource: 'apikey.snapshot', provider: 'agnes' })
      const value = body.result.value?.value
      return value?.registerProvider === true && value?.providerRegistered === true ? value : null
    })
    assert.equal(patched.hasApiKey, true)
    const saved = await f.until(async () => {
      try {
        const parsed = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
        const entry = parsed.entries['agnes/apikey.snapshot']
        return entry?.value?.provider === 'agnes' ? entry : null
      } catch { return null }
    })
    assert.equal(saved.value.models.length, 2)
    assert.doesNotMatch(JSON.stringify(saved), /NEVER_DISPLAY|hasKey|rawError/)
  } finally { f.dispose() }
})

test('dispose 释放全部 apikey 管理器，仅一次', async () => {
  const f = fixture()
  await f.call('apikey.snapshot', { provider: 'agnes' })
  await f.call('apikey.snapshot', { provider: 'unisound' })
  f.dispose()
  assert.equal(f.manager('agnes').disposed, 1)
  assert.equal(f.manager('unisound').disposed, 1)
})
