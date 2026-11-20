// 自管多账号渠道共用的推理适配器装配器：
// 支持标准 OpenAI Completions / OpenAI Responses / Anthropic Messages，
// 以及渠道自定义流式协议（spec.stream）；多账号按健康队列轮询，单号失败可自动回退。
import { AsyncLocalStorage } from 'node:async_hooks'
import { PLAN_EFFORTS } from './sensenova-params.js'

let peers
async function loadPeers() {
  if (peers) return peers
  const [
    { t: assemblePiAiAdapter },
    { openAICompletionsApi },
    { anthropicMessagesApi },
    responsesMod,
  ] = await Promise.all([
    import('../vendor/sensenova-token-plan/llm-adapter-core.js'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
    import('@earendil-works/pi-ai/api/anthropic-messages.lazy'),
    import('@earendil-works/pi-ai/api/openai-responses.lazy').catch(() => null),
  ])
  peers = {
    assemblePiAiAdapter,
    openAICompletionsApi,
    anthropicMessagesApi,
    openAIResponsesApi: responsesMod?.openAIResponsesApi ?? null,
  }
  return peers
}

function protocolOf(row, spec) {
  const declared = row.protocol || row.api?.protocol || spec.protocol || 'openai-completions'
  if (['openai-completions', 'openai-responses', 'anthropic-messages'].includes(declared)) return declared
  if (row.api?.npm === '@ai-sdk/anthropic') return 'anthropic-messages'
  if (row.api?.npm === '@ai-sdk/openai-responses') return 'openai-responses'
  return 'openai-completions'
}

function rateBadgeOf(row) {
  if (row.free === true) return { text: { zh: '免费', en: 'Free' }, tone: 'success' }
  if (row.rate && typeof row.rate === 'object' && typeof row.rate.label === 'string') {
    return { text: { zh: row.rate.label, en: row.rate.label }, tone: row.rate.tone || 'neutral' }
  }
  if (Number.isFinite(row.rate) && row.rate > 0) {
    const label = `x${row.rate % 1 === 0 ? row.rate.toFixed(0) : Number(row.rate.toFixed(2))}`
    return { text: { zh: label, en: label }, tone: Number.isFinite(row.rateWas) && row.rateWas > row.rate ? 'info' : 'neutral' }
  }
  return undefined
}

export function toManagedModelDescriptor(row, providerId, spec) {
  const api = protocolOf(row, spec)
  const efforts = Array.isArray(row.efforts) ? row.efforts : []
  const baseUrl = row.api?.url || (typeof spec.baseUrlFor === 'function' ? spec.baseUrlFor(row, api) : spec.baseUrl) || 'https://localhost.invalid/v1'
  const badge = rateBadgeOf(row)
  const baseCompat = api === 'openai-completions'
    ? { supportsDeveloperRole: false, maxTokensField: 'max_tokens', ...(spec.compat ?? {}), ...(row.params?.compat ?? {}) }
    : (row.params?.compat ? { ...row.params.compat } : undefined)
  return {
    id: row.id,
    name: row.name,
    api,
    provider: providerId,
    baseUrl,
    reasoning: efforts.length > 0 || row.reasoning === true,
    thinkingLevelMap: Object.fromEntries(PLAN_EFFORTS.map(level => [
      level, efforts.includes(level) ? level : null,
    ])),
    input: (row.vision ?? row.attachment) ? ['text', 'image'] : ['text'],
    contextWindow: row.contextWindow ?? 128_000,
    maxTokens: row.maxOutputLength ?? 32_768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(baseCompat ? { compat: baseCompat } : {}),
    ...(badge ? { badge } : {}),
  }
}

export async function createManagedAdapter({ spec, rows, selectTransport, get, providerId = spec.id }, injected) {
  const loaded = injected ?? await loadPeers()
  const { assemblePiAiAdapter, openAICompletionsApi, anthropicMessagesApi, openAIResponsesApi } = loaded
  const requestContext = new AsyncLocalStorage()
  const streams = {
    'openai-completions': openAICompletionsApi(),
    'anthropic-messages': anthropicMessagesApi(),
    ...(openAIResponsesApi ? { 'openai-responses': openAIResponsesApi() } : {}),
  }
  const enabledRows = rows.filter(row => row.enabled)
  const models = enabledRows.map(row => toManagedModelDescriptor(row, providerId, spec))
  const byId = new Map(enabledRows.map(row => [row.id, row]))

  async function* wrapStream(source, options) {
    const iterator = source[Symbol.asyncIterator]()
    try {
      while (true) {
        const next = await requestContext.run(options, () => iterator.next())
        if (next.done) return
        yield next.value
      }
    } finally { await iterator.return?.() }
  }

  const streamFor = method => (model, context, options) => {
    const request = requestContext.getStore()
    const row = byId.get(request?.model ?? model.id)
    if (typeof spec.customStream === 'function') {
      return spec.customStream({
        method, model, row, context, options, request, selectTransport,
      })
    }
    const targetApi = streams[model.api] ? model.api : 'openai-completions'
    return streams[targetApi][method](model, context, {
      ...options,
      async fetch(input, init) {
        const tried = new Set()
        let nextTransport = await selectTransport(model.id, request, tried)
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const transport = nextTransport
          tried.add(transport.accountId)
          const response = await transport.fetch(input, init, { model, row, request })
          if (response?.status === 429) {
            const retryAfter = Number(response.headers?.get?.('retry-after'))
            transport.markRateLimited?.(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000)
            if (attempt < 2) {
              // 先确认池内确有下一个可用账号，再取消当前 429 响应体；单账号或池耗尽时保留原始 429 响应体可读。
              const candidate = await selectTransport(model.id, request, tried).catch(() => null)
              if (candidate) {
                try { await response.body?.cancel?.() } catch {}
                nextTransport = candidate
                continue
              }
            }
          }
          return response
        }
      },
    })
  }

  return assemblePiAiAdapter({
    providerId,
    displayName: spec.title,
    apiKeyName: `${spec.title} 账号`,
    models,
    get,
    wrapStream,
    resolveCredential: async () => providerId,
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
    modelEfforts: new Map(enabledRows.map(row => [row.id, row.effectiveEffort])),
    requestDefaults: options => {
      const row = byId.get(options.model)
      const short = options.maxTokens > 0 && options.maxTokens <= 1024
      const reasoningEffort = options.reasoningEffort ?? (short
        ? (row?.efforts?.includes('off') ? 'off' : undefined)
        : row?.effectiveEffort)
      return reasoningEffort === undefined ? options : { ...options, reasoningEffort }
    },
    api: { stream: streamFor('stream'), streamSimple: streamFor('streamSimple') },
  })
}
