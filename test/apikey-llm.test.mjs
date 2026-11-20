import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createApiKeyAdapter,
  createApiKeyFetch,
  makeRequestDefaults,
  makeStreamWrapper,
  toModelDescriptor,
} from '../lib/apikey-llm.js'
import { PLAN_EFFORTS } from '../lib/sensenova-params.js'

const CHAT_URL = 'https://api.agnes-ai.cn/v1/chat/completions'

function makeSpec(overrides = {}) {
  return {
    id: 'agnes',
    title: 'Agnes',
    endpoint: 'https://api.agnes-ai.cn',
    chatPath: '/v1/chat/completions',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    effortBody: (effort) => effort === 'off'
      ? { reasoning_effort: 'none' }
      : { reasoning_effort: effort },
    ...overrides,
  }
}

function makeRow(overrides = {}) {
  return {
    id: 'agnes-3.0-flash',
    name: 'Agnes 3.0 Flash',
    attachment: true,
    efforts: ['off', 'low', 'medium', 'high'],
    effectiveEffort: 'low',
    contextWindow: 524288,
    maxOutputLength: 65536,
    vision: true,
    ...overrides,
  }
}

test('toModelDescriptor 映射 pi-ai 描述符并应用默认值', () => {
  const model = toModelDescriptor(makeRow(), 'agnes', 'https://api.agnes-ai.cn/v1')
  assert.equal(model.id, 'agnes-3.0-flash')
  assert.equal(model.name, 'Agnes 3.0 Flash')
  assert.equal(model.api, 'openai-completions')
  assert.equal(model.provider, 'agnes')
  assert.equal(model.baseUrl, 'https://api.agnes-ai.cn/v1')
  assert.equal(model.reasoning, true)
  assert.equal(model.contextWindow, 524288)
  assert.equal(model.maxTokens, 65536)
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.deepEqual(model.compat, { supportsDeveloperRole: false, maxTokensField: 'max_tokens' })

  const fallback = toModelDescriptor(
    { id: 'm', name: 'M', efforts: [] }, 'agnes', 'https://x/v1')
  assert.equal(fallback.contextWindow, 128_000)
  assert.equal(fallback.maxTokens, 32_768)
  assert.equal(fallback.reasoning, false)
  assert.deepEqual(fallback.input, ['text'])
})

test('toModelDescriptor thinkingLevelMap 覆盖全部档位，未支持的为 null', () => {
  const model = toModelDescriptor(makeRow(), 'agnes', 'https://x/v1')
  assert.deepEqual(Object.keys(model.thinkingLevelMap), PLAN_EFFORTS)
  for (const level of PLAN_EFFORTS) {
    const expected = ['off', 'low', 'medium', 'high'].includes(level) ? level : null
    assert.equal(model.thinkingLevelMap[level], expected, `level ${level}`)
  }
})

test('toModelDescriptor input 跟随 vision / attachment，显式 vision:false 优先', () => {
  const byVision = toModelDescriptor(makeRow({ vision: true, attachment: false }), 'agnes', 'https://x/v1')
  assert.deepEqual(byVision.input, ['text', 'image'])
  const byAttachment = toModelDescriptor(makeRow({ vision: undefined, attachment: true }), 'agnes', 'https://x/v1')
  assert.deepEqual(byAttachment.input, ['text', 'image'])
  const overridden = toModelDescriptor(makeRow({ vision: false, attachment: true }), 'agnes', 'https://x/v1')
  assert.deepEqual(overridden.input, ['text'])
  const none = toModelDescriptor(makeRow({ vision: false, attachment: false }), 'agnes', 'https://x/v1')
  assert.deepEqual(none.input, ['text'])
})

test('makeRequestDefaults：短请求且支持 off 时取 off，否则 effectiveEffort', () => {
  const rows = [
    makeRow({ id: 'm-off', efforts: ['off', 'low'], effectiveEffort: 'low' }),
    makeRow({ id: 'm-nooff', efforts: ['low', 'high'], effectiveEffort: 'high' }),
    makeRow({ id: 'm-none', efforts: [], effectiveEffort: undefined }),
  ]
  const byId = new Map(rows.map(row => [row.id, row]))
  const defaults = makeRequestDefaults(byId)

  assert.equal(defaults({ model: 'm-off', maxTokens: 512 }).reasoningEffort, 'off')
  assert.equal(defaults({ model: 'm-off', maxTokens: 2048 }).reasoningEffort, 'low')
  assert.equal(defaults({ model: 'm-off', maxTokens: 0 }).reasoningEffort, 'low')

  const shortNoOff = { model: 'm-nooff', maxTokens: 512 }
  assert.equal(defaults(shortNoOff), shortNoOff, '短请求不支持 off 时原样返回')
  assert.equal(defaults({ model: 'm-nooff', maxTokens: 4096 }).reasoningEffort, 'high')

  const callerSet = { model: 'm-off', maxTokens: 512, reasoningEffort: 'medium' }
  assert.equal(defaults(callerSet).reasoningEffort, 'medium')

  const nothing = { model: 'm-none', maxTokens: 4096 }
  assert.equal(defaults(nothing), nothing)
})

function fetchFor(spec, { context = {}, rows = [makeRow()], upstream, model } = {}) {
  const requestContext = new AsyncLocalStorage()
  const byId = new Map(rows.map(row => [row.id, row]))
  const fetch = createApiKeyFetch({
    spec, byId, requestContext,
    upstream: upstream ?? (async () => new Response('{}')),
    model,
  })
  return {
    fetch,
    run: (input, init, store = context) =>
      requestContext.run(store, () => fetch(input, init)),
  }
}

test('createApiKeyFetch 拒绝错误的 origin 与 path，错误不含 Key', async () => {
  const spec = makeSpec()
  let calls = 0
  const { run } = fetchFor(spec, {
    upstream: async () => { calls += 1; return new Response('{}') },
  })
  const key = 'sk-secret-abcdef'

  await assert.rejects(
    run('https://evil.example.com/v1/chat/completions', { method: 'POST', body: '{}' }),
    err => {
      assert.equal(err.message, 'Agnes 请求地址无效')
      assert.equal(String(err.stack).includes(key), false)
      return true
    })
  await assert.rejects(
    run('https://api.agnes-ai.cn/v1/other', { method: 'POST', body: '{}' }),
    { message: 'Agnes 请求地址无效' })
  await assert.rejects(
    run('https://api.agnes-ai.cn/v1/chat/completions/extra', { method: 'POST', body: '{}' }),
    { message: 'Agnes 请求地址无效' })
  assert.equal(calls, 0, '非法地址不得触达上游')
})

test('createApiKeyFetch 合法地址放行并合并头', async () => {
  let seen
  const upstream = async (input, init) => {
    seen = { input, init }
    return new Response('{"ok":true}', { status: 200 })
  }
  const { run } = fetchFor(makeSpec(), { upstream })
  const response = await run(CHAT_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer sk-secret-abcdef' },
    body: '{"model":"agnes-3.0-flash"}',
  })
  assert.equal(response.status, 200)
  assert.equal(seen.init.headers.get('authorization'), 'Bearer sk-secret-abcdef')
  assert.equal(seen.init.body, '{"model":"agnes-3.0-flash"}')
})

test('createApiKeyFetch 合并 spec.effortBody 返回对象到请求体', async () => {
  const calls = []
  let seenBody
  const spec = makeSpec({
    effortBody: (effort, row) => {
      calls.push([effort, row])
      return { reasoning_effort: effort }
    },
  })
  const row = makeRow()
  const upstream = async (input, init) => {
    seenBody = init.body
    return new Response('{}')
  }
  const { run } = fetchFor(spec, { rows: [row], upstream })
  await run(CHAT_URL, { method: 'POST', body: '{"model":"agnes-3.0-flash","temperature":0.5}' },
    { reasoningEffort: 'low', model: 'agnes-3.0-flash' })
  assert.deepEqual(calls, [['low', row]], 'effortBody 应收到 effort 与该模型行')
  assert.deepEqual(JSON.parse(seenBody), {
    model: 'agnes-3.0-flash', temperature: 0.5, reasoning_effort: 'low',
  })
})

test('createApiKeyFetch：effortBody 返回 undefined / 无 effort / 非 JSON 体时原样放行', async () => {
  const bodies = []
  const upstream = async (input, init) => {
    bodies.push(init?.body)
    return new Response('{}')
  }
  let effortCalls = 0
  const spec = makeSpec({
    effortBody: () => { effortCalls += 1; return undefined },
  })
  const { run } = fetchFor(spec, { upstream })

  await run(CHAT_URL, { method: 'POST', body: '{"a":1}' }, { reasoningEffort: 'low', model: 'agnes-3.0-flash' })
  assert.equal(effortCalls, 1)
  assert.equal(bodies[0], '{"a":1}', 'undefined 返回不得改体')

  // 无请求上下文（没有 reasoningEffort）→ 完全不调 effortBody
  await run(CHAT_URL, { method: 'POST', body: '{"a":2}' }, {})
  assert.equal(effortCalls, 1)
  assert.equal(bodies[1], '{"a":2}')

  // 非 JSON 体不解析、不抛错
  await run(CHAT_URL, { method: 'POST', body: 'not-json' }, { reasoningEffort: 'low', model: 'agnes-3.0-flash' })
  assert.equal(bodies[2], 'not-json')
})

test('createApiKeyFetch 接受 Request 输入并从克隆体读取', async () => {
  let seen
  const upstream = async (input, init) => {
    seen = { input, init }
    return new Response('{}')
  }
  const spec = makeSpec({ effortBody: () => ({ reasoning_effort: 'high' }) })
  const { run } = fetchFor(spec, { upstream })
  const request = new Request(CHAT_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer k' },
    body: '{"model":"agnes-3.0-flash"}',
  })
  await run(request, undefined, { reasoningEffort: 'high', model: 'agnes-3.0-flash' })
  assert.deepEqual(JSON.parse(seen.init.body), {
    model: 'agnes-3.0-flash', reasoning_effort: 'high',
  })
  assert.equal(seen.init.headers.get('authorization'), 'Bearer k')
  // 错误地址的 Request 同样被拒
  await assert.rejects(
    run(new Request('https://api.agnes-ai.cn/wrong', { method: 'POST', body: '{}' })),
    { message: 'Agnes 请求地址无效' })
})

function stubPeers(capture) {
  return {
    assemblePiAiAdapter: (args) => {
      capture.args = args
      return { adapter: { stub: true }, providerIds: [args.providerId] }
    },
    openAICompletionsApi: () => ({
      stream: (model, context, options) => capture.streamOptions = options,
      streamSimple: (model, context, options) => capture.streamSimpleOptions = options,
    }),
  }
}

test('createApiKeyAdapter 装配：displayName/apiKeyName/resolveCredential/默认值', async () => {
  const capture = {}
  const rows = [makeRow({ id: 'm1' }), makeRow({ id: 'm2', maxOutputLength: undefined })]
  let resolved = 0
  const built = await createApiKeyAdapter({
    spec: makeSpec(), rows,
    resolveKey: async () => { resolved += 1; return 'sk-secret-abcdef' },
    get: () => undefined,
  }, stubPeers(capture))

  assert.deepEqual(built.providerIds, ['agnes'])
  const args = capture.args
  assert.equal(args.providerId, 'agnes')
  assert.equal(args.displayName, 'Agnes')
  assert.equal(args.apiKeyName, 'Agnes API Key')
  assert.equal(args.models.length, 2)
  assert.equal(args.models[0].provider, 'agnes')
  assert.equal(args.models[0].api, 'openai-completions')
  assert.equal(args.configuredMaxTokens.get('m1'), 65536)
  assert.equal(args.configuredMaxTokens.get('m2'), 32_768)
  assert.equal(args.modelEfforts.get('m1'), 'low')
  assert.equal(typeof args.requestDefaults, 'function')
  assert.equal(typeof args.wrapStream, 'function')
  assert.equal(typeof args.api.stream, 'function')
  assert.equal(typeof args.api.streamSimple, 'function')

  // resolveCredential 是 resolveKey 的直通
  assert.equal(await args.resolveCredential(), 'sk-secret-abcdef')
  assert.equal(resolved, 1)

  // 装配参数与错误文案均不携带 Key
  const text = JSON.stringify(args, (key, value) => typeof value === 'function' ? '[fn]' : value)
  assert.equal(text.includes('sk-secret-abcdef'), false)
  assert.equal(args.apiKeyName.includes('sk-secret-abcdef'), false)
})

test('createApiKeyAdapter 的拦截流端到端：wrapStream 供上下文，fetch 校验并合并', async () => {
  const capture = {}
  const requests = []
  const spec = makeSpec({
    effortBody: (effort, row) => ({ reasoning_effort: effort, _row: row?.id }),
  })
  const peers = {
    assemblePiAiAdapter: (args) => {
      capture.args = args
      return { adapter: {}, providerIds: [args.providerId] }
    },
    // 模拟 pi-ai 流实现：发起一次 HTTP 请求（经 options.fetch）后产出一条 chunk
    openAICompletionsApi: () => {
      async function* proxyRequest(model, options) {
        const response = await options.fetch(model.baseUrl + '/chat/completions', {
          method: 'POST', body: '{"model":"' + model.id + '"}',
        })
        yield { type: 'done', status: response.status }
      }
      return {
        stream: (model, context, options) => proxyRequest(model, options),
        streamSimple: (model, context, options) => proxyRequest(model, options),
      }
    },
  }
  await createApiKeyAdapter({
    spec, rows: [makeRow({ id: 'm1' })],
    resolveKey: async () => 'sk-secret-abcdef',
    get: () => undefined,
  }, peers)
  const args = capture.args
  const descriptor = args.models[0]

  // 端到端：adapter api 的 stream 包装 options.fetch，wrapStream 提供请求选项
  const upstream = async (input, init) => {
    requests.push({ input, init })
    return new Response('{}', { status: 200 })
  }
  const source = args.api.stream(descriptor, {}, { fetch: upstream })
  const chunks = []
  for await (const chunk of args.wrapStream(source, { reasoningEffort: 'high', model: 'm1' })) {
    chunks.push(chunk)
  }
  assert.deepEqual(chunks, [{ type: 'done', status: 200 }])
  assert.equal(requests.length, 1)
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    model: 'm1', reasoning_effort: 'high', _row: 'm1',
  })

  // 同一链路打到错误地址 → 流抛出校验错误
  const bad = args.api.stream(
    { ...descriptor, baseUrl: 'https://evil.example.com' }, {}, { fetch: upstream })
  await assert.rejects(async () => {
    for await (const chunk of args.wrapStream(bad, { reasoningEffort: 'high', model: 'm1' })) void chunk
  }, { message: 'Agnes 请求地址无效' })
})

test('createApiKeyAdapter：providerId 显式覆盖 spec.id', async () => {
  const capture = {}
  await createApiKeyAdapter({
    spec: makeSpec({ id: 'unisound', title: '云知声' }),
    rows: [makeRow({ id: 'u2-flash' })],
    resolveKey: async () => 'k',
    providerId: 'unisound-cn',
  }, stubPeers(capture))
  assert.equal(capture.args.providerId, 'unisound-cn')
  assert.equal(capture.args.models[0].provider, 'unisound-cn')
  assert.equal(capture.args.displayName, '云知声')
  assert.equal(capture.args.apiKeyName, '云知声 API Key')
})

test('makeStreamWrapper 向流内传递请求选项并透传 chunk', async () => {
  const requestContext = new AsyncLocalStorage()
  const wrapStream = makeStreamWrapper(requestContext)
  let observed
  const source = (async function* () {
    observed = requestContext.getStore()
    yield { type: 'text' }
    yield { type: 'done' }
  })()
  const out = []
  for await (const chunk of wrapStream(source, { reasoningEffort: 'low' })) out.push(chunk)
  assert.deepEqual(out, [{ type: 'text' }, { type: 'done' }])
  assert.deepEqual(observed, { reasoningEffort: 'low' })
})
