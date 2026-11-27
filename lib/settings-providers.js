import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, PLAN_PROVIDER_ID, WORKBUDDY_PROVIDER_ID, APIKEY_PROVIDER_IDS, APIKEY_METHODS, MANAGED_PROVIDER_IDS, MANAGED_METHODS, AUTOMATION_METHODS } from './rpc.js'
import { profileSegment } from '../vendor/sensenova-token-plan/index.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { MANAGED_MODEL_WRITES } from './managed-models.js'
import { publicAutomationConfig } from './automation-settings.js'
import { quotaPriorityProviders } from './quota-priority.js'
import { invalidationRule } from './channel-specs.js'

export const settingsResourceKey = (method, provider) => method === 'provider.status' ? method : provider + '/' + method

/**
 * Raccoon 家族里代表签到的 provider id。
 *
 * 账号池只有一个（`raccoon`），`raccoon-pro` 是同一账号的订阅面视图；
 * 签到是账号级事项，只用前者调度。
 */
const RACCOON_CHECKIN_PROVIDER_ID = 'raccoon'

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
  register('plan.snapshot', PLAN_PROVIDER_ID)
  register('workbuddy.snapshot', WORKBUDDY_PROVIDER_ID, {
    project: value => {
      const { loginUrl: _omit, ...rest } = publicResult('workbuddy.snapshot', value)
      return rest
    },
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
  // 每个适配器同时声明它在宿主 RPC 上的公开契约，web-host 的签到分派只查
  // 这张表，不再按渠道名分支：
  // - `claimMethod`：界面「签到」按钮经 web-host 调用的**公开**写方法；
  //   缺省 = 本渠道没有公开签到方法（其签到只由宿主调度器走内部方法）。
  // - `claimShape`：`claimMethod` 的入参/返回形态：
  //   `'results'` = 不校验 accountId、对全部账号执行并返回 `{results:[…]}`；
  //   `'single'`  = 必须传 accountId、执行单个账号并返回单对象。
  // - `writeMethod`：调度器 onChange 记账用的写方法（驱动 INVALIDATE_RULES
  //   决定重采哪些快照资源）。
  const dedicatedCheckin = new Set(['raccoon', 'raccoon-pro'])
  for (const { id, claim } of PROVIDERS) {
    if (!standalone || !claim || dedicatedCheckin.has(id)) continue
    adapters.set(id, {
      claimMethod: 'credits.claimAll',
      claimShape: 'results',
      writeMethod: 'credits.claimAll',
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
    claimMethod: 'workbuddy.checkin',
    claimShape: 'single',
    writeMethod: 'workbuddy.checkin',
    list: signal => workbuddy.listCheckinAccounts(signal),
    verify: (accountId, signal) => workbuddy.verifyCheckin(accountId, signal),
    async claim(accountId, signal) {
      const result = await rpc('workbuddy.checkin', { provider: WORKBUDDY_PROVIDER_ID, accountId }, signal)
      const kind = result.outcome === 'done' ? 'already-claimed' : result.outcome
      return { kind, credit: result.credit, streak: result.streak, unsubmitted: result.unsubmitted === true }
    },
  })
  // Raccoon 家族：签到是**账号级**事项，由代表账号池的 `raccoon` 承担
  //（`raccoon-pro` 是同一账号的订阅面视图，再跑一次会重复调度同一账号）。
  // 上游没有专门的签到端点，由 `raccoon.checkin` 触发后回报本次新增积分，
  // 故不提供只读 `verify`：服务端按日幂等，重复调用只会得到 `already-claimed`。
  if (standalone) {
    adapters.set(RACCOON_CHECKIN_PROVIDER_ID, {
      // 无 `claimMethod`：`raccoon.checkin` 属 HOST_INTERNAL_METHODS（界面不能
      // 直连），公开 RPC 仍应绕过签到台账直达渠道后端；它只作记账方法。
      writeMethod: 'raccoon.checkin',
      resetHour: 0,
      async list(signal) {
        const { accounts } = await rpc('account.list', { provider: RACCOON_CHECKIN_PROVIDER_ID, forCheckin: true }, signal)
        return accounts
          .filter(account => account.provider === RACCOON_CHECKIN_PROVIDER_ID && typeof account.id === 'string' && account.id)
          .map(account => ({ id: account.id, name: account.nickname }))
      },
      async claim(accountId, signal) {
        const result = await rpc('raccoon.checkin', { provider: RACCOON_CHECKIN_PROVIDER_ID, accountId }, signal)
        const kind = result.outcome === 'done' ? 'already-claimed' : result.outcome
        return { kind, credit: result.credit }
      },
    })
  }
  if (managed) {
    for (const [id, entry] of managed.entries()) {
      if (!entry.supportsCheckin) continue
      adapters.set(id, {
        claimMethod: 'managed.checkin',
        claimShape: 'single',
        writeMethod: 'managed.checkin',
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
  // 账号池渠道的登录奖励：Raccoon 族是**幂等的登录奖励领取**（无副作用被动领积分），
  // 归 `claimRewards` —— 默认开启的自动领取照常生效。账号级一次性事项
  //（`doneScope: 'account'`），`verifyClaimRewards` 走只读的 `onboarding.status`
  // 供调度器查询已办状态。
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
    adapters.set(RACCOON_CHECKIN_PROVIDER_ID, {
      resetHour: 0,
      // 一次性事项：账本幂等按账号粒度判定（非每日周期）。
      doneScope: 'account',
      async list(signal) {
        const { accounts } = await rpc('account.list', { provider: RACCOON_CHECKIN_PROVIDER_ID }, signal)
        return (accounts ?? []).filter(account => account.provider === RACCOON_CHECKIN_PROVIDER_ID && account.enabled !== false)
          .map(account => ({ id: account.id, name: account.nickname }))
      },
      async claimRewards(accountId, signal) {
        const result = await rpc('onboarding.claim', { provider: RACCOON_CHECKIN_PROVIDER_ID, accountId }, signal)
        const claimed = Array.isArray(result?.claimed) ? result.claimed.length : 0
        return {
          kind: claimed > 0 ? 'claimed' : 'done',
          claimed,
          points: Number.isFinite(result?.earned) ? result.earned : undefined,
        }
      },
      verifyClaimRewards: (accountId, signal) => onboardingVerify(RACCOON_CHECKIN_PROVIDER_ID, accountId, signal),
    })
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
          .map(account => ({
            accountId: account.accountId, kind: account.kind,
            // 额度增长确认时记录本次到账量，供账号行标签展示。
            ...(Number.isFinite(account.credit) ? { credit: account.credit } : {}),
            retryable: account.retryable === true,
          })),
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
      method !== 'automation.setConfig' && snapshots.changed(settingsResourceKey('automation.status', 'automation')),
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
  // ── 通用失效：规则表在 `lib/channel-specs.js` 的 `INVALIDATE_RULES` ──
  //
  // 这里只保留「乐观补丁」：把本次写的结果直接打在投影形状上，界面立刻显示新状态，
  // 随后 `changed()` 触发的后台重采集再以真实数据覆盖。**要刷新哪些资源**由规则表
  // 决定，不在这里写 if —— 新增写方法漏登记时，一致性用例会报出来。
  const rule = invalidationRule(method)
  if (rule === null) return undefined
  if (rule.whenSuccess === true && value?.success !== true) return undefined
  const patches = optimisticPatches(method, { provider, accountId, payload, value, enabled })
  return Promise.all(rule.resources.map(resource => change(resource, patches[resource])))
}

/**
 * 写后失效的**乐观补丁**：资源 → 投影形状的局部更新函数。
 *
 * 缺省（没有对应键）表示「只重采集、不预改」—— 多数写方法不需要预改。补丁必须
 * **幂等且只动自己那一块**：它打在已完成投影的形状上，写错字段会让界面在后台
 * 采集回来之前显示错的数据。
 */
function optimisticPatches(method, { provider, accountId, payload, value, enabled }) {
  const withoutAccount = previous => ({ accounts: (previous?.accounts ?? []).filter(account => account.id !== accountId) })
  if (method === 'provider.setEnabled') {
    return {
      'provider.status': previous => ({
        statuses: { ...previous.statuses, [provider]: previous.statuses[provider] ? { ...previous.statuses[provider], closed: !enabled } : null },
      }),
    }
  }
  if (method === 'model.setParams') return { 'model.params': () => value }
  if (method === 'account.delete') {
    return {
      'account.list': withoutAccount,
      'credits.balances': previous => ({ accounts: (previous?.accounts ?? []).filter(account => account.accountId !== accountId) }),
    }
  }
  if (method === 'account.update') {
    return {
      'account.list': previous => ({
        accounts: (previous?.accounts ?? []).map(account => account.id === accountId
          ? { ...account, ...payload.patch, nickname: payload.patch.nickname?.trim() ?? account.nickname }
          : account),
      }),
    }
  }
  return {}
}
