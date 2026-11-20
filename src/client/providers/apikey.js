// API Key 渠道（Agnes、云知声）共用的设置页视图。
// 一个渠道 = 一份宿主快照（apikey.snapshot）：Key 状态、提供方开关、模型目录与可选用量。
// 视图分区：「模型」（目录、开关、参数）与「渠道」（提供方开关、API Key、用量）。
const EMPTY_APIKEY = Object.freeze({ hasApiKey: false, registerProvider: false, providerRegistered: false,
  catalogSource: 'fallback', catalogError: false, updatedAt: null, models: [], balance: null })

function apikeyMoney(value, unit) {
  return typeof value === 'number' ? `${unit === 'CNY' ? '¥' : '$'}${value.toFixed(2)}` : '—'
}

const apiQuotaLabels = {
  'weekly-points': '周积分', 'window-points': '5 小时积分', 'monthly-credits': '月度 Credits',
  'window-credits': '5 小时 Credits', 'pack-credits': '积分包 Credits',
  'weekly-requests': '每周请求数', 'window-requests': '5 小时请求数',
}

function apiQuotaRows(quota, consoleUrl) {
  if (!quota) return []
  if (quota.status !== 'ready') return [{ id: 'console-quota', name: '控制台额度', href: consoleUrl,
    meta: { 'needs-console': '未配置控制台会话', unavailable: '暂无额度数据', expired: '控制台会话已过期', error: '读取失败' }[quota.status] }]
  return [
    ...quota.windows.map(row => ({ id: row.id, name: apiQuotaLabels[row.id],
      meta: `${row.remaining === null ? `已用 ${displayNumber(row.used)}` : `剩余 ${displayNumber(row.remaining)}`}${row.limit === null ? '' : ` / ${displayNumber(row.limit)}`}` })),
    ...(quota.balance === null ? [] : [{ id: 'console-balance', name: '控制台余额', meta: apikeyMoney(quota.balance, 'CNY') }]),
  ]
}

function ApiKeyCooldown({ limit }) {
  const secondsLeft = () => Math.max(0, Math.ceil((limit.until - Date.now()) / 1000))
  const [seconds, setSeconds] = React.useState(secondsLeft)
  React.useEffect(() => {
    const timer = setInterval(() => {
      const next = secondsLeft()
      setSeconds(next)
      if (!next) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [limit.until])
  if (!seconds) return '可重试'
  const label = limit.reason === 'rpm' ? '请求频率受限（RPM）' : limit.reason === 'tpm' ? 'Token 速率受限（TPM）' : '请求限速'
  return h('span', { role: 'timer' }, `${label} · ${limit.estimated ? '预计' : '剩余'} ${seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ` : ''}${seconds % 60} 秒`)
}

export function apiKeyChannel({ id, title, host }) {
  const entry = state => state.apikeys?.[id]
  const withEntry = (state, next) => ({ apikeys: { ...state.apikeys, [id]: next } })
  const provider = {
    id, title,
    panelIds: ['models', 'advanced'],
    rpcMethods: APIKEY_METHODS,
    createActions: context => createApiKeyActions(provider, context),
    snapshot: {
      methods: ['apikey.snapshot'],
      keep: ['apikeys'],
      ready: state => entry(state)?.ready === true,
      failed: state => entry(state)?.error === true,
      readFailed: state => withEntry(state, { ...(entry(state) ?? EMPTY_APIKEY), ready: entry(state)?.ready === true, stale: true, error: true }),
      fromRead([value], state) {
        const snapshot = apikeySnapshotFrom(value)
        return withEntry(state, { ...snapshot, ready: true, stale: value?.snapshot?.stale === true || snapshot.catalogError, error: false })
      },
      apply(get, state) {
        const found = get('apikey.snapshot')
        if (!found) return {}
        const selected = state.provider === id
        if (!found.value) {
          return { ...withEntry(state, { ...(entry(state) ?? EMPTY_APIKEY), ready: entry(state)?.ready === true, stale: found.stale === true, error: found.stale === true }),
            ...(selected && found.stale ? { loading: false } : {}) }
        }
        const snapshot = apikeySnapshotFrom(found.value)
        return { ...withEntry(state, { ...snapshot, ready: true, stale: found.stale === true || snapshot.catalogError, error: false }),
          ...(selected ? { loading: false } : {}) }
      },
    },
    statusFrom(state) {
      const current = entry(state)
      if (!current?.ready) return null
      const label = !current.hasApiKey ? '待配置 Key' : !current.registerProvider ? '渠道已关闭'
        : current.providerRegistered ? '渠道运行中' : '待注册'
      return {
        closed: !current.registerProvider, accounts: current.hasApiKey ? 1 : 0,
        cardMeta: `${current.hasApiKey ? 'Key 已配置' : '待配置 Key'} · ${current.models.length} 模型`,
        models: current.models.length, label,
        tone: current.hasApiKey && current.providerRegistered ? 'success' : 'warn',
      }
    },
    models(state) {
      const current = entry(state)
      return { groups: [{
        id,
        source: current?.catalogSource === 'remote' ? 'remote' : current?.catalogSource === 'cached' ? 'cached'
          : current?.hasApiKey && current.catalogSource === 'fallback' ? 'fallback' : undefined,
        hint: current && !current.hasApiKey ? { label: '配置 API Key', panel: 'advanced', open: 'key' } : undefined,
        actions: current?.hasApiKey ? [
          { label: '刷新目录', call: ['refreshSettings'] },
          { label: '恢复推荐', call: [id + 'ResetModels'], disabled: !current.models.length },
        ] : [],
        rows: (current?.models ?? []).map(model => ({
          ...model, key: modelKey(id, model.id),
          toggle: [id + 'SetModelEnabled', model.id, !model.enabled],
          defaults: currentModelSummary(model),
          editor: { kind: 'numeric', call: [id + 'SetModelParams', model.id] },
        })),
      }] }
    },
    channel(state) {
      const current = entry(state)
      const usage = current?.balance
      return [
        { id: 'models', name: '模型提供方',
          enabled: current?.hasApiKey ? current.registerProvider : undefined,
          toggle: [id + 'SetEnabled', !current?.registerProvider],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.registerProvider && current.hasApiKey && !current.providerRegistered && ['待注册', 'warn']] },
        { id: 'key', name: 'API Key', meta: host,
          tags: [[current?.hasApiKey ? '已配置' : '待配置', current?.hasApiKey ? 'success' : undefined]],
          form: { kind: 'key', call: [id + 'SetKey'] } },
        ...(current?.rateLimit?.until > Date.now() ? [{ id: 'rate-limit', name: '限速提醒',
          meta: h(ApiKeyCooldown, { key: current.rateLimit.until, limit: current.rateLimit }) }] : []),
        ...apiQuotaRows(current?.quota, APIKEY_CONSOLES[id]),
        ...(usage && current?.quota?.status !== 'ready' ? [{ id: 'usage', name: '账户用量',
          meta: usage.error ? undefined : `已用 ${apikeyMoney(usage.used, usage.unit)}${usage.limit !== null ? ` / ${apikeyMoney(usage.limit, usage.unit)}` : ''}`,
          tags: [usage.error && ['读取失败', 'warn'], usage.unlimited && ['无限额度', 'info']] }] : []),
      ]
    },
  }
  return provider
}

function createApiKeyActions(provider, { getState, publish, mutate }) {
  const id = provider.id, title = provider.title
  const patchModels = update => {
    const state = getState(), current = state.apikeys?.[id]
    if (state.provider !== id || !current) return
    publish({ apikeys: { ...state.apikeys, [id]: { ...current, models: update(current.models) } } })
  }
  const knownModel = modelId => typeof modelId === 'string' && getState().apikeys?.[id]?.models.some(model => model.id === modelId)
  const saveModel = (method, payload, message, result) => mutate(method, payload, { refresh: false, message, result })
  return {
    async [id + 'SetKey'](apiKey) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) { publish({ notice: `请输入 ${title} API Key。` }); return false }
      const saved = await mutate('apikey.setKey', { apiKey }, { progress: `正在保存 ${title} API Key…`, message: `${title} API Key 已保存。` })
      // 保存 Key 就是要用这个渠道：提供方仍是关闭状态时顺手启用。
      if (saved && getState().provider === id && getState().apikeys?.[id]?.registerProvider === false) {
        await mutate('apikey.setEnabled', { enabled: true }, { progress: `正在启用 ${title} 模型提供方…`, message: `${title} API Key 已保存，模型提供方已启用。` })
      }
      return saved
    },
    [id + 'SetEnabled'](enabled) {
      return mutate('apikey.setEnabled', { enabled: enabled === true }, {
        progress: enabled ? `正在启用 ${title} 模型提供方…` : `正在关闭 ${title} 模型提供方…`,
        message: enabled ? `${title} 模型提供方已启用。` : `${title} 模型提供方已关闭。` })
    },
    [id + 'SetModelEnabled'](modelId, enabled) {
      if (!knownModel(modelId) || typeof enabled !== 'boolean') return Promise.resolve(false)
      return saveModel('apikey.setModelEnabled', { modelId, enabled }, '模型显示设置已保存。', value => {
        if (value?.modelId !== modelId || typeof value?.enabled !== 'boolean') throw new Error('invalid model response')
        patchModels(models => models.map(model => model.id === modelId ? { ...model, enabled: value.enabled } : model))
      })
    },
    [id + 'SetModelParams'](modelId, params) {
      if (!knownModel(modelId)) return Promise.resolve(false)
      try { params = validatePlanParams(typeof params === 'object' && params !== null ? params : { maxTokens: params }) }
      catch { publish({ notice: '模型参数无效。' }); return Promise.resolve(false) }
      return saveModel('apikey.setModelParams', { modelId, params }, '模型参数已保存。', value => {
        if (value?.modelId !== modelId) throw new Error('invalid model response')
        patchModels(models => models.map(model => model.id === modelId ? { ...model, ...planModelFields({ ...model, ...value }) } : model))
      })
    },
    [id + 'ResetModels']() {
      return saveModel('apikey.resetModels', {}, '已恢复推荐模型。', value => {
        const enabled = new Set(value?.enabledModelIds)
        patchModels(models => models.map(model => ({ ...model, enabled: enabled.has(model.id) })))
      })
    },
  }
}
