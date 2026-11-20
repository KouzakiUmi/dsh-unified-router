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
// 官方 Qoder 客户端的上下文窗口就是固定三档（截图核实）：200K / 400K / 1M。
export const CONTEXT_TIERS = Object.freeze([
  { tokens: 200_000, label: '200K' },
  { tokens: 400_000, label: '400K' },
  { tokens: 1_000_000, label: '1M' },
])
export const OUTPUT_TIERS = Object.freeze([
  { tokens: 65536, label: '64K' },
  { tokens: 131072, label: '128K' },
  { tokens: 262144, label: '256K' },
  { tokens: 393216, label: '384K' },
])
// 各渠道的档位取值并不统一，这里必须全部认：
// - Loomy/Qoder 是 none..max 的强度档；
// - Raccoon 老模型是 on/off 两态（见 raccoonThinkingExtraBody）；
// - Raccoon 新目录用托管档位 level_1..level_5（名字与
//   `raccoon-product.ts` 的 RACCOON_THINKING_LEVEL_NAMES 保持一致，两处都要有）。
export const EFFORT_LABELS = Object.freeze({
  none: '不思考', minimal: '极少', light: '轻', low: '低', medium: '中', high: '高', extra_high: '极高', xhigh: '极高', max: '最大',
  on: '开启', off: '关闭',
  level_1: '极少', level_2: '低', level_3: '中', level_4: '高', level_5: '最大',
})
export function formatTokens(n) {
  const standard = CONTEXT_TIERS.find(tier => tier.tokens === n)
  if (standard) return standard.label
  if (n >= 1048576) return `${Math.round(n / 1048576 * 10) / 10}M`
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`
  return Number(n).toLocaleString('en-US')
}
/**
 * 只保留不超过上限的档位。
 *
 * 上限未知时**不返回空**：很多渠道（如 Loomy）上游根本不报输出上限，
 * 这时给全部标准档位让用户自己挑——这正是「拉不到就手动设」的用途，
 * 空着一组反而让用户无从设置。
 */
export function tiersUnder(all, ceiling, allowUnknown = false) {
  if (typeof ceiling !== 'number' || ceiling <= 0) return allowUnknown ? all : []
  const fitting = all.filter(t => t.tokens <= ceiling)
  // 标准档位一个都放不下时（例如上限 63999），直接用模型自己的上限当唯一选项，
  // 否则这组会整个消失，用户反而没得调。
  return fitting.length > 0 ? fitting : [{ tokens: ceiling, label: formatTokens(ceiling) }]
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
export function ModelParams({ value, model, disabled, onSave }) {
  const current = value || {}
  const contextTiers = tiersUnder(CONTEXT_TIERS, model.contextWindow)
  const outputTiers = tiersUnder(OUTPUT_TIERS, model.maxTokens, true)
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
        type: 'button', key: t.tokens, className: 'eac-tier', disabled,
        'aria-pressed': current[key] === t.tokens,
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
export function PlanModelParams({ model, disabled, value, setValue, onSave }) {
  const [error, setError] = React.useState('')
  const draft = value ?? {}
  const set = (field, next) => { setError(''); setValue({ ...draft, [field]: next }) }
  const options = (values, labels) => values.map(option =>
    h('option', { key: option, value: option }, labels?.[option] ?? option))
  const choose = (label, current, values, change, labels, defaultLabel) => h('label', { className: 'eac-field', key: label },
    h('span', null, label), h('select', { className: 'eac-input', value: current ?? '', disabled,
      onChange: event => change(event.target.value) }, h('option', { value: '' }, defaultLabel), ...options(values, labels)))
  const tokens = (label, field, effective) => h('label', { className: 'eac-field' }, h('span', null, label),
    h('input', { className: 'eac-input', type: 'number', inputMode: 'numeric', min: 1, max: 10000000, step: 1, disabled,
      value: draft[field] ?? '', placeholder: effective > 0 ? `默认 ${formatTokens(effective)}` : '',
      onChange: event => set(field, event.target.value) }))
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
    h('div', { className: 'eac-param-grid' },
      tokens('上下文 Token', 'contextWindow', model.defaultContextWindow),
      tokens('最大输出 Token', 'maxTokens', model.defaultMaxOutputLength),
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
