const quotaRoute = id => {
  const pool = isRaccoonFamily(id) ? 'raccoon' : id
  const provider = providerById(pool)
  if (!provider) return null
  // 额度形态直接用规格表的 `kind`，不再按渠道名推断。`type` 沿用界面既有词汇：
  // `apikey` → `api`、`workbuddy` → `buddy`，其余同名（资源表沿用这些键）。
  const kind = channelSpec(id)?.kind ?? channelSpec(pool)?.kind ?? 'managed'
  const type = kind === 'apikey' ? 'api' : kind === 'workbuddy' ? 'buddy' : kind
  // 家族成员（`raccoon-pro`）不在 `PROVIDERS` 里（没有卡片），标题要从全部注册渠道取。
  return { provider: pool, type, title: registeredById(id)?.title ?? provider.title }
}

const quotaResources = {
  pack: ['account.list', 'credits.balances'], api: ['apikey.snapshot'],
  buddy: ['workbuddy.snapshot'], managed: ['managed.snapshot'], plan: ['plan.snapshot'],
}

// One poller per visible provider pool, shared by any mounted composer. The
// single-resource snapshot reads use the host cache and do not start collectors.
function createQuotaSnapshotStore(call, visible = globalThis.document, focus = globalThis.window) {
  const pools = new Map()
  return route => {
    if (pools.has(route.provider)) return pools.get(route.provider)
    let state = { loading: true, refreshing: false, failed: false, entries: [] }, running, timer
    const listeners = new Set()
    const publish = patch => { state = { ...state, ...patch }; for (const notify of listeners) notify() }
    const read = (manual = false) => {
      if (!listeners.size || running || visible?.hidden || visible?.visibilityState === 'hidden') return
      const controller = new AbortController()
      running = controller
      if (manual) publish({ refreshing: true })
      const timeout = setTimeout(() => controller.abort(), 8_000)
      // 小浣熊家族额外读自动化配置（统一模型开关决定药丸显示全部账号还是按套餐分侧）。
      // automation.status 是全局资源（键为 `automation/automation.status`），
      // 请求的 provider 必须是 'automation'，不能跟渠道走。
      // 额外资源由渠道声明（如 CodeArts 要读模型目录挑免费/付费窗口、Raccoon 要读
      // 统一模型开关）。缺省就只读本形态的基础资源。
      const extra = providerCaps(route.provider)?.quotaExtraResources
      const requested = (Array.isArray(extra) && extra.length
        ? [...quotaResources[route.type], ...extra] : quotaResources[route.type]).map(resource =>
        [resource, resource === 'automation.status' ? 'automation' : route.provider])
      void Promise.all(requested.map(async resource => {
        const [resourceId, provider] = resource
        const reply = await call('settings.snapshot', { resource: resourceId, provider }, controller.signal)
        if (reply?.ok !== true) throw new Error('读取失败')
        return reply.value && typeof reply.value === 'object' ? reply.value : null
      })).then(entries => {
        if (running === controller && !controller.signal.aborted) publish({ loading: false, failed: false, entries })
      }, () => {
        if (running === controller) publish({ loading: false, failed: true })
      }).finally(() => {
        clearTimeout(timeout)
        if (running === controller) {
          running = null
          if (state.refreshing || controller.signal.aborted) publish({ refreshing: false,
            ...(controller.signal.aborted ? { loading: false, failed: true } : {}) })
        }
      })
    }
    const refresh = () => read()
    const store = {
      getSnapshot: () => state,
      refresh: () => read(true),
      subscribe(notify) {
        listeners.add(notify)
        if (listeners.size === 1) {
          visible?.addEventListener?.('visibilitychange', refresh)
          focus?.addEventListener?.('focus', refresh)
          timer = setInterval(refresh, 5_000)
          refresh()
        }
        return () => {
          listeners.delete(notify)
          if (listeners.size) return
          visible?.removeEventListener?.('visibilitychange', refresh)
          focus?.removeEventListener?.('focus', refresh)
          clearInterval(timer)
          const controller = running
          running = null
          controller?.abort()
          if (state.refreshing) publish({ refreshing: false })
        }
      },
    }
    pools.set(route.provider, store)
    return store
  }
}

const quotaPercent = fraction => `${fraction > 0 && fraction < 0.01 ? '<1' : Math.floor(fraction * 100 + 1e-9)}%`
const quotaValue = (value, unit) => `${displayNumber(value)}${unit ? ` ${unit}` : ''}`
/**
 * 把一个额度窗口渲染成详情行。渠道差异全部来自 `caps.quotaWindow`：
 * - `creditUnit`：单位要归一（上游给的是 credits / 点数这类原始文本）
 * - `noFraction`：算不出可信百分比 → 不画进度条、不占主位、值只显示剩余量
 * - `resetKind`：这一刻算「重置」还是「周期结束」，或干脆不显示（`none`）
 */
function quotaWindow(window, caps) {
  const style = caps?.quotaWindow ?? {}
  const { limit, used, unit } = window
  const unitText = style.creditUnit ? displayCreditUnit(unit) : unit
  const remaining = windowRemainingAmount(window)
  const fraction = style.noFraction ? null : (remainingFraction(remaining, limit) ?? (used === null ? null : Math.min(1, Math.max(0, 1 - used / 100))))
  const expiry = window.expiresAt || (style.noFraction ? window.resetsAt : '') || window.runsOutAt
  const resetKind = style.resetKind ?? 'reset'
  return {
    label: window.name, fraction, primary: !style.noFraction && !window.aside, meter: !style.noFraction && Number.isFinite(fraction),
    value: style.noFraction
      ? (remaining !== null ? quotaValue(remaining, unitText || '积分') : window.display || '')
      : (remaining !== null ? `${displayNumber(remaining)}${limit > 0 ? ` / ${quotaValue(limit, unitText)}` : unitText ? ` ${unitText}` : ''}`
        : fraction !== null ? quotaPercent(fraction) : window.display ? `已用 ${window.display}` : ''),
    reset: resetKind === 'reset' ? window.resetsAt : '',
    cycleEnd: resetKind === 'cycleEnd' ? window.resetsAt : '', expires: expiry,
    expiringAmount: expiry === window.runsOutAt && window.runsOut > 0 ? quotaValue(window.runsOut, unitText) : '',
  }
}

function quotaShortWindowLabel(label) {
  const tail = String(label || '').split(' · ').at(-1).trim()
  if (/^(?:周积分|周额度|每周请求数|本周)$/.test(tail)) return '周'
  if (/^7\s*天积分$/.test(tail)) return '7 天'
  if (/^5\s*小时(?:积分|\s*Credits|请求数|额度)?$/i.test(tail)) return '5 小时'
  if (/^(?:月度\s*Credits|月度\s*Token|月度额度|月额度|本月)$/i.test(tail)) return '月度'
  return tail.replace(/(?:积分|额度|请求数|\s*Credits|\s*Token)$/i, '').trim() || tail
}

function quotaAccountSummary(row) {
  const primaryMetrics = (row?.details ?? []).filter(item => item.primary !== false && Number.isFinite(item.fraction))
  const tight = primaryMetrics.length ? Math.min(...primaryMetrics.map(item => item.fraction)) : null
  const summary = tight !== null ? quotaPercent(tight) : Number.isFinite(row?.amount)
    ? row.money ? apikeyMoney(row.amount, 'CNY') : quotaValue(row.amount, row.unit)
    : row?.plan || ''
  const metrics = primaryMetrics.slice(0, 3)
  const windowSummary = metrics.length > 1
    ? metrics.map(item => `${quotaShortWindowLabel(item.label)} ${quotaPercent(item.fraction)}`).join(' · ')
    : ''
  const tone = tight ?? (Number.isFinite(row?.toneFraction) ? row.toneFraction : null)
  return { tight, tone, summary, windowSummary, metrics }
}

function quotaPillData(id, type, snapshot, selection, viewedId, model) {
  const [first, second] = snapshot.entries
  let rows = [], empty = ''
  // 渠道能力声明读一次，后面所有渠道差异都从这里取。
  const caps = providerCaps(id)
  // 家族成员代表哪一侧（`free` / `pro`）：账号按 plan 分流用。
  const familySide = caps?.familySide ?? null
  // 统一模型模式下小浣熊药丸展示全部账号（服务账号可能是任意套餐）；
  // 订阅面（raccoon-pro）只服务旧会话，保持按套餐过滤。
  const unified = caps?.unifiedModels === true && snapshot.entries[2]?.value?.config?.raccoonUnifiedModels === true
  if (type === 'pack') {
    const balances = new Map(balancesFrom(second?.value).map(row => [row.accountId, row]))
    rows = accountsFrom(first?.value, isRaccoonFamily(id) ? 'raccoon' : id)
      .filter(account => account.enabled && (!isRaccoonFamily(id) || unified || (account.plan === 'pro') === (familySide === 'pro')))
      .map(account => {
        const bal = balances.get(account.id)
        const packages = bal?.packages ?? []
        const shownPackages = displayCreditPackages(packages)
        return { id: account.id, label: account.nickname, at: bal?.updatedAt, stale: bal?.stale,
          // 订阅类型文案优先（TRAE 的 Free/Pro/…）；Raccoon 家族回落到 plan 枚举映射。
          plan: unified ? '' : (account.planLabel || (account.plan === 'free' ? '体验版' : account.plan === 'pro' ? '订阅' : '')),
          amount: bal?.total ?? null, unit: '积分', packages, details: shownPackages.map(pkg => ({
            label: pkg.name || '额度包', value: pkg.remaining === null ? '' : quotaValue(pkg.remaining, pkg.unit),
            expires: pkg.active === false ? null : pkg.expiresAt, note: pkg.active === false ? '已失效' : '',
          })) }
      })
  } else if (type === 'plan') {
    const quota = first?.value?.quota
    const pools = senseNovaQuotaPools(quota, model)
    const details = pools.flatMap((pool, poolIndex) => senseNovaQuotaDetails(pool).map(detail => pools.length === 1 ? detail : {
      ...detail, label: `${pool.name || '积分池'} · ${detail.label}`, ...(poolIndex > 0 ? { primary: false } : {}),
    }))
    if (details.length) rows = [{ id, label: pools.length === 1 ? pools[0].name || '积分池' : '积分池', plan: quota.plan,
      at: quota.updatedAt, amount: null, details }]
    else empty = senseNovaQuotaStatus[quota?.status] || (quota?.status === 'ready' && !pools.length ? '当前模型没有匹配的积分池' : '')
  } else if (type === 'api') {
    const quota = projectApiKeyQuota(first?.value?.quota)
    const balance = apikeyBalanceFrom(first?.value?.balance)
    if (caps?.freeTier && isFreeTierIdle(quota, balance)) {
      rows = [{
        id, label: '账户状态', plan: '免费用户', amount: null,
        at: quota?.updatedAt ?? balance?.updatedAt ?? first?.value?.updatedAt ?? null,
        details: [{ label: '账户类型', value: '免费用户', note: '额度读取为 0', fraction: null, primary: false, meter: false }],
      }]
    } else if (quota?.status === 'ready') {
      rows = [{ id, label: '控制台额度', amount: quota.balance, money: true, at: quota.updatedAt,
        details: [
          ...quota.windows.map(row => ({ label: apiQuotaLabels[row.id], fraction: remainingFraction(row.remaining, row.limit),
              note: apiQuotaResetHint(row, quota.updatedAt),
              primary: !caps?.preferCreditsWindows || !row.id.endsWith('-requests') || !quota.windows.some(item => item.id.endsWith('-credits') && item.limit > 0),
              value: apiQuotaValueText(row, false) })),
          ...(quota.gifts ?? []).filter(row => row.modelId === model).map(row => ({ label: '模型赠送额度', primary: false,
            value: row.remaining === null ? `已用 ${quotaValue(row.used, row.unit)}` : quotaValue(row.remaining, row.unit) })),
        ] }]
    } else if (caps?.freeTier && balance && !balance.error) {
      const fraction = Number.isFinite(balance.limit) && balance.limit > 0 && Number.isFinite(balance.used)
        ? remainingFraction(Math.max(0, balance.limit - balance.used), balance.limit) : null
      rows = [{
        id, label: '账户用量', plan: balance.unlimited ? '无限额度' : '', amount: null,
        at: balance.updatedAt ?? first?.value?.updatedAt ?? null,
        details: [{
          label: '已用额度', fraction, primary: fraction !== null, meter: fraction !== null,
          value: `${apikeyMoney(balance.used, balance.unit)}${balance.limit !== null ? ` / ${apikeyMoney(balance.limit, balance.unit)}` : ''}`,
        }],
      }]
    } else empty = { 'needs-console': '未配置控制台会话', expired: '控制台会话已过期', error: '读取失败' }[quota?.status] ?? ''
  } else {
    const project = type === 'buddy' ? workbuddyAccountFrom : managedAccountFrom
    const raw = Array.isArray(first?.value?.accounts) ? first.value.accounts : []
    const catalog = snapshot.entries[1]?.value?.models
    // `gateWindowsByModelFree`：该渠道的额度窗口按「免费 / 付费」分流，得先按当前
    // 模型在目录里查它的免费属性；模型属性未知时宁可先不显示窗口，避免把付费窗口
    // 当成免费额度报给用户（真实缺陷：用户以为有免费额度却调不动）。
    const accountStyle = caps?.quotaAccount ?? {}
    const gateByModel = accountStyle.gateWindowsByModelFree === true
    const gatedModel = gateByModel && Array.isArray(catalog) ? catalog.find(row => row?.id === model) : null
    const modelUnknown = gateByModel && model && typeof gatedModel?.free !== 'boolean'
    rows = raw.slice(0, 8).map(project).filter(account => account?.signedIn && account.enabled !== false).map(account => {
      const windows = (modelUnknown ? [] : account.windows).filter(window => !model || (!window.models.length || window.models.includes(model)) && !window.notModels.includes(model))
        .filter(window => !gatedModel || (window.name === '免费日额度') === (gatedModel.free === true))
      const details = windows.map(window => quotaWindow(window, caps))
      const wbCredits = type === 'buddy' ? workbuddyAccountCredits(windows) : null
      // `windowsAsCredits`：窗口本身就是积分包（没有独立的 packages 数组），
      // 因此不占详情主位、金额按窗口求和、packages 直接用窗口列表。
      const windowsAsCredits = accountStyle.windowsAsCredits === true
      if (windowsAsCredits || wbCredits) for (const detail of details) detail.primary = false
      if (gatedModel && !gatedModel.free) {
        for (const detail of details) detail.primary = detail.label === '总积分包'
      }
      const pkgBalances = windows.map(windowRemainingAmount).filter(value => Number.isFinite(value))
      const derivedAmount = wbCredits?.amount ?? account.balance ?? (windowsAsCredits && pkgBalances.length ? pkgBalances.reduce((a, b) => a + b, 0) : null)
      return { id: account.id, label: account.name, plan: account.planLabel || account.plan,
        amount: modelUnknown || gatedModel?.free ? null : derivedAmount,
        toneFraction: wbCredits?.fraction ?? null,
        packages: windowsAsCredits ? windows : (wbCredits?.packages ?? []),
        unit: wbCredits?.unit || account.unit || '积分', at: account.updatedAt, stale: Boolean(account.error), details }
    })
  }
  const serving = type !== 'api' && selection?.accountId ? rows.find(row => row.id === selection.accountId) ?? null : null
  const primary = serving ?? (rows.length === 1 ? rows[0] : null)
  const viewed = rows.find(row => row.id === viewedId) ?? serving ?? rows[0] ?? null
  const accountMetrics = new Map(rows.map(row => [row, quotaAccountSummary(row)]))
  const isCreditPool = type === 'pack' || caps?.quotaAccount?.windowsAsCredits === true
    || (type === 'buddy' && rows.some(row => Number.isFinite(row.amount)))
  const pool = isCreditPool ? summarizePoolCredits(rows, id) : null
  const showPoolTrigger = !serving && pool?.known && (rows.length > 1 || (type === 'pack' && pool.hasPackages))
  const showPoolPopover = !serving && pool?.known && (rows.length > 1 || (isCreditPool && pool.hasPackages))
  const pill = showPoolTrigger
    ? { summary: quotaValue(pool.total, pool.unit), windowSummary: '', tight: null, tone: null, metrics: [] }
    : (accountMetrics.get(primary) ?? { summary: rows.length > 1 ? `${rows.length} 个账号` : '', windowSummary: '', tight: null, tone: null, metrics: [] })
  const staleOf = row => !!(snapshot.failed || (type === 'pack' ? second?.stale : first?.stale) || (row ? row.stale : rows.some(item => item.stale)))
  const at = Number.isFinite(viewed?.at) && viewed.at > 0 && viewed.at <= Date.now() ? viewed.at : null
  return { rows, serving, viewed, pool, showPool: showPoolPopover, accountMetrics, ...pill, at,
    stale: staleOf(primary), detailStale: staleOf(viewed),
    empty: empty || (snapshot.loading ? '读取中…' : snapshot.failed || first?.stale || second?.stale ? '读取失败' : '暂无额度数据') }
}
