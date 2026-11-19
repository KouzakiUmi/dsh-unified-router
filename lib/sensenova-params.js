export const PLAN_COMPAT_FIELDS = Object.freeze({
  maxTokensField: ['max_tokens', 'max_completion_tokens'],
  supportsStore: null,
  supportsDeveloperRole: null,
  supportsUsageInStreaming: null,
  supportsReasoningEffort: null,
  requiresToolResultName: null,
  requiresAssistantAfterToolResult: null,
  requiresThinkingAsText: null,
  requiresReasoningContentOnAssistantMessages: null,
  supportsStrictMode: null,
  thinkingFormat: ['openai', 'deepseek', 'qwen', 'qwen-chat-template', 'zai'],
})

export const PLAN_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const modelTokenValue = value => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validators = {
  maxTokens: modelTokenValue,
  contextWindow: modelTokenValue,
  supportsImage: value => typeof value === 'boolean',
  reasoningEffort: value => PLAN_EFFORTS.includes(value),
}

function compatValue(field, value) {
  if (!Object.hasOwn(PLAN_COMPAT_FIELDS, field)) return false
  const choices = PLAN_COMPAT_FIELDS[field]
  return choices ? choices.includes(value) : typeof value === 'boolean'
}

export function normalizePlanParams(source) {
  if (!object(source)) return {}
  const result = Object.fromEntries(Object.entries(validators).flatMap(([field, valid]) =>
    Object.hasOwn(source, field) && (source[field] === null || valid(source[field])) ? [[field, source[field]]] : []))
  if (source.compat === null) result.compat = null
  else if (object(source.compat)) result.compat = Object.fromEntries(Object.entries(source.compat).filter(([field, value]) => compatValue(field, value)))
  return result
}

export function validatePlanParams(source) {
  const params = normalizePlanParams(source)
  if (!object(source) || !Object.keys(source).length || Object.keys(source).length !== Object.keys(params).length ||
      object(source.compat) && Object.keys(params.compat).length !== Object.keys(source.compat).length) {
    throw new Error('模型参数无效')
  }
  return params
}

export function normalizePlanParamMap(source) {
  return Object.fromEntries(Object.entries(source ?? {}).flatMap(([id, params]) =>
    id && id.length <= 256 && id.trim() === id && !['__hide_all__', '__proto__', 'constructor', 'prototype'].includes(id)
      && object(params) ? [[id, normalizePlanParams(params)]] : []))
}

export function applyPlanDescriptor(descriptor, params) {
  if (!params) return descriptor
  return {
    ...descriptor,
    ...(params.contextWindow != null ? { contextWindow: params.contextWindow } : {}),
    ...(params.supportsImage != null ? { input: params.supportsImage ? ['text', 'image'] : ['text'] } : {}),
    ...(params.compat ? { compat: { ...descriptor.compat, ...params.compat } } : {}),
  }
}

export function planRequestDefaults(options, params, efforts) {
  if (options.reasoningEffort !== undefined || !params?.reasoningEffort || !efforts.includes(params.reasoningEffort)) return options
  return { ...options, reasoningEffort: params.reasoningEffort }
}
