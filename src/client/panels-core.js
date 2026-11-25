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
  return h(SETTINGS_FORMS[form.kind], {
    key, account: form.account, hint: form.hint, guide: form.guide,
    disabled: form.disabled === true || ui.loading || ui.isPending(formScope), save, onSave: save,
  })
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
      : provider.caps?.dailyReward === true))
  const capabilities = state.automation?.tasks?.[id]?.capabilities
  const supportsRewards = capabilities?.claimRewards ?? (provider.caps?.onboarding === true && provider.caps?.completeTasks !== true || provider.caps?.claimRewards === true)
  const supportsTasks = capabilities?.completeTasks ?? (provider.caps?.completeTasks === true)
  const overrides = state.automation?.config?.providers?.[id] ?? {}
  // 账号列表的位置由渠道自己说（`managed.js` / `workbuddy.js` 各提供 `accountsOf`）。
  const accounts = provider.pack ? state.accounts : (provider.accountsOf?.(state) ?? [])
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
  // 只有带独立模型设置文件的渠道才消费这个值（声明在各自 `caps`）。
  const supportsDefaultMaxOutput = provider.caps?.defaultMaxOutput === true
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

export function renderSettingsPanel(panel, provider, state, ui) {
  if (panel === 'accounts') return AccountsPanel(provider.accounts(state), ui)
  if (panel === 'models') return ModelsPanel(provider.models(state), ui)
  return ChannelPanel(provider.channel(state), ui, provider, state)
}
