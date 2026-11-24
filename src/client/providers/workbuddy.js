function buddyRemaining(window) {
  return window.used !== null ? Math.min(1, Math.max(0, 1 - window.used / 100)) : null
}

function workbuddyPoolSummary(accounts) {
  const pool = summarizePoolCredits(
    (accounts ?? []).filter(account => account?.signedIn)
      .map(account => workbuddyAccountCredits(account.windows) ?? { amount: null, unit: '积分' }),
    workbuddy.id,
  )
  return pool.known ? `总计 ${pool.summary}` : ''
}

export const workbuddy = {
  id: 'workbuddy',
  title: 'WorkBuddy',
  rpcMethods: WORKBUDDY_METHODS,
  createActions: createWorkBuddyActions,
  managedAccount: (state, id) => state.workbuddy.accounts.find(account => account.id === id),
  removeAction: 'workbuddyLogout',
  snapshot: {
    methods: ['workbuddy.snapshot', 'workbuddy.models'],
    keep: ['workbuddy', 'workbuddyReady', 'workbuddyStale', 'workbuddyError'],
    ready: state => state.workbuddyReady,
    failed: state => state.workbuddyError,
    readFailed: () => ({ workbuddyStale: true, workbuddyError: true }),
    fromRead([snapshot, models], state) {
      const { workbuddy, stale } = workbuddySnapshotFrom({ ...snapshot, models: models?.models, modelSource: models?.source }, state.workbuddy)
      return { workbuddy, workbuddyReady: true, workbuddyStale: stale || snapshot?.snapshot?.stale === true, workbuddyError: false }
    },
    apply(get, state) {
      const usage = get('workbuddy.snapshot')
      const models = get('workbuddy.models')
      if (!usage && !models?.value) return {}
      return {
        workbuddy: workbuddySnapshotFrom({
          accounts: usage?.value?.accounts ?? state.workbuddy.accounts,
          models: models?.value?.models,
          modelSource: models?.value?.source,
        }, state.workbuddy).workbuddy,
        workbuddyStale: usage?.stale === true,
        workbuddyError: usage?.stale === true && !usage.value,
        workbuddyReady: !!usage?.value || state.workbuddyReady,
        ...(usage && state.provider === workbuddy.id ? { loading: false } : {}),
      }
    },
  },
  statusFrom(state) {
    const { accounts, models } = state.workbuddy
    if (!state.workbuddyReady && !accounts.length) return null
    const signedIn = accounts.filter(account => account.signedIn).length
    return {
      closed: false, accounts: accounts.length, models: models.length,
      label: signedIn ? 'WorkBuddy 已连接' : '待连接',
      tone: signedIn && !accounts.some(account => account.error) ? 'success' : 'warn',
    }
  },
  accounts(state) {
    return {
      ready: state.workbuddyReady || state.workbuddy.accounts.length > 0, failed: state.workbuddyError,
      poolSummary: workbuddyPoolSummary(state.workbuddy.accounts),
      autoCheckin: checkinEnabled(state, workbuddy.id),
      login: state.workbuddyLoginUrl || state.workbuddy.loginUrl
        ? { url: state.workbuddyLoginUrl || state.workbuddy.loginUrl, cancel: state.pending?.[`login:${workbuddy.id}`] ? ['workbuddyCancelLogin'] : null } : null,
      actions: [{ label: '添加账号', call: ['workbuddyLogin'], primary: true }],
      rows: state.workbuddy.accounts.map(account => {
        const name = account.name || account.uid || account.id
        const remaining = account.windows.filter(window => !window.aside).map(buddyRemaining).filter(value => value !== null)
        const lowest = remaining.length ? Math.min(...remaining) : null
        const credits = workbuddyAccountCredits(account.windows)
        const confirmation = state.pendingDelete?.accountId === account.id && state.pendingDelete.provider === 'workbuddy'
        const checkin = checkinEntry(state, workbuddy.id, account.id)
        return {
          id: account.id, name, updatedAt: account.updatedAt,
          // 账号开关：停用账号不参与选号与 429 轮换。
          enabled: account.enabled !== false,
          toggle: ['workbuddySetAccountEnabled', account.id, account.enabled === false],
          tags: [
            account.plan && [account.plan, 'info'],
            account.enabled === false && ['已停用'],
            !account.signedIn && ['待登录', 'warn'],
            (account.error || state.workbuddyStale) && [account.windows.length ? '上次额度' : '额度读取失败', 'warn'],
            checkin?.tag,
          ],
          metric: credits
            ? { value: credits.amount, unit: credits.unit, ...(lowest !== null ? { fraction: lowest } : {}) }
            : (percentMetric(lowest) ?? { value: '额度待更新' }),
          groups: account.windows.length ? [{ title: '额度窗口', items: account.windows.map(window => {
            const fraction = buddyRemaining(window)
            const unitText = displayCreditUnit(window.unit)
            const rem = windowRemainingAmount(window)
            return {
              label: window.name, fraction,
              value: rem !== null ? (window.limit > 0 ? `${displayNumber(rem)} / ${displayNumber(window.limit)}` : rem)
                : fraction === null ? window.balance : Math.round(fraction * 100),
              unit: rem !== null ? (unitText || '积分') : (fraction === null ? (unitText || window.unit) : '% 剩余'),
              notes: [
                rem !== null ? (fraction !== null && `剩余 ${Math.round(fraction * 100)}%`) : (fraction !== null && windowRemainingNote(window, unitText)),
                window.amount !== null && `已用 ${displayNumber(window.amount)} ${unitText}`.trim(),
                window.resetsAt && `重置 ${displayTime(window.resetsAt)}`,
                window.runsOutAt && `到期 ${displayTime(window.runsOutAt)}${window.runsOut > 0 ? ` · ${displayNumber(window.runsOut)} ${unitText}`.trimEnd() : ''}`,
              ],
            }
          }) }] : [],
          actions: [
            account.signedIn && { label: '签到', accessible: `为 ${name} 签到`, call: ['workbuddyCheckin', account.id], disabled: checkin?.locked },
            { label: '退出登录', accessible: `退出 ${name}`, call: ['requestDelete', account.id], danger: true },
          ],
          confirmation: confirmation ? { label: `退出「${name}」？`, confirmLabel: '退出登录',
            call: ['confirmDelete', state.pendingDelete], cancel: ['cancelDelete'] } : null,
        }
      }),
    }
  },
  models(state) {
    const { models, modelSource } = state.workbuddy
    return { groups: [{
      id: 'workbuddy',
      source: modelSource,
      actions: [
        { label: '刷新目录', call: ['refreshSettings'] },
        { label: '恢复推荐', call: ['workbuddyResetModels'], disabled: !models.length },
      ],
      rows: models.map(model => ({
        ...model, key: modelKey('workbuddy', model.id),
        toggle: ['workbuddySetModelEnabled', model.id, !model.enabled],
         defaults: baseModelSummary(model),
        tags: [model.rate ? [model.rate.label, model.rate.tone] : model.free && ['免费', 'success']],
        editor: { kind: 'numeric', call: ['workbuddySetModelParams', model.id] },
      })),
    }] }
  },
  channel(state) {
    const connected = state.workbuddy.accounts.some(account => account.signedIn)
    return [{ id: 'login', name: '浏览器授权', tags: [[connected ? '已连接' : '待连接', connected ? 'success' : undefined]],
      actions: [{ label: '管理账号', panel: 'accounts' }] }]
  },
}

function createWorkBuddyActions({ getState, isDisposed, hasSnapshots, request, publish, mutate, loadManaged, loginUrlTimers }) {
  let activeLogin = null
  const saveModels = (method, payload, message) => mutate(method, payload, { refresh: false, message, result(value) {
    const state = getState()
    if (state.provider === workbuddy.id && Array.isArray(value?.models)) {
      publish({ workbuddy: { ...state.workbuddy, models: workbuddyModelsFrom(value.models), modelSource: value.source || state.workbuddy.modelSource } })
    }
  } })
  return {
    workbuddySetModelEnabled(modelId, enabled) {
      return saveModels('workbuddy.setModelEnabled', { modelId, enabled }, '模型开关已保存。')
    },
    workbuddySetModelParams(modelId, params) {
      return saveModels('workbuddy.setModelParams', { modelId, params }, '模型参数已保存。')
    },
    workbuddyResetModels() {
      return saveModels('workbuddy.resetModels', {}, '已恢复推荐模型。')
    },
    // WorkBuddy 动作：登录是长操作（主机轮询浏览器授权，最长约 5 分钟），
    // 复用 mutate 链路——busy 期间按钮禁用，完成后 load 自动重读快照。
    // 登录地址由主机的阻塞 login 生成、经快照 loginUrl 字段透出：登录 pending
    // 期间每 2 秒补读一次快照直到结算（authorize 首跳可能超过数秒，只补读
    // 固定两次会永远错过地址）；定时器统一登记，dispose 时清理。
    workbuddyCancelLogin() { activeLogin?.abort() },
    workbuddyLogin() {
      if (activeLogin || getState().loading) return Promise.resolve(false)
      const controller = new AbortController()
      activeLogin = controller
      const options = { progress: '正在准备 WorkBuddy 登录…',
        controller, message: value => value?.signedIn === true ? '已添加 WorkBuddy 账号。' : 'WorkBuddy 登录未完成，请重试。' }
      const login = mutate('workbuddy.login', {}, options)
      let polling = true, timer = null
      const fetchUrl = async () => {
        if (!polling || getState().provider !== workbuddy.id) return
        try {
          const value = await request('workbuddy.snapshot', { provider: workbuddy.id, ...(hasSnapshots() ? { localOnly: true } : {}) }, controller.signal)
          if (polling && value?.loginUrl && !isDisposed() && getState().provider === workbuddy.id) publish({ workbuddyLoginUrl: value.loginUrl })
        } catch { /* 地址读取失败不影响登录本身；下一轮补读或面板回退兜底。 */ }
      }
      const schedule = () => {
        if (!polling || isDisposed() || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return
        timer = setTimeout(async () => {
          loginUrlTimers.delete(timer)
          timer = null
          await fetchUrl()
          schedule()
        }, 2000)
        loginUrlTimers.add(timer)
      }
      schedule()
      // 登录结束（成功/失败/取消）后停止补读并清掉地址，避免旧地址复活。
      return login.finally(() => {
        polling = false
        controller.abort()
        activeLogin = null
        if (timer !== null) { clearTimeout(timer); loginUrlTimers.delete(timer) }
        if (!isDisposed() && getState().provider === workbuddy.id) publish({ workbuddyLoginUrl: null })
      })
    },
    // 退出/签到都按账号 id 操作：WorkBuddy 是自管多账号，没有「当前账号」概念。
    workbuddyLogout(accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('workbuddy.logout', { accountId }, { message: '已退出该 WorkBuddy 账号。' })
    },
    /**
     * 账号开关：停用后该账号不参与选号与 429 轮换（凭据保留，重新启用即可用）。
     * WorkBuddy 每个账号的 DS-V4.1-Flash 额度用尽后上游回 429，此开关用于
     * 主动把耗尽的账号摘出轮换池。
     */
    workbuddySetAccountEnabled(accountId, enabled) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      if (typeof enabled !== 'boolean') return Promise.resolve(false)
      return mutate('workbuddy.setAccountEnabled', { accountId, enabled }, {
        message: enabled ? '已启用该 WorkBuddy 账号。' : '已停用该 WorkBuddy 账号（不再参与选号）。',
      })
    },
    workbuddyCheckin(accountId) {
      if (typeof accountId !== 'string' || !accountId) return Promise.resolve(false)
      return mutate('workbuddy.checkin', { accountId }, { refresh: false, progress: '正在签到领取当日积分…',
        // 签到摘要按主机契约 {outcome, credit, streak} 生成；outcome 枚举与
        // lib/workbuddy.js 的 CHECKIN_OUTCOMES 一致（claimed/done/inactive/
        // ineligible/failed），未知值不谎报成功。完成后重读快照刷新状态。
        message: value => {
          const outcome = text(value?.outcome, 40)
          if (outcome === 'claimed') return `签到成功${typeof value?.credit === 'number' ? `，领取 ${value.credit} 积分` : ''}${typeof value?.streak === 'number' ? `，已连续 ${value.streak} 天` : ''}。`
          if (outcome === 'done') return '今日已签到。'
          if (outcome === 'inactive') return '今日签到活动未开启，暂无可领取积分。'
          if (outcome === 'ineligible') return '当前登录方式不支持签到。'
          if (outcome === 'failed') return '签到未完成。'
          if (outcome === 'pending') return '签到待确认。'
          return '签到结果未知，请刷新用量确认。'
        },
        async result(_value, provider) { if (getState().provider === provider) await loadManaged(workbuddy.id) } })
    },
  }
}
