import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, PLAN_PROVIDER_ID, WORKBUDDY_PROVIDER_ID } from './rpc.js'
import { profileSegment } from '../vendor/sensenova-token-plan/index.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'

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

export function settingsResources(read, publicResult) {
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
  return resources
}

export function settingsCheckinAdapters({ standalone, rpc, workbuddy }) {
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
  return adapters
}

export function publicCheckinStatus(value) {
  const supported = new Set([...PROVIDERS.filter(provider => provider.claim).map(provider => provider.id), WORKBUDDY_PROVIDER_ID])
  const kinds = new Set(['claimed', 'already-claimed', 'inactive', 'ineligible', 'failed', 'pending'])
  return {
    enabled: value?.enabled === true,
    providers: Object.fromEntries(Object.entries(value?.providers ?? {}).flatMap(([id, row]) => {
      if (!supported.has(id) || !/^\d{4}-\d{2}-\d{2}$/.test(row?.date) || !Array.isArray(row.accounts)) return []
      return [[id, { date: row.date, resetHour: row.resetHour === 10 ? 10 : 0, accounts: row.accounts
        .filter(account => typeof account?.accountId === 'string' && kinds.has(account.kind))
        .map(account => ({ accountId: account.accountId, kind: account.kind, retryable: account.retryable === true })) }]]
    })),
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
