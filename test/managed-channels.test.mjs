import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManagedChannelManager } from '../lib/managed-channel.js'
import { createManagedAdapter, toManagedModelDescriptor } from '../lib/managed-llm.js'
import { astudioSpec, parseAStudioCatalog, sanitizeAStudioCredential } from '../lib/managed-providers/astudio.js'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { codeartsSpec, createDpopJwt, signHuaweiRequest, parseCodeArtsBuiltinModels, mergeConsecutiveTurns, sanitizeCodeArtsCredential } from '../lib/managed-providers/codearts.js'
import { MANAGED_PROVIDERS, MANAGED_PROVIDER_IDS } from '../lib/managed-providers/index.js'

test('码道兼容累计正文和旧版增量，标准帧与用量原样保留', async () => {
  const { normalizeCodeArtsStream } = await import('../lib/managed-providers/codearts-stream.js')
  const model = 'openpangu-2.0-flash'
  const source = frames => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream', 'content-length': '100' } })
  const read = async response => (await normalizeCodeArtsStream(response, { model }).text()).trim().split('\n\n')
    .map(line => line.slice(6)).map(data => data === '[DONE]' ? data : JSON.parse(data))
  const legacy = await read(source([{ type: 'answer' }, { text: '你' }, { text: '你好' }, { text: '你好' },
    { delta: { content: '！' } }, { text: '[DONE]', error_code: '0' }]))
  assert.deepEqual(legacy.slice(0, 3).map(event => event.choices[0].delta.content), ['你', '好', '！'])
  assert.equal(legacy.at(-2).choices[0].finish_reason, 'stop')
  assert.equal(legacy.at(-1), '[DONE]')
  const standard = [{ model, choices: [{ index: 0, delta: { content: '你好', reasoning_content: '思考' }, finish_reason: 'stop' }] },
    { model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }]
  assert.deepEqual(await read(source(standard)), standard)
  const failed = await read(source([{ error_code: 'fixture-error', error_msg: 'raw fixture' }, { text: '[DONE]' }]))
  assert.equal(failed.length, 1)
  assert.match(failed[0].error.message, /CodeArts/)
  assert.doesNotMatch(failed[0].error.message, /raw fixture/)
})

test('码道完整消息中的 Context7 工具调用：JSON 和 SSE 都可还原给 PiAi', async () => {
  const { normalizeCodeArtsStream } = await import('../lib/managed-providers/codearts-stream.js')
  const model = 'openpangu-2.0-flash'
  const call = { id: 'call_fixture', type: 'function', function: { name: 'mcp__context7__resolve-library-id', arguments: '{}' } }
  const message = { role: 'assistant', content: null, tool_calls: [call] }
  const object = { model, choices: [{ index: 0, delta: {}, message, finish_reason: 'stop' }], usage: { completion_tokens: 5 } }
  for (const response of [Response.json(object), new Response(`data: ${JSON.stringify(object)}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } })]) {
    const normalized = normalizeCodeArtsStream(response, { model })
    assert.equal(normalized.headers.get('content-type'), 'text/event-stream')
    const lines = (await normalized.text()).trim().split('\n\n')
    const first = JSON.parse(lines[0].slice(6))
    assert.deepEqual(first.choices[0].delta.tool_calls, [{ ...call, index: 0 }])
    assert.equal(first.choices[0].finish_reason, 'tool_calls')
    assert.deepEqual(first.usage, object.usage)
    assert.equal(lines.at(-1), 'data: [DONE]')
  }
})

test('码道工具增量保留原样，按真实终止帧结束且不重发消息快照', async () => {
  const { normalizeCodeArtsStream } = await import('../lib/managed-providers/codearts-stream.js')
  const model = 'openpangu-2.0-flash'
  const call = { index: 0, id: 'call_fixture', type: 'function', function: { name: 'mcp__context7__query-docs', arguments: '{}' } }
  const delta = { choices: [{ index: 0, delta: { content: '查阅文档', tool_calls: [call] }, finish_reason: null }] }
  const terminal = { choices: [{ index: 0, message: { content: '查阅文档', tool_calls: [call] }, delta: {}, finish_reason: 'other' }] }
  const frames = (end = '') => new Response(`data: ${JSON.stringify(delta)}\n\n${end}`,
    { headers: { 'content-type': 'text/event-stream' } })
  const read = async response => (await normalizeCodeArtsStream(response, { model }).text()).trim().split('\n\n')
  const [original, final] = await read(frames(`data: ${JSON.stringify(terminal)}\n\ndata: [DONE]\n\n`))
  assert.deepEqual(JSON.parse(original.slice(6)), delta)
  assert.deepEqual(JSON.parse(final.slice(6)).choices[0].delta, {})
  assert.equal(JSON.parse(final.slice(6)).choices[0].finish_reason, 'tool_calls')
  const [, finish] = await read(frames('data: [DONE]\n\n'))
  assert.equal(JSON.parse(finish.slice(6)).choices[0].finish_reason, 'tool_calls')
  assert.equal((await read(frames())).length, 1, '没有明确的服务端终止信号，不能合成成功')
})

function memoryHost() {
  const store = new Map()
  const registered = []
  return {
    store,
    registered,
    credentials: {
      async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : null },
      async set(ref, value) { store.set(ref, value) },
      async delete(ref) { store.delete(ref) },
    },
    llm: {
      registerAdapter(providerIds, adapter) {
        assert.ok(Array.isArray(providerIds) && providerIds.length > 0, 'registerAdapter 第一参必须为非空 providerIds 数组')
        assert.ok(adapter && typeof adapter === 'object', 'registerAdapter 第二参必须为 adapter 对象')
        const entry = { providerIds, adapter }
        registered.push(entry)
        return () => {
          const idx = registered.indexOf(entry)
          if (idx >= 0) registered.splice(idx, 1)
        }
      },
      emitAdaptersUpdated() {},
    },
    get(name) { return this[name] },
  }
}

test('自管注册表登记 AStudio 与 CodeArts', () => {
  assert.deepEqual(MANAGED_PROVIDER_IDS, ['astudio', 'codearts'])
  assert.equal(MANAGED_PROVIDERS.length, 2)
})

test('自管目录并发刷新：晚到的旧目录不得覆盖适配器、设置页和磁盘', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'managed-catalog-race-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = memoryHost()
  const provider = 'demo'
  host.store.set('UNIFIED_ROUTER_DEMO_ACCOUNTS', JSON.stringify([{ id: 'demo-12345678', credentialRef: 'UNIFIED_ROUTER_DEMO_ACCOUNT_AABBCC' }]))
  host.store.set('UNIFIED_ROUTER_DEMO_ACCOUNT_AABBCC', '{"fixture":true}')
  const jobs = [Promise.withResolvers(), Promise.withResolvers()]
  const started = [Promise.withResolvers(), Promise.withResolvers()]
  let i = 0
  const file = join(dir, 'catalog.json')
  const manager = createManagedChannelManager(host, {
    id: provider, title: 'Demo', fetchModels() { const n = i++; started[n].resolve(); return jobs[n].promise },
  }, { catalogFile: file, createAdapter: async ({ rows }) => ({ adapter: { rows } }) })
  try {
    const before = manager.call('managed.refreshModels', { provider }); await started[0].promise
    const after = manager.call('managed.refreshModels', { provider }); await started[1].promise
    jobs[1].resolve([{ id: 'new-model' }]); await after
    jobs[0].resolve([{ id: 'old-model' }])
    assert.equal((await before).models[0].id, 'new-model')
    assert.equal((await manager.call('managed.models', { provider })).models[0].id, 'new-model')
    assert.equal(host.registered[0].adapter.rows[0].id, 'new-model')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).models[0].id, 'new-model')
  } finally { manager.dispose() }
})

test('CodeArts 额度：空值不推导为满额或耗尽，零与已知用量保留', async () => {
  const fetchUsage = (remain, used, tokenUsed) => codeartsSpec.fetchUsage({
    getCredential: async () => ({ accessKey: 'fixture', secretKey: 'fixture', securityToken: 'fixture' }),
    fetch: async url => new URL(url).pathname.includes('statistics') ? Response.json({ metrics: [{
      name: 'usageTotalPackageCredit', package_credit_amount: '100', package_credit_remain: remain, package_credit_used: used,
    }] }) : Response.json({ result: { daily_token_limit: '1000', daily_tokens_used: tokenUsed } }),
  }, {})
  const unknown = await fetchUsage(null, ' ', null)
  assert.equal(unknown.balance, null)
  assert.deepEqual(unknown.windows, [])
  const actual = await fetchUsage(0, null, '0')
  assert.equal(actual.balance, 0)
  assert.deepEqual(actual.windows.map(w => [w.amount, w.used, w.balance]), [[100, 100, 0], [0, 0, 1000]])
  const usageOnly = await fetchUsage(null, 20, null)
  assert.equal(usageOnly.balance, null)
  assert.equal(usageOnly.windows[0].used, 20)
})

test('通用自管多账号管理器：导入/去重/备注/删号防复活/凭据脱敏/compat 模型参数', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'managed-channel-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = memoryHost()
  let savedRefHandle = null
  let preferredAccount, passedModel
  const spec = {
    id: 'demo',
    title: 'Demo',
    protocol: 'openai-completions',
    baseUrl: 'https://demo.invalid/v1',
    authMethods: ['local', 'browser', 'credential'],
    credentialHint: 'paste token',
    fallbackModels: [
      { id: 'demo-1', name: 'Demo 1', context: 128_000, output: 16_384, efforts: ['off', 'high'], defaultEffort: 'high', rate: 0.5 },
    ],
    sanitizeCredential: raw => raw?.secret ? { secret: String(raw.secret) } : null,
    async importLocal() { return { credential: { secret: 'SECRET_LOCAL_1' }, uid: 'u-1', name: '本机号' } },
    async parseCredential(raw) { return { credential: { secret: raw }, uid: 'u-2', name: '粘贴号' } },
    async fetchUsage(handle) {
      savedRefHandle = handle
      return { signedIn: true, plan: 'Pro', balance: 500, unit: '积分', windows: [{ name: '月度', used: 20, balance: 400, limit: 500, unit: '积分' }] }
    },
    async fetchModels() {
      return [{ id: 'demo-1', name: 'Demo 1 Live', context: 256_000, output: 32_000, efforts: ['off', 'high'], defaultEffort: 'high', rate: 0.5 }]
    },
    async createTransport() { return { fetch: globalThis.fetch } },
  }
  const manager = createManagedChannelManager(host, spec, {
    stateFile: join(dir, 'state.json'),
    catalogFile: join(dir, 'catalog.json'),
    modelSettingsFile: join(dir, 'models.json'),
    quotaAccountOrder: (_provider, ids, context) => {
      passedModel = context?.model?.id ?? context?.modelId
      return ids.includes(preferredAccount) ? [preferredAccount, ...ids.filter(id => id !== preferredAccount)] : ids
    },
    createAdapter: async ({ rows, providerId, selectTransport }) => ({ providerIds: [providerId], adapter: { id: providerId, rows, selectTransport } }),
  })
  try {
    const imported = await manager.call('managed.importLocal', { provider: 'demo' })
    assert.equal(imported.signedIn, true)
    assert.equal(imported.name, '本机号')
    assert.doesNotMatch(JSON.stringify(imported), /SECRET_LOCAL_1/)

    // 同 uid 再次导入：原地更新不新增重复账号
    const reimported = await manager.call('managed.importLocal', { provider: 'demo' })
    assert.equal(reimported.id, imported.id)

    const pasted = await manager.call('managed.importCredential', { provider: 'demo', credential: 'SECRET_PASTE_2' })
    assert.equal(pasted.signedIn, true)
    assert.notEqual(pasted.id, imported.id)
    const manualPick = host.registered[0].adapter.selectTransport
    for (let i = 0; i < 3; i++) assert.equal((await manualPick('demo-1', {})).accountId, imported.id)
    preferredAccount = pasted.id
    const pick = host.registered[0].adapter.selectTransport
    assert.equal((await pick('demo-1', {})).accountId, pasted.id)
    assert.equal(passedModel, 'demo-1')
    assert.equal((await pick('demo-1', {}, new Set([pasted.id]))).accountId, imported.id)

    const snap = await manager.collectSnapshot()
    assert.equal(snap.accounts.length, 2)
    assert.doesNotMatch(JSON.stringify(snap), /SECRET_LOCAL_1|SECRET_PASTE_2/)
    // 每账号独立持久化固定随机 32-hex deviceId，互不相同且不泄露进公开快照
    const savedIndex = JSON.parse(host.store.get('UNIFIED_ROUTER_DEMO_ACCOUNTS'))
    assert.equal(savedIndex.length, 2)
    assert.match(savedIndex[0].deviceId, /^[0-9a-f]{32}$/)
    assert.match(savedIndex[1].deviceId, /^[0-9a-f]{32}$/)
    assert.notEqual(savedIndex[0].deviceId, savedIndex[1].deviceId)

    // 更新模型参数含合法 compat
    const paramsRes = await manager.call('managed.setModelParams', {
      provider: 'demo',
      modelId: 'demo-1',
      params: { maxTokens: 8192, reasoningEffort: 'high', compat: { supportsStore: false, maxTokensField: 'max_tokens' } },
    })
    assert.equal(paramsRes.models[0].maxOutputLength, 8192)
    assert.equal(paramsRes.models[0].params.compat.supportsStore, false)
    const desc = toManagedModelDescriptor(paramsRes.models[0], 'demo', spec)
    assert.equal(desc.compat.supportsStore, false)
    assert.equal(desc.compat.maxTokensField, 'max_tokens')

    // 删号后旧 handle 的 saveCredential 不得复活凭据
    const removedId = pasted.id
    await manager.call('managed.logout', { provider: 'demo', accountId: removedId })
    assert.equal(await savedRefHandle.saveCredential({ secret: 'ZOMBIE' }), false)
    assert.equal((await manager.collectSnapshot()).accounts.length, 1)
  } finally { manager.dispose() }
})

test('AStudio：目录解析与补位规则、隐藏模型不补位、凭据收敛与思考 off→none', async () => {
  const catalog = parseAStudioCatalog({
    data: {
      models: [
        { slug: 'spark-x2.6-4b', display_name: 'Spark-X2.6-Lite', visibility: 'list', supported_in_api: true, context_window: 1048576, max_output_tokens: 110000, supported_reasoning_levels: [{ effort: 'none' }, { effort: 'high' }], default_reasoning_level: 'high', badge: { text: { en: 'Free' } } },
        { slug: 'builtin/hidden', visibility: 'list', supported_in_api: true },
        { slug: 'old-hidden', visibility: 'hidden', supported_in_api: true },
      ],
    },
  })
  assert.equal(catalog.some(m => m.id === 'spark-x2.6-4b' && m.free === true), true)
  assert.equal(catalog.some(m => m.id === 'xdeepseek-flash-in'), true, '目录未出现时应自动补位')
  assert.equal(catalog.some(m => m.id.startsWith('builtin/')), false)
  assert.equal(catalog.some(m => m.id === 'old-hidden'), false)

  // 若远端明确把 xdeepseek-flash-in 标为 hidden，则不得再补位
  const hiddenCatalog = parseAStudioCatalog({
    data: { models: [{ slug: 'xdeepseek-flash-in', visibility: 'hidden', supported_in_api: false }] },
  })
  assert.equal(hiddenCatalog.some(m => m.id === 'xdeepseek-flash-in'), false)

  // 推理传输：off 映射为 reasoning.effort = "none" 且 store = false
  let sentBody = null
  const transport = await astudioSpec.createTransport({
    getCredential: async () => sanitizeAStudioCredential({ modelBearerToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiIxMjMifQ.sig' }),
    fetch: async (_url, init) => { sentBody = JSON.parse(init.body); return new Response('{}', { status: 200 }) },
  })
  await transport.fetch('https://astronstudio-api-volces-prod.xf-yun.com/model-gateway/v1/responses', {
    method: 'POST',
    body: JSON.stringify({ model: 'spark-x2.6', input: 'hi' }),
  }, { request: { reasoningEffort: 'off' } })
  assert.equal(sentBody.store, false)
  assert.equal(sentBody.reasoning.effort, 'none')
})

test('managed-llm 429 处理：单账号保留原始 429 响应体可读，三账号 A/B=429 时自动轮换至 C=200', async () => {
  const makePeers = () => {
    let capturedFetch = null
    return {
      getFetch: () => capturedFetch,
      assemblePiAiAdapter: ({ api }) => ({ providerIds: ['demo'], adapter: { api } }),
      openAICompletionsApi: () => ({
        stream: (_model, _ctx, opts) => { capturedFetch = opts.fetch; return [] },
        streamSimple: (_model, _ctx, opts) => { capturedFetch = opts.fetch; return [] },
      }),
      anthropicMessagesApi: () => ({}),
      openAIResponsesApi: null,
    }
  }
  const spec = { id: 'demo', title: 'Demo', protocol: 'openai-completions', baseUrl: 'https://demo.invalid/v1' }
  const rows = [{ id: 'm1', name: 'M1', enabled: true, contextWindow: 128_000, maxOutputLength: 8192, efforts: [] }]

  // 场景 1：单账号 429 —— 不得提前 cancel body，调用方应能正常读出 response.text()
  const p1 = makePeers()
  let marked = 0
  const built1 = await createManagedAdapter({
    spec, rows,
    selectTransport: async (_m, _r, exclude) => {
      if (exclude?.has('acc-1')) throw new Error('no more accounts')
      return {
        accountId: 'acc-1',
        markRateLimited() { marked += 1 },
        fetch: async () => new Response('{"error":"rate_limited"}', { status: 429 }),
      }
    },
  }, p1)
  built1.adapter.api.stream({ id: 'm1', api: 'openai-completions' }, {}, {})
  const singleRes = await p1.getFetch()('https://demo.invalid/v1/chat/completions', { method: 'POST' })
  assert.equal(singleRes.status, 429)
  assert.equal(marked, 1)
  assert.equal(await singleRes.text(), '{"error":"rate_limited"}', '单账号 429 必须保留原始 body 可读')

  // 场景 2：三账号 A=429, B=429, C=200 —— 自动轮换完 3 轮直到 C 成功
  const p2 = makePeers()
  const accounts = [
    { id: 'A', status: 429, body: 'limit-A' },
    { id: 'B', status: 429, body: 'limit-B' },
    { id: 'C', status: 200, body: 'ok-from-C' },
  ]
  const triedOrder = []
  const built2 = await createManagedAdapter({
    spec, rows,
    selectTransport: async (_m, _r, exclude) => {
      const pick = accounts.find(a => !exclude?.has(a.id))
      if (!pick) throw new Error('exhausted')
      return {
        accountId: pick.id,
        markRateLimited() {},
        fetch: async () => {
          triedOrder.push(pick.id)
          return new Response(pick.body, { status: pick.status })
        },
      }
    },
  }, p2)
  built2.adapter.api.stream({ id: 'm1', api: 'openai-completions' }, {}, {})
  const multiRes = await p2.getFetch()('https://demo.invalid/v1/chat/completions', { method: 'POST' })
  assert.deepEqual(triedOrder, ['A', 'B', 'C'])
  assert.equal(multiRes.status, 200)
  assert.equal(await multiRes.text(), 'ok-from-C')
})

test('自管管理器异步注册竞态与多账号故障切换：删号/dispose 不复活注册，单号失败自动切下一个号', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'managed-race-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = memoryHost()
  let releaseFactory
  let capturedSelect = null
  const spec = {
    id: 'race',
    title: 'Race',
    protocol: 'openai-completions',
    baseUrl: 'https://race.invalid/v1',
    authMethods: ['credential'],
    fallbackModels: [{ id: 'm1', name: 'M1', context: 128_000, output: 8192 }],
    sanitizeCredential: raw => raw?.tok ? { tok: raw.tok } : null,
    async parseCredential(raw) { return { credential: { tok: raw }, uid: raw, name: raw } },
    async createTransport(handle) {
      const cred = await handle.getCredential()
      if (cred.tok === 'bad-account') throw new Error('no modelToken')
      return { fetch: async () => new Response('ok', { status: 200 }), tokenUsed: cred.tok }
    },
  }
  const manager = createManagedChannelManager(host, spec, {
    stateFile: join(dir, 'state.json'),
    catalogFile: join(dir, 'catalog.json'),
    modelSettingsFile: join(dir, 'models.json'),
    createAdapter: async ({ providerId, selectTransport }) => {
      capturedSelect = selectTransport
      await new Promise(resolve => { releaseFactory = resolve })
      return { providerIds: [providerId], adapter: { id: providerId } }
    },
  })
  try {
    const pImport = manager.call('managed.importCredential', { provider: 'race', credential: 'bad-account' })
    while (!releaseFactory) await new Promise(r => setImmediate(r))
    const pendingRelease = releaseFactory
    releaseFactory = null
    // 在首次注册尚未完成时删除唯一账号，再放行旧 factory
    const savedIndex = JSON.parse(host.store.get('UNIFIED_ROUTER_RACE_ACCOUNTS'))
    const pLogout = manager.call('managed.logout', { provider: 'race', accountId: savedIndex[0].id })
    pendingRelease()
    await Promise.all([pImport, pLogout])
    assert.equal(host.registered.length, 0, '旧异步 factory 返回不得复活已删除账号的注册')

    // 故障切换：导入 bad-account 与 good-account，selectTransport 应跳过 bad-account 选到 good-account
    const addBad = manager.call('managed.importCredential', { provider: 'race', credential: 'bad-account' })
    while (!releaseFactory) await new Promise(r => setImmediate(r))
    releaseFactory(); releaseFactory = null
    await addBad
    const addGood = manager.call('managed.importCredential', { provider: 'race', credential: 'good-account' })
    while (!releaseFactory) await new Promise(r => setImmediate(r))
    releaseFactory(); releaseFactory = null
    await addGood
    for (let i = 0; i < 4; i += 1) {
      const tr = await capturedSelect('m1', {})
      assert.equal(tr.tokenUsed, 'good-account', '每次都应自动跳过坏账号选到可用账号')
    }
  } finally { manager.dispose() }
})

test('CodeArts：按模型发布思考档位并应用输出硬上限', async () => {
  const { createManagedModelSettings } = await import('../lib/managed-models.js')
  const codeartsParsed = await codeartsSpec.fetchModels({
    getCredential: async () => ({ accessKey: 'a', secretKey: 's', securityToken: 't' }),
    fetch: async (url, init) => {
      if (url.endsWith('/v1/model/builtin')) return Response.json({ builtinModels: [
        { model_id: 'glm-5.3-flash', display_name: 'GLM-5.3-Flash', context_window: 1_048_576, max_tokens: 131_072 },
        { model_id: 'openpangu-2.1-pro', think_level: 'high', context_window: 200_000, max_tokens: 32_000 },
      ] })
      if (url.endsWith('/api/v1/gateway/config')) return Response.json({ result: { models: [] } })
      assert.match(url, /\/v1\/model\/thinking-variants$/)
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body), { model_names: ['glm-5.3-flash', 'openpangu-2.1-pro'] })
      return Response.json({ variants: {
        'GLM-5.3-FLASH': { strengths: ['low', 'high', 'max', 'invalid', 'low'], default_strength: 'high' },
        'openpangu-2.1-pro': { strengths: [], default_strength: 'high' },
      } })
    },
  }, {})
  assert.deepEqual(codeartsParsed[0].efforts, ['low', 'high', 'max'])
  assert.deepEqual(codeartsParsed[1].efforts, [])
  const reasoning = toManagedModelDescriptor(codeartsParsed[0], 'codearts', codeartsSpec)
  const plain = toManagedModelDescriptor(codeartsParsed[1], 'codearts', codeartsSpec)
  assert.equal(reasoning.reasoning, true)
  assert.equal(reasoning.thinkingLevelMap.high, 'high')
  assert.equal(reasoning.thinkingLevelMap.max, 'max')
  assert.equal(reasoning.thinkingLevelMap.off, null)
  assert.equal(plain.reasoning, false)
  assert.equal(plain.thinkingLevelMap, undefined)
  const caModels = await createManagedModelSettings(null, 'codearts').list(codeartsParsed)
  assert.equal(caModels[0].output, 131_072, '保留目录规格')
  assert.equal(caModels[0].maxOutputLength, 65_536, '默认输出按 CodeArts v2 网关硬上限 65,536 夹取（64K）')
  const zxModels = await createManagedModelSettings(null, 'codearts').list([codeartsSpec.fallbackModels[1]])
  assert.equal(zxModels[0].defaultMaxOutputLength, 65_536, 'GLM-5.2-ZX 兜底命中官方规格并收口到 64K')
})

test('CodeArts：共用账号会话并保持模型档位；最后一条流取消后空闲释放', async () => {
  const calls = []
  const transport = await codeartsSpec.createTransport({
    entry: { id: 'codearts-fixture' },
    getCredential: async () => ({ accessKey: 'a', secretKey: 's', securityToken: 't' }),
    fetch: async (url, init) => {
      const status = new URL(url).searchParams.get('status')
      assert.equal(init.headers['user-session-id'], 'fixture-session')
      if (status) {
        assert.equal(init.method, 'PUT')
        assert.equal(init.signal.aborted, false, '释放不能复用请求已取消的 signal')
        calls.push(status)
        return Response.json({ status: 'ok' })
      }
      assert.equal(init.headers['x-ot-session-id'], 'fixture-session')
      const body = JSON.parse(init.body)
      assert.equal(body.enable_thinking, undefined)
      assert.equal(body.max_tokens, 65_536)
      assert.equal(body.max_completion_tokens, 65_536)
      calls.push([body.model, body.reasoning_effort])
      return new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const send = (model, reasoningEffort, efforts, signal) => transport.fetch(`${codeartsSpec.baseUrl}/chat/completions`, {
    body: JSON.stringify({ model, max_tokens: 131_072, max_completion_tokens: 131_072, enable_thinking: true, reasoning_effort: 'unverified' }), signal,
  }, { row: { id: model, efforts }, request: { sessionId: 'fixture-session', model, reasoningEffort } })
  const controller = new AbortController()
  const a = await send('glm-5.3-flash', 'low', ['low', 'high', 'max'])
  const b = await send('openpangu-2.1-pro', 'high', [], controller.signal)
  assert.deepEqual(calls, ['busy', ['glm-5.3-flash', 'low'], ['openpangu-2.1-pro', undefined]])
  await a.body.cancel()
  assert.equal(calls.includes('idle'), false)
  controller.abort()
  await b.body.cancel().catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.at(-1), 'idle')
})

test('CodeArts 已计量协议保留零用量与结束帧', async () => {
  const usage = { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
  const finish = { type: 'finish', reason: { kind: 'stop' } }
  const provider = spec => createManagedAdapter({ spec, rows: [], selectTransport: () => assert.fail() }, {
    assemblePiAiAdapter: ({ wrapStream }) => ({ adapter: { wrapStream } }),
    openAICompletionsApi: () => ({}), anthropicMessagesApi: () => ({}),
  })
  const generated = async function* () { yield usage; yield finish }
  assert.deepEqual(await Array.fromAsync((await provider(codeartsSpec)).adapter.wrapStream(generated(), {})), [usage, finish])
})

test('CodeArts：旧输出覆盖受 64K（65,536）硬上限约束，拒绝新超限写入', async () => {
  const { createManagedModelSettings } = await import('../lib/managed-models.js')
  const home = await mkdtemp(join(tmpdir(), 'unified-router-budget-'))
  try {
    const file = join(home, 'models.json')
    const modelId = 'openpangu-2.0-flash'
    await writeFile(file, JSON.stringify({ params: { [modelId]: { maxTokens: 131_072, reasoningEffort: 'high' } } }))
    const catalog = [{ id: modelId, context: 200_000, output: 65_536, efforts: [] }]
    const settings = createManagedModelSettings(file, 'codearts')
    const [row] = await settings.list(catalog)
    assert.equal(row.effectiveEffort, undefined)
    assert.equal(row.maxOutputLength, 65_536)
    assert.equal(toManagedModelDescriptor(row, 'codearts', codeartsSpec).maxTokens, 65_536)
    const change = params => settings.change('managed.setModelParams', { modelId, params }, () => catalog)
    await assert.rejects(change({ maxTokens: 65_537 }), /输出上限超出渠道限制/)
    await assert.rejects(change({ contextWindow: 65_536 }), /输出上限须小于上下文窗口/)
    const [repaired] = await change({ maxTokens: 10_000, contextWindow: 65_536 })
    assert.equal(repaired.maxOutputLength, 10_000)
    assert.equal(repaired.contextWindow, 65_536)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('缺少 Responses peer 时不向 AStudio 发送 Chat Completions 请求', async () => {
  let chatCalls = 0
  const { adapter } = await createManagedAdapter({ spec: astudioSpec, rows: [{ id: 'fixture', enabled: true }],
    selectTransport: () => assert.fail('不应选择传输账号') }, {
    assemblePiAiAdapter: ({ api, models }) => ({ adapter: { api, model: models[0] } }),
    openAICompletionsApi: () => ({ streamSimple() { chatCalls++ } }),
    anthropicMessagesApi: () => ({}),
  })
  assert.equal(adapter.model.api, 'openai-responses')
  assert.throws(() => adapter.api.streamSimple(adapter.model, {}, {}), /宿主缺少 openai-responses 协议支持/)
  assert.equal(chatCalls, 0)
})

test('CodeArts：SDK-HMAC-SHA256 签名、builtin 目录输出与相邻消息合并', async () => {
  const signed = signHuaweiRequest({
    method: 'POST',
    url: 'https://snap-access.cn-north-4.myhuaweicloud.com/api/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', 'Agent-Type': 'PromptCenter', 'X-Language': 'zh-cn' },
    body: '{"model":"GLM-5.2"}',
    accessKey: 'AK_TEST',
    secretKey: 'SK_TEST',
    securityToken: 'ST_TEST',
  })
  assert.match(signed.Authorization, /^SDK-HMAC-SHA256 Access=AK_TEST, SignedHeaders=.*, Signature=[0-9a-f]{64}$/)
  assert.equal(signed['X-Security-Token'], 'ST_TEST')
  assert.match(signed['X-Sdk-Date'], /^\d{8}T\d{6}Z$/)

  const models = parseCodeArtsBuiltinModels({
    builtinModels: [
      { model_id: 'GLM-5.2', model_name: 'GLM-5.2\n', context_window: 1048576, max_tokens: 65536, think_level: 'high', supports_images: true, credit: { ratio_display: '0.62x' } },
      { model_id: 'maas-glm-4.7', model_name: 'Hidden' },
      { model_id: 'unknown-output', max_tokens: -1 },
      { model_id: 'alternate-output', max_tokens: '', output_context_window: '32768' },
    ],
  })
  assert.equal(models.length, 3)
  assert.equal(models[0].name, 'GLM-5.2')
  assert.equal(models[0].output, 65_536)
  assert.equal(models[1].output, null)
  assert.equal(models[2].output, 32_768)
  assert.equal(models[0].rate, 0.62)
  assert.deepEqual(models[0].efforts, [], '旧目录标记不能代替官方档位列表')
  const oldRow = { ...models[0], efforts: ['off', 'high'], reasoning: true, defaultEffort: 'high' }
  assert.deepEqual(codeartsSpec.restoreLegacyCatalog(oldRow), {
    ...oldRow, output: null, efforts: [], reasoning: false, defaultEffort: undefined,
  })

  const merged = mergeConsecutiveTurns([
    { role: 'user', content: 'A' },
    { role: 'user', content: 'B' },
    { role: 'assistant', content: 'C' },
  ])
  assert.deepEqual(merged, [
    { role: 'user', content: 'A\n\nB' },
    { role: 'assistant', content: 'C' },
  ])
  assert.equal(sanitizeCodeArtsCredential({ accessKey: 'a' }), null)
  assert.ok(sanitizeCodeArtsCredential({ accessKey: 'a', secretKey: 's', securityToken: 't' }))

  // CodeArts 每日签到：从 IDE 通道 data.items 解析 USER_LOGIN 活动并完成 claim + confirm
  const hitUrls = []
  const ck = await codeartsSpec.checkin({
    fetch: async (url, init) => {
      hitUrls.push(String(url))
      if (String(url).includes('/v1/ops/delivery?channel=IDE')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [{ type: 'USER_LOGIN', campaignId: 'camp-1', claimable: true, status: 'PENDING', benefitAmount: 200 }] } }), { status: 200 })
      }
      if (String(url).includes('/v1/ops/claim')) {
        return new Response(JSON.stringify({ code: 0, data: { id: 'ben-1', benefitAmount: 200 } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
    },
    getCredential: async () => ({ accessKey: 'AK', secretKey: 'SK', securityToken: 'ST', expiresAt: Date.now() + 3_600_000 }),
    saveCredential: async () => true,
  }, {})
  assert.equal(ck.outcome, 'claimed')
  assert.equal(ck.credit, 200)
  assert.ok(hitUrls.some(u => u.includes('/v1/ops/delivery?channel=IDE')))
})

test('CodeArts：已领取不重复提交，空列表和查询失败分别处理', async () => {
  const run = data => codeartsSpec.checkin({
    getCredential: async () => ({ accessKey: 'AK', secretKey: 'SK', securityToken: 'ST', expiresAt: Date.now() + 3_600_000 }),
    fetch: async (url) => {
      const path = new URL(url).pathname
      assert.ok(!path.endsWith('/claim') && !path.endsWith('/confirm'))
      return path.endsWith('/delivery') ? Response.json(data) : Response.json({ code: 0 })
    },
  }, {})
  assert.equal((await run({ code: 0, data: { items: [{ type: 'USER_LOGIN', status: 'CONFIRMED', claimable: false }] } })).outcome, 'already-claimed')
  assert.equal((await run({ code: 0, data: { items: [{ type: 'USER_LOGIN', status: 'CLAIMED', claimable: true }] } })).outcome, 'pending')
  assert.deepEqual(await run({ code: 0, data: { items: [] } }), { outcome: 'inactive', unsubmitted: true })
  assert.deepEqual(await run({ code: 500, data: { items: [] } }), { outcome: 'failed', unsubmitted: true })
})

test('CodeArts：DPoP ES256 签名合法、本机字符串 JWK 保留，推理遇 APIG.0602 自动刷新重试', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pubJwk = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })

  // 1. 本机 secretStorage 把 DPoP 密钥存为 JSON 字符串，sanitize 必须解析保留而非丢弃。
  const sanitized = sanitizeCodeArtsCredential({
    accessKey: 'AK_OLD',
    secretKey: 'SK_OLD',
    securityToken: 'ST_OLD',
    refreshToken: 'RT_OLD',
    codeVerifier: 'v'.repeat(128),
    expiresAt: '2099-01-01T00:00:00.000Z',
    dpopPrivateJwk: JSON.stringify(privJwk),
    dpopPublicJwk: JSON.stringify(pubJwk),
  })
  assert.ok(sanitized?.dpopPrivateJwk?.d)
  assert.ok(sanitized?.dpopPublicJwk?.x)
  assert.ok(Number.isFinite(sanitized.expiresAt))

  // 2. createDpopJwt 使用 createPrivateKey 签出 64 字节 IEEE-P1363 签名并能被对应公钥验签。
  const jwt = createDpopJwt({
    method: 'POST',
    url: 'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens',
    privateJwk: sanitized.dpopPrivateJwk,
    publicJwk: sanitized.dpopPublicJwk,
  })
  const parts = jwt.split('.')
  assert.equal(parts.length, 3)
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  assert.equal(header.alg, 'ES256')
  assert.equal(header.typ, 'dpop+jwt')
  const verifier = createVerify('sha256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  assert.equal(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')), true)

  // 3. 推理命中 APIG.0602（security token has expired）时，通过 DPoP + refresh_token 自动刷新并重签重发一次。
  let stored = { ...sanitized }
  const seenTokens = []
  const inferUrl = 'https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions'
  assert.equal(`${codeartsSpec.baseUrl}/chat/completions`, inferUrl)
  let dpopHeaderSeen = ''
  const transport = await codeartsSpec.createTransport({
    entry: { id: 'codearts-test', source: 'browser', deviceId: 'dev-1' },
    getCredential: async () => stored,
    saveCredential: async next => { stored = next; return true },
    fetch: async (url, init) => {
      const target = String(url)
      if (target.includes('/chat-session/heartbeat')) return Response.json({ status: 'ok' })
      if (target.includes('/v1/oauth2/tokens')) {
        dpopHeaderSeen = init.headers.DPoP || ''
        return Response.json({
          credentials: {
            access_key_id: 'AK_NEW',
            secret_access_key: 'SK_NEW',
            security_token: 'ST_NEW',
            expiration: new Date(Date.now() + 3_600_000).toISOString(),
          },
          refresh_token: 'RT_NEW',
        })
      }
      assert.equal(target, inferUrl)
      const tok = init.headers['X-Security-Token']
      seenTokens.push(tok)
      if (tok === 'ST_OLD') {
        return new Response(JSON.stringify({ error_msg: 'Bad request: the security token has expired', error_code: 'APIG.0602' }), { status: 400 })
      }
      return new Response('data: [DONE]\n\n', { status: 200 })
    },
  })
  const res = await transport.fetch(inferUrl, {
    method: 'POST',
    body: JSON.stringify({ model: 'GLM-5.2', messages: [{ role: 'user', content: 'hi' }] }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(seenTokens, ['ST_OLD', 'ST_NEW'])
  assert.equal(dpopHeaderSeen.split('.').length, 3)
  assert.equal(stored.securityToken, 'ST_NEW')
  assert.equal(stored.refreshToken, 'RT_NEW')
})

// —— 已确认状态误报修复：CodeArts 多活动汇总、歧义重查、严格 claimable 与只读状态方法 ——

const codeartsHandle = fetch => ({
  fetch,
  getCredential: async () => ({ accessKey: 'AK', secretKey: 'SK', securityToken: 'ST', expiresAt: Date.now() + 3_600_000 }),
  saveCredential: async () => true,
})

test('CodeArts 签到：双通道多个每日活动全部处理，不遗漏首个之外的活动', async () => {
  const claimedIds = []
  const res = await codeartsSpec.checkin(codeartsHandle(async (url, init) => {
    const target = String(url)
    if (target.includes('/delivery?channel=DESKTOP')) {
      return Response.json({ code: 0, data: { items: [
        { type: 'daily_claim', campaignId: 'desk-1', claimable: true, status: 'PENDING', benefitAmount: 100 },
        { type: 'USER_LOGIN', campaignId: 'dup-in-both', claimable: true, status: 'PENDING', benefitAmount: 50 },
      ] } })
    }
    if (target.includes('/delivery?channel=IDE')) {
      return Response.json({ code: 0, data: { items: [
        { type: 'USER_LOGIN', campaignId: 'ide-1', claimable: true, status: 'PENDING', benefitAmount: 200 },
        { type: 'USER_LOGIN', campaignId: 'dup-in-both', claimable: true, status: 'PENDING', benefitAmount: 50 },
      ] } })
    }
    if (target.endsWith('/v1/ops/claim')) {
      claimedIds.push(JSON.parse(init.body).campaignId)
      const credit = { 'desk-1': 100, 'ide-1': 200, 'dup-in-both': 50 }[claimedIds.at(-1)] ?? 0
      return Response.json({ code: 0, data: { id: `ben-${claimedIds.length}`, benefitAmount: credit } })
    }
    if (target.endsWith('/v1/ops/confirm')) return Response.json({ code: 0, data: {} })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(res.outcome, 'claimed')
  assert.equal(res.credit, 350, '三个去重活动（desk-1 + ide-1 + dup-in-both）的积分应累加')
  assert.equal(claimedIds.length, 3)
  assert.equal(new Set(claimedIds).size, 3, '同 campaignId 跨通道出现两次时只领一次')
})

test('CodeArts 签到：claim 存疑先重查活动状态，已入账则不重发', async () => {
  let claimPosts = 0
  let deliveryCalls = 0
  const res = await codeartsSpec.checkin(codeartsHandle(async (url, init) => {
    const target = String(url)
    if (target.includes('/v1/ops/delivery')) {
      deliveryCalls++
      return Response.json({ code: 0, data: { items: [
        { type: 'USER_LOGIN', campaignId: 'camp-9', claimable: deliveryCalls <= 2, status: deliveryCalls <= 2 ? 'PENDING' : 'CONFIRMED' },
      ] } })
    }
    if (target.endsWith('/v1/ops/claim')) {
      claimPosts++
      assert.equal(init.method, 'POST')
      return Response.json({ code: 500, message: 'gateway error' })
    }
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(res.outcome, 'already-claimed', '重查发现已入账应按已领处理')
  assert.equal(claimPosts, 1, '领取请求只发出一次，绝不重复提交')
})

test('CodeArts 签到：claim 成功但 confirm 失败且重查未结算时记 pending', async () => {
  let claimPosts = 0
  const res = await codeartsSpec.checkin(codeartsHandle(async (url) => {
    const target = String(url)
    if (target.includes('/v1/ops/delivery')) {
      return Response.json({ code: 0, data: { items: [
        // 初始列出为可领取；confirm 失败后重查仍停留在 CLAIMED（已提交未结算），用于验证 pending 分支
        { type: 'USER_LOGIN', campaignId: 'camp-2', claimable: true, status: 'PENDING' },
      ] } })
    }
    if (target.endsWith('/v1/ops/claim')) {
      claimPosts++
      return Response.json({ code: 0, data: { id: 'ben-9' } })
    }
    if (target.endsWith('/v1/ops/confirm')) return Response.json({ code: 409, message: 'confirm failed' })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(res.outcome, 'pending')
  assert.equal(claimPosts, 1)
})

test('CodeArts 日常活动只有签到一个入口，业务拒绝不计已领', async () => {
  assert.equal(codeartsSpec.claimRewards, undefined)
  let claimPosts = 0
  const res = await codeartsSpec.checkin(codeartsHandle(async (url) => {
    const target = String(url)
    if (target.includes('/delivery?channel=IDE')) {
      return Response.json({ code: 0, data: { items: [
        { type: 'USER_LOGIN', campaignId: 'claimable-1', claimable: true, status: 'PENDING' },
        { type: 'USER_LOGIN', campaignId: 'settled-1', claimable: false, status: 'CONFIRMED' },
        { type: 'UNKNOWN_TYPE', campaignId: 'unknown-1', claimable: true, status: 'PENDING' },
      ] } })
    }
    if (target.includes('/delivery?channel=DESKTOP')) return Response.json({ code: 0, data: { items: [] } })
    if (target.endsWith('/v1/ops/claim')) {
      claimPosts++
      return Response.json({ code: 9001, message: 'no reward' })
    }
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(claimPosts, 1, 'UNKNOWN_TYPE 与非 claimable 项不得触发领取')
  assert.equal(res.outcome, 'pending')
  assert.notEqual(res.unsubmitted, true)
})

test('CodeArts 签到：claim+confirm 全成功才计 claimed', async () => {
  const res = await codeartsSpec.checkin(codeartsHandle(async (url) => {
    const target = String(url)
    if (target.includes('/delivery?channel=IDE')) {
      return Response.json({ code: 0, data: { items: [
        { type: 'USER_LOGIN', campaignId: 'camp-ok', claimable: true, status: 'PENDING' },
      ] } })
    }
    if (target.includes('/delivery?channel=DESKTOP')) return Response.json({ code: 0, data: { items: [] } })
    if (target.endsWith('/v1/ops/claim')) return Response.json({ code: 0, data: { id: 'ben-ok' } })
    if (target.endsWith('/v1/ops/confirm')) return Response.json({ code: 0, data: {} })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.deepEqual(res, { outcome: 'claimed', credit: null })
})

test('CodeArts 只读签到状态按证据分级，查询不提交申请', async () => {
  const writes = []
  const run = delivery => {
    const handle = codeartsHandle(async (url, init) => {
      if (init?.method && init.method !== 'GET') writes.push(String(url))
      return Response.json(delivery)
    })
    return handle
  }
  const evidence = { code: 0, data: { items: [{ type: 'USER_LOGIN', campaignId: 'c1', status: 'CONFIRMED', claimable: false, benefitAmount: 80 }] } }
  assert.equal((await codeartsSpec.checkinStatus(run(evidence), {})).outcome, 'done')
  const claimable = { code: 0, data: { items: [{ type: 'USER_LOGIN', campaignId: 'c2', status: 'PENDING', claimable: true }] } }
  assert.equal((await codeartsSpec.checkinStatus(run(claimable), {})).outcome, 'pending')
  const empty = { code: 0, data: { items: [] } }
  assert.equal((await codeartsSpec.checkinStatus(run(empty), {})).outcome, 'inactive')
  const broken = { code: 500, message: 'boom' }
  assert.equal((await codeartsSpec.checkinStatus(run(broken), {})).outcome, 'failed')
  assert.equal(writes.length, 0, '状态查询不得触发 trigger/claim/confirm 等写端点')
})

// —— 已确认状态误报修复：AStudio 入账证据、业务码判定与只读状态方法 ——

const ASTUDIO_CRED = { ssoSessionId: 'sso-1', sessionToken: 'tok-1', accountId: 'acc-1' }
const astudioHandle = fetch => ({ fetch, getCredential: async () => ASTUDIO_CRED })

test('AStudio 签到：无入账证据记 pending，查询失败记 failed，不再误报 done', async () => {
  // 触发写入后流水仍无 GRANT：旧实现误报 done，现在必须 pending
  const pendingRes = await astudioSpec.checkin(astudioHandle(async (url) => {
    const target = String(url)
    if (target.includes('/points/details')) return Response.json({ code: 0, data: { records: [] } })
    if (target.includes('/client-popups/pending')) return Response.json({ code: 0, data: [] })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(pendingRes.outcome, 'pending')

  // 流水查询直接失败：不能继续写，记 failed + unsubmitted
  let wrote = false
  const failedRes = await astudioSpec.checkin(astudioHandle(async (url, init) => {
    if (init?.method === 'POST') wrote = true
    throw new Error('network down')
  }), {})
  assert.equal(failedRes.outcome, 'failed')
  assert.equal(failedRes.unsubmitted, true)
  assert.equal(wrote, false)

  // 业务拒绝（非死会话）：同样不能断言未入账
  const refusedRes = await astudioSpec.checkin(astudioHandle(async (url) => {
    const target = String(url)
    if (target.includes('/points/details')) return Response.json({ code: 9001, message: 'denied' })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(refusedRes.outcome, 'failed')

  // 有今日 GRANT 流水：already-claimed，不触发任何写
  let wrote2 = false
  const grantRow = { operation: 'GRANT', reason: '每日登录奖励', amount: 30 }
  const doneRes = await astudioSpec.checkin(astudioHandle(async (url, init) => {
    if (init?.method === 'POST') wrote2 = true
    const target = String(url)
    if (target.includes('/points/details')) return Response.json({ code: 0, data: { records: [grantRow] } })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(doneRes.outcome, 'already-claimed')
  assert.equal(doneRes.credit, 30)
  assert.equal(wrote2, false)
})

test('AStudio claimRewards：业务码判定成败，HTTP 200 但 code 拒绝不得计已领', async () => {
  const popup = { componentType: 'NEW_USER_DIALOG', popupId: 7, instanceKey: 'inst-7' }
  // /complete 业务拒绝：claimed 不得增长，记 failed 且不可盲目重试
  const refused = await astudioSpec.claimRewards(astudioHandle(async (url) => {
    const target = String(url)
    if (target.includes('/client-popups/pending')) return Response.json({ code: 0, data: [popup] })
    if (target.includes('/client-popups/complete')) return Response.json({ code: 5001, message: 'already taken' })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(refused.kind, 'failed')

  // /complete 业务成功：才计 claimed
  const ok = await astudioSpec.claimRewards(astudioHandle(async (url) => {
    const target = String(url)
    if (target.includes('/client-popups/pending')) return Response.json({ code: 0, data: [popup] })
    if (target.includes('/client-popups/complete')) return Response.json({ code: 0, data: {} })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.deepEqual(ok, { kind: 'claimed', claimed: 1 })

  // 无可领弹窗：done
  const none = await astudioSpec.claimRewards(astudioHandle(async (url) => {
    const target = String(url)
    if (target.includes('/client-popups/pending')) return Response.json({ code: 0, data: [{ ...popup, componentType: 'DAILY_REWARD_DIALOG' }] })
    assert.fail('每日弹窗只能由签到提交')
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.deepEqual(none, { kind: 'empty', claimed: 0, retryable: true })

  // 弹窗查询传输失败：failed + retryable
  const boom = await astudioSpec.claimRewards(astudioHandle(async () => { throw new Error('down') }), {})
  assert.equal(boom.kind, 'failed')
  assert.equal(boom.retryable, true)
})

test('AStudio 只读状态：checkinStatus 按流水证据分级，rewardStatus 按弹窗分级', async () => {
  const grantRow = { operation: 'GRANT', reason: '每日登录奖励', amount: 10 }
  // 有入账证据 → done；无证据 → pending；查询异常 → failed
  const done = await astudioSpec.checkinStatus(astudioHandle(async (url) => {
    if (String(url).includes('/points/details')) return Response.json({ code: 0, data: { records: [grantRow] } })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(done.outcome, 'done')
  assert.equal(done.credit, 10)
  const pendingRes = await astudioSpec.checkinStatus(astudioHandle(async (url) => {
    if (String(url).includes('/points/details')) return Response.json({ code: 0, data: { records: [] } })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(pendingRes.outcome, 'pending')
  const failedRes = await astudioSpec.checkinStatus(astudioHandle(async () => { throw new Error('down') }), {})
  assert.equal(failedRes.outcome, 'failed')

  // rewardStatus：可领弹窗 → pending；无弹窗 → empty；死会话/查询失败 → failed
  const popup = { componentType: 'NEW_USER_DIALOG', popupId: 3, instanceKey: 'k3' }
  const p1 = await astudioSpec.rewardStatus(astudioHandle(async (url) => {
    if (String(url).includes('/client-popups/pending')) return Response.json({ code: 0, data: [popup] })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(p1.kind, 'pending')
  const p2 = await astudioSpec.rewardStatus(astudioHandle(async (url) => {
    if (String(url).includes('/client-popups/pending')) return Response.json({ code: 0, data: [] })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(p2.kind, 'empty')
  const p3 = await astudioSpec.rewardStatus(astudioHandle(async (url) => {
    if (String(url).includes('/client-popups/pending')) return Response.json({ code: 1002 })
    return Response.json({ code: 0, data: {} })
  }), {})
  assert.equal(p3.kind, 'failed')
})

test('AStudio 额度：只有推理 Token 时报 no_web_session，不去请求积分接口', async () => {
  // 真实报障：账号能推理，但账号行的数值位一直停在「额度待更新」。
  // 根因：没有网页会话（ssoSessionId）时积分根本读不到，旧实现只返回 balance:null
  // 且不带 error，界面于是以为「下次会更新」。
  const requests = []
  const usage = await astudioSpec.fetchUsage({
    getCredential: async () => ({ modelBearerToken: 'mb-1', accountId: 'acc-1' }),
    fetch: async (url) => {
      requests.push(String(url))
      return Response.json({ code: 0, data: { models: [] } })
    },
  }, {})

  assert.equal(usage.signedIn, true, '推理 Token 有效，账号仍是已登录')
  assert.equal(usage.error, 'no_web_session')
  assert.equal(usage.balance, null)
  assert.deepEqual(usage.windows, [])
  // 关键：不得拿 account_id / token 去撞积分接口（实测必回 80000 并被误判登录失效）。
  assert.equal(requests.some(url => url.includes('/points/balance')), false,
    '无网页会话时不该请求积分接口')
})

test('AStudio 额度：account_id 不是会话凭据，仍按 no_web_session 处理', async () => {
  // 实测对照（2026-11-24）：points/balance 只认 ssoSessionId；
  // 单独带 account_id、单独带 token、或两者同带都回 code 80000。
  // 旧实现用「cookieHeader 非空」当判据，只有 accountId 的账号会走进联网分支，
  // 再被 80000 判成 auth_expired —— 用户看到「额度读不到 + 登录已失效」。
  for (const credential of [
    { modelBearerToken: 'mb-1', accountId: 'acc-1' },
    { modelBearerToken: 'mb-1', sessionToken: 'tok-1' },
    { modelBearerToken: 'mb-1', accountId: 'acc-1', sessionToken: 'tok-1' },
  ]) {
    const requests = []
    const usage = await astudioSpec.fetchUsage({
      getCredential: async () => credential,
      fetch: async (url) => {
        requests.push(String(url))
        return Response.json({ code: 0, data: { models: [] } })
      },
    }, {})
    assert.equal(usage.error, 'no_web_session', JSON.stringify(credential))
    assert.equal(usage.signedIn, true, '不能因缺网页会话就报登录失效')
    assert.equal(requests.some(url => url.includes('/points/balance')), false)
  }
})

test('AStudio 额度：有 ssoSessionId 时正常读积分并按分项给出窗口', async () => {
  const requests = []
  const usage = await astudioSpec.fetchUsage({
    getCredential: async () => ({ ssoSessionId: 'sso-1', accountId: 'acc-1' }),
    fetch: async (url) => {
      const target = String(url)
      requests.push(target)
      if (target.includes('/points/balance')) {
        return Response.json({
          code: 0,
          data: {
            totalBalance: 1300, memberTotal: 0, memberBalance: 0, buyTotal: 0, buyBalance: 0,
            activityTotal: 2000, activityBalance: 1300, activityNextExpireTime: '2026-12-23T17:59:17',
            sparkTotalBalance: 0,
          },
        })
      }
      if (target.includes('/membership/me')) return Response.json({ code: 0, data: { planName: '体验版' } })
      return Response.json({ code: 0, data: {} })
    },
  }, {})

  assert.ok(!usage.error)
  assert.equal(usage.balance, 1300)
  assert.equal(usage.plan, '体验版')
  assert.equal(usage.windows.length, 1, '只有活动包有额度，其余 0 不进窗口')
  assert.equal(usage.windows[0].name, '活动赠送积分')
  assert.equal(usage.windows[0].balance, 1300)
  // sparkTotalBalance 为 0 时不得编造出「星火积分」窗口。
  assert.equal(usage.windows.some(w => w.name === '星火积分'), false)
  assert.ok(requests.some(url => url.includes('/points/balance')))
})

test('AStudio 额度：只有网页会话（无推理 Token）也能读积分', async () => {
  // 读额度只需要 ssoSessionId；早期把 modelBearerToken 当前置条件会误报 credential_error。
  const usage = await astudioSpec.fetchUsage({
    getCredential: async () => ({ ssoSessionId: 'sso-1' }),
    fetch: async (url) => {
      if (String(url).includes('/points/balance')) return Response.json({ code: 0, data: { totalBalance: 42 } })
      return Response.json({ code: 0, data: {} })
    },
  }, {})
  assert.ok(!usage.error)
  assert.equal(usage.balance, 42)
})
