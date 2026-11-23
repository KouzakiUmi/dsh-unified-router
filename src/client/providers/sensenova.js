const senseNovaQuotaStatus = {
  'needs-console': '未登录', expired: '登录已失效', error: '额度读取失败',
}

function senseNovaQuotaPools(quota, model) {
  if (quota?.status !== 'ready' || !Array.isArray(quota.pools)) return []
  if (!model) return quota.pools
  const matches = quota.pools.filter(pool => Array.isArray(pool?.modelIds) && pool.modelIds.includes(model))
  const dedicated = matches.filter(pool => ['dedicated', 'flash'].includes(String(pool.poolType ?? '').toLowerCase()))
  return dedicated.length ? dedicated : matches
}

function senseNovaQuotaDetails(pool) {
  const windows = [[pool.window5h, '5 小时积分'], [pool.window7d, '7 天积分']].flatMap(([row, label]) => !row ? [] : [{
    label, fraction: remainingFraction(row.remaining, row.limit),
    value: row.limit > 0 ? `${displayNumber(row.remaining)} / ${displayNumber(row.limit)} 积分` : `${displayNumber(row.remaining)} 积分`,
    reset: row.resetAt ? row.resetAt * 1000 : null,
  }])
  if (Number.isFinite(pool.grantBalance)) windows.push({ label: '赠送积分', value: `${displayNumber(pool.grantBalance)} 积分`,
    expires: pool.nearestGrantExpiry && pool.grantBalance > 0 ? pool.nearestGrantExpiry * 1000 : null,
    expiringAmount: pool.nearestGrantExpiringBalance > 0 ? `${displayNumber(pool.nearestGrantExpiringBalance)} 积分` : '' })
  return windows
}

export const sensenova = {
  id: 'sensenova-token-plan',
  title: '商汤 Token Plan',
  panelIds: ['models', 'advanced'],
  createActions: createSenseNovaActions,
  snapshot: {
    methods: ['plan.snapshot'],
    keep: ['plan', 'planStale', 'planError'],
    ready: state => !!state.plan,
    failed: state => state.planError || state.plan?.catalogError,
    fromRead([value], state) {
      const { plan, stale } = mergePlanSnapshot(value, state.plan)
      return { plan, planStale: stale, planError: false }
    },
    apply(get, state) {
      const entry = get('plan.snapshot')
      if (!entry) return {}
      const selected = state.provider === sensenova.id
      if (!entry.value) return {
        planStale: entry.stale, planError: entry.stale,
        ...(selected && entry.stale ? { loading: false } : {}),
      }
      return { plan: planSnapshotFrom(entry.value), planStale: entry.stale || entry.value.catalogError === true, planError: false,
        ...(selected ? { loading: false } : {}) }
    },
  },
  statusFrom({ plan }) {
    if (!plan) return null
    return {
      closed: !plan.registerProvider, accounts: plan.hasApiKey ? 1 : 0, cardMeta: `${plan.hasApiKey ? 'Key 已配置' : '待配置 Key'} · ${plan.models.length} 模型`, models: plan.models.length,
      label: !plan.registerProvider ? '渠道已关闭' : plan.providerRegistered ? '渠道运行中' : '待注册',
      tone: plan.providerRegistered ? 'success' : 'warn',
    }
  },
  models({ plan }) {
    return { groups: [{
      id: 'sensenova-token-plan',
      source: plan?.catalogAvailable ? 'remote' : plan?.catalogError && plan.models.length ? 'cached' : undefined,
      hint: !plan?.hasApiKey && plan ? { label: '配置 API Key', panel: 'advanced', open: 'key' } : undefined,
      actions: plan?.hasApiKey ? [
        { label: '刷新目录', call: ['refreshSettings'] },
        { label: '恢复推荐', call: ['planResetModels'], disabled: !plan.models.length },
      ] : [],
      rows: (plan?.models ?? []).map(model => ({
        ...model, key: modelKey('sensenova-token-plan', model.id),
        toggle: ['planSetModelEnabled', model.id, !model.enabled],
         defaults: baseModelSummary(model),
        editor: { kind: 'numeric', call: ['planSetModelParams', model.id] },
      })),
    }] }
  },
  channel({ plan, pending }) {
    const signingIn = pending?.['console-login:sensenova-token-plan'] === true
    const pools = senseNovaQuotaPools(plan?.quota)
    const quotaRows = pools.flatMap((pool, index) => senseNovaQuotaDetails(pool).map((detail, detailIndex) => ({
      id: `pool-${index}-${detailIndex}`,
      name: pools.length === 1 ? detail.label : `${pool.name || '积分池'} · ${detail.label}`,
      meta: [
        Number.isFinite(detail.fraction) ? `剩余 ${detail.value}` : detail.value,
        displayTime(detail.reset) !== '—' ? `重置 ${displayTime(detail.reset)}` : '',
        displayTime(detail.expires) !== '—' ? `到期 ${displayTime(detail.expires)}${detail.expiringAmount ? ` · ${detail.expiringAmount}` : ''}` : '',
      ].filter(Boolean).join(' · '),
      metric: percentMetric(detail.fraction),
    })))
    return [
      { id: 'models', name: '模型提供方', enabled: plan?.registerProvider, toggle: ['planSetEnabled', !plan?.registerProvider],
        tags: [plan?.registerProvider && !plan.providerRegistered && ['待注册', 'warn']] },
      { id: 'key', name: '模型 API Key', tags: [[plan?.hasApiKey ? '已配置' : '待配置', plan?.hasApiKey ? 'success' : undefined]],
        form: { kind: 'key', call: ['planSetKey'] } },
      { id: 'console-quota', name: '控制台额度', scope: 'console-actions:sensenova-token-plan',
        meta: signingIn ? '等待浏览器授权' : plan?.quota?.status === 'ready' ? `${pools.length} 个积分池${plan?.quota?.plan ? ` · ${plan.quota.plan}` : ''}` : senseNovaQuotaStatus[plan?.quota?.status],
        actions: signingIn ? [{ label: '取消登录', call: ['planCancelConsoleLogin'] }] : [
          { label: plan?.quota?.status === 'ready' ? '重新登录' : '浏览器登录', call: ['planConsoleLogin'], primary: plan?.quota?.status !== 'ready' },
          { label: '打开控制台', href: 'https://platform.sensenova.cn/' },
        ] },
      ...quotaRows,
    ]
  },
}

function createSenseNovaActions({ getState, publish, planMutate }) {
  let consoleLogin
  return {
    planConsoleLogin() {
      if (consoleLogin) return Promise.resolve(false)
      const controller = new AbortController()
      consoleLogin = controller
      return planMutate('plan.consoleLogin', {}, {
        controller, scope: 'console-login:sensenova-token-plan',
        progress: '正在等待商汤控制台浏览器授权…', failure: '商汤控制台登录失败。',
        message: value => value?.quota?.status === 'ready' ? '商汤控制台已连接。' : '登录成功，额度暂未读取。',
        result(value) {
          const plan = getState().plan
          if (plan) publish({ plan: { ...plan, quota: value.quota ?? null } })
        },
      }).finally(() => { consoleLogin = null })
    },
    planCancelConsoleLogin() { consoleLogin?.abort() },
    planResetModels() {
      return planMutate('plan.resetModels', {}, { message: '已恢复推荐模型。', result(value) {
        const plan = getState().plan
        const enabled = new Set(value?.enabledModelIds)
        if (plan) publish({ plan: { ...plan, models: plan.models.map(model => ({ ...model, enabled: enabled.has(model.id) })) } })
      } })
    },
    planSetKey(apiKey) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) { publish({ notice: '请输入商汤 API Key。' }); return Promise.resolve(false) }
      return planMutate('plan.setKey', { apiKey }, { progress: '正在保存商汤 API Key…', message: '商汤 API Key 已保存。' })
    },
    planSetEnabled(enabled) {
      return planMutate('plan.setEnabled', { enabled: enabled === true }, { progress: enabled ? '正在启用商汤模型提供方…' : '正在关闭商汤模型提供方…', message: enabled ? '商汤模型提供方已启用。' : '商汤模型提供方已关闭。' })
    },
    planSetModelEnabled(modelId, enabled) {
      if (typeof modelId !== 'string' || typeof enabled !== 'boolean' || !getState().plan?.models.some(m => m.id === modelId)) return Promise.resolve(false)
      return planMutate('plan.setModelEnabled', { modelId, enabled }, { message: '模型显示设置已保存。', result(value) {
        if (!getState().plan || value?.modelId !== modelId || typeof value?.enabled !== 'boolean') throw new Error('invalid model response')
        publish({ plan: { ...getState().plan, models: getState().plan.models.map(m => m.id === modelId ? { ...m, enabled: value.enabled } : m) } })
      } })
    },
    planSetModelParams(modelId, params) {
      if (typeof modelId !== 'string' || !getState().plan?.models.some(model => model.id === modelId)) return Promise.resolve(false)
      try { params = validatePlanParams(typeof params === 'object' && params !== null ? params : { maxTokens: params }) }
      catch { publish({ notice: '模型参数无效。' }); return Promise.resolve(false) }
      return planMutate('plan.setModelParams', { modelId, params }, { message: '模型参数已保存。', result(value) {
        const plan = getState().plan
        if (!plan || value?.modelId !== modelId) throw new Error('invalid model response')
        publish({ plan: { ...plan, models: plan.models.map(model =>
          model.id === modelId ? { ...model, ...planModelFields({ ...model, ...value }) } : model) } })
      } })
    },
  }
}
