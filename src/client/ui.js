// UI 原语与表单组件。
// 原语（button/primary/danger/tag/avatarText）是普通函数调用而不是组件元素，
// 测试按 props 断言；表单（AccountForm/ModelParams 等）是 React 组件，自带 Hook。

export const button = (label, onClick, disabled, props = {}) => h('button', {
  ...props, type: props.type || 'button', onClick, disabled,
  className: `eac-button${props.className ? ` ${props.className}` : ''}`,
}, label)
export const primary = (label, onClick, disabled, props = {}) => button(label, onClick, disabled, { ...props, className: `is-primary${props.className ? ` ${props.className}` : ''}` })
export const danger = (label, onClick, disabled, props = {}) => button(label, onClick, disabled, { ...props, className: `is-danger${props.className ? ` ${props.className}` : ''}` })
export const avatarText = name => { const first = Array.from(name || '?')[0] || '?'; return first.toUpperCase() }
export const tag = (label, tone, title) => h('span', { key: label, className: 'eac-tag', 'data-tone': tone || undefined, title }, label)
// 参数摘要：只显示真正设过的项，没设过就不占位置。
export function paramSummary(value) {
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
export const OUTPUT_TIERS = Object.freeze([
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
// - Qoder 是 none..max 的强度档；
// - TRAE 是 light / high / extra_high；
// - Raccoon 老模型是 on/off 两态（见 raccoonThinkingExtraBody）；
// - Raccoon 新目录用托管档位 level_1..level_5（名字与
//   `raccoon-product.ts` 的 RACCOON_THINKING_LEVEL_NAMES 保持一致，两处都要有）。
export const EFFORT_LABELS = Object.freeze({
  none: '不思考', minimal: '极少', light: '轻', low: '低', medium: '中', high: '高', extra_high: '极高', xhigh: '极高', max: '最大',
  on: '开启', off: '关闭',
  level_1: '极少', level_2: '低', level_3: '中', level_4: '高', level_5: '最大',
})
export function formatTokens(n) {
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
export function tiersUnder(all, ceiling, allowUnknown = false) {
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
export function defaultParamSummary(model, outputLabel = '输出') {
  const parts = []
  if (model.contextWindow > 0) parts.push(`上下文 ${formatTokens(model.contextWindow)}`)
  if (model.defaultMaxTokens > 0) parts.push(`${outputLabel} ${formatTokens(model.defaultMaxTokens)}`)
  if (model.efforts.includes(model.defaultEffort)) parts.push(`思考 ${EFFORT_LABELS[model.defaultEffort] || model.defaultEffort}`)
  if (model.supportsImage === true) parts.push('支持图片')
  if (model.supportsImage === false) parts.push('仅文本输入')
  return parts.join(' · ')
}
export function baseModelSummary(model, outputLabel) {
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

export function outputTiersForModel(model, providerId) {
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

export function ModelParams({ value, model, providerId, disabled, onSave }) {
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
export function AccountForm({ account, disabled, save }) {
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
export function displayNumber(value) {
  if (typeof value === 'string') return value
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}
export function displayTime(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export function remainingFraction(remaining, limit) {
  return typeof remaining === 'number' && limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : null
}
export function PlanKeyForm({ disabled, onSave }) {
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
export function ConsoleCookieForm({ disabled, onSave }) {
  const [cookie, setCookie] = React.useState('')
  return h('form', { className: 'eac-account-form', onSubmit: async event => {
    event.preventDefault()
    const saved = await onSave(cookie)
    if (saved) setCookie('')
  } },
    h('label', { className: 'eac-field' }, h('span', null, '控制台 Cookie'), h('input', { className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled, placeholder: '从浏览器开发者工具复制 maas.unisound.com 的 Cookie', value: cookie, onChange: e => setCookie(e.target.value) })),
    h('div', { className: 'eac-form-actions' }, primary('保存会话', undefined, disabled, { type: 'submit' })))
}
export function CredentialImportForm({ disabled, hint, onSave, onCancel }) {
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
export function PlanModelParams({ model, providerId, disabled, value, setValue, onSave }) {
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
