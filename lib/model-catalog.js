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

export function defaultModelEffort(efforts, declared, preferred = 'medium') {
  if (efforts.includes(declared)) return declared
  if (efforts.includes(preferred)) return preferred
  return efforts.find(effort => effort !== 'off') ?? efforts[0]
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
  doubaowork: {
    'seed-lite-7b': 'seed-2-1-lite',
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
const namedSuccessors = new Map([
  ['kimi-k2-8-preview', 'kimi-k3-1-pro'], ['kimi-k3', 'kimi-k3-1-pro'], ['minimax-m3', 'minimax-m3-1-flash'],
  ['deepseek-v4-flash', 'deepseek-v4-1-flash-1017'],
  ['deepseek-v4-1-flash', 'deepseek-v4-1-flash-1017'],
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
  const result = new Map()
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => b.version - a.version || Number(a.preview) - Number(b.preview)
      || (b.release ?? '').localeCompare(a.release ?? ''))
    for (const item of sorted) {
      const newer = sorted.find(candidate => !candidate.stale && (item.preview || !candidate.preview)
        && (candidate.version > item.version || candidate.version === item.version
          && (item.preview && !candidate.preview || candidate.release?.length === item.release?.length
            && candidate.release > item.release)))
      const baseTarget = namedSuccessors.get(item.baseName)
      const replacement = newer?.id
        ?? byName.get(namedSuccessors.get(item.name))
        ?? (baseTarget && baseTarget !== item.name ? byName.get(baseTarget) : undefined)
      if (replacement && replacement !== item.id) result.set(item.id, replacement)
    }
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
  for (const model of models) {
    if (model.dead) continue
    if (older.has(model.id) || model.stale) {
      exclusions.set(model.id, { kind: 'older', alternative: older.get(model.id) })
      continue
    }
    const rate = modelMultiplier(model)
    const context = Object.hasOwn(model, 'context') ? model.context : model.defaultContextWindow ?? model.contextWindow
    const identity = catalogIdentity(model.id, provider)
    const baseIdentity = stripReleaseSuffix(identity)
    if (rate !== undefined) candidates.push({
      id: model.id, identity, baseIdentity, rate, context,
      image: Object.hasOwn(model, 'attachment') ? model.attachment : model.defaultVision ?? model.supportsImage,
    })
  }
  candidates.sort((a, b) => a.rate - b.rate)
  for (const item of candidates) {
    if (item.rate === 0) continue
    const alternatives = codingAlternatives.get(item.identity) ?? codingAlternatives.get(item.baseIdentity)
    if (!alternatives) continue
    const better = candidates.find(other => (alternatives.includes(other.identity) || alternatives.includes(other.baseIdentity))
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

export function officialModelSpec(id, provider) {
  const key = canonicalSpecKey(id, provider)
  return key ? OFFICIAL_MODEL_SPECS[key] : null
}

export function channelOutputHardCap(provider) {
  return typeof provider === 'string' && Object.hasOwn(CHANNEL_OUTPUT_HARD_CAPS, provider)
    ? CHANNEL_OUTPUT_HARD_CAPS[provider]
    : null
}
