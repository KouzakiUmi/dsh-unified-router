import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, PLAN_PROVIDER_ID, WORKBUDDY_PROVIDER_ID, APIKEY_PROVIDER_IDS, APIKEY_METHODS, MANAGED_PROVIDER_IDS, MANAGED_METHODS, AUTOMATION_METHODS } from './rpc.js'
import { profileSegment } from '../vendor/sensenova-token-plan/index.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { MANAGED_MODEL_WRITES } from './managed-models.js'
import { publicAutomationConfig } from './automation-settings.js'

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
    if (provider.accountPool === false) continue
    register('account.list', provider.id, { project: value => publicResult('account.list', {
      accounts: value?.accounts?.filter(account => account.provider === provider.id),
    }) })
    register('credits.balances', provider.id, { merge: mergeBalances })
  }
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
    })
  }
  adapters.set(WORKBUDDY_PROVIDER_ID, {
    list: signal => workbuddy.listCheckinAccounts(signal),
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
  // 账号池渠道的 onboarding 新手/登录奖励领取（Loomy、Raccoon 家族）
  if (standalone) {
    for (const id of ['loomy', 'raccoon']) {
      adapters.set(id, {
        resetHour: 0,
        async list(signal) {
          const { accounts } = await rpc('account.list', { provider: id }, signal)
          return (accounts ?? []).filter(account => account.provider === id && account.enabled !== false)
            .map(account => ({ id: account.id, name: account.nickname }))
        },
        async claimRewards(accountId, signal) {
          const result = await rpc('onboarding.claim', { provider: id, accountId }, signal)
          const claimed = Array.isArray(result?.claimed) ? result.claimed.length : 0
          return {
            kind: claimed > 0 ? 'claimed' : 'done',
            claimed,
            points: Number.isFinite(result?.earned) ? result.earned : undefined,
          }
        },
      })
    }
  }
  if (managed) {
    for (const [id, entry] of managed.entries()) {
      if (!entry.supportsClaimRewards && !entry.supportsCompleteTasks) continue
      adapters.set(id, {
        resetHour: entry.taskResetHour ?? 0,
        list: signal => entry.listAccounts(signal),
        ...(entry.supportsClaimRewards ? {
          claimRewards: (accountId, signal) => rpc('managed.claimRewards', { provider: id, accountId }, signal),
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
    tasks,
  }
}

export function updateSettingsSnapshots(snapshots, method, payload, value) {
  const { provider, accountId, modelId, enabled } = payload
  const change = (resource, patch) => snapshots.changed(settingsResourceKey(resource, provider), patch)
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
        hasApiKey: value.hasApiKey, catalogSource: 'fallback', catalogError: false, models: [], balance: null }))
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
  if (method === 'provider.setEnabled' || method.startsWith('model.') && !['model.list', 'model.params'].includes(method)) {
    return change('provider.status', method === 'provider.setEnabled' ? previous => ({
      statuses: { ...previous.statuses, [provider]: previous.statuses[provider] ? { ...previous.statuses[provider], closed: !enabled } : null },
    }) : undefined)
  }
  if ((method.startsWith('account.') && method !== 'account.list') || method === 'login.poll' && value.success) {
    return Promise.all([
      change('provider.status'),
      change('account.list', method === 'account.delete' ? previous => ({ accounts: previous.accounts.filter(account => account.id !== accountId) })
        : method === 'account.update' ? previous => ({ accounts: previous.accounts.map(account => account.id === accountId ? {
          ...account, ...payload.patch, nickname: payload.patch.nickname?.trim() ?? account.nickname,
        } : account) }) : undefined),
      change('credits.balances', method === 'account.delete' ? previous => ({ accounts: previous.accounts.filter(account => account.accountId !== accountId) }) : undefined),
    ])
  }
  if (method === 'credits.claimAll' || method === 'onboarding.claim') return change('credits.balances')
}
