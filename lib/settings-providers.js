import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, PLAN_PROVIDER_ID, WORKBUDDY_PROVIDER_ID, APIKEY_PROVIDER_IDS, APIKEY_METHODS, MANAGED_PROVIDER_IDS, MANAGED_METHODS, AUTOMATION_METHODS, LOOMY_ROUTE_METHODS } from './rpc.js'
import { publicLoomyRouteStatus } from './loomy-route.js'
import { profileSegment } from '../vendor/sensenova-token-plan/index.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { MANAGED_MODEL_WRITES } from './managed-models.js'
import { publicAutomationConfig } from './automation-settings.js'
import { quotaPriorityProviders } from './quota-priority.js'

export const settingsResourceKey = (method, provider) => method === 'provider.status' ? method : provider + '/' + method

export function settingsSnapshotFile(host) {
  const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'state')
  const profile = profileSegment(host)
  return join(root, ...(profile ? [profile] : []), 'dsh-unified-router', 'settings.json')
}

const clock = () => Date.now()
const row = (value, stale = false, at = clock()) => ({ value, at, stale })

function mergeBalances(current, previous) {
  const old = new Map(previous?.value?.accounts.map(account => [account.accountId, account]))
  const accounts = current.accounts.map(account => {
    const prior = old.get(account.accountId)
    return account.error && prior?.balance ? { ...account, balance: prior.balance, updatedAt: prior.updatedAt } : {
      ...account, updatedAt: account.balance && !account.error ? clock() : null,
    }
  })
  const refreshed = accounts.length === 0 || accounts.some(account => account.balance && !account.error)
  return row({ accounts }, false, refreshed ? clock() : previous?.at ?? clock())
}

function mergeWorkBuddy(current, previous) {
  const old = new Map(previous?.value?.accounts.map(account => [account.id, account]))
  const accounts = current.accounts.map(account => {
    const prior = old.get(account.id)
    if (!prior?.windows.length || !['upstream_error', 'auth_error'].includes(account.error)) return account
    return { ...account, windows: prior.windows, plan: account.plan || prior.plan, updatedAt: prior.updatedAt }
  })
  return row({ accounts })
}

function mergeManaged(current, previous) {
  const old = new Map((previous?.value?.accounts ?? []).map(account => [account.id, account]))
  const accounts = (current.accounts ?? []).map(account => {
    const prior = old.get(account.id)
    if (!prior || !['upstream_error', 'auth_error'].includes(account.error)) return account
    const keepWindows = prior.windows?.length ? prior.windows : account.windows
    const keepBalance = prior.balance !== null && prior.balance !== undefined ? prior.balance : account.balance
    if (!keepWindows?.length && keepBalance === null) return account
    return { ...account, windows: keepWindows, balance: keepBalance, plan: account.plan || prior.plan, updatedAt: prior.updatedAt }
  })
  return row({ ...current, accounts })
}

export function settingsResources(read, publicResult, { managedIds = MANAGED_PROVIDER_IDS } = {}) {
  const resources = new Map()
  function register(method, provider, { merge, payload = { provider }, project = value => publicResult(method, value), restore = project } = {}) {
    resources.set(settingsResourceKey(method, provider), {
      collect: async signal => project(await read(method, payload, signal)),
      restore,
      merge,
    })
  }
  register('provider.status', '', { payload: { providers: PROVIDERS.map(provider => provider.id) } })
  for (const provider of PROVIDERS) {
    // 模型目录作为宿主中间态快照持久化（打开设置页和重启后秒出目录，后台自动更新）。
    register('model.list', provider.id)
    register('model.params', provider.id)
    if (provider.accountPool === false) continue
    register('account.list', provider.id, { project: value => publicResult('account.list', {
      accounts: value?.accounts?.filter(account => account.provider === provider.id),
    }) })
    register('credits.balances', provider.id, { merge: mergeBalances })
  }
  register('loomy.routeStatus', 'loomy')
  register('plan.snapshot', PLAN_PROVIDER_ID)
  register('workbuddy.snapshot', WORKBUDDY_PROVIDER_ID, {
    project: value => ({ accounts: publicResult('workbuddy.snapshot', value).accounts }),
    merge: mergeWorkBuddy,
  })
  register('workbuddy.models', WORKBUDDY_PROVIDER_ID)
  // API Key 渠道：每渠道一份 <id>/apikey.snapshot；collect 经 read → collectSnapshot。
  for (const id of APIKEY_PROVIDER_IDS) register('apikey.snapshot', id)
  // 自管多账号渠道：每渠道一份 snapshot + models（按注册表自动装配，无需手改核心文件）。
  for (const id of managedIds) {
    register('managed.snapshot', id, {
      project: value => {
        const { loginUrl: _omit, ...rest } = publicResult('managed.snapshot', value)
        return rest
      },
      merge: mergeManaged,
    })
    register('managed.models', id)
  }
  return resources
}

export function settingsCheckinAdapters({ standalone, rpc, workbuddy, managed }) {
  const adapters = new Map()
  for (const { id, claim } of PROVIDERS) {
    if (!standalone || !claim) continue
    adapters.set(id, {
      resetHour: id === 'qodercn' ? 10 : 0,
      async list(signal) {
        const { accounts } = await rpc('account.list', { provider: id, forCheckin: true }, signal)
        return accounts.filter(account => account.provider === id && typeof account.id === 'string' && account.id)
          .map(account => ({ id: account.id, name: account.nickname }))
      },
      async claim(accountId, signal) {
        const { results } = await rpc('credits.claimAll', { provider: id, accountIds: [accountId] }, signal)
        return results.find(row => row.accountId === accountId)?.outcome
      },
      ...(['trae', 'qodercn'].includes(id) ? {
        async verify(accountId, signal) {
          const value = await rpc('credits.status', { provider: id, accountId }, signal)
          const status = value?.accounts?.find(row => row.accountId === accountId)?.status
          return { kind: !status ? 'failed' : status.todayCheckedIn ? 'already-claimed' : status.active ? 'pending' : 'inactive' }
        },
      } : {}),
    })
  }
  adapters.set(WORKBUDDY_PROVIDER_ID, {
    list: signal => workbuddy.listCheckinAccounts(signal),
    verify: (accountId, signal) => workbuddy.verifyCheckin(accountId, signal),
    async claim(accountId, signal) {
      const result = await rpc('workbuddy.checkin', { provider: WORKBUDDY_PROVIDER_ID, accountId }, signal)
      const kind = result.outcome === 'done' ? 'already-claimed' : result.outcome
      return { kind, credit: result.credit, streak: result.streak, unsubmitted: result.unsubmitted === true }
    },
  })
  if (managed) {
    for (const [id, entry] of managed.entries()) {
      if (!entry.supportsCheckin) continue
      adapters.set(id, {
        resetHour: entry.checkinResetHour ?? 0,
        list: signal => entry.listAccounts(signal),
        ...(entry.supportsCheckinStatus ? {
          async verify(accountId, signal) {
            const result = await entry.call('managed.checkinStatus', { provider: id, accountId }, signal)
            return { kind: result.outcome === 'done' ? 'already-claimed' : result.outcome, credit: result.credit }
          },
        } : {}),
        async claim(accountId, signal) {
          const result = await rpc('managed.checkin', { provider: id, accountId }, signal)
          const kind = result.outcome === 'done' ? 'already-claimed' : result.outcome
          return { kind, credit: result.credit, streak: result.streak, unsubmitted: result.unsubmitted === true }
        },
      })
    }
  }
  return adapters
}

export function settingsTaskAdapters({ standalone, rpc, managed }) {
  const adapters = new Map()
  // 账号池渠道的 onboarding 新手/登录奖励（Loomy、Raccoon 家族）。
  // ⚠️ 同一 `onboarding.claim` 端点下两种语义必须归到不同模式：
  // - Loomy 是**主动上报任务完成**（POST tasks/complete 逐项置位并加分），
  //   归 `completeTasks` —— 默认关闭，须显式开启 autoCompleteTasks 才会自动执行；
  // - Raccoon 是**幂等的登录奖励领取**（无副作用被动领积分），
  //   留在 `claimRewards` —— 默认开启的自动领取照常生效。
  // 两者都是账号级一次性事项（`doneScope: 'account'`）：新手任务与登录奖励
  // 每号只发生一次，`verify*` 走只读的 `onboarding.status` 供调度器查询已办状态。
  const onboardingVerify = async (id, accountId, signal) => {
    let result
    try {
      result = await rpc('onboarding.status', { provider: id, accountId }, signal)
    } catch {
      return { kind: 'failed' }
    }
    const entries = Object.entries(result?.tasks ?? {}).filter(([, value]) => typeof value === 'boolean')
    if (entries.length === 0) return { kind: 'failed' }
    const completed = entries.filter(([, done]) => done).length
    return {
      kind: completed === entries.length ? 'done' : 'pending',
      completed,
      points: Number.isFinite(result?.earned) ? result.earned : undefined,
    }
  }
  if (standalone) {
    for (const id of ['loomy', 'raccoon']) {
      adapters.set(id, {
        resetHour: 0,
        // 一次性事项：账本幂等按账号粒度判定（非每日周期）。
        doneScope: 'account',
        async list(signal) {
          const { accounts } = await rpc('account.list', { provider: id }, signal)
          return (accounts ?? []).filter(account => account.provider === id && account.enabled !== false)
            .map(account => ({ id: account.id, name: account.nickname }))
        },
        ...(id === 'loomy' ? {
          adoptFrom: ['claimRewards'],
          async completeTasks(accountId, signal) {
            const result = await rpc('onboarding.claim', { provider: id, accountId }, signal)
            const completed = Array.isArray(result?.claimed) ? result.claimed.length : 0
            return {
              kind: completed > 0 ? 'completed' : 'done',
              completed,
              points: Number.isFinite(result?.earned) ? result.earned : undefined,
            }
          },
          verifyCompleteTasks: (accountId, signal) => onboardingVerify(id, accountId, signal),
        } : {
          async claimRewards(accountId, signal) {
            const result = await rpc('onboarding.claim', { provider: id, accountId }, signal)
            const claimed = Array.isArray(result?.claimed) ? result.claimed.length : 0
            return {
              kind: claimed > 0 ? 'claimed' : 'done',
              claimed,
              points: Number.isFinite(result?.earned) ? result.earned : undefined,
            }
          },
          verifyClaimRewards: (accountId, signal) => onboardingVerify(id, accountId, signal),
        }),
      })
    }
  }
  if (managed) {
    for (const [id, entry] of managed.entries()) {
      if (!entry.supportsClaimRewards && !entry.supportsCompleteTasks) continue
      adapters.set(id, {
        resetHour: entry.taskResetHour ?? 0,
        doneScope: entry.taskDoneScope ?? 'cycle',
        list: signal => entry.listAccounts(signal),
        ...(entry.supportsClaimRewards ? {
          claimRewards: (accountId, signal) => rpc('managed.claimRewards', { provider: id, accountId }, signal),
          ...(entry.supportsRewardStatus ? {
            verifyClaimRewards: (accountId, signal) => entry.call('managed.rewardStatus', { provider: id, accountId }, signal),
          } : {}),
        } : {}),
        ...(entry.supportsCompleteTasks ? {
          completeTasks: (accountId, signal) => rpc('managed.completeTasks', { provider: id, accountId }, signal),
        } : {}),
      })
    }
  }
  return adapters
}

export function publicCheckinStatus(value, extraIds = MANAGED_PROVIDER_IDS) {
  const supported = new Set([...PROVIDERS.filter(provider => provider.claim).map(provider => provider.id), WORKBUDDY_PROVIDER_ID, ...extraIds])
  const kinds = new Set(['claimed', 'already-claimed', 'inactive', 'ineligible', 'failed', 'pending'])
  return {
    enabled: value?.enabled === true,
    providers: Object.fromEntries(Object.entries(value?.providers ?? {}).flatMap(([id, row]) => {
      if (!supported.has(id) || !/^\d{4}-\d{2}-\d{2}$/.test(row?.date) || !Array.isArray(row.accounts)) return []
      return [[id, {
        date: row.date,
        resetHour: row.resetHour === 10 ? 10 : 0,
        ...(typeof row.enabled === 'boolean' ? { enabled: row.enabled } : {}),
        accounts: row.accounts
          .filter(account => typeof account?.accountId === 'string' && kinds.has(account.kind))
          .map(account => ({ accountId: account.accountId, kind: account.kind, retryable: account.retryable === true })),
      }]]
    })),
  }
}

export function publicAutomationStatus(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const taskKinds = new Set(['claimed', 'completed', 'done', 'empty', 'unsupported', 'failed', 'pending'])
  const cleanTaskRows = rows => (Array.isArray(rows) ? rows : [])
    .filter(item => typeof item?.accountId === 'string' && taskKinds.has(item.kind))
    .map(item => ({
      accountId: item.accountId,
      kind: item.kind,
      ...(Number.isFinite(item.claimed) ? { claimed: item.claimed } : {}),
      ...(Number.isFinite(item.completed) ? { completed: item.completed } : {}),
      ...(Number.isFinite(item.points) ? { points: item.points } : {}),
      retryable: item.retryable === true,
    }))
  const tasks = {}
  if (source.tasks && typeof source.tasks === 'object' && !Array.isArray(source.tasks)) {
    for (const [id, entry] of Object.entries(source.tasks)) {
      if (typeof id !== 'string' || !id || id.length > 64 || !entry || typeof entry !== 'object') continue
      tasks[id] = {
        date: typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : '',
        capabilities: {
          claimRewards: entry.capabilities?.claimRewards === true,
          completeTasks: entry.capabilities?.completeTasks === true,
        },
        claimRewards: cleanTaskRows(entry.claimRewards),
        completeTasks: cleanTaskRows(entry.completeTasks),
      }
    }
  }
  return {
    config: publicAutomationConfig(source.config),
    quotaProviders: quotaPriorityProviders(true).filter(id => Array.isArray(source.quotaProviders) && source.quotaProviders.includes(id)),
    unifiedModelProviders: ['raccoon'].filter(id => Array.isArray(source.unifiedModelProviders) && source.unifiedModelProviders.includes(id)),
    tasks,
  }
}

export function updateSettingsSnapshots(snapshots, method, payload, value) {
  const { provider, accountId, modelId, enabled } = payload
  const change = (resource, patch) => snapshots.changed(settingsResourceKey(resource, provider), patch)
  if (method === 'plan.consoleLogin') return change('plan.snapshot', previous => ({ ...previous, quota: value.quota }))
  if (method === 'plan.setKey') {
    return change('plan.snapshot', previous => ({ ...previous, hasApiKey: value.hasApiKey, catalogAvailable: false, models: [], enabledModelIds: [] }))
  }
  if (method === 'plan.setEnabled') {
    return change('plan.snapshot', previous => ({ ...previous, registerProvider: value.enabled, providerRegistered: value.providerRegistered }))
  }
  if (method === 'plan.setModelEnabled' || method === 'plan.setModelParams') {
    const patch = method === 'plan.setModelEnabled' ? { enabled: value.enabled }
      : { ...value }
    return change('plan.snapshot', previous => ({
      ...previous, models: previous.models.map(model => model.id === modelId ? { ...model, ...patch } : model),
    }))
  }
  if (method === 'plan.resetModels') {
    const ids = new Set(value.enabledModelIds)
    return change('plan.snapshot', previous => ({ ...previous, enabledModelIds: value.enabledModelIds,
      models: previous.models.map(model => ({ ...model, enabled: ids.has(model.id) })) }))
  }
  // API Key 渠道：与 plan.* 同构——乐观补丁打在投影形状上，随后后台重采集。
  if (APIKEY_METHODS.has(method)) {
    if (method === 'apikey.snapshot') return
    if (method === 'apikey.setKey') {
      return change('apikey.snapshot', previous => ({ ...previous,
        hasApiKey: value.hasApiKey, catalogSource: 'fallback', catalogError: false, models: [], balance: null, quota: null, rateLimit: null }))
    }
    if (method === 'apikey.setEnabled') {
      return change('apikey.snapshot', previous => ({ ...previous, registerProvider: value.enabled, providerRegistered: value.providerRegistered }))
    }
    if (method === 'apikey.setModelEnabled' || method === 'apikey.setModelParams') {
      const patch = method === 'apikey.setModelEnabled' ? { enabled: value.enabled } : { ...value }
      return change('apikey.snapshot', previous => ({
        ...previous, models: previous.models.map(model => model.id === modelId ? { ...model, ...patch } : model),
      }))
    }
    if (method === 'apikey.resetModels') {
      const enabledIds = new Set(value.enabledModelIds)
      return change('apikey.snapshot', previous => ({ ...previous,
        models: previous.models.map(model => ({ ...model, enabled: enabledIds.has(model.id) })) }))
    }
    if (method === 'apikey.setToolsEnabled') {
      return change('apikey.snapshot', previous => ({ ...previous, toolsEnabled: value.toolsEnabled, toolsRegistered: value.toolsRegistered }))
    }
    if (method === 'apikey.setConsoleSession' || method === 'apikey.clearConsoleSession' || method === 'apikey.consoleLogin') {
      if (method === 'apikey.consoleLogin' && value.signedIn !== true) return
      return change('apikey.snapshot', previous => ({ ...previous, hasConsoleSession: value.hasConsoleSession === true, consoleLoginUrl: null }))
    }
  }
  if (MANAGED_METHODS.has(method)) {
    if (method === 'managed.snapshot' || method === 'managed.models') return
    if (MANAGED_MODEL_WRITES.includes(method) || method === 'managed.refreshModels') return change('managed.models', () => value)
    if (method === 'managed.setEnabled') {
      return change('managed.snapshot', previous => ({ ...previous, enabled: value.enabled, registered: value.registered }))
    }
    if (method === 'managed.logout') {
      return Promise.all([
        change('managed.snapshot', previous => ({ ...previous, accounts: (previous.accounts ?? []).filter(account => account.id !== accountId) })),
        change('managed.models'),
      ])
    }
    if (method === 'managed.login' || method === 'managed.importLocal' || method === 'managed.importCredential') {
      const source = method === 'managed.importLocal' ? 'local' : method === 'managed.importCredential' ? 'credential' : 'browser'
      return Promise.all([
        change('managed.snapshot', previous => value?.signedIn ? {
          ...previous,
          ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
          ...(typeof value.registered === 'boolean' ? { registered: value.registered } : {}),
          accounts: [
            ...(previous.accounts ?? []).filter(account => account.id !== value.id),
            { id: value.id, name: value.name || value.id, uid: value.uid || '', enabled: true, source, signedIn: true, windows: [] },
          ],
        } : previous),
        change('managed.models'),
      ])
    }
    if (method === 'managed.updateAccount') {
      return change('managed.snapshot', previous => ({
        ...previous,
        accounts: (previous.accounts ?? []).map(account => account.id === accountId ? { ...account, name: value.name, enabled: value.enabled } : account),
      }))
    }
    if (method === 'managed.checkin' || method === 'managed.claimRewards' || method === 'managed.completeTasks') {
      return Promise.all([
        change('managed.snapshot'),
        snapshots.changed(settingsResourceKey('automation.status', 'automation')),
      ])
    }
  }
  if (AUTOMATION_METHODS.has(method)) {
    return Promise.all([
      snapshots.changed(settingsResourceKey('automation.status', 'automation')),
      snapshots.changed(settingsResourceKey('checkin.status', 'daily')),
    ])
  }
  if (LOOMY_ROUTE_METHODS.has(method)) {
    if (method === 'loomy.routeStatus') return
    return Promise.all([
      change('loomy.routeStatus', () => publicLoomyRouteStatus(value)),
      change('account.list', previous => ({
        accounts: (previous?.accounts ?? []).map(({ route: _old, ...account }) => ({
          ...account,
          ...(value?.accounts?.[account.id] ? { route: value.accounts[account.id] } : {}),
        })),
      })),
    ])
  }
  if (WORKBUDDY_MODEL_WRITES.includes(method)) return change('workbuddy.models', () => value)
  if (method === 'workbuddy.logout') {
    return Promise.all([
      change('workbuddy.snapshot', previous => ({ accounts: previous.accounts.filter(account => account.id !== accountId) })),
      change('workbuddy.models'),
    ])
  }
  if (method === 'workbuddy.login') {
    return Promise.all([
      change('workbuddy.snapshot', previous => value.signedIn ? { accounts: [...previous.accounts,
        { id: value.id, name: value.accountId, uid: value.uid, signedIn: true, windows: [] }] } : previous),
      change('workbuddy.models'),
    ])
  }
  if (method === 'workbuddy.checkin') return change('workbuddy.snapshot')
  if (method === 'provider.setEnabled') {
    return change('provider.status', previous => ({
      statuses: { ...previous.statuses, [provider]: previous.statuses[provider] ? { ...previous.statuses[provider], closed: !enabled } : null },
    }))
  }
  if (method === 'model.setParams') return change('model.params', () => value)
  if (method.startsWith('model.') && !['model.list', 'model.params'].includes(method)) {
    return Promise.all([change('provider.status'), change('model.list')])
  }
  if ((method.startsWith('account.') && method !== 'account.list') || method === 'login.poll' && value.success) {
    return Promise.all([
      change('provider.status'),
      change('account.list', method === 'account.delete' ? previous => ({ accounts: previous.accounts.filter(account => account.id !== accountId) })
        : method === 'account.update' ? previous => ({ accounts: previous.accounts.map(account => account.id === accountId ? {
          ...account, ...payload.patch, nickname: payload.patch.nickname?.trim() ?? account.nickname,
        } : account) }) : undefined),
      change('credits.balances', method === 'account.delete' ? previous => ({ accounts: previous.accounts.filter(account => account.accountId !== accountId) }) : undefined),
      ...(method === 'account.delete' && provider === 'loomy' ? [change('loomy.routeStatus')] : []),
    ])
  }
  if (method === 'credits.claimAll' || method === 'onboarding.claim') return change('credits.balances')
}
