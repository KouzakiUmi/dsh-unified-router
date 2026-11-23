import { AsyncLocalStorage } from 'node:async_hooks'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { t as assemblePiAiAdapter } from '../vendor/sensenova-token-plan/llm-adapter-core.js'
import { PLAN_EFFORTS } from './sensenova-params.js'
import { rateBadgeIndex, withListedRateBadges } from './rate-badge.js'

export function createWorkBuddyAdapter({ catalog, getFetch, get, sessionHeader, providerId, endpoint }) {
  const requestContext = new AsyncLocalStorage()
  const streams = {
    'openai-completions': openAICompletionsApi(),
    'anthropic-messages': anthropicMessagesApi(),
  }
  // 启用行上的倍率/免费证据（上游 `provider.models` 的 `free` / `rate` / `rateWas`，
  // 语义见 vendor/workbuddy 的 `priceOf`：rate 是 credits 倍数，x0.00 即免费）。
  const badges = rateBadgeIndex(catalog.filter(row => row.enabled))
  const models = catalog.filter(row => row.enabled).map(row => {
    const native = row.api?.npm === '@ai-sdk/anthropic'
    const efforts = Array.isArray(row.efforts) ? PLAN_EFFORTS.filter(level => row.efforts.includes(level)) : []
    return {
      id: row.id, name: row.name, api: native ? 'anthropic-messages' : 'openai-completions',
      provider: providerId, baseUrl: endpoint + (native ? '/v1' : '/v2'),
      reasoning: efforts.length > 0,
      thinkingLevelMap: Object.fromEntries(PLAN_EFFORTS.map(level => [
        level, efforts.includes(level) ? level : null,
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
  const built = assemblePiAiAdapter({
    providerId, displayName: 'WorkBuddy', apiKeyName: 'WorkBuddy 登录',
    models, get, wrapStream,
    // pi-ai requires a key to build SDK headers. The WorkBuddy transport replaces it.
    resolveCredential: async () => 'workbuddy',
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
    modelEfforts: new Map(catalog.map(row => [row.id, row.effectiveEffort])),
    api: { stream: streamFor('stream'), streamSimple: streamFor('streamSimple') },
  })
  // 会话模型名旁的倍率/免费徽标：`PiAiAdapter.listModels()` 只回
  // provider/id/name/inputModalities，模型描述符上的字段到不了选择器，
  // 故在适配器外层按同一份目录行补（未知模型不给徽标）。
  return {
    ...built,
    adapter: withListedRateBadges(built.adapter, id => badges.get(id)),
  }
}
