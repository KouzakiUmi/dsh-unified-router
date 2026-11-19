const SETTINGS_PANELS = [
  { id: 'models', label: '模型' },
  { id: 'accounts', label: '账号与额度' },
  { id: 'advanced', label: '渠道' },
]

function renderTags(tags = []) {
  return tags.filter(Boolean).map(([label, tone, title]) => tag(label, tone, title))
}

function renderActions(actions = [], ui) {
  return actions.filter(Boolean).map(({ label, call, panel, open, primary: main, danger: destructive, disabled, accessible }) => {
    const run = panel ? () => ui.setPanel(panel, open) : () => ui.act(...call)
    const makeButton = main ? primary : destructive ? danger : button
    return makeButton(label, run, ui.disabled || disabled, { key: label, 'aria-label': accessible })
  })
}

const SETTINGS_FORMS = { account: AccountForm, key: PlanKeyForm }
function renderForm(form, ui, key) {
  if (!form) return null
  const save = (...args) => ui.invoke(...form.call, ...args)
  return h(SETTINGS_FORMS[form.kind], { key, account: form.account, disabled: ui.disabled, save, onSave: save })
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
  return Section({
    title: '账号与额度',
    summary: summary.length ? summary : null,
    actions: renderActions(view.actions, ui),
    children: [
      renderLogin(view.login, ui),
      rows.length ? ListBox({ children: rows.map(row => {
        const key = `${ui.providerId}:account:${row.id}`
        const manageable = !!(row.groups?.length || row.form || row.actions?.length)
        return Row({
          key, name: row.name, avatar: avatarText(row.name), tags: renderTags(row.tags),
          meta: row.updatedAt ? `更新于 ${displayTime(row.updatedAt)}` : undefined,
          metric: row.metric ? Metric({ ...row.metric, label: row.name }) : undefined,
          tone: row.enabled === false ? 'off' : undefined,
          switchControl: row.toggle ? Switch({ checked: row.enabled, disabled: ui.disabled,
            label: `启用账号 ${row.name}`, onChange: () => ui.act(...row.toggle) }) : undefined,
          moreLabel: manageable ? '管理' : undefined, expanded: ui.more[key] === true,
          onToggle: () => ui.act('toggleMore', key),
          detail: [
            ...(row.groups ?? []).map(renderQuotaGroup),
            row.form ? h('div', { key: 'form' }, renderForm(row.form, ui, `${ui.providerId}:${row.id}`)) : null,
            row.actions?.length ? h('div', { className: 'eac-row-links', key: 'actions' }, ...renderActions(row.actions, ui)) : null,
            row.confirmation ? h('div', { key: 'confirm' }, renderConfirmation(row.confirmation, ui)) : null,
          ],
        })
      }) }) : EmptyState({ loading: !view.ready && !view.failed, failed: view.failed,
        onRetry: () => ui.act('refreshSettings'), emptyText: '还没有账号。', loadingText: '正在读取账号…' }),
    ],
  })
}

function renderModelEditor(model, ui) {
  const { editor, key } = model
  const onSave = value => ui.invoke(...editor.call, value)
  if (editor.kind === 'tiers') return h(ModelParams, { key, model, value: editor.value, disabled: ui.disabled, onSave })
  const draft = ui.drafts[key]
  const value = draft ?? model.params
  return h(PlanModelParams, {
    key, model, disabled: ui.disabled, value,
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

function ModelRow(model, ui) {
  const name = modelDisplayName(model)
  const editing = ui.editParams === model.key
  const editorId = 'eac-params-' + encodeURIComponent(model.key)
  return h('article', { className: 'eac-model', key: model.key, 'data-disabled': model.enabled === false ? 'true' : undefined },
    h('div', { className: 'eac-model-head' },
      model.toggle ? Switch({ checked: model.enabled, disabled: ui.disabled, label: `${model.dead ? '恢复' : '启用'}模型 ${name}`,
        onChange: () => ui.act(...model.toggle) }) : null,
      h('div', { className: 'eac-model-copy' },
        h('div', { className: 'eac-model-name', title: name }, name),
        h('div', { className: 'eac-model-id', title: model.id }, model.id)),
      model.defaults ? h('p', { className: 'eac-model-defaults', title: model.defaults }, model.defaults) : null,
      h('div', { className: 'eac-model-aside' },
        h('span', { className: 'eac-model-tags' }, ...renderTags(model.tags)),
        model.editor ? button(editing ? '收起' : '参数', () => ui.act('toggleParams', model.key), ui.disabled,
          { className: 'is-quiet', 'aria-label': `${name} 的参数`, 'aria-expanded': editing, 'aria-controls': editorId }) : null)),
    editing ? h('div', { id: editorId }, renderModelEditor(model, ui)) : null)
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
  return Section({
    title: '模型目录',
    summary: [
      all.some(model => model.toggle) ? `${activeCount} / ${all.length} 已启用` : `${all.length} 个模型`,
      !grouped ? catalogSourceTag(primaryGroup?.source) : null,
    ],
    actions: grouped ? null : renderActions(primaryGroup?.actions, ui),
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
        return h('div', { className: 'eac-group', key: group.id, 'data-model-provider': grouped ? group.id : undefined },
          grouped ? h('div', { className: 'eac-group-head' },
            h('p', { className: 'eac-group-title' }, `${group.title} · ${group.rows.length}`, catalogSourceTag(group.source)),
            h('div', { className: 'eac-group-actions' }, ...renderActions(group.actions, ui))) : null,
          group.hint ? h('div', null, ...renderActions([group.hint], ui)) : null,
          group.notice ? h('p', { className: 'eac-muted', role: 'status' }, group.notice) : null,
          rows.length ? h('div', { className: 'eac-model-list' }, ...rows.map(model => {
            const reason = exclusions.get(model.id)
            const alternative = byId.get(reason?.alternative)
            const tag = reason?.kind === 'older' ? ['旧版', 'warn',
              alternative ? `同目录已有 ${modelDisplayName(alternative)}。` : model.staleReason]
              : reason?.kind === 'value' ? ['性价比偏低', 'warn',
                `${modelDisplayName(alternative)} 的渠道倍率更低，可用于同类任务。`] : null
            return ModelRow({ ...model, tags: [...(model.tags ?? []), tag] }, ui)
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

function ChannelPanel(rows, ui) {
  return Section({
    title: '渠道设置',
    children: ListBox({ children: rows.map(row => {
      const key = `${ui.providerId}:channel:${row.id}`
      return Row({
        key, name: row.name, meta: row.meta, tags: renderTags(row.tags),
        switchControl: row.toggle ? Switch({ checked: row.enabled ?? false, disabled: ui.disabled || row.enabled === undefined,
          label: row.toggleLabel || row.name, onChange: () => ui.act(...row.toggle) }) : undefined,
        controls: renderActions(row.actions, ui),
        moreLabel: row.form ? '配置' : undefined, expanded: ui.more[key] === true,
        onToggle: () => ui.act('toggleMore', key), detail: row.form && renderForm(row.form, ui),
      })
    }) }),
  })
}

export function renderSettingsPanel(panel, provider, state, ui) {
  if (panel === 'accounts') return AccountsPanel(provider.accounts(state), ui)
  if (panel === 'models') return ModelsPanel(provider.models(state), ui)
  return ChannelPanel(provider.channel(state), ui)
}
