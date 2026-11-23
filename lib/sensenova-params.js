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

// 自管目录、宿主预算和推理描述符共用这两个值。旧覆盖不重写原文件，但不能挤掉整个输入窗口。
export function modelTokenBudget(params, defaults, hardCap = null) {
  const contextWindow = params.contextWindow > 1 ? params.contextWindow : Math.max(2, defaults.defaultContextWindow)
  const maxOutputLength = Math.min(params.maxTokens ?? defaults.defaultMaxOutputLength, hardCap ?? Infinity, contextWindow - 1)
  return { contextWindow, maxOutputLength }
}

export function validateModelBudgetPatch(previous, patch, defaults, hardCap = null) {
  if (patch.maxTokens == null && patch.contextWindow == null) return
  const next = { ...previous, ...patch }
  const context = next.contextWindow ?? defaults.defaultContextWindow
  const output = Math.min(next.maxTokens ?? defaults.defaultMaxOutputLength, hardCap ?? Infinity)
  if (patch.maxTokens != null && hardCap !== null && patch.maxTokens > hardCap) throw new Error('输出上限超出渠道限制')
  if (context <= 1 || output >= context) throw new Error('输出上限须小于上下文窗口')
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
