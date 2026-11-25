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
  'monthly-tokens': '月度 Token', 'window-credits': '5 小时 Credits', 'pack-credits': '积分包 Credits',
  'window-percent': '5 小时额度', 'weekly-percent': '周额度', 'monthly-percent': '月度额度',
  'weekly-requests': '每周请求数', 'window-requests': '5 小时请求数',
}

function apiQuotaValueText(row, prefix = true) {
  if (row.id?.endsWith('-percent')) {
    if (row.remaining !== null) return `${prefix ? '剩余 ' : ''}${displayNumber(row.remaining)}%`
    return `已用 ${displayNumber(row.used)}%`
  }
  return `${row.remaining === null ? `已用 ${displayNumber(row.used)}` : `${prefix ? '剩余 ' : ''}${displayNumber(row.remaining)}`}${row.limit === null ? '' : ` / ${displayNumber(row.limit)}`}`
}

function apiQuotaResetHint(row, at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0 || at > now || !row.resetInMs) return ''
  const minutes = Math.ceil((row.resetInMs - (now - at)) / 60000)
  if (minutes <= 0) return ''
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes / 60) % 24
  const coarse = row.id === 'weekly-points' || row.id === 'weekly-percent' || row.id?.startsWith('monthly-')
  if (coarse && minutes <= 60) return '约 1 小时内重置'
  if (minutes === 1) return '约 1 分钟内重置'
  const duration = [days && `${days} 天`, hours && `${hours} 小时`, !coarse && minutes % 60 && `${minutes % 60} 分钟`].filter(Boolean).join(' ')
  return duration ? `约 ${duration}后重置` : ''
}

function apiQuotaRows(quota, consoleUrl, capabilities, balance) {
  if (capabilities.freeTier && isFreeTierIdle(quota, balance)) {
    return [{
      id: 'console-quota', name: '账户额度', href: consoleUrl,
      meta: '免费用户（额度读取为 0）',
      tags: [['免费用户', 'info']],
    }]
  }
  if (!quota) return []
  // 有免费额度面的渠道只要有 API Key 余额，「未配置控制台会话」就不是需要提示的事。
  if (quota.status === 'needs-console' && capabilities.freeTier && balance && !balance.error) return []
  if (quota.status !== 'ready') return [{ id: 'console-quota', name: '控制台额度', href: consoleUrl,
    meta: { 'needs-console': '未配置控制台会话', unavailable: '暂无额度数据', expired: '控制台会话已过期', error: '读取失败' }[quota.status] }]
  return [
    ...quota.windows.map(row => ({ id: row.id, name: apiQuotaLabels[row.id],
      meta: [apiQuotaValueText(row, true), apiQuotaResetHint(row, quota.updatedAt)].filter(Boolean).join(' · '),
      metric: percentMetric(remainingFraction(row.remaining, row.limit)) })),
    ...(Array.isArray(quota.gifts) ? quota.gifts.map(row => ({ id: `gift-${row.modelId}`, name: `${row.modelId} 赠送额度`,
      meta: `${row.remaining === null ? `已用 ${displayNumber(row.used)}` : `剩余 ${displayNumber(row.remaining)}`}${row.limit === null ? '' : ` / ${displayNumber(row.limit)}`}${row.unit ? ` ${row.unit}` : ''}`,
      metric: percentMetric(remainingFraction(row.remaining, row.limit)) })) : []),
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

/**
 * 生成一个 API Key 渠道的设置页视图。
 *
 * `freeTier` / `preferCreditsWindows` 是**渠道能力声明**，让共享渲染层不必写
 * `id === 'agnes'`：
 * - `freeTier`：该渠道有「免费额度面」（额度恒为 0 是正常态，有 API Key 余额时
 *   余额优先显示），界面据此说「免费用户」而不是「读取失败」。
 * - `preferCreditsWindows`：该渠道同时下发 credits 与 requests 两类窗口时，
 *   以 credits 为主口径，requests 窗口不占主位。
 */
export function apiKeyChannel({
  id, title, host,
  toolsLabel = '多模态能力工具',
  toolsMeta = '语音转写 · 语音合成 · 声音克隆 · 文档解析 · 信息抽取',
  consoleMeta = '用于读取控制台额度',
  freeTier = false,
  preferCreditsWindows = false,
}) {
  const entry = state => state.apikeys?.[id]
  // 能力声明打包一次：共享渲染层只看这两个布尔，不认识渠道名。
  const capabilities = Object.freeze({ freeTier, preferCreditsWindows })
  const withEntry = (state, next) => ({ apikeys: { ...state.apikeys, [id]: next } })
  const provider = {
    id, title,
    // 能力声明统一走 `caps`：共享层（core.js 的 providerCaps / 额度药丸）只读
    // 声明，不必知道具体渠道名。与账号池与自管渠道的形状保持一致。
    caps: {
      freeTier, preferCreditsWindows,
      // 有独立的模型设置文件（`<id>-models.json`）→ 消费「默认输出上限」设置。
      defaultMaxOutput: true,
    },
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
           defaults: baseModelSummary(model),
          tags: [
            model.free && ['免费', 'success'],
            model.paidOnly && ['需付费', 'info', '仅付费余额或 Agent Plan 订阅可用，免费账号不可调用。'],
          ],
          editor: { kind: 'numeric', call: [id + 'SetModelParams', model.id] },
        })),
      }] }
    },
    channel(state) {
      const current = entry(state)
      const usage = current?.balance
      const signingIn = state.pending?.[`console-login:${id}`] === true
      return [
        { id: 'models', name: '模型提供方',
          enabled: current?.hasApiKey ? current.registerProvider : undefined,
          toggle: [id + 'SetEnabled', !current?.registerProvider],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.registerProvider && current.hasApiKey && !current.providerRegistered && ['待注册', 'warn']] },
        { id: 'key', name: 'API Key', meta: host,
          tags: [[current?.hasApiKey ? '已配置' : '待配置', current?.hasApiKey ? 'success' : undefined]],
          form: { kind: 'key', call: [id + 'SetKey'] } },
        // 多模态能力工具（语音转写/合成/克隆、文档解析/抽取）：独立开关，
        // 与模型提供方互不影响；需要 Key 才能注册。
        ...(current?.toolsSupported ? [{
          id: 'tools', name: toolsLabel,
          meta: toolsMeta,
          enabled: current.hasApiKey ? current.toolsEnabled : undefined,
          toggle: [id + 'SetToolsEnabled', !current?.toolsEnabled],
          tags: [current && !current.hasApiKey && ['先配置 API Key', 'warn'],
            current?.toolsEnabled && !current.toolsRegistered && ['待注册', 'warn']],
        }] : []),
        // 控制台会话：额度读取的凭据。浏览器登录自动收割，或粘贴 Cookie。
        ...(current && 'hasConsoleSession' in current ? [{
          id: 'console', name: '控制台会话',
          meta: signingIn ? '浏览器登录进行中，可取消；完成后自动保存' : consoleMeta,
          tags: [[current.hasConsoleSession ? '已配置' : '待配置', current.hasConsoleSession ? 'success' : undefined]],
          actions: signingIn ? [
            { label: '取消登录', call: [id + 'CancelConsoleLogin'] },
          ] : [
            { label: current.hasConsoleSession ? '重新登录' : '浏览器登录', call: [id + 'ConsoleLogin'], primary: !current.hasConsoleSession },
            ...(current.hasConsoleSession ? [{ label: '清除会话', call: [id + 'ClearConsole'], danger: true }] : []),
          ],
          form: { kind: 'console', call: [id + 'SetConsole'], disabled: signingIn },
        }] : []),
        ...(current?.rateLimit?.until > Date.now() ? [{ id: 'rate-limit', name: '限速提醒',
          meta: h(ApiKeyCooldown, { key: current.rateLimit.until, limit: current.rateLimit }) }] : []),
        ...apiQuotaRows(current?.quota, current?.consoleQuotaUrl, capabilities, usage),
        ...(usage && current?.quota?.status !== 'ready' && !(capabilities.freeTier && isFreeTierIdle(current?.quota, usage)) ? [{ id: 'usage', name: '账户用量',
          meta: usage.error ? undefined : `已用 ${apikeyMoney(usage.used, usage.unit)}${usage.limit !== null ? ` / ${apikeyMoney(usage.limit, usage.unit)}` : ''}`,
          metric: !usage.error && Number.isFinite(usage.limit) && usage.limit > 0 && Number.isFinite(usage.used)
            ? percentMetric(remainingFraction(Math.max(0, usage.limit - usage.used), usage.limit)) : undefined,
          tags: [usage.error && ['读取失败', 'warn'], usage.unlimited && ['无限额度', 'info']] }] : []),
      ]
    },
  }
  return provider
}

function createApiKeyActions(provider, { getState, publish, mutate, request }) {
  const id = provider.id, title = provider.title
  const consoleLoginControllers = new Map()
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
      // 与宿主同口径：trim 后仍含空白（粘贴夹带的空格/换行/全角空格）的 Key 必然鉴权失败，
      // 本地先拒并给出可操作提示，不发请求也不存坏 Key。
      if (/\s/.test(apiKey.trim())) { publish({ notice: `${title} API Key 含空格或换行，请检查粘贴内容后重试。` }); return false }
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
    [id + 'SetToolsEnabled'](enabled) {
      return mutate('apikey.setToolsEnabled', { enabled: enabled === true }, {
        progress: enabled ? `正在启用 ${title} 能力工具…` : `正在关闭 ${title} 能力工具…`,
        message: enabled ? `${title} 能力工具已启用，对话中可直接调用。` : `${title} 能力工具已关闭。` })
    },
    [id + 'SetConsole'](cookie) {
      if (typeof cookie !== 'string' || !cookie.trim()) { publish({ notice: '请粘贴控制台 Cookie。' }); return Promise.resolve(false) }
      return mutate('apikey.setConsoleSession', { cookie }, { progress: '正在验证控制台会话…', message: `${title} 控制台会话已保存。` })
    },
    [id + 'ClearConsole']() {
      return mutate('apikey.clearConsoleSession', {}, { progress: '正在清除控制台会话…', message: `${title} 控制台会话已清除。` })
    },
    [id + 'ConsoleLogin']() {
      if (consoleLoginControllers.has(id)) return false
      const controller = new AbortController()
      consoleLoginControllers.set(id, controller)
      const options = {
        scope: `console-login:${id}`, controller, refresh: false,
        progress: `正在打开 ${title} 控制台登录…`,
        message: value => value?.signedIn === true ? `${title} 控制台会话已保存，额度将自动读取。` : `${title} 登录未完成，请重试。`,
        result(value) {
          if (value?.signedIn === true) {
            const state = getState(), current = state.apikeys?.[id]
            if (current) publish({ apikeys: { ...state.apikeys, [id]: { ...current, hasConsoleSession: true, consoleLoginUrl: '' } } })
          }
        },
      }
      const login = mutate('apikey.consoleLogin', {}, options)
      // 轮询快照拿登录地址（宿主 onUrl 写入），显示在控制台会话行；登录结束即停。
      // 与 managed 登录同款守卫：测试 VM 无 setTimeout 时跳过轮询（登录本身不受影响）。
      let polling = true
      const poll = async () => {
        if (!polling || getState().provider !== id) return
        try {
          const value = await request('apikey.snapshot', { provider: id }, controller.signal)
          const url = typeof value?.consoleLoginUrl === 'string' ? value.consoleLoginUrl : ''
          if (polling && url && getState().provider === id) {
            const state = getState(), current = state.apikeys?.[id]
            if (current) publish({ apikeys: { ...state.apikeys, [id]: { ...current, consoleLoginUrl: url } } })
          }
        } catch {}
        if (polling && typeof setTimeout === 'function') setTimeout(poll, 1000)
      }
      if (typeof setTimeout === 'function') setTimeout(poll, 800)
      return login.finally(() => {
        polling = false
        if (consoleLoginControllers.get(id) === controller) consoleLoginControllers.delete(id)
      })
    },
    [id + 'CancelConsoleLogin']() {
      const controller = consoleLoginControllers.get(id)
      if (!controller || controller.signal.aborted) return false
      controller.abort()
      return true
    },
  }
}
