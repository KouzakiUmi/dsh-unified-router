// Channel-pack settings use the same view contract as managed accounts.
// Optional actions, forms, quota details and model groups are plain data.
export function packSettings(provider) {
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
