import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiKeyManager, APIKEY_METHODS } from '../lib/apikey-channel.js'
import { saveCatalogCache } from '../lib/catalog-cache.js'

// 离线桩：凭据服务用 Map 假实现（与 workbuddy.test.mjs 同一套），网络用注入
// 的假 fetch 按 URL 应答，适配器与模型设置全部走 deps 桩。断言从不包含
// Key 原文；KEY_A / KEY_B 是特征串，只用于「绝不泄漏」断言。

const KEY_A = 'sk-test-key-aaaa-SECRET'
const KEY_B = 'sk-test-key-bbbb-SECRET'
const scopeOf = key => createHash('sha256').update(key).digest('hex').slice(0, 12)

function credentialsFixture(values = new Map()) {
  const operations = []
  return {
    values, operations,
    async resolve(key) { operations.push(['resolve', key]); return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) { operations.push(['set', key]); values.set(key, value) },
    async unset(key) { operations.push(['unset', key]); values.delete(key) },
  }
}

function context(credentials, extras = {}) {
  const services = {
    credentials,
    logger: { warn() {}, error() {}, info() {} },
    ...extras,
  }
  return { ...services, get(name) { return this[name] } }
}

// llm 桩：registerAdapter 记录每次注册并返回释放函数；adapter 是代理，
// 读取它的 marker 可以验证「之后只替换代理指向的当前适配器」。
function llmStub({ failRegister = false } = {}) {
  return {
    registrations: [],
    emitCount: 0,
    registerAdapter(providerIds, adapter) {
      if (failRegister) throw new Error('registerAdapter failure')
      const record = { providerIds, adapter, released: false }
      this.registrations.push(record)
      return () => { record.released = true }
    },
    emitAdaptersUpdated() { this.emitCount += 1 },
  }
}

// 每次构建的适配器带递增 marker，代理切换后可辨认当前指向哪个实例。
function adapterLoader(counter = { next: 0, calls: 0 }, fail = () => false) {
  return async () => ({ spec, rows, resolveKey, get, providerId }) => {
    counter.calls += 1
    if (fail(counter.calls)) throw new Error('adapter build failure')
    const marker = `adapter-${++counter.next}`
    return { adapter: { marker, rows, providerId, resolveKey }, providerIds: [providerId] }
  }
}

// modelSettings 桩：契约同 apikey-models.js（list/change + 描述行形状）。
function modelSettingsStub() {
  const state = { disabled: new Set(), params: {} }
  const describe = catalog => catalog.map(row => {
    const params = state.params[row.id] ?? {}
    return {
      ...row,
      params,
      enabled: !state.disabled.has(row.id),
      contextWindow: params.contextWindow ?? (row.context > 0 ? row.context : 128_000),
      maxOutputLength: params.maxTokens ?? (row.output > 0 ? row.output : 32_768),
      vision: params.supportsImage ?? row.attachment === true,
      effectiveEffort: params.reasoningEffort ?? row.defaultEffort ?? 'off',
      defaultContextWindow: row.context > 0 ? row.context : 128_000,
      defaultMaxOutputLength: row.output > 0 ? row.output : 32_768,
      defaultVision: row.attachment === true,
      defaultEffort: row.defaultEffort ?? 'off',
    }
  })
  return {
    state,
    async list(catalog) { return describe(catalog) },
    async change(method, payload, getCatalog, signal) {
      signal?.throwIfAborted()
      const catalog = getCatalog()
      if (!catalog.length) throw new Error('请先刷新模型目录')
      if (method === 'apikey.resetModels') {
        state.disabled.clear()
        state.params = {}
        return describe(catalog)
      }
      const model = catalog.find(row => row.id === payload.modelId)
      if (!model) throw new Error('模型已变动，请刷新')
      if (method === 'apikey.setModelEnabled') {
        if (payload.enabled) state.disabled.delete(model.id)
        else state.disabled.add(model.id)
      } else if (method === 'apikey.setModelParams') {
        state.params[model.id] = { ...state.params[model.id], ...(payload.params ?? {}) }
      } else {
        throw new Error('不支持此操作')
      }
      return describe(catalog)
    },
  }
}

const CHAT_ROWS = [
  { id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash', context: 524_288, output: 65_536, attachment: true, reasoning: true, efforts: ['off', 'low', 'high'], defaultEffort: 'off' },
  { id: 'agnes-2.5-pro', name: 'Agnes 2.5 Pro', context: 1_048_576, output: 65_536, attachment: true, reasoning: true, efforts: ['off', 'medium', 'high'] },
]
const FALLBACK_ROWS = [
  { id: 'fallback-flash', name: 'Fallback Flash', context: 128_000, output: 8_192, attachment: false, reasoning: false, efforts: [] },
]

// routes: url → {json?, status?, throw?} 或函数（按调用序次应答）。
function fetchStub(resolve) {
  const calls = []
  const fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, headers: init.headers ?? {} })
    const out = resolve(url, calls.length)
    if (out === undefined) return new Response(JSON.stringify({ error: 'unstubbed' }), { status: 404 })
    if (out instanceof Response) return out
    if (out.throw !== undefined) throw out.throw
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 })
  }
  return { calls, fetch }
}

const catalogRoutes = (json, { status = 200 } = {}) =>
  url => url.startsWith('https://api.example.test/v1/models') ? { json, status } : undefined

function specStub(overrides = {}) {
  const { catalog = {}, balance = null, ...rest } = overrides
  return {
    id: 'agnes',
    title: 'Agnes',
    endpoint: 'https://api.example.test',
    chatPath: '/v1/chat/completions',
    baseUrl: 'https://api.example.test/v1',
    credentialRef: 'TEST_AGNES_API_KEY',
    catalog: {
      request: (key, cursor) => ({
        url: 'https://api.example.test/v1/models' + (cursor ? `?after_id=${cursor}` : ''),
        headers: { authorization: `Bearer ${key}` },
      }),
      parse: json => (Array.isArray(json?.data) ? json.data : []).map(item => ({
        id: item.id, name: item.name ?? item.id,
        context: item.context ?? 0, output: item.output ?? 0,
        attachment: item.attachment === true, reasoning: item.reasoning === true,
        efforts: Array.isArray(item.efforts) ? item.efforts : [],
        ...(item.defaultEffort ? { defaultEffort: item.defaultEffort } : {}),
      })),
      ...catalog,
    },
    fallback: FALLBACK_ROWS,
    balance,
    ...rest,
  }
}

async function tempPaths(t) {
  const dir = await mkdtemp(join(tmpdir(), 'apikey-channel-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return {
    stateFile: join(dir, 'state.json'),
    catalogFile: join(dir, 'catalog.json'),
    modelSettingsFile: join(dir, 'models.json'),
  }
}

function makeManager(t, { spec, fetch, llm, credentials, loadLlmAdapter, modelSettings } = {}) {
  const paths = {}
  return (async () => {
    const files = await tempPaths(t)
    Object.assign(paths, files)
    const creds = credentials ?? credentialsFixture()
    const net = fetch ?? fetchStub(() => undefined)
    const builds = { next: 0, calls: 0 }
    const manager = createApiKeyManager(
      context(creds, { llm: llm ?? llmStub() }),
      spec ?? specStub(),
      {
        ...files,
        fetch: net.fetch,
        modelSettings: modelSettings ?? modelSettingsStub(),
        loadLlmAdapter: loadLlmAdapter ?? adapterLoader(builds),
      },
    )
    return { manager, creds, net, builds, files, llm: llm ?? null }
  })()
}

// ---- 基础：无 Key → fallback，不注册 ---------------------------------------
test('限速快照随当前 Key，换 Key 后忽略旧适配器的迟到事件', async t => {
  const adapters = []
  const hits = []
  const manager = createApiKeyManager(context(credentialsFixture(), { llm: llmStub() }), specStub(), {
    ...await tempPaths(t), env: {}, fetch: fetchStub(() => undefined).fetch,
    modelSettings: modelSettingsStub(), onRateLimit: hit => hits.push(hit),
    loadLlmAdapter: async () => ({ onRateLimit, providerId }) => {
      adapters.push(onRateLimit)
      return { adapter: {}, providerIds: [providerId] }
    },
  })
  t.after(() => manager.dispose())
  const call = (method, payload) => manager.call(`apikey.${method}`, { provider: 'agnes', ...payload })
  await call('setKey', { apiKey: KEY_A })
  await call('setEnabled', { enabled: true })
  const hit = { until: Date.now() + 60_000, reason: 'tpm', estimated: true }
  await adapters[0](hit)
  await adapters[0]({ ...hit, until: hit.until - 1 })
  assert.deepEqual((await call('snapshot')).rateLimit, hit)
  await call('setKey', { apiKey: KEY_B })
  await adapters[0]({ ...hit, until: hit.until + 1000 })
  assert.equal((await call('snapshot')).rateLimit, null)
  assert.deepEqual(hits, [hit])
})

test('重启后首次快照恢复已开启的 API Key 提供方', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const make = llm => createApiKeyManager(context(creds, { llm }), specStub(), {
    ...files, env: {}, fetch: fetchStub(() => undefined).fetch,
    modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  const payload = { provider: 'agnes' }
  const first = make(llmStub())
  try {
    await first.call('apikey.setKey', { ...payload, apiKey: KEY_A })
    await first.call('apikey.setEnabled', { ...payload, enabled: true })
  } finally { first.dispose() }
  const llm = llmStub()
  const restarted = make(llm)
  t.after(() => restarted.dispose())
  assert.equal((await restarted.collectSnapshot()).registered, true)
  assert.equal((await restarted.collectSnapshot()).registered, true)
  assert.equal(llm.registrations.length, 1)
})

test('无 Key：目录回落 fallback、不注册、余额为 null', async t => {
  const files = await tempPaths(t)
  const llm = llmStub()
  const net = fetchStub(() => undefined)
  const manager = createApiKeyManager(context(credentialsFixture(), { llm }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.hasKey, false)
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.registered, false)
  assert.equal(snapshot.catalogSource, 'fallback')
  assert.equal(snapshot.catalogError, false)
  assert.deepEqual(snapshot.models.map(row => row.id), ['fallback-flash'])
  assert.equal(snapshot.balance, null)
  assert.equal(llm.registrations.length, 0)
  assert.equal(net.calls.length, 0)
})

// ---- Key：写入凭据、拉远端目录并缓存 ---------------------------------------
test('setKey：写入凭据引用、按 Key 拉远端目录并落缓存', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const result = await manager.call('apikey.setKey', { provider: 'agnes', apiKey: `  ${KEY_A}  ` })
  assert.deepEqual(result, { hasApiKey: true })
  // 凭据按引用名保存、保存前 trim。
  assert.equal(creds.values.get('TEST_AGNES_API_KEY'), KEY_A)
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.hasKey, true)
  assert.equal(snapshot.catalogSource, 'remote')
  assert.equal(snapshot.catalogError, false)
  assert.deepEqual(snapshot.models.map(row => row.id), CHAT_ROWS.map(row => row.id))
  // 目录请求带 Bearer Key；缓存文件按 Key 的 sha256 前 12 位分 scope。
  assert.equal(net.calls.filter(call => call.url.startsWith('https://api.example.test/v1/models')).length, 1)
  assert.equal(net.calls[0].headers.authorization, `Bearer ${KEY_A}`)
  const cached = JSON.parse(readFileSync(files.catalogFile, 'utf8'))
  assert.equal(cached.scope, scopeOf(KEY_A))
  assert.equal(cached.models.length, 2)
})

test('setKey：非字符串、空白与超长 Key 一律拒绝且不写凭据', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files, fetch: fetchStub(() => undefined).fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  for (const apiKey of [undefined, '', '   ', 'x'.repeat(4097), 42]) {
    await assert.rejects(() => manager.call('apikey.setKey', { provider: 'agnes', apiKey }), /API Key 无效/)
  }
  assert.equal(creds.values.size, 0)
})

// ---- 远端失败：回落缓存 → 再回落 fallback ----------------------------------
test('远端失败：有缓存用缓存（catalogError），无缓存用 fallback', async t => {
  const files = await tempPaths(t)
  // 预置该 Key scope 下的缓存目录行。
  await saveCatalogCache(files.catalogFile, CHAT_ROWS.slice(0, 1), scopeOf(KEY_A))
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const net = fetchStub(url => url.startsWith('https://api.example.test/v1/models') ? { status: 503 } : undefined)
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.catalogSource, 'cached')
  assert.equal(snapshot.catalogError, true)
  assert.deepEqual(snapshot.models.map(row => row.id), [CHAT_ROWS[0].id])

  // 同一渠道但没有缓存文件的另一实例：直接回落 fallback。
  const files2 = await tempPaths(t)
  const manager2 = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files2, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager2.dispose())
  const snapshot2 = await manager2.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot2.catalogSource, 'fallback')
  assert.equal(snapshot2.catalogError, true)
  assert.deepEqual(snapshot2.models.map(row => row.id), ['fallback-flash'])
})

// ---- 分页（云知声式游标） ---------------------------------------------------
test('分页：按 next 游标拉满并合并去重', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const pages = {
    'https://api.example.test/v1/models': { json: { data: [CHAT_ROWS[0], CHAT_ROWS[1]], has_more: true, last_id: CHAT_ROWS[1].id } },
    'https://api.example.test/v1/models?after_id=agnes-2.5-pro': { json: { data: [CHAT_ROWS[1], { id: 'agnes-2.5-pro-theta', context: 0, output: 0 }], has_more: false } },
  }
  const net = fetchStub(url => pages[url])
  const spec = specStub({
    catalog: {
      request: (key, cursor) => ({
        url: 'https://api.example.test/v1/models' + (cursor ? `?after_id=${cursor}` : ''),
        headers: { 'x-api-key': key },
      }),
      next: json => json?.has_more ? json.last_id : undefined,
    },
  })
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), spec, {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.catalogSource, 'remote')
  assert.equal(net.calls.length, 2)
  // 第二页重复返回的 agnes-2.5-pro 只保留第一次出现。
  assert.deepEqual(snapshot.models.map(row => row.id), ['agnes-3.0-flash', 'agnes-2.5-pro', 'agnes-2.5-pro-theta'])
})

test('分页：游标不断时最多拉 20 页', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const net = fetchStub(url => url.startsWith('https://api.example.test/v1/models')
    ? { json: { data: [{ id: `m-${net.calls.length}` }], has_more: true, last_id: `c-${net.calls.length}` } }
    : undefined)
  const spec = specStub({
    catalog: {
      request: (key, cursor) => ({ url: 'https://api.example.test/v1/models' + (cursor ? `?after_id=${cursor}` : ''), headers: {} }),
      next: json => json?.has_more ? json.last_id : undefined,
    },
  })
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), spec, {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.catalogSource, 'remote')
  assert.equal(net.calls.length, 20)
  assert.equal(snapshot.models.length, 20)
})

// ---- 目录复用与并发合并 ----------------------------------------------------
test('目录 60 秒内复用、并发请求合并为一个在途请求', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  let release
  const gate = new Promise(resolve => { release = resolve })
  let started = 0
  const net = { calls: [], fetch: async url => {
    net.calls.push(String(url))
    started += 1
    if (started === 1) await gate // 第一个在途请求挂起，并发者应合并进来
    return new Response(JSON.stringify({ data: CHAT_ROWS }), { status: 200 })
  } }
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const pending = Promise.all([
    manager.call('apikey.snapshot', { provider: 'agnes' }),
    manager.call('apikey.snapshot', { provider: 'agnes' }),
  ])
  await new Promise(resolve => setTimeout(resolve, 20))
  release()
  const [a, b] = await pending
  assert.equal(net.calls.length, 1)
  assert.equal(a.catalogSource, 'remote')
  assert.equal(b.catalogSource, 'remote')
  // 60 秒窗口内第三次读不再发请求；invalidate 后才会重新拉。
  await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(net.calls.length, 1)
  manager.invalidate()
  await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(net.calls.length, 2)
})

// ---- 启用开关与适配器注册 ---------------------------------------------------
test('setEnabled：启用触发 registerAdapter，关闭释放注册并持久化开关', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const llm = llmStub()
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const builds = { next: 0, calls: 0 }
  const manager = createApiKeyManager(context(creds, { llm }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(builds),
  })
  t.after(() => manager.dispose())

  // 没 Key 时启用：开关照写，但注册条件不满足 → providerRegistered false。
  const noKey = await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true })
  assert.deepEqual(noKey, { enabled: true, providerRegistered: false })
  assert.equal(llm.registrations.length, 0)

  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_A })
  const on = await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true })
  assert.deepEqual(on, { enabled: true, providerRegistered: true })
  assert.equal(llm.registrations.length, 1)
  assert.deepEqual(llm.registrations[0].providerIds, ['agnes'])
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-1')
  assert.equal(llm.emitCount >= 1, true)

  // 开关持久化到 stateFile（0o600 内容 {enabled:true}），新实例读回。
  assert.deepEqual(JSON.parse(readFileSync(files.stateFile, 'utf8')), { enabled: true })

  const off = await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: false })
  assert.deepEqual(off, { enabled: false, providerRegistered: false })
  assert.equal(llm.registrations[0].released, true)
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.registered, false)
})

test('启用但注册失败：回滚开关并抛错，stateFile 还原为 false', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const manager = createApiKeyManager(context(creds, { llm: llmStub({ failRegister: true }) }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(),
    loadLlmAdapter: adapterLoader({ next: 0, calls: 0 }),
  })
  t.after(() => manager.dispose())
  await assert.rejects(
    () => manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true }),
    /模型提供方未能启用/,
  )
  const saved = JSON.parse(readFileSync(files.stateFile, 'utf8'))
  assert.equal(saved.enabled, false)
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.registered, false)
})

// ---- 换 Key：旧 scope 的缓存与内存复用都读不到 ------------------------------
test('换 Key：旧缓存隔离，新 Key 远端失败时回落自身 fallback', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  // 只有 KEY_A 有远端目录与缓存；KEY_B 一律 503。
  await saveCatalogCache(files.catalogFile, CHAT_ROWS.slice(0, 1), scopeOf(KEY_A))
  const net = fetchStub(url => {
    if (!url.startsWith('https://api.example.test/v1/models')) return undefined
    return url.includes('after_id') ? { status: 503 } : { status: 503 }
  })
  const netA = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  let currentFetch = netA.fetch
  const fetch = (input, init) => currentFetch(input, init)
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), specStub(), {
    ...files, fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_A })
  let snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.catalogSource, 'remote')

  // 换成 KEY_B 后远端 503：读不到 KEY_A scope 的缓存，回落 fallback。
  currentFetch = net.fetch
  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_B })
  snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.catalogSource, 'fallback')
  assert.equal(snapshot.catalogError, true)
  assert.deepEqual(snapshot.models.map(row => row.id), ['fallback-flash'])
})

// ---- 模型写操作 -------------------------------------------------------------
test('模型开关/参数写后重新发布；resetModels 返回启用 id', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const llm = llmStub()
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const builds = { next: 0, calls: 0 }
  const settings = modelSettingsStub()
  const manager = createApiKeyManager(context(creds, { llm }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: settings, loadLlmAdapter: adapterLoader(builds),
  })
  t.after(() => manager.dispose())
  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_A })
  await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true })
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-1')

  // 关闭一个模型 → 重新发布（同一次注册、换代理指向），返回 {modelId, enabled}。
  const off = await manager.call('apikey.setModelEnabled', { provider: 'agnes', modelId: 'agnes-2.5-pro', enabled: false })
  assert.deepEqual(off, { modelId: 'agnes-2.5-pro', enabled: false })
  assert.equal(llm.registrations.length, 1)
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-2')
  // 适配器收到的是启用的描述行（只剩 flash）。
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  const pro = snapshot.models.find(row => row.id === 'agnes-2.5-pro')
  assert.equal(pro.enabled, false)

  // 写参数 → 返回 {modelId, ...描述字段除 id/name/enabled}，再次重新发布。
  const patched = await manager.call('apikey.setModelParams', {
    provider: 'agnes', modelId: 'agnes-3.0-flash',
    params: { reasoningEffort: 'high', maxTokens: 12_345 },
  })
  assert.equal(patched.modelId, 'agnes-3.0-flash')
  assert.equal(patched.effectiveEffort, 'high')
  assert.equal(patched.maxOutputLength, 12_345)
  assert.equal(Object.hasOwn(patched, 'id'), false)
  assert.equal(Object.hasOwn(patched, 'name'), false)
  assert.equal(Object.hasOwn(patched, 'enabled'), false)
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-3')

  // resetModels → 全部恢复启用，返回启用行 id。
  const reset = await manager.call('apikey.resetModels', { provider: 'agnes' })
  assert.deepEqual(reset, { enabledModelIds: ['agnes-3.0-flash', 'agnes-2.5-pro'] })
  assert.equal(settings.state.disabled.size, 0)
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-4')
})

test('模型写失败（发布异常）：设置回滚到写前状态并抛错', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const llm = llmStub()
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const builds = { next: 0, calls: 0 }
  const settings = modelSettingsStub()
  // 第 1 次构建成功（注册用），从第 2 次起构建失败。
  const loadLlmAdapter = adapterLoader(builds, calls => calls >= 2)
  const manager = createApiKeyManager(context(creds, { llm }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: settings, loadLlmAdapter,
  })
  t.after(() => manager.dispose())
  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_A })
  await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true })
  assert.equal(llm.registrations[0].adapter.marker, 'adapter-1')

  await assert.rejects(
    () => manager.call('apikey.setModelEnabled', { provider: 'agnes', modelId: 'agnes-2.5-pro', enabled: false }),
    /模型设置更新失败/,
  )
  // 逆操作已回放：pro 仍是启用状态。
  assert.equal(settings.state.disabled.has('agnes-2.5-pro'), false)
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.models.find(row => row.id === 'agnes-2.5-pro').enabled, true)
})

// ---- 余额 -------------------------------------------------------------------
test('余额：成功 → 字段加 updatedAt；parse 为 null → balance 为 null', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const net = fetchStub(url => {
    if (url.startsWith('https://api.example.test/v1/models')) return { json: { data: CHAT_ROWS } }
    if (url === 'https://api.example.test/billing/subscription') return { json: { hard_limit_usd: 50 } }
    if (url === 'https://api.example.test/billing/usage') return { json: { total_usage: 12.5 } }
    return undefined
  })
  const spec = specStub({
    balance: {
      requests: key => [
        { url: 'https://api.example.test/billing/subscription', headers: { authorization: `Bearer ${key}` } },
        { url: 'https://api.example.test/billing/usage', headers: { authorization: `Bearer ${key}` } },
      ],
      parse: jsons => ({ used: jsons[1].total_usage, limit: jsons[0].hard_limit_usd, unlimited: false, unit: 'usd' }),
    },
  })
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), spec, {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.balance.used, 12.5)
  assert.equal(snapshot.balance.limit, 50)
  assert.equal(snapshot.balance.unlimited, false)
  assert.equal(snapshot.balance.unit, 'usd')
  assert.equal(typeof snapshot.balance.updatedAt, 'number')
  assert.equal(snapshot.catalogSource, 'remote')
})

test('余额：任一请求异常 → {error:true}，不影响目录；parse 返回 null → balance 为 null', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  let balanceStatus = 500
  const net = fetchStub(url => {
    if (url.startsWith('https://api.example.test/v1/models')) return { json: { data: CHAT_ROWS } }
    if (url.startsWith('https://api.example.test/billing')) return { status: balanceStatus }
    return undefined
  })
  const spec = specStub({
    balance: {
      requests: key => [{ url: 'https://api.example.test/billing/subscription', headers: {} }],
      parse: jsons => null,
    },
  })
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), spec, {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  // 请求失败：{error:true}，目录仍是 remote。
  let snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.deepEqual(snapshot.balance, { error: true })
  assert.equal(snapshot.catalogSource, 'remote')
  assert.equal(snapshot.catalogError, false)
  // 请求成功但 parse 返回 null。
  balanceStatus = 200
  snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(snapshot.balance, null)
})

// ---- Key 不泄漏 --------------------------------------------------------------
test('Key 不出现在任何返回值与错误文案里', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture(new Map([['TEST_AGNES_API_KEY', KEY_A]]))
  const net = fetchStub(url => {
    if (url.startsWith('https://api.example.test/v1/models')) return { json: { data: CHAT_ROWS } }
    if (url.startsWith('https://api.example.test/billing')) return new Response(`failure mentions ${KEY_A}`, { status: 500 })
    return undefined
  })
  const spec = specStub({
    balance: {
      requests: key => [{ url: 'https://api.example.test/billing/x', headers: {} }],
      parse: () => { throw new Error(`boom ${KEY_A}`) },
    },
  })
  const manager = createApiKeyManager(context(creds, { llm: llmStub() }), spec, {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const snapshot = await manager.call('apikey.snapshot', { provider: 'agnes' })
  assert.equal(JSON.stringify(snapshot).includes('sk-test-key'), false)
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false)
  const results = [
    await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true }),
    await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: false }),
  ]
  assert.equal(JSON.stringify(results).includes(KEY_A), false)
  for (const call of [
    () => manager.call('apikey.setKey', { provider: 'agnes', apiKey: '  ' }),
    () => manager.call('apikey.snapshot', { provider: 'other' }),
    () => manager.call('apikey.unknown', { provider: 'agnes' }),
  ]) {
    await assert.rejects(call, error => {
      assert.equal(String(error?.message ?? error).includes(KEY_A), false)
      assert.equal(String(error?.message ?? error).includes('SECRET'), false)
      return true
    })
  }
})

// ---- 拒绝路径 ---------------------------------------------------------------
test('provider 不匹配与未知方法被拒绝', async t => {
  const files = await tempPaths(t)
  const manager = createApiKeyManager(context(credentialsFixture(), { llm: llmStub() }), specStub(), {
    ...files, fetch: fetchStub(() => undefined).fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  await assert.rejects(() => manager.call('apikey.snapshot', { provider: 'unisound' }), /不支持此渠道/)
  await assert.rejects(() => manager.call('apikey.setEnabled', { provider: 'other', enabled: true }), /不支持此渠道/)
  await assert.rejects(() => manager.call('apikey.setEnabled', {}), /不支持此渠道/)
  await assert.rejects(() => manager.call('apikey.nope', { provider: 'agnes' }), /不支持此操作/)
  await assert.rejects(() => manager.call('plan.snapshot', { provider: 'agnes' }), /不支持此操作/)
})

test('dispose：幂等，释放注册，之后所有 call 抛「请求已结束」', async t => {
  const files = await tempPaths(t)
  const creds = credentialsFixture()
  const llm = llmStub()
  const net = fetchStub(catalogRoutes({ data: CHAT_ROWS }))
  const manager = createApiKeyManager(context(creds, { llm }), specStub(), {
    ...files, fetch: net.fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  await manager.call('apikey.setKey', { provider: 'agnes', apiKey: KEY_A })
  await manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true })
  assert.equal(llm.registrations.length, 1)
  manager.dispose()
  manager.dispose() // 幂等
  assert.equal(llm.registrations[0].released, true)
  for (const method of APIKEY_METHODS) {
    await assert.rejects(() => manager.call(method, { provider: 'agnes' }), /请求已结束/)
  }
})

test('collectSnapshot 与 call(apikey.snapshot) 等价', async t => {
  const files = await tempPaths(t)
  const manager = createApiKeyManager(context(credentialsFixture(), { llm: llmStub() }), specStub(), {
    ...files, fetch: fetchStub(() => undefined).fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const [direct, collected] = await Promise.all([
    manager.call('apikey.snapshot', { provider: 'agnes' }),
    manager.collectSnapshot(),
  ])
  assert.deepEqual(collected.models.map(row => row.id), direct.models.map(row => row.id))
  assert.equal(collected.catalogSource, direct.catalogSource)
})

test('已中止的 signal 立即抛错', async t => {
  const files = await tempPaths(t)
  const manager = createApiKeyManager(context(credentialsFixture(), { llm: llmStub() }), specStub(), {
    ...files, fetch: fetchStub(() => undefined).fetch, modelSettings: modelSettingsStub(), loadLlmAdapter: adapterLoader(),
  })
  t.after(() => manager.dispose())
  const aborted = AbortSignal.abort()
  await assert.rejects(() => manager.call('apikey.snapshot', { provider: 'agnes' }, aborted))
  await assert.rejects(() => manager.call('apikey.setEnabled', { provider: 'agnes', enabled: true }, aborted))
})
