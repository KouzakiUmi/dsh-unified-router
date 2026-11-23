// 测试专用 peer 桩：只用于 `test/model-rate-badge-paths.test.mjs` 的离线装配。
//
// 形状按本机 DSH 0.2.2-rc.3 的实际实现裁剪：
// - `PiAiAdapter.listModels()` **只回 provider / id / name / inputModalities**
//   （`node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`，这正是模型描述符上的
//   `badge` 到不了会话选择器、必须在适配器外层补的原因）；
// - `resolveModel()` 同样只回基础身份/能力字段（核心还会再归一化一次并剥掉 badge）。
//
// 流方法只记录送入真实协议层前的请求参数，不模拟 SDK 序列化或网络。

export class LlmAdapter {}

export class LlmError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

export const credentialRef = value => value
export const isQuotaExceededError = error => error?.code === 'QUOTA_EXCEEDED'
export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED'
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'

export function createProvider({ id, name, models }) {
  return { id, name, models, getModels: () => models }
}

export function getSupportedThinkingLevels(model) {
  if (!model.reasoning) return ['off']
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter(level => {
    const value = model.thinkingLevelMap?.[level]
    return value !== null && (value !== undefined || (level !== 'xhigh' && level !== 'max'))
  })
}

export const openAICompletionsApi = () => ({ stream() {}, streamSimple() {} })
export const anthropicMessagesApi = () => ({ stream() {}, streamSimple() {} })

export const resolveImageAttachmentAccess = () => undefined
export const resolveRetryPolicy = config => config

/** `@deepseek-ai/dsh-llm-pi-ai` 的最小实现（只保留目录/身份相关方法）。 */
export class PiAiAdapter {
  constructor(parts) { this.parts = parts }

  profileOf(provider) {
    const profile = this.parts.profiles().get(provider)
    if (profile === undefined) throw new LlmError(`no provider ${provider}`, 'NO_ADAPTER')
    return profile
  }

  providerInfo(provider) {
    return { id: provider, name: this.profileOf(provider).displayName }
  }

  providerRetryPolicy(provider) {
    return this.profileOf(provider).retryPolicy
  }

  listModels(provider) {
    const profile = this.profileOf(provider)
    // ⚠️ 与真实实现同形状：`badge` 在这一步被丢弃。
    return Promise.resolve(profile.piProvider.getModels().map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: [...(model.input ?? ['text'])],
    })))
  }

  resolveModel(provider, model) {
    const resolved = this.profileOf(provider).piProvider.getModels().find(entry => entry.id === model)
    if (resolved === undefined) throw new LlmError(`no model ${model}`, 'UNKNOWN_MODEL')
    return Promise.resolve({
      provider,
      id: model,
      name: resolved.name,
      inputModalities: [...(resolved.input ?? ['text'])],
      context: { contextWindow: resolved.contextWindow ?? 128_000 },
      ...(resolved.reasoning ? { reasoning: { efforts: getSupportedThinkingLevels(resolved).map(id => ({ id })) } } : {}),
    })
  }

  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) }
  }

  async *stream(options) {
    const model = this.profileOf(options.provider).piProvider.getModels().find(entry => entry.id === options.model)
    const effort = options.reasoningEffort
    if (effort !== undefined && !getSupportedThinkingLevels(model).includes(effort)) {
      throw new LlmError('invalid thinking level', 'UNSUPPORTED_REASONING_EFFORT')
    }
    yield { options }
  }
}
