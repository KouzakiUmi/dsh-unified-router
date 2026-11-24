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

// 自管目录、宿主预算和推理描述符共用这两个值。旧覆盖不重写原文件，但不能挤掉整个输入窗口。
function modelTokenBudget(params, defaults, hardCap = null) {
  const contextWindow = params.contextWindow > 1 ? params.contextWindow : Math.max(2, defaults.defaultContextWindow)
  const maxOutputLength = Math.min(params.maxTokens ?? defaults.defaultMaxOutputLength, hardCap ?? Infinity, contextWindow - 1)
  return { contextWindow, maxOutputLength }
}

function validateModelBudgetPatch(previous, patch, defaults, hardCap = null) {
  if (patch.maxTokens == null && patch.contextWindow == null) return
  const next = { ...previous, ...patch }
  const context = next.contextWindow ?? defaults.defaultContextWindow
  const output = Math.min(next.maxTokens ?? defaults.defaultMaxOutputLength, hardCap ?? Infinity)
  if (patch.maxTokens != null && hardCap !== null && patch.maxTokens > hardCap) throw new Error('输出上限超出渠道限制')
  if (context <= 1 || output >= context) throw new Error('输出上限须小于上下文窗口')
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
  ['xopglm52', 'GLM 5.2'], ['xopglm51', 'GLM 5.1'],
  ['xopdsv4flash0731in', 'DeepSeek V4 Flash'], ['xdeepseek-flash-in', 'DeepSeek V4.1 Flash'],
  ['xopdeepseekv4pro0813', 'DeepSeek V4 Pro'], ['xopdeepseekv4pro', 'DeepSeek V4 Pro'],
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

/**
 * 渠道默认输出上限（设置页「默认输出上限」）的生效值。
 *
 * **只在上游没给输出规格时使用**：调用方必须先判断 `model.output`/`spec.maxOutput`
 * 是否为正数，只有都拿不到时才用这里。返回 `null` 表示本渠道没配置，调用方
 * 继续走 {@link defaultModelOutputTokens} 的通用推导。
 *
 * 结果永远不超过上下文窗口（输出不可能大于输入+输出窗口）。
 */
function channelOutputBudget(configured, context) {
  if (!Number.isSafeInteger(configured) || configured <= 0) return null
  return Number.isSafeInteger(context) && context > 0 ? Math.min(configured, context) : configured
}

// 思考档位强度序（数值越大越强），只服务「挑默认档」这一件事。
// 序值与 `vendor/channel-pack/src/reasoning-ladder.ts` 的 `REASONING_EFFORT_RANK`
// 一致（那份负责网关翻译与出站映射，是强度语义的唯一权威）；这里额外登记
// 各家私有别名（`light` / `extra_high` / `level_N` / `on`），因为远端目录
// 直接下发这些名字，挑默认档时必须能认出它们的强度。
const THINKING_EFFORT_RANK = Object.freeze({
  off: 0, none: 0,
  minimal: 1, level_1: 1,
  light: 2,
  low: 3, level_2: 3,
  medium: 4, level_3: 4,
  high: 5, on: 5, level_4: 5,
  extra_high: 6,
  xhigh: 7, level_5: 7,
  max: 8,
  ultra: 9,
})

// 私有档位 id → DSH 规范档位名（与 reasoning-ladder 的 CANONICAL_EFFORT_ALIAS 同值）。
const THINKING_EFFORT_CANONICAL = Object.freeze({
  light: 'low', extra_high: 'xhigh', none: 'off', on: 'high',
  level_1: 'minimal', level_2: 'low', level_3: 'medium', level_4: 'high', level_5: 'xhigh',
})

// 「有效默认」的下限：medium。低于它的档位（off/minimal/low/light）不作为默认，
// 除非该模型**只**提供这些档位（能力受限时尊重能力，不编造更强的档）。
const EFFECTIVE_THINKING_RANK = 4
// 声明值不可用时的偏好序：先 preferred，再 medium → high → 更强档。
const STRONGER_THINKING_EFFORTS = Object.freeze(['medium', 'high', 'xhigh', 'max'])

function thinkingEffortRank(effort) {
  return Object.hasOwn(THINKING_EFFORT_RANK, effort) ? THINKING_EFFORT_RANK[effort] : undefined
}

function thinkingEffortCanonical(effort) {
  return Object.hasOwn(THINKING_EFFORT_CANONICAL, effort) ? THINKING_EFFORT_CANONICAL[effort] : effort
}

/**
 * 挑一个模型的**默认思考档**。
 *
 * 规则（顺序即优先级）：
 * 1. 声明值（上游 `default_reasoning_effort` / 兜底表值）可用且
 *    **不弱于 medium** → 原样保留（「有效中/高默认优先」；未登记强度的上游
 *    私有默认值同样保留 —— 认不出强度就不替它改）；
 * 2. 否则先试 `preferred`，再按 medium → high → xhigh → max 找该模型**真实
 *    支持**的更强档（不编造档位：返回的 id 一定在 `efforts` 里）；
 * 3. 没有规范档位可对（上游新造的名字）→ 取强度最高的已登记档；
 * 4. 只剩关闭档或完全认不出 → 有声明值就留着，否则第一项（尊重能力）。
 *
 * 为什么不允许默认落到 off/low/minimal：Loomy 远端把 `low` 声明成默认、
 * Agnes 上游默认不思考、Raccoon 托管档位缺省时旧实现取最低思考档 —— 用户
 * 看到的现象都是「档位设置无效、模型不思考 / 想得太浅」。默认档必须落在
 * 中/高档，把「关掉思考」留给用户显式选择。
 * @param {readonly string[]} efforts - 该模型可选的档位 id（私有名或规范名）。
 * @param {string | undefined} declared - 上游/兜底/设置的声明默认档。
 * @param {string} [preferred] - 声明值不可用时优先尝试的档位（缺省 medium）。
 * @returns {string | undefined} 受支持的非空档位；没有可用档位时省略。
 */
function defaultModelEffort(efforts, declared, preferred = 'medium') {
  const list = Array.isArray(efforts) ? efforts.filter(e => typeof e === 'string' && e !== '' && e.trim() === e) : []
  if (list.length === 0) return undefined
  const declaredRank = thinkingEffortRank(declared)
  if (declared !== undefined && list.includes(declared)
      && (declaredRank === undefined || declaredRank >= EFFECTIVE_THINKING_RANK)) {
    return declared
  }
  for (const candidate of [preferred, ...STRONGER_THINKING_EFFORTS]) {
    const hit = list.find(effort => thinkingEffortCanonical(effort) === candidate)
    if (hit !== undefined) return hit
  }
  let strongest
  for (const effort of list) {
    const rank = thinkingEffortRank(effort)
    if (rank === undefined || rank === 0) continue
    if (strongest === undefined || rank > strongest.rank) strongest = { effort, rank }
  }
  if (strongest !== undefined) return strongest.effort
  if (declared !== undefined && list.includes(declared)) return declared
  return list[0]
}

// 目录可能在用户保存后变更。已失效的本地偏好不参与请求；显式保存的 off 仍然生效。
function effectiveModelEffort(efforts, saved, fallback) {
  return Array.isArray(efforts) && typeof saved === 'string' && saved !== '' && saved.trim() === saved && efforts.includes(saved)
    ? saved : fallback
}

function modelIdentity(value) {
  return value.toLowerCase()
    .replace(/^sn-(.*?)(?:-p)?$/, '$1')
    .replace(/^person-/, '')
    .replace(/-selected$/, '')
    .replace(/[._]+/g, '-')
    .replace(/-ga-(?=\d{4,8}$)/, '-')
    .replace(/^qwen(?=\d)/, 'qwen-')
    .replace(/^openpangu(?=\d)/, 'openpangu-')
    .replace(/^doubao-seed(?=-)/, 'seed')
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
  astudio: {
    xopglm52: 'glm-5-2',
    xopglm51: 'glm-5-1',
    xopdsv4flash0731in: 'deepseek-v4-flash-0731',
    xopdeepseekv4pro0813: 'deepseek-v4-pro-0813',
    xopdeepseekv4pro: 'deepseek-v4-pro-0813',
    'xdeepseek-flash-in': 'deepseek-v4-1-flash-1017',
  },
}

function catalogIdentity(id, provider) {
  const aliases = Object.hasOwn(catalogIdentities, provider) ? catalogIdentities[provider] : {}
  return Object.hasOwn(aliases, id.toLowerCase()) ? aliases[id.toLowerCase()] : modelIdentity(id)
}

function stripReleaseSuffix(value) {
  return value.replace(/-(?:\d{4}|\d{6}|\d{8})$/, '')
}

function modelGeneration(value) {
  const match = /^(sensenova|deepseek|qwen|glm|kimi|minimax|mimo|claude|gemini|gpt|spark|seed|step|openpangu|agnes|llama|grok|gemma)[-_]?((?:opus|sonnet|haiku)[-_])?([kmvx]?)(\d+)(?:[.-](\d{1,2})(?!\d))?(?:[.-](\d{1,2})(?!\d))?(.*)$/i.exec(value)
  if (!match) return null
  const [, brand, series = '', prefix, major, minor, patch, tail] = match
  const release = /-(\d{4}|\d{6}|\d{8})$/.exec(tail)?.[1]
  const preview = /(?:^|-)preview(?:-|$)/.test(tail)
  const variant = tail.replace(/-(?:\d{4}|\d{6}|\d{8})$/, '').replace(/-preview$/, '')
  return { group: [brand.toLowerCase(), series.toLowerCase(), prefix.toLowerCase(), variant].join('/'),
    version: Number(major) * 10000 + Number(minor ?? 0) * 100 + Number(patch ?? 0),
    preview, release }
}

// Catalog-confirmed replacements where the new generation's name gained a tier.
// Global rules apply to every provider; `providerNamedSuccessors` entries only
// apply to that provider (the evidence is catalog-specific: e.g. TRAE's remote
// catalog still lists superseded ids like `qwen-3.5` alongside their successors).
const namedSuccessors = new Map([
  ['kimi-k2-7-code', 'kimi-k3-1-pro'],
  ['kimi-k2-8-preview', 'kimi-k3-1-pro'],
  ['kimi-k3', 'kimi-k3-1-pro'],
  ['minimax-m3', 'minimax-m3-1-flash'],
  ['deepseek-v4-flash', 'deepseek-v4-1-flash-1017'],
  ['deepseek-v4-1-flash', 'deepseek-v4-1-flash-1017'],
  ['qwen-3-7-plus', 'qwen-3-8-max'],
  ['agnes-2-5-pro-alpha', 'agnes-3-0-pro'],
  ['agnes-2-5-pro-beta', 'agnes-3-0-pro'],
  ['agnes-2-5-pro-theta', 'agnes-3-0-pro'],
  ['glm-5-2-sft-harmony', 'glm-5-3'],
])
const providerNamedSuccessors = {
  trae: new Map([
    ['deepseek-v3-1', 'deepseek-v4-1-flash'],
    ['seed-code', 'seed-2-1-turbo'],
    ['seed-2-0-code', 'seed-2-1-turbo'],
    ['doubao-2-0-mini', 'seed-2-1-turbo'],
    ['glm-5v-turbo', 'glm-5-3-flash'],
    ['qwen-3-5', 'qwen-4-max'],
    ['qwen-3-6-plus', 'qwen-3-8-max'],
    ['minimax-m2-7', 'minimax-m3-1-flash'],
    ['kimi-k2-6', 'kimi-k3-1-pro'],
  ]),
  workbuddy: new Map([
    // 同目录存在完全同型号的免费版 hy4flash-free，收费版 hy4flash 不再默认启用。
    ['hy4flash', 'hy4flash-free'],
  ]),
}

// 全平台已明确过时的老一代型号：即使单个渠道目录里没有同族新代，只要目录里还存在
// 其他现代推荐模型，也默认移出推荐（仍保留在目录中供手动启用，且绝不清空整个渠道）。
const obsoleteIdentities = new Set([
  'deepseek-v3', 'deepseek-v3-1', 'deepseek-v4-flash',
  'glm-4-7', 'glm-5', 'glm-5-1', 'glm-5-2', 'glm-5v-turbo', 'glm-5-2-sft-harmony',
  'kimi-k2-5', 'kimi-k2-6', 'kimi-k2-7-code', 'kimi-k2-8-preview', 'kimi-k3',
  'qwen-3-5', 'qwen-3-6-plus', 'qwen-3-7-plus',
  'minimax-m2-7', 'minimax-m3',
  'doubao-2-0-mini', 'seed-code', 'seed-2-0-code',
  'agnes-2-5-flash', 'agnes-2-5-pro', 'agnes-2-5-pro-alpha', 'agnes-2-5-pro-beta', 'agnes-2-5-pro-theta',
])

function modelSuccessors(models, provider) {
  const groups = new Map()
  const byName = new Map()
  for (const model of models) {
    if (model.dead) continue
    const name = catalogIdentity(model.id, provider)
    const baseName = stripReleaseSuffix(name)
    const generation = modelGeneration(name)
    if (!model.stale) {
      byName.set(name, model.id)
      if (!byName.has(baseName)) byName.set(baseName, model.id)
    }
    if (!generation) continue
    const group = groups.get(generation.group) ?? []
    group.push({ ...generation, id: model.id, name, baseName, stale: model.stale === true })
    groups.set(generation.group, group)
  }
  const named = new Map(namedSuccessors)
  const scoped = Object.hasOwn(providerNamedSuccessors, provider) ? providerNamedSuccessors[provider] : undefined
  if (scoped) for (const [from, to] of scoped) named.set(from, to)
  const result = new Map()
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => b.version - a.version || Number(a.preview) - Number(b.preview)
      || (b.release ?? '').localeCompare(a.release ?? ''))
    for (const item of sorted) {
      const newer = sorted.find(candidate => !candidate.stale && (item.preview || !candidate.preview)
        && (candidate.version > item.version || candidate.version === item.version
          && (item.preview && !candidate.preview || candidate.release?.length === item.release?.length
            && candidate.release > item.release)))
      const baseTarget = named.get(item.baseName)
      const replacement = newer?.id
        ?? byName.get(named.get(item.name))
        ?? (baseTarget && baseTarget !== item.name ? byName.get(baseTarget) : undefined)
      if (replacement && replacement !== item.id) result.set(item.id, replacement)
    }
  }
  // Ungrouped ids (no version digits, e.g. `seed-code`) never enter a generation
  // group, so the named-successor pass above can never see them. Run the same
  // named lookup for every catalog entry not already marked older; a grouped
  // entry left unmarked simply gets the identical second lookup the group pass
  // would have produced, so nothing new can be excluded by it.
  for (const model of models) {
    if (model.dead || result.has(model.id)) continue
    const name = catalogIdentity(model.id, provider)
    const baseName = stripReleaseSuffix(name)
    const baseTarget = named.get(baseName)
    const replacement = byName.get(named.get(name))
      ?? (baseTarget && baseTarget !== name ? byName.get(baseTarget) : undefined)
    if (replacement && replacement !== model.id) result.set(model.id, replacement)
  }
  return result
}

// Comparable coding alternatives, backed by the dated evidence in MODEL-CURATION.md.
// These are directional comparisons for default selection, not a global model ranking.
const codingAlternatives = new Map([
  ['deepseek-v4-pro-0813', ['deepseek-v4-1-flash-1017', 'deepseek-v4-1-flash']],
  ['deepseek-v4-pro', ['deepseek-v4-1-flash-1017', 'deepseek-v4-1-flash', 'deepseek-flash']],
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
  const aliveModels = models.filter(model => !model.dead)
  const hasModernSurvivor = aliveModels.some(model => {
    if (older.has(model.id) || model.stale) return false
    const identity = catalogIdentity(model.id, provider)
    const baseIdentity = stripReleaseSuffix(identity)
    return !obsoleteIdentities.has(identity) && !obsoleteIdentities.has(baseIdentity)
  })
  for (const model of aliveModels) {
    const identity = catalogIdentity(model.id, provider)
    const baseIdentity = stripReleaseSuffix(identity)
    if (older.has(model.id) || model.stale) {
      exclusions.set(model.id, { kind: 'older', alternative: older.get(model.id) })
      continue
    }
    if (hasModernSurvivor && (obsoleteIdentities.has(identity) || obsoleteIdentities.has(baseIdentity))) {
      exclusions.set(model.id, { kind: 'older', alternative: undefined })
      continue
    }
    const rate = modelMultiplier(model)
    const declaredContext = Object.hasOwn(model, 'context') ? model.context : model.defaultContextWindow ?? model.contextWindow
    // 目录未下发上下文窗口时，使用官方规格参与性价比比较。
    const context = declaredContext > 0 ? declaredContext : (officialModelSpec(model.id, provider)?.context ?? 0)
    if (rate !== undefined) candidates.push({
      id: model.id, identity, baseIdentity, rate, context,
      image: Object.hasOwn(model, 'attachment') ? model.attachment : model.defaultVision ?? model.supportsImage,
    })
  }
  const contextTier = value => (value >= 1_000_000 ? 1_000_000 : value)
  candidates.sort((a, b) => a.rate - b.rate)
  for (const item of candidates) {
    if (item.rate === 0) continue
    const alternatives = codingAlternatives.get(item.identity) ?? codingAlternatives.get(item.baseIdentity)
    if (!alternatives) continue
    const better = candidates.find(other => (alternatives.includes(other.identity) || alternatives.includes(other.baseIdentity))
      && !exclusions.has(other.id) && other.rate <= item.rate * 2 / 3
      && contextTier(other.context) >= contextTier(item.context > 0 ? item.context : 1_000_000)
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
  'agnes-3-0-pro': { context: 1_048_576, maxOutput: 65_536 },
  'agnes-2-5-pro': { context: 1_048_576, maxOutput: 65_536 },
  'agnes-2-5-pro-alpha': { context: 1_048_576, maxOutput: 65_536 },
  'agnes-2-5-pro-beta': { context: 1_048_576, maxOutput: 65_536 },
  'u2-flash': { context: 1_048_576, maxOutput: 262_144 },
  // 云知声：以**上游目录真值**为准（2026-11-23 用真实 Key 拉
  // `/anthropic/v1/models` 核对，优先于第三方转述的 163K/65K）。
  // u2 = 160,000 / 64,000；u2-med = 262,144，上游 `max_output` 为 `null`
  //（不公开），故只登记 context，输出预算走通用推导，不编造官方值。
  u2: { context: 160_000, maxOutput: 64_000 },
  'u2-med': { context: 262_144 },
})

// 经实测确认的渠道协议硬上限（CodeArts v2 网关 RANGE_VALIDATOR 0..65536；超限必拒 400）。
const CHANNEL_OUTPUT_HARD_CAPS = Object.freeze({
  codearts: 65_536,
})

const SPEC_ALIAS_PREFIXES = Object.freeze([
  [/^xopglm52$/, 'glm-5-2'],
  [/^glm-5-2-zx$/, 'glm-5-2'],
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

// ── src/client/../../lib/apikey-quota-projection.js ──
const APIKEY_CONSOLES = Object.freeze({
  agnes: 'https://platform.agnes-ai.cn/subscribe/subscription',
  unisound: 'https://maas.unisound.com/admin/subscript',
})

const GIFT_UNITS = Object.freeze({
  TOKEN: 'Token',
  HOUR: '小时',
  HOURS: '小时',
  DURATION: '小时',
  CHAR: '字',
  CHARS: '字',
  CHARACTER: '字',
  CREDIT: '积分',
  CREDITS: '积分',
  小时: '小时',
  字: '字',
  积分: '积分',
})

// 上游控制台接口（如云知声 U Plan 的 weeklyPointsTotal/Remain/Used）常把数值
// 序列化为十进制字符串；统一接受非负有限数字及纯非负十进制数字字符串。
const apiQuotaAmount = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || !/^\d+(?:\.\d+)?$/.test(trimmed)) return null
    value = Number(trimmed)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
const apiQuotaClampedAmount = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-\d+(?:\.\d+)?$/.test(trimmed)) return 0
  } else if (typeof value === 'number' && Number.isFinite(value) && value < 0) {
    return 0
  }
  return apiQuotaAmount(value)
}
function apiQuotaWindow(id, used, limit, remaining, resetInMs) {
  used = apiQuotaAmount(used); limit = apiQuotaAmount(limit); remaining = apiQuotaAmount(remaining)
  if (remaining === null && used !== null && limit !== null) remaining = Math.max(0, limit - used)
  const hint = Number.isSafeInteger(resetInMs) && resetInMs > 0 && resetInMs <= 7 * 86400000 ? { resetInMs } : {}
  return used === null && remaining === null ? null : { id, used, limit, remaining, ...hint }
}
function apiQuotaGift(modelId, used, limit, remaining, unit) {
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(modelId)) return null
  used = apiQuotaAmount(used); limit = apiQuotaAmount(limit); remaining = apiQuotaAmount(remaining)
  if (remaining === null && used !== null && limit !== null) remaining = Math.max(0, limit - used)
  if (used === null && remaining === null) return null
  const rawUnit = typeof unit === 'string' ? unit.trim() : ''
  const normalizedUnit = GIFT_UNITS[rawUnit] ?? GIFT_UNITS[rawUnit.toUpperCase()] ?? ''
  return { modelId, used, limit, remaining, unit: normalizedUnit }
}

function projectApiKeyQuota(value) {
  if (!value || typeof value !== 'object') return null
  if (['needs-console', 'unavailable', 'expired', 'error'].includes(value.status)) return { status: value.status }
  if (value.status !== 'ready') return null
  const windows = (Array.isArray(value.windows) ? value.windows : []).slice(0, 8)
    .filter(row => ['weekly-points', 'window-points', 'monthly-credits', 'window-credits', 'pack-credits', 'weekly-requests', 'window-requests'].includes(row?.id))
    .map(row => apiQuotaWindow(row.id, row.used, row.limit, row.remaining, row.resetInMs)).filter(Boolean)
  const gifts = (Array.isArray(value.gifts) ? value.gifts : []).slice(0, 16)
    .map(row => apiQuotaGift(row?.modelId, row?.used, row?.limit, row?.remaining, row?.unit)).filter(Boolean)
  return {
    status: 'ready',
    windows,
    ...(gifts.length ? { gifts } : {}),
    balance: apiQuotaAmount(value.balance),
    updatedAt: apiQuotaAmount(value.updatedAt),
  }
}

function projectApiKeyRateLimit(value) {
  if (!Number.isSafeInteger(value?.until) || value.until <= 0) return null
  return { until: value.until, reason: ['rpm', 'tpm'].includes(value.reason) ? value.reason : 'unknown', estimated: value.estimated === true }
}

// ── src/client/core.js ──
// 共享常量、输入校验与 wire 归一化：把主机投影后的数据收编成视图状态。
// 视图绝不保留原始凭据或上游错误（accountsFrom/modelsFrom 等只收编白名单字段）。
// 渠道注册表在 providers/index.js；本模块不定义渠道清单，全部按注册表推导。
// （拼接机制下跨模块按名引用，注册表晚于本模块定义没关系——只在运行时取用。）

const MODEL_PAGE_SIZE = 15
const PLAN_METHODS = new Set(['plan.snapshot', 'plan.setEnabled', 'plan.setKey', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels', 'plan.consoleLogin'])
const WORKBUDDY_METHODS = new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.setAccountEnabled', 'workbuddy.models', 'workbuddy.setModelEnabled', 'workbuddy.setModelParams', 'workbuddy.resetModels'])
// API Key 渠道（Agnes、云知声）共用的宿主方法；渠道 id 在 payload.provider 里带。
const APIKEY_METHODS = new Set(['apikey.snapshot', 'apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels', 'apikey.setToolsEnabled', 'apikey.setConsoleSession', 'apikey.consoleLogin', 'apikey.clearConsoleSession'])
// 自管多账号渠道（AStudio / CodeArts）共用的宿主方法。
const MANAGED_METHODS = new Set([
  'managed.snapshot', 'managed.models', 'managed.refreshModels',
  'managed.login', 'managed.importLocal', 'managed.importCredential',
  'managed.updateAccount', 'managed.logout', 'managed.setEnabled',
  'managed.checkin', 'managed.claimRewards', 'managed.completeTasks',
  'managed.setModelEnabled', 'managed.setModelParams', 'managed.resetModels',
])
const AUTOMATION_METHODS = new Set(['automation.status', 'automation.setConfig', 'automation.run', 'automation.query'])
const LOOMY_ROUTE_METHODS = new Set(['loomy.routeStatus', 'loomy.checkRoute', 'loomy.clearRoute', 'loomy.setRouteConfig'])
const METHODS = new Set(['provider.status', 'account.list', 'model.list', 'credits.permanentLock',
  'account.create', 'login.poll', 'account.update', 'account.delete', 'account.reorder', 'account.refresh',
  'account.reset', 'account.retest', 'provider.setEnabled', 'model.setDisabled', 'model.clearDead',
  'model.setAllDisabled', 'model.resetDefaults', 'model.refresh', 'model.params', 'model.setParams',
  'credits.balances', 'credits.claimAll', 'onboarding.claim', 'settings.snapshot', 'settings.refresh',
  ...PLAN_METHODS, ...AUTOMATION_METHODS, ...LOOMY_ROUTE_METHODS])
const WORKBUDDY_ID = 'workbuddy'
const allowed = id => PROVIDERS.some(p => p.id === id)
const packAllowed = id => PACK_PROVIDERS.some(p => p.id === id)
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const initial = provider => ({ provider, accounts: [], models: [], balances: [], statuses: {}, selected: '', loadFailed: false,
  checkin: null,
  automation: null,
  loomyRoute: { skipRouted: true, accounts: {} },
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
const LOOMY_ROUTE_VERDICTS = new Set(['clean', 'routed', 'exhausted', 'expired', 'unknown'])
const LOOMY_ROUTE_REASONS = new Set([
  'ledger-deepseek', 'ledger-spark', 'ledger-other-family', 'catalog-missing-ds41',
  'served-model-match', 'served-model-mismatch', 'no-quota', 'session-expired',
  'account-disabled', 'no-ledger-records',
])
const LOOMY_ROUTE_REASON_LABELS = Object.freeze({
  'ledger-deepseek': '积分账本',
  'ledger-spark': '积分账本（Spark）',
  'ledger-other-family': '积分账本（异族模型）',
  'catalog-missing-ds41': '目录缺失 DS4.1',
  'served-model-match': '响应模型匹配',
  'served-model-mismatch': '响应模型不匹配',
  'no-quota': '积分不足',
  'session-expired': '登录已失效',
  'account-disabled': '账号已停用',
  'no-ledger-records': '尚无对话扣费记录',
})
function loomyRouteEntryFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!LOOMY_ROUTE_VERDICTS.has(value.verdict)) return null
  const reason = LOOMY_ROUTE_REASONS.has(value.reason) ? value.reason : ''
  const servedModel = text(value.servedModel, 120)
  const checkedAt = number(value.checkedAt)
  return {
    verdict: value.verdict,
    ...(reason ? { reason } : {}),
    ...(servedModel ? { servedModel } : {}),
    ...(checkedAt !== null ? { checkedAt } : {}),
  }
}
function loomyRouteFrom(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const raw = source.accounts && typeof source.accounts === 'object' && !Array.isArray(source.accounts) ? source.accounts : {}
  const accounts = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (typeof id !== 'string' || !id || ['__proto__', 'prototype', 'constructor'].includes(id)) continue
    const clean = loomyRouteEntryFrom(entry)
    if (clean) accounts[id] = clean
  }
  return { skipRouted: source.skipRouted !== false, accounts }
}
function loomyRouteView(state, account) {
  const entry = loomyRouteEntryFrom(state.loomyRoute?.accounts?.[account.id] ?? account?.route)
  if (!entry) {
    return {
      entry: null,
      tag: ['路由未检测', undefined, '点击「检测路由」只读验证目录与账本（0 积分）'],
      detail: {
        statusLabel: '检测状态',
        servedLabel: '未检测',
        reasonLabel: '请点击「检测路由」只读验证目录与账本（0 积分）',
        checkedAt: 0,
      },
    }
  }
  const reasonLabel = LOOMY_ROUTE_REASON_LABELS[entry.reason] || ''
  const checkedText = entry.checkedAt > 0 ? `检测于 ${displayTime(entry.checkedAt)}` : ''
  const title = [entry.servedModel ? `实际落地：${entry.servedModel}` : '', reasonLabel, checkedText].filter(Boolean).join(' · ')
  let label = '暂无账本记录'
  let tone
  let statusLabel = '路由状态'
  if (entry.verdict === 'clean') {
    label = '路由正常'
    tone = 'success'
    statusLabel = '实测落地模型'
  } else if (entry.verdict === 'routed') {
    label = entry.reason === 'catalog-missing-ds41' ? '改路由 · 目录无 DS4.1'
      : entry.servedModel ? `改路由 → ${entry.servedModel}` : '上游改路由'
    tone = 'error'
    statusLabel = entry.reason === 'catalog-missing-ds41' ? '目录可见模型' : '实际落地模型'
  } else if (entry.verdict === 'exhausted') {
    label = '路由待测 · 积分不足'
    tone = 'warn'
    statusLabel = '探测阻塞'
  } else if (entry.verdict === 'expired') {
    label = entry.reason === 'account-disabled' ? '账号已停用' : '凭据已失效'
    tone = entry.reason === 'account-disabled' ? 'error' : 'warn'
    statusLabel = '账号状态'
  }
  return {
    entry,
    tag: [label, tone, title || label],
    detail: {
      statusLabel,
      servedLabel: entry.servedModel || label,
      reasonLabel,
      checkedAt: entry.checkedAt,
    },
  }
}
function loomyRouteCounts(state) {
  const accounts = state.accounts ?? []
  const out = { total: accounts.length, clean: 0, routed: 0, expired: 0, exhausted: 0, unknown: 0, unchecked: 0 }
  for (const account of accounts) {
    const entry = loomyRouteEntryFrom(state.loomyRoute?.accounts?.[account.id] ?? account?.route)
    if (!entry) out.unchecked += 1
    else if (entry.verdict === 'clean') out.clean += 1
    else if (entry.verdict === 'routed') out.routed += 1
    else if (entry.verdict === 'expired') out.expired += 1
    else if (entry.verdict === 'exhausted') out.exhausted += 1
    else out.unknown += 1
  }
  return out
}
function loomyRouteSummaryText(state) {
  const counts = loomyRouteCounts(state)
  if (!counts.total) return ''
  const parts = []
  if (counts.clean) parts.push(`正常 ${counts.clean}`)
  if (counts.routed) parts.push(`改路由 ${counts.routed}`)
  if (counts.expired + counts.exhausted) parts.push(`异常 ${counts.expired + counts.exhausted}`)
  if (counts.unknown) parts.push(`无账本 ${counts.unknown}`)
  if (!parts.length) return `路由未检测 ${counts.unchecked}`
  if (counts.unchecked) parts.push(`未检测 ${counts.unchecked}`)
  return `路由 ${parts.join(' · ')}`
}
function loomyRouteLatestAt(state) {
  let latest = 0
  for (const account of state.accounts ?? []) {
    const entry = loomyRouteEntryFrom(state.loomyRoute?.accounts?.[account.id] ?? account?.route)
    if (entry?.checkedAt > latest) latest = entry.checkedAt
  }
  for (const raw of Object.values(state.loomyRoute?.accounts ?? {})) {
    const entry = loomyRouteEntryFrom(raw)
    if (entry?.checkedAt > latest) latest = entry.checkedAt
  }
  return latest
}
function loomyRouteMessage(value, singleAccount) {
  if (singleAccount) {
    const entry = loomyRouteEntryFrom(value?.accounts?.[singleAccount])
    if (!entry) return '路由检测未获得结果，请稍后重试。'
    if (entry.verdict === 'clean') return `路由检测完成：路由正常（${entry.servedModel || 'DeepSeek'}）。`
    if (entry.verdict === 'routed') return `检测到上游改路由：实际落地 ${entry.servedModel || '非 DeepSeek 模型'}。`
    if (entry.verdict === 'exhausted') return '当前账号积分不足，暂无法完成路由判定。'
    if (entry.verdict === 'expired') return entry.reason === 'account-disabled' ? '检测到账号已被上游停用。' : '账号登录态已失效，请重新登录。'
    return '暂未查到对话扣费记录，使用后可自动判定或再次检测。'
  }
  const s = value?.summary
  if (!s || !s.tested) return '当前没有需要检测的 Loomy 账号。'
  const parts = []
  if (s.clean) parts.push(`${s.clean} 个正常`)
  if (s.routed) parts.push(`${s.routed} 个改路由`)
  if (s.expired + s.exhausted) parts.push(`${s.expired + s.exhausted} 个不可用`)
  if (s.unknown) parts.push(`${s.unknown} 个无账本记录`)
  if (s.error) parts.push(`${s.error} 个失败`)
  return `路由检测完成（共 ${s.tested} 个）：${parts.join('，') || '无变化'}。`
}
function accountsFrom(value, provider) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && a.provider === provider && typeof a.id === 'string').map(a => {
    const route = provider === 'loomy' ? loomyRouteEntryFrom(a.route) : null
    return {
      id: a.id, provider, nickname: text(a.nickname, 80) || '未命名账号', enabled: a.enabled !== false,
      expiresAt: number(a.expiresAt),
      // 套餐档位（Raccoon 家族按它分流：免费模型侧 / 订阅模型侧）。缺省不是错误：
      // 老账号可能还没被探测打过标，界面按「未知」显示。
      plan: a.plan === 'free' || a.plan === 'pro' || a.plan === 'unknown' ? a.plan : '',
      ...(route ? { route } : {}),
      modelRateLimits: Object.fromEntries(Object.entries(a.modelRateLimits ?? {}).filter(([, time]) => Number.isFinite(time) && time > Date.now())),
    }
  })
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
    subscriptionOnly: m.subscriptionOnly === true,
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
function replaceProviderParams(params, value, provider) {
  return {
    ...Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith(`${provider}:`))),
    ...paramsFrom(value, provider),
  }
}
function windowRemainingAmount(window) {
  if (!window) return null
  if (typeof window.balance === 'number' && Number.isFinite(window.balance)) return window.balance
  if (typeof window.amount === 'number' && Number.isFinite(window.amount) && window.limit > 0) {
    return Math.max(0, Math.round((window.limit - window.amount) * 10000) / 10000)
  }
  return null
}
function windowRemainingNote(window, unitText = window?.unit || '') {
  const remaining = windowRemainingAmount(window)
  if (remaining === null) return false
  return `剩余 ${displayNumber(remaining)}${window.limit > 0 ? ` / ${displayNumber(window.limit)}` : ''}${unitText ? ` ${unitText}` : ''}`
}
const displayCreditUnit = unit => /^credits?$/i.test(String(unit || '').trim()) ? '积分' : String(unit || '').trim()
function balancesFrom(value) {
  return (Array.isArray(value?.accounts) ? value.accounts : []).filter(a => a && typeof a.accountId === 'string').map(a => ({
    accountId: a.accountId, nickname: text(a.nickname, 80) || '未命名账号', total: number(a.balance?.total),
    updatedAt: number(a.updatedAt), stale: Boolean(a.error),
    packages: (Array.isArray(a.balance?.packages) ? a.balance.packages : []).slice(0, 40).map(p => {
      const rawUnit = text(p.unit, 20)
      return {
        name: text(p.name, 80), remaining: number(p.remaining),
        unit: displayCreditUnit(rawUnit),
        expiresAt: number(p.expiresAt), active: p.active !== false,
      }
    }),
  }))
}
function displayCreditPackages(packages) {
  const grouped = new Map()
  const ordered = []
  for (const pkg of Array.isArray(packages) ? packages : []) {
    if (!pkg) continue
    const rawName = pkg.name || ''
    const key = `${rawName}\0${pkg.active !== false ? '1' : '0'}\0${pkg.unit || ''}`
    let entry = grouped.get(key)
    if (!entry) {
      entry = { base: pkg, count: 0, knownRemaining: false, remaining: 0, expiresAt: null }
      grouped.set(key, entry)
      ordered.push(entry)
    }
    entry.count += 1
    if (typeof pkg.remaining === 'number' && Number.isFinite(pkg.remaining)) {
      entry.knownRemaining = true
      entry.remaining += pkg.remaining
    }
    if (typeof pkg.expiresAt === 'number' && Number.isFinite(pkg.expiresAt) && pkg.expiresAt > 0) {
      entry.expiresAt = entry.expiresAt === null ? pkg.expiresAt : Math.min(entry.expiresAt, pkg.expiresAt)
    }
  }
  return ordered.map(({ base, count, knownRemaining, remaining, expiresAt }) => count === 1 ? base : {
    ...base,
    name: `${base.name || '额度包'}（${count} 笔）`,
    remaining: knownRemaining ? Math.round(remaining * 100) / 100 : null,
    expiresAt,
  })
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
    quota: source.quota ?? null,
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
      .map(model => ({
        id: model.id, name: text(model.name), enabled: model.enabled !== false,
        ...(model.free === true ? { free: true } : {}),
        ...(model.paidOnly === true ? { paidOnly: true } : {}),
        ...planModelFields(model),
      })),
    balance: apikeyBalanceFrom(source.balance),
    quota: projectApiKeyQuota(source.quota),
    rateLimit: projectApiKeyRateLimit(source.rateLimit),
    toolsSupported: source.toolsSupported === true,
    toolsEnabled: source.toolsEnabled === true,
    toolsRegistered: source.toolsRegistered === true,
    // 控制台会话能力按渠道声明：宿主只对配了 consoleCredentialRef 的渠道透出
    // hasConsoleSession，这里保留「字段是否存在」语义，避免给 Agnes 也渲染控制台行。
    ...(typeof source.hasConsoleSession === 'boolean' ? { hasConsoleSession: source.hasConsoleSession } : {}),
    consoleLoginUrl: typeof source.consoleLoginUrl === 'string' ? source.consoleLoginUrl : '',
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
    expiresAt: text(value.expiresAt, 48), aside: value.aside === true,
    models: Array.isArray(value.models) ? value.models.slice(0, 256).map(id => text(id, 256)).filter(Boolean) : [],
    notModels: Array.isArray(value.notModels) ? value.notModels.slice(0, 256).map(id => text(id, 256)).filter(Boolean) : [],
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
    // 账号开关（缺省启用）：与宿主投影、索引三处同一判据。
    enabled: value.enabled !== false,
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
const MANAGED_ERROR_CODES = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error', 'task_error', 'import_error', 'unsupported', 'no_web_session'])
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
        updatedAt: old.updatedAt,
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
      // Loomy 请求体形态：true = 简化体。当前无界面入口，仅为配置往返保留。
      if (typeof entry.loomyPlainBody === 'boolean') clean.loomyPlainBody = entry.loomyPlainBody
      // 分渠道默认输出上限：只在上游缺输出规格时生效。
      if (Number.isSafeInteger(entry.defaultMaxOutput) && entry.defaultMaxOutput > 0) clean.defaultMaxOutput = entry.defaultMaxOutput
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
      preferExpiringQuota: cfg.preferExpiringQuota === true,
      raccoonUnifiedModels: cfg.raccoonUnifiedModels === true,
      routingMode: ['manual', 'free', 'expiring', 'sticky'].includes(cfg.routingMode) ? cfg.routingMode
        : cfg.preferExpiringQuota === true ? 'expiring' : 'manual',
      providers,
    },
    tasks,
    quotaProviders: (Array.isArray(value.quotaProviders) ? value.quotaProviders : []).filter(id => typeof id === 'string' && providerById(id)),
    unifiedModelProviders: (Array.isArray(value.unifiedModelProviders) ? value.unifiedModelProviders : []).filter(id => typeof id === 'string' && providerById(id)),
  }
}
function automationEffective(state, providerId, field) {
  const cfg = state.automation?.config
  if (!cfg) return undefined
  const override = cfg.providers?.[providerId]?.[field]
  if (typeof override === 'boolean') return override
  return cfg[field] === true
}
const checkinEnabled = (state, id) => state.checkin?.providers?.[id]?.enabled
  ?? (state.checkin?.providers?.[id] ? state.checkin.enabled : undefined)
const taskScope = (provider, mode) => `tasks:${provider}:${mode}`

function taskMessage(value, mode, querying = false) {
  const records = Array.isArray(value?.results) ? value.results : []
  if (!records.length) return '没有可操作的账号。'
  const counts = new Map()
  for (const record of records) {
    const kind = record.outcome?.kind
    const label = kind === 'claimed' || kind === 'completed' ? record.repeated ? '已完成' : '成功'
      : ({ done: '已完成', 'already-claimed': '已签到', inactive: '活动未开启', ineligible: '暂不符合条件', empty: '暂无可领', failed: '失败', pending: '待确认', unsupported: '暂无记录' })[kind] ?? '待确认'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const topic = mode === 'checkin' ? '签到' : mode === 'completeTasks' ? '任务' : '奖励'
  const local = querying && records.every(record => record.verified !== true) ? '（本地记录）' : ''
  return `${topic}${querying ? '状态' : mode === 'completeTasks' ? '执行' : '领取'}${local}：${Array.from(counts, ([label, count]) => `${count} 个${label}`).join('，')}。`
}
const TASK_LABELS = {
  claimed: '奖励已领', completed: '任务已完成', done: '已完成',
  empty: '暂无可领', failed: '任务失败', pending: '待确认', unsupported: '暂不支持',
}
function taskEntry(state, providerId, mode, accountId) {
  const row = state.automation?.tasks?.[providerId]?.[mode]?.find(item => item.accountId === accountId)
  if (!row) return null
  const label = Object.hasOwn(TASK_LABELS, row.kind) ? TASK_LABELS[row.kind] : null
  if (!label) return null
  const ok = row.kind === 'claimed' || row.kind === 'completed' || row.kind === 'done'
  return { tag: [label, ok ? 'success' : row.kind === 'empty' ? undefined : 'warn'], row, locked: ok || row.kind === 'pending' || row.kind === 'failed' && !row.retryable }
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
  const label = provider === 'codearts' && kind === 'inactive' ? '未查到今日签到记录'
    : Object.hasOwn(CHECKIN_LABELS, kind) ? CHECKIN_LABELS[kind] : null
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

const percentMetric = fraction => typeof fraction === 'number' && Number.isFinite(fraction)
  ? { value: Math.round(fraction * 100), unit: '% 剩余', fraction }
  : undefined

function isAgnesFreeQuota(quota, balance) {
  if (quota?.status === 'ready') {
    const bal = typeof quota.balance === 'number' && Number.isFinite(quota.balance) ? quota.balance : 0
    const windows = Array.isArray(quota.windows) ? quota.windows : []
    const hasPositive = windows.some(w =>
      (typeof w?.remaining === 'number' && w.remaining > 0) ||
      (typeof w?.limit === 'number' && w.limit > 0) ||
      (typeof w?.used === 'number' && w.used > 0))
    const hasZero = quota.balance === 0 || windows.some(w => w?.remaining === 0 || w?.limit === 0 || w?.used === 0)
    return bal <= 0 && !hasPositive && hasZero
  }
  if (balance && typeof balance === 'object' && !balance.error) {
    return balance.used === 0 && (balance.limit === null || balance.limit <= 0)
  }
  return false
}

function isPermanentCreditPackage(pkg, providerId) {
  if (!pkg || pkg.active === false) return false
  const expires = pkg.expiresAt ?? pkg.expires
  if (typeof expires === 'number' && Number.isFinite(expires) && expires > 0) return false
  if (typeof expires === 'string' && expires.trim() && Number.isFinite(Date.parse(expires))) return false
  const name = String(pkg.name || pkg.label || '').trim()
  if (/每日|赠送|活动|签到|会员|套餐|月度|周|日额度|体验|福利|新手|邀请|资源包|daily|gift|trial|member|monthly|weekly/i.test(name)) return false
  if (/永久|充值|购买|预付|星火|基础积分|按需积分|加购|permanent|prepaid|top[\s-]?up|buy/i.test(name)) return true
  const raccoon = typeof isRaccoonFamily === 'function' ? isRaccoonFamily(providerId) : (providerId === 'raccoon' || providerId === 'raccoon-pro')
  if (raccoon && name === '奖励积分') return true
  return false
}

function workbuddyAccountCredits(windows) {
  const list = Array.isArray(windows) ? windows : []
  const creditWindows = list.filter(win => win && (!win.unit || /^credits?$/i.test(win.unit)) && windowRemainingAmount(win) !== null)
  if (!creditWindows.length) return null
  const totalWin = creditWindows.find(win => /^(?:Total credits|总 Credits)$/i.test(win.name))
  const creditsWin = creditWindows.find(win => /^Credits$/i.test(win.name))
  const extraWin = creditWindows.find(win => /^Extra credits$/i.test(win.name))
  const prepaidWin = creditWindows.find(win => /^Prepaid credits$/i.test(win.name))
  let selected
  if (totalWin) {
    selected = [totalWin, ...(prepaidWin && prepaidWin !== totalWin ? [prepaidWin] : [])]
  } else if (creditsWin) {
    selected = [
      creditsWin,
      ...(prepaidWin && prepaidWin !== creditsWin ? [prepaidWin] : []),
      ...creditWindows.filter(win => win !== creditsWin && win !== prepaidWin && !win.aside),
    ]
  } else {
    const primary = creditWindows.filter(win => !win.aside)
    selected = primary.length ? primary : creditWindows
  }
  const amount = Math.round(selected.reduce((sum, win) => sum + windowRemainingAmount(win), 0) * 100) / 100
  const rawUnit = selected.find(win => win.unit)?.unit || creditWindows.find(win => win.unit)?.unit || 'credits'
  const unit = displayCreditUnit(rawUnit) || '积分'
  const nonAsideFracs = creditWindows.filter(win => !win.aside && win.limit > 0)
    .map(win => Math.min(1, Math.max(0, windowRemainingAmount(win) / win.limit)))
  const allFracs = nonAsideFracs.length ? nonAsideFracs : creditWindows.filter(win => win.limit > 0)
    .map(win => Math.min(1, Math.max(0, windowRemainingAmount(win) / win.limit)))
  const fraction = allFracs.length ? Math.min(...allFracs) : null
  const subWindows = prepaidWin
    ? (totalWin && creditsWin && extraWin ? [creditsWin, extraWin, prepaidWin]
      : [totalWin ?? creditsWin, extraWin && !totalWin ? extraWin : null, prepaidWin].filter((w, i, arr) => w && arr.indexOf(w) === i))
    : []
  const packages = subWindows.length > 1
    ? subWindows.map(win => ({
      name: win.name,
      remaining: windowRemainingAmount(win),
      unit,
      expiresAt: win.expiresAt || win.runsOutAt || (win === prepaidWin ? '' : win.resetsAt) || '',
      active: true,
    }))
    : []
  return { amount, unit, fraction, packages }
}

function summarizePoolCredits(rows, providerId) {
  const validRows = Array.isArray(rows) ? rows : []
  let total = 0, knownCount = 0, temporary = 0, permanent = 0, packageCount = 0
  let unit = '积分'
  for (const row of validRows) {
    if (row?.unit) unit = row.unit
    const rowAmount = typeof row?.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null
    if (rowAmount !== null) {
      total += rowAmount
      knownCount += 1
    }
    const pkgs = Array.isArray(row?.packages) ? row.packages : []
    let rowPkgSum = 0, rowHasPkg = false
    for (const pkg of pkgs) {
      if (!pkg || pkg.active === false) continue
      const rem = typeof pkg.remaining === 'number' && Number.isFinite(pkg.remaining)
        ? pkg.remaining
        : (typeof pkg.balance === 'number' && Number.isFinite(pkg.balance) ? pkg.balance : null)
      if (rem === null || rem < 0) continue
      rowHasPkg = true
      packageCount += 1
      rowPkgSum += rem
      if (isPermanentCreditPackage(pkg, providerId)) permanent += rem
      else temporary += rem
    }
    if (!rowHasPkg && rowAmount !== null && rowAmount > 0) {
      temporary += rowAmount
    } else if (rowHasPkg && rowAmount !== null && rowAmount > rowPkgSum + 1e-6) {
      permanent += (rowAmount - rowPkgSum)
    }
  }
  const known = knownCount > 0
  const hasPackages = packageCount > 0
  const fmt = value => `${displayNumber(Math.round(value * 100) / 100)}`
  const totalText = `${fmt(total)}${unit ? ` ${unit}` : ''}`
  const splitText = `临时 ${fmt(temporary)} · 永久 ${fmt(permanent)}`
  return {
    known,
    count: validRows.length,
    unit,
    total: Math.round(total * 100) / 100,
    temporary: Math.round(temporary * 100) / 100,
    permanent: Math.round(permanent * 100) / 100,
    hasPackages,
    splitText,
    summary: !known ? '' : hasPackages ? `${totalText}（${splitText}）` : totalText,
  }
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
      const loomyRoute = get('loomy.routeStatus', 'loomy')
      const patch = {}
      if (checkin?.value) patch.checkin = checkin.value
      if (automation?.value) patch.automation = automationFrom(automation.value)
      if (loomyRoute?.value) patch.loomyRoute = loomyRouteFrom(loomyRoute.value)
      if (status?.value && status.at >= newestStatusReadRef.current) patch.statuses = statusFrom(status.value)
      if (accounts?.value && accounts.at >= (newestAccountRead.get(state.provider) ?? 0) && (!state.loading || !state.accounts.length)) {
        patch.accounts = accountsFrom(accounts.value, state.provider)
      }
      if (loomyRoute?.value && state.provider === 'loomy') {
        const list = patch.accounts ?? state.accounts
        patch.accounts = list.map(({ route: _old, ...account }) => ({
          ...account,
          ...(patch.loomyRoute.accounts[account.id] ? { route: patch.loomyRoute.accounts[account.id] } : {}),
        }))
      }
      if (packAllowed(state.provider)) {
        const sides = modelProvidersOf(state.provider)
        const paramEntries = sides.map(side => [side, get('model.params', side)])
          .filter(([side, entry]) => entry?.value && entry.at >= (newestModelRead?.get(side) ?? 0))
        if (paramEntries.length) {
          patch.params = paramEntries.reduce((params, [side, entry]) => replaceProviderParams(params, entry.value, side), state.params)
        }
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
        if (packAllowed(next.provider) && (accounts || credits || patch.params || patch.models || patch.modelSource)) cache.rememberChannel(next.provider, next)
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
  const sharedFields = ['statuses', 'checkin', 'automation', 'loomyRoute', ...snapshotProviders.flatMap(item => item.snapshot.keep ?? [])]
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
        ...(channel === 'qodercn' && results[0]?.status === 'fulfilled'
          && !(silent && sources.qodercn === 'cached')
          ? { qoderCatalogIssue: results[0].value?.issue ?? '' } : {}),
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
    if (!packAllowed(channel)) return Promise.resolve(false)
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
    const controller = options.controller ?? new AbortController()
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
    const controller = options.controller ?? new AbortController()
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
        publish({ notice: typeof options.message === 'function' ? options.message(result) : options.message || '商汤设置已保存。' })
      } else {
        const refreshed = await loadPlan(PLAN_PROVIDER_ID, true)
        if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: refreshed ? options.message || '商汤设置已保存。' : '设置已保存，但模型目录读取未完成。' })
      }
      return true
    } catch {
      if (!disposed && state.provider === PLAN_PROVIDER_ID) publish({ notice: controller.signal.aborted ? '请求已取消。' : options.failure || '商汤设置保存失败。' })
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
      rememberChannel: target => cache.rememberChannel(target, state),
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
    queryAutomationTask(targetProvider, mode, accountId) {
      return store.runAutomationTask(targetProvider, mode, accountId, true)
    },
    async runAutomationTask(targetProvider, mode = 'claimRewards', accountId, querying = false) {
      const target = targetProvider || state.provider
      const scope = taskScope(target, mode)
      if (disposed || pending.has(scope)) return false
      const controller = new AbortController()
      writes.add(controller)
      const release = pending.enter(scope)
      writeRevision++
      publish({ notice: querying ? '正在查询状态…' : mode === 'completeTasks' ? '正在执行任务…' : '正在领取奖励…' })
      try {
        const value = await request(querying ? 'automation.query' : 'automation.run', { provider: target, mode, ...(accountId ? { accountId } : {}) }, controller.signal)
        if (!disposed && state.provider === target) {
          publish({ notice: taskMessage(value, mode, querying) })
          if (sync.hasSnapshots()) void sync.readHostSnapshots()
        }
        return true
      } catch {
        if (!disposed && state.provider === target) publish({ notice: querying ? '状态查询未完成。' : mode === 'completeTasks' ? '任务执行未完成。' : '奖励领取未完成。' })
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
    setModelParams(key, patch, field) {
      const model = state.models.find(m => m.key === key)
      if (!model) return Promise.resolve(false)
      const channel = state.provider
      return mutate('model.setParams', { provider: model.provider, modelId: model.id, params: patch, ...(field ? { field } : {}) }, {
        refresh: false, message: '模型参数已保存。',
        result(value) {
          if (state.provider === channel) publish({ params: replaceProviderParams(state.params, value, model.provider) })
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
      return store.runAutomationTask(state.provider, state.provider === 'loomy' ? 'completeTasks' : 'claimRewards', target)
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
:where(.eac-settings,.eac-context-pill,.eac-quota-pill){
  --eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);
  --eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,CanvasText);
  --eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);
  --eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);
  --eac-accent:#3b82f6;--eac-on-accent:#fff;
  --eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(16,24,40,.04);
  --eac-s1:4px;--eac-s2:8px;--eac-s3:12px;--eac-s4:16px;--eac-s5:24px;--eac-s6:32px;
  --eac-r-sm:8px;--eac-r:12px;--eac-r-lg:14px;
  --eac-r-pill:999px;--eac-segment-gap:1px;--eac-segment-pad:2px;--eac-segment-inline:7px;--eac-fs-segment:11px;
  --eac-segment-border:rgba(128,128,128,.3);--eac-segment-selected:color-mix(in srgb,#3b82f6 16%,transparent);
  --eac-context-tip-gap:6px;--eac-context-tip-width:260px;--eac-context-tip-layer:50;
  --eac-quota-width:340px;--eac-quota-height:520px;--eac-quota-min-height:26px;
  --eac-quota-shadow:0 12px 32px rgba(0,0,0,.28);
  --eac-fs-xs:11px;--eac-fs-sm:12px;--eac-fs:13px;--eac-fs-lg:15px;--eac-fs-xl:20px;
  --eac-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.eac-settings{
  position:relative;display:flex;flex-direction:column;gap:var(--eac-s4);width:100%;max-width:1040px;margin:0 auto;padding:var(--eac-s2) 2px var(--eac-s6);
  min-width:0;box-sizing:border-box;container-type:inline-size;container-name:eac;color:var(--eac-text);color-scheme:light;font-size:var(--eac-fs);line-height:1.55;
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
.eac-button.is-primary{border-color:var(--eac-accent);background:var(--eac-accent);color:var(--eac-on-accent);font-weight:500}
.eac-button.is-primary:hover:not(:disabled){background:var(--eac-accent);filter:brightness(1.06);border-color:var(--eac-accent)}
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
.eac-workspace{display:flex;flex-direction:column;min-width:0;padding:var(--eac-s3) var(--eac-s4) var(--eac-s5);border:1px solid var(--eac-divider);border-radius:var(--eac-r);background:var(--eac-subtle)}
.eac-panels{display:flex;align-items:center;gap:2px;min-height:36px;border-bottom:1px solid var(--eac-divider)}
.eac-panel-tab{align-self:stretch;display:inline-flex;align-items:center;gap:6px;margin:0 0 -1px;padding:6px 12px;border:0;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:inherit;opacity:.68;cursor:pointer;font-size:var(--eac-fs);font-weight:500;white-space:nowrap;transition:opacity .14s ease,border-color .14s ease,background .14s ease}
.eac-panel-tab:hover{opacity:.95;background:var(--eac-subtle)}
.eac-panel-tab[aria-selected=true]{opacity:1;border-bottom-color:var(--eac-accent);font-weight:600}
.eac-panel-tab[aria-selected=true] .eac-tab-badge{background:color-mix(in srgb,var(--eac-accent) 14%,transparent);color:var(--eac-accent)}
.eac-panel-body{display:flex;flex-direction:column;gap:14px;padding:var(--eac-s4) 0 0;min-width:0}

/* ---------- 分区骨架 ---------- */
.eac-section{display:flex;flex-direction:column;gap:8px;min-width:0}
.eac-section+.eac-section{padding-top:var(--eac-s2)}
.eac-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);min-width:0;min-height:24px}
.eac-section-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.eac-section-title{margin:0;font-size:12px;font-weight:600;line-height:1.4;letter-spacing:.01em;opacity:.72}
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
.eac-notice{display:flex;align-items:center;gap:var(--eac-s2);padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 28%,transparent);border-radius:10px;background:color-mix(in srgb,var(--eac-accent) 10%,transparent);color:var(--eac-text);font-size:var(--eac-fs-sm);overflow-wrap:anywhere}
.eac-notice p{margin:0;min-width:0;flex:1}
.eac-notice-close{padding:0;border:0;background:none;color:var(--eac-muted);cursor:pointer;font-size:14px;line-height:1;flex:none}
.eac-notice-close:hover{color:var(--eac-text)}
.eac-callout{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 28%,transparent);border-radius:12px;background:color-mix(in srgb,var(--eac-accent) 8%,transparent)}
.eac-callout-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 220px}
.eac-callout-title{margin:0;font-size:var(--eac-fs);font-weight:620}
.eac-callout-url{margin:0;color:var(--eac-faint);font-family:var(--eac-mono);font-size:var(--eac-fs-xs);line-height:1.5;overflow-wrap:anywhere}
.eac-callout-actions{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap}
.eac-model-reason{margin:0;color:var(--eac-warn);font-size:var(--eac-fs-sm);line-height:1.5;overflow-wrap:anywhere}
.eac-empty{margin:0;padding:var(--eac-s5) var(--eac-s4);border:1px dashed var(--eac-border);border-radius:var(--eac-r);color:var(--eac-muted);text-align:center;font-size:var(--eac-fs-sm)}

/* ---------- 账号列表 ---------- */
.eac-list-box{display:flex;flex-direction:column;border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);overflow:hidden}
.eac-row-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto) auto auto;grid-template-areas:"main metric switch more";align-items:center;gap:var(--eac-s2) var(--eac-s3);padding:var(--eac-s3) var(--eac-s4);border-top:1px solid var(--eac-divider);transition:background .14s ease}
.eac-row-item > .eac-row-main{grid-area:main}.eac-row-item > .eac-switch{grid-area:switch}.eac-row-controls{grid-area:more;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--eac-s2)}
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
.eac-row-meta{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s1) var(--eac-s2);color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.45;overflow-wrap:anywhere}
.eac-row-credit{display:flex;justify-content:flex-end;align-items:baseline;gap:var(--eac-s1);color:var(--eac-text);font-size:var(--eac-fs-lg);font-weight:640;font-variant-numeric:tabular-nums;line-height:1.2;flex-wrap:wrap}
.eac-row-credit small{color:var(--eac-faint);font-size:var(--eac-fs-xs);font-weight:500}
.eac-row-credit.is-unknown{color:var(--eac-faint);font-size:var(--eac-fs-sm);font-weight:500}
.eac-row-more{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--eac-s3);padding:10px 0 2px 12px;border-top:1px dashed var(--eac-divider);border-left:2px solid color-mix(in srgb,var(--eac-accent) 55%,transparent);margin-top:var(--eac-s2)}
.eac-row-links{display:flex;align-items:center;gap:var(--eac-s4);flex-wrap:wrap}
.eac-more{padding:4px 8px;border:1px solid transparent;border-radius:var(--eac-r-sm);background:transparent;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-more:hover{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-more[aria-expanded=true]{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-danger-panel{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-danger) 32%,var(--eac-border));border-radius:var(--eac-r-sm);background:color-mix(in srgb,var(--eac-danger) 6%,var(--eac-surface));font-size:var(--eac-fs-sm)}
.eac-danger-panel p{margin:0;min-width:0;flex:1 1 200px}
.eac-danger-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none}

/* ---------- 开关 ---------- */
.eac-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--eac-border);cursor:pointer;transition:background .15s ease}
.eac-switch::before{content:"";position:absolute;inset:-3px 0}
.eac-switch[aria-checked=true]{background:var(--eac-accent)}
.eac-switch:disabled{opacity:.42;cursor:not-allowed}
.eac-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.eac-switch[aria-checked=true] .eac-switch-knob{transform:translateX(16px)}

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
.eac-input{width:100%;min-height:30px;padding:5px 9px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);color-scheme:inherit;font-size:var(--eac-fs-sm);outline:none;transition:border-color .14s ease}
.eac-settings select option{color:CanvasText;background:Canvas}
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

/* ---------- OpenDesign CoRouter 上下文分段：设置页与输入栏变体 ---------- */
.eac-context-control{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s2);min-width:0;color:var(--eac-text);font-size:var(--eac-fs-sm)}
.eac-context-tiers{display:inline-flex;align-items:center;gap:0;min-width:0;padding:var(--eac-s1);border:1px solid var(--eac-border);border-radius:var(--eac-s2)}
.eac-context-control .eac-context-segment{display:inline-flex;align-items:center;justify-content:center;min-height:var(--eac-s6);min-width:0;padding:var(--eac-s1) var(--eac-s2);margin:0;border:1px solid transparent;border-radius:var(--eac-s1);background:transparent;color:var(--eac-muted);font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}
.eac-context-control .eac-context-segment:hover:not(:disabled){background:var(--eac-subtle);color:var(--eac-text)}
.eac-context-control .eac-context-segment[aria-pressed=true]{border-color:var(--eac-accent);background:var(--eac-subtle);color:var(--eac-text);font-weight:700}
.eac-context-segment:disabled{opacity:.55;cursor:not-allowed}
.eac-context-control :focus-visible{outline:2px solid var(--eac-accent);outline-offset:var(--eac-s1)}
.eac-context-caption,.eac-context-note{color:var(--eac-muted);font-size:inherit}
.eac-context-pill{position:relative;display:inline-flex;align-items:center;flex:none;max-inline-size:100%;color:inherit;font:inherit}
.eac-context-pill .eac-context-control{display:inline-flex;flex:none;flex-wrap:nowrap;gap:var(--eac-segment-pad);max-inline-size:100%;color:inherit;font-size:var(--eac-fs-segment)}
.eac-context-pill .eac-context-tiers{gap:var(--eac-segment-gap);min-height:26px;box-sizing:border-box;padding:var(--eac-segment-pad);border-color:var(--eac-segment-border);border-radius:var(--eac-r-pill);background:transparent}
.eac-context-pill .eac-context-segment{min-height:20px;padding:0 var(--eac-segment-inline);border:1px solid transparent;border-radius:var(--eac-r-pill);font-weight:500;color:inherit;opacity:.7;background:transparent}
.eac-context-pill .eac-context-segment[aria-pressed=true]{border:1px solid color-mix(in srgb,#3b82f6 45%,transparent);background:var(--eac-segment-selected);color:#3b82f6;font-weight:600;opacity:1;cursor:default}
.eac-context-pill .eac-context-segment:hover:not(:disabled){background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;opacity:1}
.eac-context-pill .eac-context-segment[aria-pressed=true]:hover:not(:disabled){background:var(--eac-segment-selected);color:#3b82f6}
.eac-context-pill[data-disabled=true] .eac-context-control{opacity:.55}
.eac-context-pill .eac-context-segment:disabled{cursor:default;opacity:.45}
.eac-context-pill[data-disabled=true] .eac-context-segment:disabled{opacity:.68}
.eac-context-pill[data-disabled=true] .eac-context-segment[aria-pressed=true]:disabled{opacity:1}
.eac-context-pill :focus-visible{outline:2px solid var(--eac-accent);outline-offset:var(--eac-segment-pad)}
.eac-context-pill .eac-context-caption{display:none}
.eac-context-pill .eac-context-note{white-space:nowrap}
.eac-context-feedback{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none}
.eac-context-pill[data-error=true] .eac-context-tiers{border-color:var(--eac-danger)}
.eac-context-pill[data-error=true]:is(:hover,:focus-within)::after{content:attr(data-error-message);position:absolute;inset-inline-start:0;inset-block-end:calc(100% + var(--eac-context-tip-gap));z-index:var(--eac-context-tip-layer);width:max-content;max-width:min(var(--eac-context-tip-width),calc(100vw - var(--eac-s5)));box-sizing:border-box;padding:var(--eac-s2);border:1px solid var(--eac-danger);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);font:var(--eac-fs-xs)/1.5 system-ui,sans-serif;white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.eac-context-retry{min-height:0;padding:var(--eac-segment-pad) var(--eac-segment-inline);border:1px solid var(--eac-segment-border);border-radius:var(--eac-r-pill);background:transparent;color:inherit;font:inherit;font-size:var(--eac-fs-segment);cursor:pointer}
@media(forced-colors:active){.eac-context-control .eac-context-tiers{border-color:ButtonText}.eac-context-control .eac-context-segment[aria-pressed=true]{border-color:Highlight;background:Highlight;color:HighlightText;forced-color-adjust:none}.eac-context-control .eac-context-segment:disabled{color:GrayText;opacity:1}}

/* ---------- 卡片组（渠道设置 / 额度池） ---------- */
.eac-plan-window-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--eac-s2);color:var(--eac-muted);font-size:var(--eac-fs-xs);flex-wrap:wrap}
.eac-plan-window-head strong{color:var(--eac-text);font-size:var(--eac-fs-sm);font-weight:640;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.eac-plan-window-meta{display:flex;justify-content:space-between;gap:var(--eac-s2);margin-top:var(--eac-s1);color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.5;flex-wrap:wrap}

.eac-quota-pill{display:inline-flex;min-width:0;font-variant-numeric:tabular-nums;--eac-quota-fill:transparent;--eac-quota-border:var(--eac-segment-border)}
.eac-quota-pill[data-tone=warn]{--eac-quota-fill:rgba(234,179,8,.10);--eac-quota-border:rgba(234,179,8,.45)}
.eac-quota-pill[data-tone=danger]{--eac-quota-fill:rgba(239,68,68,.10);--eac-quota-border:rgba(239,68,68,.45)}
.eac-quota-trigger{display:inline-flex;align-items:center;gap:var(--eac-s2);min-height:var(--eac-quota-min-height);max-width:min(46vw,240px);padding:4px 11px 4px 9px;box-sizing:border-box;border:1px solid var(--eac-quota-border);border-radius:var(--eac-r-pill);background:var(--eac-quota-fill);color:inherit;font-family:inherit;font-weight:600;font-size:var(--eac-fs-sm);line-height:1.2;white-space:nowrap;cursor:pointer;touch-action:manipulation}
.eac-quota-trigger:hover,.eac-quota-trigger[aria-expanded=true]{background:color-mix(in srgb,currentColor 7%,transparent)}
.eac-quota-trigger:active{background:color-mix(in srgb,currentColor 11%,transparent)}
.eac-quota-trigger[data-stale=true]{border-style:dashed}
.eac-quota-trigger-text{overflow:hidden;text-overflow:ellipsis}
.eac-quota-mini{display:inline-flex;flex-direction:column;justify-content:center;gap:3px;width:34px;flex:none}
.eac-quota-mini[data-count="3"]{gap:2px}
.eac-quota-bar{display:block;height:6px;border-radius:99px;background:rgba(128,128,128,.22);overflow:hidden}
.eac-quota-mini[data-count="2"] .eac-quota-bar{height:5px}
.eac-quota-mini[data-count="3"] .eac-quota-bar{height:4px}
.eac-quota-bar-fill{display:block;height:100%;border-radius:99px;background:var(--eac-muted)}
.eac-quota-bar[data-tone=success] .eac-quota-bar-fill{background:var(--eac-success)}
.eac-quota-bar[data-tone=warn] .eac-quota-bar-fill{background:var(--eac-warn)}
.eac-quota-bar[data-tone=danger] .eac-quota-bar-fill{background:var(--eac-danger)}
.eac-quota-track{display:block;appearance:none;width:100%;height:8px;border:0;border-radius:99px;overflow:hidden;background:rgba(128,128,128,.22);accent-color:var(--eac-quota-tone)}
.eac-quota-track::-webkit-progress-bar{background:rgba(128,128,128,.22)}
.eac-quota-track::-webkit-progress-value{background:var(--eac-quota-tone);border-radius:99px}
.eac-quota-pill :focus-visible{outline:2px solid var(--eac-accent);outline-offset:2px}
.eac-quota-popover{box-sizing:border-box;position:fixed;inset:auto var(--eac-s2) var(--eac-s5) auto;margin:0;width:min(var(--eac-quota-width),calc(100vw - 24px));max-height:min(70vh,calc(100vh - 72px));overflow:auto;overscroll-behavior:contain;padding:14px;border:1px solid rgba(128,128,128,.28);border-radius:14px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));color:var(--dsh-text,var(--dsw-alias-label-primary,CanvasText));color-scheme:light;box-shadow:var(--eac-quota-shadow);font:12px/1.5 sans-serif}
@supports(position-area:top span-left){.eac-quota-popover{inset:auto;position-area:top span-left;justify-self:end;margin:var(--eac-s2);position-try-fallbacks:flip-inline,flip-block,flip-block flip-inline}}
.eac-quota-popover header{display:flex;justify-content:space-between;align-items:center;gap:var(--eac-s2);overflow-wrap:anywhere}
.eac-quota-header{position:sticky;top:-14px;z-index:2;margin:-14px -14px 8px;padding:14px 14px 8px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));border-bottom:1px solid var(--eac-divider);font-size:13px}
.eac-quota-plan{flex:none;padding:1px 8px;border-radius:99px;background:rgba(128,128,128,.15);font-size:11px;font-weight:600}
.eac-quota-status{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:rgba(234,179,8,.10);border:1px solid rgba(234,179,8,.28);font-size:11.5px;color:#ca8a04}
.eac-quota-track{grid-column:1/-1;margin:var(--eac-s1) 0}
.eac-quota-account{margin-top:var(--eac-s3)}
.eac-quota-account header{margin-bottom:var(--eac-s1)}
.eac-quota-group{padding:10px 12px;background:rgba(128,128,128,.07);border-radius:10px}
.eac-quota-group + .eac-quota-group{margin-top:var(--eac-s2)}
.eac-quota-detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,max-content);column-gap:var(--eac-s2);overflow-wrap:anywhere}
.eac-quota-detail + .eac-quota-detail{margin-top:var(--eac-s1)}
.eac-quota-detail>span{opacity:.7;font-weight:500}
.eac-quota-detail>:nth-child(2){text-align:right}
.eac-quota-detail small{grid-column:1/-1;opacity:.62;font-size:11px}
.eac-quota-footer{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s2);margin-top:var(--eac-s3);opacity:.78;font-size:11px}
.eac-quota-footer .eac-button{border:none;border-radius:8px;padding:4px 12px;min-height:26px;background:rgba(59,130,246,.14);color:#3b82f6;font-size:12px;font-weight:500}
.eac-quota-others{margin-top:var(--eac-s3);padding-top:var(--eac-s2);border-top:1px solid var(--eac-divider)}
.eac-quota-others summary{padding-block:var(--eac-s1);cursor:pointer;opacity:.75;font-weight:600}
.eac-quota-others summary:hover{opacity:1}
html[data-dsh-go-island][data-dsh-go-island-form="panel"] .eac-quota-popover{position:static;inset:auto;width:100%;max-height:none;overflow:visible;margin-top:8px;box-shadow:none;background:transparent;border-color:rgba(128,128,128,.2)}
:is(.eac-quota-popover,.eac-quota-account-row)[data-tone=neutral]{--eac-quota-tone:var(--eac-muted)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=success]{--eac-quota-tone:var(--eac-success)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=warn]{--eac-quota-tone:var(--eac-warn)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=danger]{--eac-quota-tone:var(--eac-danger)}
.eac-quota-account-list{display:grid;gap:var(--eac-s1);margin-top:var(--eac-s2)}
.eac-quota-account-row{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s2);min-width:0;width:100%;padding:6px 10px;border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-subtle);color:inherit;font:inherit;text-align:left;cursor:pointer}
.eac-quota-account-row:hover{background:var(--eac-hover)}
.eac-quota-account-row[aria-pressed=true]{border-color:color-mix(in srgb,var(--eac-accent) 55%,transparent);background:color-mix(in srgb,var(--eac-accent) 12%,transparent)}
.eac-quota-account-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eac-quota-account-row>strong{flex:none;max-width:50%;color:var(--eac-quota-tone);text-align:right;overflow-wrap:anywhere}

@media(prefers-color-scheme:dark){
  :where(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover){color-scheme:dark;--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
}
:where(body[data-ds-dark-theme],.dark,[data-theme=dark],[data-color-scheme=dark]) :is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover),:is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover):where(.dark,[data-theme=dark],[data-color-scheme=dark]){color-scheme:dark;--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
:where(.light,[data-theme=light],[data-color-scheme=light]) :is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover),:is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover):where(.light,[data-theme=light],[data-color-scheme=light]){color-scheme:light;--eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#182230);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(16,24,40,.04)}
@container eac (max-width:640px){
  .eac-header{align-items:center}
  .eac-workspace{padding:var(--eac-s2) var(--eac-s3) var(--eac-s4)}
  .eac-panels{gap:var(--eac-s4)}.eac-panel-body{padding:var(--eac-s3) 0 0}
  .eac-section-head{flex-direction:column}.eac-section-actions{justify-content:flex-start}.eac-group-actions{justify-content:flex-start}
  .eac-workspace[data-panel=models] .eac-section-head{flex-direction:row;align-items:center;flex-wrap:wrap;gap:var(--eac-s2)}
  .eac-workspace[data-panel=models] .eac-section-actions{max-width:100%}
  .eac-row-item{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"main switch more" "metric metric metric";gap:var(--eac-s2);padding:var(--eac-s3)}
  .eac-row-item:has(.eac-row-controls .eac-button){grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main switch" "more more"}
  .eac-row-item:has(.eac-row-controls .eac-button)>.eac-row-controls{justify-content:flex-start}
  .eac-row-item:has(.eac-row-controls .eac-button)>.eac-row-metric{grid-area:auto;grid-column:1/-1}
  .eac-workspace[data-panel=advanced] .eac-row-name{white-space:normal;overflow-wrap:anywhere}
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
@container eac (max-width:390px){.eac-title{font-size:15px}.eac-panels{gap:var(--eac-s3)}.eac-panel-tab{font-size:var(--eac-fs-sm)}}
@media(prefers-reduced-motion:reduce){:where(.eac-settings,.eac-context-pill,.eac-quota-pill) *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
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
  if (!value) return ''
  const parts = []
  if (modelTokenValue(value.contextWindow)) parts.push(`上下文 ${formatTokens(value.contextWindow)}`)
  if (modelTokenValue(value.maxTokens)) parts.push(`输出 ${formatTokens(value.maxTokens)}`)
  if (value.reasoningEffort) parts.push(`思考 ${EFFORT_LABELS[value.reasoningEffort] || value.reasoningEffort}`)
  if (typeof value.supportsImage === 'boolean') parts.push(value.supportsImage ? '图片开' : '图片关')
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
  for (const tier of [...OUTPUT_TIERS, ...EXTRA_DISPLAY_TIERS]) {
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
function defaultParamSummary(model, outputLabel = '输出') {
  const parts = []
  if (model.contextWindow > 0) parts.push(`上下文 ${formatTokens(model.contextWindow)}`)
  if (model.defaultMaxTokens > 0) parts.push(`${outputLabel} ${formatTokens(model.defaultMaxTokens)}`)
  if (model.efforts.includes(model.defaultEffort)) parts.push(`思考 ${EFFORT_LABELS[model.defaultEffort] || model.defaultEffort}`)
  if (model.supportsImage === true) parts.push('支持图片')
  if (model.supportsImage === false) parts.push('仅文本输入')
  return parts.join(' · ')
}
function baseModelSummary(model, outputLabel) {
  return defaultParamSummary({
    contextWindow: model.defaultContextWindow ?? (model.params.contextWindow == null ? model.contextWindow : null),
    defaultMaxTokens: model.defaultMaxOutputLength ?? (model.params.maxTokens == null ? model.maxOutputLength : null), efforts: model.thinkingLevels,
    defaultEffort: model.defaultEffort, supportsImage: model.defaultVision,
  }, outputLabel)
}
/**
 * 按模型官方口径与渠道硬上限生成精选输出档位（64K 起，最多 4 档）：
 * - 上限超过 512K（Kimi K3.1 Pro/K3）：快捷档最多 512K，自定义仍按有效上限校验。
 * - 上限 ≈ 512K（MiniMax M3.1 Flash）：64K / 128K / 256K / 512K
 * - 上限 ≈ 384K（DeepSeek V4.1 / OpenPangu 2.1）：64K / 128K / 256K / 384K
 * - 上限 ≈ 256K（Doubao Seed 2.1 / Qwen 4 Max）：64K / 128K / 256K
 * - 上限 ≈ 128K（GLM 5.3 / Qwen 3.8 / MiMo 2.6 / Spark X2.6）：64K / 128K
 * - 上限 ≈ 64K（Hy4 / Step 5 / Agnes）：64K
 * - 有渠道协议硬上限（如 CodeArts v2 为 64K / 65,536）时强制不超过硬上限。
 */
function modelOutputCeiling(model, providerId) {
  const provider = providerId || model?.provider || ''
  const hardCap = channelOutputHardCap(provider)
  const spec = officialModelSpec(model?.id, provider)
  const declared = model?.maxTokens ?? model?.defaultMaxOutputLength ?? (model?.params?.maxTokens == null ? model?.maxOutputLength : null) ?? 0
  const ceiling = hardCap !== null ? Math.min(hardCap, declared || hardCap) : Math.max(declared, spec?.maxOutput ?? 0)
  return ceiling > 0 ? ceiling : null
}

function outputTiersForModel(model, providerId) {
  const ceiling = modelOutputCeiling(model, providerId)
  if (!ceiling) return []
  const topTier = OUTPUT_TIERS[4]
  if (ceiling >= topTier.min) {
    return [
      OUTPUT_TIERS[0],
      OUTPUT_TIERS[1],
      OUTPUT_TIERS[2],
      { ...topTier, tokens: Math.min(ceiling, topTier.tokens) },
    ]
  }
  return tiersUnder(OUTPUT_TIERS.slice(0, 4), ceiling, true)
}

function outputChoices(tiers, fallback) {
  const sameLabel = tiers.some(tier => matchesTierValue(fallback, tier))
  const standard = tiers.map(tier => matchesTierValue(fallback, tier) ? { ...tier, tokens: fallback, restore: true } : tier)
  return sameLabel ? standard : [{ label: fallback > 0 ? `默认（${formatTokens(fallback)}）` : '清除覆盖', tokens: fallback, restore: true }, ...standard]
}

function outputConflicts(tokens, context) {
  return modelTokenValue(tokens) && modelTokenValue(context) && tokens >= context
}

function outputButtons({ choices, value, context, disabled, onChange }) {
  return choices.map(tier => {
    const conflict = outputConflicts(tier.tokens, context)
    return h('button', {
      key: tier.label, type: 'button', className: 'eac-tier', disabled: disabled || conflict,
      'aria-pressed': tier.restore && value == null || matchesTierValue(value, tier),
      title: conflict ? '输出上限须小于上下文窗口' : tier.restore ? '恢复默认输出上限' : undefined,
      onClick: () => { if (!disabled && !conflict) onChange(tier.restore ? null : tier.tokens) },
    }, tier.label)
  })
}

function ModelParams({ value, model, providerId, disabled, onSave }) {
  const current = value || {}
  const outputTiers = outputTiersForModel(model, providerId)
  const efforts = Array.isArray(model.efforts) ? model.efforts : []
  // 即点即存，保存成功或失败都留在当前编辑器，便于连续调整或重试。
  const save = (values, field) => { if (!disabled) void onSave(values, field) }
  const set = (key, value) => { if (current[key] !== (value ?? undefined)) save({ ...current, [key]: value ?? undefined }, key) }
  const vision = typeof model.supportsImage === 'boolean' ? model.supportsImage : null
  return h('div', { className: 'eac-params' },
    modelTokenValue(model.contextWindow) || modelTokenValue(current.contextWindow)
      ? ContextWindowField({ capacity: model.contextWindow, override: current.contextWindow, reserve: current.maxTokens ?? model.defaultMaxTokens,
        disabled, onChange: value => set('contextWindow', value) }) : null,
    outputTiers.length || current.maxTokens !== undefined ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '输出上限'),
      h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': '输出上限' },
        ...outputButtons({ choices: outputChoices(outputTiers, model.defaultMaxTokens), value: current.maxTokens,
          context: current.contextWindow ?? model.contextWindow, disabled, onChange: value => set('maxTokens', value) }))) : null,
    efforts.length ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '思考深度'),
      h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': '思考深度' },
        !efforts.includes(model.defaultEffort) ? h('button', {
          type: 'button', className: 'eac-tier', disabled, 'aria-pressed': current.reasoningEffort === undefined,
          onClick: () => set('reasoningEffort', null),
        }, '清除覆盖') : null,
        ...efforts.map(level => h('button', {
          type: 'button', key: level, className: 'eac-tier', disabled,
          'aria-pressed': (current.reasoningEffort ?? model.defaultEffort) === level,
          title: level === model.defaultEffort ? '恢复默认思考深度' : undefined,
          onClick: () => set('reasoningEffort', level === model.defaultEffort ? null : level),
        }, EFFORT_LABELS[level] || level)))) : null,
    // 图片开关：默认跟随模型能力，可显式关掉（该渠道发图总失败时有用）。
    vision !== null ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '图片输入'),
      h('div', { className: 'eac-tier-row' },
        ...[true, false].map(enabled => h('button', {
          key: String(enabled), type: 'button', className: 'eac-tier', disabled,
          'aria-pressed': (current.supportsImage ?? vision) === enabled,
          title: enabled === vision ? '恢复默认图片输入' : undefined,
          onClick: () => set('supportsImage', enabled === vision ? null : enabled),
        }, enabled ? '开' : '关')))) : null,
    // 说明性段落一律不渲染：档位与上限本身就是信息，解释它们只会把页面读成说明书。
    !modelTokenValue(model.contextWindow) && !modelTokenValue(current.contextWindow) && !outputTiers.length && current.maxTokens === undefined && !efforts.length && vision === null
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
    const saved = await onSave(apiKey)
    if (saved) setApiKey('')
  } },
    h('label', { className: 'eac-field' }, h('span', null, 'API Key'), h('input', { className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled, value: apiKey, onChange: e => setApiKey(e.target.value) })),
    h('div', { className: 'eac-form-actions' }, primary('保存 API Key', undefined, disabled, { type: 'submit' })))
}
// 控制台会话粘贴表单（云知声额度读取用）：与 Key 表单同构，标签与文案不同。
function ConsoleCookieForm({ disabled, onSave }) {
  const [cookie, setCookie] = React.useState('')
  return h('form', { className: 'eac-account-form', onSubmit: async event => {
    event.preventDefault()
    const saved = await onSave(cookie)
    if (saved) setCookie('')
  } },
    h('label', { className: 'eac-field' }, h('span', null, '控制台 Cookie'), h('input', { className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled, placeholder: '从浏览器开发者工具复制 maas.unisound.com 的 Cookie', value: cookie, onChange: e => setCookie(e.target.value) })),
    h('div', { className: 'eac-form-actions' }, primary('保存会话', undefined, disabled, { type: 'submit' })))
}
function CredentialImportForm({ disabled, hint, onSave, onCancel }) {
  const [credential, setCredential] = React.useState('')
  return h('form', { className: 'eac-account-form', onSubmit: async event => {
    event.preventDefault()
    const saved = await onSave(credential)
    if (saved) setCredential('')
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
  const set = (field, next) => { setError(''); setValue({ [field]: next }) }
  const choose = (label, current, values, change, labels, fallback, fallbackLabel) => h('label', { className: 'eac-field', key: label },
    h('span', null, label), h('select', { className: 'eac-input', value: current ?? fallback ?? '', disabled,
      onChange: event => change(event.target.value === fallback ? '' : event.target.value) },
    fallback ? null : h('option', { value: '' }, fallbackLabel),
    ...values.map(option => h('option', { key: option, value: option }, labels?.[option] ?? option))))
  const contextCeiling = model.defaultContextWindow ?? model.contextWindow
  const outputDefault = model.defaultMaxOutputLength ?? model.maxOutputLength
  const outputTiers = outputTiersForModel(model, providerId)
  const outputCeiling = modelOutputCeiling(model, providerId)
  const context = draft.contextWindow == null ? contextCeiling : Number(draft.contextWindow)
  const save = async params => { setError(''); if (!await onSave(params)) setError('保存失败，可重试。') }
  const apply = async event => {
    event.preventDefault()
    const params = Object.fromEntries(['maxTokens', 'contextWindow', 'supportsImage', 'reasoningEffort']
      .filter(field => draft[field] !== model.params[field]).map(field => [field, draft[field] ?? null]))
    for (const field of ['maxTokens', 'contextWindow'].filter(field => Object.hasOwn(params, field))) {
      params[field] = params[field] == null || params[field] === '' ? null : Number(params[field])
      if (params[field] !== null && !modelTokenValue(params[field])) {
        setError('请输入 1 至 10,000,000 的整数。')
        return
      }
    }
    if (params.maxTokens != null && outputCeiling && params.maxTokens > outputCeiling) return setError(`输出上限最多 ${formatTokens(outputCeiling)}。`)
    if ((Object.hasOwn(params, 'maxTokens') || Object.hasOwn(params, 'contextWindow')) &&
      outputConflicts(draft.maxTokens == null || draft.maxTokens === '' ? outputDefault : Number(draft.maxTokens), context)) return setError('输出上限须小于上下文窗口。')
    if (Object.keys(params).length) await save(params)
  }
  return h('form', { className: 'eac-params', onSubmit: apply, noValidate: true, 'aria-label': modelDisplayName(model) + ' 的模型设置' },
    modelTokenValue(contextCeiling) || modelTokenValue(Number(draft.contextWindow))
      ? ContextWindowField({ capacity: contextCeiling, override: Number(draft.contextWindow), reserve: Number(draft.maxTokens || outputDefault),
        disabled, onChange: value => set('contextWindow', value) }) : null,
    outputTiers.length || draft.maxTokens != null ? h('div', { className: 'eac-param-group' },
      h('p', { className: 'eac-group-title' }, '输出上限'),
      h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': '输出上限' },
        ...outputButtons({ choices: outputChoices(outputTiers, outputDefault), value: draft.maxTokens || null,
          context, disabled, onChange: value => set('maxTokens', value) })),
      h('input', { className: 'eac-input', type: 'number', inputMode: 'numeric', min: 1, max: outputCeiling ?? 10_000_000,
        step: 1, disabled, 'aria-label': '自定义输出上限', value: draft.maxTokens ?? '', placeholder: '自定义 Token 数',
        onChange: event => set('maxTokens', event.target.value) })) : null,
    h('div', { className: 'eac-param-grid' },
      model.thinkingLevels.length ? choose('默认思考档位', draft.reasoningEffort, model.thinkingLevels,
        next => set('reasoningEffort', next || null), EFFORT_LABELS,
        model.thinkingLevels.includes(model.defaultEffort) ? model.defaultEffort : null, '清除覆盖') : null,
      choose('图片输入', draft.supportsImage == null ? undefined : String(draft.supportsImage), ['true', 'false'],
        next => set('supportsImage', next === '' ? null : next === 'true'), { true: '开启', false: '关闭' },
        model.defaultVision === null ? null : String(model.defaultVision), '自动')),
    error ? h('p', { className: 'eac-model-reason', role: 'alert' }, error) : null,
    h('div', { className: 'eac-form-actions' },
      primary('保存参数', undefined, disabled, { type: 'submit' }),
      button('恢复默认', () => void save({ maxTokens: null, contextWindow: null, supportsImage: null, reasoningEffort: null }), disabled)))
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
const Row = ({ key, avatar, name, tags, meta, metric, switchControl, controls, moreLabel, expanded, onToggle, detail, tone }) => {
  const detailId = `eac-row-detail-${encodeURIComponent(key ?? name)}`
  return h('div', { key, className: 'eac-row-item', 'data-off': tone === 'off' ? 'true' : undefined },
    h('div', { className: 'eac-row-main' },
      avatar === undefined ? null : h('span', { className: 'eac-avatar', 'aria-hidden': 'true' }, avatar),
      h('div', { className: 'eac-row-copy' },
        h('span', { className: 'eac-row-head' },
          h('span', { className: 'eac-row-name', title: name }, name),
          tags),
        meta === undefined ? null : h('span', { className: 'eac-row-meta' }, meta))),
    metric === undefined ? null : metric,
    switchControl === undefined ? null : switchControl,
    // 动作与展开按钮同处 more 列：并排放进一个容器，避免两个 grid 项叠在同一格。
    (controls?.length || moreLabel !== undefined) ? h('div', { className: 'eac-row-controls' },
      ...(controls?.length ? controls : []),
      moreLabel === undefined ? null
        : h('button', {
          type: 'button', className: 'eac-more', 'aria-expanded': expanded, 'aria-label': `${name} 的更多操作`, 'aria-controls': detailId,
          onClick: onToggle,
        }, expanded ? '收起' : moreLabel)) : null,
    expanded && detail ? h('div', { className: 'eac-row-more', id: detailId }, detail) : null)
}

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
  return actions.filter(Boolean).map(({ label, call, panel, open, href, primary: main, danger: destructive, disabled, accessible, scope: actionScope }) => {
    if (href && /^https:\/\//.test(href)) return h('a', { key: label, href, target: '_blank', rel: 'noopener noreferrer', className: 'eac-button' }, label)
    const run = panel ? () => ui.setPanel(panel, open) : () => ui.act(...call)
    const makeButton = main ? primary : destructive ? danger : button
    return makeButton(label, run, locked || disabled || (actionScope && ui.isPending(actionScope)), { key: label, 'aria-label': accessible })
  })
}

const SETTINGS_FORMS = { account: AccountForm, key: PlanKeyForm, console: ConsoleCookieForm }
function renderForm(form, ui, key, scope) {
  if (!form) return null
  const save = (...args) => ui.invoke(...form.call, ...args)
  const formScope = scope || `channel:${ui.providerId}`
  return h(SETTINGS_FORMS[form.kind], { key, account: form.account, disabled: form.disabled === true || ui.loading || ui.isPending(formScope), save, onSave: save })
}

/** 单选分段控件（智能选号模式）：复用参数编辑器的 .eac-tier 外观与 aria-pressed。 */
function renderOptionTiers({ options, value, name }, ui, disabled) {
  // 返回数组：Row 的 controls 按数组展开（单个元素没有 length 会被丢掉）。
  return [h('div', { className: 'eac-tier-row', role: 'group', 'aria-label': name },
    options.map(option => h('button', {
      key: option.value, type: 'button', className: 'eac-tier',
      'aria-pressed': option.value === value, disabled,
      onClick: () => ui.act(...option.call),
    }, option.label)))]
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
      login.cancel ? button('取消授权', () => ui.act(...login.cancel)) : null,
      login.canCheck ? button('复制链接', async () => {
        try {
          await globalThis.navigator.clipboard.writeText(login.url)
          ui.act('message', '登录链接已复制。')
        } catch { ui.act('message', '复制失败。') }
      }, ui.disabled) : null,
      login.canCheck ? button('检查登录', () => ui.act('pollLogin'), ui.disabled) : null,
      login.canCheck ? button('取消', () => ui.act('forgetLogin'), ui.disabled) : null))
}

function renderRouteOverview(overview, ui) {
  if (!overview?.counts) return null
  const { counts, skipRouted, lastCheckedAt } = overview
  const unhealthy = counts.expired + counts.exhausted
  const tags = [
    counts.clean > 0 && [`正常 ${counts.clean}`, 'success'],
    counts.routed > 0 && [`改路由 ${counts.routed}`, 'error'],
    unhealthy > 0 && [`异常 ${unhealthy}`, 'warn'],
    counts.unknown > 0 && [`无账本 ${counts.unknown}`],
    counts.unchecked > 0 && [`未检测 ${counts.unchecked}`],
    [skipRouted ? '自动避开改路由' : '未避开改路由', skipRouted ? 'info' : 'warn'],
  ]
  return h('div', { className: 'eac-callout', role: 'region', 'aria-label': 'Loomy 上游路由状态' },
    h('div', { className: 'eac-callout-copy' },
      h('div', { className: 'eac-row-head' },
        h('p', { className: 'eac-callout-title' }, '上游路由状态'),
        ...renderTags(tags)),
      h('p', { className: 'eac-muted' }, lastCheckedAt > 0
        ? `最近检测 ${displayTime(lastCheckedAt)} · 只读检测（0 积分）`
        : '只读检测（0 积分），识别静默改路由。')),
    h('div', { className: 'eac-callout-actions' },
      ...renderActions([{ label: '路由设置', panel: 'advanced', open: 'route-check' }], ui)))
}

function AccountsPanel(view, ui) {
  const { rows } = view
  const summary = []
  const counts = [rows.length ? `${rows.length} 个账号` : '', view.poolSummary || ''].filter(Boolean).join(' · ')
  if (counts) summary.push(counts)
  if (typeof view.autoCheckin === 'boolean') {
    summary.push(tag(view.autoCheckin ? '自动签到已开启' : '自动签到已关闭'))
  }
  const showImport = view.importForm && ui.importOpen === ui.providerId
  return Section({
    title: '账号与额度',
    summary: summary.length ? summary : null,
    actions: renderActions(view.actions, ui, `login:${ui.providerId}`),
    children: [
      renderRouteOverview(view.routeOverview, ui),
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
  const onSave = (...args) => ui.invoke(...editor.call, ...args)
  const providerId = model.provider || ui.providerId
  if (editor.kind === 'tiers') return h(ModelParams, { key, model, providerId, value: editor.value, disabled: modelDisabled, onSave })
  const draft = ui.drafts[key]
  const value = { ...model.params, ...draft }
  return h(PlanModelParams, {
    key, model, providerId, disabled: modelDisabled, value,
    setValue: patch => ui.setDrafts(current => ({ ...current, [key]: { ...current[key], ...patch } })),
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
  const custom = paramSummary(model.editor?.value ?? model.params)
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
         h('span', { className: 'eac-model-tags' }, ...renderTags(model.tags), custom ? tag(`自定义 ${custom}`, 'info') : null),
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
              alternative ? `同目录已有 ${modelDisplayName(alternative)}。` : (model.staleReason || '已由新一代模型替代。')]
              : reason?.kind === 'value' ? ['性价比偏低', 'warn',
                `${modelDisplayName(alternative)} 的渠道倍率更低，可用于同类任务。`] : null
            return ModelRow({ ...model, tags: [...(model.tags ?? []), tag] }, ui, groupDisabled)
          }))
             : grouped ? EmptyState({ loading: ui.loading, failed: ui.failed, onRetry: () => ui.act('refreshModels', group.id),
               emptyText: ui.query.trim() ? '没有匹配的模型。' : '暂无模型。', loadingText: '正在读取模型…' }) : null)
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
  // `autoCheckin` 是显式覆盖位：签到（automation 任务）与「一键领取每日额度」
  // （`credits.claimAll`，由 `dailyReward` 控制）是不同端点，不能共用一个标志。
  // 例：Raccoon 有签到（靠只读 `setting_info` 触发），但没有 claimAll 入口。
  const supportsCheckin = provider.caps?.autoCheckin === true
    || (provider.caps?.autoCheckin !== false && (provider.pack
      ? provider.caps?.dailyReward !== false
      : (id === WORKBUDDY_ID || provider.caps?.dailyReward === true)))
  const capabilities = state.automation?.tasks?.[id]?.capabilities
  const supportsRewards = capabilities?.claimRewards ?? (provider.caps?.onboarding === true && provider.caps?.completeTasks !== true || provider.caps?.claimRewards === true)
  const supportsTasks = capabilities?.completeTasks ?? (provider.caps?.completeTasks === true)
  const overrides = state.automation?.config?.providers?.[id] ?? {}
  const accounts = (provider.pack ? state.accounts : id === WORKBUDDY_ID ? state.workbuddy?.accounts : state.managed?.[id]?.accounts) ?? []
  const eligible = accounts.some(account => account.enabled !== false && (provider.pack || account.signedIn))
  const query = mode => ({ label: '查询状态', call: ['queryAutomationTask', id, mode], disabled: !eligible, scope: taskScope(id, mode) })
  const inherited = field => !state.automation ? '待读取' : typeof overrides[field] === 'boolean' ? '本渠道单独设置' : '跟随全局设置'
  const scope = 'automation'
  const rows = []
  if (state.automation?.quotaProviders?.includes(id)) {
    // 智能选号模式（全局单选）：分段控件代替旧的布尔开关。
    // manual = 手动顺序；free = 免费额度优先；expiring = 临期优先（兼容旧开关）；
    // sticky = 缓存优先（同一账号用到额度用尽或受限才切换）。
    const mode = state.automation.config?.routingMode ?? 'manual'
    rows.push({ id: 'routing-mode', name: '智能选号模式', scope,
      meta: { manual: '手动顺序（默认）· 按账号列表顺序', free: '免费额度优先 · 先用每日与赠送额度',
        expiring: '临期额度优先 · 每日 → 赠送 → 7 天内到期', sticky: '缓存优先 · 同一账号用尽或受限才切换' }[mode],
      value: mode,
      options: [
        { value: 'manual', label: '手动' },
        { value: 'free', label: '免费优先' },
        { value: 'expiring', label: '临期优先' },
        { value: 'sticky', label: '缓存优先' },
      ].map(option => ({ ...option, call: ['setAutomationConfig', { routingMode: option.value }] })) })
  }
  // 默认输出上限（分渠道）：只在上游没给输出规格时生效（目录 max_output 缺失/为 null
  // 的模型，如云知声 u2-med）。上游有真实规格就用上游值，这里只补缺。
  // 只有自带模型设置文件的三类渠道会消费这个值（API Key、自管、WorkBuddy）；
  // 账号池与商汤套餐渠道走各自兜底表、不读它，故不给它们渲染这一行 ——
  // 否则会出现「能保存但不生效」。
  const supportsDefaultMaxOutput = id === WORKBUDDY_ID
    || Boolean(state.managed?.[id]) || Boolean(state.apikeys?.[id])
  const configuredOutput = state.automation?.config?.providers?.[id]?.defaultMaxOutput
  const outputChosen = Number.isSafeInteger(configuredOutput) && configuredOutput > 0
  if (supportsDefaultMaxOutput) rows.push({ id: 'default-max-output', name: '默认输出上限', scope,
    meta: outputChosen ? `上游未给输出规格时用 ${formatTokens(configuredOutput)}` : '上游未给输出规格时按上下文推导',
    value: outputChosen ? configuredOutput : 0,
    options: [
      { value: 0, label: '默认' },
      { value: 64_000, label: '64K' },
      { value: 128_000, label: '128K' },
      { value: 256_000, label: '256K' },
    ].map(option => ({ ...option, call: ['setAutomationConfig', { provider: id, defaultMaxOutput: option.value || null }] })) })
  const guardEnabled = automationEffective(state, id, 'cotLoopGuard')
  rows.push({
    id: 'cot-loop-guard', name: '思考循环保护', scope,
    meta: inherited('cotLoopGuard'),
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
      meta: inherited('autoCheckin'),
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoCheckin: !enabled }],
      toggleLabel: `${provider.title} 自动每日签到`,
      actions: [query('checkin'), typeof overrides.autoCheckin === 'boolean'
        ? { label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoCheckin: null }] } : null],
    })
  }
  if (supportsRewards) {
    const enabled = automationEffective(state, id, 'autoClaimRewards')
    rows.push({
      id: 'auto-claim-rewards', name: '自动领取奖励', scope,
      meta: inherited('autoClaimRewards'),
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoClaimRewards: !enabled }],
      toggleLabel: `${provider.title} 自动领取奖励`,
      actions: [
        { label: '立即领取', call: ['runAutomationTask', id, 'claimRewards'], disabled: !eligible, scope: taskScope(id, 'claimRewards') },
        query('claimRewards'),
        typeof overrides.autoClaimRewards === 'boolean'
          ? { label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoClaimRewards: null }] } : null,
      ],
    })
  }
  if (supportsTasks) {
    const enabled = automationEffective(state, id, 'autoCompleteTasks')
    rows.push({
      id: 'auto-complete-tasks', name: '自动完成任务', scope,
      meta: inherited('autoCompleteTasks'),
      enabled,
      toggle: ['setAutomationConfig', { provider: id, autoCompleteTasks: !enabled }],
      toggleLabel: `${provider.title} 自动完成任务`,
      actions: [
        { label: '立即执行', call: ['runAutomationTask', id, 'completeTasks'], disabled: !eligible, scope: taskScope(id, 'completeTasks') },
        query('completeTasks'),
        typeof overrides.autoCompleteTasks === 'boolean'
          ? { label: '恢复跟随全局', call: ['setAutomationConfig', { provider: id, autoCompleteTasks: null }] } : null,
      ],
    })
  }
  return rows
}

function ChannelPanel(rows, ui, provider, state) {
  const autoRows = provider ? automationRowsFor(provider, state) : []
  const renderRows = list => ListBox({
    children: list.map(row => {
      const key = `${ui.providerId}:channel:${row.id}`
      const scope = row.scope || `channel:${ui.providerId}`
      const rowDisabled = ui.loading || ui.isPending(scope)
      const expandable = !!(row.form || row.groups?.length)
      return Row({
        key, name: row.name, meta: row.meta, tags: renderTags(row.tags),
        metric: row.metric ? Metric({ ...row.metric, label: row.name }) : undefined,
        switchControl: row.toggle ? Switch({ checked: row.enabled ?? false, disabled: rowDisabled || row.enabled === undefined,
          label: row.toggleLabel || row.name, onChange: () => ui.act(...row.toggle) }) : undefined,
        controls: row.options ? renderOptionTiers(row, ui, rowDisabled)
          : row.href ? [h('a', { className: 'eac-button', href: row.href, target: '_blank', rel: 'noopener noreferrer' }, '打开控制台')] : renderActions(row.actions, ui, scope),
        moreLabel: expandable ? (row.moreLabel || '配置') : undefined, expanded: ui.more[key] === true,
        onToggle: () => ui.act('toggleMore', key),
        detail: expandable ? [
          ...(row.groups ?? []).map(renderQuotaGroup),
          row.form ? h('div', { key: 'form' }, renderForm(row.form, ui)) : null,
        ] : undefined,
      })
    }),
  })
  return Section({
    title: '渠道设置',
    children: [
      rows.length ? h('div', { className: 'eac-group', key: 'channel' },
        autoRows.length ? h('p', { className: 'eac-group-title' }, '渠道连接与配置') : null,
        renderRows(rows)) : null,
      autoRows.length ? h('div', { className: 'eac-group', key: 'automation' },
        h('p', { className: 'eac-group-title' }, '自动化与策略'),
        renderRows(autoRows)) : null,
    ].filter(Boolean),
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
  // 统一免费与订阅模型（仅小浣熊家族卡）：自动化状态声明本卡可用该开关，
  // 且用户已打开。开着时模型分区只显示一个「统一模型」组（合并目录由后端
  // 免费面适配器提供），订阅模型面整组隐藏。
  const unifiedModelsOn = state => !!(caps.unifiedModels
    && state.automation?.unifiedModelProviders?.includes(id)
    && state.automation?.config?.raccoonUnifiedModels)
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
      const pool = summarizePoolCredits(
        state.accounts.filter(account => account.enabled !== false).map(account => {
          const bal = balances.get(account.id)
          return { amount: bal?.total ?? null, unit: '积分', packages: bal?.packages ?? [] }
        }),
        id,
      )
      const routeCounts = caps.routeCheck ? loomyRouteCounts(state) : null
      const routeSummary = caps.routeCheck ? loomyRouteSummaryText(state) : ''
      const hasUnhealthyRoute = !!routeCounts && (routeCounts.routed + routeCounts.expired + routeCounts.exhausted + routeCounts.unknown) > 0
      return {
        ready: !state.loading || state.accounts.length > 0,
        failed: state.loadFailed,
        poolSummary: [pool.known ? `总计 ${pool.summary}` : '', routeSummary].filter(Boolean).join(' · '),
        routeOverview: caps.routeCheck ? {
          counts: routeCounts,
          skipRouted: state.loomyRoute?.skipRouted !== false,
          lastCheckedAt: loomyRouteLatestAt(state),
        } : null,
        autoCheckin: checkinEnabled(state, id),
        actions: [
          caps.routeCheck && { label: '检测路由', call: ['loomyCheckRoute'], disabled: state.accounts.length === 0, scope: 'route:loomy' },
          caps.routeCheck && hasUnhealthyRoute && { label: '重测异常', call: ['loomyCheckRoute', undefined, 'unhealthy'], scope: 'route:loomy' },
          caps.dailyReward !== false && { label: '全部领取', call: ['claim'],
            disabled: !state.accounts.some(account => account.enabled !== false && !checkinEntry(state, id, account.id)?.locked),
            scope: `channel:${state.provider}` },
          { label: '添加账号', call: ['startLogin'], primary: true },
        ],
        login: state.login && { url: state.login.url, canCheck: true },
        rows: state.accounts.map(account => {
          const { id: accountId, nickname, enabled, plan } = account
          const limited = Object.values(account.modelRateLimits).filter(expires => expires > Date.now()).length
          const balance = balances.get(accountId)
          const taskMode = caps.completeTasks ? 'completeTasks' : 'claimRewards'
          const onboarding = caps.onboarding ? taskEntry(state, id, taskMode, accountId) : null
          const routeInfo = caps.routeCheck ? loomyRouteView(state, account) : null
          const shownPackages = displayCreditPackages(balance?.packages)
          const groups = [
            ...(shownPackages.length ? [{ title: '额度包', items: shownPackages.map(pkg => ({
              label: pkg.name || '额度包', value: pkg.remaining, unit: pkg.unit || undefined,
              notes: [!pkg.active && '已失效', pkg.expiresAt > 0 && `到期 ${displayTime(pkg.expiresAt)}`],
            })) }] : []),
            ...(routeInfo?.detail ? [{ title: '上游路由', items: [{
              label: routeInfo.detail.statusLabel,
              value: routeInfo.detail.servedLabel,
              notes: [
                routeInfo.detail.reasonLabel && (routeInfo.entry ? `依据 ${routeInfo.detail.reasonLabel}` : routeInfo.detail.reasonLabel),
                routeInfo.detail.checkedAt > 0 && `检测 ${displayTime(routeInfo.detail.checkedAt)}`,
              ],
            }] }] : []),
          ]
          return {
            id: accountId, name: nickname, enabled,
            toggle: ['save', accountId, nickname, !enabled],
            tags: [
              // 统一模型开关打开后不再区分免费/订阅：合并的意义就是「一个模型面」，
              // 再挂套餐标签会让人以为还要按套餐挑账号。关闭时照旧按套餐标注。
              caps.accountPlan && !unifiedModelsOn(state)
                && (plan === 'pro' ? ['订阅', 'info'] : plan === 'free' ? ['免费', 'success'] : ['套餐未知', 'warn']),
              !enabled && ['已停用'],
              account.expiresAt > 0 && account.expiresAt <= Date.now() && ['凭据过期', 'warn'],
              limited > 0 && [`受限 ${limited}`, 'warn'],
              balance?.stale && [balance.total === null ? '余额读取失败' : '上次余额', 'warn'],
              caps.routeCheck && routeInfo?.tag,
              checkinEntry(state, id, accountId)?.tag,
              onboarding?.tag,
            ],
            metric: { value: balance?.total ?? (balance?.stale ? '—' : '额度待更新'), unit: balance?.total != null ? '积分' : undefined },
            updatedAt: balance?.updatedAt,
            groups,
            form: { kind: 'account', account, call: ['save'] },
            actions: [
              caps.routeCheck && { label: '检测路由', call: ['loomyCheckRoute', accountId], scope: 'route:loomy' },
              caps.routeCheck && routeInfo?.entry && { label: '清除路由', call: ['loomyClearRoute', accountId], scope: 'route:loomy' },
              caps.onboarding && { label: caps.rewardLabel ?? '领新手任务', call: ['onboarding', accountId], disabled: !enabled || onboarding?.locked },
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
      const shown = unifiedModelsOn(state) ? [{ id: sides[0].id, title: '统一模型' }] : sides
      return { groups: shown.map(side => {
        const rows = state.models.filter(model => model.provider === side.id).map(model => ({
          ...model,
          enabled: !model.disabled && !model.dead,
          toggle: ['toggleModel', model.key],
          defaults: defaultParamSummary(model),
          tags: [
            model.dead && ['已失效', 'error'],
            // 订阅限定与倍率/免费是独立维度：会员门槛先标，再标当前消耗倍率。
            model.subscriptionOnly && ['订阅限定', 'info'],
            model.rate ? [model.rate.label, model.rate.tone === 'warning' ? 'warn' : model.rate.tone]
              : model.isFree && ['免费', 'success'],
          ],
          editor: { kind: 'tiers', call: ['setModelParams', model.key], value: state.params[model.key] },
        }))
        return {
          id: side.id, title: side.title, rows, source: state.modelSource[side.id] ?? 'unknown',
          notice: side.id === 'qodercn' ? ({
            'login-required': 'Qoder CLI 未登录 · qoderclicn login',
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
      const skipRouted = state.loomyRoute?.skipRouted !== false
      const routeCounts = caps.routeCheck ? loomyRouteCounts(state) : null
      const hasAccounts = state.accounts.length > 0
      const hasUnhealthyRoute = !!routeCounts && (routeCounts.routed + routeCounts.expired + routeCounts.exhausted + routeCounts.unknown) > 0
      const hasAnyRoute = !!routeCounts && (routeCounts.total - routeCounts.unchecked) > 0
      return [
        ...(unifiedModelsOn(state) ? [{
          id: sides[0].id, name: '模型提供方',
          enabled: state.statuses[sides[0].id] ? !state.statuses[sides[0].id].closed : undefined,
          toggle: ['setEnabled', state.statuses[sides[0].id]?.closed === true, sides[0].id],
          toggleLabel: state.statuses[sides[0].id]?.closed !== false ? '打开模型提供方' : '关闭模型提供方',
        }] : sides.map(side => ({
          id: side.id, name: side.title ? `${side.title}提供方` : '模型提供方',
          enabled: state.statuses[side.id] ? !state.statuses[side.id].closed : undefined,
          toggle: ['setEnabled', state.statuses[side.id]?.closed === true, side.id],
          toggleLabel: state.statuses[side.id]?.closed !== false ? (family ? '打开模型提供方' : '打开渠道') : (family ? '关闭模型提供方' : '关闭渠道'),
        }))),
        ...(caps.unifiedModels && state.automation?.unifiedModelProviders?.includes(id) ? [{
          id: 'unified-models', name: '统一免费与订阅模型',
          // 合并后是一个模型面：说明按「谁有额度用谁」讲，不再强调免费/订阅的先后，
          // 否则用户会以为还要按套餐挑账号。
          meta: '合并为一个模型面 · 额度用尽自动切换账号',
          enabled: state.automation?.config?.raccoonUnifiedModels === true,
          toggle: ['setAutomationConfig', { raccoonUnifiedModels: !(state.automation?.config?.raccoonUnifiedModels === true) }],
          toggleLabel: '统一免费与订阅模型',
        }] : []),
        ...(caps.permanentLock ? [{
          id: 'permanent', name: '锁定永久积分', meta: '仅使用有时效的积分',
          enabled: state.locked, toggle: ['lock', !state.locked],
        }] : []),
        ...(caps.routeCheck ? [{
          id: 'route-check', name: '避开上游改路由账号', scope: 'route:loomy',
          meta: '只读检测（0 积分）· 自动避开静默改路由账号',
          enabled: skipRouted, toggle: ['loomySetSkipRouted', !skipRouted],
          moreLabel: hasAccounts ? '路由明细' : undefined,
          groups: hasAccounts ? [{
            title: '各账号路由状态',
            items: state.accounts.map(account => {
              const info = loomyRouteView(state, account)
              const detail = info.detail
              return {
                label: account.nickname,
                value: info.tag[0],
                notes: [
                  detail?.servedLabel && detail.servedLabel !== '未检测' && !info.tag[0].includes(detail.servedLabel) && `落地 ${detail.servedLabel}`,
                  detail?.reasonLabel,
                  detail?.checkedAt > 0 && `检测 ${displayTime(detail.checkedAt)}`,
                ],
              }
            }),
          }] : undefined,
          tags: [
            routeCounts.routed > 0 && [`改路由 ${routeCounts.routed}`, 'error'],
            routeCounts.clean > 0 && [`正常 ${routeCounts.clean}`, 'success'],
            routeCounts.expired + routeCounts.exhausted > 0 && [`异常 ${routeCounts.expired + routeCounts.exhausted}`, 'warn'],
            routeCounts.unchecked > 0 && [`未检测 ${routeCounts.unchecked}`],
          ],
          actions: [
            { label: '检测全部', call: ['loomyCheckRoute'], disabled: !hasAccounts },
            { label: '重测异常', call: ['loomyCheckRoute', undefined, 'unhealthy'], disabled: !hasUnhealthyRoute },
            { label: '清空记录', call: ['loomyClearRoute'], disabled: !hasAnyRoute },
          ],
        }] : []),
      ]
    },
  }
}

// ── src/client/providers/managed.js ──
// 通用自管多账号渠道前端视图与动作工厂（供 AStudio、CodeArts 共用）。
// 新增同类渠道只需提供 5 行声明（id / title / authMethods / capabilities），不再手写 UI 或状态流。
const EMPTY_MANAGED = Object.freeze({
  enabled: true, registered: false, authMethods: ['browser'], credentialHint: '',
  accounts: [], models: [], modelSource: undefined, loginUrl: '',
})

function managedRemaining(window) {
  return window.used !== null ? Math.min(1, Math.max(0, 1 - window.used / 100)) : null
}

const SOURCE_LABELS = { local: '本机导入', credential: '凭据导入', browser: '浏览器登录' }

function managedConnectionStatus(current) {
  const accounts = current.accounts ?? []
  const active = accounts.filter(account => account.enabled !== false)
  const connected = active.filter(account => account.signedIn).length
  return { connected, label: connected ? `已连接 ${connected} 个` : !accounts.length ? '待添加账号'
    : !active.length ? '账号已停用' : '账号需重新登录' }
}

/**
 * 构造自管渠道的客户端视图。
 *
 * `card`：是否在渠道选择器里显示卡片（默认显示）。置 `false` 用于**停用渠道**——
 * `providers/index.js` 的 `PROVIDERS` 会按 `card !== false` 过滤，于是该渠道的
 * 卡片、模型分组与轮询都不再出现。⚠️ 这个字段必须在这里**显式解构**，否则会被
 * 静默丢弃（早期 `astudio` 传了 `card: false` 却没生效，就是这个原因）。
 */
function managedChannel({ id, title, card = true, authMethods = ['browser'], credentialHint = '', checkin = false, claimRewards = false, completeTasks = false, accountLinks = [] }) {
  const entry = state => state.managed?.[id]
  const withEntry = (state, next) => ({ managed: { ...state.managed, [id]: next } })

  const provider = {
    id,
    title,
    ...card === false ? { card: false } : {},
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
        return withEntry(state, { ...managed, loginUrl: previous.loginUrl || managed.loginUrl, ready: true, stale: stale || snapshot?.snapshot?.stale === true, error: false, liveAt: Date.now() })
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
      const { connected: signedIn, label: connectionLabel } = managedConnectionStatus(current)
      const closed = current.enabled === false
      const label = closed ? '渠道已关闭' : signedIn ? (current.registered ? '渠道运行中' : '已连接 · 待注册') : connectionLabel
      return {
        closed,
        accounts: signedIn,
        totalAccounts: accounts.length,
        models: (current.models ?? []).length,
        label,
        tone: !closed && current.registered && signedIn && !accounts.some(account => account.error && account.error !== 'upstream_error') ? 'success' : 'warn',
      }
    },
    accounts(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const isAStudio = id === 'astudio'
      const methods = current.authMethods?.length ? current.authMethods : authMethods
      const loginUrl = current.loginUrl || ''
      const pool = summarizePoolCredits(
        current.accounts
          .filter(account => account.enabled !== false && account.signedIn && (isAStudio || account.balance !== null))
          .map(account => ({
            amount: account.balance,
            unit: account.unit || '积分',
            packages: isAStudio
              ? account.windows
              : account.windows.filter(w => w.name !== '总积分包' && w.name !== '免费日额度'),
          })),
        id,
      )
      return {
        ready: current.ready === true || current.accounts.length > 0,
        failed: current.error === true,
        poolSummary: pool.known ? `总计 ${pool.summary}` : '',
        autoCheckin: checkin ? automationEffective(state, id, 'autoCheckin') : undefined,
        login: loginUrl ? { url: loginUrl, cancel: state.pending?.[`login:${id}`] ? [`${id}CancelLogin`] : null } : null,
        importForm: methods.includes('credential') ? {
          hint: current.credentialHint || credentialHint,
          call: [`${id}ImportCredential`],
        } : null,
        actions: [
          methods.includes('local') && { label: '导入本机登录', call: [`${id}ImportLocal`], primary: !methods.includes('browser') },
          methods.includes('browser') && { label: '浏览器登录', call: [`${id}Login`], primary: true },
          methods.includes('credential') && { label: '粘贴凭据', call: ['toggleImportForm', id] },
          ...accountLinks,
        ],
        rows: current.accounts.map(account => {
          const name = account.name || account.uid || account.id
          const remaining = isAStudio ? [] : account.windows.map(managedRemaining).filter(value => value !== null)
          const lowest = remaining.length ? Math.min(...remaining) : null
          const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === id
          const ck = checkin ? checkinEntry(state, id, account.id) : null
          const rw = claimRewards ? taskEntry(state, id, 'claimRewards', account.id) : null
          const metric = account.balance !== null
            ? { value: account.balance, unit: account.unit || '积分' }
            : percentMetric(lowest)
              // 无网页会话时不存在「待更新」——这个渠道本来就不读积分，
              // 显示「待更新」会让人一直等。用破折号表示不适用。
              ?? { value: account.error === 'no_web_session' ? '—' : '额度待更新' }
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
              // `no_web_session` 不是故障：账号能推理，只是没有网页会话因而读不到积分。
              // 按 info 呈现原因，不要挂 warn（那会让用户以为账号坏了）。
              account.error === 'no_web_session' && ['仅推理 Token · 不读积分', 'info'],
              account.error && account.error !== 'no_web_session' && [(account.windows.length || account.balance !== null) ? '上次额度' : '额度读取失败', 'warn'],
              !account.error && current.stale && [(account.windows.length || account.balance !== null) ? '上次额度' : '额度读取失败', 'warn'],
              ck?.tag,
              rw?.tag,
            ],
            metric,
            groups: account.windows.length ? [{
              title: isAStudio ? '额度包' : '额度窗口',
              items: account.windows.map(window => {
                const fraction = isAStudio ? null : managedRemaining(window)
                const unitLabel = window.unit || (isAStudio ? '积分' : '')
                return {
                  label: window.name, fraction,
                  value: fraction === null ? (window.balance ?? window.display) : Math.round(fraction * 100),
                  unit: fraction === null ? (window.unit || (isAStudio ? '积分' : undefined)) : '% 剩余',
                  notes: [
                    fraction !== null && windowRemainingNote(window, unitLabel),
                    window.amount !== null && `已用 ${displayNumber(window.amount)} ${window.unit}`.trim(),
                    (window.expiresAt || isAStudio && window.resetsAt) && `到期 ${displayTime(window.expiresAt || window.resetsAt)}`,
                    !isAStudio && window.resetsAt && `${id === 'codearts' ? '周期结束' : '重置'} ${displayTime(window.resetsAt)}`,
                    window.runsOutAt && `预计用尽 ${displayTime(window.runsOutAt)}`,
                  ],
                }
              }),
            }] : [],
            form: { kind: 'account', account: { id: account.id, nickname: name, enabled: account.enabled !== false }, call: [`${id}UpdateAccount`] },
            actions: [
              checkin && account.signedIn && { label: '签到', accessible: `为 ${name} 签到`, call: [`${id}Checkin`, account.id], disabled: ck?.locked },
               claimRewards && account.signedIn && { label: '领奖励', accessible: `为 ${name} 领取奖励`, call: [`${id}ClaimRewards`, account.id], disabled: account.enabled === false || rw?.locked },
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
            defaults: id === 'codearts' ? [baseModelSummary(model),
              model.output > 0 && model.output !== model.defaultMaxOutputLength ? `目录输出 ${formatTokens(model.output)}` : ''].filter(Boolean).join(' · ')
              : baseModelSummary(model),
            tags: [model.rate ? [model.rate.label, model.rate.tone] : model.free && ['免费', 'success']],
            editor: { kind: 'numeric', call: [`${id}SetModelParams`, model.id] },
          })),
        }],
      }
    },
    channel(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const { connected, label } = managedConnectionStatus(current)
      return [
        {
          id: 'models', name: '模型提供方',
          enabled: current.enabled !== false,
          toggle: [`${id}SetEnabled`, current.enabled === false],
           tags: [current.enabled !== false && current.accounts.some(a => a.signedIn && a.enabled !== false) && !current.registered && ['待注册', 'warn']],
        },
        {
          id: 'accounts', name: '账号连接',
          tags: [[current.ready || current.accounts.length ? label : '待读取', connected ? 'success' : undefined]],
          actions: [{ label: '管理账号', panel: 'accounts' }],
        },
      ]
    },
  }
  return provider
}

function createManagedActions(provider, { getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers, writes, persistCards }) {
  const { id, title } = provider
  let activeLogin = null
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
    [`${id}CancelLogin`]() { activeLogin?.abort() },
    [`${id}Login`]() {
      if (activeLogin) return Promise.resolve(false)
      const controller = new AbortController()
      activeLogin = controller
      writes.add(controller)
      const options = {
        scope: `login:${id}`,
        controller,
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
      const fetchUrl = async () => {
        if (!polling || getState().provider !== id) return
        try {
          const value = await request('managed.snapshot', { provider: id, ...(hasSnapshots() ? { localOnly: true } : {}) }, controller.signal)
          const loginUrl = safeLoginUrl(value?.loginUrl)
          if (polling && loginUrl && !isDisposed() && getState().provider === id) {
            patchEntry(cur => ({ ...cur, loginUrl }))
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
        activeLogin = null
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
           if (outcome === 'inactive') return id === 'codearts' ? '未查到今日签到记录。' : '今日签到活动未开启。'
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
// 渠道专有能力：新手任务（onboarding.claim）、永久积分锁定、上游路由检测（Loomy 专有）。
const loomy = {
  id: 'loomy',
  title: 'Loomy',
  // ⚠️ 已停用（2026-11-24）：全部账号被上游标记受限，请求一律落到 spark-x2.6-low
  // （响应体仍谎报 DeepSeek-V4.1-Flash，只有积分账本能看出）。停用方式为
  // **不注册模型适配器**（`LOOMY_CHANNEL_ENABLED = false`），因此渠道里没有可用模型。
  // 渠道已停用：模型不可用（适配器不注册）。卡片保留以显示状态与「已被上游限制」摘要。
  // channel-pack 通用渠道：账号池 + 模型目录 + 渠道开关。
  pack: true,
  caps: {
    // 手动入口：onboarding.claim 只接受 loomy 与 raccoon。
    // Loomy 实际是向上游**上报任务完成**（POST tasks/complete），不是被动领取，
    // 按钮文案按动作写「完成新手任务」。
    onboarding: true,
    rewardLabel: '完成新手任务',
    // 自动化调度归「自动完成任务」（默认关闭），不是「自动领取奖励」。
    completeTasks: true,
    // 永久积分锁定：Loomy 专有。
    permanentLock: true,
    // 0 积分只读上游路由检测（目录 + 积分账本）：Loomy 专有。
    routeCheck: true,
  },
  createActions({ getState, publish, mutate, rememberChannel }) {
    const applyRouteState = value => {
      const nextRoute = loomyRouteFrom(value)
      const state = getState()
      const accounts = state.provider === 'loomy'
        ? state.accounts.map(({ route: _old, ...account }) => ({
          ...account,
          ...(nextRoute.accounts[account.id] ? { route: nextRoute.accounts[account.id] } : {}),
        }))
        : state.accounts
      publish({ loomyRoute: nextRoute, ...(state.provider === 'loomy' ? { accounts } : {}) })
      if (state.provider === 'loomy') rememberChannel?.('loomy')
    }
    return {
      loomyCheckRoute(accountId, mode) {
        const single = typeof accountId === 'string' && accountId !== ''
        return mutate('loomy.checkRoute', {
          provider: 'loomy',
          ...(single ? { accountId } : {}),
          ...(!single && typeof mode === 'string' && mode ? { mode } : {}),
        }, {
          refresh: false,
          scope: single ? `account:${accountId}` : 'route:loomy',
          progress: single ? '正在只读检测该账号上游路由…' : '正在只读检测 Loomy 上游路由（0 积分）…',
          message: value => loomyRouteMessage(value, single ? accountId : ''),
          result: applyRouteState,
        })
      },
      loomySetSkipRouted(skipRouted) {
        return mutate('loomy.setRouteConfig', {
          provider: 'loomy',
          skipRouted: skipRouted === true,
        }, {
          refresh: false,
          scope: 'route:loomy',
          message: value => value?.skipRouted === false
            ? '已允许选用上游改路由账号。'
            : '已开启：自动避开上游改路由账号。',
          result: applyRouteState,
        })
      },
      loomyClearRoute(accountId) {
        const single = typeof accountId === 'string' && accountId !== ''
        return mutate('loomy.clearRoute', {
          provider: 'loomy',
          ...(single ? { accountId } : {}),
        }, {
          refresh: false,
          scope: single ? `account:${accountId}` : 'route:loomy',
          message: single ? '已清除该账号路由记录。' : '已清空 Loomy 路由检测记录。',
          result: applyRouteState,
        })
      },
    }
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
  // 两个能力位是**不同维度**，不要合并：
  // - `dailyReward`：有没有「一键领取每日额度」（`credits.claimAll`）——raccoon 没有，
  //   该端点对它不适用（登录奖励走 `onboarding.claim`）；
  // - `autoCheckin`：有没有「自动每日签到」（`automation` 的 checkin 任务）——有。
  //   上游没有专门的签到端点，由 `raccoon.checkin` 以一次带桌面端头的只读
  //   `setting_info` 触发当日积分发放。
  caps: { accountPlan: true, onboarding: true, rewardLabel: '领登录奖励', unifiedModels: true, dailyReward: false, autoCheckin: true },
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
const senseNovaQuotaStatus = {
  'needs-console': '未登录', expired: '登录已失效', error: '额度读取失败',
}

function senseNovaQuotaPools(quota, model) {
  if (quota?.status !== 'ready' || !Array.isArray(quota.pools)) return []
  if (!model) return quota.pools
  const matches = quota.pools.filter(pool => Array.isArray(pool?.modelIds) && pool.modelIds.includes(model))
  const dedicated = matches.filter(pool => ['dedicated', 'flash'].includes(String(pool.poolType ?? '').toLowerCase()))
  return dedicated.length ? dedicated : matches
}

function senseNovaQuotaDetails(pool) {
  const windows = [[pool.window5h, '5 小时积分'], [pool.window7d, '7 天积分']].flatMap(([row, label]) => !row ? [] : [{
    label, fraction: remainingFraction(row.remaining, row.limit),
    value: row.limit > 0 ? `${displayNumber(row.remaining)} / ${displayNumber(row.limit)} 积分` : `${displayNumber(row.remaining)} 积分`,
    reset: row.resetAt ? row.resetAt * 1000 : null,
  }])
  if (Number.isFinite(pool.grantBalance)) windows.push({ label: '赠送积分', value: `${displayNumber(pool.grantBalance)} 积分`,
    expires: pool.nearestGrantExpiry && pool.grantBalance > 0 ? pool.nearestGrantExpiry * 1000 : null,
    expiringAmount: pool.nearestGrantExpiringBalance > 0 ? `${displayNumber(pool.nearestGrantExpiringBalance)} 积分` : '' })
  return windows
}

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
         defaults: baseModelSummary(model),
        editor: { kind: 'numeric', call: ['planSetModelParams', model.id] },
      })),
    }] }
  },
  channel({ plan, pending }) {
    const signingIn = pending?.['console-login:sensenova-token-plan'] === true
    const pools = senseNovaQuotaPools(plan?.quota)
    const quotaRows = pools.flatMap((pool, index) => senseNovaQuotaDetails(pool).map((detail, detailIndex) => ({
      id: `pool-${index}-${detailIndex}`,
      name: pools.length === 1 ? detail.label : `${pool.name || '积分池'} · ${detail.label}`,
      meta: [
        Number.isFinite(detail.fraction) ? `剩余 ${detail.value}` : detail.value,
        displayTime(detail.reset) !== '—' ? `重置 ${displayTime(detail.reset)}` : '',
        displayTime(detail.expires) !== '—' ? `到期 ${displayTime(detail.expires)}${detail.expiringAmount ? ` · ${detail.expiringAmount}` : ''}` : '',
      ].filter(Boolean).join(' · '),
      metric: percentMetric(detail.fraction),
    })))
    return [
      { id: 'models', name: '模型提供方', enabled: plan?.registerProvider, toggle: ['planSetEnabled', !plan?.registerProvider],
        tags: [plan?.registerProvider && !plan.providerRegistered && ['待注册', 'warn']] },
      { id: 'key', name: '模型 API Key', tags: [[plan?.hasApiKey ? '已配置' : '待配置', plan?.hasApiKey ? 'success' : undefined]],
        form: { kind: 'key', call: ['planSetKey'] } },
      { id: 'console-quota', name: '控制台额度', scope: 'console-actions:sensenova-token-plan',
        meta: signingIn ? '等待浏览器授权' : plan?.quota?.status === 'ready' ? `${pools.length} 个积分池${plan?.quota?.plan ? ` · ${plan.quota.plan}` : ''}` : senseNovaQuotaStatus[plan?.quota?.status],
        actions: signingIn ? [{ label: '取消登录', call: ['planCancelConsoleLogin'] }] : [
          { label: plan?.quota?.status === 'ready' ? '重新登录' : '浏览器登录', call: ['planConsoleLogin'], primary: plan?.quota?.status !== 'ready' },
          { label: '打开控制台', href: 'https://platform.sensenova.cn/' },
        ] },
      ...quotaRows,
    ]
  },
}

function createSenseNovaActions({ getState, publish, planMutate }) {
  let consoleLogin
  return {
    planConsoleLogin() {
      if (consoleLogin) return Promise.resolve(false)
      const controller = new AbortController()
      consoleLogin = controller
      return planMutate('plan.consoleLogin', {}, {
        controller, scope: 'console-login:sensenova-token-plan',
        progress: '正在等待商汤控制台浏览器授权…', failure: '商汤控制台登录失败。',
        message: value => value?.quota?.status === 'ready' ? '商汤控制台已连接。' : '登录成功，额度暂未读取。',
        result(value) {
          const plan = getState().plan
          if (plan) publish({ plan: { ...plan, quota: value.quota ?? null } })
        },
      }).finally(() => { consoleLogin = null })
    },
    planCancelConsoleLogin() { consoleLogin?.abort() },
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

function workbuddyPoolSummary(accounts) {
  const pool = summarizePoolCredits(
    (accounts ?? []).filter(account => account?.signedIn)
      .map(account => workbuddyAccountCredits(account.windows) ?? { amount: null, unit: '积分' }),
    workbuddy.id,
  )
  return pool.known ? `总计 ${pool.summary}` : ''
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
      poolSummary: workbuddyPoolSummary(state.workbuddy.accounts),
      autoCheckin: checkinEnabled(state, workbuddy.id),
      login: state.workbuddyLoginUrl || state.workbuddy.loginUrl
        ? { url: state.workbuddyLoginUrl || state.workbuddy.loginUrl, cancel: state.pending?.[`login:${workbuddy.id}`] ? ['workbuddyCancelLogin'] : null } : null,
      actions: [{ label: '添加账号', call: ['workbuddyLogin'], primary: true }],
      rows: state.workbuddy.accounts.map(account => {
        const name = account.name || account.uid || account.id
        const remaining = account.windows.filter(window => !window.aside).map(buddyRemaining).filter(value => value !== null)
        const lowest = remaining.length ? Math.min(...remaining) : null
        const credits = workbuddyAccountCredits(account.windows)
        const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === 'workbuddy'
        const checkin = checkinEntry(state, workbuddy.id, account.id)
        return {
          id: account.id, name, updatedAt: account.updatedAt,
          // 账号开关：停用账号不参与选号与 429 轮换。
          enabled: account.enabled !== false,
          toggle: ['workbuddySetAccountEnabled', account.id, account.enabled === false],
          tags: [
            account.plan && [account.plan, 'info'],
            account.enabled === false && ['已停用'],
            !account.signedIn && ['待登录', 'warn'],
            (account.error || state.workbuddyStale) && [account.windows.length ? '上次额度' : '额度读取失败', 'warn'],
            checkin?.tag,
          ],
          metric: credits
            ? { value: credits.amount, unit: credits.unit, ...(lowest !== null ? { fraction: lowest } : {}) }
            : (percentMetric(lowest) ?? { value: '额度待更新' }),
          groups: account.windows.length ? [{ title: '额度窗口', items: account.windows.map(window => {
            const fraction = buddyRemaining(window)
            const unitText = displayCreditUnit(window.unit)
            const rem = windowRemainingAmount(window)
            return {
              label: window.name, fraction,
              value: rem !== null ? (window.limit > 0 ? `${displayNumber(rem)} / ${displayNumber(window.limit)}` : rem)
                : fraction === null ? window.balance : Math.round(fraction * 100),
              unit: rem !== null ? (unitText || '积分') : (fraction === null ? (unitText || window.unit) : '% 剩余'),
              notes: [
                rem !== null ? (fraction !== null && `剩余 ${Math.round(fraction * 100)}%`) : (fraction !== null && windowRemainingNote(window, unitText)),
                window.amount !== null && `已用 ${displayNumber(window.amount)} ${unitText}`.trim(),
                window.resetsAt && `重置 ${displayTime(window.resetsAt)}`,
                window.runsOutAt && `到期 ${displayTime(window.runsOutAt)}${window.runsOut > 0 ? ` · ${displayNumber(window.runsOut)} ${unitText}`.trimEnd() : ''}`,
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
         defaults: baseModelSummary(model),
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

function createWorkBuddyActions({ getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers }) {
  let activeLogin = null
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
    workbuddyCancelLogin() { activeLogin?.abort() },
    workbuddyLogin() {
      if (activeLogin || getState().loading) return Promise.resolve(false)
      const controller = new AbortController()
      activeLogin = controller
      const options = { progress: '正在准备 WorkBuddy 登录…',
        controller, message: value => value?.signedIn === true ? '已添加 WorkBuddy 账号。' : 'WorkBuddy 登录未完成，请重试。' }
      const login = mutate('workbuddy.login', {}, options)
      let polling = true, timer = null
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
        activeLogin = null
        if (timer !== null) { clearTimeout(timer); loginUrlTimers.delete(timer) }
        if (!isDisposed() && getState().provider === workbuddy.id) publish({ workbuddyLoginUrl: null })
      })
    },
    // 退出/签到都按账号 id 操作：WorkBuddy 是自管多账号，没有「当前账号」概念。
    workbuddyLogout(accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('workbuddy.logout', { accountId }, { message: '已退出该 WorkBuddy 账号。' })
    },
    /**
     * 账号开关：停用后该账号不参与选号与 429 轮换（凭据保留，重新启用即可用）。
     * WorkBuddy 每个账号的 DS-V4.1-Flash 额度用尽后上游回 429，此开关用于
     * 主动把耗尽的账号摘出轮换池。
     */
    workbuddySetAccountEnabled(accountId, enabled) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      if (typeof enabled !== 'boolean') return Promise.resolve(false)
      return mutate('workbuddy.setAccountEnabled', { accountId, enabled }, {
        message: enabled ? '已启用该 WorkBuddy 账号。' : '已停用该 WorkBuddy 账号（不再参与选号）。',
      })
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

const apiQuotaLabels = {
  'weekly-points': '周积分', 'window-points': '5 小时积分', 'monthly-credits': '月度 Credits',
  'window-credits': '5 小时 Credits', 'pack-credits': '积分包 Credits',
  'weekly-requests': '每周请求数', 'window-requests': '5 小时请求数',
}

function apiQuotaResetHint(row, at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0 || at > now || !row.resetInMs) return ''
  const minutes = Math.ceil((row.resetInMs - (now - at)) / 60000)
  if (minutes <= 0) return ''
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes / 60) % 24
  if (row.id === 'weekly-points' && minutes <= 60) return '约 1 小时内重置'
  if (minutes === 1) return '约 1 分钟内重置'
  const duration = [days && `${days} 天`, hours && `${hours} 小时`, row.id !== 'weekly-points' && minutes % 60 && `${minutes % 60} 分钟`].filter(Boolean).join(' ')
  return duration ? `约 ${duration}后重置` : ''
}

function apiQuotaRows(quota, consoleUrl, providerId, balance) {
  if (providerId === 'agnes' && isAgnesFreeQuota(quota, balance)) {
    return [{
      id: 'console-quota', name: '账户额度', href: consoleUrl,
      meta: '免费用户（额度读取为 0）',
      tags: [['免费用户', 'info']],
    }]
  }
  if (!quota) return []
  if (quota.status === 'needs-console' && providerId === 'agnes' && balance && !balance.error) return []
  if (quota.status !== 'ready') return [{ id: 'console-quota', name: '控制台额度', href: consoleUrl,
    meta: { 'needs-console': '未配置控制台会话', unavailable: '暂无额度数据', expired: '控制台会话已过期', error: '读取失败' }[quota.status] }]
  return [
    ...quota.windows.map(row => ({ id: row.id, name: apiQuotaLabels[row.id],
      meta: [`${row.remaining === null ? `已用 ${displayNumber(row.used)}` : `剩余 ${displayNumber(row.remaining)}`}${row.limit === null ? '' : ` / ${displayNumber(row.limit)}`}`, apiQuotaResetHint(row, quota.updatedAt)].filter(Boolean).join(' · '),
      metric: percentMetric(remainingFraction(row.remaining, row.limit)) })),
    ...(Array.isArray(quota.gifts) ? quota.gifts.map(row => ({ id: `gift-${row.modelId}`, name: `${row.modelId} 赠送额度`,
      meta: `${row.remaining === null ? `已用 ${displayNumber(row.used)}` : `剩余 ${displayNumber(row.remaining)}`}${row.limit === null ? '' : ` / ${displayNumber(row.limit)}`}${row.unit ? ` ${row.unit}` : ''}`,
      metric: percentMetric(remainingFraction(row.remaining, row.limit)) })) : []),
    ...(quota.balance === null ? [] : [{ id: 'console-balance', name: '控制台余额', meta: apikeyMoney(quota.balance, 'CNY') }]),
  ]
}

function ApiKeyCooldown({ limit }) {
  const secondsLeft = () => Math.max(0, Math.ceil((limit.until - Date.now()) / 1000))
  const [seconds, setSeconds] = React.useState(secondsLeft)
  React.useEffect(() => {
    const timer = setInterval(() => {
      const next = secondsLeft()
      setSeconds(next)
      if (!next) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [limit.until])
  if (!seconds) return '可重试'
  const label = limit.reason === 'rpm' ? '请求频率受限（RPM）' : limit.reason === 'tpm' ? 'Token 速率受限（TPM）' : '请求限速'
  return h('span', { role: 'timer' }, `${label} · ${limit.estimated ? '预计' : '剩余'} ${seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ` : ''}${seconds % 60} 秒`)
}

function apiKeyChannel({ id, title, host, toolsLabel = '多模态能力工具', toolsMeta = '语音转写 · 语音合成 · 声音克隆 · 文档解析 · 信息抽取' }) {
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
           defaults: baseModelSummary(model),
          tags: [
            model.free && ['免费', 'success'],
            model.paidOnly && ['需付费', 'info', '仅付费余额或 Agent Plan 订阅可用，免费账号不可调用。'],
          ],
          editor: { kind: 'numeric', call: [id + 'SetModelParams', model.id] },
        })),
      }] }
    },
    channel(state) {
      const current = entry(state)
      const usage = current?.balance
      const signingIn = state.pending?.[`console-login:${id}`] === true
      return [
        { id: 'models', name: '模型提供方',
          enabled: current?.hasApiKey ? current.registerProvider : undefined,
          toggle: [id + 'SetEnabled', !current?.registerProvider],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.registerProvider && current.hasApiKey && !current.providerRegistered && ['待注册', 'warn']] },
        { id: 'key', name: 'API Key', meta: host,
          tags: [[current?.hasApiKey ? '已配置' : '待配置', current?.hasApiKey ? 'success' : undefined]],
          form: { kind: 'key', call: [id + 'SetKey'] } },
        // 多模态能力工具（语音转写/合成/克隆、文档解析/抽取）：独立开关，
        // 与模型提供方互不影响；需要 Key 才能注册。
        ...(current?.toolsSupported ? [{
          id: 'tools', name: toolsLabel,
          meta: toolsMeta,
          enabled: current.hasApiKey ? current.toolsEnabled : undefined,
          toggle: [id + 'SetToolsEnabled', !current?.toolsEnabled],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.toolsEnabled && !current.toolsRegistered && ['待注册', 'warn']],
        }] : []),
        // 控制台会话：额度读取的凭据。浏览器登录自动收割，或粘贴 Cookie。
        ...(current && 'hasConsoleSession' in current ? [{
          id: 'console', name: '控制台会话',
          meta: signingIn ? '浏览器登录进行中，可取消；完成后自动保存' : '用于读取控制台额度（U Plan 积分 / 按量余额）',
          tags: [[current.hasConsoleSession ? '已配置' : '待配置', current.hasConsoleSession ? 'success' : undefined]],
          actions: signingIn ? [
            { label: '取消登录', call: [id + 'CancelConsoleLogin'] },
          ] : [
            { label: current.hasConsoleSession ? '重新登录' : '浏览器登录', call: [id + 'ConsoleLogin'], primary: !current.hasConsoleSession },
            ...(current.hasConsoleSession ? [{ label: '清除会话', call: [id + 'ClearConsole'], danger: true }] : []),
          ],
          form: { kind: 'console', call: [id + 'SetConsole'], disabled: signingIn },
        }] : []),
        ...(current?.rateLimit?.until > Date.now() ? [{ id: 'rate-limit', name: '限速提醒',
          meta: h(ApiKeyCooldown, { key: current.rateLimit.until, limit: current.rateLimit }) }] : []),
        ...apiQuotaRows(current?.quota, APIKEY_CONSOLES[id], id, usage),
        ...(usage && current?.quota?.status !== 'ready' && !(id === 'agnes' && isAgnesFreeQuota(current?.quota, usage)) ? [{ id: 'usage', name: '账户用量',
          meta: usage.error ? undefined : `已用 ${apikeyMoney(usage.used, usage.unit)}${usage.limit !== null ? ` / ${apikeyMoney(usage.limit, usage.unit)}` : ''}`,
          metric: !usage.error && Number.isFinite(usage.limit) && usage.limit > 0 && Number.isFinite(usage.used)
            ? percentMetric(remainingFraction(Math.max(0, usage.limit - usage.used), usage.limit)) : undefined,
          tags: [usage.error && ['读取失败', 'warn'], usage.unlimited && ['无限额度', 'info']] }] : []),
      ]
    },
  }
  return provider
}

function createApiKeyActions(provider, { getState, publish, mutate, request }) {
  const id = provider.id, title = provider.title
  const consoleLoginControllers = new Map()
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
      // 与宿主同口径：trim 后仍含空白（粘贴夹带的空格/换行/全角空格）的 Key 必然鉴权失败，
      // 本地先拒并给出可操作提示，不发请求也不存坏 Key。
      if (/\s/.test(apiKey.trim())) { publish({ notice: `${title} API Key 含空格或换行，请检查粘贴内容后重试。` }); return false }
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
    [id + 'SetToolsEnabled'](enabled) {
      return mutate('apikey.setToolsEnabled', { enabled: enabled === true }, {
        progress: enabled ? `正在启用 ${title} 能力工具…` : `正在关闭 ${title} 能力工具…`,
        message: enabled ? `${title} 能力工具已启用，对话中可直接调用。` : `${title} 能力工具已关闭。` })
    },
    [id + 'SetConsole'](cookie) {
      if (typeof cookie !== 'string' || !cookie.trim()) { publish({ notice: '请粘贴控制台 Cookie。' }); return Promise.resolve(false) }
      return mutate('apikey.setConsoleSession', { cookie }, { progress: '正在验证控制台会话…', message: `${title} 控制台会话已保存。` })
    },
    [id + 'ClearConsole']() {
      return mutate('apikey.clearConsoleSession', {}, { progress: '正在清除控制台会话…', message: `${title} 控制台会话已清除。` })
    },
    [id + 'ConsoleLogin']() {
      if (consoleLoginControllers.has(id)) return false
      const controller = new AbortController()
      consoleLoginControllers.set(id, controller)
      const options = {
        scope: `console-login:${id}`, controller, refresh: false,
        progress: `正在打开 ${title} 控制台登录…`,
        message: value => value?.signedIn === true ? `${title} 控制台会话已保存，额度将自动读取。` : `${title} 登录未完成，请重试。`,
        result(value) {
          if (value?.signedIn === true) {
            const state = getState(), current = state.apikeys?.[id]
            if (current) publish({ apikeys: { ...state.apikeys, [id]: { ...current, hasConsoleSession: true, consoleLoginUrl: '' } } })
          }
        },
      }
      const login = mutate('apikey.consoleLogin', {}, options)
      // 轮询快照拿登录地址（宿主 onUrl 写入），显示在控制台会话行；登录结束即停。
      // 与 managed 登录同款守卫：测试 VM 无 setTimeout 时跳过轮询（登录本身不受影响）。
      let polling = true
      const poll = async () => {
        if (!polling || getState().provider !== id) return
        try {
          const value = await request('apikey.snapshot', { provider: id }, controller.signal)
          const url = typeof value?.consoleLoginUrl === 'string' ? value.consoleLoginUrl : ''
          if (polling && url && getState().provider === id) {
            const state = getState(), current = state.apikeys?.[id]
            if (current) publish({ apikeys: { ...state.apikeys, [id]: { ...current, consoleLoginUrl: url } } })
          }
        } catch {}
        if (polling && typeof setTimeout === 'function') setTimeout(poll, 1000)
      }
      if (typeof setTimeout === 'function') setTimeout(poll, 800)
      return login.finally(() => {
        polling = false
        if (consoleLoginControllers.get(id) === controller) consoleLoginControllers.delete(id)
      })
    },
    [id + 'CancelConsoleLogin']() {
      const controller = consoleLoginControllers.get(id)
      if (!controller || controller.signal.aborted) return false
      controller.abort()
      return true
    },
  }
}

// ── src/client/providers/agnes.js ──
const agnes = apiKeyChannel({ id: 'agnes', title: 'Agnes', host: 'api.agnes-ai.cn', toolsLabel: '图像生成与编辑', toolsMeta: '' })

// ── src/client/providers/unisound.js ──
const unisound = apiKeyChannel({ id: 'unisound', title: '云知声', host: 'maas-api.unisound.com' })

// ── src/client/providers/astudio.js ──
const astudio = managedChannel({
  id: 'astudio',
  title: 'AStudio',
  // ⚠️ 已停用（2026-11-24）：上游无法回报正确积分——积分用尽后仍显示满值，
  // 用户以为还有额度却调不动。`card: false` 让卡片从设置页消失；声明保留，
  // 与后端 `lib/managed-providers/index.js` 的停用说明对应，恢复时一起改回。
  card: false,
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴 modelBearerToken（JWT）或 astron-session.json 内容',
  checkin: true,
  claimRewards: true,
})

// ── src/client/providers/codearts.js ──
const codearts = managedChannel({
  id: 'codearts',
  title: 'CodeArts',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkin: true,
})

// ── src/client/providers/index.js ──
const registeredProviders = [loomy, raccoon, raccoonPro, qodercn, trae, sensenova, workbuddy, agnes, unisound, astudio, codearts]
const PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.card !== false)
  .map(provider => provider.pack ? packSettings(provider) : provider))
const PACK_PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.pack))
const PLAN_PROVIDER_ID = sensenova.id
const RACCOON_FAMILY = Object.freeze(raccoon.family.map(side => side.id))
const isRaccoonFamily = id => RACCOON_FAMILY.includes(id)
const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? null
const modelProvidersOf = id => providerById(id)?.family?.map(side => side.id) ?? [id]

// ── src/client/context-pill.js ──
// 设置页和输入栏共用档位逻辑，外观与键盘交互沿用 OpenDesign CoRouter。
const CONTEXT_WINDOWS = Object.freeze([
  { label: '256K', tokens: 256_000, nativeMax: 262_144 },
  { label: '500K', tokens: 500_000, nativeMax: 524_288 },
  { label: '1M', tokens: 1_000_000, nativeMax: 1_048_576 },
])

function contextWindowTiers(capacity) {
  const known = modelTokenValue(capacity)
  const native = known && CONTEXT_WINDOWS.find(tier => capacity >= tier.tokens && capacity <= tier.nativeMax)
  // 最后一段永远是恢复渠道原值。原值处在标准档位时合并，避免「默认 1M / 1M」。
  return [
    ...CONTEXT_WINDOWS.slice(0, -1).filter(tier => known && capacity > tier.nativeMax),
    { label: native?.label ?? '默认', tokens: known ? capacity : null, restore: true },
  ]
}

function moveContextFocus(event) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button[data-tier]:not(:disabled)'))
  const index = buttons.indexOf(event.target)
  if (index < 0) return
  const last = buttons.length - 1
  const next = { ArrowRight: (index + 1) % buttons.length, ArrowDown: (index + 1) % buttons.length,
    ArrowLeft: (index + last) % buttons.length, ArrowUp: (index + last) % buttons.length, Home: 0, End: last }[event.key]
  if (typeof next !== 'number') return
  event.preventDefault()
  buttons[next].focus()
}

function ContextSegments({ capacity, override, reserve, disabled, busy, onChange }) {
  const tiers = contextWindowTiers(capacity)
  const custom = isCustomContext(override, tiers)
  const limitNote = modelTokenValue(reserve) && tiers.some(tier => modelTokenValue(tier.tokens) && tier.tokens <= reserve)
    ? `输出预留 ${formatTokens(reserve)}，部分档位需要更大的窗口` : undefined
  const segments = tiers.map(({ label, tokens, restore }) => {
    const selected = restore ? !modelTokenValue(override) || override === tokens : override === tokens
    const conflict = modelTokenValue(reserve) && modelTokenValue(tokens) && tokens <= reserve
    const description = restore ? (label === '默认' ? '默认上下文' : `默认上下文 ${label}`) : `上下文 ${label}`
    const writable = !selected || restore && modelTokenValue(override)
    return h('button', {
      key: label, type: 'button', className: 'eac-context-segment', 'aria-pressed': selected, 'data-tier': label,
      'aria-label': description, disabled: disabled || busy || conflict, 'aria-disabled': !writable || undefined,
      tabIndex: tiers.length === 1 && !writable ? -1 : undefined,
      title: conflict ? `输出预留 ${formatTokens(reserve)}，需要更大窗口`
        : tokens ? `${description} · ${tokens.toLocaleString('zh-CN')} tokens（输入与输出合计）` : description,
      onClick: event => { if (!disabled && !busy && !conflict && writable) onChange(restore ? null : tokens, event) },
    }, label)
  })
  return h('span', { className: 'eac-context-control' },
    h('span', { className: 'eac-context-caption' }, '上下文'),
    custom ? h('span', { className: 'eac-context-note', title: `${override.toLocaleString('zh-CN')} tokens` }, `自定义 ${formatTokens(override)}`) : null,
    h('span', { className: 'eac-context-tiers', role: 'group', 'aria-label': '上下文窗口',
      'aria-busy': busy || undefined, 'aria-description': limitNote, title: limitNote, onKeyDown: moveContextFocus }, ...segments))
}

function isCustomContext(override, tiers) {
  return modelTokenValue(override) && !tiers.some(tier => tier.tokens === override)
}

function ContextWindowField(props) {
  return h('div', { className: 'eac-param-group' }, ContextSegments(props))
}

// 会话快捷档位只读宿主快照，只写上下文，不覆盖同模型其它参数。
const CONTEXT_RPC = Object.freeze({
  pack: ['model.list', 'model.setParams'],
  plan: ['plan.snapshot', 'plan.setModelParams'],
  workbuddy: ['workbuddy.models', 'workbuddy.setModelParams'],
  apikey: ['apikey.snapshot', 'apikey.setModelParams'],
  managed: ['managed.models', 'managed.setModelParams'],
})

function pillKindFor(provider) {
  if (packAllowed(provider)) return 'pack'
  if (provider === PLAN_PROVIDER_ID) return 'plan'
  if (provider === WORKBUDDY_ID) return 'workbuddy'
  const methods = providerById(provider)?.snapshot?.methods
  if (methods?.includes('apikey.snapshot')) return 'apikey'
  if (methods?.includes('managed.snapshot')) return 'managed'
  return null
}

async function readContextPill(call, kind, provider, modelId, signal) {
  const [resource] = CONTEXT_RPC[kind]
  const [catalog, params] = await Promise.all([
    call(resource, { provider, snapshot: true }, signal),
    kind === 'pack' ? call('model.params', { provider }, signal) : null,
  ])
  if (catalog?.ok !== true || (kind === 'pack' && params?.ok !== true)) throw new Error('模型参数读取失败')
  if (kind === 'pack' && params.value?.contextQuickWrite !== true) return null
  const rows = catalog.value?.models
  if (!Array.isArray(rows)) throw new Error('模型目录待读取')
  const row = rows.find(entry => entry?.id === modelId)
  if (!row) return null
  const options = (kind === 'pack' ? params.value?.params?.[modelId] : row.params) ?? {}
  const declared = kind === 'pack' ? row.contextWindow : row.defaultContextWindow ?? row.contextWindow
  const capacity = modelTokenValue(declared) ? declared : null
  const reserve = options.maxTokens ?? row.defaultMaxOutputLength ?? row.defaultMaxTokens ?? row.maxOutputLength
  const override = modelTokenValue(options.contextWindow) ? options.contextWindow : null
  return { capacity, reserve: modelTokenValue(reserve) ? reserve : null, override }
}

function ContextTierControl({ call, kind, provider, modelId, selecting, directoryModels }) {
  const [view, setView] = React.useState(null)
  const [attempt, setAttempt] = React.useState(0)
  const [readError, setReadError] = React.useState(false)
  const [feedback, setFeedback] = React.useState(null)
  const [pending, setPending] = React.useState(undefined)
  const busy = pending !== undefined
  const writer = React.useRef(null)
  const section = React.useRef(null)
  const restoreFocus = React.useRef(null)
  React.useEffect(() => () => writer.current?.abort(), [])
  React.useEffect(() => {
    if (busy || selecting || !restoreFocus.current) return
    const target = restoreFocus.current
    restoreFocus.current = null
    const root = section.current
    const doc = root?.ownerDocument
    if (doc && (doc.activeElement === doc.body || root.contains(doc.activeElement))) target.focus()
  }, [busy, selecting])
  React.useEffect(() => {
    const operation = new AbortController()
    void readContextPill(call, kind, provider, modelId, operation.signal).then(next => {
      if (!operation.signal.aborted && !writer.current) { setView(next); setReadError(false) }
    }, () => { if (!operation.signal.aborted && !writer.current) setReadError(true) })
    return () => operation.abort()
  }, [call, kind, provider, modelId, attempt, directoryModels])

  const retry = () => { setReadError(false); setAttempt(n => n + 1) }

  const retryButton = readError ? h('button', { type: 'button', className: 'eac-context-retry', onClick: retry }, '重试读取模型信息') : null
  if (!view) return retryButton ? h('span', { className: 'eac-context-pill' }, retryButton) : null
  if (!view.capacity && view.override === null) return null
  const select = async (tokens, event) => {
    if (writer.current || busy || selecting || view.override === tokens) return
    const target = event?.currentTarget
    if (target && target.ownerDocument?.activeElement === target) restoreFocus.current = target
    const operation = new AbortController()
    writer.current = operation
    const { signal } = operation
    setPending(tokens)
    setFeedback(null)
    try {
      const result = await call(CONTEXT_RPC[kind][1], {
        provider, modelId, params: { contextWindow: tokens },
        ...(kind === 'pack' ? { contextOnly: true } : {}),
      }, signal)
      if (signal.aborted) return
      if (result?.ok !== true) throw new Error('模型参数保存失败')
      setView({ ...view, override: tokens })
      setFeedback({ text: '上下文设置已保存' })
    } catch {
      if (!signal.aborted) setFeedback({ error: true, text: '保存失败 · 可重试' })
    } finally {
      writer.current = null
      if (!signal.aborted) setPending(undefined)
    }
  }
  const error = feedback?.error === true
  const shown = busy ? pending : view.override
  const custom = isCustomContext(shown, contextWindowTiers(view.capacity))
  return h('span', { className: 'eac-context-pill', ref: section, 'data-disabled': busy || selecting,
    'data-error': error, 'data-error-message': error ? feedback.text : undefined,
    title: error ? feedback.text : custom ? `自定义 ${shown.toLocaleString('zh-CN')} tokens` : '此模型的上下文设置在会话间共享' },
    ContextSegments({ ...view, override: shown, busy, disabled: selecting, onChange: select }), retryButton,
    busy || feedback ? h('span', { className: 'eac-context-feedback', role: error ? 'alert' : 'status' },
      busy ? '正在保存上下文设置…' : feedback.text) : null)
}

function ContextTierPill({ directory, call, sessionId }) {
  const subscribe = React.useCallback(listener => directory.subscribe(listener), [directory])
  const getSnapshot = React.useCallback(() => directory.getSnapshot(), [directory])
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const provider = state?.current?.provider
  const modelId = state?.current?.model
  const kind = pillKindFor(provider)
  if (!kind || typeof modelId !== 'string' || !modelId) return null
  return h(ContextTierControl, {
    key: JSON.stringify([sessionId, provider, modelId]), call, kind, provider, modelId,
    selecting: state.status === 'selecting' || state.pending != null, directoryModels: state.groups,
  })
}

function registerContextPill(ctx) {
  if (typeof ctx.inject !== 'function') return
  const call = (method, payload, signal) => ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal)
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'unified-router-context-tier', order: 8,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, call, sessionId }),
    }, ContextTierPill)), 'unified-router: context tier pill')
  })
}

// ── src/client/store/quota.js ──
const quotaRoute = id => {
  const pool = isRaccoonFamily(id) ? 'raccoon' : id
  const provider = providerById(pool)
  if (!provider) return null
  const type = id === PLAN_PROVIDER_ID ? 'plan' : packAllowed(id) ? 'pack' : provider.rpcMethods === APIKEY_METHODS ? 'api' : id === 'workbuddy' ? 'buddy' : 'managed'
  return { provider: pool, type, title: id === 'raccoon-pro' ? raccoonPro.title : provider.title }
}

const quotaResources = {
  pack: ['account.list', 'credits.balances'], api: ['apikey.snapshot'],
  buddy: ['workbuddy.snapshot'], managed: ['managed.snapshot'], plan: ['plan.snapshot'],
}

// One poller per visible provider pool, shared by any mounted composer. The
// single-resource snapshot reads use the host cache and do not start collectors.
function createQuotaSnapshotStore(call, visible = globalThis.document, focus = globalThis.window) {
  const pools = new Map()
  return route => {
    if (pools.has(route.provider)) return pools.get(route.provider)
    let state = { loading: true, refreshing: false, failed: false, entries: [] }, running, timer
    const listeners = new Set()
    const publish = patch => { state = { ...state, ...patch }; for (const notify of listeners) notify() }
    const read = (manual = false) => {
      if (!listeners.size || running || visible?.hidden || visible?.visibilityState === 'hidden') return
      const controller = new AbortController()
      running = controller
      if (manual) publish({ refreshing: true })
      const timeout = setTimeout(() => controller.abort(), 8_000)
      // 小浣熊家族额外读自动化配置（统一模型开关决定药丸显示全部账号还是按套餐分侧）。
      // automation.status 是全局资源（键为 `automation/automation.status`），
      // 请求的 provider 必须是 'automation'，不能跟渠道走。
      const requested = (route.provider === 'codearts' ? [...quotaResources.managed, 'managed.models']
        : route.provider === 'raccoon' ? [...quotaResources[route.type], 'automation.status']
        : quotaResources[route.type]).map(resource =>
        [resource, resource === 'automation.status' ? 'automation' : route.provider])
      void Promise.all(requested.map(async resource => {
        const [resourceId, provider] = resource
        const reply = await call('settings.snapshot', { resource: resourceId, provider }, controller.signal)
        if (reply?.ok !== true) throw new Error('读取失败')
        return reply.value && typeof reply.value === 'object' ? reply.value : null
      })).then(entries => {
        if (running === controller && !controller.signal.aborted) publish({ loading: false, failed: false, entries })
      }, () => {
        if (running === controller) publish({ loading: false, failed: true })
      }).finally(() => {
        clearTimeout(timeout)
        if (running === controller) {
          running = null
          if (state.refreshing || controller.signal.aborted) publish({ refreshing: false,
            ...(controller.signal.aborted ? { loading: false, failed: true } : {}) })
        }
      })
    }
    const refresh = () => read()
    const store = {
      getSnapshot: () => state,
      refresh: () => read(true),
      subscribe(notify) {
        listeners.add(notify)
        if (listeners.size === 1) {
          visible?.addEventListener?.('visibilitychange', refresh)
          focus?.addEventListener?.('focus', refresh)
          timer = setInterval(refresh, 5_000)
          refresh()
        }
        return () => {
          listeners.delete(notify)
          if (listeners.size) return
          visible?.removeEventListener?.('visibilitychange', refresh)
          focus?.removeEventListener?.('focus', refresh)
          clearInterval(timer)
          const controller = running
          running = null
          controller?.abort()
          if (state.refreshing) publish({ refreshing: false })
        }
      },
    }
    pools.set(route.provider, store)
    return store
  }
}

const quotaPercent = fraction => `${fraction > 0 && fraction < 0.01 ? '<1' : Math.floor(fraction * 100 + 1e-9)}%`
const quotaValue = (value, unit) => `${displayNumber(value)}${unit ? ` ${unit}` : ''}`
function quotaWindow(window, provider) {
  const { limit, used, unit } = window
  const unitText = provider === 'workbuddy' ? displayCreditUnit(unit) : unit
  const remaining = windowRemainingAmount(window)
  const isAStudio = provider === 'astudio'
  const fraction = isAStudio ? null : (remainingFraction(remaining, limit) ?? (used === null ? null : Math.min(1, Math.max(0, 1 - used / 100))))
  const expiry = window.expiresAt || (isAStudio ? window.resetsAt : '') || window.runsOutAt
  return {
    label: window.name, fraction, primary: !isAStudio && !window.aside, meter: !isAStudio && Number.isFinite(fraction),
    value: isAStudio
      ? (remaining !== null ? quotaValue(remaining, unitText || '积分') : window.display || '')
      : (remaining !== null ? `${displayNumber(remaining)}${limit > 0 ? ` / ${quotaValue(limit, unitText)}` : unitText ? ` ${unitText}` : ''}`
        : fraction !== null ? quotaPercent(fraction) : window.display ? `已用 ${window.display}` : ''),
    reset: !isAStudio && provider !== 'codearts' ? window.resetsAt : '',
    cycleEnd: provider === 'codearts' ? window.resetsAt : '', expires: expiry,
    expiringAmount: expiry === window.runsOutAt && window.runsOut > 0 ? quotaValue(window.runsOut, unitText) : '',
  }
}

function quotaShortWindowLabel(label) {
  const tail = String(label || '').split(' · ').at(-1).trim()
  if (/^(?:周积分|周额度|每周请求数|本周)$/.test(tail)) return '周'
  if (/^7\s*天积分$/.test(tail)) return '7 天'
  if (/^5\s*小时(?:积分|\s*Credits|请求数)?$/i.test(tail)) return '5 小时'
  if (/^(?:月度\s*Credits|月额度|本月)$/i.test(tail)) return '月度'
  return tail.replace(/(?:积分|额度|请求数|\s*Credits)$/i, '').trim() || tail
}

function quotaAccountSummary(row) {
  const primaryMetrics = (row?.details ?? []).filter(item => item.primary !== false && Number.isFinite(item.fraction))
  const tight = primaryMetrics.length ? Math.min(...primaryMetrics.map(item => item.fraction)) : null
  const summary = tight !== null ? quotaPercent(tight) : Number.isFinite(row?.amount)
    ? row.money ? apikeyMoney(row.amount, 'CNY') : quotaValue(row.amount, row.unit)
    : row?.plan || ''
  const metrics = primaryMetrics.slice(0, 3)
  const windowSummary = metrics.length > 1
    ? metrics.map(item => `${quotaShortWindowLabel(item.label)} ${quotaPercent(item.fraction)}`).join(' · ')
    : ''
  const tone = tight ?? (Number.isFinite(row?.toneFraction) ? row.toneFraction : null)
  return { tight, tone, summary, windowSummary, metrics }
}

function quotaPillData(id, type, snapshot, selection, viewedId, model) {
  const [first, second] = snapshot.entries
  let rows = [], empty = ''
  // 统一模型模式下小浣熊药丸展示全部账号（服务账号可能是任意套餐）；
  // 订阅面（raccoon-pro）只服务旧会话，保持按套餐过滤。
  const unified = id === 'raccoon' && snapshot.entries[2]?.value?.config?.raccoonUnifiedModels === true
  if (type === 'pack') {
    const balances = new Map(balancesFrom(second?.value).map(row => [row.accountId, row]))
    rows = accountsFrom(first?.value, isRaccoonFamily(id) ? 'raccoon' : id)
      .filter(account => account.enabled && (!isRaccoonFamily(id) || unified || (account.plan === 'pro') === (id === 'raccoon-pro')))
      .map(account => {
        const bal = balances.get(account.id)
        const packages = bal?.packages ?? []
        const shownPackages = displayCreditPackages(packages)
        return { id: account.id, label: account.nickname, at: bal?.updatedAt, stale: bal?.stale,
          plan: account.plan === 'free' ? '免费' : account.plan === 'pro' ? '订阅' : '',
          amount: bal?.total ?? null, unit: '积分', packages, details: shownPackages.map(pkg => ({
            label: pkg.name || '额度包', value: pkg.remaining === null ? '' : quotaValue(pkg.remaining, pkg.unit),
            expires: pkg.active === false ? null : pkg.expiresAt, note: pkg.active === false ? '已失效' : '',
          })) }
      })
  } else if (type === 'plan') {
    const quota = first?.value?.quota
    const pools = senseNovaQuotaPools(quota, model)
    const details = pools.flatMap((pool, poolIndex) => senseNovaQuotaDetails(pool).map(detail => pools.length === 1 ? detail : {
      ...detail, label: `${pool.name || '积分池'} · ${detail.label}`, ...(poolIndex > 0 ? { primary: false } : {}),
    }))
    if (details.length) rows = [{ id, label: pools.length === 1 ? pools[0].name || '积分池' : '积分池', plan: quota.plan,
      at: quota.updatedAt, amount: null, details }]
    else empty = senseNovaQuotaStatus[quota?.status] || (quota?.status === 'ready' && !pools.length ? '当前模型没有匹配的积分池' : '')
  } else if (type === 'api') {
    const quota = projectApiKeyQuota(first?.value?.quota)
    const balance = apikeyBalanceFrom(first?.value?.balance)
    if (id === 'agnes' && isAgnesFreeQuota(quota, balance)) {
      rows = [{
        id, label: '账户状态', plan: '免费用户', amount: null,
        at: quota?.updatedAt ?? balance?.updatedAt ?? first?.value?.updatedAt ?? null,
        details: [{ label: '账户类型', value: '免费用户', note: '额度读取为 0', fraction: null, primary: false, meter: false }],
      }]
    } else if (quota?.status === 'ready') {
      rows = [{ id, label: '控制台额度', amount: quota.balance, money: true, at: quota.updatedAt,
        details: [
          ...quota.windows.map(row => ({ label: apiQuotaLabels[row.id], fraction: remainingFraction(row.remaining, row.limit),
              note: apiQuotaResetHint(row, quota.updatedAt),
              primary: id !== 'agnes' || !row.id.endsWith('-requests') || !quota.windows.some(item => item.id.endsWith('-credits') && item.limit > 0),
              value: row.remaining === null ? `已用 ${displayNumber(row.used)}` : `${displayNumber(row.remaining)}${row.limit > 0 ? ` / ${displayNumber(row.limit)}` : ''}` })),
          ...(quota.gifts ?? []).filter(row => row.modelId === model).map(row => ({ label: '模型赠送额度', primary: false,
            value: row.remaining === null ? `已用 ${quotaValue(row.used, row.unit)}` : quotaValue(row.remaining, row.unit) })),
        ] }]
    } else if (id === 'agnes' && balance && !balance.error) {
      const fraction = Number.isFinite(balance.limit) && balance.limit > 0 && Number.isFinite(balance.used)
        ? remainingFraction(Math.max(0, balance.limit - balance.used), balance.limit) : null
      rows = [{
        id, label: '账户用量', plan: balance.unlimited ? '无限额度' : '', amount: null,
        at: balance.updatedAt ?? first?.value?.updatedAt ?? null,
        details: [{
          label: '已用额度', fraction, primary: fraction !== null, meter: fraction !== null,
          value: `${apikeyMoney(balance.used, balance.unit)}${balance.limit !== null ? ` / ${apikeyMoney(balance.limit, balance.unit)}` : ''}`,
        }],
      }]
    } else empty = { 'needs-console': '未配置控制台会话', expired: '控制台会话已过期', error: '读取失败' }[quota?.status] ?? ''
  } else {
    const project = type === 'buddy' ? workbuddyAccountFrom : managedAccountFrom
    const raw = Array.isArray(first?.value?.accounts) ? first.value.accounts : []
    const catalog = snapshot.entries[1]?.value?.models
    const codeartsModel = id === 'codearts' && Array.isArray(catalog) ? catalog.find(row => row?.id === model) : null
    const codeartsUnknown = id === 'codearts' && model && typeof codeartsModel?.free !== 'boolean'
    rows = raw.slice(0, 8).map(project).filter(account => account?.signedIn && account.enabled !== false).map(account => {
      const windows = (codeartsUnknown ? [] : account.windows).filter(window => !model || (!window.models.length || window.models.includes(model)) && !window.notModels.includes(model))
        .filter(window => !codeartsModel || (window.name === '免费日额度') === (codeartsModel.free === true))
      const details = windows.map(window => quotaWindow(window, id))
      const wbCredits = type === 'buddy' ? workbuddyAccountCredits(windows) : null
      if (id === 'astudio' || wbCredits) for (const detail of details) detail.primary = false
      if (id === 'codearts' && codeartsModel && !codeartsModel.free) {
        for (const detail of details) detail.primary = detail.label === '总积分包'
      }
      const pkgBalances = windows.map(windowRemainingAmount).filter(value => Number.isFinite(value))
      const derivedAmount = wbCredits?.amount ?? account.balance ?? (id === 'astudio' && pkgBalances.length ? pkgBalances.reduce((a, b) => a + b, 0) : null)
      return { id: account.id, label: account.name, plan: account.plan,
        amount: codeartsUnknown || codeartsModel?.free ? null : derivedAmount,
        toneFraction: wbCredits?.fraction ?? null,
        packages: id === 'astudio' ? windows : (wbCredits?.packages ?? []),
        unit: wbCredits?.unit || account.unit || '积分', at: account.updatedAt, stale: Boolean(account.error), details }
    })
  }
  const serving = type !== 'api' && selection?.accountId ? rows.find(row => row.id === selection.accountId) ?? null : null
  const primary = serving ?? (rows.length === 1 ? rows[0] : null)
  const viewed = rows.find(row => row.id === viewedId) ?? serving ?? rows[0] ?? null
  const accountMetrics = new Map(rows.map(row => [row, quotaAccountSummary(row)]))
  const isCreditPool = type === 'pack' || id === 'astudio' || (type === 'buddy' && rows.some(row => Number.isFinite(row.amount)))
  const pool = isCreditPool ? summarizePoolCredits(rows, id) : null
  const showPoolTrigger = !serving && pool?.known && (rows.length > 1 || (type === 'pack' && pool.hasPackages))
  const showPoolPopover = !serving && pool?.known && (rows.length > 1 || (isCreditPool && pool.hasPackages))
  const pill = showPoolTrigger
    ? { summary: quotaValue(pool.total, pool.unit), windowSummary: '', tight: null, tone: null, metrics: [] }
    : (accountMetrics.get(primary) ?? { summary: rows.length > 1 ? `${rows.length} 个账号` : '', windowSummary: '', tight: null, tone: null, metrics: [] })
  const staleOf = row => !!(snapshot.failed || (type === 'pack' ? second?.stale : first?.stale) || (row ? row.stale : rows.some(item => item.stale)))
  const at = Number.isFinite(viewed?.at) && viewed.at > 0 && viewed.at <= Date.now() ? viewed.at : null
  return { rows, serving, viewed, pool, showPool: showPoolPopover, accountMetrics, ...pill, at,
    stale: staleOf(primary), detailStale: staleOf(viewed),
    empty: empty || (snapshot.loading ? '读取中…' : snapshot.failed || first?.stale || second?.stale ? '读取失败' : '暂无额度数据') }
}

// ── src/client/quota-pill.js ──
function QuotaDetail({ detail }) {
  return h('div', { className: 'eac-quota-detail' },
    h('span', null, detail.label), h('strong', null, detail.value || '—'),
    detail.meter !== false && Number.isFinite(detail.fraction)
      ? quotaMeter(`${detail.label}剩余比例`, detail.fraction, 'eac-quota-track', quotaTone(detail.fraction)) : null,
    detail.note ? h('small', null, detail.note) : null,
    [[detail.reset, '重置'], [detail.expires, '到期'], [detail.cycleEnd, '周期结束']].map(([when, text]) =>
      displayTime(when) !== '—' ? h('small', { key: text }, `${text} ${displayTime(when)}${text === '到期' && detail.expiringAmount ? ` · ${detail.expiringAmount}` : ''}`) : null))
}

const quotaMeter = (label, value, className, tone) => h('progress', { max: 1, value, className, 'aria-label': label, 'data-tone': tone })
const quotaTone = fraction => fraction === null ? 'neutral' : fraction === 0 ? 'danger' : fraction <= .2 ? 'warn' : 'success'
const quotaAmountText = row => row.money ? apikeyMoney(row.amount, 'CNY') : quotaValue(row.amount, row.unit)

// 收起态迷你余量条（与 dsh-subusage 药丸同款）：一个窗口一根，
// 各按该窗口自身档位着色；根数越多条越细。窗口名与枚举进悬浮提示。
function quotaMiniBars(metrics) {
  return h('span', { className: 'eac-quota-mini', 'data-count': String(metrics.length), 'aria-hidden': true },
    metrics.map((metric, i) => {
      const value = Math.max(0, Math.min(1, metric.fraction))
      return h('span', { key: i, className: 'eac-quota-bar', 'data-tone': quotaTone(metric.fraction) },
        h('span', { className: 'eac-quota-bar-fill', style: { width: `${Math.round(value * 1000) / 10}%`, minWidth: value > 0 ? 3 : 0 } }))
    }))
}

function QuotaAccount({ row, titled, badge, stale }) {
  const planBadge = badge || row.plan
  return h('section', { className: 'eac-quota-account' },
    titled ? h('header', null, h('strong', null, row.label), planBadge ? h('span', { className: 'eac-quota-plan' }, planBadge) : null) : null,
    h('div', { className: 'eac-quota-group', 'aria-label': '额度明细' },
      row.amount !== null ? QuotaDetail({ detail: { label: row.money ? '控制台余额' : '剩余额度', value: quotaAmountText(row) } }) : null,
      row.details.map((detail, i) => h(QuotaDetail, { key: i, detail })),
      row.amount === null && !row.details.length ? h('span', { className: 'eac-quota-status' }, stale ? '额度读取失败' : '暂无适用额度数据') : null))
}

function QuotaAccountList({ rows, accountMetrics, activeId, viewedId, onView }) {
  return h('div', { className: 'eac-quota-account-list', role: 'group', 'aria-label': '账号明细' },
    rows.map(row => {
      const { summary, windowSummary, tight, tone } = accountMetrics.get(row)
      const pressed = activeId === row.id
      return h('button', { key: row.id, type: 'button', className: 'eac-quota-account-row', 'aria-pressed': pressed,
        'data-tone': row.stale ? 'neutral' : quotaTone(tone ?? tight), title: [row.label, windowSummary].filter(Boolean).join(' · '),
        onClick: () => onView(row.id === viewedId ? '' : row.id) },
        h('span', null, row.label), h('strong', null, summary || '暂无额度'))
    }))
}

function QuotaPill({ provider, route, store, sessionId, model, call }) {
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panelId = `eac-quota-${React.useId()}`
  const [open, setOpen] = React.useState(false)
  const [selection, setSelection] = React.useState(null)
  const [viewedId, setViewedId] = React.useState('')
  const [refreshVersion, refreshRoute] = React.useState(0)
  React.useEffect(() => {
    if (!sessionId || !model || !call || route.type === 'api' || route.type === 'plan') return
    let running = null, alive = true
    const read = async () => {
      if (!alive || running || globalThis.document?.hidden) return
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), 8_000)
      running = controller
      try {
        const reply = await call('quota.account', { provider, model, sessionId }, controller.signal)
        if (alive) setSelection(!controller.signal.aborted && reply?.ok === true && typeof reply.value?.accountId === 'string' ? reply.value : null)
      } catch { if (alive) setSelection(null) }
      finally { clearTimeout(deadline); running = null }
    }
    const timer = setInterval(read, 5_000)
    globalThis.document?.addEventListener?.('visibilitychange', read)
    void read()
    return () => { alive = false; clearInterval(timer); running?.abort(); globalThis.document?.removeEventListener?.('visibilitychange', read) }
  }, [sessionId, provider, model, call, route.type, refreshVersion, open])
  const { rows, serving, viewed, pool, showPool, accountMetrics, summary, windowSummary, tight, tone: pillTone, metrics, at, stale, detailStale, empty } = quotaPillData(provider, route.type, snapshot, selection, viewedId, model)
  const tone = quotaTone(pillTone ?? tight)
  const detailMetric = accountMetrics.get(viewed)
  const detailTone = quotaTone(detailMetric?.tone ?? detailMetric?.tight ?? null)
  const headline = viewed && detailStale && (viewed.amount !== null || viewed.details.length) ? '显示上次结果' : ''
  const label = summary || '额度'
  const tip = [route.title, label, serving?.label,
    metrics.length === 1 ? metrics[0]?.label : windowSummary,
    showPool && pool?.hasPackages ? pool.splitText : '',
    stale && summary ? '额度数据有更新延迟' : ''].filter(Boolean).join(' · ')
  const other = serving ? rows.filter(row => row !== serving) : rows
  const activeId = viewed?.id ?? ''
  const list = rows.length > 1 ? QuotaAccountList({ rows: other, accountMetrics, activeId, viewedId, onView: setViewedId }) : null
  const viewedBadge = !serving && viewed
    ? [viewedId && viewedId !== rows[0]?.id ? '查看中' : rows.length > 1 ? '当前账号' : '', viewed.plan].filter(Boolean).join(' · ')
    : viewed?.plan
  return h('span', { className: 'eac-quota-pill', 'data-tone': tone },
    h('button', { className: 'eac-quota-trigger', type: 'button', popoverTarget: panelId,
      'aria-label': tip, 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': panelId,
      'data-stale': !!summary && stale, title: tip },
    metrics.length ? quotaMiniBars(metrics) : null,
    h('span', { className: 'eac-quota-trigger-text' }, label)),
    h('div', { className: 'eac-quota-popover', id: panelId, popover: 'auto', role: 'dialog', 'aria-label': `${route.title}额度详情`, 'data-tone': detailTone,
      onToggle: event => {
        const next = event.nativeEvent?.newState === 'open' || event.currentTarget.matches(':popover-open')
        setOpen(next)
        if (!next) setViewedId('')
      } },
      h('header', { className: 'eac-quota-header' },
        h('strong', null, route.title), viewed?.plan && viewed === serving ? h('span', { className: 'eac-quota-plan' }, viewed.plan) : null),
      serving ? QuotaDetail({ detail: {
        label: selection?.live === true ? '当前调用账号' : '最近调用账号', value: serving.label,
      } }) : null,
      showPool ? h('section', { className: 'eac-quota-account' },
        h('header', null, h('strong', null, '账号池总积分'), rows.length > 1 ? h('span', { className: 'eac-quota-plan' }, `${rows.length} 个账号`) : null),
        h('div', { className: 'eac-quota-group', 'aria-label': '账号池总积分明细' },
          QuotaDetail({ detail: { label: '总积分', value: quotaValue(pool.total, pool.unit) } }),
          pool.hasPackages ? QuotaDetail({ detail: { label: '临时额度', value: quotaValue(pool.temporary, pool.unit) } }) : null,
          pool.hasPackages ? QuotaDetail({ detail: { label: '永久额度', value: quotaValue(pool.permanent, pool.unit) } }) : null)) : null,
      headline ? h('p', { className: 'eac-quota-status', 'data-stale': detailStale || !viewed, role: 'status' }, headline) : null,
       viewed ? h(QuotaAccount, { row: viewed, titled: viewed !== serving && route.type !== 'api', badge: viewedBadge, stale: detailStale })
        : !rows.length ? h('p', { className: 'eac-quota-status', role: 'status' }, empty) : null,
      serving && list ? h('details', { className: 'eac-quota-others', key: serving.id },
        h('summary', null, `其他账号 · ${other.length}`), list) : list,
      h('footer', { className: 'eac-quota-footer' },
        h('span', null, at ? `更新于 ${displayTime(at)}` : ''),
        h('button', { type: 'button', className: 'eac-button', onClick: () => { store.refresh(); refreshRoute(v => v + 1) }, disabled: snapshot.loading || snapshot.refreshing },
           snapshot.refreshing ? '读取中…' : snapshot.failed ? '重试' : '重新读取'))))
}

function QuotaPillEntry({ directory, storeFor, sessionId, call }) {
  const subscribe = React.useCallback(notify => directory.subscribe(notify), [directory])
  const read = React.useCallback(() => directory.getSnapshot(), [directory])
  const state = React.useSyncExternalStore(subscribe, read, read)
  const provider = state?.current?.provider
  const model = state?.current?.model
  const route = model ? quotaRoute(provider) : null
  return route ? h(QuotaPill, { key: `${sessionId}:${provider}:${model}`, sessionId, model, call, provider, route, store: storeFor(route) }) : null
}

function registerQuotaPill(ctx) {
  if (typeof ctx.inject !== 'function') return
  const call = (method, payload, signal) => ctx.connection.rpc.call('/api', 'unified-router', { method, payload }, signal)
  const storeFor = createQuotaSnapshotStore(call)
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'unified-router-quota', order: 1001,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, storeFor, sessionId, call }),
    }, QuotaPillEntry)), 'unified-router: quota pill')
  })
}

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
  React.useEffect(() => { if (typeof ctx.effect !== 'function') return installStyles() }, [ctx])
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
        return h('button', { key: item.id, id: `eac-provider-${item.id}`, type: 'button', role: 'tab', className: 'eac-provider',
          'aria-selected': selected, tabIndex: selected ? 0 : -1, 'aria-label': `切换到 ${item.title}`, 'aria-controls': 'eac-provider-workspace',
          onClick: () => { if (!selected) selectProvider(item.id) },
          onKeyDown: event => tabKeys(event, index, PROVIDERS.map(value => value.id), id => { if (id !== state.provider) selectProvider(id) }) },
          h('span', { className: 'eac-provider-name' }, item.title),
          h('span', { className: 'eac-provider-meta' },
            h('span', { className: 'eac-provider-dot', 'data-tone': toneFor(value) }),
            value ? value.cardMeta ?? (value.closed ? '已关闭' : `${value.totalAccounts ?? value.accounts ?? '—'} 账号 · ${value.models ?? '—'} 模型`) : '待读取'))
      })),
    h('div', { className: 'eac-workspace', 'data-panel': panel, role: 'tabpanel', id: 'eac-provider-workspace', 'aria-labelledby': `eac-provider-${state.provider}` },
      h('header', { className: 'eac-header' },
        h('h2', { className: 'eac-title' }, provider.title),
        h('div', { className: 'eac-header-actions' },
          h('span', { className: 'eac-status-chip', 'data-tone': toneFor(status) }, statusLabel),
          panel === 'models' ? null : button('刷新', () => act('refreshSettings'), state.busy, {
            'aria-label': provider.panelIds ? '刷新渠道与用量' : '刷新账号与额度' }))),
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
  if (typeof ctx.effect === 'function') ctx.effect(installStyles, 'unified-router: styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'unified-router', order: 23, label: 'Unified Router', inject: () => ({ ctx }) }, Settings))
  registerContextPill(ctx)
  registerQuotaPill(ctx)
}
  return { name: 'dsh-unified-router', inject: ['slots', 'connection'], apply, createRouterStore, safeLoginUrl, filterModels, claimMessage }
  },
})
