// Unified Router 设置页。通过 DSH 设置插槽显示，也可由 dsh-go 的 Web 设置岛承载。
// React useEffect cleanup follows react.dev/learn/synchronizing-with-effects.
// 本文件由 scripts/build.mjs 从 src/client/*.js 拼接生成，不要直接编辑。
window.__ModuleLoader__.load({
  id: 'dsh-unified-router',
  factory: require => {
    const React = require('react')
    const h = React.createElement
// ── src/client/../../lib/sensenova-params.js ──
const PLAN_COMPAT_FIELDS = Object.freeze({
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

const PLAN_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const modelTokenValue = value => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000

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

function normalizePlanParams(source) {
  if (!object(source)) return {}
  const result = Object.fromEntries(Object.entries(validators).flatMap(([field, valid]) =>
    Object.hasOwn(source, field) && (source[field] === null || valid(source[field])) ? [[field, source[field]]] : []))
  if (source.compat === null) result.compat = null
  else if (object(source.compat)) result.compat = Object.fromEntries(Object.entries(source.compat).filter(([field, value]) => compatValue(field, value)))
  return result
}

function validatePlanParams(source) {
  const params = normalizePlanParams(source)
  if (!object(source) || !Object.keys(source).length || Object.keys(source).length !== Object.keys(params).length ||
      object(source.compat) && Object.keys(params.compat).length !== Object.keys(source.compat).length) {
    throw new Error('模型参数无效')
  }
  return params
}

function normalizePlanParamMap(source) {
  return Object.fromEntries(Object.entries(source ?? {}).flatMap(([id, params]) =>
    id && id.length <= 256 && id.trim() === id && !['__hide_all__', '__proto__', 'constructor', 'prototype'].includes(id)
      && object(params) ? [[id, normalizePlanParams(params)]] : []))
}

function applyPlanDescriptor(descriptor, params) {
  if (!params) return descriptor
  return {
    ...descriptor,
    ...(params.contextWindow != null ? { contextWindow: params.contextWindow } : {}),
    ...(params.supportsImage != null ? { input: params.supportsImage ? ['text', 'image'] : ['text'] } : {}),
    ...(params.compat ? { compat: { ...descriptor.compat, ...params.compat } } : {}),
  }
}

function planRequestDefaults(options, params, efforts) {
  if (options.reasoningEffort !== undefined || !params?.reasoningEffort || !efforts.includes(params.reasoningEffort)) return options
  return { ...options, reasoningEffort: params.reasoningEffort }
}

// ── src/client/../../lib/model-catalog.js ──
const modelBrands = {
  claude: 'Claude', deepseek: 'DeepSeek', doubao: 'Doubao', gemini: 'Gemini', glm: 'GLM',
  gpt: 'GPT', grok: 'Grok', hy: 'Hy', kimi: 'Kimi', llama: 'Llama', mimo: 'MiMo', minimax: 'MiniMax', qwen: 'Qwen',
  sensenova: 'SenseNova', spark: 'Spark', codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy',
  api: 'API', vl: 'VL', vllm: 'vLLM',
}

const modelAliases = new Map([
  ['qmodel_38max', 'Qwen 3.8 Max'], ['qmodel_latest', 'Qwen 3.8 Max'],
  ['qfmodel', 'Qwen 3.8 Flash'], ['dmodel', 'DeepSeek V4 Pro'], ['dfmodel', 'DeepSeek Flash'],
  ['gmodel', 'GLM 5.3'], ['gfmodel', 'GLM 5.3 Flash'], ['kmodel_latest', 'Kimi K3.1 Pro'],
  ['kmodel', 'Kimi K2.8 Preview'], ['mmodel', 'MiniMax M3.1 Flash'],
  ['hy4std', 'Hy4'], ['hy4flash', 'Hy4 Flash'], ['hy4flash-free', 'Hy4 Flash'],
])
const gluedBrands = /^(qwen|glm|gpt|llama|grok|gemini)(?=\d)/i

function readableModelName(id, name) {
  const source = (typeof name === 'string' && name.trim()) || (typeof id === 'string' && id.trim()) || ''
  const alias = modelAliases.get(source.toLowerCase())
  if (alias) return alias
  const repeatedId = source.endsWith(')') ? source.lastIndexOf(' (') : -1
  const label = repeatedId >= 0 && source.slice(repeatedId + 2, -1).toLowerCase() === id?.toLowerCase()
    ? source.slice(0, repeatedId) : source
  return label.split(/\s+/).map(part => {
    let slug = part
    // Provider-qualified IDs and Raccoon's subscription suffix only affect routing.
    if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(slug)) slug = slug.slice(slug.indexOf('/') + 1)
    slug = slug.replace(/^sn-(sensenova|qwen|glm|kimi|deepseek)(.*?)(?:-p)?$/i, '$1$2')
    if (/^[a-z0-9.]+(?:[-_][a-z0-9.]+)+$/i.test(slug) || gluedBrands.test(slug)) {
      return slug.replace(/(?<=\d)[-_](?=\d{1,2}(?:[-_]|$))/g, '.')
        .replace(gluedBrands, '$1 ')
        .split(/[-_ ]+/)
        .map(word => Object.hasOwn(modelBrands, word.toLowerCase()) ? modelBrands[word.toLowerCase()] : word[0].toUpperCase() + word.slice(1))
        .join(' ')
    }
    return Object.hasOwn(modelBrands, slug.toLowerCase()) ? modelBrands[slug.toLowerCase()] : slug
  }).join(' ')
}

function defaultModelOutputTokens(output, context) {
  if (Number.isSafeInteger(output) && output > 0) return output
  return Number.isSafeInteger(context) && context > 0 ? Math.min(context, 32_768) : 32_768
}

function defaultModelEffort(efforts, declared, preferred = 'medium') {
  if (efforts.includes(declared)) return declared
  if (efforts.includes(preferred)) return preferred
  return efforts.find(effort => effort !== 'off') ?? efforts[0]
}

function modelIdentity(value) {
  return value.toLowerCase().replace(/^sn-(.*?)(?:-p)?$/, '$1')
    .replace(/[._]+/g, '-').replace(/^qwen(?=\d)/, 'qwen-').replace(/^doubao-seed(?=-)/, 'seed')
}

// Only routing IDs can identify a model. Identical display names may be separate
// deployments, aliases or account tiers. Keep ambiguous aliases provider-scoped.
const catalogIdentities = {
  loomy: { 'deepseek-v4-flash-1017': 'deepseek-v4-1-flash-1017' },
  qodercn: {
    qmodel_38max: 'qwen-3-8-max', qfmodel: 'qwen-3-8-flash',
    dmodel: 'deepseek-v4-pro', dfmodel: 'deepseek-flash',
    gmodel: 'glm-5-3', gfmodel: 'glm-5-3-flash', kmodel_latest: 'kimi-k3-1-pro',
    kmodel: 'kimi-k2-8-preview', mmodel: 'minimax-m3-1-flash',
  },
  trae: { 'deepseek-v4-pro-official': 'deepseek-v4-pro-0813' },
  workbuddy: { 'deepseek-v4-pro': 'deepseek-v4-pro-0813', 'kimi-k3-1': 'kimi-k3' },
  'sensenova-token-plan': { 'deepseek-flash': 'deepseek-v4-1-flash-1017' },
}

function catalogIdentity(id, provider) {
  const aliases = Object.hasOwn(catalogIdentities, provider) ? catalogIdentities[provider] : {}
  return Object.hasOwn(aliases, id.toLowerCase()) ? aliases[id.toLowerCase()] : modelIdentity(id)
}

function modelGeneration(value) {
  const match = /^(sensenova|deepseek|qwen|glm|kimi|minimax|mimo|claude|gemini|gpt|spark|seed|step|llama|grok|gemma)[-_]?((?:opus|sonnet|haiku)[-_])?([kmvx]?)(\d+)(?:[.-](\d{1,2})(?!\d))?(?:[.-](\d{1,2})(?!\d))?(.*)$/i.exec(value)
  if (!match) return null
  const [, brand, series = '', prefix, major, minor, patch, tail] = match
  const release = /-(\d{4}|\d{8})$/.exec(tail)?.[1]
  const preview = /(?:^|-)preview(?:-|$)/.test(tail)
  const variant = tail.replace(/-\d{4,8}$/, '').replace(/-preview$/, '')
  return { group: [brand.toLowerCase(), series.toLowerCase(), prefix.toLowerCase(), variant].join('/'),
    version: Number(major) * 10000 + Number(minor ?? 0) * 100 + Number(patch ?? 0),
    preview, release }
}

// Catalog-confirmed replacements where the new generation's name gained a tier.
const namedSuccessors = new Map([
  ['kimi-k2-8-preview', 'kimi-k3-1-pro'], ['kimi-k3', 'kimi-k3-1-pro'], ['minimax-m3', 'minimax-m3-1-flash'],
  ['deepseek-v4-flash', 'deepseek-v4-1-flash-1017'],
  ['deepseek-v4-1-flash', 'deepseek-v4-1-flash-1017'],
])

function modelSuccessors(models, provider) {
  const groups = new Map()
  const byName = new Map()
  for (const model of models) {
    if (model.dead) continue
    const name = catalogIdentity(model.id, provider)
    const generation = modelGeneration(name)
    if (!model.stale) byName.set(name, model.id)
    if (!generation) continue
    const group = groups.get(generation.group) ?? []
    group.push({ ...generation, id: model.id, name, stale: model.stale === true })
    groups.set(generation.group, group)
  }
  const result = new Map()
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => b.version - a.version || Number(a.preview) - Number(b.preview)
      || (b.release ?? '').localeCompare(a.release ?? ''))
    for (const item of sorted) {
      const newer = sorted.find(candidate => !candidate.stale && (item.preview || !candidate.preview)
        && (candidate.version > item.version || candidate.version === item.version
          && (item.preview && !candidate.preview || candidate.release?.length === item.release?.length
            && candidate.release > item.release)))
      const replacement = newer?.id ?? byName.get(namedSuccessors.get(item.name))
      if (replacement) result.set(item.id, replacement)
    }
  }
  return result
}

// Comparable coding alternatives, backed by the dated evidence in MODEL-CURATION.md.
// These are directional comparisons for default selection, not a global model ranking.
const codingAlternatives = new Map([
  ['deepseek-v4-pro-0813', ['deepseek-v4-1-flash-1017', 'deepseek-v4-1-flash']],
  ['deepseek-v4-pro', ['deepseek-flash']],
  ['glm-5-3', ['qwen-4-max', 'deepseek-v4-1-flash-1017', 'deepseek-v4-1-flash', 'glm-5-3-flash', 'mimo-v2-6-pro']],
  ['glm-5-3-flashx', ['glm-5-3-flash']],
  ['step-5-preview', ['deepseek-v4-1-flash-1017', 'glm-5-3', 'glm-5-3-flash', 'mimo-v2-6-pro']],
  ['kimi-k3-1-pro-highspeed', ['kimi-k3-1-pro']],
  ['mimo-v2-5', ['deepseek-v4-1-flash-1017', 'glm-5-3-flash']],
])

function modelMultiplier(model) {
  const label = model.rate?.label ?? model.rateBadge?.text?.zh
  if (label === '免费') return 0
  const rate = typeof model.rate === 'number' ? model.rate : model.rate?.multiplier
  if (rate >= 0 && Number.isFinite(rate)) return rate
  const multiplier = /^(?:参考 )?x(\d+(?:\.\d+)?)$/.exec(label ?? '')
  if (multiplier) return Number(multiplier[1])
  if (model.free === true || model.isFree === true) return 0
}

// The browser and all reset handlers use the same catalog and reasons. Compare
// only within a provider and against alternatives that survive the age filter.
function modelRecommendationExclusions(models, provider) {
  const older = modelSuccessors(models, provider)
  const exclusions = new Map()
  const candidates = []
  for (const model of models) {
    if (model.dead) continue
    if (older.has(model.id) || model.stale) {
      exclusions.set(model.id, { kind: 'older', alternative: older.get(model.id) })
      continue
    }
    const rate = modelMultiplier(model)
    const context = Object.hasOwn(model, 'context') ? model.context : model.defaultContextWindow ?? model.contextWindow
    if (rate !== undefined) candidates.push({
      id: model.id, identity: catalogIdentity(model.id, provider), rate, context,
      image: Object.hasOwn(model, 'attachment') ? model.attachment : model.defaultVision ?? model.supportsImage,
    })
  }
  candidates.sort((a, b) => a.rate - b.rate)
  for (const item of candidates) {
    if (item.rate === 0) continue
    const alternatives = codingAlternatives.get(item.identity)
    if (!alternatives) continue
    const better = candidates.find(other => alternatives.includes(other.identity)
      && !exclusions.has(other.id) && other.rate <= item.rate * 2 / 3
      && other.context >= (item.context > 0 ? item.context : 1_000_000)
      && (item.image === false || other.image === true || item.image == null && other.image == null))
    if (better) exclusions.set(item.id, { kind: 'value', alternative: better.id })
  }
  return exclusions
}

// 官方模型口径规格表（单一真相源，证据见 docs/MODEL-SPECS.md）：
// 仅登记官方/一手资料明确公布的 context 与 maxOutput；未知型号不编造。
const OFFICIAL_MODEL_SPECS = Object.freeze({
  'kimi-k3-1-pro': { context: 1_048_576, maxOutput: 1_048_576 },
  'kimi-k3-1-pro-highspeed': { context: 1_048_576, maxOutput: 1_048_576 },
  'kimi-k3': { context: 1_048_576, maxOutput: 1_048_576 },
  'kimi-k2-8-preview': { context: 1_048_576, maxOutput: 1_048_576 },
  'kimi-k2-7-code': { context: 262_144, maxOutput: 262_144 },
  'deepseek-v4-1-flash': { context: 1_048_576, maxOutput: 393_216 },
  'deepseek-v4-1-flash-1017': { context: 1_048_576, maxOutput: 393_216 },
  'deepseek-v4-1-flash-economy': { context: 1_048_576, maxOutput: 393_216 },
  'deepseek-v4-pro': { context: 1_048_576, maxOutput: 393_216 },
  'deepseek-v4-pro-0813': { context: 1_048_576, maxOutput: 393_216 },
  'deepseek-v4-flash': { context: 1_048_576, maxOutput: 393_216 },
  'glm-5-3': { context: 1_048_576, maxOutput: 131_072 },
  'glm-5-3-flash': { context: 1_048_576, maxOutput: 131_072 },
  'glm-5-3-flashx': { context: 1_048_576, maxOutput: 131_072 },
  'glm-5-2': { context: 1_048_576, maxOutput: 131_072 },
  'glm-5-1': { context: 202_745, maxOutput: 131_072 },
  'qwen-4-max': { context: 1_000_000, maxOutput: 262_144 },
  'qwen-3-8-max': { context: 1_000_000, maxOutput: 131_072 },
  'qwen-3-8-flash': { context: 1_000_000, maxOutput: 131_072 },
  'qwen-3-7-plus': { context: 1_000_000, maxOutput: 131_072 },
  'seed-2-1-pro': { context: 1_048_576, maxOutput: 262_144 },
  'seed-2-1-turbo': { context: 256_000, maxOutput: 262_144 },
  'seed-2-1-lite': { context: 1_048_576, maxOutput: 262_144 },
  'seed-evolving': { context: 1_048_576, maxOutput: 262_144 },
  'seed-code': { context: 256_000, maxOutput: 131_072 },
  'seed-2-0-code': { context: 262_144, maxOutput: 131_072 },
  'doubao-2-0-mini': { context: 262_144, maxOutput: 131_072 },
  'minimax-m3-1-flash': { context: 1_000_000, maxOutput: 524_288 },
  'minimax-m3': { context: 1_000_000, maxOutput: 131_072 },
  'mimo-v2-6-pro': { context: 1_000_000, maxOutput: 131_072 },
  'mimo-v2-6-flash': { context: 1_000_000, maxOutput: 131_072 },
  'spark-x2-6': { context: 1_048_576, maxOutput: 131_072 },
  'spark-x2-6-4b': { context: 1_048_576, maxOutput: 131_072 },
  'sensenova-6-8-flash': { context: 1_048_576, maxOutput: 131_072 },
  'sensenova-6-8-flash-lite': { context: 1_048_576, maxOutput: 65_536 },
  hy4std: { context: 1_024_000, maxOutput: 65_536 },
  hy4flash: { context: 1_024_000, maxOutput: 65_536 },
  'hy4flash-free': { context: 1_024_000, maxOutput: 65_536 },
  'step-5-preview': { context: 1_048_576, maxOutput: 65_536 },
  'openpangu-2-0-pro': { context: 524_288, maxOutput: 131_072 },
  'openpangu-2-0-flash': { context: 524_288, maxOutput: 131_072 },
  'openpangu-2-1-pro': { context: 524_288, maxOutput: 393_216 },
  'agnes-2-5-flash': { context: 524_288, maxOutput: 65_536 },
  'agnes-3-0-flash': { context: 524_288, maxOutput: 65_536 },
  'agnes-2-5-pro': { context: 1_048_576, maxOutput: 65_536 },
  'agnes-2-5-pro-alpha': { context: 1_048_576, maxOutput: 65_536 },
  'agnes-2-5-pro-beta': { context: 1_048_576, maxOutput: 65_536 },
  'u2-flash': { context: 1_048_576, maxOutput: 131_072 },
})

// 经实测确认的渠道协议硬上限（超过此值上游必拒 400，不得生成超限档位按钮）。
const CHANNEL_OUTPUT_HARD_CAPS = Object.freeze({
  codearts: 32_000,
})

const SPEC_ALIAS_PREFIXES = Object.freeze([
  [/^xopglm52$/, 'glm-5-2'],
  [/^xopdeepseekv4pro\d*$/, 'deepseek-v4-pro'],
  [/^xopdsv4flash\d*in$/, 'deepseek-v4-flash'],
  [/^xdeepseek-flash-in$/, 'deepseek-v4-1-flash'],
  [/^seed-lite-7b$/, 'seed-2-1-lite'],
  [/^deepseek-flash$/, 'deepseek-v4-1-flash'],
  [/^deepseek-v4-pro-official$/, 'deepseek-v4-pro'],
  [/^deepseek-v4-pro-ga-\d+$/, 'deepseek-v4-pro'],
  [/^kimi-k3-1$/, 'kimi-k3-1-pro'],
  [/^doubao-2-1-lite$/, 'seed-2-1-lite'],
  [/^doubao-2-1-pro$/, 'seed-2-1-pro'],
  [/^doubao-2-1-turbo$/, 'seed-2-1-turbo'],
])

function canonicalSpecKey(id, provider) {
  if (typeof id !== 'string' || !id) return ''
  let key = catalogIdentity(id, provider)
    .replace(/^person-/, '')
    .replace(/^qwen(?=\d)/, 'qwen-')
    .replace(/-selected$/, '')
    .replace(/-official$/, '')
    .replace(/-ga-\d{4,8}$/, '')
    .replace(/-\d{6,8}$/, '')
    .replace(/-0731$/, '')
  for (const [pattern, target] of SPEC_ALIAS_PREFIXES) {
    if (pattern.test(key)) { key = target; break }
  }
  if (Object.hasOwn(OFFICIAL_MODEL_SPECS, key)) return key
  const strippedDate = key.replace(/-\d{4}$/, '')
  if (Object.hasOwn(OFFICIAL_MODEL_SPECS, strippedDate)) return strippedDate
  return ''
}

function officialModelSpec(id, provider) {
  const key = canonicalSpecKey(id, provider)
  return key ? OFFICIAL_MODEL_SPECS[key] : null
}

function channelOutputHardCap(provider) {
  return typeof provider === 'string' && Object.hasOwn(CHANNEL_OUTPUT_HARD_CAPS, provider)
    ? CHANNEL_OUTPUT_HARD_CAPS[provider]
    : null
}

// ── src/client/core.js ──
// 共享常量、输入校验与 wire 归一化：把主机投影后的数据收编成视图状态。
// 视图绝不保留原始凭据或上游错误（accountsFrom/modelsFrom 等只收编白名单字段）。
// 渠道注册表在 providers/index.js；本模块不定义渠道清单，全部按注册表推导。
// （拼接机制下跨模块按名引用，注册表晚于本模块定义没关系——只在运行时取用。）

const MODEL_PAGE_SIZE = 15
const PLAN_METHODS = new Set(['plan.snapshot', 'plan.setEnabled', 'plan.setKey', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels'])
const WORKBUDDY_METHODS = new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.models', 'workbuddy.setModelEnabled', 'workbuddy.setModelParams', 'workbuddy.resetModels'])
// API Key 渠道（Agnes、云知声）共用的宿主方法；渠道 id 在 payload.provider 里带。
const APIKEY_METHODS = new Set(['apikey.snapshot', 'apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels'])
// 自管多账号渠道（AStudio / 豆包工作 / Coze / CodeArts 等）共用的宿主方法。
const MANAGED_METHODS = new Set([
  'managed.snapshot', 'managed.models', 'managed.refreshModels',
  'managed.login', 'managed.importLocal', 'managed.importCredential',
  'managed.updateAccount', 'managed.logout', 'managed.setEnabled',
  'managed.checkin', 'managed.claimRewards', 'managed.completeTasks',
  'managed.setModelEnabled', 'managed.setModelParams', 'managed.resetModels',
])
const AUTOMATION_METHODS = new Set(['automation.status', 'automation.setConfig', 'automation.run'])
const METHODS = new Set(['provider.status', 'account.list', 'model.list', 'credits.permanentLock',
  'account.create', 'login.poll', 'account.update', 'account.delete', 'account.reorder', 'account.refresh',
  'account.reset', 'account.retest', 'provider.setEnabled', 'model.setDisabled', 'model.clearDead',
  'model.setAllDisabled', 'model.resetDefaults', 'model.refresh', 'model.params', 'model.setParams',
  'credits.balances', 'credits.claimAll', 'onboarding.claim', 'settings.snapshot', 'settings.refresh',
  ...PLAN_METHODS, ...AUTOMATION_METHODS])
const WORKBUDDY_ID = 'workbuddy'
const allowed = id => PROVIDERS.some(p => p.id === id)
const packAllowed = id => PACK_PROVIDERS.some(p => p.id === id)
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const initial = provider => ({ provider, accounts: [], models: [], balances: [], statuses: {}, selected: '', loadFailed: false,
  checkin: null,
  automation: null,
  locked: false, login: null, pendingDelete: null, params: {}, plan: null, planStale: false, planError: false,
  // WorkBuddy 是自管多账号快照：accounts 逐账号、models 全局、loginUrl 属登录窗口。
    workbuddy: { accounts: [], models: [], loginUrl: '' }, workbuddyReady: false, workbuddyStale: false, workbuddyError: false, workbuddyLoginUrl: null,
  // API Key 渠道快照按渠道 id 存放：{ [id]: 快照 + ready / stale / error }。
  apikeys: {},
  // 自管多账号渠道快照按渠道 id 存放：{ [id]: 快照 + ready / stale / error / loginUrl }。
  managed: {},
  // 模型目录来源（按模型 provider）：'remote' = 真拉到上游目录，'fallback' = 离线兜底，
  // 缺省 = 未知（还没刷过）。设置页据此显示来源标识并决定是否自动补拉一次。
  modelSource: {},
  // 局部非阻塞进行中标记：{ [scope]: true }；busy 为是否有在途写操作的兼容汇总。
  pending: {},
  loading: false, busy: false, notice: '正在读取渠道状态…' })

function safeLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址不可用')
  let url
  try { url = new URL(value) } catch { throw new Error('登录地址不可用') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址不可用')
  return url.href
}
function accountsFrom(value, provider) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && a.provider === provider && typeof a.id === 'string').map(a => ({
    id: a.id, provider, nickname: text(a.nickname, 80) || '未命名账号', enabled: a.enabled !== false,
    expiresAt: number(a.expiresAt),
    // 套餐档位（Raccoon 家族按它分流：免费模型侧 / 订阅模型侧）。缺省不是错误：
    // 老账号可能还没被探测打过标，界面按「未知」显示。
    plan: a.plan === 'free' || a.plan === 'pro' || a.plan === 'unknown' ? a.plan : '',
    modelRateLimits: Object.fromEntries(Object.entries(a.modelRateLimits ?? {}).filter(([, time]) => Number.isFinite(time) && time > Date.now())),
  }))
}
/**
 * 模型在界面状态里的**唯一键**：`provider:modelId`。
 *
 * 家族卡（Raccoon）的模型来自两个 provider，而两边的模型 id 原则上互斥、
 * 但「同一 id 在免费侧 0× / 订阅侧 >0×」这种事并不受我们控制。用组合键可以
 * 保证：模型启停、参数覆盖、React key、编辑位置都精确落到**那一个** provider
 * 的那一个模型上，不会串到另一侧。
 */
const modelKey = (provider, id) => `${text(provider, 64)}:${text(id, 256)}`
/**
 * 模型目录收编。`provider` 必传：同一份状态里可能同时存在两个 provider 的模型
 * （家族卡），每条都带上自己的 provider 与组合键。
 */
function modelsFrom(value, provider) {
  const owner = text(value?.provider, 64) || text(provider, 64)
  return (Array.isArray(value?.models) ? value.models : []).filter(m => m && typeof m.id === 'string').map(m => ({
    id: m.id, provider: owner, key: modelKey(owner, m.id),
    name: text(m.name) || text(m.id), disabled: m.disabled === true, dead: m.dead === true, isFree: m.isFree === true,
    // 模型真实能力：缺省时界面不给对应控件（不猜它有什么能力）。
    contextWindow: number(m.contextWindow),
    maxTokens: number(m.maxTokens),
    defaultMaxTokens: number(m.defaultMaxTokens),
    efforts: Array.isArray(m.efforts) ? m.efforts.filter(x => typeof x === 'string').slice(0, 8) : [],
    defaultEffort: typeof m.defaultEffort === 'string' ? m.defaultEffort : '',
    supportsImage: typeof m.supportsImage === 'boolean' ? m.supportsImage : null,
    stale: m.stale === true,
    staleReason: text(m.staleReason, 240),
    rate: modelRateFrom(m.rate),
  }))
}
function modelRateFrom(value) {
  return typeof value?.label === 'string' && (value.label === '免费' || /^(?:参考 )?x\d+(?:\.\d+)?$/.test(value.label))
    && ['neutral', 'info', 'success', 'warning'].includes(value.tone) ? {
      label: value.label, tone: value.tone,
      ...(Number.isFinite(value.multiplier) && value.multiplier > 0 ? { multiplier: value.multiplier } : {}),
    } : null
}
/**
 * 模型参数覆盖收编。键是 {@link modelKey}（`provider:modelId`），与
 * `state.models[].key` 一一对应 —— 参数编辑、摘要、分派都靠它。
 */
function paramsFrom(value, provider) {
  const source = value?.params
  if (!source || typeof source !== 'object') return {}
  const owner = text(value?.provider, 64) || text(provider, 64)
  return Object.fromEntries(Object.entries(source).filter(([id, entry]) => typeof id === 'string' && entry && typeof entry === 'object')
    .map(([id, entry]) => [modelKey(owner, id), {
      ...(number(entry.contextWindow) !== null ? { contextWindow: entry.contextWindow } : {}),
      ...(number(entry.maxTokens) !== null ? { maxTokens: entry.maxTokens } : {}),
      ...(typeof entry.reasoningEffort === 'string' && entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
      ...(typeof entry.supportsImage === 'boolean' ? { supportsImage: entry.supportsImage } : {}),
    }]))
}
function balancesFrom(value) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && typeof a.accountId === 'string').map(a => ({
    accountId: a.accountId, nickname: text(a.nickname, 80) || '未命名账号', total: number(a.balance?.total),
    updatedAt: number(a.updatedAt), stale: Boolean(a.error),
    packages: (Array.isArray(a.balance?.packages) ? a.balance.packages : []).slice(0, 40).map(p => ({
      name: text(p.name, 80), remaining: number(p.remaining), unit: text(p.unit, 20),
      expiresAt: number(p.expiresAt), active: p.active !== false,
    })),
  }))
}
// 渠道运行状态按注册表逐渠道收编（channel-pack 渠道才有；商汤由 plan 快照推导）。
function statusFrom(value) {
  return Object.fromEntries(PACK_PROVIDERS.map(({ id }) => {
    const status = value?.statuses?.[id]
    return [id, status ? { closed: status.closed === true,
      accounts: number(status.accounts?.enabled ?? status.accounts),
      totalAccounts: number(status.accounts?.total ?? status.totalAccounts ?? status.accounts?.enabled ?? status.accounts),
      models: number(status.models?.total ?? status.models) } : null]
  }))
}
const planNumber = number
function planModelFields(value) {
  return {
    vision: value?.vision === true, contextWindow: number(value?.contextWindow),
    maxOutputLength: number(value?.maxOutputLength), maxTokensOverride: number(value?.maxTokensOverride),
    thinkingLevels: Array.isArray(value?.thinkingLevels) ? PLAN_EFFORTS.filter(level => value.thinkingLevels.includes(level)) : [],
    params: { maxTokens: number(value?.maxTokensOverride), ...normalizePlanParams(value?.params) },
    defaultEffort: text(value?.defaultEffort, 40), defaultVision: typeof value?.defaultVision === 'boolean' ? value.defaultVision : null,
    defaultContextWindow: number(value?.defaultContextWindow), defaultMaxOutputLength: number(value?.defaultMaxOutputLength),
  }
}

function planSnapshotFrom(value) {
  const source = value ?? {}
  const rows = Array.isArray(source.models) ? source.models : []
  return {
    hasApiKey: source.hasApiKey === true, registerProvider: source.registerProvider === true,
    providerRegistered: source.providerRegistered === true, catalogAvailable: source.catalogAvailable === true,
    catalogError: source.catalogError === true, pollSeconds: number(source.pollSeconds), updatedAt: number(source.updatedAt),
    models: rows.filter(model => typeof model?.id === 'string' && model.id.length <= 256 && model.id).slice(0, 512)
      .map(model => ({ id: model.id, name: text(model.name), enabled: model.enabled !== false, ...planModelFields(model) })),
  }
}

function mergePlanSnapshot(value) {
  const plan = planSnapshotFrom(value)
  return { plan, stale: value?.snapshot?.stale === true || plan.catalogError }
}

// API Key 渠道快照：模型字段与商汤同形（planModelFields），另带目录来源与可选的用量。
// 用量只收 { error } 或 { used, limit, unlimited, unit }；单位只认 USD / CNY。
function apikeyBalanceFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.error === true) return { error: true }
  if (value.unit !== 'USD' && value.unit !== 'CNY') return null
  return { used: number(value.used), limit: number(value.limit), unlimited: value.unlimited === true,
    unit: value.unit, updatedAt: number(value.updatedAt) }
}
function apikeySnapshotFrom(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rows = Array.isArray(source.models) ? source.models : []
  return {
    hasApiKey: source.hasApiKey === true, registerProvider: source.registerProvider === true,
    providerRegistered: source.providerRegistered === true,
    catalogSource: ['remote', 'cached', 'fallback'].includes(source.catalogSource) ? source.catalogSource : 'fallback',
    catalogError: source.catalogError === true, updatedAt: number(source.updatedAt),
    models: rows.filter(model => typeof model?.id === 'string' && model.id.length <= 256 && model.id).slice(0, 512)
      .map(model => ({ id: model.id, name: text(model.name), enabled: model.enabled !== false, ...planModelFields(model) })),
    balance: apikeyBalanceFrom(source.balance),
  }
}
// 重进设置页时恢复的渠道快照：按注册表里的渠道 id 逐个重建，未知 id 丢弃。
function apikeySnapshotsFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, entry]) => allowed(id) && providerById(id)?.rpcMethods === APIKEY_METHODS
    && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => [id, apikeySnapshotFrom(entry)]))
}

// WorkBuddy 用量快照：白名单字段收编（窗口、套餐、登录地址），凭据与上游
// 响应体不进快照。字段形状与 lib/workbuddy.js 的 publicWindow/publicModel 对齐：
// resetsAt 是 ISO 字符串；模型是 {id, name, 能力字段}。
const WORKBUDDY_ERROR_CODES = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error'])
function workbuddyWindowFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const window = {
    name: text(value.name, 80), used: number(value.used), amount: number(value.amount),
    limit: number(value.limit), balance: number(value.balance), display: text(value.display, 120),
    unit: text(value.unit, 40), resetsAt: text(value.resetsAt, 40), span: number(value.span),
    runsOutAt: text(value.runsOutAt, 40), runsOut: number(value.runsOut),
  }
  return window.name ? window : null
}
function workbuddyModelsFrom(value) {
  return (Array.isArray(value) ? value : []).filter(m => m && typeof m === 'object' && typeof m.id === 'string' && m.id)
    .map(m => ({ id: text(m.id, 256), name: text(m.name, 160) || text(m.id, 256),
      context: number(m.context), output: number(m.output),
      attachment: typeof m.attachment === 'boolean' ? m.attachment : null, reasoning: m.reasoning === true,
      efforts: Array.isArray(m.efforts) ? m.efforts.filter(e => typeof e === 'string').slice(0, 8) : [],
      free: m.free === true, enabled: m.enabled !== false, rate: modelRateFrom(m.rate),
      ...planModelFields({ ...m, thinkingLevels: m.efforts }) }))
}
// 单账号快照收编：id 缺失或非对象直接丢弃（脏行不进界面）；窗口逐条白名单归一。
function workbuddyAccountFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = text(value.id, 64)
  if (!id) return null
  const rawError = text(value.error, 40)
  return {
    id, name: text(value.name, 80) || id, uid: text(value.uid, 120),
    signedIn: value.signedIn === true, plan: text(value.plan, 160),
    signIn: text(value.signIn, 20) === 'renewed' ? 'renewed' : 'kept',
    windows: Array.isArray(value.windows) ? value.windows.slice(0, 16).map(workbuddyWindowFrom).filter(Boolean) : [],
    updatedAt: number(value.updatedAt),
    error: WORKBUDDY_ERROR_CODES.has(rawError) ? rawError : '',
  }
}
// 多账号快照：{accounts:[...], models:[全局目录], loginUrl}。软失败（上游/鉴权临时
// 错误）且该账号已有读数时按 id 保留上次窗口，身份字段用本次的，整体标 stale。
function workbuddySnapshotFrom(value, previous) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 8)
    .map(workbuddyAccountFrom).filter(Boolean)
  // 模型目录是全局的：本次没带（如只补读快照）就沿用上次。
  const models = Array.isArray(source.models) ? workbuddyModelsFrom(source.models) : (previous?.models ?? [])
  let stale = false
  const merged = accounts.map(account => {
    const softFailed = account.error === 'upstream_error' || account.error === 'auth_error'
    const old = (previous?.accounts ?? []).find(row => row.id === account.id)
    if (softFailed && old?.signedIn && account.signedIn && old.windows.length) {
      stale = true
      return { ...account, plan: account.plan || old.plan, windows: old.windows }
    }
    return account
  })
  const modelSource = ['remote', 'cached', 'fallback'].includes(source.modelSource) ? source.modelSource : previous?.modelSource
  return { workbuddy: { accounts: merged, models, modelSource, loginUrl: text(source.loginUrl, 4096) }, stale }
}

// 自管多账号渠道快照收编（与 WorkBuddy 同构，额外支持 balance / source / authMethods / enabled / registered）。
const MANAGED_ERROR_CODES = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error', 'task_error', 'import_error', 'unsupported'])
function managedAccountFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = text(value.id, 64)
  if (!id) return null
  const rawError = text(value.error, 40)
  return {
    id, name: text(value.name, 80) || id, uid: text(value.uid, 120),
    enabled: value.enabled !== false,
    source: ['browser', 'local', 'credential'].includes(value.source) ? value.source : 'browser',
    signedIn: value.signedIn === true, plan: text(value.plan, 120),
    balance: number(value.balance), unit: text(value.unit, 24),
    windows: Array.isArray(value.windows) ? value.windows.slice(0, 16).map(workbuddyWindowFrom).filter(Boolean) : [],
    updatedAt: number(value.updatedAt),
    error: MANAGED_ERROR_CODES.has(rawError) ? rawError : '',
  }
}
function managedSnapshotFrom(value, previous) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 8)
    .map(managedAccountFrom).filter(Boolean)
  const models = Array.isArray(source.models) ? workbuddyModelsFrom(source.models) : (previous?.models ?? [])
  let stale = false
  const merged = accounts.map(account => {
    const softFailed = account.error === 'upstream_error' || account.error === 'auth_error'
    const old = (previous?.accounts ?? []).find(row => row.id === account.id)
    if (softFailed && old?.signedIn && account.signedIn && (old.windows.length || old.balance !== null)) {
      stale = true
      return {
        ...account,
        plan: account.plan || old.plan,
        windows: old.windows.length ? old.windows : account.windows,
        balance: old.balance !== null ? old.balance : account.balance,
        unit: old.unit || account.unit,
      }
    }
    return account
  })
  const modelSource = ['remote', 'cached', 'fallback'].includes(source.modelSource) ? source.modelSource : previous?.modelSource
  return {
    managed: {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : (previous?.enabled !== false),
      registered: typeof source.registered === 'boolean' ? source.registered : (previous?.registered === true),
      authMethods: Array.isArray(source.authMethods) ? source.authMethods.filter(m => ['browser', 'local', 'credential'].includes(m)) : (previous?.authMethods ?? ['browser']),
      credentialHint: text(source.credentialHint, 160) || (previous?.credentialHint ?? ''),
      accounts: merged,
      models,
      modelSource,
      loginUrl: text(source.loginUrl, 4096),
    },
    stale,
  }
}
function managedSnapshotsFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([id, entry]) => allowed(id) && providerById(id)?.rpcMethods === MANAGED_METHODS && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => [id, managedSnapshotFrom({ ...entry, loginUrl: '' }).managed]))
}

// 自动化配置与任务状态收编
function automationFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const cfg = value.config && typeof value.config === 'object' ? value.config : {}
  const providers = {}
  if (cfg.providers && typeof cfg.providers === 'object' && !Array.isArray(cfg.providers)) {
    for (const [id, entry] of Object.entries(cfg.providers)) {
      if (!entry || typeof entry !== 'object') continue
      const clean = {}
      if (typeof entry.autoCheckin === 'boolean') clean.autoCheckin = entry.autoCheckin
      if (typeof entry.autoClaimRewards === 'boolean') clean.autoClaimRewards = entry.autoClaimRewards
      if (typeof entry.autoCompleteTasks === 'boolean') clean.autoCompleteTasks = entry.autoCompleteTasks
      if (typeof entry.cotLoopGuard === 'boolean') clean.cotLoopGuard = entry.cotLoopGuard
      if (Object.keys(clean).length) providers[id] = clean
    }
  }
  const tasks = {}
  if (value.tasks && typeof value.tasks === 'object' && !Array.isArray(value.tasks)) {
    for (const [id, entry] of Object.entries(value.tasks)) {
      if (!entry || typeof entry !== 'object') continue
      tasks[id] = {
        date: text(entry.date, 16),
        capabilities: {
          claimRewards: entry.capabilities?.claimRewards === true,
          completeTasks: entry.capabilities?.completeTasks === true,
        },
        claimRewards: Array.isArray(entry.claimRewards) ? entry.claimRewards : [],
        completeTasks: Array.isArray(entry.completeTasks) ? entry.completeTasks : [],
      }
    }
  }
  return {
    config: {
      autoCheckin: cfg.autoCheckin !== false,
      autoClaimRewards: cfg.autoClaimRewards !== false,
      autoCompleteTasks: cfg.autoCompleteTasks === true,
      cotLoopGuard: cfg.cotLoopGuard !== false,
      providers,
    },
    tasks,
  }
}
function automationEffective(state, providerId, field) {
  const cfg = state.automation?.config
  if (!cfg) return field === 'autoCompleteTasks' ? false : true
  const override = cfg.providers?.[providerId]?.[field]
  if (typeof override === 'boolean') return override
  return cfg[field] === true
}
const TASK_LABELS = {
  claimed: '奖励已领', completed: '任务已完成', done: '今日已完成',
  empty: '暂无可领', failed: '任务失败', pending: '处理中',
}
function taskEntry(state, providerId, mode, accountId) {
  const row = state.automation?.tasks?.[providerId]?.[mode]?.find(item => item.accountId === accountId)
  if (!row) return null
  const label = Object.hasOwn(TASK_LABELS, row.kind) ? TASK_LABELS[row.kind] : null
  if (!label) return null
  const ok = row.kind === 'claimed' || row.kind === 'completed' || row.kind === 'done'
  return { tag: [label, ok ? 'success' : row.kind === 'empty' ? undefined : 'warn'], row }
}
function claimMessage(value, provider) {
  const results = Array.isArray(value?.results) ? value.results : []
  if (!results.length) return '没有可领取的账号。'
  const count = kind => results.filter(r => r.outcome?.kind === kind).length
  let result = `领取结果：${count('claimed')} 个成功，${count('already-claimed')} 个已领，${count('inactive')} 个暂不可领，${count('failed')} 个失败。`
  if (count('pending')) result += `${count('pending')} 个待确认。`
  if (results.some(r => r.outcome?.actionRequired)) result += provider === 'qodercn'
    ? '每日额度开通入口：Qoder 中国版官方客户端。' : '每日额度开通入口：官方客户端。'
  return result
}
const CHECKIN_LABELS = {
  claimed: '已签到', 'already-claimed': '已签到', inactive: '签到活动未开启',
  ineligible: '签到条件未满足', failed: '签到失败', pending: '签到待确认',
}
function checkinEntry(state, provider, accountId) {
  const current = state.checkin?.providers?.[provider]
  if (!current) return null
  const date = new Date(Date.now() + (8 - current.resetHour) * 3_600_000).toISOString().slice(0, 10)
  if (current.date !== date) return null
  const account = current.accounts?.find(account => account.accountId === accountId)
  const kind = account?.kind
  const label = Object.hasOwn(CHECKIN_LABELS, kind) ? CHECKIN_LABELS[kind] : null
  if (!label) return null
  return { tag: [label, kind === 'claimed' || kind === 'already-claimed' ? 'success' : 'warn'], locked: account.retryable !== true }
}
function modelDisplayName(model) {
  return readableModelName(text(model?.id, 256), text(model?.name, 160)) || '未命名模型'
}
function filterModels(models, query) {
  const needle = String(query || '').trim().toLowerCase()
  return models.filter(m => !needle || `${m.id} ${m.name} ${modelDisplayName(m)}`.toLowerCase().includes(needle))
}

// ===== 渠道级缓存（sessionStorage）=====
//
// 解决的就是用户报的这句：「每次点进去都『没有信息，正在拉取』」。
// 切回**已经读过的**渠道时先用上次的数据把界面填上，后台照常静默刷新；
// 重进设置页（宿主重挂载）也恢复上次结果。
//
// 缓存里只放**公开投影后**的渠道自有字段（accountsFrom / modelsFrom /
// balancesFrom / paramsFrom 的产物）——凭据与上游原始错误从来不在这些形状里，
// 所以读回来的条目也不需要额外脱敏，只需按白名单重新收编一次（防手改/脏数据）。
const CACHE_STORAGE_KEY = 'eac-unified-router-cache-v1'
// 目录来源只有主机回报的两个结论；其它值一律不收。
const CACHE_MODEL_SOURCES = new Set(['remote', 'cached', 'fallback'])
/**
 * 把持久化条目收编成可信的渠道自有数据。`provider` 是条目所属渠道（卡片 id）。
 *
 * 非对象 → null（调用方直接丢弃）。逐字段白名单：
 * - accounts：`accountsFrom` 已按 `a.provider === provider` 过滤并收编；
 * - models：缓存里的模型是**已归一形状**（带 provider/key），不能整体喂
 *   `modelsFrom`——那样会把家族卡两侧都归到宿主 provider。这里先过滤脏行，
 *   按 `m.provider` 分组，只保留本渠道的模型面，每侧各自 `modelsFrom`；
 * - balances：缓存形状 {accountId, nickname, total, packages}，适配回 wire 形状后
 *   复用 `balancesFrom`；
 * - params：只保留键命中收编后模型的条目，值按 paramsFrom 的字段口径挑；
 * - locked / modelSource / selected / at：白名单取值，非法值退回缺省。
 */
function sanitizeCacheEntry(entry, provider) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const accounts = accountsFrom({ accounts: Array.isArray(entry.accounts) ? entry.accounts : [] }, provider)
  // 模型按 provider 分组：家族卡（raccoon）两侧各一份目录，键是 `provider:modelId`。
  const sides = modelProvidersOf(provider)
  const grouped = new Map(sides.map(side => [side, []]))
  for (const row of Array.isArray(entry.models) ? entry.models : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    if (typeof row.id !== 'string' || !row.id || typeof row.provider !== 'string') continue
    // 组合键必须与 id/provider 自洽，否则这一行不知道自己属于哪一侧。
    if (row.key !== modelKey(row.provider, row.id)) continue
    grouped.get(row.provider)?.push(row)
  }
  const models = sides.flatMap(side => modelsFrom({ models: grouped.get(side) }, side))
  const balances = balancesFrom({ accounts: (Array.isArray(entry.balances) ? entry.balances : [])
    .filter(b => b && typeof b === 'object' && !Array.isArray(b) && typeof b.accountId === 'string')
    .map(b => ({ accountId: b.accountId, nickname: b.nickname, updatedAt: b.updatedAt, error: b.stale === true,
      balance: { total: b.total, packages: b.packages } })) })
  const knownKeys = new Set(models.map(model => model.key))
  const rawParams = entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params) ? entry.params : {}
  const params = Object.fromEntries(Object.entries(rawParams)
    .filter(([key, value]) => knownKeys.has(key) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, value]) => [key, {
      ...(number(value.contextWindow) !== null ? { contextWindow: value.contextWindow } : {}),
      ...(number(value.maxTokens) !== null ? { maxTokens: value.maxTokens } : {}),
      ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
      ...(typeof value.supportsImage === 'boolean' ? { supportsImage: value.supportsImage } : {}),
    }]))
  const rawSource = entry.modelSource && typeof entry.modelSource === 'object' ? entry.modelSource : {}
  const modelSource = Object.fromEntries(sides
    .filter(side => CACHE_MODEL_SOURCES.has(rawSource[side]))
    .map(side => [side, rawSource[side]]))
  const selected = typeof entry.selected === 'string' && accounts.some(a => a.id === entry.selected) ? entry.selected : ''
  return { accounts, models, balances, params, locked: entry.locked === true, modelSource, selected, at: number(entry.at) ?? 0 }
}
/**
 * 读持久化缓存。storage 无效 / 读或解析失败 → null（调用方按「没有缓存」处理）。
 *
 * 只收 channel-pack 渠道，且排除商汤、WorkBuddy：它们的数据在 plan / workbuddy
 * 快照里（已由 sharedCards 跨渠道保留），不属于本案的渠道自有缓存。
 */
function readChannelCache(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let raw
  try { raw = storage.getItem(CACHE_STORAGE_KEY) } catch { return null }
  if (typeof raw !== 'string' || !raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const source = parsed.channels && typeof parsed.channels === 'object' && !Array.isArray(parsed.channels) ? parsed.channels : {}
  // 卡片快照（商汤 / WorkBuddy）：只有它们能让那两张渠道 tab 在**点进去之前**也有数字。
  const cards = sanitizeCardSnapshots(parsed)
  const channels = {}
  for (const [provider, entry] of Object.entries(source)) {
    if (!packAllowed(provider) || provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) continue
    const clean = sanitizeCacheEntry(entry, provider)
    if (clean) channels[provider] = clean
  }
  return { channels, statuses: statusFrom({ statuses: parsed.statuses }),
    plan: cards.plan ?? null, workbuddy: cards.workbuddy ?? null,
    // 读回的快照是上次的结果：标记 ready 让首屏直接显示，随后由实时读取覆盖。
    apikeys: Object.fromEntries(Object.entries(cards.apikeys).map(([id, entry]) => [id, { ...entry, ready: true, stale: false, error: false }])),
    managed: Object.fromEntries(Object.entries(cards.managed).map(([id, entry]) => [id, { ...entry, ready: true, stale: false, error: false, loginUrl: '' }])) }
}
/**
 * 写持久化缓存。存储不可用（隐私模式、配额满、宿主无 sessionStorage）时静默忽略：
 * 缓存只是体验优化，写失败不该影响任何一次读取。
 */
/**
 * 卡片快照的**白名单收编**（商汤 plan / WorkBuddy / API Key / 自管多账号渠道）。
 *
 * 快照里没有任何凭据（登录令牌在凭据服务里），读回时逐字段重建。
 */
function sanitizeCardSnapshots(parsed) {
  const plan = parsed?.plan && planSnapshotFrom(parsed.plan)
  const workbuddy = parsed?.workbuddy && workbuddySnapshotFrom({
    accounts: parsed.workbuddy.accounts, models: parsed.workbuddy.models,
  }).workbuddy
  return { plan, workbuddy, apikeys: apikeySnapshotsFrom(parsed?.apikeys), managed: managedSnapshotsFrom(parsed?.managed) }
}

function writeChannelCache(storage, channels, statuses, cards = {}) {
  if (!storage || typeof storage.setItem !== 'function') return
  try {
    storage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
      v: 2, channels: channels || {}, statuses: statuses || {},
      // 卡片快照：只存展示所需的计数字段（见 sanitizeCardSnapshots）。
      ...sanitizeCardSnapshots(cards),
      at: Date.now(),
    }))
  } catch { /* 缓存写失败不提示用户：下次进页面照常读一次。 */ }
}

// ── src/client/store/pending.js ──
// 局部非阻塞状态锁：把全局单布尔 busy 拆分为按操作域追踪的 pending 映射。
// 同一 scope 防止重复提交，不同 scope（例如改模型参数与切换自动化开关、或不同账号操作）互不阻塞。
function createPendingTracker(onChange) {
  const counts = new Map()

  const snapshot = () => Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0).map(([key]) => [key, true]))
  const hasAny = () => counts.size > 0
  const has = scope => (counts.get(scope) ?? 0) > 0

  function enter(scope = 'global') {
    counts.set(scope, (counts.get(scope) ?? 0) + 1)
    onChange?.(snapshot(), hasAny())
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (counts.get(scope) ?? 1) - 1
      if (next <= 0) counts.delete(scope)
      else counts.set(scope, next)
      onChange?.(snapshot(), hasAny())
    }
  }

  function clear() {
    counts.clear()
  }

  return { enter, has, hasAny, snapshot, clear }
}

// ── src/client/store/cache.js ──
// 客户端轻量首屏恢复缓存：只用于冷启动秒开展示公开快照字段，权威数据与持久化仍在 Host 侧。
function cacheStorage() {
  try { if (globalThis.localStorage) return globalThis.localStorage } catch { /* Storage unavailable. */ }
  try { if (globalThis.sessionStorage) return globalThis.sessionStorage } catch { /* Storage unavailable. */ }
  return null
}

function restoredRouterState(provider, cache = readChannelCache(cacheStorage())) {
  const channel = cache?.channels[provider]
  const hasManaged = providerById(provider)?.rpcMethods === MANAGED_METHODS && !!cache?.managed?.[provider]
  return {
    ...initial(provider), ...channel, notice: '',
    loading: !channel && (packAllowed(provider) || !(provider === PLAN_PROVIDER_ID ? cache?.plan
      : provider === WORKBUDDY_ID ? cache?.workbuddy : hasManaged ? cache?.managed?.[provider] : cache?.apikeys?.[provider])),
    statuses: cache?.statuses ?? {},
    ...(cache?.apikeys ? { apikeys: cache.apikeys } : {}),
    ...(cache?.managed ? { managed: cache.managed } : {}),
    ...(cache?.plan ? { plan: cache.plan, planStale: !!cache.plan.catalogError } : {}),
    ...(cache?.workbuddy ? { workbuddy: cache.workbuddy, workbuddyReady: true } : {}),
  }
}

function createClientCache(persisted) {
  const channelCache = new Map(Object.entries(persisted?.channels ?? {}))

  function persistCards(state) {
    writeChannelCache(cacheStorage(), Object.fromEntries(channelCache), state.statuses, {
      plan: state.plan,
      workbuddy: state.workbuddyReady ? state.workbuddy : null,
      apikeys: Object.fromEntries(Object.entries(state.apikeys ?? {}).filter(([, entry]) => entry?.ready === true)),
      managed: Object.fromEntries(Object.entries(state.managed ?? {}).filter(([, entry]) => entry?.ready === true)),
    })
  }

  function rememberChannel(provider, state) {
    if (!packAllowed(provider) || provider === PLAN_PROVIDER_ID || provider === WORKBUDDY_ID) return
    channelCache.set(provider, {
      accounts: state.accounts, models: state.models, balances: state.balances,
      params: state.params, locked: state.locked, modelSource: state.modelSource, selected: state.selected,
      at: Date.now(),
    })
    persistCards(state)
  }

  return {
    get: provider => channelCache.get(provider) ?? null,
    clear: () => channelCache.clear(),
    rememberChannel,
    persistCards,
  }
}

// ── src/client/store/sync.js ──
// Host 快照同步器：Client 只通过增量游标消费 Host 快照，与 Host 后台定时采集彻底解耦。
function createHostSync({
  snapshotProviders, getState, isDisposed, request, publish, cache,
  getWriteRevision, getReadRevision, newestStatusReadRef, newestAccountRead, newestModelRead,
}) {
  let snapshotProtocol = false
  let hostCursor = null
  let lightController = null
  let cardController = null

  function hasSnapshots() {
    return snapshotProtocol
  }

  function markSnapshotProtocol() {
    snapshotProtocol = true
  }

  function resetCursor() {
    hostCursor = null
  }

  async function readHostSnapshots() {
    if (lightController || isDisposed()) return false
    const controller = new AbortController()
    const mutation = getWriteRevision(), selection = getReadRevision()
    lightController = controller
    try {
      const result = await request('settings.snapshot', { cursor: hostCursor }, controller.signal)
      const state = getState()
      if (isDisposed() || mutation !== getWriteRevision() || selection !== getReadRevision() || state.busy) return false
      if (typeof result?.cursor !== 'string') return false
      snapshotProtocol = true
      hostCursor = result.cursor
      const snapshots = result.entries
      if (!snapshots) return true
      const get = (method, provider = state.provider) => snapshots?.[method === 'provider.status' ? method : `${provider}/${method}`]
      const status = get('provider.status')
      const accounts = get('account.list')
      const credits = get('credits.balances')
      const checkin = get('checkin.status', 'daily')
      const automation = get('automation.status', 'automation')
      const patch = {}
      if (checkin?.value) patch.checkin = checkin.value
      if (automation?.value) patch.automation = automationFrom(automation.value)
      if (status?.value && status.at >= newestStatusReadRef.current) patch.statuses = statusFrom(status.value)
      if (accounts?.value && accounts.at >= (newestAccountRead.get(state.provider) ?? 0) && (!state.loading || !state.accounts.length)) {
        patch.accounts = accountsFrom(accounts.value, state.provider)
      }
      if (packAllowed(state.provider)) {
        const sides = modelProvidersOf(state.provider)
        const sideEntries = sides.map(side => [side, get('model.list', side)])
        const freshSides = sideEntries.filter(([side, entry]) => entry?.value && entry.at >= (newestModelRead?.get(side) ?? 0))
        if (freshSides.length && (!state.loading || !state.models.length)) {
          const bySide = new Map(freshSides.map(([side, entry]) => [side, modelsFrom(entry.value, side)]))
          patch.models = sides.flatMap(side => bySide.has(side) ? bySide.get(side) : state.models.filter(m => m.provider === side))
          const sourceUpdates = Object.fromEntries(freshSides.flatMap(([side, entry]) =>
            CACHE_MODEL_SOURCES.has(entry.value?.source) ? [[side, entry.value.source]] : []))
          if (Object.keys(sourceUpdates).length) patch.modelSource = { ...state.modelSource, ...sourceUpdates }
        }
      }
      if (credits?.value) patch.balances = balancesFrom(credits.value).map(balance => ({ ...balance, stale: credits.stale || balance.stale }))
      else if (credits?.stale) patch.balances = state.balances.map(balance => ({ ...balance, stale: true }))
      for (const provider of snapshotProviders) {
        Object.assign(patch, provider.snapshot.apply(method => get(method, provider.id), { ...state, ...patch }))
      }
      if (Object.keys(patch).length) {
        publish(patch)
        const next = getState()
        if (packAllowed(next.provider) && (accounts || credits)) cache.rememberChannel(next.provider, next)
        else cache.persistCards(next)
      }
      return true
    } catch { return false } finally {
      if (lightController === controller) lightController = null
    }
  }

  // 兼容未提供统一 settings.snapshot 的旧宿主或离线测试桩。
  async function prefetchCards() {
    if (isDisposed() || snapshotProtocol) return false
    const controller = new AbortController()
    const mutation = getWriteRevision()
    cardController?.abort()
    cardController = controller
    const state = getState()
    const missing = snapshotProviders.filter(provider => !provider.snapshot.ready(state))
    await Promise.all(missing.map(async ({ id, snapshot }) => {
      try {
        const values = await Promise.all(snapshot.methods.map(method => request(method, { provider: id }, controller.signal)))
        if (isDisposed() || controller.signal.aborted || mutation !== getWriteRevision() || values[0]?.snapshot?.at === null) return
        publish(snapshot.fromRead(values, getState()))
        cache.persistCards(getState())
      } catch { /* 下次切入时重试 */ }
    }))
    return missing.length > 0
  }

  function abort() {
    lightController?.abort()
    lightController = null
    cardController?.abort()
    cardController = null
  }

  return {
    hasSnapshots,
    markSnapshotProtocol,
    resetCursor,
    readHostSnapshots,
    prefetchCards,
    abort,
    isReadingLight: () => !!lightController,
    setLightController(controller) { lightController?.abort(); lightController = controller },
    clearLightController(controller) { if (lightController === controller) lightController = null },
  }
}

// ── src/client/store/index.js ──
// Pure state controller: the view never retains raw credentials or upstream errors.
// 模块化拆分：pending.js（局部非阻塞锁）+ cache.js（首屏轻量缓存）+ sync.js（Host 快照游标同步）+ 本门面。
const LOAD_RETRY_DELAYS_MS = Object.freeze([300, 800, 1800])

function createRouterStore(call, provider = PROVIDERS[0].id) {
  const persisted = readChannelCache(cacheStorage())
  const cache = createClientCache(persisted)
  const snapshotProviders = PROVIDERS.filter(item => item.snapshot)
  const snapshotReads = new Set(['credits.balances', ...snapshotProviders.flatMap(item => item.snapshot.methods)])
  const sharedFields = ['statuses', 'checkin', 'automation', ...snapshotProviders.flatMap(item => item.snapshot.keep ?? [])]
  let state = restoredRouterState(provider, persisted)
  let disposed = false, readController = null, balanceController = null,
    planController = null, planPollTimer = null, planPollGeneration = 0, planRevision = 0,
    planVisibilityHandler = null,
    revision = 0, balanceRevision = 0, confirmation = 0
  const listeners = new Set(), writes = new Set(), logins = new Map(), loginUrlTimers = new Set()
  const autoRefreshed = new Set()
  const lifetime = new AbortController()
  let writeRevision = 0
  const newestAccountRead = new Map()
  const newestModelRead = new Map()
  const newestStatusReadRef = { current: 0 }

  const loginProviderOf = id => isRaccoonFamily(id) ? RACCOON_FAMILY[0] : id
  const sharedCards = () => Object.fromEntries(sharedFields.map(field => [field, state[field]]))
  const publish = patch => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  const pending = createPendingTracker((map, any) => {
    publish({ pending: map, busy: any })
  })

  const request = async (method, payload, signal) => {
    if (disposed || signal?.aborted) throw new Error('请求已结束')
    const managedMethod = providerById(payload?.provider)?.rpcMethods?.has(method)
    if (!METHODS.has(method) && !managedMethod) throw new Error('不支持此操作')
    if (method === 'provider.status') {
      if (!Array.isArray(payload?.providers) || payload.providers.some(p => !packAllowed(p))) throw new Error('不支持此渠道')
    } else if (PLAN_METHODS.has(method)) {
      if (payload?.provider !== PLAN_PROVIDER_ID) throw new Error('不支持此渠道')
      if (method === 'plan.setEnabled' && typeof payload.enabled !== 'boolean') throw new Error('渠道开关无效')
      if (method === 'plan.setKey' && typeof payload.apiKey !== 'string') throw new Error('API Key 无效')
    } else if (method === 'apikey.setKey' && typeof payload?.apiKey !== 'string') {
      throw new Error('API Key 无效')
    } else if (AUTOMATION_METHODS.has(method)) {
      if (payload?.provider !== undefined && !allowed(payload.provider) && !packAllowed(payload.provider)) throw new Error('不支持此渠道')
    } else if (!managedMethod && (method === 'settings.refresh' ? (payload?.provider !== 'all' && !allowed(payload?.provider))
      : method !== 'settings.snapshot' && !packAllowed(payload?.provider))) throw new Error('不支持此渠道')
    let result
    const live = payload?.live === true
    const cleanPayload = live ? (() => { const { live: _drop, ...rest } = payload; return rest })() : payload
    const cached = snapshotReads.has(method) && !cleanPayload.localOnly && !live
    try { result = await call(method, cached ? { ...cleanPayload, snapshot: true } : cleanPayload, signal) } catch { throw new Error('主机请求未完成') }
    if (signal?.aborted || disposed) throw new Error('请求已结束')
    if (result?.ok !== true) throw new Error('主机未能完成此操作')
    if (cached && result.value?.snapshot) sync.markSnapshotProtocol()
    return result.value
  }

  const sync = createHostSync({
    snapshotProviders,
    getState: () => state,
    isDisposed: () => disposed,
    request,
    publish,
    cache,
    getWriteRevision: () => writeRevision,
    getReadRevision: () => revision,
    newestStatusReadRef,
    newestAccountRead,
    newestModelRead,
  })

  const loginFor = target => {
    const login = logins.get(target)
    if (login && Date.now() - login.createdAt < 10 * 60_000) return login
    logins.delete(target)
    return null
  }

  function planVisible() {
    return typeof document === 'undefined' || document.visibilityState === undefined || document.visibilityState === 'visible'
  }
  function planPollSeconds() {
    const value = state.plan?.pollSeconds
    return Math.min(300, Math.max(30, typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 60))
  }
  function stopPlanPolling() {
    planPollGeneration++
    if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
    planPollTimer = null
    planController?.abort()
    planController = null
    if (planVisibilityHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', planVisibilityHandler)
    planVisibilityHandler = null
  }
  function schedulePlanPoll(generation = planPollGeneration) {
    if (disposed || generation !== planPollGeneration || state.provider !== PLAN_PROVIDER_ID || !planVisible() || typeof setTimeout !== 'function') return
    if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
    planPollTimer = setTimeout(async () => {
      planPollTimer = null
      if (disposed || generation !== planPollGeneration || state.provider !== PLAN_PROVIDER_ID || !planVisible()) return
      await refreshPlan(PLAN_PROVIDER_ID)
      schedulePlanPoll(generation)
    }, planPollSeconds() * 1000)
  }
  async function refreshPlan(target = state.provider) {
    if (disposed || target !== PLAN_PROVIDER_ID || state.provider !== PLAN_PROVIDER_ID || state.busy || state.loading || !planVisible()) return false
    planController?.abort()
    const controller = new AbortController(), ticket = ++planRevision
    planController = controller
    try {
      const value = await request('plan.snapshot', { provider: PLAN_PROVIDER_ID }, controller.signal)
      if (disposed || controller.signal.aborted || ticket !== planRevision || state.provider !== PLAN_PROVIDER_ID) return false
      const merged = mergePlanSnapshot(value, state.plan)
      publish({ plan: merged.plan, planStale: merged.stale, planError: false, ...(state.planError ? { notice: '' } : {}) })
      return true
    } catch {
      if (!disposed && !controller.signal.aborted && ticket === planRevision && state.provider === PLAN_PROVIDER_ID) {
        publish({ planStale: true, planError: true, notice: '模型目录更新失败。' })
      }
      return false
    } finally {
      if (planController === controller) planController = null
    }
  }
  function startPlanPolling({ refresh = false } = {}) {
    if (sync.hasSnapshots()) { stopPlanPolling(); return }
    if (state.provider !== PLAN_PROVIDER_ID) return
    if (!planVisibilityHandler && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      planVisibilityHandler = () => {
        if (state.provider !== PLAN_PROVIDER_ID) return
        if (planVisible()) { void refreshPlan(PLAN_PROVIDER_ID); schedulePlanPoll(planPollGeneration) }
        else {
          if (planPollTimer !== null && typeof clearTimeout === 'function') clearTimeout(planPollTimer)
          planPollTimer = null
          planController?.abort()
          if (state.loading && readController) {
            readController.abort(); readController = null
            publish({ loading: false, notice: state.plan ? '' : '返回页面时将自动读取商汤状态。' })
          }
        }
      }
      document.addEventListener('visibilitychange', planVisibilityHandler)
    }
    if (!planVisible()) return
    const generation = planPollGeneration
    if (refresh) void refreshPlan(PLAN_PROVIDER_ID)
    schedulePlanPoll(generation)
  }

  async function loadPlan(target = PLAN_PROVIDER_ID, force = false) {
    if (disposed || target !== PLAN_PROVIDER_ID) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    const pendingMap = state.pending
    publish({ ...initial(target), ...sharedCards(), busy, pending: pendingMap, loading: !state.plan,
      notice: busy ? state.notice : '' })
    startPlanPolling()
    if (!planVisible()) {
      publish({ loading: false, notice: '返回页面时将自动读取商汤状态。' })
      return false
    }
    // 普通切渠道且商汤状态已就绪时直接走增量游标；写操作后 force=true 必须强制拉取最新值。
    if (!force && sync.hasSnapshots() && state.plan) {
      publish({ loading: false })
      void sync.readHostSnapshots()
      return true
    }
    try {
      const value = await request('plan.snapshot', { provider: PLAN_PROVIDER_ID }, controller.signal)
      if (disposed || current !== revision || controller.signal.aborted) return false
      if (value?.snapshot?.at === null) {
        if (value.snapshot.stale) publish({ loading: false, planStale: true, planError: true })
        startPlanPolling()
        return true
      }
      const merged = mergePlanSnapshot(value, state.plan)
      publish({ plan: merged.plan, planStale: merged.stale, planError: false, loading: false, notice: '' })
      startPlanPolling()
      cache.persistCards(state)
      return true
    } catch {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, planStale: true, planError: true,
          notice: '商汤 Token Plan 暂时无法读取，请检查网络或配置后重试。' })
        startPlanPolling()
      }
      return false
    }
  }

  async function loadManaged(target, force = false) {
    const spec = providerById(target)?.snapshot
    if (disposed || !spec) return false
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const busy = state.busy
    const pendingMap = state.pending
    publish({ ...initial(target), ...sharedCards(), busy, pending: pendingMap, loading: !spec.ready(state),
      notice: busy ? state.notice : '' })
    if (!force && sync.hasSnapshots() && spec.ready(state)) {
      publish({ loading: false })
      void sync.readHostSnapshots()
      return true
    }
    try {
      const values = await Promise.all(spec.methods.map(method => request(method, { provider: target, ...(force ? { live: true } : {}) }, controller.signal)))
      if (disposed || current !== revision || controller.signal.aborted) return false
      const main = values[0]?.snapshot
      if (main?.at === null) {
        if (main.stale) publish({ loading: false, ...spec.readFailed?.(state) })
        return true
      }
      publish({ ...spec.fromRead(values, state), loading: false, notice: '' })
      cache.persistCards(state)
      return true
    } catch {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, ...spec.readFailed?.(state), notice: '读取失败。' })
      }
      return false
    }
  }

  async function readChannel(target, controller, selection) {
    const sides = modelProvidersOf(target)
    const started = Date.now()
    try {
      const results = await Promise.all([
        request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal),
        request('account.list', { provider: target }, controller.signal),
        ...sides.map(side => request('model.list', { provider: side }, controller.signal)),
        providerById(target)?.caps?.permanentLock ? request('credits.permanentLock', { provider: target }, controller.signal) : Promise.resolve({ locked: false }),
        ...sides.map(side => request('model.params', { provider: side }, controller.signal)),
      ])
      if (disposed || controller.signal.aborted) return false
      const [statuses, accounts] = results
      const modelValues = results.slice(2, 2 + sides.length)
      const lock = results[2 + sides.length]
      const paramValues = results.slice(3 + sides.length)
      const rows = accountsFrom(accounts, target)
      newestAccountRead.set(target, started)
      for (const side of sides) newestModelRead.set(side, started)
      newestStatusReadRef.current = started
      publish({
        accounts: rows,
        models: sides.flatMap((side, index) => modelsFrom(modelValues[index], side)),
        modelSource: { ...state.modelSource, ...Object.fromEntries(sides.flatMap((side, index) =>
          CACHE_MODEL_SOURCES.has(modelValues[index]?.source) ? [[side, modelValues[index].source]] : [])) },
        ...(target === 'qodercn' ? { qoderCatalogIssue: modelValues[0]?.issue ?? '' } : {}),
        statuses: statusFrom(statuses), locked: lock?.locked === true,
        params: Object.assign({}, ...sides.map((side, index) => paramsFrom(paramValues[index], side))),
        selected: rows.some(a => a.id === selection) ? selection : '', loading: false, loadFailed: false,
        notice: '',
      })
      cache.rememberChannel(target, state)
      cache.persistCards(state)
      return rows
    } catch {
      return undefined
    }
  }

  async function load(target = state.provider, autoBalance = true, force = false) {
    if (disposed || !allowed(target)) return false
    if (!sync.hasSnapshots()) sync.resetCursor()
    if (target === PLAN_PROVIDER_ID) return loadPlan(target, force)
    if (providerById(target)?.snapshot) return loadManaged(target, force)
    stopPlanPolling()
    readController?.abort()
    const controller = new AbortController(), current = ++revision
    readController = controller
    const same = target === state.provider
    const cachedEntry = cache.get(target)
    const unloaded = !state.accounts.length && !state.models.length && !state.balances.length
    const cached = !same || unloaded ? cachedEntry : null
    const selected = cached ? (cached.selected || '') : same ? state.selected : ''
    const busy = state.busy
    const pendingMap = state.pending
    const keep = same && !cached ? {
      accounts: state.accounts, models: state.models, params: state.params,
      locked: state.locked, balances: state.balances, modelSource: state.modelSource,
    } : cached ? {
      accounts: cached.accounts, models: cached.models, balances: cached.balances,
      params: cached.params, locked: cached.locked, modelSource: cached.modelSource,
    } : {}
    publish({
      ...initial(target), ...sharedCards(), ...keep, busy, pending: pendingMap, selected, login: loginFor(target), loading: true,
      notice: busy ? state.notice : cached || cachedEntry ? '' : initial(target).notice,
    })
    if (!same) { balanceController?.abort(); balanceController = null }
    let rows = await readChannel(target, controller, selected)
    const contradictory = () => {
      if (rows === undefined || !Array.isArray(rows) || rows.length > 0) return false
      const status = state.statuses?.[target]
      const enabled = status?.accounts && typeof status.accounts === 'object' ? status.accounts.enabled : status?.accounts
      return typeof enabled === 'number' && enabled > 0
    }
    const canRetry = (rows === undefined || contradictory()) && state.models.length === 0
    for (let attempt = 0; canRetry && (rows === undefined || contradictory()) && attempt < LOAD_RETRY_DELAYS_MS.length; attempt++) {
      await new Promise(resolve => { const timer = setTimeout(resolve, LOAD_RETRY_DELAYS_MS[attempt]); loginUrlTimers.add(timer) })
      if (disposed || current !== revision || controller.signal.aborted) return false
      rows = await readChannel(target, controller, selected)
    }
    if (rows === undefined || contradictory()) {
      if (!disposed && current === revision && !controller.signal.aborted) {
        publish({ loading: false, loadFailed: true, notice: '读取失败，点「刷新」重试。' })
      }
      return false
    }
    if (rows === false) return false
    if (autoBalance && rows.length > 0 && !disposed) void refreshLatestBalances(target)
    return true
  }

  function catalogNotice(sides, sources) {
    if (!Object.keys(sources).length) return '模型目录刷新未完成，可稍后点「刷新目录」重试。'
    if (sides.every(side => sources[side] === 'cached')) return '本次刷新失败，显示上次成功拉取的目录。'
    if (sides.some(side => sources[side] === 'cached')) return '部分模型面显示上次成功拉取的目录。'
    const fallback = sides.filter(side => sources[side] === 'fallback').length
    if (fallback === 0) return '模型目录已从上游刷新。'
    return fallback === sides.length
      ? '未拉取到上游目录，显示离线兜底。'
      : '部分模型面未拉取到上游目录，显示离线兜底。'
  }

  async function refreshCatalog(target, options = {}) {
    const silent = options.silent === true
    const channel = state.provider
    const scope = `models:${channel}`
    if (disposed || state.loading || pending.has(scope)) return false
    const sides = typeof target === 'string' && modelProvidersOf(channel).includes(target) ? [target] : modelProvidersOf(channel)
    if (!sides.length) return false
    const controller = new AbortController()
    writes.add(controller)
    const release = silent ? () => {} : pending.enter(scope)
    if (!silent) publish({ notice: '正在向上游拉取模型目录…' })
    try {
      const results = await Promise.allSettled(sides.map(side => request('model.refresh', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted) return false
      const sources = {}
      sides.forEach((side, index) => {
        const result = results[index]
        if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') return
        sources[side] = CACHE_MODEL_SOURCES.has(result.value.source) ? result.value.source : 'fallback'
      })
      const fresh = await Promise.all(sides.map(side => request('model.list', { provider: side }, controller.signal)))
      if (disposed || controller.signal.aborted || state.provider !== channel) return false
      const refreshedAt = Date.now()
      for (const side of sides) newestModelRead.set(side, refreshedAt)
      const refreshed = new Map(sides.map((side, index) => [side, modelsFrom(fresh[index], side)]))
      publish({
        models: modelProvidersOf(channel).flatMap(side => refreshed.has(side)
          ? refreshed.get(side) : state.models.filter(model => model.provider === side)),
        ...(Object.keys(sources).length ? { modelSource: { ...state.modelSource, ...sources } } : {}),
        ...(silent ? {} : { notice: providerById(channel)?.caps?.cliCatalog && results[0]?.status === 'fulfilled' && sources[channel]
          ? '' : catalogNotice(sides, sources) }),
        ...(channel === 'qodercn' && results[0]?.status === 'fulfilled' ? { qoderCatalogIssue: results[0].value?.issue ?? '' } : {}),
      })
      cache.rememberChannel(channel, state)
      return true
    } catch {
      if (!silent && !disposed && !controller.signal.aborted && state.provider === channel) {
        publish({ notice: '模型目录刷新未完成，可稍后点「刷新目录」重试。' })
      }
      return false
    } finally {
      writes.delete(controller)
      release()
    }
  }

  function autoRefreshCatalog() {
    if (disposed || state.loading) return Promise.resolve(false)
    const channel = state.provider
    if (!packAllowed(channel) || providerById(channel)?.caps?.cliCatalog) return Promise.resolve(false)
    const sides = modelProvidersOf(channel)
    if (!sides.length || autoRefreshed.has(channel)) return Promise.resolve(false)
    if (sides.every(side => state.modelSource[side] === 'remote')) return Promise.resolve(false)
    autoRefreshed.add(channel)
    return refreshCatalog(undefined, { silent: true })
  }

  async function refreshBalances(target, controller, ticket = balanceRevision) {
    try {
      const value = await request('credits.balances', { provider: target }, controller.signal)
      if (value?.snapshot?.at === null) return
      if (disposed || controller.signal.aborted || target !== state.provider) return
      if (ticket !== balanceRevision) return
      publish({ balances: balancesFrom(value).map(balance => ({ ...balance, stale: balance.stale || value?.snapshot?.stale === true })) })
      cache.rememberChannel(target, state)
    } catch {
      if (!disposed && !controller.signal.aborted && target === state.provider && ticket === balanceRevision) {
        publish({ notice: '余额更新失败。' })
      }
    }
  }

  async function refreshLight(backgroundOnly = false) {
    if (disposed || state.busy) return false
    if (sync.hasSnapshots()) return sync.readHostSnapshots()
    if (backgroundOnly || state.loading) return false
    const target = state.provider
    if (target === PLAN_PROVIDER_ID || target === WORKBUDDY_ID || providerById(target)?.snapshot) return false
    const controller = new AbortController()
    sync.setLightController(controller)
    try {
      const statuses = await request('provider.status', { providers: PACK_PROVIDERS.map(p => p.id) }, controller.signal)
      if (!disposed && !controller.signal.aborted) { publish({ statuses: statusFrom(statuses) }); cache.persistCards(state) }
    } catch { /* 静默：下一轮再试 */ }
    finally { sync.clearLightController(controller) }
    if (state.accounts.length > 0 && state.provider === target) void refreshLatestBalances(target)
    return true
  }

  async function refreshSettings(targetProvider = state.provider) {
    if (!sync.hasSnapshots()) return load()
    const target = targetProvider || state.provider
    if (state.loadFailed && target === state.provider) void load(target)
    try {
      await request('settings.refresh', { provider: target }, lifetime.signal)
      if (!disposed && (target === 'all' || state.provider === target)) publish({ notice: '已请求更新。' })
      return true
    } catch {
      if (!disposed && (target === 'all' || state.provider === target)) publish({ notice: '更新请求失败。' })
      return false
    }
  }

  function refreshLatestBalances(target) {
    balanceController?.abort()
    const controller = new AbortController()
    balanceController = controller
    return refreshBalances(target, controller, ++balanceRevision)
  }

  function scopeOf(method, payload, channel) {
    if (AUTOMATION_METHODS.has(method)) return 'automation'
    if (method.includes('Model') || method.startsWith('model.')) return `models:${payload?.provider || channel}`
    if (method.includes('login') || method.includes('Login') || method === 'account.create' || method === 'login.poll') return `login:${channel}`
    if (payload?.accountId) return `account:${payload.accountId}`
    if (method.endsWith('setEnabled') || method.endsWith('setKey') || method === 'credits.permanentLock') return `channel:${payload?.provider || channel}`
    return `channel:${channel}`
  }

  async function mutate(method, payload = {}, options = {}) {
    const channel = state.provider
    const scope = options.scope || scopeOf(method, payload, channel)
    // 同 scope 防重入；整页 loading 时不插队；不同 scope 可非阻塞并发（非独占）。
    if (disposed || state.loading || pending.has(scope)) return false
    const known = !!payload.accountId && (state.accounts.some(a => a.id === payload.accountId)
      || !!providerById(state.provider)?.managedAccount?.(state, payload.accountId))
    if (payload.accountId && !['account.create', 'login.poll'].includes(method) && !known) {
      publish({ notice: '账号已变化，请刷新后重试。' }); return false
    }
    const account = typeof payload.accountId === 'string'
      ? state.accounts.find(entry => entry.id === payload.accountId) : undefined
    const targetProvider = typeof payload.provider === 'string' ? payload.provider
      : account?.provider || state.provider
    writeRevision++
    const controller = new AbortController()
    writes.add(controller)
    const release = pending.enter(scope)
    publish({ notice: options.progress || '正在应用，请稍候…' })
    try {
      const result = await request(method, { provider: targetProvider, ...payload }, controller.signal)
      try { await options.result?.(result, targetProvider) }
      catch (error) {
        if (!disposed && state.provider === channel) publish({ notice: typeof error?.message === 'string' && error.message ? error.message : '操作未完成，请刷新确认状态后重试。' })
        return false
      }
      if (!disposed && state.provider === channel) {
        let reloaded = null
        if (options.refresh !== false) reloaded = await load(channel, false, true)
        if (!disposed && state.provider === channel) {
          const done = typeof options.message === 'function' ? options.message(result) : options.message || '已应用。'
          publish({ notice: reloaded === false ? `${done}列表更新失败，显示上次结果。` : done })
        }
      }
      return true
    } catch {
      if (!disposed && state.provider === channel) publish({ notice: controller.signal.aborted
        ? '请求已取消。' : '操作失败。' })
      return false
    } finally {
      writes.delete(controller)
      release()
      if (!disposed && sync.hasSnapshots()) void sync.readHostSnapshots()
    }
  }

  async function planMutate(method, payload, options = {}) {
    const scope = options.scope || (method.includes('Model') ? `models:${PLAN_PROVIDER_ID}` : `channel:${PLAN_PROVIDER_ID}`)
    if (disposed || pending.has(scope) || state.loading || state.provider !== PLAN_PROVIDER_ID) return false
    const controller = new AbortController()
    planRevision++
    writeRevision++
    planController?.abort()
    planController = null
    writes.add(controller)
    const release = pending.enter(scope)
    publish({ notice: options.progress || '正在应用商汤设置…' })
    try {
      const result = await request(method, { provider: PLAN_PROVIDER_ID, ...payload }, controller.signal)
      if (disposed || state.provider !== PLAN_PROVIDER_ID) return true
      if (options.result) {
        options.result(result)
        cache.persistCards(state)
        publish({ notice: options.message || '商汤设置已保存。' })
      } else {
        const refreshed = await loadPlan(PLAN_PROVIDER_ID, true)
        if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: refreshed ? options.message || '商汤设置已保存。' : '设置已保存，但模型目录读取未完成。' })
      }
      return true
    } catch {
      if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: controller.signal.aborted ? '请求已取消。' : '商汤设置保存失败。' })
      return false
    } finally {
      writes.delete(controller)
      release()
      if (!disposed && sync.hasSnapshots()) void sync.readHostSnapshots()
    }
  }

  const store = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    isPending: scope => pending.has(scope),
    load,
    readHostSnapshots: () => sync.readHostSnapshots(),
    refreshSettings,
    refreshLight,
    prefetchCards: () => sync.prefetchCards(),
    refreshModels(target) { return refreshCatalog(target) },
    autoRefreshModels() { return autoRefreshCatalog() },
    ...Object.assign({}, ...PROVIDERS.map(item => item.createActions?.({
      getState: () => state, isDisposed: () => disposed, hasSnapshots: () => sync.hasSnapshots(),
      request, publish, mutate, planMutate, loadManaged, loginUrlTimers, writes,
      persistCards: () => cache.persistCards(state),
    }))),
    message(notice) { publish({ notice }) },
    async setAutomationConfig(patch) {
      if (disposed || pending.has('automation')) return false
      const controller = new AbortController()
      writes.add(controller)
      const release = pending.enter('automation')
      writeRevision++
      try {
        const value = await request('automation.setConfig', patch, controller.signal)
        if (!disposed) {
          const next = automationFrom(value)
          publish({ ...(next ? { automation: next } : {}), notice: '自动化设置已保存。' })
          if (sync.hasSnapshots()) void sync.readHostSnapshots()
        }
        return true
      } catch {
        if (!disposed) publish({ notice: '自动化设置保存失败。' })
        return false
      } finally {
        writes.delete(controller)
        release()
      }
    },
    async runAutomationTask(targetProvider, mode = 'claimRewards', accountId) {
      const target = targetProvider || state.provider
      const scope = `tasks:${target}:${mode}`
      if (disposed || pending.has(scope)) return false
      const controller = new AbortController()
      writes.add(controller)
      const release = pending.enter(scope)
      writeRevision++
      publish({ notice: mode === 'completeTasks' ? '正在执行自动任务…' : '正在领取奖励…' })
      try {
        const value = await request('automation.run', { provider: target, mode, ...(accountId ? { accountId } : {}) }, controller.signal)
        if (!disposed && state.provider === target) {
          const list = Array.isArray(value?.results) ? value.results : []
          const okCount = list.filter(r => ['claimed', 'completed'].includes(r.outcome?.kind)).length
          const doneCount = list.filter(r => r.outcome?.kind === 'done').length
          const label = mode === 'completeTasks' ? '任务执行' : '奖励领取'
          publish({ notice: `${label}：${okCount} 个新增，${doneCount} 个已完成。` })
          if (sync.hasSnapshots()) void sync.readHostSnapshots()
        }
        return true
      } catch {
        if (!disposed && state.provider === target) publish({ notice: mode === 'completeTasks' ? '任务执行未完成。' : '奖励领取未完成。' })
        return false
      } finally {
        writes.delete(controller)
        release()
      }
    },
    select(accountId) {
      if (state.accounts.some(a => a.id === accountId)) publish({ selected: accountId, pendingDelete: null })
    },
    save(accountId, nickname, enabled) {
      if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 80 || typeof enabled !== 'boolean') {
        publish({ notice: '请填写 1–80 个字的账号备注。' }); return Promise.resolve(false)
      }
      return mutate('account.update', { accountId, patch: { nickname: nickname.trim(), enabled } }, { message: '账号设置已保存。' })
    },
    accountAction(method, accountId) {
      if (!['account.refresh', 'account.reset', 'account.retest'].includes(method)) return Promise.resolve(false)
      return mutate(method, { accountId })
    },
    prioritize(accountId) {
      const account = state.accounts.find(a => a.id === accountId)
      if (!account) return Promise.resolve(false)
      return mutate('account.reorder', { provider: account.provider || state.provider,
        orderedIds: [accountId, ...state.accounts.filter(a => a.id !== accountId).map(a => a.id)] })
    },
    requestDelete(accountId) {
      const account = state.accounts.find(a => a.id === accountId)
      const managed = providerById(state.provider)?.managedAccount?.(state, accountId)
      if (account || managed) publish({ pendingDelete: { accountId, nickname: account?.nickname ?? managed.name,
        provider: account?.provider || state.provider, nonce: ++confirmation } })
    },
    cancelDelete() { publish({ pendingDelete: null }) },
    confirmDelete(target) {
      const pendingDel = state.pendingDelete
      if (!pendingDel || !target || target.nonce !== pendingDel.nonce || target.accountId !== pendingDel.accountId || target.provider !== pendingDel.provider || target.provider !== state.provider) {
        publish({ notice: '删除确认已失效，请重新选择账号。' }); return Promise.resolve(false)
      }
      publish({ pendingDelete: null })
      const removeAction = providerById(target.provider)?.removeAction
      if (removeAction) return store[removeAction](target.accountId)
      return mutate('account.delete', { accountId: target.accountId }, { message: '账号已移除。' })
    },
    setEnabled(enabled, target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('provider.setEnabled', { provider: targetProvider, enabled: enabled === true })
    },
    toggleModel(key) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      return mutate(model.dead ? 'model.clearDead' : 'model.setDisabled',
        model.dead ? { provider: model.provider, modelId: model.id }
          : { provider: model.provider, modelId: model.id, disabled: !model.disabled })
    },
    setModels(disabled, target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.setAllDisabled', { provider: targetProvider, disabled: disabled === true })
    },
    resetModels(target) {
      const targetProvider = typeof target === 'string' && target ? target : state.provider
      return mutate('model.resetDefaults', { provider: targetProvider }, { message: '已恢复推荐模型。' })
    },
    setModelParams(key, patch) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      const channel = state.provider
      return mutate('model.setParams', { provider: model.provider, modelId: model.id, params: patch }, {
        refresh: false, message: '模型参数已保存。',
        result(value) {
          if (state.provider === channel) publish({ params: { ...state.params, ...paramsFrom(value, model.provider) } })
          if (state.provider === channel) cache.rememberChannel(channel, state)
        },
      })
    },
    balances() {
      if (sync.hasSnapshots()) return refreshSettings()
      balanceController?.abort()
      balanceController = null
      const ticket = ++balanceRevision
      return mutate('credits.balances', {}, { refresh: false, progress: '正在查询余额…', message: '余额已更新。',
        result(value, target) {
          if (state.provider !== target || ticket !== balanceRevision) return
          publish({ balances: balancesFrom(value) })
          cache.rememberChannel(target, state)
        },
      })
    },
    claim() {
      if (providerById(state.provider)?.caps?.dailyReward === false) return Promise.resolve(false)
      const target = state.provider
      return mutate('credits.claimAll', {}, { refresh: false, progress: '正在领取每日额度…', message: value => claimMessage(value, target),
        async result(_value, targetProvider) { if (state.provider === targetProvider) await refreshLatestBalances(targetProvider) } })
    },
    onboarding(accountId) {
      const target = typeof accountId === 'string' && accountId !== '' ? accountId : state.selected
      if (!target || !providerById(state.provider)?.caps?.onboarding) { publish({ notice: '请选择账号。' }); return Promise.resolve(false) }
      if (!state.accounts.some(a => a.id === target)) { publish({ notice: '账号已变化，请刷新后重试。' }); return Promise.resolve(false) }
      return mutate('onboarding.claim', { accountId: target }, { refresh: false, progress: '正在领取任务奖励…',
        message: value => `任务领取：${Array.isArray(value?.claimed) ? value.claimed.length : 0} 项新增，${Array.isArray(value?.skipped) ? value.skipped.length : 0} 项已完成。`,
        async result(_value, targetProvider) { if (state.provider === targetProvider) await refreshLatestBalances(targetProvider) } })
    },
    lock(locked) { return mutate('credits.permanentLock', { locked: locked === true }) },
    startLogin() {
      const channel = state.provider
      const existing = loginFor(channel)
      if (existing) { publish({ login: existing, notice: '已有登录等待中，请继续完成。' }); return Promise.resolve(false) }
      const loginProvider = loginProviderOf(channel)
      return mutate('account.create', { provider: loginProvider }, { refresh: false, progress: '正在准备登录…', message: '登录地址已准备好，请点打开登录页面完成授权。',
        result(value) {
          if (typeof value?.accountId !== 'string') throw new Error('登录未准备好')
          const login = { accountId: value.accountId, url: safeLoginUrl(value.loginUrl), createdAt: Date.now() }
          logins.set(channel, login)
          if (state.provider === channel) publish({ login })
        },
      })
    },
    pollLogin() {
      const channel = state.provider
      const login = loginFor(channel)
      if (!login) { publish({ login: null, notice: '登录等待已结束，请重新添加账号。' }); return Promise.resolve(false) }
      let refreshed = null
      return mutate('login.poll', { provider: loginProviderOf(channel), accountId: login.accountId }, { refresh: false, progress: '正在检查登录…',
        message: value => !value?.done ? '尚未完成，请在登录页继续授权后再检查。'
          : !value.success ? '登录失败，请重新添加账号。'
            : refreshed === false ? '登录成功，但账号列表读取失败，请点「刷新」重试。'
              : '登录成功，账号列表已刷新。',
        async result(value) {
          if (!value?.done) return
          logins.delete(channel)
          if (state.provider !== channel) return
          publish({ login: null })
          if (value.success) refreshed = await load(channel, false, true)
        },
      })
    },
    forgetLogin() { logins.delete(state.provider); publish({ login: null, notice: '已结束等待；已打开的授权流程可能仍在进行。' }) },
    dispose() {
      if (disposed) return
      lifetime.abort()
      disposed = true; revision++
      readController?.abort()
      balanceController?.abort(); balanceController = null
      sync.abort()
      stopPlanPolling()
      if (typeof clearTimeout === 'function') for (const id of loginUrlTimers) clearTimeout(id)
      loginUrlTimers.clear()
      for (const controller of writes) controller.abort()
      writes.clear(); listeners.clear(); logins.clear(); autoRefreshed.clear()
      pending.clear()
      cache.clear()
    },
  }
  return store
}

// ── src/client/styles.js ──
// 设置页样式：所有颜色都先走宿主语义变量（--dsw-*）；
// 本地亮色/暗色只承担无宿主变量时的回退（系统色彩媒体查询 + 显式
// light/dark、data-theme、data-color-scheme 选择器）。
//
// 排版约定（改这里之前先读）：
// 1. 颜色 / 间距 / 圆角 / 字阶**只用本文件的变量**，业务分支里不写魔法值；
// 2. 间距走 4/8 网格（--eac-s1…--eac-s6），字号只用 --eac-fs-*；
// 3. 强调色只有一个（--eac-accent），状态色只表达真实语义，不做装饰底色；
// 4. 重复条目用**列表**（.eac-row-item / .eac-model 的紧凑形态），不叠卡片；
// 5. 动效只碰 opacity / transform / 颜色，并响应对 reduced-motion 的关闭。
const CLIENT_STYLES = `
.eac-settings{
  --eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:var(--dsw-alias-bg-layer-2,#f6f7f9);
  --eac-hover:var(--dsw-alias-interactive-bg-hover,#edf0f4);--eac-text:var(--dsw-alias-label-primary,#182230);
  --eac-muted:var(--dsw-alias-label-secondary,#667085);--eac-faint:var(--dsw-alias-label-tertiary,#98a2b3);
  --eac-border:var(--dsw-alias-border-l3,#e2e6eb);--eac-divider:var(--dsw-alias-border-l4,#edf0f3);
  --eac-accent:var(--dsw-alias-brand-primary,#5b5bd6);--eac-on-accent:var(--dsw-alias-label-primary-foreground,#fff);
  --eac-success:var(--dsw-alias-state-success-primary,#16835a);--eac-warn:var(--dsw-alias-state-warn-primary,#a15c07);
  --eac-danger:var(--dsw-alias-state-error-primary,#c43d4b);--eac-shadow:0 1px 2px rgba(16,24,40,.04);
  --eac-s1:4px;--eac-s2:8px;--eac-s3:12px;--eac-s4:16px;--eac-s5:24px;--eac-s6:32px;
  --eac-r-sm:6px;--eac-r:9px;--eac-r-lg:13px;
  --eac-fs-xs:11px;--eac-fs-sm:12px;--eac-fs:13px;--eac-fs-lg:16px;--eac-fs-xl:21px;
  --eac-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  position:relative;display:flex;flex-direction:column;gap:var(--eac-s4);width:100%;max-width:1040px;margin:0 auto;padding:var(--eac-s2) 2px var(--eac-s6);
  min-width:0;box-sizing:border-box;container-type:inline-size;container-name:eac;color:var(--eac-text);font-size:var(--eac-fs);line-height:1.55;
}
.eac-settings *{box-sizing:border-box}
.eac-settings button,.eac-settings input{font:inherit}
.eac-settings button{touch-action:manipulation}
.eac-settings :focus-visible{outline:2px solid var(--eac-accent);outline-offset:2px}
.eac-settings input::placeholder{color:var(--eac-faint);opacity:1}
.eac-settings h2,.eac-settings h3,.eac-settings p{margin:0}

/* ---------- 页头 ---------- */
.eac-header{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);min-width:0;padding:var(--eac-s2) 0 var(--eac-s3);flex-wrap:wrap}
.eac-title{margin:0;font-size:var(--eac-fs-xl);font-weight:690;line-height:1.25;letter-spacing:-.02em}
.eac-header-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none}

/* ---------- 按钮 ---------- */
.eac-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 11px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;line-height:1.4;text-decoration:none;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.eac-button:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-accent) 40%,var(--eac-border));background:var(--eac-subtle)}
.eac-button:active:not(:disabled){transform:translateY(.5px)}
.eac-button:disabled{opacity:.45;cursor:not-allowed}
.eac-button.is-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--eac-accent));color:var(--eac-on-accent);font-weight:620}
.eac-button.is-primary:hover:not(:disabled){background:color-mix(in srgb,var(--eac-accent) 88%,var(--eac-text));border-color:transparent}
.eac-button.is-danger{border-color:transparent;background:transparent;color:var(--eac-danger);box-shadow:none}
.eac-button.is-danger:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-danger) 40%,var(--eac-border));background:color-mix(in srgb,var(--eac-danger) 8%,var(--eac-surface))}
.eac-button.is-quiet{border-color:transparent;background:transparent;color:var(--eac-muted)}
.eac-button.is-quiet:hover:not(:disabled){border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-link{padding:0;border:0;background:none;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;text-decoration:none;transition:color .14s ease}
.eac-link:hover:not(:disabled){color:var(--eac-accent)}
.eac-link:disabled{opacity:.45;cursor:not-allowed}
.eac-link.is-danger:hover:not(:disabled){color:var(--eac-danger)}

/* ---------- 渠道 tab ---------- */
/* 渠道选择器：**小卡片网格**（自动换行），不用横向滚动条 —— 滚动条挡住了半个渠道，
   而且藏起来的渠道要用户去猜（用户报障「最上面是左右拖动的滚动条，很难看」）。 */
.eac-providers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--eac-s1);padding:0 0 var(--eac-s1)}
.eac-provider{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;min-height:46px;padding:6px var(--eac-s3);border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);color:var(--eac-muted);cursor:pointer;text-align:left;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-provider:hover{background:var(--eac-subtle);color:var(--eac-text)}
.eac-provider[aria-selected=true]{border-color:color-mix(in srgb,var(--eac-accent) 55%,var(--eac-border));background:color-mix(in srgb,var(--eac-accent) 9%,var(--eac-surface));color:var(--eac-text);box-shadow:0 0 0 1px color-mix(in srgb,var(--eac-accent) 18%,transparent)}
.eac-provider[aria-selected=true] .eac-provider-name{color:var(--eac-accent)}
.eac-provider[aria-selected=true] .eac-provider-meta{color:var(--eac-muted)}
.eac-provider[aria-selected=true] .eac-provider-mark{background:var(--eac-accent);color:var(--eac-on-accent)}
.eac-provider-name{font-size:var(--eac-fs-sm);font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eac-provider-meta{display:flex;align-items:center;gap:5px;color:var(--eac-faint);font-size:var(--eac-fs-xs);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eac-provider-dot{width:5px;height:5px;flex:none;border-radius:50%;background:var(--eac-faint)}
.eac-provider-dot[data-tone=success]{background:var(--eac-success)}
.eac-provider-dot[data-tone=warn]{background:var(--eac-warn)}

/* ---------- 工作区 ---------- */
.eac-workspace{display:flex;flex-direction:column;min-width:0;padding:var(--eac-s3) var(--eac-s5) var(--eac-s5);border:1px solid var(--eac-border);border-radius:var(--eac-r-lg);background:var(--eac-surface)}
.eac-panels{display:flex;align-items:center;gap:var(--eac-s5);min-height:38px;border-bottom:1px solid var(--eac-divider)}
.eac-panel-tab{align-self:stretch;display:flex;align-items:center;gap:6px;margin:0;padding:0;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs);font-weight:580;white-space:nowrap;transition:color .14s ease,border-color .14s ease}
.eac-panel-tab:hover{color:var(--eac-text)}
.eac-panel-tab[aria-selected=true]{border-bottom-color:var(--eac-accent);color:var(--eac-text);font-weight:650}
.eac-panel-tab[aria-selected=true] .eac-tab-badge{background:color-mix(in srgb,var(--eac-accent) 12%,var(--eac-surface));color:var(--eac-accent)}
.eac-panel-body{display:flex;flex-direction:column;gap:var(--eac-s3);padding:var(--eac-s4) 0 0;min-width:0}

/* ---------- 分区骨架 ---------- */
.eac-section{display:flex;flex-direction:column;gap:var(--eac-s3);min-width:0}
.eac-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--eac-s3);min-width:0}
.eac-section-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.eac-section-title{margin:0;font-size:var(--eac-fs-lg);font-weight:660;line-height:1.35;letter-spacing:-.01em}
.eac-section-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none;flex-wrap:wrap;justify-content:flex-end}
.eac-summary{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap;color:var(--eac-muted);font-size:var(--eac-fs-sm);font-variant-numeric:tabular-nums;min-width:0}
.eac-summary strong{color:var(--eac-text);font-weight:640}
.eac-muted{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-sm);line-height:1.5;overflow-wrap:anywhere}
.eac-group{display:flex;flex-direction:column;gap:var(--eac-s2);min-width:0}
.eac-group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap}
.eac-group-title{display:flex;align-items:center;gap:var(--eac-s2);margin:0;color:var(--eac-text);font-size:var(--eac-fs-sm);font-weight:640;letter-spacing:.01em}
.eac-group-actions{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap}

/* ---------- 标签 ---------- */
.eac-tag{display:inline-flex;align-items:center;padding:1px 6px;border:1px solid var(--eac-divider);border-radius:999px;background:var(--eac-subtle);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:570;line-height:1.6;white-space:nowrap}
.eac-tag[data-tone=success]{border-color:color-mix(in srgb,var(--eac-success) 30%,var(--eac-divider));background:color-mix(in srgb,var(--eac-success) 10%,var(--eac-surface));color:var(--eac-success)}
.eac-tag[data-tone=warn]{border-color:color-mix(in srgb,var(--eac-warn) 32%,var(--eac-divider));background:color-mix(in srgb,var(--eac-warn) 10%,var(--eac-surface));color:var(--eac-warn)}
.eac-tag[data-tone=error]{border-color:color-mix(in srgb,var(--eac-danger) 32%,var(--eac-divider));background:color-mix(in srgb,var(--eac-danger) 10%,var(--eac-surface));color:var(--eac-danger)}
.eac-tag[data-tone=info]{border-color:color-mix(in srgb,var(--eac-accent) 28%,var(--eac-divider));background:color-mix(in srgb,var(--eac-accent) 8%,var(--eac-surface));color:var(--eac-accent)}
.eac-status-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--eac-divider);border-radius:999px;background:var(--eac-subtle);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:580;line-height:1.6;white-space:nowrap}
.eac-status-chip::before{content:"";width:5px;height:5px;flex:none;border-radius:50%;background:currentColor}
.eac-status-chip[data-tone=success]{color:var(--eac-success);border-color:color-mix(in srgb,var(--eac-success) 28%,var(--eac-divider))}
.eac-status-chip[data-tone=warn]{color:var(--eac-warn);border-color:color-mix(in srgb,var(--eac-warn) 30%,var(--eac-divider))}
.eac-status-chip[data-tone=error]{color:var(--eac-danger);border-color:color-mix(in srgb,var(--eac-danger) 30%,var(--eac-divider))}

/* ---------- 提示条 ---------- */
.eac-notice{display:flex;align-items:flex-start;gap:var(--eac-s2);padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 22%,var(--eac-border));border-radius:var(--eac-r-sm);background:color-mix(in srgb,var(--eac-accent) 6%,var(--eac-surface));color:var(--eac-text);font-size:var(--eac-fs-sm);overflow-wrap:anywhere}
.eac-notice p{margin:0;min-width:0;flex:1}
.eac-notice-close{padding:0;border:0;background:none;color:var(--eac-muted);cursor:pointer;font-size:14px;line-height:1;flex:none}
.eac-notice-close:hover{color:var(--eac-text)}
.eac-callout{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 24%,var(--eac-border));border-radius:var(--eac-r-sm);background:color-mix(in srgb,var(--eac-accent) 5%,var(--eac-surface))}
.eac-callout-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 220px}
.eac-callout-title{margin:0;font-size:var(--eac-fs);font-weight:620}
.eac-callout-url{margin:0;color:var(--eac-faint);font-family:var(--eac-mono);font-size:var(--eac-fs-xs);line-height:1.5;overflow-wrap:anywhere}
.eac-callout-actions{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap}
.eac-model-reason{margin:0;color:var(--eac-warn);font-size:var(--eac-fs-sm);line-height:1.5;overflow-wrap:anywhere}
.eac-empty{margin:0;padding:var(--eac-s5) var(--eac-s4);border:1px dashed var(--eac-border);border-radius:var(--eac-r);color:var(--eac-muted);text-align:center;font-size:var(--eac-fs-sm)}

/* ---------- 账号列表 ---------- */
.eac-list-box{display:flex;flex-direction:column;border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);overflow:hidden}
.eac-row-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto) auto auto;grid-template-areas:"main metric switch more";align-items:center;gap:var(--eac-s2) var(--eac-s3);padding:var(--eac-s3) var(--eac-s4);border-top:1px solid var(--eac-divider);transition:background .14s ease}
.eac-row-item > .eac-row-main{grid-area:main}.eac-row-item > .eac-switch{grid-area:switch}.eac-row-item > .eac-more{grid-area:more}.eac-row-controls{grid-area:more;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--eac-s2)}
.eac-row-metric{grid-area:metric;min-width:0;display:grid;gap:var(--eac-s1)}
.eac-remaining{display:block;appearance:none;width:100%;height:var(--eac-s1);border:0;border-radius:999px;background:var(--eac-divider);color:var(--eac-accent);overflow:hidden}
.eac-remaining[data-low=true]{color:var(--eac-warn)}
.eac-remaining::-webkit-progress-bar{background:var(--eac-divider)}
.eac-remaining::-webkit-progress-value{background:currentColor}
.eac-remaining::-moz-progress-bar{background:currentColor}
.eac-usage-list{display:grid;gap:var(--eac-s1)}
.eac-usage-detail{min-width:0;padding:var(--eac-s2) var(--eac-s3);border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-surface)}
.eac-usage-detail .eac-remaining{margin-top:var(--eac-s2)}
.eac-row-item:first-child{border-top:0}
.eac-row-item:hover{background:var(--eac-subtle)}
.eac-row-item[data-off=true] .eac-row-copy{opacity:.6}
.eac-row-main{display:flex;align-items:center;gap:var(--eac-s3);min-width:0}
.eac-avatar{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--eac-subtle);border:1px solid var(--eac-divider);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:700}
.eac-row-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.eac-row-head{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s1) var(--eac-s2);min-width:0}
.eac-row-name{font-size:var(--eac-fs);font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.eac-row-meta{display:flex;align-items:center;gap:var(--eac-s2);color:var(--eac-faint);font-size:var(--eac-fs-xs);white-space:nowrap}
.eac-row-credit{display:flex;justify-content:flex-end;align-items:baseline;gap:var(--eac-s1);color:var(--eac-text);font-size:var(--eac-fs-lg);font-weight:640;font-variant-numeric:tabular-nums;line-height:1.2;flex-wrap:wrap}
.eac-row-credit small{color:var(--eac-faint);font-size:var(--eac-fs-xs);font-weight:500}
.eac-row-credit.is-unknown{color:var(--eac-faint);font-size:var(--eac-fs-sm);font-weight:500}
.eac-row-more{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--eac-s3);padding:var(--eac-s3) 0 0;border-top:1px dashed var(--eac-divider);margin-top:var(--eac-s2)}
.eac-row-links{display:flex;align-items:center;gap:var(--eac-s4);flex-wrap:wrap}
.eac-more{padding:4px 8px;border:1px solid transparent;border-radius:var(--eac-r-sm);background:transparent;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-more:hover{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-more[aria-expanded=true]{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-danger-panel{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-danger) 32%,var(--eac-border));border-radius:var(--eac-r-sm);background:color-mix(in srgb,var(--eac-danger) 6%,var(--eac-surface));font-size:var(--eac-fs-sm)}
.eac-danger-panel p{margin:0;min-width:0;flex:1 1 200px}
.eac-danger-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none}

/* ---------- 开关 ---------- */
.eac-switch{position:relative;flex:none;width:32px;height:18px;padding:0;border:1px solid var(--eac-border);border-radius:999px;background:var(--eac-subtle);cursor:pointer;transition:background .16s ease,border-color .16s ease}
.eac-switch[aria-checked=true]{border-color:transparent;background:var(--eac-accent)}
.eac-switch:disabled{opacity:.45;cursor:not-allowed}
.eac-switch-knob{position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--eac-surface);box-shadow:0 1px 2px rgba(16,24,40,.18);transition:transform .16s ease}
.eac-switch[aria-checked=true] .eac-switch-knob{transform:translateX(14px)}

/* ---------- 模型 ---------- */
.eac-model-list{display:flex;flex-direction:column;border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);overflow:hidden}
.eac-model{display:flex;flex-direction:column;gap:var(--eac-s2);min-width:0;padding:var(--eac-s2) var(--eac-s3);border-top:1px solid var(--eac-divider);transition:background .14s ease}
.eac-model:first-child{border-top:0}
.eac-model:hover{background:var(--eac-subtle)}
.eac-model[data-disabled=true] .eac-model-name{color:var(--eac-muted)}
.eac-model-head{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,max-content) auto;grid-template-areas:"switch copy defaults aside";align-items:center;gap:var(--eac-s3);min-width:0}
.eac-model-head>.eac-switch{grid-area:switch}.eac-model-copy{grid-area:copy}.eac-model-defaults{grid-area:defaults}.eac-model-aside{grid-area:aside}
.eac-model-copy{display:flex;flex-direction:column;align-items:flex-start;gap:var(--eac-s1);min-width:0}
.eac-model-name{font-size:var(--eac-fs);font-weight:620;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:100%}
.eac-model-id{color:var(--eac-faint);font-family:var(--eac-mono);font-size:var(--eac-fs-xs);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;max-width:15em}
.eac-model-defaults{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-xs);line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.eac-model-aside{display:flex;align-items:center;gap:var(--eac-s2);flex:none}
.eac-model-tags{display:flex;align-items:center;gap:var(--eac-s1);flex-wrap:wrap;min-width:0}
.eac-model-reason{padding-left:44px}
.eac-pagination{display:flex;align-items:center;justify-content:center;gap:var(--eac-s3);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-variant-numeric:tabular-nums}

/* ---------- 表单 ---------- */
.eac-input{width:100%;min-height:30px;padding:5px 9px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);font-size:var(--eac-fs-sm);outline:none;transition:border-color .14s ease}
.eac-input:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-accent) 30%,var(--eac-border))}
.eac-input:focus{border-color:var(--eac-accent)}
.eac-input:disabled{opacity:.5;cursor:not-allowed}
.eac-account-form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:var(--eac-s3)}
.eac-field{display:flex;flex-direction:column;gap:var(--eac-s1);color:var(--eac-muted);font-size:var(--eac-fs-xs);min-width:0}
.eac-checkbox{display:flex;align-items:center;gap:var(--eac-s2);color:var(--eac-muted);font-size:var(--eac-fs-sm);cursor:pointer;user-select:none}
.eac-checkbox input{width:14px;height:14px;accent-color:var(--eac-accent);cursor:pointer}
.eac-form-actions{display:flex;align-items:center;gap:var(--eac-s2);grid-column:1/-1;flex-wrap:wrap}

/* ---------- 参数编辑器 ---------- */
.eac-params{display:flex;flex-direction:column;gap:var(--eac-s3);padding:var(--eac-s3);border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-subtle)}
.eac-param-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:var(--eac-s3)}
.eac-model-tools{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s2) var(--eac-s3)}
.eac-model-tools .eac-model-search{flex:1 1 12rem;min-width:0}
.eac-param-group{display:flex;flex-direction:column;gap:var(--eac-s1);min-width:0}
.eac-param-group+.eac-param-group{padding-top:var(--eac-s3);border-top:1px solid var(--eac-divider)}
.eac-group-title{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-sm);font-weight:620;letter-spacing:.01em}
.eac-tier-row{display:flex;gap:var(--eac-s1);flex-wrap:wrap}
.eac-tier{flex:1 1 auto;min-width:58px;min-height:28px;padding:4px 8px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-xs);font-weight:560;line-height:1.4;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-tier:hover:not(:disabled){border-color:var(--eac-accent);color:var(--eac-text)}
.eac-tier[aria-pressed=true]{border-color:var(--eac-accent);background:color-mix(in srgb,var(--eac-accent) 10%,var(--eac-surface));color:var(--eac-accent);font-weight:620}
.eac-tier:disabled{opacity:.45;cursor:not-allowed}
.eac-params-note{margin:0;color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.5}

/* ---------- 卡片组（渠道设置 / 额度池） ---------- */
.eac-plan-window-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--eac-s2);color:var(--eac-muted);font-size:var(--eac-fs-xs);flex-wrap:wrap}
.eac-plan-window-head strong{color:var(--eac-text);font-size:var(--eac-fs-sm);font-weight:640;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.eac-plan-window-meta{display:flex;justify-content:space-between;gap:var(--eac-s2);margin-top:var(--eac-s1);color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.5;flex-wrap:wrap}

@media(prefers-color-scheme:dark){
  .eac-settings{--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:var(--dsw-alias-bg-layer-2,#22252b);--eac-hover:var(--dsw-alias-interactive-bg-hover,#2c3038);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:var(--dsw-alias-label-secondary,#a7afbC);--eac-faint:var(--dsw-alias-label-tertiary,#7d8692);--eac-border:var(--dsw-alias-border-l3,#353a43);--eac-divider:var(--dsw-alias-border-l4,#2b3038);--eac-accent:var(--dsw-alias-brand-primary,#8b8cf0);--eac-on-accent:var(--dsw-alias-label-primary-foreground,#fff);--eac-success:var(--dsw-alias-state-success-primary,#55c994);--eac-warn:var(--dsw-alias-state-warn-primary,#e0a458);--eac-danger:var(--dsw-alias-state-error-primary,#f0848f);--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
}
:where(.dark,[data-theme=dark],[data-color-scheme=dark]) .eac-settings,.eac-settings:where(.dark,[data-theme=dark],[data-color-scheme=dark]){--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:var(--dsw-alias-bg-layer-2,#22252b);--eac-hover:var(--dsw-alias-interactive-bg-hover,#2c3038);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:var(--dsw-alias-label-secondary,#a7afbc);--eac-faint:var(--dsw-alias-label-tertiary,#7d8692);--eac-border:var(--dsw-alias-border-l3,#353a43);--eac-divider:var(--dsw-alias-border-l4,#2b3038);--eac-accent:var(--dsw-alias-brand-primary,#8b8cf0);--eac-on-accent:var(--dsw-alias-label-primary-foreground,#fff);--eac-success:var(--dsw-alias-state-success-primary,#55c994);--eac-warn:var(--dsw-alias-state-warn-primary,#e0a458);--eac-danger:var(--dsw-alias-state-error-primary,#f0848f);--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
:where(.light,[data-theme=light],[data-color-scheme=light]) .eac-settings,.eac-settings:where(.light,[data-theme=light],[data-color-scheme=light]){--eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:var(--dsw-alias-bg-layer-2,#f6f7f9);--eac-hover:var(--dsw-alias-interactive-bg-hover,#edf0f4);--eac-text:var(--dsw-alias-label-primary,#182230);--eac-muted:var(--dsw-alias-label-secondary,#667085);--eac-faint:var(--dsw-alias-label-tertiary,#98a2b3);--eac-border:var(--dsw-alias-border-l3,#e2e6eb);--eac-divider:var(--dsw-alias-border-l4,#edf0f3);--eac-accent:var(--dsw-alias-brand-primary,#5b5bd6);--eac-on-accent:var(--dsw-alias-label-primary-foreground,#fff);--eac-success:var(--dsw-alias-state-success-primary,#16835a);--eac-warn:var(--dsw-alias-state-warn-primary,#a15c07);--eac-danger:var(--dsw-alias-state-error-primary,#c43d4b);--eac-shadow:0 1px 2px rgba(16,24,40,.04)}
@container eac (max-width:640px){
  .eac-header{align-items:center}
  .eac-workspace{padding:var(--eac-s2) var(--eac-s3) var(--eac-s4)}
  .eac-panels{gap:var(--eac-s4)}.eac-panel-body{padding:var(--eac-s3) 0 0}
  .eac-section-head{flex-direction:column}.eac-section-actions{justify-content:flex-start}.eac-group-actions{justify-content:flex-start}
  .eac-workspace[data-panel=models] .eac-section-head{flex-direction:row;align-items:center;flex-wrap:wrap;gap:var(--eac-s2)}
  .eac-workspace[data-panel=models] .eac-section-actions{max-width:100%}
  .eac-row-item{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"main switch more" "metric metric metric";gap:var(--eac-s2);padding:var(--eac-s3)}
  .eac-row-credit{justify-content:flex-start}
  .eac-row-item>.eac-row-more{grid-area:auto;grid-column:1/-1;margin-top:0}
  .eac-account-form{grid-template-columns:1fr}.eac-form-actions{grid-column:1}
  .eac-model-head{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"switch copy aside" "defaults defaults defaults";row-gap:var(--eac-s1)}
  .eac-model-defaults{text-align:left;white-space:normal}
  /* ⚠️ **绝不隐藏模型 id**：小浣熊免费/订阅两侧的展示名完全相同（订阅侧 id 多一个
     「-p」后缀），藏了 id 就看不出这一行到底是哪一侧的哪个模型（用户报障）。窄屏只把
     id 从「与名字同一行」改成「名字下面一行」。
     ⚠️ 这里是模板字面量内部：注释里**不能出现反引号**，否则字符串提前闭合、后面的
     片段被当成 JS 执行（踩过一次：ReferenceError: p is not defined）。 */
  .eac-model-copy{flex-direction:column;align-items:flex-start;gap:0}
  .eac-model-id{max-width:100%;flex:0 0 auto;white-space:normal;overflow-wrap:anywhere}
  .eac-model-reason{padding-left:0}
}
/* 极窄（宿主设置面板常见宽度 ~380px）：渠道 tab 由「横向滚动」改「两列网格」。
   横向滚动会把一半渠道藏起来（用户报障「点开是这样」= 只能看到 3 个渠道），
   两列网格仍然是紧凑成排的按钮，但一屏能看全，不用猜右边还有没有东西。 */
@container eac (max-width:470px){
  .eac-providers{grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:0}
  .eac-provider{padding:var(--eac-s2) var(--eac-s3)}
  .eac-provider-name{font-size:var(--eac-fs-sm)}
  .eac-provider-meta{font-size:var(--eac-fs-xs)}
  .eac-title{font-size:var(--eac-fs-lg)}
}
@container eac (max-width:420px){
  .eac-model-head{grid-template-areas:"switch copy edit" "defaults defaults defaults" "tags tags tags"}
  .eac-model-aside{display:contents}
  .eac-model-aside>.eac-button{grid-area:edit}
  .eac-model-aside>.eac-model-tags{grid-area:tags}
  .eac-model-tags:empty{display:none}
}
@container eac (max-width:390px){.eac-title{font-size:15px}.eac-panels{gap:var(--eac-s3)}.eac-panel-tab{font-size:var(--eac-fs-sm)}.eac-row-meta{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.eac-settings *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`

function installStyles() {
  if (typeof document === 'undefined' || !document.head || !document.createElement) return () => {}
  const element = document.createElement('style')
  element.dataset.eacRouter = ''
  element.textContent = CLIENT_STYLES
  document.head.append(element)
  let active = true
  return () => { if (!active) return; active = false; element.remove() }
}

// ── src/client/ui.js ──
// UI 原语与表单组件。
// 原语（button/primary/danger/tag/avatarText）是普通函数调用而不是组件元素，
// 测试按 props 断言；表单（AccountForm/ModelParams 等）是 React 组件，自带 Hook。

const button = (label, onClick, disabled, props = {}) => h('button', {
  ...props, type: props.type || 'button', onClick, disabled,
  className: `eac-button${props.className ? ` ${props.className}` : ''}`,
}, label)
const primary = (label, onClick, disabled, props = {}) => button(label, onClick, disabled, { ...props, className: `is-primary${props.className ? ` ${props.className}` : ''}` })
const danger = (label, onClick, disabled, props = {}) => button(label, onClick, disabled, { ...props, className: `is-danger${props.className ? ` ${props.className}` : ''}` })
const avatarText = name => { const first = Array.from(name || '?')[0] || '?'; return first.toUpperCase() }
const tag = (label, tone, title) => h('span', { key: label, className: 'eac-tag', 'data-tone': tone || undefined, title }, label)
// 参数摘要：只显示真正设过的项，没设过就不占位置。
function paramSummary(value) {
  const parts = []
  if (value.contextWindow !== undefined) parts.push(`上下文 ${formatTokens(value.contextWindow)}`)
  if (value.maxTokens !== undefined) parts.push(`输出 ${formatTokens(value.maxTokens)}`)
  if (value.reasoningEffort !== undefined) parts.push(`思考 ${EFFORT_LABELS[value.reasoningEffort] || value.reasoningEffort}`)
  if (value.supportsImage !== undefined) parts.push(value.supportsImage ? '图片开' : '图片关')
  return parts.join(' · ')
}
/**
 * 单个模型的可调参数。
 *
 * 三个都按**模型真实能力**来给选项，绝不展示它做不到的东西：
 * - 上下文：不超过模型的 contextWindow
 * - 输出上限：不超过模型的 maxTokens；模型没报就不显示这一组
 * - 思考深度：只列模型 efforts 里真实存在的档位
 */
// 精简常用档位（各最多 4 档，去掉无意义小档）：
// - 上下文：200K / 400K / 500K / 1M（若模型上限本身是 256K 或 128K 则保留其自身顶档）
// - 最大输出：64K 起（64K / 128K / 256K / 384K）
// 显示名与模型实际接受的数字分离：如 1_000_000 与 1_048_576 均绑定到「1M」按钮。
const CONTEXT_TIERS = Object.freeze([
  { tokens: 200_000, label: '200K', min: 192_000, max: 210_000 },
  { tokens: 400_000, label: '400K', min: 390_000, max: 420_000 },
  { tokens: 500_000, label: '500K', min: 480_000, max: 530_000 },
  { tokens: 1_000_000, label: '1M', min: 950_000, max: 1_100_000 },
])
// 输出档位全集（64K 起，支持到 MiniMax 512K 与 Kimi 1M）；展示时按模型官方上限与渠道硬上限精选 1–4 档。
const OUTPUT_TIERS = Object.freeze([
  { tokens: 65_536, label: '64K', min: 60_000, max: 67_000 },
  { tokens: 131_072, label: '128K', min: 120_000, max: 135_000 },
  { tokens: 262_144, label: '256K', min: 245_000, max: 268_000 },
  { tokens: 393_216, label: '384K', min: 375_000, max: 405_000 },
  { tokens: 524_288, label: '512K', min: 500_000, max: 560_000 },
  { tokens: 1_048_576, label: '1M', min: 950_000, max: 1_100_000 },
])
const EXTRA_DISPLAY_TIERS = Object.freeze([
  { label: '128K', min: 120_000, max: 136_000 },
  { label: '256K', min: 245_000, max: 268_000 },
  { label: '32K', min: 30_000, max: 33_500 },
  { label: '16K', min: 15_000, max: 17_000 },
])
// 各渠道的档位取值并不统一，这里必须全部认：
// - Loomy/Qoder 是 none..max 的强度档；
// - TRAE 是 light / high / extra_high；
// - Raccoon 老模型是 on/off 两态（见 raccoonThinkingExtraBody）；
// - Raccoon 新目录用托管档位 level_1..level_5（名字与
//   `raccoon-product.ts` 的 RACCOON_THINKING_LEVEL_NAMES 保持一致，两处都要有）。
const EFFORT_LABELS = Object.freeze({
  none: '不思考', minimal: '极少', light: '轻', low: '低', medium: '中', high: '高', extra_high: '极高', xhigh: '极高', max: '最大',
  on: '开启', off: '关闭',
  level_1: '极少', level_2: '低', level_3: '中', level_4: '高', level_5: '最大',
})
function formatTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return String(n ?? '')
  for (const tier of [...CONTEXT_TIERS, ...OUTPUT_TIERS, ...EXTRA_DISPLAY_TIERS]) {
    if (n >= tier.min && n <= tier.max) return tier.label
  }
  if (n >= 950_000) return `${Math.round(n / 1_000_000 * 10) / 10}M`
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return Number(n).toLocaleString('en-US')
}
/**
 * 将常用档位绑定到该模型实际可接受的数值：
 * - 上限落在某档位容差区间内（如 1_048_576 与 1_000_000 都命中 1M、64_000 命中 64K）时，
 *   按钮保留干净显示名（1M / 64K），但真实值绑定为模型上限 `ceiling`；
 * - 若模型上限恰好在两档之间（如 256K / 262_144），将模型上限补为顶档（显示 256K）；
 * - 其余高于上限的档位隐藏；上限未知且 allowUnknown=true 时返回全部 4 个核心档位。
 */
function tiersUnder(all, ceiling, allowUnknown = false) {
  if (typeof ceiling !== 'number' || ceiling <= 0) return allowUnknown ? all : []
  const fitting = []
  let matchedCeiling = false
  for (const tier of all) {
    if (ceiling >= tier.min && ceiling <= tier.max) {
      fitting.push({ ...tier, tokens: ceiling })
      matchedCeiling = true
    } else if (tier.tokens <= ceiling) {
      fitting.push(tier)
    }
  }
  if (!matchedCeiling && ceiling > 0 && (!fitting.length || ceiling > fitting[fitting.length - 1].tokens * 1.15)) {
    fitting.push({ tokens: ceiling, label: formatTokens(ceiling), min: ceiling, max: ceiling })
  }
  return fitting.length > 0 ? fitting : [{ tokens: ceiling, label: formatTokens(ceiling), min: ceiling, max: ceiling }]
}
function matchesTierValue(currentValue, tier) {
  const num = Number(currentValue)
  if (!Number.isFinite(num) || num <= 0) return false
  return num === tier.tokens || (num >= tier.min && num <= tier.max)
}
function defaultParamSummary(model) {
  const parts = []
  if (model.contextWindow > 0) parts.push(`上下文 ${formatTokens(model.contextWindow)}`)
  if (model.defaultMaxTokens > 0) parts.push(`输出 ${formatTokens(model.defaultMaxTokens)}`)
  if (model.efforts.includes(model.defaultEffort)) parts.push(`思考 ${EFFORT_LABELS[model.defaultEffort] || model.defaultEffort}`)
  if (model.supportsImage === true) parts.push('支持图片')
  if (model.supportsImage === false) parts.push('仅文本输入')
  return parts.join(' · ')
}
function currentModelSummary(model) {
  return defaultParamSummary({
    contextWindow: model.contextWindow, defaultMaxTokens: model.maxOutputLength, efforts: model.thinkingLevels,
    defaultEffort: model.params.reasoningEffort ?? model.defaultEffort, supportsImage: model.params.supportsImage ?? model.defaultVision,
  })
}
/**
 * 按模型官方口径与渠道硬上限生成精选输出档位（64K 起，最多 4 档）：
 * - 上限 ≈ 1M（Kimi K3.1 Pro/K3）：64K / 128K / 256K / 1M（顶档精确绑定模型实际值）
 * - 上限 ≈ 512K（MiniMax M3.1 Flash）：64K / 128K / 256K / 512K
 * - 上限 ≈ 384K（DeepSeek V4.1 / OpenPangu 2.1）：64K / 128K / 256K / 384K
 * - 上限 ≈ 256K（Doubao Seed 2.1 / Qwen 4 Max）：64K / 128K / 256K
 * - 上限 ≈ 128K（GLM 5.3 / Qwen 3.8 / MiMo 2.6 / Spark X2.6）：64K / 128K
 * - 上限 ≈ 64K（Hy4 / Step 5 / Agnes）：64K
 * - 有渠道协议硬上限（如 CodeArts 32K）时强制不超过硬上限。
 */
function outputTiersForModel(model, providerId) {
  const provider = providerId || model?.provider || ''
  const hardCap = channelOutputHardCap(provider)
  const spec = officialModelSpec(model?.id, provider)
  const declared = model?.maxTokens ?? model?.defaultMaxOutputLength ?? model?.maxOutputLength ?? 0
  let ceiling = 0
  if (hardCap !== null) {
    ceiling = declared > 0 ? Math.min(hardCap, declared) : hardCap
  } else if (spec?.maxOutput > 0) {
    ceiling = declared > spec.maxOutput ? declared : spec.maxOutput
  } else if (declared > 0) {
    ceiling = declared
  }
  if (ceiling <= 0) return OUTPUT_TIERS.slice(0, 4)
  // 若上限 ≥ 950K（1M 输出，如 Kimi K3.1 Pro）：精选 64K / 128K / 256K / 1M（4 档）
  if (ceiling >= 950_000) {
    return [
      OUTPUT_TIERS[0],
      OUTPUT_TIERS[1],
      OUTPUT_TIERS[2],
      { ...OUTPUT_TIERS[5], tokens: ceiling },
    ]
  }
  // 若上限 ∈ [500K, 560K]（512K 输出，如 MiniMax M3.1 Flash）：精选 64K / 128K / 256K / 512K（4 档）
  if (ceiling >= 500_000 && ceiling <= 560_000) {
    return [
      OUTPUT_TIERS[0],
      OUTPUT_TIERS[1],
      OUTPUT_TIERS[2],
      { ...OUTPUT_TIERS[4], tokens: ceiling },
    ]
  }
  return tiersUnder(OUTPUT_TIERS.slice(0, 4), ceiling, true)
}

function contextTiersForModel(model, providerId) {
  const provider = providerId || model?.provider || ''
  const spec = officialModelSpec(model?.id, provider)
  const declared = model?.contextWindow ?? model?.defaultContextWindow ?? 0
  const ceiling = declared > 0 ? declared : (spec?.context ?? 0)
  return tiersUnder(CONTEXT_TIERS, ceiling, false)
}

function ModelParams({ value, model, providerId, disabled, onSave }) {
  const current = value || {}
  const contextTiers = contextTiersForModel(model, providerId)
  const outputTiers = outputTiersForModel(model, providerId)
  const efforts = Array.isArray(model.efforts) ? model.efforts : []
  // 即点即存，保存成功或失败都留在当前编辑器，便于连续调整或重试。
  const save = patch => { if (!disabled) void onSave(patch) }
  const tierGroup = (label, tiers, key, defaultValue) => h('div', { className: 'eac-param-group' },
    h('p', { className: 'eac-group-title' }, label),
    h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': label },
      h('button', {
        type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current[key] === undefined,
        onClick: () => save({ ...current, [key]: undefined }),
      }, defaultValue > 0 ? `默认（${formatTokens(defaultValue)}）` : '清除覆盖'),
      ...tiers.map(t => h('button', {
        type: 'button', key: t.label, className: 'eac-tier', disabled,
        'aria-pressed': matchesTierValue(current[key], t),
        onClick: () => save({ ...current, [key]: t.tokens }),
      }, t.label))))
  return h('div', { className: 'eac-params' },
    contextTiers.length ? tierGroup('上下文', contextTiers, 'contextWindow', model.contextWindow) : null,
    outputTiers.length ? tierGroup('输出上限', outputTiers, 'maxTokens', model.defaultMaxTokens) : null,
    efforts.length ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '思考深度'),
      h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': '思考深度' },
        h('button', {
          type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current.reasoningEffort === undefined,
          onClick: () => save({ ...current, reasoningEffort: undefined }),
        }, efforts.includes(model.defaultEffort) ? `默认（${EFFORT_LABELS[model.defaultEffort] || model.defaultEffort}）` : '清除覆盖'),
        ...efforts.map(level => h('button', {
          type: 'button', key: level, className: 'eac-tier', disabled,
          'aria-pressed': current.reasoningEffort === level,
          onClick: () => save({ ...current, reasoningEffort: level }),
        }, EFFORT_LABELS[level] || level)))) : null,
    // 图片开关：默认跟随模型能力，可显式关掉（该渠道发图总失败时有用）。
    model.supportsImage !== null ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '图片输入'),
      h('div', { className: 'eac-tier-row' },
        h('button', {
          type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current.supportsImage === undefined,
          onClick: () => save({ ...current, supportsImage: undefined }),
        }, `默认（${model.supportsImage ? '支持' : '不支持'}）`),
        h('button', {
          type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current.supportsImage === true,
          onClick: () => save({ ...current, supportsImage: true }),
        }, '开'),
        h('button', {
          type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current.supportsImage === false,
          onClick: () => save({ ...current, supportsImage: false }),
        }, '关'))) : null,
    // 说明性段落一律不渲染：档位与上限本身就是信息，解释它们只会把页面读成说明书。
    !contextTiers.length && !outputTiers.length && !efforts.length && model.supportsImage === null
      ? h('p', { className: 'eac-muted' }, '该模型未上报可调能力')
      : null)
}
function AccountForm({ account, disabled, save }) {
  const [nickname, setNickname] = React.useState(account.nickname)
  const [enabled, setEnabled] = React.useState(account.enabled)
  React.useEffect(() => { setNickname(account.nickname); setEnabled(account.enabled) }, [account.id, account.nickname, account.enabled])
  return h('form', { className: 'eac-account-form', onSubmit: event => { event.preventDefault(); void save(account.id, nickname, enabled) } },
    h('label', { className: 'eac-field' },
      h('span', null, '账号备注'),
      h('input', { className: 'eac-input', type: 'text', value: nickname, maxLength: 80, required: true, disabled, placeholder: '例如：主力账号', onChange: e => setNickname(e.target.value) })),
    h('label', { className: 'eac-checkbox' },
      h('input', { type: 'checkbox', checked: enabled, disabled, onChange: e => setEnabled(e.target.checked) }),
      '参与自动选号'),
    h('div', { className: 'eac-form-actions' }, primary('保存账号', undefined, disabled, { type: 'submit' })))
}
function displayNumber(value) {
  if (typeof value === 'string') return value
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}
function displayTime(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function remainingFraction(remaining, limit) {
  return typeof remaining === 'number' && limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : null
}
function PlanKeyForm({ disabled, onSave }) {
  const [apiKey, setApiKey] = React.useState('')
  return h('form', { className: 'eac-account-form', onSubmit: async event => {
    event.preventDefault()
    const submission = onSave(apiKey)
    setApiKey('')
    await submission
  } },
    h('label', { className: 'eac-field' }, h('span', null, 'API Key'), h('input', { className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled, value: apiKey, onChange: e => setApiKey(e.target.value) })),
    h('div', { className: 'eac-form-actions' }, primary('保存 API Key', undefined, disabled, { type: 'submit' })))
}
function CredentialImportForm({ disabled, hint, onSave, onCancel }) {
  const [credential, setCredential] = React.useState('')
  return h('form', { className: 'eac-account-form', onSubmit: async event => {
    event.preventDefault()
    const raw = credential
    setCredential('')
    await onSave(raw)
  } },
    h('label', { className: 'eac-field' },
      h('span', null, '凭据内容'),
      h('input', {
        className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled,
        placeholder: hint || '粘贴 Token、Cookie 或 JSON 凭据', value: credential,
        onChange: e => setCredential(e.target.value),
      })),
    h('div', { className: 'eac-form-actions' },
      primary('导入凭据', undefined, disabled, { type: 'submit' }),
      onCancel ? button('取消', onCancel, disabled) : null))
}
function PlanModelParams({ model, providerId, disabled, value, setValue, onSave }) {
  const [error, setError] = React.useState('')
  const draft = value ?? {}
  const set = (field, next) => { setError(''); setValue({ ...draft, [field]: next }) }
  const options = (values, labels) => values.map(option =>
    h('option', { key: option, value: option }, labels?.[option] ?? option))
  const choose = (label, current, values, change, labels, defaultLabel) => h('label', { className: 'eac-field', key: label },
    h('span', null, label), h('select', { className: 'eac-input', value: current ?? '', disabled,
      onChange: event => change(event.target.value) }, h('option', { value: '' }, defaultLabel), ...options(values, labels)))
  const contextCeiling = model.defaultContextWindow ?? model.contextWindow
  const outputDefault = model.defaultMaxOutputLength ?? model.maxOutputLength
  const contextTiers = contextTiersForModel({ ...model, contextWindow: contextCeiling }, providerId)
  const outputTiers = outputTiersForModel(model, providerId)
  const tokenField = (label, field, effective, tiers) => h('div', { className: 'eac-param-group', key: field },
    h('p', { className: 'eac-group-title' }, label),
    tiers.length ? h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': `${label}档位` },
      h('button', {
        type: 'button', className: 'eac-tier', disabled,
        'aria-pressed': draft[field] == null || draft[field] === '',
        onClick: () => set(field, null),
      }, effective > 0 ? `默认（${formatTokens(effective)}）` : '默认'),
      ...tiers.map(t => h('button', {
        type: 'button', key: t.label, className: 'eac-tier', disabled,
        'aria-pressed': matchesTierValue(draft[field], t),
        onClick: () => set(field, t.tokens),
      }, t.label))) : null,
    h('label', { className: 'eac-field' },
      h('span', null, label),
      h('input', { className: 'eac-input', type: 'number', inputMode: 'numeric', min: 1, max: 10000000, step: 1, disabled,
        value: draft[field] ?? '', placeholder: effective > 0 ? `默认 ${formatTokens(effective)}` : '',
        onChange: event => set(field, event.target.value) })))
  const apply = event => {
    event.preventDefault()
    const { maxTokens = null, contextWindow = null, supportsImage = null, reasoningEffort = null } = draft
    const params = { maxTokens, contextWindow, supportsImage, reasoningEffort }
    for (const field of ['maxTokens', 'contextWindow']) {
      params[field] = params[field] == null || params[field] === '' ? null : Number(params[field])
      if (params[field] !== null && !modelTokenValue(params[field])) {
        setError('请输入 1 至 10,000,000 的整数。')
        return
      }
    }
    setError('')
    void onSave(params)
  }
  return h('form', { className: 'eac-params', onSubmit: apply, 'aria-label': modelDisplayName(model) + ' 的模型设置' },
    tokenField('上下文 Token', 'contextWindow', contextCeiling, contextTiers),
    tokenField('最大输出 Token', 'maxTokens', outputDefault, outputTiers),
    h('div', { className: 'eac-param-grid' },
      model.thinkingLevels.length ? choose('默认思考档位', draft.reasoningEffort, model.thinkingLevels,
        next => set('reasoningEffort', next || null), EFFORT_LABELS,
        model.defaultEffort ? `默认（${EFFORT_LABELS[model.defaultEffort] ?? model.defaultEffort}）` : '清除覆盖') : null,
      choose('图片输入', draft.supportsImage == null ? '' : String(draft.supportsImage), ['true', 'false'],
        next => set('supportsImage', next === '' ? null : next === 'true'), { true: '开启', false: '关闭' },
        model.defaultVision === null ? '自动（保留文本输入）' : `默认（${model.defaultVision ? '开启' : '关闭'}）`)),
    error ? h('p', { className: 'eac-model-reason', role: 'alert' }, error) : null,
    h('div', { className: 'eac-form-actions' },
      primary('保存参数', undefined, disabled, { type: 'submit' }),
      button('恢复默认', () => void onSave({ maxTokens: null, contextWindow: null, supportsImage: null, reasoningEffort: null }), disabled)))
}

// ── src/client/kit/index.js ──
// 设计系统原语（kit）：**唯一允许拼 JSX 的地方**。
//
// 为什么单独一层（见 docs/ARCHITECTURE-REVIEW.md §3）：之前每个渠道模块自己拼
// `<section class="eac-section">` + 标题 + 操作按钮 + 列表，于是每接一个渠道就多一套
// 交互（"想到什么堆什么"）。现在把「分区骨架」「列表行」「开关/徽标/空态」这些
// **不可变的形状**收在这里，provider 模块只提供数据与动作。
//
// 纪律：
// 1. 组件不接受任意 className 覆写（要改样式改 styles.js 的令牌/规则）；
// 2. 交互位置固定：主 CTA 在分区标题右侧，破坏性动作弱化为文字按钮；
// 3. 一切列表条目都走 Row，不允许 provider 自己造第二种行形状。

/** 分区骨架：标题 + 一行指标 + 右侧动作 + 内容。 */
const Section = ({ title, summary, actions, children }) => h('section', { className: 'eac-section' },
  h('div', { className: 'eac-section-head' },
    h('div', { className: 'eac-section-copy' },
      h('h3', { className: 'eac-section-title' }, title),
      summary === undefined || summary === null ? null : h('p', { className: 'eac-summary' }, summary)),
    actions === undefined || actions === null ? null
      : h('div', { className: 'eac-section-actions' }, actions)),
  children)

/** 列表容器：条目之间只有分隔线，不叠卡片。 */
const ListBox = ({ children }) => h('div', { className: 'eac-list-box' }, children)

/** 开关（role=switch，键盘可用）。 */
const Switch = ({ checked, disabled, label, onChange }) => h('button', {
  type: 'button', className: 'eac-switch', role: 'switch', disabled,
  'aria-checked': checked, 'aria-label': label, onClick: onChange,
}, h('span', { className: 'eac-switch-knob', 'aria-hidden': 'true' }))

/**
 * 列表行：**所有渠道的账号/用量/条目都用它**。
 *
 * 形状固定为「主体（头像 + 名称 + 徽标 + 副行） | 指标 | 开关 | 展开」，
 * 展开区（`detail`）承载明细与维护动作，默认收起 —— 不再把所有信息平铺。
 */
const Row = ({ key, avatar, name, tags, meta, metric, switchControl, controls, moreLabel, expanded, onToggle, detail, tone }) =>
  h('div', { key, className: 'eac-row-item', 'data-off': tone === 'off' ? 'true' : undefined },
    h('div', { className: 'eac-row-main' },
      avatar === undefined ? null : h('span', { className: 'eac-avatar', 'aria-hidden': 'true' }, avatar),
      h('div', { className: 'eac-row-copy' },
        h('span', { className: 'eac-row-head' },
          h('span', { className: 'eac-row-name', title: name }, name),
          tags),
        meta === undefined ? null : h('span', { className: 'eac-row-meta' }, meta))),
    metric === undefined ? null : metric,
    switchControl === undefined ? null : switchControl,
    controls?.length ? h('div', { className: 'eac-row-controls' }, ...controls) : null,
    moreLabel === undefined ? null
      : h('button', {
        type: 'button', className: 'eac-more', 'aria-expanded': expanded, 'aria-label': `${name} 的更多操作`,
        onClick: onToggle,
      }, expanded ? '收起' : moreLabel),
    expanded && detail ? h('div', { className: 'eac-row-more' }, detail) : null)

/** 空态：三态区分（读取中 / 失败+重试 / 确实没有）。 */
const EmptyState = ({ loading, failed, onRetry, disabled, emptyText, loadingText }) => {
  if (loading) return h('p', { className: 'eac-empty' }, loadingText ?? '正在读取…')
  if (failed) {
    return h('div', { className: 'eac-empty' },
      h('span', null, '读取失败。'),
      button('重试', onRetry, disabled))
  }
  return h('p', { className: 'eac-empty' }, emptyText)
}

/** 指标块（余额/用量数字）：数字比标签大，等宽数字。 */
const remainingBar = (fraction, label) => typeof fraction === 'number'
  ? h('progress', { className: 'eac-remaining', 'data-low': fraction <= 0.1 || undefined, max: 1, value: fraction,
    'aria-label': `${label}的剩余额度` })
  : null

const Metric = ({ value, unit, fraction, label }) =>
  h('div', { className: 'eac-row-metric' },
    h('span', { className: `eac-row-credit${typeof value === 'string' ? ' is-unknown' : ''}` },
      displayNumber(value), unit === undefined ? null : h('small', null, unit)),
    remainingBar(fraction, label))

// ── src/client/panels-core.js ──
const SETTINGS_PANELS = [
  { id: 'models', label: '模型' },
  { id: 'accounts', label: '账号与额度' },
  { id: 'advanced', label: '渠道' },
]

function renderTags(tags = []) {
  return tags.filter(Boolean).map(([label, tone, title]) => tag(label, tone, title))
}

function renderActions(actions = [], ui, scope) {
  const locked = scope ? (ui.loading || ui.isPending(scope)) : ui.disabled
  return actions.filter(Boolean).map(({ label, call, panel, open, primary: main, danger: destructive, disabled, accessible }) => {
    const run = panel ? () => ui.setPanel(panel, open) : () => ui.act(...call)
    const makeButton = main ? primary : destructive ? danger : button
    return makeButton(label, run, locked || disabled, { key: label, 'aria-label': accessible })
  })
}

const SETTINGS_FORMS = { account: AccountForm, key: PlanKeyForm }
function renderForm(form, ui, key, scope) {
  if (!form) return null
  const save = (...args) => ui.invoke(...form.call, ...args)
  const formScope = scope || `channel:${ui.providerId}`
  return h(SETTINGS_FORMS[form.kind], { key, account: form.account, disabled: ui.loading || ui.isPending(formScope), save, onSave: save })
}

function renderQuotaGroup(group) {
  return h('div', { className: 'eac-group', key: group.title },
    h('p', { className: 'eac-group-title' }, group.title),
    h('div', { className: 'eac-usage-list' }, ...group.items.map((item, index) => h('div', { className: 'eac-usage-detail', key: index },
      h('div', { className: 'eac-plan-window-head' },
        h('span', null, item.label),
        h('strong', null, displayNumber(item.value), item.unit ? ` ${item.unit}` : null)),
      remainingBar(item.fraction, item.label),
      item.notes?.some(Boolean) ? h('div', { className: 'eac-plan-window-meta' },
        ...item.notes.filter(Boolean).map(note => h('span', { key: note }, note))) : null))))
}

function renderConfirmation(confirmation, ui) {
  if (!confirmation) return null
  return h('div', { className: 'eac-danger-panel', role: 'alert', 'aria-label': '确认移除账号' },
    h('p', null, confirmation.label),
    h('div', { className: 'eac-danger-actions' },
      danger(confirmation.confirmLabel || '移除', () => ui.act(...confirmation.call), ui.disabled),
      button('取消', () => ui.act(...confirmation.cancel), ui.disabled)))
}

function renderLogin(login, ui) {
  if (!login) return null
  return h('div', { className: 'eac-callout' },
    h('div', { className: 'eac-callout-copy' },
      h('p', { className: 'eac-callout-title' }, '账号授权'),
      login.url.startsWith('http://') ? h('p', { className: 'eac-muted' }, '本机浏览器') : null,
      login.canCheck ? h('p', { className: 'eac-callout-url' }, login.url) : null),
    h('div', { className: 'eac-callout-actions' },
      h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer', className: 'eac-button is-primary' }, '打开登录页'),
      login.canCheck ? button('复制链接', async () => {
        try {
          await globalThis.navigator.clipboard.writeText(login.url)
          ui.act('message', '登录链接已复制。')
        } catch { ui.act('message', '复制失败。') }
      }, ui.disabled) : null,
      login.canCheck ? button('检查登录', () => ui.act('pollLogin'), ui.disabled) : null,
      login.canCheck ? button('取消', () => ui.act('forgetLogin'), ui.disabled) : null))
}

function AccountsPanel(view, ui) {
  const { rows } = view
  const summary = []
  if (rows.length) summary.push(`${rows.length} 个账号`)
  if (typeof view.autoCheckin === 'boolean') {
    summary.push(tag(view.autoCheckin ? '自动签到已开启' : '自动签到已关闭'))
  }
  const showImport = view.importForm && ui.importOpen === ui.providerId
  return Section({
    title: '账号与额度',
    summary: summary.length ? summary : null,
    actions: renderActions(view.actions, ui, `login:${ui.providerId}`),
    children: [
      renderLogin(view.login, ui),
      showImport ? h('div', { className: 'eac-callout' },
        h(CredentialImportForm, {
          key: `import:${ui.providerId}`,
          hint: view.importForm.hint,
          disabled: ui.loading || ui.isPending(`login:${ui.providerId}`),
          onSave: async raw => {
            const ok = await ui.invoke(...view.importForm.call, raw)
            if (ok) ui.act('toggleImportForm', '')
            return ok
          },
          onCancel: () => ui.act('toggleImportForm', ''),
        })) : null,
      rows.length ? ListBox({ children: rows.map(row => {
        const key = `${ui.providerId}:account:${row.id}`
        const accountScope = `account:${row.id}`
        const rowDisabled = ui.loading || ui.isPending(accountScope)
        const manageable = !!(row.groups?.length || row.form || row.actions?.length)
        return Row({
          key, name: row.name, avatar: avatarText(row.name), tags: renderTags(row.tags),
          meta: row.updatedAt ? `更新于 ${displayTime(row.updatedAt)}` : undefined,
          metric: row.metric ? Metric({ ...row.metric, label: row.name }) : undefined,
          tone: row.enabled === false ? 'off' : undefined,
          switchControl: row.toggle ? Switch({ checked: row.enabled, disabled: rowDisabled,
            label: `启用账号 ${row.name}`, onChange: () => ui.act(...row.toggle) }) : undefined,
          moreLabel: manageable ? '管理' : undefined, expanded: ui.more[key] === true,
          onToggle: () => ui.act('toggleMore', key),
          detail: [
            ...(row.groups ?? []).map(renderQuotaGroup),
            row.form ? h('div', { key: 'form' }, renderForm(row.form, ui, `${ui.providerId}:${row.id}`, accountScope)) : null,
            row.actions?.length ? h('div', { className: 'eac-row-links', key: 'actions' }, ...renderActions(row.actions, ui, accountScope)) : null,
            row.confirmation ? h('div', { key: 'confirm' }, renderConfirmation(row.confirmation, ui)) : null,
          ],
        })
      }) }) : EmptyState({ loading: !view.ready && !view.failed, failed: view.failed,
        onRetry: () => ui.act('refreshSettings'), emptyText: '还没有账号。', loadingText: '正在读取账号…' }),
    ],
  })
}

function renderModelEditor(model, ui, modelDisabled) {
  const { editor, key } = model
  const onSave = value => ui.invoke(...editor.call, value)
  const providerId = model.provider || ui.providerId
  if (editor.kind === 'tiers') return h(ModelParams, { key, model, providerId, value: editor.value, disabled: modelDisabled, onSave })
  const draft = ui.drafts[key]
  const value = draft ?? model.params
  return h(PlanModelParams, {
    key, model, providerId, disabled: modelDisabled, value,
    setValue: value => ui.setDrafts(current => ({ ...current, [key]: value })),
    async onSave(value) {
      const ok = await onSave(value)
      if (ok) ui.setDrafts(current => {
        if (current[key] !== draft) return current
        const next = { ...current }; delete next[key]; return next
      })
      return ok
    },
  })
}

function ModelRow(model, ui, modelDisabled) {
  const name = modelDisplayName(model)
  const editing = ui.editParams === model.key
  const editorId = 'eac-params-' + encodeURIComponent(model.key)
  return h('article', { className: 'eac-model', key: model.key, 'data-disabled': model.enabled === false ? 'true' : undefined },
    h('div', { className: 'eac-model-head' },
      model.toggle ? Switch({ checked: model.enabled, disabled: modelDisabled, label: `${model.dead ? '恢复' : '启用'}模型 ${name}`,
        onChange: () => ui.act(...model.toggle) }) : null,
      h('div', { className: 'eac-model-copy' },
        h('div', { className: 'eac-model-name', title: name }, name),
        h('div', { className: 'eac-model-id', title: model.id }, model.id)),
      model.defaults ? h('p', { className: 'eac-model-defaults', title: model.defaults }, model.defaults) : null,
      h('div', { className: 'eac-model-aside' },
        h('span', { className: 'eac-model-tags' }, ...renderTags(model.tags)),
        model.editor ? button(editing ? '收起' : '参数', () => ui.act('toggleParams', model.key), modelDisabled,
          { className: 'is-quiet', 'aria-label': `${name} 的参数`, 'aria-expanded': editing, 'aria-controls': editorId }) : null)),
    editing ? h('div', { id: editorId }, renderModelEditor(model, ui, modelDisabled)) : null)
}

function catalogSourceTag(source) {
  if (source === 'remote') return tag('远端目录', 'success')
  if (source === 'fallback') return tag('内置目录', 'warn')
  if (source === 'cached') return tag('上次目录', 'warn')
  if (source === 'unknown') return tag('来源未知')
  return null
}

function ModelsPanel({ groups }, ui) {
  const all = groups.flatMap(group => group.rows)
  const found = filterModels(all, ui.query)
  if (ui.enabledFirst !== false) found.sort((a, b) => Number(b.enabled === true) - Number(a.enabled === true))
  const grouped = groups.length > 1
  const pageCount = grouped ? 1 : Math.max(1, Math.ceil(found.length / MODEL_PAGE_SIZE))
  const page = Math.min(ui.page, pageCount - 1)
  const shown = grouped ? found : found.slice(page * MODEL_PAGE_SIZE, (page + 1) * MODEL_PAGE_SIZE)
  const activeCount = all.filter(model => model.enabled).length
  const primaryGroup = groups[0]
  const modelScope = `models:${ui.providerId}`
  const modelDisabled = ui.loading || ui.isPending(modelScope)
  return Section({
    title: '模型目录',
    summary: [
      all.some(model => model.toggle) ? `${activeCount} / ${all.length} 已启用` : `${all.length} 个模型`,
      !grouped ? catalogSourceTag(primaryGroup?.source) : null,
    ],
    actions: grouped ? null : renderActions(primaryGroup?.actions, ui, modelScope),
    children: [
      h('div', { className: 'eac-model-tools' },
        h('input', { className: 'eac-input eac-model-search', type: 'search', value: ui.query, 'aria-label': '搜索全部模型',
          placeholder: '搜索模型名称或 ID', onChange: event => { ui.setQuery(event.target.value); ui.setPage(0) } }),
        all.some(model => model.toggle) ? h('label', { className: 'eac-checkbox' },
          h('input', { type: 'checkbox', checked: ui.enabledFirst !== false,
            onChange: event => { ui.setEnabledFirst(event.target.checked); ui.setPage(0) } }),
          '启用的模型放在前面') : null),
      ...groups.map(group => {
        const rows = shown.filter(model => group.rows.includes(model))
        const exclusions = modelRecommendationExclusions(group.rows, group.id)
        const byId = new Map(group.rows.map(model => [model.id, model]))
        const groupScope = `models:${group.id}`
        const groupDisabled = ui.loading || ui.isPending(groupScope) || ui.isPending(modelScope)
        return h('div', { className: 'eac-group', key: group.id, 'data-model-provider': grouped ? group.id : undefined },
          grouped ? h('div', { className: 'eac-group-head' },
            h('p', { className: 'eac-group-title' }, `${group.title} · ${group.rows.length}`, catalogSourceTag(group.source)),
            h('div', { className: 'eac-group-actions' }, ...renderActions(group.actions, ui, groupScope))) : null,
          group.hint ? h('div', null, ...renderActions([group.hint], ui, groupScope)) : null,
          group.notice ? h('p', { className: 'eac-muted', role: 'status' }, group.notice) : null,
          rows.length ? h('div', { className: 'eac-model-list' }, ...rows.map(model => {
            const reason = exclusions.get(model.id)
            const alternative = byId.get(reason?.alternative)
            const tag = reason?.kind === 'older' ? ['旧版', 'warn',
              alternative ? `同目录已有 ${modelDisplayName(alternative)}。` : model.staleReason]
              : reason?.kind === 'value' ? ['性价比偏低', 'warn',
                `${modelDisplayName(alternative)} 的渠道倍率更低，可用于同类任务。`] : null
            return ModelRow({ ...model, tags: [...(model.tags ?? []), tag] }, ui, groupDisabled)
          }))
            : grouped ? h('p', { className: 'eac-empty' }, ui.query.trim() ? '没有匹配的模型。' : '暂无模型。') : null)
      }),
      !grouped && !found.length ? EmptyState({ loading: ui.loading, failed: ui.failed, onRetry: () => ui.act('refreshSettings'),
        emptyText: ui.query.trim() ? '没有匹配的模型。' : '暂无模型。' }) : null,
      pageCount > 1 ? h('div', { className: 'eac-pagination', role: 'group', 'aria-label': '模型分页' },
        button('上一页', () => ui.setPage(page - 1), page === 0),
        h('span', null, `${page + 1} / ${pageCount}`), button('下一页', () => ui.setPage(page + 1), page + 1 >= pageCount)) : null,
    ],
  })
}

function automationRowsFor(provider, state) {
  const id = provider.id
  const supportsCheckin = provider.pack
    ? provider.caps?.dailyReward !== false
    : (id === WORKBUDDY_ID || provider.caps?.dailyReward === true)
  const supportsRewards = provider.caps?.onboarding === true || provider.caps?.claimRewards === true
  const supportsTasks = provider.caps?.completeTasks === true
  const overrides = state.automation?.config?.providers?.[id] ?? {}
  const scope = 'automation'
  const rows = []
  const guardEnabled = automationEffective(state, id, 'cotLoopGuard')
  rows.push({
    id: 'cot-loop-guard', name: '思考循环保护', scope,
    meta: typeof overrides.cotLoopGuard === 'boolean' ? '本渠道单独设置 · 命中重复思考自动切断并续跑' : '跟随全局设置 · 命中重复思考自动切断并续跑',
    enabled: guardEnabled,
    toggle: ['setAutomationConfig', { provider: id, cotLoopGuard: !guardEnabled }],
    toggleLabel: `${provider.title} 思考循环保护`,
    actions: typeof overrides.cotLoopGuard === 'boolean'
      ? [{ label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, cotLoopGuard: null }] }] : undefined,
  })
  if (supportsCheckin) {
    const enabled = automationEffective(state, id, 'autoCheckin')
    rows.push({
      id: 'auto-checkin', name: '自动每日签到', scope,
      meta: typeof overrides.autoCheckin === 'boolean' ? '本渠道单独设置' : '跟随全局设置',
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoCheckin: !enabled }],
      toggleLabel: `${provider.title} 自动每日签到`,
      actions: typeof overrides.autoCheckin === 'boolean'
        ? [{ label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoCheckin: null }] }] : undefined,
    })
  }
  if (supportsRewards) {
    const enabled = automationEffective(state, id, 'autoClaimRewards')
    rows.push({
      id: 'auto-claim-rewards', name: '自动领取奖励', scope,
      meta: typeof overrides.autoClaimRewards === 'boolean' ? '本渠道单独设置' : '跟随全局设置',
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoClaimRewards: !enabled }],
      toggleLabel: `${provider.title} 自动领取奖励`,
      actions: [
        { label: '立即领取', call: ['runAutomationTask', id, 'claimRewards'] },
        typeof overrides.autoClaimRewards === 'boolean'
          ? { label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoClaimRewards: null }] } : null,
      ],
    })
  }
  if (supportsTasks) {
    const enabled = automationEffective(state, id, 'autoCompleteTasks')
    rows.push({
      id: 'auto-complete-tasks', name: '自动执行完成任务', scope,
      meta: '默认关闭；开启后将自动触发该平台的任务执行动作',
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoCompleteTasks: !enabled }],
      toggleLabel: `${provider.title} 自动执行完成任务`,
      actions: [
        { label: '立即执行', call: ['runAutomationTask', id, 'completeTasks'] },
        typeof overrides.autoCompleteTasks === 'boolean'
          ? { label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoCompleteTasks: null }] } : null,
      ],
    })
  }
  return rows
}

function ChannelPanel(rows, ui, provider, state) {
  const autoRows = provider ? automationRowsFor(provider, state) : []
  const allRows = [...rows, ...autoRows]
  return Section({
    title: '渠道设置',
    children: ListBox({ children: allRows.map(row => {
      const key = `${ui.providerId}:channel:${row.id}`
      const scope = row.scope || `channel:${ui.providerId}`
      const rowDisabled = ui.loading || ui.isPending(scope)
      return Row({
        key, name: row.name, meta: row.meta, tags: renderTags(row.tags),
        switchControl: row.toggle ? Switch({ checked: row.enabled ?? false, disabled: rowDisabled || row.enabled === undefined,
          label: row.toggleLabel || row.name, onChange: () => ui.act(...row.toggle) }) : undefined,
        controls: renderActions(row.actions, ui, scope),
        moreLabel: row.form ? '配置' : undefined, expanded: ui.more[key] === true,
        onToggle: () => ui.act('toggleMore', key), detail: row.form && renderForm(row.form, ui),
      })
    }) }),
  })
}

function renderSettingsPanel(panel, provider, state, ui) {
  if (panel === 'accounts') return AccountsPanel(provider.accounts(state), ui)
  if (panel === 'models') return ModelsPanel(provider.models(state), ui)
  return ChannelPanel(provider.channel(state), ui, provider, state)
}

// ── src/client/providers/pack.js ──
// Channel-pack settings use the same view contract as managed accounts.
// Optional actions, forms, quota details and model groups are plain data.
function packSettings(provider) {
  const { id, caps = {}, family } = provider
  const sides = family ?? [{ id }]
  return {
    ...provider,
    statusFrom(state) {
      const parts = sides.map(side => state.statuses[side.id]).filter(Boolean)
      if (parts.length === 0) return null
      return {
        closed: parts.every(side => side.closed),
        accounts: state.statuses[id]?.accounts ?? null,
        totalAccounts: state.statuses[id]?.totalAccounts ?? null,
        models: parts.some(side => side.models !== null)
          ? parts.reduce((sum, side) => sum + (side.models ?? 0), 0) : null,
      }
    },
    accounts(state) {
      const balances = new Map(state.balances.map(balance => [balance.accountId, balance]))
      return {
        ready: !state.loading || state.accounts.length > 0,
        failed: state.loadFailed,
        autoCheckin: state.checkin?.providers?.[id] ? state.checkin.enabled : undefined,
        actions: [
          caps.dailyReward !== false && { label: '全部领取', call: ['claim'],
            disabled: !state.accounts.some(account => !checkinEntry(state, id, account.id)?.locked) },
          { label: '添加账号', call: ['startLogin'], primary: true },
        ],
        login: state.login && { url: state.login.url, canCheck: true },
        rows: state.accounts.map(account => {
          const { id: accountId, nickname, enabled, plan } = account
          const limited = Object.values(account.modelRateLimits).filter(expires => expires > Date.now()).length
          const balance = balances.get(accountId)
          return {
            id: accountId, name: nickname, enabled,
            toggle: ['save', accountId, nickname, !enabled],
            tags: [
              caps.accountPlan && (plan === 'pro' ? ['订阅', 'info'] : plan === 'free' ? ['免费', 'success'] : ['套餐未知', 'warn']),
              !enabled && ['已停用'],
              account.expiresAt > 0 && account.expiresAt <= Date.now() && ['凭据过期', 'warn'],
              limited > 0 && [`受限 ${limited}`, 'warn'],
              balance?.stale && [balance.total === null ? '余额读取失败' : '上次余额', 'warn'],
              checkinEntry(state, id, accountId)?.tag,
            ],
            metric: { value: balance?.total ?? (balance?.stale ? '—' : '额度待更新'), unit: balance?.total != null ? '积分' : undefined },
            updatedAt: balance?.updatedAt,
            groups: balance?.packages.length ? [{ title: '额度包', items: balance.packages.map(pkg => ({
              label: pkg.name || '额度包', value: pkg.remaining, unit: pkg.unit || undefined,
              notes: [!pkg.active && '已失效', pkg.expiresAt > 0 && `到期 ${displayTime(pkg.expiresAt)}`],
            })) }] : [],
            form: { kind: 'account', account, call: ['save'] },
            actions: [
              caps.onboarding && { label: caps.rewardLabel ?? '领新手任务', call: ['onboarding', accountId] },
              { label: '优先使用', call: ['prioritize', accountId] },
              { label: '刷新凭据', call: ['accountAction', 'account.refresh', accountId] },
              { label: '重置限流', call: ['accountAction', 'account.reset', accountId] },
              { label: '重测限流', call: ['accountAction', 'account.retest', accountId] },
              { label: '移除账号', call: ['requestDelete', accountId], danger: true },
            ],
            confirmation: state.pendingDelete?.accountId === accountId ? {
              label: `移除「${nickname}」？`,
              call: ['confirmDelete', state.pendingDelete], cancel: ['cancelDelete'],
            } : null,
          }
        }),
      }
    },
    models(state) {
      return { groups: sides.map(side => {
        const rows = state.models.filter(model => model.provider === side.id).map(model => ({
          ...model,
          enabled: !model.disabled && !model.dead,
          toggle: ['toggleModel', model.key],
          defaults: defaultParamSummary(model),
          tags: [
            model.dead && ['已失效', 'error'],
            model.rate ? [model.rate.label, model.rate.tone === 'warning' ? 'warn' : model.rate.tone]
              : model.isFree && ['免费', 'success'],
            state.params[model.key] && [`自定义 ${paramSummary(state.params[model.key])}`, 'info'],
          ],
          editor: { kind: 'tiers', call: ['setModelParams', model.key], value: state.params[model.key] },
        }))
        return {
          id: side.id, title: side.title, rows, source: state.modelSource[side.id] ?? 'unknown',
          notice: side.id === 'qodercn' ? ({
            'login-required': 'Qoder CLI 尚未登录。请在终端运行 qoderclicn login，然后刷新目录。',
            'cli-missing': '找不到 Qoder 中国版 CLI。安装后可刷新目录。',
            timeout: 'Qoder CLI 读取超时，可稍后重试。',
            'cli-failed': 'Qoder CLI 读取失败，可稍后重试。',
            empty: 'Qoder CLI 本次返回空目录，可稍后重试。',
          })[state.qoderCatalogIssue] : undefined,
          actions: [
            { label: '刷新目录', call: ['refreshModels', side.id] },
            { label: '恢复推荐', call: ['resetModels', side.id], disabled: rows.length === 0 },
            { label: '全部禁用', call: ['setModels', true, side.id], disabled: rows.length === 0, danger: true },
          ],
        }
      }) }
    },
    channel(state) {
      return [
        ...sides.map(side => ({
          id: side.id, name: side.title ? `${side.title}提供方` : '模型提供方',
          enabled: state.statuses[side.id] ? !state.statuses[side.id].closed : undefined,
          toggle: ['setEnabled', state.statuses[side.id]?.closed === true, side.id],
          toggleLabel: state.statuses[side.id]?.closed !== false ? (family ? '打开模型提供方' : '打开渠道') : (family ? '关闭模型提供方' : '关闭渠道'),
        })),
        ...(caps.permanentLock ? [{
          id: 'permanent', name: '锁定永久积分', meta: '仅使用有时效的积分',
          enabled: state.locked, toggle: ['lock', !state.locked],
        }] : []),
      ]
    },
  }
}

// ── src/client/providers/managed.js ──
// 通用自管多账号渠道前端视图与动作工厂（供 AStudio、豆包工作、Coze、CodeArts 共用）。
// 新增同类渠道只需提供 5 行声明（id / title / authMethods / capabilities），不再手写 UI 或状态流。
const EMPTY_MANAGED = Object.freeze({
  enabled: true, registered: false, authMethods: ['browser'], credentialHint: '',
  accounts: [], models: [], modelSource: undefined, loginUrl: '',
})

function managedRemaining(window) {
  return window.used !== null ? Math.min(1, Math.max(0, 1 - window.used / 100)) : null
}

const SOURCE_LABELS = { local: '本机导入', credential: '凭据导入', browser: '浏览器登录' }

function managedChannel({ id, title, authMethods = ['browser'], credentialHint = '', checkin = false, claimRewards = false, completeTasks = false }) {
  const entry = state => state.managed?.[id]
  const withEntry = (state, next) => ({ managed: { ...state.managed, [id]: next } })

  const provider = {
    id,
    title,
    rpcMethods: MANAGED_METHODS,
    caps: {
      dailyReward: checkin,
      claimRewards,
      completeTasks,
      authMethods,
    },
    createActions: context => createManagedActions(provider, context),
    managedAccount: (state, accountId) => (entry(state)?.accounts ?? []).find(account => account.id === accountId),
    removeAction: `${id}Logout`,
    snapshot: {
      methods: ['managed.snapshot', 'managed.models'],
      keep: ['managed'],
      ready: state => entry(state)?.ready === true,
      failed: state => entry(state)?.error === true,
      readFailed: state => withEntry(state, { ...(entry(state) ?? EMPTY_MANAGED), ready: entry(state)?.ready === true, stale: true, error: true }),
      fromRead([snapshot, models], state) {
        const previous = entry(state) ?? EMPTY_MANAGED
        const { managed, stale } = managedSnapshotFrom({ ...snapshot, models: models?.models, modelSource: models?.source }, previous)
        return withEntry(state, { ...managed, ready: true, stale: stale || snapshot?.snapshot?.stale === true, error: false, liveAt: Date.now() })
      },
      apply(get, state) {
        const usage = get('managed.snapshot')
        const models = get('managed.models')
        if (!usage && !models?.value) return {}
        const previous = entry(state) ?? EMPTY_MANAGED
        const liveAt = previous.liveAt ?? 0
        const freshUsage = usage && (!liveAt || !Number.isFinite(usage.at) || usage.at >= liveAt) ? usage : null
        const freshModels = models?.value && (!liveAt || !Number.isFinite(models.at) || models.at >= liveAt) ? models : null
        if (!freshUsage && !freshModels) return {}
        const { managed } = managedSnapshotFrom({
          ...(freshUsage?.value ?? previous),
          accounts: freshUsage?.value?.accounts ?? previous.accounts,
          models: freshModels?.value?.models,
          modelSource: freshModels?.value?.source,
          loginUrl: previous.loginUrl,
        }, previous)
        return {
          ...withEntry(state, {
            ...managed,
            stale: freshUsage ? freshUsage.stale === true : previous.stale === true,
            error: freshUsage ? (freshUsage.stale === true && !freshUsage.value) : previous.error === true,
            ready: !!freshUsage?.value || previous.ready === true,
            liveAt,
          }),
          ...(freshUsage && state.provider === id ? { loading: false } : {}),
        }
      },
    },
    statusFrom(state) {
      const current = entry(state)
      if (!current?.ready && !(current?.accounts?.length)) return null
      const accounts = current.accounts ?? []
      const signedIn = accounts.filter(account => account.signedIn && account.enabled !== false).length
      const closed = current.enabled === false
      const label = closed ? '渠道已关闭' : signedIn ? (current.registered ? '渠道运行中' : '已连接') : '待添加账号'
      return {
        closed,
        accounts: signedIn,
        totalAccounts: accounts.length,
        models: (current.models ?? []).length,
        label,
        tone: !closed && signedIn && !accounts.some(account => account.error) ? 'success' : 'warn',
      }
    },
    accounts(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const methods = current.authMethods?.length ? current.authMethods : authMethods
      const loginUrl = current.loginUrl || ''
      return {
        ready: current.ready === true || current.accounts.length > 0,
        failed: current.error === true,
        autoCheckin: checkin ? automationEffective(state, id, 'autoCheckin') : undefined,
        login: loginUrl ? { url: loginUrl } : null,
        importForm: methods.includes('credential') ? {
          hint: current.credentialHint || credentialHint,
          call: [`${id}ImportCredential`],
        } : null,
        actions: [
          methods.includes('local') && { label: '导入本机登录', call: [`${id}ImportLocal`], primary: !methods.includes('browser') },
          methods.includes('browser') && { label: '浏览器登录', call: [`${id}Login`], primary: true },
          methods.includes('credential') && { label: '粘贴凭据', call: ['toggleImportForm', id] },
        ],
        rows: current.accounts.map(account => {
          const name = account.name || account.uid || account.id
          const remaining = account.windows.map(managedRemaining).filter(value => value !== null)
          const lowest = remaining.length ? Math.min(...remaining) : null
          const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === id
          const ck = checkin ? checkinEntry(state, id, account.id) : null
          const rw = claimRewards ? taskEntry(state, id, 'claimRewards', account.id) : null
          const metric = account.balance !== null
            ? { value: account.balance, unit: account.unit || '积分' }
            : lowest !== null
              ? { value: Math.round(lowest * 100), unit: '% 剩余', fraction: lowest }
              : { value: '额度待更新' }
          return {
            id: account.id,
            name,
            enabled: account.enabled !== false,
            toggle: [`${id}UpdateAccount`, account.id, name, account.enabled === false],
            updatedAt: account.updatedAt,
            tags: [
              account.plan && [account.plan, 'info'],
              account.source && SOURCE_LABELS[account.source] && [SOURCE_LABELS[account.source]],
              account.enabled === false && ['已停用'],
              !account.signedIn && ['凭据失效', 'warn'],
              (account.error || current.stale) && [(account.windows.length || account.balance !== null) ? '上次额度' : '额度读取失败', 'warn'],
              ck?.tag,
              rw?.tag,
            ],
            metric,
            groups: account.windows.length ? [{
              title: '额度窗口',
              items: account.windows.map(window => {
                const fraction = managedRemaining(window)
                return {
                  label: window.name, fraction,
                  value: fraction === null ? window.balance : Math.round(fraction * 100),
                  unit: fraction === null ? window.unit : '% 剩余',
                  notes: [
                    window.amount !== null && `已用 ${displayNumber(window.amount)} ${window.unit}`.trim(),
                    window.resetsAt && `重置 ${displayTime(window.resetsAt)}`,
                    window.runsOutAt && `预计用尽 ${displayTime(window.runsOutAt)}`,
                  ],
                }
              }),
            }] : [],
            form: { kind: 'account', account: { id: account.id, nickname: name, enabled: account.enabled !== false }, call: [`${id}UpdateAccount`] },
            actions: [
              checkin && account.signedIn && { label: '签到', accessible: `为 ${name} 签到`, call: [`${id}Checkin`, account.id], disabled: ck?.locked },
              claimRewards && account.signedIn && { label: '领奖励', accessible: `为 ${name} 领取奖励`, call: [`${id}ClaimRewards`, account.id] },
              completeTasks && account.signedIn && { label: '执行任务', accessible: `为 ${name} 执行任务`, call: [`${id}CompleteTasks`, account.id] },
              { label: '移除账号', accessible: `移除 ${name}`, call: ['requestDelete', account.id], danger: true },
            ],
            confirmation: confirmation ? {
              label: `移除「${name}」？`,
              confirmLabel: '移除',
              call: ['confirmDelete', state.pendingDelete],
              cancel: ['cancelDelete'],
            } : null,
          }
        }),
      }
    },
    models(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const models = current.models ?? []
      return {
        groups: [{
          id,
          source: current.modelSource,
          actions: [
            { label: '刷新目录', call: [`${id}RefreshModels`] },
            { label: '恢复推荐', call: [`${id}ResetModels`], disabled: !models.length },
          ],
          rows: models.map(model => ({
            ...model,
            key: modelKey(id, model.id),
            toggle: [`${id}SetModelEnabled`, model.id, !model.enabled],
            defaults: currentModelSummary(model),
            tags: [model.rate ? [model.rate.label, model.rate.tone] : model.free && ['免费', 'success']],
            editor: { kind: 'numeric', call: [`${id}SetModelParams`, model.id] },
          })),
        }],
      }
    },
    channel(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const connected = current.accounts.some(account => account.signedIn && account.enabled !== false)
      return [
        {
          id: 'models', name: '模型提供方',
          enabled: current.enabled !== false,
          toggle: [`${id}SetEnabled`, current.enabled === false],
          tags: [current.enabled !== false && connected && !current.registered && ['待注册', 'warn']],
        },
        {
          id: 'accounts', name: '账号连接',
          tags: [[connected ? `已连接 ${current.accounts.filter(a => a.signedIn).length} 个` : '待添加账号', connected ? 'success' : undefined]],
          actions: [{ label: '管理账号', panel: 'accounts' }],
        },
      ]
    },
  }
  return provider
}

function createManagedActions(provider, { getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers, writes, persistCards }) {
  const { id, title } = provider
  const patchEntry = update => {
    const state = getState()
    const current = state.managed?.[id] ?? EMPTY_MANAGED
    publish({ managed: { ...state.managed, [id]: update(current) } })
    persistCards?.()
  }
  const saveModels = (method, payload, message) => mutate(method, { provider: id, ...payload }, {
    refresh: false,
    scope: `models:${id}`,
    message,
    result(value) {
      if (Array.isArray(value?.models)) {
        patchEntry(cur => ({ ...cur, models: workbuddyModelsFrom(value.models), modelSource: value.source || cur.modelSource }))
      }
    },
  })
  return {
    [`${id}SetModelEnabled`](modelId, enabled) {
      return saveModels('managed.setModelEnabled', { modelId, enabled }, '模型开关已保存。')
    },
    [`${id}SetModelParams`](modelId, params) {
      return saveModels('managed.setModelParams', { modelId, params }, '模型参数已保存。')
    },
    [`${id}ResetModels`]() {
      return saveModels('managed.resetModels', {}, '已恢复推荐模型。')
    },
    [`${id}RefreshModels`]() {
      return saveModels('managed.refreshModels', {}, '模型目录已刷新。')
    },
    [`${id}SetEnabled`](enabled) {
      return mutate('managed.setEnabled', { provider: id, enabled: enabled === true }, {
        refresh: false,
        scope: `channel:${id}`,
        progress: enabled ? `正在启用 ${title}…` : `正在关闭 ${title}…`,
        message: enabled ? `${title} 模型提供方已启用。` : `${title} 模型提供方已关闭。`,
        result(value) {
          patchEntry(cur => ({ ...cur, enabled: value?.enabled !== false, registered: value?.registered === true }))
        },
      })
    },
    [`${id}Login`]() {
      const options = {
        scope: `login:${id}`,
        progress: `正在打开 ${title} 浏览器登录…`,
        message: value => value?.signedIn === true ? `已添加 ${title} 账号。` : `${title} 登录未完成，请重试。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'browser', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      }
      const login = mutate('managed.login', { provider: id }, options)
      let polling = true, timer = null
      const controller = new AbortController()
      writes.add(controller)
      const fetchUrl = async () => {
        if (!polling || getState().provider !== id) return
        try {
          const value = await request('managed.snapshot', { provider: id, ...(hasSnapshots() ? { localOnly: true } : {}) }, controller.signal)
          if (polling && value?.loginUrl && !isDisposed() && getState().provider === id) {
            patchEntry(cur => ({ ...cur, loginUrl: value.loginUrl }))
          }
        } catch {}
      }
      const schedule = (delay = 1000) => {
        if (!polling || isDisposed() || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return
        timer = setTimeout(async () => {
          loginUrlTimers.delete(timer)
          timer = null
          await fetchUrl()
          schedule(1000)
        }, delay)
        loginUrlTimers.add(timer)
      }
      schedule(250)
      return login.finally(() => {
        polling = false
        controller.abort()
        writes.delete(controller)
        if (timer !== null) { clearTimeout(timer); loginUrlTimers.delete(timer) }
        if (!isDisposed()) patchEntry(cur => ({ ...cur, loginUrl: '' }))
      })
    },
    [`${id}ImportLocal`]() {
      return mutate('managed.importLocal', { provider: id }, {
        scope: `login:${id}`,
        progress: `正在读取本机 ${title} 登录态…`,
        message: value => value?.signedIn ? `已导入本机 ${title} 账号。` : `未检测到本机 ${title} 登录态。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'local', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      })
    },
    [`${id}ImportCredential`](credential) {
      if (typeof credential !== 'string' || !credential.trim()) {
        publish({ notice: '请输入凭据内容。' })
        return Promise.resolve(false)
      }
      return mutate('managed.importCredential', { provider: id, credential: credential.trim() }, {
        scope: `login:${id}`,
        progress: `正在验证 ${title} 凭据…`,
        message: `已导入 ${title} 账号。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'credential', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      })
    },
    [`${id}UpdateAccount`](accountId, nickname, enabled) {
      if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 80) {
        publish({ notice: '请填写 1–80 个字的账号备注。' })
        return Promise.resolve(false)
      }
      return mutate('managed.updateAccount', { provider: id, accountId, patch: { nickname: nickname.trim(), enabled: enabled !== false } }, {
        refresh: false,
        scope: `account:${accountId}`,
        message: '账号设置已保存。',
        result(value) {
          patchEntry(cur => ({
            ...cur,
            accounts: cur.accounts.map(a => a.id === accountId ? { ...a, name: value?.name ?? nickname.trim(), enabled: value?.enabled !== false } : a),
          }))
        },
      })
    },
    [`${id}Logout`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.logout', { provider: id, accountId }, {
        scope: `account:${accountId}`,
        message: `已移除该 ${title} 账号。`,
      })
    },
    [`${id}Checkin`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.checkin', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在签到领取当日积分…',
        message: value => {
          const outcome = text(value?.outcome, 40)
          if (outcome === 'claimed') return `签到成功${typeof value?.credit === 'number' ? `，领取 ${value.credit} 积分` : ''}。`
          if (outcome === 'done' || outcome === 'already-claimed') return '今日已签到。'
          if (outcome === 'inactive') return '今日签到活动未开启。'
          if (outcome === 'ineligible') return '当前账号暂不支持签到。'
          if (outcome === 'pending') return '签到待确认。'
          return '签到未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
    [`${id}ClaimRewards`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.claimRewards', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在领取可领奖励…',
        message: value => {
          if (value?.kind === 'claimed') return `领取成功${typeof value?.points === 'number' ? `，获得 ${value.points} 积分` : ''}。`
          if (value?.kind === 'done' || value?.kind === 'empty') return '当前无可领奖励。'
          return '奖励领取未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
    [`${id}CompleteTasks`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.completeTasks', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在执行平台任务…',
        message: value => {
          if (value?.kind === 'completed') return `已完成 ${value?.completed ?? 1} 项任务。`
          if (value?.kind === 'done' || value?.kind === 'empty') return '今日任务均已完成。'
          return '任务执行未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
  }
}

// ── src/client/providers/loomy.js ──
// Loomy（讯飞办公助手）provider 模块：走 channel-pack 通用账号池面板。
// 渠道专有能力：新手任务奖励（onboarding.claim）、永久积分锁定（Loomy 专有）。
const loomy = {
  id: 'loomy',
  title: 'Loomy',
  // channel-pack 通用渠道：账号池 + 模型目录 + 渠道开关。
  pack: true,
  caps: {
    // 新手任务 / 登录奖励：onboarding.claim 只接受 loomy 与 raccoon。
    onboarding: true,
    // 永久积分锁定：Loomy 专有。
    permanentLock: true,
  },
}

// ── src/client/providers/raccoon.js ──
const raccoon = {
  id: 'raccoon',
  title: 'Raccoon',
  pack: true,
  family: [
    { id: 'raccoon', title: '免费模型' },
    { id: 'raccoon-pro', title: '订阅模型' },
  ],
  caps: { accountPlan: true, onboarding: true, rewardLabel: '领登录奖励', dailyReward: false },
}

// ── src/client/providers/raccoon-pro.js ──
// Raccoon 订阅版（`raccoon-pro`）provider 模块：**不是一张卡片**（`card: false`）。
//
// 它只作为 Raccoon 家族卡的**订阅模型面**存在：provider.status 轮询、模型目录、
// 模型启停与参数写入仍走这个 provider id（主机侧独立适配器），而账号池共用
// 家族卡那一张（`raccoon`，按账号套餐自动分流）。
//
// 因此模型数、状态、账号行都由家族卡的合并渲染负责；本模块只保留身份与能力声明，
// 避免「模型层拆分」被误解成「UI 也要拆成两张卡」。
const raccoonPro = {
  id: 'raccoon-pro',
  title: 'Raccoon 订阅版',
  pack: true,
  // 不作为渠道卡片渲染（登录、账号池、模型分区都归家族卡）。
  card: false,
  caps: {
    onboarding: true,
    permanentLock: false,
  },
}

// ── src/client/providers/qodercn.js ──
// Qoder 中国版 provider 模块：走 channel-pack 通用账号池面板。
// 无渠道专有能力（每日额度领取走上游活动，暂不在此暴露）。
const qodercn = {
  id: 'qodercn',
  title: 'Qoder 中国版',
  pack: true,
  caps: { cliCatalog: true },
}

// ── src/client/providers/trae.js ──
// TRAE（字节 TRAE IDE，中国版）provider 模块：走 channel-pack 通用账号池面板。
// 浏览器 OAuth 登录（本机回调）、每日签到领取（credits.claimAll）、余额查询。
const trae = {
  id: 'trae',
  title: 'TRAE',
  pack: true,
  caps: {},
}

// ── src/client/providers/sensenova.js ──
const sensenova = {
  id: 'sensenova-token-plan',
  title: '商汤 Token Plan',
  panelIds: ['models', 'advanced'],
  createActions: createSenseNovaActions,
  snapshot: {
    methods: ['plan.snapshot'],
    keep: ['plan', 'planStale', 'planError'],
    ready: state => !!state.plan,
    failed: state => state.planError || state.plan?.catalogError,
    fromRead([value], state) {
      const { plan, stale } = mergePlanSnapshot(value, state.plan)
      return { plan, planStale: stale, planError: false }
    },
    apply(get, state) {
      const entry = get('plan.snapshot')
      if (!entry) return {}
      const selected = state.provider === sensenova.id
      if (!entry.value) return {
        planStale: entry.stale, planError: entry.stale,
        ...(selected && entry.stale ? { loading: false } : {}),
      }
      return { plan: planSnapshotFrom(entry.value), planStale: entry.stale || entry.value.catalogError === true, planError: false,
        ...(selected ? { loading: false } : {}) }
    },
  },
  statusFrom({ plan }) {
    if (!plan) return null
    return {
      closed: !plan.registerProvider, accounts: plan.hasApiKey ? 1 : 0, cardMeta: `${plan.hasApiKey ? 'Key 已配置' : '待配置 Key'} · ${plan.models.length} 模型`, models: plan.models.length,
      label: !plan.registerProvider ? '渠道已关闭' : plan.providerRegistered ? '渠道运行中' : '待注册',
      tone: plan.providerRegistered ? 'success' : 'warn',
    }
  },
  models({ plan }) {
    return { groups: [{
      id: 'sensenova-token-plan',
      source: plan?.catalogAvailable ? 'remote' : plan?.catalogError && plan.models.length ? 'cached' : undefined,
      hint: !plan?.hasApiKey && plan ? { label: '配置 API Key', panel: 'advanced', open: 'key' } : undefined,
      actions: plan?.hasApiKey ? [
        { label: '刷新目录', call: ['refreshSettings'] },
        { label: '恢复推荐', call: ['planResetModels'], disabled: !plan.models.length },
      ] : [],
      rows: (plan?.models ?? []).map(model => ({
        ...model, key: modelKey('sensenova-token-plan', model.id),
        toggle: ['planSetModelEnabled', model.id, !model.enabled],
        defaults: currentModelSummary(model),
        editor: { kind: 'numeric', call: ['planSetModelParams', model.id] },
      })),
    }] }
  },
  channel({ plan }) {
    return [
      { id: 'models', name: '模型提供方', enabled: plan?.registerProvider, toggle: ['planSetEnabled', !plan?.registerProvider],
        tags: [plan?.registerProvider && !plan.providerRegistered && ['待注册', 'warn']] },
      { id: 'key', name: '模型 API Key', tags: [[plan?.hasApiKey ? '已配置' : '待配置', plan?.hasApiKey ? 'success' : undefined]],
        form: { kind: 'key', call: ['planSetKey'] } },
    ]
  },
}

function createSenseNovaActions({ getState, publish, planMutate }) {
  return {
    planResetModels() {
      return planMutate('plan.resetModels', {}, { message: '已恢复推荐模型。', result(value) {
        const plan = getState().plan
        const enabled = new Set(value?.enabledModelIds)
        if (plan) publish({ plan: { ...plan, models: plan.models.map(model => ({ ...model, enabled: enabled.has(model.id) })) } })
      } })
    },
    planSetKey(apiKey) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) { publish({ notice: '请输入商汤 API Key。' }); return Promise.resolve(false) }
      return planMutate('plan.setKey', { apiKey }, { progress: '正在保存商汤 API Key…', message: '商汤 API Key 已保存。' })
    },
    planSetEnabled(enabled) {
      return planMutate('plan.setEnabled', { enabled: enabled === true }, { progress: enabled ? '正在启用商汤模型提供方…' : '正在关闭商汤模型提供方…', message: enabled ? '商汤模型提供方已启用。' : '商汤模型提供方已关闭。' })
    },
    planSetModelEnabled(modelId, enabled) {
      if (typeof modelId !== 'string' || typeof enabled !== 'boolean' || !getState().plan?.models.some(m => m.id === modelId)) return Promise.resolve(false)
      return planMutate('plan.setModelEnabled', { modelId, enabled }, { message: '模型显示设置已保存。', result(value) {
        if (!getState().plan || value?.modelId !== modelId || typeof value?.enabled !== 'boolean') throw new Error('invalid model response')
        publish({ plan: { ...getState().plan, models: getState().plan.models.map(m => m.id === modelId ? { ...m, enabled: value.enabled } : m) } })
      } })
    },
    planSetModelParams(modelId, params) {
      if (typeof modelId !== 'string' || !getState().plan?.models.some(model => model.id === modelId)) return Promise.resolve(false)
      try { params = validatePlanParams(typeof params === 'object' && params !== null ? params : { maxTokens: params }) }
      catch { publish({ notice: '模型参数无效。' }); return Promise.resolve(false) }
      return planMutate('plan.setModelParams', { modelId, params }, { message: '模型参数已保存。', result(value) {
        const plan = getState().plan
        if (!plan || value?.modelId !== modelId) throw new Error('invalid model response')
        publish({ plan: { ...plan, models: plan.models.map(model =>
          model.id === modelId ? { ...model, ...planModelFields({ ...model, ...value }) } : model) } })
      } })
    },
  }
}

// ── src/client/providers/workbuddy.js ──
function buddyRemaining(window) {
  return window.used !== null ? Math.min(1, Math.max(0, 1 - window.used / 100)) : null
}

const workbuddy = {
  id: 'workbuddy',
  title: 'WorkBuddy',
  rpcMethods: WORKBUDDY_METHODS,
  createActions: createWorkBuddyActions,
  managedAccount: (state, id) => state.workbuddy.accounts.find(account => account.id === id),
  removeAction: 'workbuddyLogout',
  snapshot: {
    methods: ['workbuddy.snapshot', 'workbuddy.models'],
    keep: ['workbuddy', 'workbuddyReady', 'workbuddyStale', 'workbuddyError'],
    ready: state => state.workbuddyReady,
    failed: state => state.workbuddyError,
    readFailed: () => ({ workbuddyStale: true, workbuddyError: true }),
    fromRead([snapshot, models], state) {
      const { workbuddy, stale } = workbuddySnapshotFrom({ ...snapshot, models: models?.models, modelSource: models?.source }, state.workbuddy)
      return { workbuddy, workbuddyReady: true, workbuddyStale: stale || snapshot?.snapshot?.stale === true, workbuddyError: false }
    },
    apply(get, state) {
      const usage = get('workbuddy.snapshot')
      const models = get('workbuddy.models')
      if (!usage && !models?.value) return {}
      return {
        workbuddy: workbuddySnapshotFrom({
          accounts: usage?.value?.accounts ?? state.workbuddy.accounts,
          models: models?.value?.models,
          modelSource: models?.value?.source,
        }, state.workbuddy).workbuddy,
        workbuddyStale: usage?.stale === true,
        workbuddyError: usage?.stale === true && !usage.value,
        workbuddyReady: !!usage?.value || state.workbuddyReady,
        ...(usage && state.provider === workbuddy.id ? { loading: false } : {}),
      }
    },
  },
  statusFrom(state) {
    const { accounts, models } = state.workbuddy
    if (!state.workbuddyReady && !accounts.length) return null
    const signedIn = accounts.filter(account => account.signedIn).length
    return {
      closed: false, accounts: accounts.length, models: models.length,
      label: signedIn ? 'WorkBuddy 已连接' : '待连接',
      tone: signedIn && !accounts.some(account => account.error) ? 'success' : 'warn',
    }
  },
  accounts(state) {
    return {
      ready: state.workbuddyReady || state.workbuddy.accounts.length > 0, failed: state.workbuddyError,
      autoCheckin: state.checkin?.providers?.[workbuddy.id] ? state.checkin.enabled : undefined,
      login: state.workbuddyLoginUrl || state.workbuddy.loginUrl
        ? { url: state.workbuddyLoginUrl || state.workbuddy.loginUrl } : null,
      actions: [{ label: '添加账号', call: ['workbuddyLogin'], primary: true }],
      rows: state.workbuddy.accounts.map(account => {
        const name = account.name || account.uid || account.id
        const remaining = account.windows.map(buddyRemaining).filter(value => value !== null)
        const lowest = remaining.length ? Math.min(...remaining) : null
        const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === 'workbuddy'
        const checkin = checkinEntry(state, workbuddy.id, account.id)
        return {
          id: account.id, name, updatedAt: account.updatedAt,
          tags: [
            account.plan && [account.plan, 'info'],
            !account.signedIn && ['待登录', 'warn'],
            (account.error || state.workbuddyStale) && [account.windows.length ? '上次额度' : '额度读取失败', 'warn'],
            checkin?.tag,
          ],
          metric: lowest !== null ? { value: Math.round(lowest * 100), unit: '% 剩余', fraction: lowest } : { value: '额度待更新' },
          groups: account.windows.length ? [{ title: '额度窗口', items: account.windows.map(window => {
            const fraction = buddyRemaining(window)
            return {
              label: window.name, fraction,
              value: fraction === null ? window.balance : Math.round(fraction * 100), unit: fraction === null ? window.unit : '% 剩余',
              notes: [
                window.amount !== null && `已用 ${displayNumber(window.amount)} ${window.unit}`.trim(),
                window.resetsAt && `重置 ${displayTime(window.resetsAt)}`,
                window.runsOutAt && `预计用尽 ${displayTime(window.runsOutAt)}`,
              ],
            }
          }) }] : [],
          actions: [
            account.signedIn && { label: '签到', accessible: `为 ${name} 签到`, call: ['workbuddyCheckin', account.id], disabled: checkin?.locked },
            { label: '退出登录', accessible: `退出 ${name}`, call: ['requestDelete', account.id], danger: true },
          ],
          confirmation: confirmation ? { label: `退出「${name}」？`, confirmLabel: '退出登录',
            call: ['confirmDelete', state.pendingDelete], cancel: ['cancelDelete'] } : null,
        }
      }),
    }
  },
  models(state) {
    const { models, modelSource } = state.workbuddy
    return { groups: [{
      id: 'workbuddy',
      source: modelSource,
      actions: [
        { label: '刷新目录', call: ['refreshSettings'] },
        { label: '恢复推荐', call: ['workbuddyResetModels'], disabled: !models.length },
      ],
      rows: models.map(model => ({
        ...model, key: modelKey('workbuddy', model.id),
        toggle: ['workbuddySetModelEnabled', model.id, !model.enabled],
        defaults: currentModelSummary(model),
        tags: [model.rate ? [model.rate.label, model.rate.tone] : model.free && ['免费', 'success']],
        editor: { kind: 'numeric', call: ['workbuddySetModelParams', model.id] },
      })),
    }] }
  },
  channel(state) {
    const connected = state.workbuddy.accounts.some(account => account.signedIn)
    return [{ id: 'login', name: '浏览器授权', tags: [[connected ? '已连接' : '待连接', connected ? 'success' : undefined]],
      actions: [{ label: '管理账号', panel: 'accounts' }] }]
  },
}

function createWorkBuddyActions({ getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers, writes }) {
  const saveModels = (method, payload, message) => mutate(method, payload, { refresh: false, message, result(value) {
    const state = getState()
    if (state.provider === workbuddy.id && Array.isArray(value?.models)) {
      publish({ workbuddy: { ...state.workbuddy, models: workbuddyModelsFrom(value.models), modelSource: value.source || state.workbuddy.modelSource } })
    }
  } })
  return {
    workbuddySetModelEnabled(modelId, enabled) {
      return saveModels('workbuddy.setModelEnabled', { modelId, enabled }, '模型开关已保存。')
    },
    workbuddySetModelParams(modelId, params) {
      return saveModels('workbuddy.setModelParams', { modelId, params }, '模型参数已保存。')
    },
    workbuddyResetModels() {
      return saveModels('workbuddy.resetModels', {}, '已恢复推荐模型。')
    },
    // WorkBuddy 动作：登录是长操作（主机轮询浏览器授权，最长约 5 分钟），
    // 复用 mutate 链路——busy 期间按钮禁用，完成后 load 自动重读快照。
    // 登录地址由主机的阻塞 login 生成、经快照 loginUrl 字段透出：登录 pending
    // 期间每 2 秒补读一次快照直到结算（authorize 首跳可能超过数秒，只补读
    // 固定两次会永远错过地址）；定时器统一登记，dispose 时清理。
    workbuddyLogin() {
      const options = { progress: '正在准备 WorkBuddy 登录…',
        message: value => value?.signedIn === true ? '已添加 WorkBuddy 账号。' : 'WorkBuddy 登录未完成，请重试。' }
      // mutate 在 busy/loading 时会立即拒绝：此时不登记补读定时器。
      if (getState().busy || getState().loading) return mutate('workbuddy.login', {}, options)
      const login = mutate('workbuddy.login', {}, options)
      let polling = true, timer = null
      const controller = new AbortController()
      writes.add(controller)
      const fetchUrl = async () => {
        if (!polling || getState().provider !== workbuddy.id) return
        try {
          const value = await request('workbuddy.snapshot', { provider: workbuddy.id, ...(hasSnapshots() ? { localOnly: true } : {}) }, controller.signal)
          if (polling && value?.loginUrl && !isDisposed() && getState().provider === workbuddy.id) publish({ workbuddyLoginUrl: value.loginUrl })
        } catch { /* 地址读取失败不影响登录本身；下一轮补读或面板回退兜底。 */ }
      }
      const schedule = () => {
        if (!polling || isDisposed() || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return
        timer = setTimeout(async () => {
          loginUrlTimers.delete(timer)
          timer = null
          await fetchUrl()
          schedule()
        }, 2000)
        loginUrlTimers.add(timer)
      }
      schedule()
      // 登录结束（成功/失败/取消）后停止补读并清掉地址，避免旧地址复活。
      return login.finally(() => {
        polling = false
        controller.abort()
        writes.delete(controller)
        if (timer !== null) { clearTimeout(timer); loginUrlTimers.delete(timer) }
        if (!isDisposed() && getState().provider === workbuddy.id) publish({ workbuddyLoginUrl: null })
      })
    },
    // 退出/签到都按账号 id 操作：WorkBuddy 是自管多账号，没有「当前账号」概念。
    workbuddyLogout(accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('workbuddy.logout', { accountId }, { message: '已退出该 WorkBuddy 账号。' })
    },
    workbuddyCheckin(accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('workbuddy.checkin', { accountId }, { refresh: false, progress: '正在签到领取当日积分…',
        // 签到摘要按主机契约 {outcome, credit, streak} 生成；outcome 枚举与
        // lib/workbuddy.js 的 CHECKIN_OUTCOMES 一致（claimed/done/inactive/
        // ineligible/failed），未知值不谎报成功。完成后重读快照刷新状态。
        message: value => {
          const outcome = text(value?.outcome, 40)
          if (outcome === 'claimed') return `签到成功${typeof value?.credit === 'number' ? `，领取 ${value.credit} 积分` : ''}${typeof value?.streak === 'number' ? `，已连续 ${value.streak} 天` : ''}。`
          if (outcome === 'done') return '今日已签到。'
          if (outcome === 'inactive') return '今日签到活动未开启，暂无可领取积分。'
          if (outcome === 'ineligible') return '当前登录方式不支持签到。'
          if (outcome === 'failed') return '签到未完成。'
          if (outcome === 'pending') return '签到待确认。'
          return '签到结果未知，请刷新用量确认。'
        },
        async result(_value, provider) { if (getState().provider === provider) await loadManaged(workbuddy.id) } })
    },
  }
}

// ── src/client/providers/apikey.js ──
// API Key 渠道（Agnes、云知声）共用的设置页视图。
// 一个渠道 = 一份宿主快照（apikey.snapshot）：Key 状态、提供方开关、模型目录与可选用量。
// 视图分区：「模型」（目录、开关、参数）与「渠道」（提供方开关、API Key、用量）。
const EMPTY_APIKEY = Object.freeze({ hasApiKey: false, registerProvider: false, providerRegistered: false,
  catalogSource: 'fallback', catalogError: false, updatedAt: null, models: [], balance: null })

function apikeyMoney(value, unit) {
  return typeof value === 'number' ? `${unit === 'CNY' ? '¥' : '$'}${value.toFixed(2)}` : '—'
}

function apiKeyChannel({ id, title, host }) {
  const entry = state => state.apikeys?.[id]
  const withEntry = (state, next) => ({ apikeys: { ...state.apikeys, [id]: next } })
  const provider = {
    id, title,
    panelIds: ['models', 'advanced'],
    rpcMethods: APIKEY_METHODS,
    createActions: context => createApiKeyActions(provider, context),
    snapshot: {
      methods: ['apikey.snapshot'],
      keep: ['apikeys'],
      ready: state => entry(state)?.ready === true,
      failed: state => entry(state)?.error === true,
      readFailed: state => withEntry(state, { ...(entry(state) ?? EMPTY_APIKEY), ready: entry(state)?.ready === true, stale: true, error: true }),
      fromRead([value], state) {
        const snapshot = apikeySnapshotFrom(value)
        return withEntry(state, { ...snapshot, ready: true, stale: value?.snapshot?.stale === true || snapshot.catalogError, error: false })
      },
      apply(get, state) {
        const found = get('apikey.snapshot')
        if (!found) return {}
        const selected = state.provider === id
        if (!found.value) {
          return { ...withEntry(state, { ...(entry(state) ?? EMPTY_APIKEY), ready: entry(state)?.ready === true, stale: found.stale === true, error: found.stale === true }),
            ...(selected && found.stale ? { loading: false } : {}) }
        }
        const snapshot = apikeySnapshotFrom(found.value)
        return { ...withEntry(state, { ...snapshot, ready: true, stale: found.stale === true || snapshot.catalogError, error: false }),
          ...(selected ? { loading: false } : {}) }
      },
    },
    statusFrom(state) {
      const current = entry(state)
      if (!current?.ready) return null
      const label = !current.hasApiKey ? '待配置 Key' : !current.registerProvider ? '渠道已关闭'
        : current.providerRegistered ? '渠道运行中' : '待注册'
      return {
        closed: !current.registerProvider, accounts: current.hasApiKey ? 1 : 0,
        cardMeta: `${current.hasApiKey ? 'Key 已配置' : '待配置 Key'} · ${current.models.length} 模型`,
        models: current.models.length, label,
        tone: current.hasApiKey && current.providerRegistered ? 'success' : 'warn',
      }
    },
    models(state) {
      const current = entry(state)
      return { groups: [{
        id,
        source: current?.catalogSource === 'remote' ? 'remote' : current?.catalogSource === 'cached' ? 'cached'
          : current?.hasApiKey && current.catalogSource === 'fallback' ? 'fallback' : undefined,
        hint: current && !current.hasApiKey ? { label: '配置 API Key', panel: 'advanced', open: 'key' } : undefined,
        actions: current?.hasApiKey ? [
          { label: '刷新目录', call: ['refreshSettings'] },
          { label: '恢复推荐', call: [id + 'ResetModels'], disabled: !current.models.length },
        ] : [],
        rows: (current?.models ?? []).map(model => ({
          ...model, key: modelKey(id, model.id),
          toggle: [id + 'SetModelEnabled', model.id, !model.enabled],
          defaults: currentModelSummary(model),
          editor: { kind: 'numeric', call: [id + 'SetModelParams', model.id] },
        })),
      }] }
    },
    channel(state) {
      const current = entry(state)
      const usage = current?.balance
      return [
        { id: 'models', name: '模型提供方',
          enabled: current?.hasApiKey ? current.registerProvider : undefined,
          toggle: [id + 'SetEnabled', !current?.registerProvider],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.registerProvider && current.hasApiKey && !current.providerRegistered && ['待注册', 'warn']] },
        { id: 'key', name: 'API Key', meta: host,
          tags: [[current?.hasApiKey ? '已配置' : '待配置', current?.hasApiKey ? 'success' : undefined]],
          form: { kind: 'key', call: [id + 'SetKey'] } },
        ...(usage ? [{ id: 'usage', name: '账户用量',
          meta: usage.error ? undefined : `已用 ${apikeyMoney(usage.used, usage.unit)}${usage.limit !== null ? ` / ${apikeyMoney(usage.limit, usage.unit)}` : ''}`,
          tags: [usage.error && ['读取失败', 'warn'], usage.unlimited && ['无限额度', 'info']] }] : []),
      ]
    },
  }
  return provider
}

function createApiKeyActions(provider, { getState, publish, mutate }) {
  const id = provider.id, title = provider.title
  const patchModels = update => {
    const state = getState(), current = state.apikeys?.[id]
    if (state.provider !== id || !current) return
    publish({ apikeys: { ...state.apikeys, [id]: { ...current, models: update(current.models) } } })
  }
  const knownModel = modelId => typeof modelId === 'string' && getState().apikeys?.[id]?.models.some(model => model.id === modelId)
  const saveModel = (method, payload, message, result) => mutate(method, payload, { refresh: false, message, result })
  return {
    async [id + 'SetKey'](apiKey) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) { publish({ notice: `请输入 ${title} API Key。` }); return false }
      const saved = await mutate('apikey.setKey', { apiKey }, { progress: `正在保存 ${title} API Key…`, message: `${title} API Key 已保存。` })
      // 保存 Key 就是要用这个渠道：提供方仍是关闭状态时顺手启用。
      if (saved && getState().provider === id && getState().apikeys?.[id]?.registerProvider === false) {
        await mutate('apikey.setEnabled', { enabled: true }, { progress: `正在启用 ${title} 模型提供方…`, message: `${title} API Key 已保存，模型提供方已启用。` })
      }
      return saved
    },
    [id + 'SetEnabled'](enabled) {
      return mutate('apikey.setEnabled', { enabled: enabled === true }, {
        progress: enabled ? `正在启用 ${title} 模型提供方…` : `正在关闭 ${title} 模型提供方…`,
        message: enabled ? `${title} 模型提供方已启用。` : `${title} 模型提供方已关闭。` })
    },
    [id + 'SetModelEnabled'](modelId, enabled) {
      if (!knownModel(modelId) || typeof enabled !== 'boolean') return Promise.resolve(false)
      return saveModel('apikey.setModelEnabled', { modelId, enabled }, '模型显示设置已保存。', value => {
        if (value?.modelId !== modelId || typeof value?.enabled !== 'boolean') throw new Error('invalid model response')
        patchModels(models => models.map(model => model.id === modelId ? { ...model, enabled: value.enabled } : model))
      })
    },
    [id + 'SetModelParams'](modelId, params) {
      if (!knownModel(modelId)) return Promise.resolve(false)
      try { params = validatePlanParams(typeof params === 'object' && params !== null ? params : { maxTokens: params }) }
      catch { publish({ notice: '模型参数无效。' }); return Promise.resolve(false) }
      return saveModel('apikey.setModelParams', { modelId, params }, '模型参数已保存。', value => {
        if (value?.modelId !== modelId) throw new Error('invalid model response')
        patchModels(models => models.map(model => model.id === modelId ? { ...model, ...planModelFields({ ...model, ...value }) } : model))
      })
    },
    [id + 'ResetModels']() {
      return saveModel('apikey.resetModels', {}, '已恢复推荐模型。', value => {
        const enabled = new Set(value?.enabledModelIds)
        patchModels(models => models.map(model => ({ ...model, enabled: enabled.has(model.id) })))
      })
    },
  }
}

// ── src/client/providers/agnes.js ──
const agnes = apiKeyChannel({ id: 'agnes', title: 'Agnes', host: 'api.agnes-ai.cn' })

// ── src/client/providers/unisound.js ──
const unisound = apiKeyChannel({ id: 'unisound', title: '云知声', host: 'maas-api.unisound.com' })

// ── src/client/providers/astudio.js ──
const astudio = managedChannel({
  id: 'astudio',
  title: 'AStudio',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴 modelBearerToken（JWT）或 astron-session.json 内容',
  checkin: true,
  claimRewards: true,
})

// ── src/client/providers/doubaowork.js ──
const doubaowork = managedChannel({
  id: 'doubaowork',
  title: '豆包工作',
  authMethods: ['browser', 'credential'],
  credentialHint: '粘贴含 sessionid / sessionid_ss 的豆包 Cookie 字符串',
  checkin: false,
  claimRewards: false,
  completeTasks: true,
})

// ── src/client/providers/coze.js ──
const coze = managedChannel({
  id: 'coze',
  title: 'Coze',
  authMethods: ['browser', 'local', 'credential'],
  credentialHint: '粘贴 Coze 桌面端 PAT（cztei_…）、Cookie、coze-bridge modelToken 或 JSON 凭据',
  checkin: false,
  claimRewards: true,
})

// ── src/client/providers/codearts.js ──
const codearts = managedChannel({
  id: 'codearts',
  title: 'CodeArts',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkin: true,
  claimRewards: true,
})

// ── src/client/providers/index.js ──
const registeredProviders = [loomy, raccoon, raccoonPro, qodercn, trae, sensenova, workbuddy, agnes, unisound, astudio, doubaowork, coze, codearts]
const PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.card !== false)
  .map(provider => provider.pack ? packSettings(provider) : provider))
const PACK_PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.pack))
const PLAN_PROVIDER_ID = sensenova.id
const RACCOON_FAMILY = Object.freeze(raccoon.family.map(side => side.id))
const isRaccoonFamily = id => RACCOON_FAMILY.includes(id)
const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? null
const modelProvidersOf = id => providerById(id)?.family?.map(side => side.id) ?? [id]

// ── src/client/settings.js ──
const LAST_PROVIDER_KEY = 'eac-unified-router-last-provider'

function rememberedProvider() {
  try {
    const saved = globalThis.localStorage?.getItem(LAST_PROVIDER_KEY) ?? globalThis.sessionStorage?.getItem(LAST_PROVIDER_KEY)
    if (allowed(saved)) return saved
  } catch { /* Storage unavailable. */ }
  return PROVIDERS[0].id
}

function tabKeys(event, index, ids, activate) {
  const last = ids.length - 1
  const next = {
    ArrowLeft: (index + last) % ids.length,
    ArrowRight: (index + 1) % ids.length,
    Home: 0,
    End: last,
  }[event.key]
  if (typeof next !== 'number') return
  event.preventDefault()
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus()
  activate(ids[next])
}

const panelsFor = id => {
  const available = providerById(id)?.panelIds
  return available ? SETTINGS_PANELS.filter(panel => available.includes(panel.id)) : SETTINGS_PANELS
}

function Settings({ ctx }) {
  const storeRef = React.useRef(null)
  const [state, setState] = React.useState(() => restoredRouterState(rememberedProvider()))
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [enabledFirst, setEnabledFirst] = React.useState(true)
  const [selection, setSelection] = React.useState({ provider: state.provider, panel: panelsFor(state.provider)[0].id })
  const [more, setMore] = React.useState({})
  const [drafts, setDrafts] = React.useState({})
  const [editParams, setEditParams] = React.useState('')
  const [importOpen, setImportOpen] = React.useState('')
  const panels = panelsFor(state.provider)
  const panel = selection.provider === state.provider && panels.some(item => item.id === selection.panel) ? selection.panel : panels[0].id
  const setPanel = (tab, open) => {
    setSelection({ provider: state.provider, panel: tab })
    if (open) setMore(previous => ({ ...previous, [`${state.provider}:channel:${open}`]: true }))
  }
  React.useEffect(() => installStyles(), [])
  React.useEffect(() => {
    const store = createRouterStore((method, payload, signal) =>
      ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal), rememberedProvider())
    storeRef.current = store
    const unsubscribe = store.subscribe(setState)
    void store.load(rememberedProvider())
    void store.readHostSnapshots().then(found => { if (!found) void store.prefetchCards() })
    return () => { unsubscribe(); store.dispose(); if (storeRef.current === store) storeRef.current = null }
  }, [ctx])
  React.useEffect(() => { setQuery(''); setPage(0); setEditParams('') }, [state.provider])
  React.useEffect(() => {
    if (panel === 'models') void storeRef.current?.autoRefreshModels()
  }, [panel, state.provider, state.loading])
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof globalThis.setInterval !== 'function') return
    let ticks = 0
    const tick = (backgroundOnly = false) => {
      if (document.hidden) return
      const store = storeRef.current
      void store?.refreshLight(backgroundOnly)
      if (!backgroundOnly) void store?.prefetchCards()
    }
    const timer = globalThis.setInterval(() => tick(++ticks % 12 !== 0), 5000)
    const onVisible = () => tick()
    document.addEventListener?.('visibilitychange', onVisible)
    globalThis.addEventListener?.('focus', onVisible)
    return () => {
      globalThis.clearInterval?.(timer)
      document.removeEventListener?.('visibilitychange', onVisible)
      globalThis.removeEventListener?.('focus', onVisible)
    }
  }, [])
  const invoke = (method, ...args) => storeRef.current?.[method](...args)
  const act = (method, ...args) => {
    if (method === 'toggleParams') return setEditParams(previous => previous === args[0] ? '' : args[0])
    if (method === 'toggleMore') return setMore(previous => ({ ...previous, [args[0]]: !previous[args[0]] }))
    if (method === 'toggleImportForm') return setImportOpen(previous => previous === args[0] ? '' : (args[0] || ''))
    void invoke(method, ...args)
  }
  function selectProvider(id) {
    try { globalThis.localStorage?.setItem(LAST_PROVIDER_KEY, id) } catch { /* Storage unavailable. */ }
    setQuery(''); setPage(0); setEditParams(''); setImportOpen(''); setSelection({ provider: id, panel: panelsFor(id)[0].id })
    void invoke('load', id)
  }
  const provider = providerById(state.provider)
  const status = provider.statusFrom(state)
  const disabled = state.busy || state.loading
  const isPending = scope => !!(scope ? state.pending?.[scope] : state.busy)
  const toneFor = value => value?.tone ?? (value ? value.closed || value.accounts === 0 ? 'warn' : 'success' : undefined)
  const statusLabel = status?.label ?? (status ? status.closed ? '渠道已关闭'
    : status.accounts === 0 ? (status.totalAccounts > 0 ? '账号已停用' : '待添加账号') : '渠道运行中'
    : state.loading ? '读取中…' : '状态未知')
  const ui = { providerId: provider.id, invoke, act, disabled, isPending, loading: state.loading,
    failed: state.loadFailed || provider.snapshot?.failed(state), importOpen,
    query, setQuery, page, setPage, enabledFirst, setEnabledFirst, more, drafts, setDrafts, editParams, setPanel }
  return h('div', { className: 'eac-settings' },
    h('nav', { className: 'eac-providers', role: 'tablist', 'aria-label': '选择渠道' },
      ...PROVIDERS.map((item, index) => {
        const value = item.statusFrom(state)
        const selected = state.provider === item.id
        return h('button', { key: item.id, type: 'button', role: 'tab', className: 'eac-provider',
          'aria-selected': selected, tabIndex: selected ? 0 : -1, 'aria-label': `切换到 ${item.title}`,
          onClick: () => { if (!selected) selectProvider(item.id) },
          onKeyDown: event => tabKeys(event, index, PROVIDERS.map(value => value.id), id => { if (id !== state.provider) selectProvider(id) }) },
          h('span', { className: 'eac-provider-name' }, item.title),
          h('span', { className: 'eac-provider-meta' },
            h('span', { className: 'eac-provider-dot', 'data-tone': toneFor(value) }),
            value ? value.cardMeta ?? (value.closed ? '已关闭' : `${value.totalAccounts ?? value.accounts ?? '—'} 账号 · ${value.models ?? '—'} 模型`) : '待读取'))
      })),
    h('div', { className: 'eac-workspace', 'data-panel': panel },
      h('header', { className: 'eac-header' },
        h('h2', { className: 'eac-title' }, provider.title),
        h('div', { className: 'eac-header-actions' },
          h('span', { className: 'eac-status-chip', 'data-tone': toneFor(status) }, statusLabel),
          provider.panelIds || panel === 'models' ? null : button('刷新', () => act('refreshSettings'), state.busy, { 'aria-label': '刷新账号与额度' }))),
      h('div', { className: 'eac-panels', role: 'tablist', 'aria-label': '设置分区' },
        ...panels.map((item, index) =>
          h('button', { key: item.id, id: `eac-tab-${item.id}`, type: 'button', role: 'tab', className: 'eac-panel-tab',
            'aria-selected': panel === item.id, tabIndex: panel === item.id ? 0 : -1, 'aria-controls': `eac-panel-${item.id}`,
            onKeyDown: event => tabKeys(event, index, panels.map(value => value.id), setPanel),
            onClick: () => setPanel(item.id) }, item.label))),
      h('div', { className: 'eac-panel-body', role: 'tabpanel', id: `eac-panel-${panel}`, 'aria-labelledby': `eac-tab-${panel}` },
        state.notice ? h('div', { className: 'eac-notice', role: 'status', 'aria-live': 'polite' },
          h('p', null, state.notice),
          h('button', { type: 'button', className: 'eac-notice-close', 'aria-label': '关闭提示', onClick: () => act('message', '') }, '×')) : null,
        renderSettingsPanel(panel, provider, state, ui)))
  )
}

function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'unified-router', order: 23, label: 'Unified Router', inject: () => ({ ctx }) }, Settings))
}
  return { name: 'dsh-unified-router', inject: ['slots', 'connection'], apply, createRouterStore, safeLoginUrl, filterModels, claimMessage }
  },
})
