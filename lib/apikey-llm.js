import { AsyncLocalStorage } from 'node:async_hooks'
import { PLAN_EFFORTS } from './sensenova-params.js'

/**
 * API Key 类渠道（Agnes / 云知声）的推理适配器，契约见 docs/APIKEY-CHANNELS.md。
 *
 * 与 workbuddy-llm.js 同构：pi-ai 描述符、AsyncLocalStorage 传递请求选项、
 * 自定义 fetch 校验请求地址并按 spec.effortBody 合并思考字段。全部渠道差异都
 * 收敛进 spec，本文件不落地任何厂商名与地址。
 *
 * peer（pi-ai / dsh-llm / dsh-llm-pi-ai 经 vendor 的 llm-adapter-core）随宿主
 * 分发、仓库内不可解析，因此本模块顶层不静态引用它们：纯函数全部可离线测试，
 * peer 在 createApiKeyAdapter 调用时才用动态 import() 载入——与 workbuddy-llm.js
 * 的静态 import 走同一条宿主解析链（宿主按插件所在位置解析 @earendil-works/pi-ai）。
 * @module dsh-unified-router/apikey-llm
 */

let peers
/** 惰性加载 peer 实现（只加载一次）。 */
async function loadPeers() {
  if (peers) return peers
  const [{ t: assemblePiAiAdapter }, { openAICompletionsApi }] = await Promise.all([
    import('../vendor/sensenova-token-plan/llm-adapter-core.js'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
  ])
  peers = { assemblePiAiAdapter, openAICompletionsApi }
  return peers
}

/**
 * 管理器快照行 → pi-ai 聊天模型描述符。
 * `vision` 是参数覆盖后的生效值，`attachment` 是目录原值；显式 vision:false
 * （supportsImage:false 参数覆盖）优先，不回退到 attachment。
 * @param {object} row - 已启用的快照行。
 * @param {string} providerId - 适配器注册的 provider id。
 * @param {string} baseUrl - spec.baseUrl，交给 pi-ai。
 */
export function toModelDescriptor(row, providerId, baseUrl) {
  const efforts = row.efforts ?? []
  return {
    id: row.id, name: row.name,
    api: 'openai-completions',
    provider: providerId, baseUrl,
    reasoning: efforts.length > 0,
    thinkingLevelMap: Object.fromEntries(PLAN_EFFORTS.map(level => [
      level, efforts.includes(level) ? level : null,
    ])),
    input: (row.vision ?? row.attachment) ? ['text', 'image'] : ['text'],
    contextWindow: row.contextWindow ?? 128_000,
    maxTokens: row.maxOutputLength ?? 32_768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
  }
}

/**
 * 请求默认值（与 workbuddy 同推导）：调用方未给 reasoningEffort 时按行填充 ——
 * 短请求（0 < maxTokens ≤ 1024）只在该行支持 'off' 时取 'off'，其余取
 * effectiveEffort；都没有则原样返回（不动 options）。
 * @param {Map<string, object>} byId - 模型 id → 快照行。
 */
export function makeRequestDefaults(byId) {
  return options => {
    const row = byId.get(options.model)
    const short = options.maxTokens > 0 && options.maxTokens <= 1024
    const reasoningEffort = options.reasoningEffort ?? (short
      ? (row?.efforts?.includes('off') ? 'off' : undefined)
      : row?.effectiveEffort)
    return reasoningEffort === undefined ? options : { ...options, reasoningEffort }
  }
}

/**
 * 与 workbuddy 相同的 AsyncLocalStorage 传递：iterator.next() 在
 * requestContext.run(options, ...) 里执行，流内触发的 fetch 才能读到
 * 当次请求选项（reasoningEffort、sessionId 等）。
 * @param {AsyncLocalStorage} requestContext - 本适配器实例的上下文。
 * @returns {(source: AsyncIterable, options: object) => AsyncGenerator}
 */
export function makeStreamWrapper(requestContext) {
  return async function* wrapStream(source, options) {
    const iterator = source[Symbol.asyncIterator]()
    try {
      while (true) {
        const next = await requestContext.run(options, () => iterator.next())
        if (next.done) return
        yield next.value
      }
    } finally { await iterator.return?.() }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 拦截 fetch 工厂：只允许请求落在 spec 声明的 origin + chatPath；请求体是
 * JSON 对象且当次请求带 reasoningEffort 时调用 spec.effortBody，把返回的
 * 普通对象浅合并进 body（同名字段以 effortBody 为准），返回 undefined 或
 * 非对象则原样放行。不设任何会话头；错误文案只含 spec.title，不带 Key。
 * @param {object} options
 * @param {object} options.spec - 渠道规格。
 * @param {Map<string, object>} options.byId - 模型 id → 快照行，给 effortBody 用。
 * @param {AsyncLocalStorage} options.requestContext - 当前请求选项来源。
 * @param {Function} options.upstream - 真正的 fetch（默认调用方从 options.fetch
 *   取，缺省回退 globalThis.fetch）。
 * @param {object} [options.model] - pi-ai 描述符，用于请求选项缺 model 时的回退。
 */
export function createApiKeyFetch({ spec, byId, requestContext, upstream, model }) {
  return async (input, init) => {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request
    const url = new URL(isRequest ? input.url : input)
    if (url.origin !== new URL(spec.endpoint).origin || url.pathname !== spec.chatPath) {
      throw new Error(`${spec.title} 请求地址无效`)
    }
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined))
    const request = requestContext.getStore()
    const effort = request?.reasoningEffort
    let body = init?.body
    if (effort != null && typeof spec.effortBody === 'function') {
      body ??= isRequest ? await input.clone().text() : undefined
      if (typeof body === 'string') {
        let parsed
        try { parsed = JSON.parse(body) } catch { parsed = undefined }
        if (isPlainObject(parsed)) {
          const row = byId.get(request.model ?? model?.id)
          const patch = spec.effortBody(effort, row)
          if (isPlainObject(patch)) body = JSON.stringify({ ...parsed, ...patch })
        }
      }
    }
    return upstream(input, { ...init, headers, ...(body === undefined ? {} : { body }) })
  }
}

/**
 * 把渠道规格与启用行装配成 pi-ai 适配器。
 * @param {object} options
 * @param {object} options.spec - 渠道规格（apikey-providers.js）。
 * @param {object[]} options.rows - 已启用的管理器快照行。
 * @param {() => Promise<string>} options.resolveKey - 按请求解析 API Key。
 * @param {(service: string) => unknown} [options.get] - 宿主服务（attachments/fs）。
 * @param {string} [options.providerId] - 缺省 spec.id。
 * @param {object} [peers] - 测试注入；缺省惰性加载宿主 peer。
 * @returns {Promise<{adapter: object, providerIds: string[]}>}
 */
export async function createApiKeyAdapter({ spec, rows, resolveKey, get, providerId = spec.id }, injected) {
  const { assemblePiAiAdapter, openAICompletionsApi } = injected ?? await loadPeers()
  const requestContext = new AsyncLocalStorage()
  const streams = { 'openai-completions': openAICompletionsApi() }
  const models = rows.map(row => toModelDescriptor(row, providerId, spec.baseUrl))
  const byId = new Map(rows.map(row => [row.id, row]))
  const wrapStream = makeStreamWrapper(requestContext)

  const streamFor = method => (model, context, options) => {
    const upstream = options?.fetch ?? ((input, init) => globalThis.fetch(input, init))
    return streams[model.api][method](model, context, {
      ...options,
      fetch: createApiKeyFetch({ spec, byId, requestContext, upstream, model }),
    })
  }

  return assemblePiAiAdapter({
    providerId,
    displayName: spec.title,
    apiKeyName: `${spec.title} API Key`,
    models, get, wrapStream,
    resolveCredential: () => resolveKey(),
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
    modelEfforts: new Map(rows.map(row => [row.id, row.effectiveEffort])),
    requestDefaults: makeRequestDefaults(byId),
    api: { stream: streamFor('stream'), streamSimple: streamFor('streamSimple') },
  })
}
