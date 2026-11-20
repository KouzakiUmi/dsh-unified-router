import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManagedChannelManager } from '../lib/managed-channel.js'
import { createManagedAdapter, toManagedModelDescriptor } from '../lib/managed-llm.js'
import { astudioSpec, parseAStudioCatalog, sanitizeAStudioCredential } from '../lib/managed-providers/astudio.js'
import { doubaoworkSpec, parseDoubaoSsrModels, parseDoubaoSseBlock, extractDoubaoToolCalls, sanitizeDoubaoWorkCredential } from '../lib/managed-providers/doubaowork.js'
import { cozeSpec, parseCozeModelList, sanitizeCozeCredential } from '../lib/managed-providers/coze.js'
import { codeartsSpec, signHuaweiRequest, parseCodeArtsBuiltinModels, mergeConsecutiveTurns, sanitizeCodeArtsCredential } from '../lib/managed-providers/codearts.js'
import { MANAGED_PROVIDERS, MANAGED_PROVIDER_IDS } from '../lib/managed-providers/index.js'

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

test('MANAGED_PROVIDERS 注册表包含全部四个新渠道', () => {
  assert.deepEqual(MANAGED_PROVIDER_IDS, ['astudio', 'doubaowork', 'coze', 'codearts'])
  assert.equal(MANAGED_PROVIDERS.length, 4)
})

test('通用自管多账号管理器：导入/去重/备注/删号防复活/凭据脱敏/compat 模型参数', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'managed-channel-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = memoryHost()
  let savedRefHandle = null
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
    createAdapter: async ({ rows, providerId }) => ({ providerIds: [providerId], adapter: { id: providerId, rows } }),
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

test('豆包工作：SSR 双路径模型解析、SSE 补丁流解析与图片拒绝', () => {
  const html = `<script>window.__DATA__={"modeSelectData":{"menuConfV2":{"model_list":{"item_list":[{"model_item_key":"ds-v4","name":"DeepSeek V4.1","conversation_mode_list":["office"],"model_extra_params":{"total_window_size":300000},"reasoning_effort_config":{"option_list":[{"level":3},{"level":5},{"level":7}],"default_level":5},"tag_list":[{"type":6,"text":"限时优惠 0.01x"}]},{"model_item_key":"locked-pro","name":"Locked","subscribe_config":{"need_upgrade":true}}]}}}};</script>`
  const models = parseDoubaoSsrModels(html)
  assert.equal(models.length, 1)
  assert.equal(models[0].id, 'ds-v4')
  assert.equal(models[0].context, 300_000)
  assert.equal(models[0].rate, 0.01)
  assert.deepEqual(models[0].efforts, ['low', 'high', 'max'])
  assert.equal(models[0].attachment, false)

  const state = { thinkingBlocks: new Set(), lastIsThinking: false, conversationId: '' }
  const ev1 = parseDoubaoSseBlock('STREAM_CHUNK', {
    patch_op: [{ patch_value: { content_block: [{ block_id: 'b1', block_type: 10040, content: { text_block: { text: '思考中' } } }] } }],
  }, state)
  assert.deepEqual(ev1, [{ kind: 'thinking', text: '思考中' }])
  const ev2 = parseDoubaoSseBlock('CHUNK_DELTA', { text: '继续思考' }, state)
  assert.deepEqual(ev2, [{ kind: 'thinking', text: '继续思考' }])
  const ev3 = parseDoubaoSseBlock('STREAM_CHUNK', {
    patch_op: [{ patch_value: { content_block: [{ block_id: 'b2', block_type: 10000, content: { text_block: { text: '正文回答' } } }] } }],
  }, state)
  assert.deepEqual(ev3, [{ kind: 'text', text: '正文回答' }])
  assert.equal(sanitizeDoubaoWorkCredential({ cookie: 'foo=bar' }), null)
  assert.ok(sanitizeDoubaoWorkCredential({ cookie: 'sessionid=abc123; s_v_web_id=fp1' }))

  const tc = extractDoubaoToolCalls('```json\n{"content":"查一下","tool_calls":[{"name":"read","arguments":{"file_path":"a.js"}}]}\n```', ['read'])
  assert.equal(tc.content, '查一下')
  assert.equal(tc.toolCalls.length, 1)
  assert.equal(tc.toolCalls[0].name, 'read')
  assert.deepEqual(tc.toolCalls[0].arguments, { file_path: 'a.js' })
  // 混排解释文本中的示例代码块不得误触发工具调用
  assert.equal(
    extractDoubaoToolCalls('这是工具调用 JSON 示例：\n```json\n{"content":"","tool_calls":[{"name":"read","arguments":{}}]}\n```', ['read']),
    null,
    '带前后自然语言说明的示例代码不得触发 toolUse',
  )
  // 未声明在工具白名单内的名称不得触发
  assert.equal(
    extractDoubaoToolCalls('{"content":"","tool_calls":[{"name":"evil_tool","arguments":{}}]}', ['read']),
    null,
  )
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

test('豆包工作：兼容额度备用结构及任务状态，只读取不领奖', async () => {
  const usage = await doubaoworkSpec.fetchUsage({
    getCredential: async () => ({ cookie: 'sessionid=fixture' }),
    saveCredential: async () => true,
    fetch: async url => {
      const path = new URL(url).pathname
      if (path.includes('/account/info/')) return Response.json({ data: { user_id_str: '123' } })
      if (path.endsWith('/launch')) return Response.json({ data: { ug_campaign_info: { campaign_group_code: 'fixture' } } })
      if (path.endsWith('/summary/')) return Response.json({}, { status: 503 })
      if (path.endsWith('/overview/')) return Response.json({ data: { quota_package_section: { window_limit_groups: [{
        window_limits: [{ window_type: 3, total_amount: '2,100', used_amount: '1,700' }],
      }] } } })
      assert.ok(path.endsWith('/detail/'), '不提交任何领取或完成请求')
      return Response.json({ data: { tasks: [{ task_status: 2 }, { task_status: 3 }, { task_status: 1, reward_mode: 2 }] } })
    },
  }, {})
  assert.equal(usage.balance, 400)
  assert.equal(usage.windows[0].name, '活动赠送')
  assert.equal(usage.windows[1].display, '待领取 2 项 · 已领取 1 项')
  assert.equal(doubaoworkSpec.completeTasks, undefined)
})

test('Coze：额度业务失败不撤销登录状态，明确鉴权失败才标过期', async () => {
  const run = code => cozeSpec.fetchUsage({
    getCredential: async () => ({ patToken: 'cztei_fixture', ownerId: 'fixture' }),
    fetch: async () => Response.json({ code }),
  }, {})
  assert.deepEqual(await run(500), { error: 'upstream_error' })
  assert.deepEqual(await run(700012006), { signedIn: false, error: 'auth_expired' })
})

test('Coze：实时模型目录与倍率/多模态能力解析、凭据收敛', async () => {
  const models = parseCozeModelList({
    data: {
      models: [
        { name: 'glm-5.3-flash', display_name: 'GLM-5.3-Flash', capability: ['图片理解', '推理能力'], consumption_multiplier: 0.1 },
        { name: 'deepseek-v4-pro', display_name: 'DeepSeek-V4-Pro', capability: ['推理能力'], consumption_multiplier: 0.62 },
      ],
    },
  })
  assert.equal(models.length, 2)
  assert.equal(models[0].attachment, true)
  assert.equal(models[0].reasoning, true)
  assert.equal(models[0].rate, 0.1)
  assert.equal(models[1].attachment, false)
  assert.equal(models[1].context, null)
  assert.equal(sanitizeCozeCredential({}), null)
  assert.equal(sanitizeCozeCredential({ patToken: 'cztei_abc' }).patToken, 'cztei_abc')

  // 无 efforts 的 Coze 模型绝不能产出 reasoning: true + 全 null thinkingLevelMap（否则 DSH Core 报 invalid reasoning metadata）
  const desc = toManagedModelDescriptor({ ...models[0], contextWindow: 128_000, maxOutputLength: 32_768 }, 'coze', cozeSpec)
  assert.equal(desc.reasoning, false)
  assert.equal(desc.thinkingLevelMap, undefined)

  // 无 Cookie 的桌面 PAT 账号 claimRewards 不误报 failed
  const noCookieRes = await cozeSpec.claimRewards({
    entry: { source: 'local' },
    fetch: async () => { throw new Error('不应发起请求') },
    getCredential: async () => ({ patToken: 'cztei_only', ownerId: 'u1' }),
    saveCredential: async () => false,
  }, {})
  assert.equal(noCookieRes.kind, 'empty')
})

test('CodeArts：SDK-HMAC-SHA256 签名、builtin 模型解析（32000 夹取）与相邻消息合并', async () => {
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
    ],
  })
  assert.equal(models.length, 1)
  assert.equal(models[0].name, 'GLM-5.2')
  assert.equal(models[0].output, 32_000, '/api/v1 输出上限必须夹到 32000')
  assert.equal(models[0].rate, 0.62)
  assert.deepEqual(models[0].efforts, ['off', 'high'])

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
  assert.equal((await run({ code: 0, data: { items: [{ type: 'USER_LOGIN', status: 'CLAIMED', claimable: true }] } })).outcome, 'already-claimed')
  assert.deepEqual(await run({ code: 0, data: { items: [] } }), { outcome: 'inactive', unsubmitted: true })
  assert.deepEqual(await run({ code: 500, data: { items: [] } }), { outcome: 'failed', unsubmitted: true })
})
