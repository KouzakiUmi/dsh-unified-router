import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSenseNovaManager } from '../lib/sensenova.js'
import { planRequestDefaults } from '../lib/sensenova-params.js'
import { guardedRpc } from '../lib/rpc.js'
import { apply, publicResult } from '../lib/web-host.js'
import { a as buildDescriptors, C as resolveSettings } from '../vendor/sensenova-token-plan/llm-models.js'
import { buildSnapshotBody, catalogSignature } from '../vendor/sensenova-token-plan/index.js'

const provider = 'sensenova-token-plan'
const row = id => ({ id, name: `模型 ${id}`, context_length: 128000, max_output_length: 8192, output_modalities: ['text'] })
function fixture(entries = [row('a'), row('b')], enabledModelIds = [], options = {}) {
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-plan-models-'))
  process.env.DSH_HOME = root
  const dir = path.join(root, 'state', 'web', 'dsh-unified-router-sensenova')
  const foreign = path.join(root, 'state', 'web', 'dsh-connect-sensenova-token-plan')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(foreign, { recursive: true })
  fs.writeFileSync(path.join(foreign, 'catalog.json'), 'foreign sentinel')
  const file = path.join(dir, 'catalog.json')
  fs.writeFileSync(file, JSON.stringify({ version: options.version ?? 2, fetchedAt: Date.now(), entries, enabledModelIds }))
  const values = new Map([['UNIFIED_ROUTER_SENSENOVA_API_KEY', 'sk-fixture-only']])
  const records = new Map()
  const credentials = {
    async resolve(key) { return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) { values.set(key, value) },
    async unset(key) { values.delete(key) },
    async readRecord(key) { return records.get(key) },
    async modifyRecord(key, fn) { const value = await fn(records.get(key)); if (value !== undefined) records.set(key, value); return value },
    async deleteRecord(key) { records.delete(key) },
  }
  const ctx = { credentials, llm: {}, profileContext: { name: 'web' }, logger: { warn() {} }, get(name) { return this[name] } }
  const managers = []
  const create = (config, deps) => { const m = createSenseNovaManager(ctx, config, deps); managers.push(m); return m }
  const catalog = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  globalThis.fetch = async () => { throw new Error('offline: fixture blocks network') }
  return { create, catalog, file, foreign, root, ctx, cleanup() {
    managers.forEach(manager => manager.dispose())
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('unified-plan-models-'))
    fs.rmSync(root, { recursive: true, force: true })
  } }
}
const call = (manager, method, payload = {}, signal) => manager.call(method, { provider, ...payload }, signal)
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function within(promise, description) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`超时：${description}`)), 5000) })])
  } finally { clearTimeout(timer) }
}

test('空白名单是全开：按模型切换持久化、保留配额和哨兵', async () => {
  const f = fixture([row('a'), row('b'), { id: 'image', output_modalities: ['image'] }])
  try {
    const m = f.create()
    const initial = await call(m, 'plan.snapshot')
    assert.deepEqual(initial.models.map(model => [model.id, model.enabled]), [['a', true], ['b', true]])
    assert.deepEqual(await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false }), { modelId: 'a', enabled: false })
    assert.deepEqual(f.catalog().enabledModelIds, ['b', 'image'])
    await call(m, 'plan.setModelEnabled', { modelId: 'b', enabled: false })
    assert.deepEqual(f.catalog().enabledModelIds, ['image'])
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: true })
    assert.deepEqual(f.catalog().enabledModelIds, ['image', 'a'])
    await assert.rejects(call(m, 'plan.setModelEnabled', { modelId: 'image', enabled: false }))
    await assert.rejects(call(m, 'plan.setModelEnabled', { modelId: '__hide_all__', enabled: true }))
    assert.equal(fs.readFileSync(path.join(f.foreign, 'catalog.json'), 'utf8'), 'foreign sentinel')
  } finally { f.cleanup() }
})

test('最后模型关闭使用哨兵；再启用一个不自动放开新模型', async () => {
  const f = fixture([row('a')])
  try {
    const m = f.create()
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false })
    assert.deepEqual(f.catalog().enabledModelIds, ['__hide_all__'])
    assert.equal((await call(m, 'plan.snapshot')).models[0].enabled, false)
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: true })
    assert.deepEqual(f.catalog().enabledModelIds, ['a'])
    const data = f.catalog()
    data.entries.push(row('new'))
    fs.writeFileSync(f.file, JSON.stringify(data))
    assert.deepEqual((await call(m, 'plan.snapshot')).models.map(model => [model.id, model.enabled]), [['a', true], ['new', false]])
  } finally { f.cleanup() }
})

test('旧白名单中的暂时消失模型不会被删除，新模型默认关闭', async () => {
  const f = fixture([row('a'), row('b')], ['missing', 'a'])
  try {
    const m = f.create()
    await call(m, 'plan.setModelEnabled', { modelId: 'b', enabled: true })
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false })
    assert.deepEqual(f.catalog().enabledModelIds, ['missing', 'b'])
    const data = f.catalog()
    data.entries = [row('missing'), row('new')]
    fs.writeFileSync(f.file, JSON.stringify(data))
    assert.deepEqual((await call(m, 'plan.snapshot')).models.map(model => [model.id, model.enabled]), [['missing', true], ['new', false]])
  } finally { f.cleanup() }
})

test('覆盖输出上限可读写、重启恢复、清除、真实进入 descriptor', async () => {
  const f = fixture()
  try {
    const m = f.create({ maxTokensOverrides: { a: 777 } })
    assert.equal((await call(m, 'plan.snapshot')).models[0].maxTokensOverride, 777)
    assert.equal((await call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 12345 } })).maxTokensOverride, 12345)
    assert.equal(f.catalog().eacMaxTokensOverrides.a, 12345)
    let restarted = f.create({ maxTokensOverrides: { a: 777 } })
    let snapshot = await call(restarted, 'plan.snapshot')
    assert.equal(snapshot.models[0].maxTokensOverride, 12345)
    assert.equal(snapshot.models[0].maxOutputLength, 12345)
    assert.equal(buildDescriptors(f.catalog().entries, { maxTokensOverrides: f.catalog().eacMaxTokensOverrides })[0].maxTokens, 12345)
    assert.equal((await call(restarted, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: null } })).maxTokensOverride, null)
    restarted = f.create({ maxTokensOverrides: { a: 777 } })
    snapshot = await call(restarted, 'plan.snapshot')
    assert.equal(snapshot.models[0].maxTokensOverride, null)
    assert.equal(snapshot.models[0].maxOutputLength, 8192)
    for (const value of [0, -1, 1.1, 10000001, '123', undefined]) {
      await assert.rejects(call(restarted, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: value } }))
    }
    for (const params of [{ contextWindow: -1 }, { reasoningEffort: 'bad' }, { compat: { hidden: true } }, {}, null]) {
      await assert.rejects(call(restarted, 'plan.setModelParams', { modelId: 'a', params }))
    }
  } finally { f.cleanup() }
})

test('真实 publisher 构建 descriptor：即时发布、重启恢复、清除覆盖', async () => {
  const f = fixture()
  const builds = []
  f.ctx.llm = { registerAdapter() { return () => {} } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: options => {
    const descriptors = buildDescriptors(options.entries, options)
    builds.push(descriptors)
    return { adapter: { descriptors }, providerIds: [provider] }
  } }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 12345 } })
    assert.equal(builds.at(-1).find(model => model.id === 'a').maxTokens, 12345)
    m.dispose()
    const restarted = f.create({ registerProvider: true }, deps)
    await call(restarted, 'plan.snapshot')
    assert.equal(builds.at(-1).find(model => model.id === 'a').maxTokens, 12345)
    await call(restarted, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: null } })
    assert.equal(builds.at(-1).find(model => model.id === 'a').maxTokens, 8192)
  } finally { f.cleanup() }
})

test('保留 ID 和超长 ID 无法被真实 publisher 注册；全禁用仅剩哨兵时为空', async () => {
  const f = fixture([row('a'), row('__hide_all__'), row('__proto__'), row('x'.repeat(257))])
  const builds = []
  f.ctx.llm = { registerAdapter() { return () => {} } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: options => {
    const descriptors = buildDescriptors(options.entries, options)
    builds.push(descriptors)
    return { adapter: { descriptors }, providerIds: [provider] }
  } }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false })
    assert.deepEqual(f.catalog().enabledModelIds, ['__hide_all__'])
    assert.deepEqual(builds.at(-1), [])
    const before = builds.length
    globalThis.fetch = async () => Response.json({ data: [row('a'), row('__hide_all__'), row('__proto__'), row('x'.repeat(257))] })
    await call(m, 'plan.snapshot')
    const after = builds.length
    await call(m, 'plan.snapshot')
    assert.equal(builds.length, after, '过滤目录应在签名比较前执行，不能持续重新注册')
    assert.ok(after >= before)
    assert.deepEqual(builds.at(-1), [])
  } finally { f.cleanup() }
})

test('publisher 双重目录注册失败会释放回滚的 adapter', async () => {
  const f = fixture()
  let activeAdapters = 0, activeDirectories = 0, failDirectory = false
  f.ctx.llm = {
    registerAdapter() { activeAdapters++; return () => { activeAdapters-- } },
    registerConfigurableProviders() {
      if (failDirectory) throw new Error('fixture directory failure')
      activeDirectories++; return () => { activeDirectories-- }
    },
  }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: options => ({ adapter: { descriptors: buildDescriptors(options.entries, options) }, providerIds: [provider] }) }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.snapshot')
    assert.equal(activeAdapters, 1); assert.equal(activeDirectories, 1)
    failDirectory = true
    await assert.rejects(call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 4321 } }))
    assert.equal(activeAdapters, 0); assert.equal(activeDirectories, 0)
    assert.equal(f.catalog().eacMaxTokensOverrides.a, undefined)
    failDirectory = false
    await call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 5555 } })
    assert.equal(activeAdapters, 1); assert.equal(activeDirectories, 1)
  } finally { f.cleanup() }
})

test('参数发布首次失败会回滚磁盘且再次保存可生效', async () => {
  const f = fixture()
  let fail = false, active = null
  f.ctx.llm = { registerAdapter(_ids, adapter) { active = adapter; return () => { if (active === adapter) active = null } } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: options => {
    if (fail) { fail = false; throw new Error('fixture error') }
    return { adapter: { models: buildDescriptors(options.entries, options) }, providerIds: [provider] }
  } }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.snapshot')
    fail = true
    await assert.rejects(call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 5000 } }))
    assert.equal(f.catalog().eacMaxTokensOverrides.a, undefined)
    assert.equal(active.models.find(model => model.id === 'a').maxTokens, 8192)
    await call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 5000 } })
    assert.equal(active.models.find(model => model.id === 'a').maxTokens, 5000)
  } finally { f.cleanup() }
})

test('发布失败且回滚发布失败后，快照在恢复时会重试注册', async () => {
  const f = fixture()
  let fail = false, active = null
  f.ctx.llm = { registerAdapter(_ids, adapter) { active = adapter; return () => { if (active === adapter) active = null } } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: options => {
    if (fail) throw new Error('fixture build failure')
    return { adapter: { models: buildDescriptors(options.entries, options) }, providerIds: [provider] }
  } }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.snapshot')
    fail = true
    await assert.rejects(call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 5000 } }))
    await assert.rejects(call(m, 'plan.snapshot'))
    fail = false
    const snapshot = await call(m, 'plan.snapshot')
    assert.equal(snapshot.models[0].maxTokensOverride, null)
    assert.equal(active.models.find(model => model.id === 'a').maxTokens, 8192)
  } finally { f.cleanup() }
})

test('已启用时重复启用不丢已有健康 adapter', async () => {
  const f = fixture()
  let calls = 0, active = 0
  f.ctx.llm = { registerAdapter() { calls++; active++; return () => { active-- } } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter: () => ({ adapter: {}, providerIds: [provider] }) }) }
  try {
    const m = f.create({ registerProvider: true }, deps)
    await call(m, 'plan.snapshot')
    const before = calls
    assert.equal(active, 1)
    assert.deepEqual(await call(m, 'plan.setEnabled', { enabled: true }), { enabled: true, providerRegistered: true })
    assert.equal(calls, before); assert.equal(active, 1)
  } finally { f.cleanup() }
})

test('并发切换与模型参数不丢失，跨同进程管理器也排队', async () => {
  const f = fixture()
  try {
    const m1 = f.create(), m2 = f.create()
    await Promise.all([
      call(m1, 'plan.setModelEnabled', { modelId: 'a', enabled: false }),
      call(m2, 'plan.setModelEnabled', { modelId: 'b', enabled: false }),
      call(m1, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 1234 } }),
      call(m2, 'plan.setModelParams', { modelId: 'b', params: { maxTokens: 4321 } }),
    ])
    assert.deepEqual(f.catalog().enabledModelIds, ['__hide_all__'])
    assert.deepEqual(f.catalog().eacMaxTokensOverrides, { a: 1234, b: 4321 })
    assert.deepEqual((await call(m1, 'plan.snapshot')).models.map(model => [model.id, model.enabled]), [['a', false], ['b', false]])
  } finally { f.cleanup() }
})

test('慢速在途目录不会覆盖新的选择，期间可取消排队修改', async () => {
  const f = fixture()
  const gate = deferred(), started = deferred()
  try {
    globalThis.fetch = async () => {
      started.resolve()
      await gate.promise
      return Response.json({ data: [row('a'), row('b'), row('new')] })
    }
    const m = f.create()
    const pending = call(m, 'plan.snapshot')
    await within(started.promise, '等待模拟请求开始')
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false })
    const abort = new AbortController(); abort.abort()
    await assert.rejects(call(m, 'plan.setModelEnabled', { modelId: 'b', enabled: false }, abort.signal))
    gate.resolve()
    const snapshot = await pending
    assert.deepEqual(f.catalog().enabledModelIds, ['b'])
    assert.deepEqual(snapshot.models.map(model => [model.id, model.enabled]), [['a', false], ['b', true], ['new', false]])
    assert.equal(f.catalog().entries.length, 3)
  } finally { gate.resolve(); f.cleanup() }
})

test('双 manager 旧 key 的慢目录不得覆盖新目录，同 manager 新快照不复用旧请求', async () => {
  const f = fixture()
  const gate = deferred(), started = deferred(), seen = []
  try {
    globalThis.fetch = async (_url, init) => {
      const authorization = init.headers.authorization
      seen.push(authorization)
      if (authorization === 'Bearer sk-fixture-only') {
        started.resolve()
        await gate.promise
        return Response.json({ data: [row('old-key-model')] })
      }
      assert.equal(authorization, 'Bearer sk-new-fixture-only')
      return Response.json({ data: [row('new-key-model')] })
    }
    const m = f.create(), other = f.create()
    const pending = call(m, 'plan.snapshot')
    await within(started.promise, '等待模拟请求开始')
    await call(other, 'plan.setKey', { apiKey: 'sk-new-fixture-only' })
    const fresh = await call(m, 'plan.snapshot')
    assert.deepEqual(fresh.models.map(model => model.id), ['new-key-model'])
    gate.resolve()
    await assert.rejects(pending)
    assert.deepEqual(f.catalog().entries.map(entry => entry.id), ['new-key-model'])
    assert.ok(seen.includes('Bearer sk-new-fixture-only'))
  } finally { gate.resolve(); f.cleanup() }
})

test('更换 key 先隔离旧目录并保留白名单和上限', async () => {
  const f = fixture()
  try {
    const m = f.create()
    await call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false })
    await call(m, 'plan.setModelParams', { modelId: 'a', params: { maxTokens: 1234 } })
    await call(m, 'plan.setKey', { apiKey: 'sk-another-fixture' })
    const data = f.catalog()
    assert.deepEqual(data.entries, [])
    assert.deepEqual(data.enabledModelIds, ['b'])
    assert.equal(data.eacMaxTokensOverrides.a, 1234)
  } finally { f.cleanup() }
})

test('不合法或过长 ID 不截断展示，也不接受写入', async () => {
  const longId = 'x'.repeat(257)
  const f = fixture([row('good'), row(longId), row('__hide_all__'), row('__proto__')])
  try {
    const m = f.create()
    assert.deepEqual((await call(m, 'plan.snapshot')).models.map(model => model.id), ['good'])
    await assert.rejects(call(m, 'plan.setModelEnabled', { modelId: longId, enabled: false }))
    await assert.rejects(call(m, 'plan.setModelParams', { modelId: longId, params: { maxTokens: 10 } }))
    assert.deepEqual(publicResult('plan.snapshot', { models: [{ id: longId }, { id: 'good' }] }).models.map(model => model.id), ['good'])
  } finally { f.cleanup() }
})

test('未知目录版本拒写且不伪造内存保存成功', async () => {
  const f = fixture([row('a')])
  try {
    const m = f.create()
    assert.equal((await call(m, 'plan.snapshot')).models[0].enabled, true)
    const data = f.catalog(); data.version = 999
    fs.writeFileSync(f.file, JSON.stringify(data))
    await assert.rejects(call(m, 'plan.setModelEnabled', { modelId: 'a', enabled: false }))
    assert.equal(f.catalog().version, 999)
    // The store itself must also report a version-guard refusal, not cache a
    // fictional successful preference, even if invoked with an unknown file.
    const { createFileCatalogStore } = await import('../vendor/sensenova-token-plan/index.js')
    const store = createFileCatalogStore({ dir: path.dirname(f.file), ttlMs: 0 })
    assert.equal(await store.setEacEnabledIds(['__hide_all__']), false)
    assert.equal(await store.setEacMaxTokensOverrides({ a: 42 }), false)
    assert.deepEqual(await store.listEnabledIds(), [])
    assert.deepEqual({ ...await store.listEacMaxTokensOverrides() }, {})
    assert.equal(f.catalog().version, 999)
  } finally { f.cleanup() }
})

test('仅独立 Plan 方法允许商汤，写响应与快照只暴露字段', async () => {
  const methods = []
  const rpc = guardedRpc(async method => { methods.push(method); return { ok: true, value: {} } })
  for (const method of ['plan.setModelEnabled', 'plan.setModelParams']) await rpc(method, { provider })
  await assert.rejects(rpc('model.setParams', { provider }))
  await assert.rejects(rpc('plan.deleteEverything', { provider }))
  await assert.rejects(rpc('plan.setModelEnabled', { provider: 'loomy' }))
  assert.deepEqual(methods, ['plan.setModelEnabled', 'plan.setModelParams'])
  const snapshot = publicResult('plan.snapshot', { models: [{ id: 'a', name: '模型', enabled: false, maxTokensOverride: 456, secret: 'NEVER_DISPLAY' }], enabledModelIds: ['__hide_all__'], token: 'NEVER_DISPLAY' })
  assert.equal(snapshot.models[0].enabled, false)
  assert.equal(snapshot.models[0].maxTokensOverride, 456)
  assert.doesNotMatch(JSON.stringify(snapshot), /NEVER_DISPLAY|secret/)
  assert.deepEqual(publicResult('plan.setModelEnabled', { modelId: 'a', enabled: false, token: 'NEVER_DISPLAY' }), { modelId: 'a', enabled: false })
  const saved = publicResult('plan.setModelParams', { modelId: 'a', maxTokensOverride: 456, maxOutputLength: 456, token: 'NEVER_DISPLAY',
    compat: { supportsStore: false, unexpected: 'NEVER_DISPLAY' } })
  assert.equal(saved.maxTokensOverride, 456)
  assert.equal(saved.compat, undefined)
  assert.doesNotMatch(JSON.stringify(saved), /NEVER_DISPLAY|unexpected/)
})

test('额度数据未知保留上次受限，目录回退先落盘额度再发布', async () => {
  const originalFetch = globalThis.fetch
  const settings = resolveSettings({ providerRefreshMinutes: 0 }).settings
  const entries = [row('a')]
  let poolResponse, failWrite = false
  const events = []
  const state = { entries, enabledIds: [], unavailableIds: ['a'], signature: catalogSignature(entries, []), quotaSignature: 'a' }
  const publisher = { state, async publish(nextEntries, ids, unavailable) {
    events.push(['publish', [...unavailable]])
    Object.assign(state, { entries: nextEntries, enabledIds: ids, unavailableIds: unavailable })
    return { ok: true }
  } }
  let stored = entries, storedQuota = ['a']
  const store = {
    async list() { return stored }, async listEnabledIds() { return [] }, async listUnavailable() { return storedQuota },
    async replace() { throw new Error('not expected') },
    async setUnavailable(ids) { events.push(['write', [...ids]]); if (failWrite) return false; storedQuota = ids; return true },
  }
  const args = { settings, cache: new Map(), inflight: new Map(), catalogStore: store, publisher,
    tokenStore: { async getToken() { return 'fixture-token' }, async state() { return { configured: true } } },
    apiKeyStore: { async resolve() { return { value: '' } }, async state() { return { hasApiKey: false } } },
    panelSwitch: async () => true,
  }
  globalThis.fetch = async url => String(url).includes('pool-usage') ? Response.json(poolResponse) : Response.json({ series: [] })
  try {
    for (const pools of [[], [{ id: 'p', model_ids: ['a'], window_5h: { limit: 10, remaining: null }, window_7d: { limit: 10, remaining: 8 } }]]) {
      poolResponse = { plan: { id: 'fixture' }, pools }
      args.cache = new Map(); args.inflight = new Map()
      const body = await buildSnapshotBody(args)
      assert.equal(body.quotaKnown, false)
      assert.equal(body.llm.models[0].quotaExhausted, true)
      assert.deepEqual(storedQuota, ['a'])
    }
    // A second manager changed the persisted last-known result; unknown data
    // must re-publish it but never write the unknown reading.
    storedQuota = []
    args.cache = new Map(); args.inflight = new Map(); events.length = 0
    const unknown = await buildSnapshotBody(args)
    assert.equal(unknown.quotaKnown, false)
    assert.deepEqual(events, [['publish', []]])
    // Offline catalog fallback with a changed roster and fresh blocked quota.
    stored = [row('b')]
    poolResponse = { plan: { id: 'fixture' }, pools: [{ id: 'p', model_ids: ['b'], window_5h: { limit: 10, remaining: 0 }, window_7d: { limit: 10, remaining: 8 } }] }
    args.cache = new Map(); args.inflight = new Map(); events.length = 0
    failWrite = true
    await assert.rejects(buildSnapshotBody(args))
    assert.deepEqual(events, [['write', ['b']]])
    failWrite = false
    args.cache = new Map(); args.inflight = new Map(); events.length = 0
    const known = await buildSnapshotBody(args)
    assert.equal(known.quotaKnown, true)
    assert.deepEqual(events, [['write', ['b']], ['publish', ['b']]])
  } finally { globalThis.fetch = originalFetch }
})

test('新模型写操作仍受来源与宿主授权保护，错误不暴露原文', async () => {
  const routes = new Map(), stops = []
  const ctx = { llm: {}, credentials: {}, connection: {
    requestRejection() { return 403 },
    fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  }, get(name) { return this[name] }, inject(_names, fn) { fn(this) }, effect(fn) { stops.push(fn()) } }
  apply(ctx, {})
  try {
    const route = routes.get('/api/unified-router')
    for (const method of ['plan.setModelEnabled', 'plan.setModelParams']) {
      for (const origin of ['https://evil.invalid', 'http://dsh.internal']) {
        const response = await route.fetch(new Request('http://dsh.internal/api/unified-router', {
          method: 'POST', headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'unified-router', payload: { method, payload: { provider, modelId: 'a', params: { maxTokens: 1 } } } }),
        }))
        const body = await response.json()
        assert.equal(body.result.error.code, 'unified-router/forbidden')
        assert.doesNotMatch(JSON.stringify(body), /NEVER_DISPLAY/)
      }
    }
  } finally { stops.reverse().forEach(stop => stop?.()) }
})

test('商汤只请求 API 模型目录，模型参数和 compat 进入发布并跨重启保留', async () => {
  const f = fixture([row('glm-5.2'), row('b')])
  const builds = []
  const calls = []
  f.ctx.llm = { registerAdapter() { return () => {} } }
  const deps = { loadAdapterModule: async () => ({ createSensenovaAdapter(options) {
    builds.push(buildDescriptors(options.entries, options))
    return { adapter: {}, providerIds: [provider] }
  } }) }
  try {
    globalThis.fetch = async url => {
      calls.push(new URL(url).pathname)
      return Response.json({ data: [row('glm-5.2'), row('b')] })
    }
    const first = f.create({ registerProvider: true }, deps)
    const patch = { contextWindow: 96000, maxTokens: 12000, supportsImage: true, reasoningEffort: 'medium',
      compat: { supportsStore: false, maxTokensField: 'max_completion_tokens', requiresToolResultName: true } }
    await call(first, 'plan.snapshot')
    const saved = await call(first, 'plan.setModelParams', { modelId: 'glm-5.2', params: patch })
    const descriptor = builds.at(-1).find(model => model.id === 'glm-5.2')
    assert.equal(descriptor.contextWindow, 96000)
    assert.equal(descriptor.maxTokens, 12000)
    assert.deepEqual(descriptor.input, ['text', 'image'])
    assert.deepEqual(descriptor.compat, { supportsDeveloperRole: false, ...patch.compat })
    assert.deepEqual(planRequestDefaults({ model: 'glm-5.2' }, saved.params, saved.thinkingLevels), { model: 'glm-5.2', reasoningEffort: 'medium' })
    assert.equal(planRequestDefaults({ reasoningEffort: 'high' }, patch, saved.thinkingLevels).reasoningEffort, 'high')
    await assert.rejects(call(first, 'plan.setModelParams', { modelId: 'b', params: { reasoningEffort: 'max' } }))
    first.dispose()
    const restarted = f.create({ registerProvider: true }, deps)
    const snapshot = await call(restarted, 'plan.snapshot')
    assert.deepEqual(snapshot.models.find(model => model.id === 'glm-5.2').params, patch)
    await assert.rejects(call(restarted, 'plan.login', { username: 'fixture', password: 'fixture' }))
    assert.ok(calls.length > 0 && calls.every(path => path === '/v1/models'))
    const reset = await call(restarted, 'plan.setModelParams', {
      modelId: 'glm-5.2', params: { contextWindow: null, maxTokens: null, supportsImage: null, reasoningEffort: null, compat: null },
    })
    assert.equal(reset.contextWindow, 128000)
    assert.equal(reset.vision, false)
    assert.equal(reset.compat.maxTokensField, 'max_tokens')
  } finally { f.cleanup() }
})
