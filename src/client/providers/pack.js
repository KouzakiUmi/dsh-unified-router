// Channel-pack settings use the same view contract as managed accounts.
// Optional actions, forms, quota details and model groups are plain data.
export function packSettings(provider) {
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
      return {
        ready: !state.loading || state.accounts.length > 0,
        failed: state.loadFailed,
        poolSummary: pool.known ? `总计 ${pool.summary}` : '',
        autoCheckin: checkinEnabled(state, id),
        actions: [
          caps.dailyReward !== false && { label: '全部领取', call: ['claim'],
            disabled: !state.accounts.some(account => account.enabled !== false && !checkinEntry(state, id, account.id)?.locked),
            scope: `channel:${state.provider}` },
          { label: '添加账号', call: ['startLogin'], primary: true },
        ],
        login: state.login && { url: state.login.url, canCheck: true },
        rows: state.accounts.map(account => {
          const { id: accountId, nickname, enabled, plan, planLabel } = account
          const limited = Object.values(account.modelRateLimits).filter(expires => expires > Date.now()).length
          const balance = balances.get(accountId)
          const onboarding = caps.onboarding ? taskEntry(state, id, 'claimRewards', accountId) : null
          const shownPackages = displayCreditPackages(balance?.packages)
          const groups = [
            ...(shownPackages.length ? [{ title: '额度包', items: shownPackages.map(pkg => ({
              label: pkg.name || '额度包', value: pkg.remaining, unit: pkg.unit || undefined,
              notes: [!pkg.active && '已失效', pkg.expiresAt > 0 && `到期 ${displayTime(pkg.expiresAt)}`],
            })) }] : []),
          ]
          return {
            id: accountId, name: nickname, enabled,
            toggle: ['save', accountId, nickname, !enabled],
            tags: [
              // 订阅类型文案（TRAE 的 Free/Pro/Pro+/Ultra/Express 等）优先展示；
              // Raccoon 家族没有 planLabel，继续走 plan 枚举映射。
              planLabel && [planLabel, 'info'],
              // 统一模型开关打开后不再区分体验/订阅：合并的意义就是「一个模型面」，
              // 再挂套餐标签会让人以为还要按套餐挑账号。关闭时照旧按套餐标注。
              !planLabel && caps.accountPlan && !unifiedModelsOn(state)
                && (plan === 'pro' ? ['订阅', 'info'] : plan === 'free' ? ['体验版', 'success'] : ['套餐未知', 'warn']),
              !enabled && ['已停用'],
              account.expiresAt > 0 && account.expiresAt <= Date.now() && ['凭据过期', 'warn'],
              limited > 0 && [`受限 ${limited}`, 'warn'],
              balance?.stale && [balance.total === null ? '余额读取失败' : '上次余额', 'warn'],
              checkinEntry(state, id, accountId)?.tag,
              onboarding?.tag,
            ],
            metric: { value: balance?.total ?? (balance?.stale ? '—' : '额度待更新'), unit: balance?.total != null ? '积分' : undefined },
            updatedAt: balance?.updatedAt,
            groups,
            form: { kind: 'account', account, call: ['save'] },
            actions: [
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
          // 渠道可在 caps 里声明模型分区的状态行（如 TRAE 的缓存命中率口径）；
          // 未声明时沿用 Qoder CLI 的目录状态映射。
          notice: caps.modelNotice ?? (side.id === 'qodercn' ? ({
            'login-required': 'Qoder CLI 未登录 · qoderclicn login',
            'cli-missing': '找不到 Qoder 中国版 CLI。安装后可刷新目录。',
            timeout: 'Qoder CLI 读取超时，可稍后重试。',
            'cli-failed': 'Qoder CLI 读取失败，可稍后重试。',
            empty: 'Qoder CLI 本次返回空目录，可稍后重试。',
            'no-model-key': 'Qoder 目录只回了显示名、没有可调用 key，已跳过这些条目。',
          })[state.qoderCatalogIssue] : undefined),
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
          id: 'unified-models', name: '统一体验与订阅模型',
          // 合并后是一个模型面：说明按「谁有额度用谁」讲，不再强调体验/订阅的先后，
          // 否则用户会以为还要按套餐挑账号。
          meta: '合并为一个模型面 · 额度用尽自动切换账号',
          enabled: state.automation?.config?.raccoonUnifiedModels === true,
          toggle: ['setAutomationConfig', { raccoonUnifiedModels: !(state.automation?.config?.raccoonUnifiedModels === true) }],
          toggleLabel: '统一体验与订阅模型',
        }] : []),
      ]
    },
  }
}
