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
        defaults: currentModelSummary(model),
        editor: { kind: 'numeric', call: ['planSetModelParams', model.id] },
      })),
    }] }
  },
  channel({ plan }) {
    return [
      { id: 'models', name: '模型提供方', enabled: plan?.registerProvider, toggle: ['planSetEnabled', !plan?.registerProvider],
        tags: [plan?.registerProvider && !plan.providerRegistered && ['待注册', 'warn']] },
      { id: 'key', name: '模型 API Key', tags: [[plan?.hasApiKey ? '已配置' : '待配置', plan?.hasApiKey ? 'success' : undefined]],
        form: { kind: 'key', call: ['planSetKey'] } },
    ]
  },
}

function createSenseNovaActions({ getState, publish, planMutate }) {
  return {
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
