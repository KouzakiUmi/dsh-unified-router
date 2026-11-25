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

export function readableModelName(id, name) {
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

export function defaultModelOutputTokens(output, context) {
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
export function channelOutputBudget(configured, context) {
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
 * 为什么不允许默认落到 off/low/minimal：有渠道远端把 `low` 声明成默认、
 * Agnes 上游默认不思考、Raccoon 托管档位缺省时旧实现取最低思考档 —— 用户
 * 看到的现象都是「档位设置无效、模型不思考 / 想得太浅」。默认档必须落在
 * 中/高档，把「关掉思考」留给用户显式选择。
 * @param {readonly string[]} efforts - 该模型可选的档位 id（私有名或规范名）。
 * @param {string | undefined} declared - 上游/兜底/设置的声明默认档。
 * @param {string} [preferred] - 声明值不可用时优先尝试的档位（缺省 medium）。
 * @returns {string | undefined} 受支持的非空档位；没有可用档位时省略。
 */
export function defaultModelEffort(efforts, declared, preferred = 'medium') {
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
export function effectiveModelEffort(efforts, saved, fallback) {
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

export function modelSuccessors(models, provider) {
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
export function modelRecommendationExclusions(models, provider) {
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

export function officialModelSpec(id, provider) {
  const key = canonicalSpecKey(id, provider)
  return key ? OFFICIAL_MODEL_SPECS[key] : null
}

export function channelOutputHardCap(provider) {
  return typeof provider === 'string' && Object.hasOwn(CHANNEL_OUTPUT_HARD_CAPS, provider)
    ? CHANNEL_OUTPUT_HARD_CAPS[provider]
    : null
}
