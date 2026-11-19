import { AsyncLocalStorage } from 'node:async_hooks'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { t as assemblePiAiAdapter } from '../vendor/sensenova-token-plan/llm-adapter-core.js'
import { PLAN_EFFORTS } from './sensenova-params.js'

export function createWorkBuddyAdapter({ catalog, getFetch, get, sessionHeader, providerId, endpoint }) {
  const requestContext = new AsyncLocalStorage()
  const streams = {
    'openai-completions': openAICompletionsApi(),
    'anthropic-messages': anthropicMessagesApi(),
  }
  const models = catalog.filter(row => row.enabled).map(row => {
    const native = row.api?.npm === '@ai-sdk/anthropic'
    return {
      id: row.id, name: row.name, api: native ? 'anthropic-messages' : 'openai-completions',
      provider: providerId, baseUrl: endpoint + (native ? '/v1' : '/v2'),
      reasoning: row.efforts.length > 0,
      thinkingLevelMap: Object.fromEntries(PLAN_EFFORTS.map(level => [
        level, row.efforts.includes(level) ? level : null,
      ])),
      input: row.vision ? ['text', 'image'] : ['text'],
      contextWindow: row.contextWindow ?? 128_000, maxTokens: row.maxOutputLength ?? 32_768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: native ? undefined : { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    }
  })

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
    return streams[model.api][method](model, context, {
      ...options,
      async fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : input)
        const native = model.api === 'anthropic-messages'
        const path = native ? '/v1/messages' : '/v2/chat/completions'
        if (url.origin !== endpoint || url.pathname !== path) throw new Error('WorkBuddy 请求地址无效')
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        if (request?.sessionId != null) headers.set(sessionHeader, String(request.sessionId).slice(0, 128))
        let body = init?.body
        if (!native && request?.reasoningEffort === 'off') {
          body ??= input instanceof Request ? await input.clone().text() : undefined
          body = JSON.stringify({ ...JSON.parse(body), reasoning_effort: 'none' })
        }
        const fetch = await getFetch()
        return fetch(input, { ...init, headers, ...(body === undefined ? {} : { body }) })
      },
    })
  }
  const byId = new Map(catalog.map(row => [row.id, row]))
  const built = assemblePiAiAdapter({
    providerId, displayName: 'WorkBuddy', apiKeyName: 'WorkBuddy 登录',
    models, get, wrapStream,
    // pi-ai requires a key to build SDK headers. The WorkBuddy transport replaces it.
    resolveCredential: async () => 'workbuddy',
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
    modelEfforts: new Map(catalog.map(row => [row.id, row.effectiveEffort])),
    requestDefaults: options => {
      const row = byId.get(options.model)
      const short = options.maxTokens > 0 && options.maxTokens <= 1024
      const reasoningEffort = options.reasoningEffort ?? (short
        ? row?.efforts.includes('off') ? 'off' : undefined
        : row?.effectiveEffort)
      return reasoningEffort === undefined ? options : { ...options, reasoningEffort }
    },
    api: { stream: streamFor('stream'), streamSimple: streamFor('streamSimple') },
  })
  return built
}
