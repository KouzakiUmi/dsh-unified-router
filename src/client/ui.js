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
export const CONTEXT_TIERS = Object.freeze([
  { tokens: 200_000, label: '200K', min: 192_000, max: 210_000 },
  { tokens: 400_000, label: '400K', min: 390_000, max: 420_000 },
  { tokens: 500_000, label: '500K', min: 480_000, max: 530_000 },
  { tokens: 1_000_000, label: '1M', min: 950_000, max: 1_100_000 },
])
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
// - Loomy/Qoder 是 none..max 的强度档；
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
export function defaultParamSummary(model) {
  const parts = []
  if (model.contextWindow > 0) parts.push(`上下文 ${formatTokens(model.contextWindow)}`)
  if (model.defaultMaxTokens > 0) parts.push(`输出 ${formatTokens(model.defaultMaxTokens)}`)
  if (model.efforts.includes(model.defaultEffort)) parts.push(`思考 ${EFFORT_LABELS[model.defaultEffort] || model.defaultEffort}`)
  if (model.supportsImage === true) parts.push('支持图片')
  if (model.supportsImage === false) parts.push('仅文本输入')
  return parts.join(' · ')
}
export function currentModelSummary(model) {
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
export function outputTiersForModel(model, providerId) {
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

export function contextTiersForModel(model, providerId) {
  const provider = providerId || model?.provider || ''
  const spec = officialModelSpec(model?.id, provider)
  const declared = model?.contextWindow ?? model?.defaultContextWindow ?? 0
  const ceiling = declared > 0 ? declared : (spec?.context ?? 0)
  return tiersUnder(CONTEXT_TIERS, ceiling, false)
}

export function ModelParams({ value, model, providerId, disabled, onSave }) {
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
    const submission = onSave(apiKey)
    setApiKey('')
    await submission
  } },
    h('label', { className: 'eac-field' }, h('span', null, 'API Key'), h('input', { className: 'eac-input', type: 'password', autoComplete: 'off', required: true, disabled, value: apiKey, onChange: e => setApiKey(e.target.value) })),
    h('div', { className: 'eac-form-actions' }, primary('保存 API Key', undefined, disabled, { type: 'submit' })))
}
export function CredentialImportForm({ disabled, hint, onSave, onCancel }) {
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
export function PlanModelParams({ model, providerId, disabled, value, setValue, onSave }) {
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
