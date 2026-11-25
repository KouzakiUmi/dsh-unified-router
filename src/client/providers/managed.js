// 通用自管多账号渠道前端视图与动作工厂（供 AStudio、CodeArts 共用）。
// 新增同类渠道只需提供 5 行声明（id / title / authMethods / capabilities），不再手写 UI 或状态流。
const EMPTY_MANAGED = Object.freeze({
  enabled: true, registered: false, authMethods: ['browser'], credentialHint: '',
  accounts: [], models: [], modelSource: undefined, loginUrl: '',
})

function managedRemaining(window) {
  return window.used !== null ? Math.min(1, Math.max(0, 1 - window.used / 100)) : null
}

const SOURCE_LABELS = { local: '本机导入', credential: '凭据导入', browser: '浏览器登录' }

function managedConnectionStatus(current) {
  const accounts = current.accounts ?? []
  const active = accounts.filter(account => account.enabled !== false)
  const connected = active.filter(account => account.signedIn).length
  return { connected, label: connected ? `已连接 ${connected} 个` : !accounts.length ? '待添加账号'
    : !active.length ? '账号已停用' : '账号需重新登录' }
}

/**
 * 构造自管渠道的客户端视图。
 *
 * `card`：是否在渠道选择器里显示卡片（默认显示）。置 `false` 用于**停用渠道**——
 * `providers/index.js` 的 `PROVIDERS` 会按 `card !== false` 过滤，于是该渠道的
 * 卡片、模型分组与轮询都不再出现。⚠️ 这个字段必须在这里**显式解构**，否则会被
 * 静默丢弃（早期 `astudio` 传了 `card: false` 却没生效，就是这个原因）。
 */
export function managedChannel({
  id, title, card = true, authMethods = ['browser'], credentialHint = '',
  checkin = false, claimRewards = false, completeTasks = false, accountLinks = [],
  // 渠道专属的界面能力声明（额度窗口/账号行的渲染差异）。合并进生成好的 caps，
  // 共享渲染层只读声明，不写 `=== 'codearts'` 这类分支。
  extraCaps = {},
}) {
  const entry = state => state.managed?.[id]
  const withEntry = (state, next) => ({ managed: { ...state.managed, [id]: next } })

  const provider = {
    id,
    title,
    ...card === false ? { card: false } : {},
    rpcMethods: MANAGED_METHODS,
    caps: {
      dailyReward: checkin,
      claimRewards,
      completeTasks,
      authMethods,
      // 有独立的模型设置文件（`managed-models.json`）→ 消费「默认输出上限」设置。
      defaultMaxOutput: true,
      ...extraCaps,
    },
    /** 该渠道的账号列表在 state 的哪个位置，由渠道自己说（共享层不猜结构）。 */
    accountsOf: state => state.managed?.[id]?.accounts ?? [],
    createActions: context => createManagedActions(provider, context),
    managedAccount: (state, accountId) => (entry(state)?.accounts ?? []).find(account => account.id === accountId),
    removeAction: `${id}Logout`,
    snapshot: {
      methods: ['managed.snapshot', 'managed.models'],
      keep: ['managed'],
      ready: state => entry(state)?.ready === true,
      failed: state => entry(state)?.error === true,
      readFailed: state => withEntry(state, { ...(entry(state) ?? EMPTY_MANAGED), ready: entry(state)?.ready === true, stale: true, error: true }),
      fromRead([snapshot, models], state) {
        const previous = entry(state) ?? EMPTY_MANAGED
        const { managed, stale } = managedSnapshotFrom({ ...snapshot, models: models?.models, modelSource: models?.source }, previous)
        return withEntry(state, { ...managed, loginUrl: previous.loginUrl || managed.loginUrl, ready: true, stale: stale || snapshot?.snapshot?.stale === true, error: false, liveAt: Date.now() })
      },
      apply(get, state) {
        const usage = get('managed.snapshot')
        const models = get('managed.models')
        if (!usage && !models?.value) return {}
        const previous = entry(state) ?? EMPTY_MANAGED
        const liveAt = previous.liveAt ?? 0
        const freshUsage = usage && (!liveAt || !Number.isFinite(usage.at) || usage.at >= liveAt) ? usage : null
        const freshModels = models?.value && (!liveAt || !Number.isFinite(models.at) || models.at >= liveAt) ? models : null
        if (!freshUsage && !freshModels) return {}
        const { managed } = managedSnapshotFrom({
          ...(freshUsage?.value ?? previous),
          accounts: freshUsage?.value?.accounts ?? previous.accounts,
          models: freshModels?.value?.models,
          modelSource: freshModels?.value?.source,
          loginUrl: previous.loginUrl,
        }, previous)
        return {
          ...withEntry(state, {
            ...managed,
            stale: freshUsage ? freshUsage.stale === true : previous.stale === true,
            error: freshUsage ? (freshUsage.stale === true && !freshUsage.value) : previous.error === true,
            ready: !!freshUsage?.value || previous.ready === true,
            liveAt,
          }),
          ...(freshUsage && state.provider === id ? { loading: false } : {}),
        }
      },
    },
    statusFrom(state) {
      const current = entry(state)
      if (!current?.ready && !(current?.accounts?.length)) return null
      const accounts = current.accounts ?? []
      const { connected: signedIn, label: connectionLabel } = managedConnectionStatus(current)
      const closed = current.enabled === false
      const label = closed ? '渠道已关闭' : signedIn ? (current.registered ? '渠道运行中' : '已连接 · 待注册') : connectionLabel
      return {
        closed,
        accounts: signedIn,
        totalAccounts: accounts.length,
        models: (current.models ?? []).length,
        label,
        tone: !closed && current.registered && signedIn && !accounts.some(account => account.error && account.error !== 'upstream_error') ? 'success' : 'warn',
      }
    },
    accounts(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const isAStudio = id === 'astudio'
      const methods = current.authMethods?.length ? current.authMethods : authMethods
      const loginUrl = current.loginUrl || ''
      const pool = summarizePoolCredits(
        current.accounts
          .filter(account => account.enabled !== false && account.signedIn && (isAStudio || account.balance !== null))
          .map(account => ({
            amount: account.balance,
            unit: account.unit || '积分',
            packages: isAStudio
              ? account.windows
              : account.windows.filter(w => w.name !== '总积分包' && w.name !== '免费日额度'),
          })),
        id,
      )
      return {
        ready: current.ready === true || current.accounts.length > 0,
        failed: current.error === true,
        poolSummary: pool.known ? `总计 ${pool.summary}` : '',
        autoCheckin: checkin ? automationEffective(state, id, 'autoCheckin') : undefined,
        login: loginUrl ? { url: loginUrl, cancel: state.pending?.[`login:${id}`] ? [`${id}CancelLogin`] : null } : null,
        importForm: methods.includes('credential') ? {
          hint: current.credentialHint || credentialHint,
          call: [`${id}ImportCredential`],
        } : null,
        actions: [
          methods.includes('local') && { label: '导入本机登录', call: [`${id}ImportLocal`], primary: !methods.includes('browser') },
          methods.includes('browser') && { label: '浏览器登录', call: [`${id}Login`], primary: true },
          methods.includes('credential') && { label: '粘贴凭据', call: ['toggleImportForm', id] },
          ...accountLinks,
        ],
        rows: current.accounts.map(account => {
          const name = account.name || account.uid || account.id
          const remaining = isAStudio ? [] : account.windows.map(managedRemaining).filter(value => value !== null)
          const lowest = remaining.length ? Math.min(...remaining) : null
          const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === id
          const ck = checkin ? checkinEntry(state, id, account.id) : null
          const rw = claimRewards ? taskEntry(state, id, 'claimRewards', account.id) : null
          const metric = account.balance !== null
            ? { value: account.balance, unit: account.unit || '积分' }
            : percentMetric(lowest)
              // 无网页会话时不存在「待更新」——这个渠道本来就不读积分，
              // 显示「待更新」会让人一直等。用破折号表示不适用。
              ?? { value: account.error === 'no_web_session' ? '—' : '额度待更新' }
          return {
            id: account.id,
            name,
            enabled: account.enabled !== false,
            toggle: [`${id}UpdateAccount`, account.id, name, account.enabled === false],
            updatedAt: account.updatedAt,
            tags: [
               account.plan && [account.plan, 'info'],
              account.source && SOURCE_LABELS[account.source] && [SOURCE_LABELS[account.source]],
              account.enabled === false && ['已停用'],
               !account.signedIn && ['凭据失效', 'warn'],
              // `no_web_session` 不是故障：账号能推理，只是没有网页会话因而读不到积分。
              // 按 info 呈现原因，不要挂 warn（那会让用户以为账号坏了）。
              account.error === 'no_web_session' && ['仅推理 Token · 不读积分', 'info'],
              account.error && account.error !== 'no_web_session' && [(account.windows.length || account.balance !== null) ? '上次额度' : '额度读取失败', 'warn'],
              !account.error && current.stale && [(account.windows.length || account.balance !== null) ? '上次额度' : '额度读取失败', 'warn'],
              ck?.tag,
              rw?.tag,
            ],
            metric,
            groups: account.windows.length ? [{
              title: isAStudio ? '额度包' : '额度窗口',
              items: account.windows.map(window => {
                const fraction = isAStudio ? null : managedRemaining(window)
                const unitLabel = window.unit || (isAStudio ? '积分' : '')
                return {
                  label: window.name, fraction,
                  value: fraction === null ? (window.balance ?? window.display) : Math.round(fraction * 100),
                  unit: fraction === null ? (window.unit || (isAStudio ? '积分' : undefined)) : '% 剩余',
                  notes: [
                    fraction !== null && windowRemainingNote(window, unitLabel),
                    window.amount !== null && `已用 ${displayNumber(window.amount)} ${window.unit}`.trim(),
                    (window.expiresAt || isAStudio && window.resetsAt) && `到期 ${displayTime(window.expiresAt || window.resetsAt)}`,
                    !isAStudio && window.resetsAt && `${id === 'codearts' ? '周期结束' : '重置'} ${displayTime(window.resetsAt)}`,
                    window.runsOutAt && `预计用尽 ${displayTime(window.runsOutAt)}`,
                  ],
                }
              }),
            }] : [],
            form: { kind: 'account', account: { id: account.id, nickname: name, enabled: account.enabled !== false }, call: [`${id}UpdateAccount`] },
            actions: [
              checkin && account.signedIn && { label: '签到', accessible: `为 ${name} 签到`, call: [`${id}Checkin`, account.id], disabled: ck?.locked },
               claimRewards && account.signedIn && { label: '领奖励', accessible: `为 ${name} 领取奖励`, call: [`${id}ClaimRewards`, account.id], disabled: account.enabled === false || rw?.locked },
              completeTasks && account.signedIn && { label: '执行任务', accessible: `为 ${name} 执行任务`, call: [`${id}CompleteTasks`, account.id] },
              { label: '移除账号', accessible: `移除 ${name}`, call: ['requestDelete', account.id], danger: true },
            ],
            confirmation: confirmation ? {
              label: `移除「${name}」？`,
              confirmLabel: '移除',
              call: ['confirmDelete', state.pendingDelete],
              cancel: ['cancelDelete'],
            } : null,
          }
        }),
      }
    },
    models(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const models = current.models ?? []
      return {
        groups: [{
          id,
          source: current.modelSource,
          actions: [
            { label: '刷新目录', call: [`${id}RefreshModels`] },
            { label: '恢复推荐', call: [`${id}ResetModels`], disabled: !models.length },
          ],
          rows: models.map(model => ({
            ...model,
            key: modelKey(id, model.id),
            toggle: [`${id}SetModelEnabled`, model.id, !model.enabled],
            defaults: id === 'codearts' ? [baseModelSummary(model),
              model.output > 0 && model.output !== model.defaultMaxOutputLength ? `目录输出 ${formatTokens(model.output)}` : ''].filter(Boolean).join(' · ')
              : baseModelSummary(model),
            tags: [model.rate ? [model.rate.label, model.rate.tone] : model.free && ['免费', 'success']],
            editor: { kind: 'numeric', call: [`${id}SetModelParams`, model.id] },
          })),
        }],
      }
    },
    channel(state) {
      const current = entry(state) ?? EMPTY_MANAGED
      const { connected, label } = managedConnectionStatus(current)
      return [
        {
          id: 'models', name: '模型提供方',
          enabled: current.enabled !== false,
          toggle: [`${id}SetEnabled`, current.enabled === false],
           tags: [current.enabled !== false && current.accounts.some(a => a.signedIn && a.enabled !== false) && !current.registered && ['待注册', 'warn']],
        },
        {
          id: 'accounts', name: '账号连接',
          tags: [[current.ready || current.accounts.length ? label : '待读取', connected ? 'success' : undefined]],
          actions: [{ label: '管理账号', panel: 'accounts' }],
        },
      ]
    },
  }
  return provider
}

function createManagedActions(provider, { getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers, writes, persistCards }) {
  const { id, title } = provider
  let activeLogin = null
  const patchEntry = update => {
    const state = getState()
    const current = state.managed?.[id] ?? EMPTY_MANAGED
    publish({ managed: { ...state.managed, [id]: update(current) } })
    persistCards?.()
  }
  const saveModels = (method, payload, message) => mutate(method, { provider: id, ...payload }, {
    refresh: false,
    scope: `models:${id}`,
    message,
    result(value) {
      if (Array.isArray(value?.models)) {
        patchEntry(cur => ({ ...cur, models: workbuddyModelsFrom(value.models), modelSource: value.source || cur.modelSource }))
      }
    },
  })
  return {
    [`${id}SetModelEnabled`](modelId, enabled) {
      return saveModels('managed.setModelEnabled', { modelId, enabled }, '模型开关已保存。')
    },
    [`${id}SetModelParams`](modelId, params) {
      return saveModels('managed.setModelParams', { modelId, params }, '模型参数已保存。')
    },
    [`${id}ResetModels`]() {
      return saveModels('managed.resetModels', {}, '已恢复推荐模型。')
    },
    [`${id}RefreshModels`]() {
      return saveModels('managed.refreshModels', {}, '模型目录已刷新。')
    },
    [`${id}SetEnabled`](enabled) {
      return mutate('managed.setEnabled', { provider: id, enabled: enabled === true }, {
        refresh: false,
        scope: `channel:${id}`,
        progress: enabled ? `正在启用 ${title}…` : `正在关闭 ${title}…`,
        message: enabled ? `${title} 模型提供方已启用。` : `${title} 模型提供方已关闭。`,
        result(value) {
          patchEntry(cur => ({ ...cur, enabled: value?.enabled !== false, registered: value?.registered === true }))
        },
      })
    },
    [`${id}CancelLogin`]() { activeLogin?.abort() },
    [`${id}Login`]() {
      if (activeLogin) return Promise.resolve(false)
      const controller = new AbortController()
      activeLogin = controller
      writes.add(controller)
      const options = {
        scope: `login:${id}`,
        controller,
        progress: `正在打开 ${title} 浏览器登录…`,
        message: value => value?.signedIn === true ? `已添加 ${title} 账号。` : `${title} 登录未完成，请重试。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'browser', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      }
      const login = mutate('managed.login', { provider: id }, options)
      let polling = true, timer = null
      const fetchUrl = async () => {
        if (!polling || getState().provider !== id) return
        try {
          const value = await request('managed.snapshot', { provider: id, ...(hasSnapshots() ? { localOnly: true } : {}) }, controller.signal)
          const loginUrl = safeLoginUrl(value?.loginUrl)
          if (polling && loginUrl && !isDisposed() && getState().provider === id) {
            patchEntry(cur => ({ ...cur, loginUrl }))
          }
        } catch {}
      }
      const schedule = (delay = 1000) => {
        if (!polling || isDisposed() || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return
        timer = setTimeout(async () => {
          loginUrlTimers.delete(timer)
          timer = null
          await fetchUrl()
          schedule(1000)
        }, delay)
        loginUrlTimers.add(timer)
      }
      schedule(250)
      return login.finally(() => {
        polling = false
        activeLogin = null
        controller.abort()
        writes.delete(controller)
        if (timer !== null) { clearTimeout(timer); loginUrlTimers.delete(timer) }
        if (!isDisposed()) patchEntry(cur => ({ ...cur, loginUrl: '' }))
      })
    },
    [`${id}ImportLocal`]() {
      return mutate('managed.importLocal', { provider: id }, {
        scope: `login:${id}`,
        progress: `正在读取本机 ${title} 登录态…`,
        message: value => value?.signedIn ? `已导入本机 ${title} 账号。` : `未检测到本机 ${title} 登录态。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'local', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      })
    },
    [`${id}ImportCredential`](credential) {
      if (typeof credential !== 'string' || !credential.trim()) {
        publish({ notice: '请输入凭据内容。' })
        return Promise.resolve(false)
      }
      return mutate('managed.importCredential', { provider: id, credential: credential.trim() }, {
        scope: `login:${id}`,
        progress: `正在验证 ${title} 凭据…`,
        message: `已导入 ${title} 账号。`,
        result(value) {
          if (value?.signedIn === true && value.id) {
            patchEntry(cur => ({
              ...cur,
              ready: true,
              enabled: typeof value.enabled === 'boolean' ? value.enabled : cur.enabled,
              registered: typeof value.registered === 'boolean' ? value.registered : cur.registered,
              accounts: [
                ...(cur.accounts ?? []).filter(a => a.id !== value.id),
                { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source: 'credential', signedIn: true, plan: '', balance: null, unit: '', windows: [], updatedAt: Date.now(), error: '' },
              ],
            }))
          }
        },
      })
    },
    [`${id}UpdateAccount`](accountId, nickname, enabled) {
      if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 80) {
        publish({ notice: '请填写 1–80 个字的账号备注。' })
        return Promise.resolve(false)
      }
      return mutate('managed.updateAccount', { provider: id, accountId, patch: { nickname: nickname.trim(), enabled: enabled !== false } }, {
        refresh: false,
        scope: `account:${accountId}`,
        message: '账号设置已保存。',
        result(value) {
          patchEntry(cur => ({
            ...cur,
            accounts: cur.accounts.map(a => a.id === accountId ? { ...a, name: value?.name ?? nickname.trim(), enabled: value?.enabled !== false } : a),
          }))
        },
      })
    },
    [`${id}Logout`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.logout', { provider: id, accountId }, {
        scope: `account:${accountId}`,
        message: `已移除该 ${title} 账号。`,
      })
    },
    [`${id}Checkin`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.checkin', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在签到领取当日积分…',
        message: value => {
          const outcome = text(value?.outcome, 40)
          if (outcome === 'claimed') return `签到成功${typeof value?.credit === 'number' ? `，领取 ${value.credit} 积分` : ''}。`
          if (outcome === 'done' || outcome === 'already-claimed') return '今日已签到。'
           if (outcome === 'inactive') return id === 'codearts' ? '未查到今日签到记录。' : '今日签到活动未开启。'
          if (outcome === 'ineligible') return '当前账号暂不支持签到。'
          if (outcome === 'pending') return '签到待确认。'
          return '签到未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
    [`${id}ClaimRewards`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.claimRewards', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在领取可领奖励…',
        message: value => {
          if (value?.kind === 'claimed') return `领取成功${typeof value?.points === 'number' ? `，获得 ${value.points} 积分` : ''}。`
          if (value?.kind === 'done' || value?.kind === 'empty') return '当前无可领奖励。'
          return '奖励领取未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
    [`${id}CompleteTasks`](accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('managed.completeTasks', { provider: id, accountId }, {
        refresh: false,
        scope: `account:${accountId}`,
        progress: '正在执行平台任务…',
        message: value => {
          if (value?.kind === 'completed') return `已完成 ${value?.completed ?? 1} 项任务。`
          if (value?.kind === 'done' || value?.kind === 'empty') return '今日任务均已完成。'
          return '任务执行未完成。'
        },
        async result() { if (getState().provider === id) await loadManaged(id) },
      })
    },
  }
}
