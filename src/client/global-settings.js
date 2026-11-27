const GLOBAL_AUTOMATION_OPTIONS = [
  ['autoCheckin', '自动每日签到'],
  ['autoClaimRewards', '自动领取奖励'],
  ['autoCompleteTasks', '自动完成任务'],
  ['cotLoopGuard', '思考循环保护'],
]

function GlobalSettingsPanel(state, ui, notice) {
  const { config, quotaProviders } = state.automation ?? {}
  const scope = 'automation'
  const save = patch => ['setAutomationConfig', patch, { globalNotice: true }]
  const rows = config ? [{
    id: 'quota-ingest', name: '向 subusage 推送额度',
    meta: '每 60 秒按渠道推送已采集的额度',
    enabled: config.quotaIngest, toggle: save({ quotaIngest: !config.quotaIngest }),
  }] : []
  if (config && quotaProviders?.length) rows.push({
    id: 'routing-mode', name: '智能选号模式', value: config.routingMode,
    meta: { manual: '按账号列表顺序', free: '先用每日与赠送额度',
      expiring: '每日 → 赠送 → 7 天内到期', sticky: '同一账号用尽或受限才切换' }[config.routingMode],
    options: [
      { value: 'manual', label: '手动' }, { value: 'free', label: '免费优先' },
      { value: 'expiring', label: '临期优先' }, { value: 'sticky', label: '缓存优先' },
    ].map(option => ({ ...option, call: save({ routingMode: option.value }) })),
  })
  const defaults = config ? GLOBAL_AUTOMATION_OPTIONS.map(([field, name]) => ({
    id: field, name, enabled: config[field], toggle: save({ [field]: !config[field] }),
  })) : []
  // 全局区依赖全局快照，不受当前渠道的加载状态影响。
  const globalUi = { ...ui, loading: false }
  const settingsList = list => renderSettingRows(list, globalUi, 'global', scope)
  return h('details', { className: 'eac-global-settings', 'data-section': 'global-settings' },
    h('summary', { className: 'eac-global-summary' }, '全局设置'),
    h('div', { className: 'eac-global-body', 'aria-busy': ui.isPending(scope) },
      notice,
      config ? settingsList(rows) : h('div', { className: 'eac-empty' },
        h('span', { role: 'status' }, '等待全局设置数据。'),
        button('重新读取', () => ui.act('readHostSnapshots'), false, { 'aria-label': '重新读取全局设置' })),
      config ? h('section', { className: 'eac-group', 'aria-labelledby': 'eac-automation-defaults' },
        h('h3', { id: 'eac-automation-defaults', className: 'eac-group-title' }, '自动化默认值'),
        h('p', { className: 'eac-summary' }, '适用于支持该功能且未单独设置的渠道。'),
        settingsList(defaults)) : null))
}
