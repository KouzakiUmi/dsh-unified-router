import { normalizePlanParams, PLAN_EFFORTS } from "./sensenova-params.js"
import { guardedRpc, sharedTransport, loginUrl, PROVIDERS, PLAN_PROVIDER_ID, PLAN_METHODS, WORKBUDDY_METHODS, APIKEY_PROVIDER_IDS, APIKEY_METHODS, MANAGED_PROVIDER_IDS, MANAGED_METHODS, AUTOMATION_METHODS, ALL_PROVIDER_IDS } from './rpc.js'
import { createSenseNovaManager } from './sensenova.js'
import { createWorkBuddyManager } from './workbuddy.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { MANAGED_WRITE_METHODS, MANAGED_ERROR_CODES, MANAGED_CHECKIN_OUTCOMES, MANAGED_TASK_OUTCOMES, createManagedChannelManager } from './managed-channel.js'
import { MANAGED_MODEL_WRITES } from './managed-models.js'
import { managedProvider as defaultManagedProvider } from './managed-providers/index.js'
import { createAutomationSettings } from './automation-settings.js'
import { createAutoTasks } from './auto-tasks.js'
import { installCotLoopGuard } from './cot-loop-guard/index.js'
import { createSettingsSnapshots } from './settings-snapshots.js'
import { dirname, join } from 'node:path'
import { createDailyCheckin } from './daily-checkin.js'
import { publicAutomationStatus, publicCheckinStatus, settingsCheckinAdapters, settingsTaskAdapters, settingsResources, settingsResourceKey, settingsSnapshotFile, updateSettingsSnapshots } from './settings-providers.js'
export const name = 'dsh-unified-router'
const finite = value => Number.isFinite(value) ? value : null
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const planWriteMethods = new Set(['plan.setKey', 'plan.setEnabled', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels'])
// 登录会写凭据、开关会改注册状态：这些写操作要求同源 + 主机授权。
// workbuddy.snapshot 虽名为读，但 token 临期续期会经 client.auth.set 落盘新凭据，
// 同样按写操作门禁（客户端补读是同源请求，不受影响）。
const workbuddyWriteMethods = new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', ...WORKBUDDY_MODEL_WRITES])
// apikey.snapshot 不进门禁：它是纯读。五个写方法会改凭据 / 注册状态 / 模型偏好。
const apikeyWriteMethods = new Set(['apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels'])
const automationWriteMethods = new Set(['automation.setConfig', 'automation.run'])
const writeMethods = new Set([...planWriteMethods, ...workbuddyWriteMethods, ...apikeyWriteMethods, ...MANAGED_WRITE_METHODS, ...automationWriteMethods, 'settings.refresh', 'credits.claimAll'])
// 终界自证：错误码与签到 outcome 在投影层再过一次白名单，不依赖上游自律。
const workbuddyErrorCodes = new Set(['not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error'])
const workbuddyCheckinOutcomes = new Set(['claimed', 'done', 'inactive', 'ineligible', 'failed', 'pending'])
const planMaxTokens = value => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000 ? value : null
const planModelId = id => typeof id === 'string' && id !== '' && id.length <= 256 && id.trim() === id && id !== '__hide_all__' && !['__proto__', 'prototype', 'constructor'].includes(id)
function publicCatalogStatus(value) {
  return {
    ...(['remote', 'cached', 'fallback'].includes(value?.source) ? { source: value.source } : {}),
    ...(['login-required', 'cli-missing', 'timeout', 'cli-failed', 'empty'].includes(value?.issue) ? { issue: value.issue } : {}),
  }
}
function publicRate(value) {
  const label = text(value?.text?.zh ?? value?.label, 24)
  return (label === '免费' || /^(?:参考 )?x\d+(?:\.\d+)?$/.test(label)) && ['neutral', 'info', 'success', 'warning'].includes(value?.tone)
    ? { label, tone: value.tone, ...(Number.isFinite(value.multiplier) && value.multiplier > 0 ? { multiplier: value.multiplier } : {}) }
    : undefined
}
function sameOriginRequest(request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  if (origin === 'null') return false
  try {
    const host = request.headers.get('host') || new URL(request.url).host
    return new URL(origin).host === host
  } catch { return false }
}
function publicPlanModel(value) {
  const { compat: _legacyCompat, ...params } = normalizePlanParams(value?.params)
  return {
    vision: value?.vision === true, contextWindow: finite(value?.contextWindow),
    maxOutputLength: finite(value?.maxOutputLength), maxTokensOverride: planMaxTokens(value?.maxTokensOverride),
    thinkingLevels: Array.isArray(value?.thinkingLevels) ? PLAN_EFFORTS.filter(level => value.thinkingLevels.includes(level)) : [],
    params,
    defaultEffort: text(value?.defaultEffort, 40), defaultVision: typeof value?.defaultVision === 'boolean' ? value.defaultVision : null,
    defaultContextWindow: finite(value?.defaultContextWindow), defaultMaxOutputLength: finite(value?.defaultMaxOutputLength),
  }
}
function publicPlanSnapshot(value) {
  const source = value ?? {}
  const llm = source.llm ?? source
  const ids = Array.isArray(llm.enabledModelIds) ? llm.enabledModelIds.filter(planModelId).slice(0, 512) : []
  return {
    registerProvider: llm.registerProvider === true, providerRegistered: llm.providerRegistered === true,
    hasApiKey: llm.hasApiKey === true, catalogAvailable: source.catalogAvailable === true,
    catalogError: source.catalogError === true, pollSeconds: finite(source.pollSeconds), updatedAt: finite(source.updatedAt),
    models: (Array.isArray(llm.models) ? llm.models : []).filter(model => planModelId(model?.id)).slice(0, 512).map(model => ({
      id: model.id, name: text(model.name, 160),
      enabled: typeof model.enabled === 'boolean' ? model.enabled : ids.length === 0 || ids.includes(model.id),
      ...publicPlanModel(model),
    })),
    enabledModelIds: ids,
  }
}
// API Key 渠道快照：与 plan.snapshot 同形（客户端复用同一套模型编辑器）。
// 内部字段名（hasKey/enabled/registered）与已投影名（hasApiKey/registerProvider/
// providerRegistered）都认——快照文件恢复与写操作乐观补丁会先落到投影形状，
// 再经本函数归一（幂等）。catalogError 只投影成布尔，文案不外泄。
function publicApiKeySnapshot(value) {
  const source = value && typeof value === 'object' ? value : {}
  const balanceValue = source.balance
  const balance = !balanceValue ? null
    : typeof balanceValue !== 'object' || Array.isArray(balanceValue) ? null
      : balanceValue.error === true ? { error: true }
        : {
          used: finite(balanceValue.used), limit: finite(balanceValue.limit),
          unlimited: balanceValue.unlimited === true, unit: balanceValue.unit === 'USD' || balanceValue.unit === 'CNY' ? balanceValue.unit : '',
          updatedAt: finite(balanceValue.updatedAt),
        }
  return {
    provider: APIKEY_PROVIDER_IDS.includes(source.provider) ? source.provider : '',
    hasApiKey: (source.hasApiKey ?? source.hasKey) === true,
    registerProvider: (source.registerProvider ?? source.enabled) === true,
    providerRegistered: (source.providerRegistered ?? source.registered) === true,
    catalogSource: ['remote', 'cached', 'fallback'].includes(source.catalogSource) ? source.catalogSource : 'fallback',
    catalogError: source.catalogError === true || typeof source.catalogError === 'string' && source.catalogError !== '',
    updatedAt: finite(source.updatedAt),
    models: (Array.isArray(source.models) ? source.models : []).filter(model => planModelId(model?.id)).slice(0, 512)
      .map(model => ({
        id: model.id, name: text(model.name, 160), enabled: model.enabled === true,
        ...publicPlanModel({ ...model, thinkingLevels: model.thinkingLevels ?? model.efforts }),
      })),
    balance,
  }
}

// Send an explicit public projection. Upstream account entries contain internal
// credential references; errors may contain upstream response bodies.
export function publicResult(method, value) {
  if (method === 'account.list') return { accounts: (value?.accounts ?? []).map(a => ({
    id: a.id, provider: a.provider, nickname: text(a.nickname, 80), enabled: a.enabled !== false,
    expiresAt: finite(a.expiresAt), refreshable: a.refreshable === true,
    // Raccoon 套餐档位：界面据此显示「免费 / 订阅 / 未知」徽标。
    // ⚠️ 白名单枚举而非自由文本：上游/探测写入的脏值不参与展示与分流判断。
    ...(a.plan === 'free' || a.plan === 'pro' || a.plan === 'unknown' ? { plan: text(a.plan, 20) } : {}),
    modelRateLimits: Object.fromEntries(Object.entries(a.modelRateLimits ?? {}).filter(([,v]) => Number.isFinite(v))),
  })) }
  if (method === 'account.create') return { accountId: text(value?.accountId, 256), loginUrl: loginUrl(value?.loginUrl) }
  if (method === 'login.poll') return { done: value?.done === true, success: value?.success === true }
  if (PLAN_METHODS.has(method)) {
    if (method === 'plan.snapshot') return publicPlanSnapshot(value)
    if (method === 'plan.setEnabled') return { enabled: value?.enabled === true, providerRegistered: value?.providerRegistered === true }
    if (method === 'plan.setKey') return { hasApiKey: value?.hasApiKey === true }
    if (method === 'plan.setModelEnabled') return { modelId: text(value?.modelId, 256), enabled: value?.enabled === true }
    if (method === 'plan.setModelParams') return { modelId: text(value?.modelId, 256), ...publicPlanModel(value) }
    if (method === 'plan.resetModels') return { enabledModelIds: (value?.enabledModelIds ?? []).filter(planModelId) }
  }
  // API Key 渠道：投影形状见 docs/APIKEY-CHANNELS.md §RPC 投影。
  // apiKey 永远不出现在返回值里；setModelParams 返回整行（模型字段经 publicPlanModel 过滤）。
  if (APIKEY_METHODS.has(method)) {
    if (method === 'apikey.snapshot') return publicApiKeySnapshot(value)
    if (method === 'apikey.setKey') return { hasApiKey: value?.hasApiKey === true }
    if (method === 'apikey.setEnabled') return { enabled: value?.enabled === true, providerRegistered: value?.providerRegistered === true }
    if (method === 'apikey.setModelEnabled') return { modelId: text(value?.modelId, 256), enabled: value?.enabled === true }
    if (method === 'apikey.setModelParams') return { modelId: text(value?.modelId, 256), ...publicPlanModel({ ...value, thinkingLevels: value?.thinkingLevels ?? value?.efforts }) }
    if (method === 'apikey.resetModels') return { enabledModelIds: (Array.isArray(value?.enabledModelIds) ? value.enabledModelIds : []).filter(planModelId) }
  }
  if (method === 'provider.status') return { statuses: Object.fromEntries(PROVIDERS.map(p => {
    const s = value?.statuses?.[p.id]
    return [p.id, s ? { closed: s.closed === true, accounts: { total: finite(s.accounts?.total), enabled: finite(s.accounts?.enabled) }, models: { total: finite(s.models?.total), disabled: finite(s.models?.disabled) } } : null]
  })) }
  // WorkBuddy：管理器已按白名单投影，这里做终界过滤（凭据、上游原文不外放）。
  if (WORKBUDDY_METHODS.has(method)) {
    const wbWindow = w => w && typeof w === 'object' ? {
      name: text(w.name, 80), used: finite(w.used), amount: finite(w.amount), limit: finite(w.limit), balance: finite(w.balance),
      display: text(w.display, 120), unit: text(w.unit, 40), resetsAt: text(w.resetsAt, 40), span: finite(w.span),
      runsOutAt: text(w.runsOutAt, 40), runsOut: finite(w.runsOut),
    } : null
    const wbModel = m => m && typeof m === 'object' ? {
      id: text(m.id, 256), name: text(m.name, 160), context: finite(m.context), output: finite(m.output),
      attachment: typeof m.attachment === 'boolean' ? m.attachment : null, reasoning: m.reasoning === true,
      efforts: Array.isArray(m.efforts) ? m.efforts.filter(e => typeof e === 'string').slice(0, 8) : [],
      free: m.free === true, enabled: m.enabled !== false, ...publicPlanModel({ ...m, thinkingLevels: m.efforts }),
      ...(m.free === true ? { rate: { label: '免费', tone: 'success' } }
        : Number.isFinite(m.rate) && m.rate > 0 ? { rate: { label: `x${m.rate.toFixed(2)}`, multiplier: m.rate, tone: m.rateWas > m.rate ? 'info' : 'neutral' } }
          : { rate: publicRate(m.rate) }),
    } : null
    // 多账号：逐账号白名单投影（id/name/uid 是展示标识，token 类字段一律丢弃）。
    // 没有 id 的行不是账号（也不该占一行的名字），连带丢掉。
    const wbAccount = a => {
      const id = a && typeof a === 'object' ? text(a.id, 64) : ''
      if (!id) return null
      return {
        id, name: text(a.name, 80), uid: text(a.uid, 120),
        signedIn: a.signedIn === true, plan: text(a.plan, 160),
        signIn: text(a.signIn, 20) === 'renewed' ? 'renewed' : 'kept',
        windows: (Array.isArray(a.windows) ? a.windows : []).slice(0, 16).map(wbWindow).filter(Boolean),
        updatedAt: finite(a.updatedAt),
        error: typeof a.error === 'string' && workbuddyErrorCodes.has(a.error) ? a.error : '',
      }
    }
    if (method === 'workbuddy.snapshot') {
      const v = value && typeof value === 'object' ? value : {}
      // loginUrl 校验失败只丢地址，不让整次快照退化成通用失败。
      let safeLoginUrl = ''
      try { safeLoginUrl = typeof v.loginUrl === 'string' && v.loginUrl ? loginUrl(v.loginUrl) : '' } catch {}
      return {
        accounts: (Array.isArray(v.accounts) ? v.accounts : []).slice(0, 16).map(wbAccount).filter(Boolean),
        loginUrl: safeLoginUrl,
      }
    }
    if (method === 'workbuddy.login') return { id: text(value?.id, 64), signedIn: value?.signedIn === true, accountId: text(value?.accountId, 160), uid: text(value?.uid, 160) }
    if (method === 'workbuddy.logout') return { signedIn: value?.signedIn === true }
    if (method === 'workbuddy.checkin') return { outcome: workbuddyCheckinOutcomes.has(value?.outcome) ? value.outcome : 'failed', credit: finite(value?.credit), streak: finite(value?.streak) }
    if (method === 'workbuddy.models' || WORKBUDDY_MODEL_WRITES.includes(method)) return {
      models: (Array.isArray(value?.models) ? value.models : []).slice(0, 256).map(wbModel).filter(Boolean),
      source: value?.source === 'remote' ? 'remote' : value?.source === 'cached' ? 'cached' : 'fallback',
    }
  }
  if (MANAGED_METHODS.has(method)) {
    const mWindow = w => w && typeof w === 'object' ? {
      name: text(w.name, 80), used: finite(w.used), amount: finite(w.amount), limit: finite(w.limit), balance: finite(w.balance),
      display: text(w.display, 120), unit: text(w.unit, 40), resetsAt: text(w.resetsAt, 48), span: finite(w.span),
      runsOutAt: text(w.runsOutAt, 48), runsOut: finite(w.runsOut),
    } : null
    const mModel = m => m && typeof m === 'object' ? {
      id: text(m.id, 256), name: text(m.name, 160), context: finite(m.context), output: finite(m.output),
      attachment: typeof m.attachment === 'boolean' ? m.attachment : null, reasoning: m.reasoning === true,
      efforts: Array.isArray(m.efforts) ? m.efforts.filter(e => typeof e === 'string').slice(0, 8) : [],
      free: m.free === true, enabled: m.enabled !== false, ...publicPlanModel({ ...m, thinkingLevels: m.efforts }),
      ...(m.free === true ? { rate: { label: '免费', tone: 'success' } }
        : typeof m.rateLabel === 'string' && m.rateLabel ? { rate: publicRate({ label: m.rateLabel, tone: m.rateTone || 'neutral', multiplier: m.rate }) }
          : Number.isFinite(m.rate) && m.rate > 0 ? { rate: { label: `x${Number(m.rate.toFixed(2))}`, multiplier: m.rate, tone: m.rateWas > m.rate ? 'info' : 'neutral' } }
            : { rate: publicRate(m.rate) }),
    } : null
    const mAccount = a => {
      const id = a && typeof a === 'object' ? text(a.id, 64) : ''
      if (!id) return null
      return {
        id, name: text(a.name, 80), uid: text(a.uid, 120), enabled: a.enabled !== false,
        source: ['browser', 'local', 'credential'].includes(a.source) ? a.source : 'browser',
        signedIn: a.signedIn === true, plan: text(a.plan, 120),
        balance: finite(a.balance), unit: text(a.unit, 24),
        windows: (Array.isArray(a.windows) ? a.windows : []).slice(0, 16).map(mWindow).filter(Boolean),
        updatedAt: finite(a.updatedAt),
        error: typeof a.error === 'string' && MANAGED_ERROR_CODES.has(a.error) ? a.error : '',
      }
    }
    if (method === 'managed.snapshot') {
      const v = value && typeof value === 'object' ? value : {}
      let safeLoginUrl = ''
      try { safeLoginUrl = typeof v.loginUrl === 'string' && v.loginUrl ? loginUrl(v.loginUrl) : '' } catch {}
      return {
        provider: text(v.provider, 64),
        enabled: v.enabled !== false,
        registered: v.registered === true,
        authMethods: Array.isArray(v.authMethods) ? v.authMethods.filter(m => ['browser', 'local', 'credential'].includes(m)) : ['browser'],
        credentialHint: text(v.credentialHint, 160),
        accounts: (Array.isArray(v.accounts) ? v.accounts : []).slice(0, 16).map(mAccount).filter(Boolean),
        loginUrl: safeLoginUrl,
      }
    }
    if (method === 'managed.login' || method === 'managed.importLocal' || method === 'managed.importCredential') {
      return { provider: text(value?.provider, 64), id: text(value?.id, 64), signedIn: value?.signedIn === true, name: text(value?.name, 80), uid: text(value?.uid, 120) }
    }
    if (method === 'managed.updateAccount') {
      return { provider: text(value?.provider, 64), id: text(value?.id, 64), name: text(value?.name, 80), enabled: value?.enabled !== false }
    }
    if (method === 'managed.logout') return { provider: text(value?.provider, 64), signedIn: value?.signedIn === true }
    if (method === 'managed.setEnabled') return { provider: text(value?.provider, 64), enabled: value?.enabled === true, registered: value?.registered === true }
    if (method === 'managed.checkin') {
      return { provider: text(value?.provider, 64), outcome: MANAGED_CHECKIN_OUTCOMES.has(value?.outcome) ? value.outcome : 'failed', credit: finite(value?.credit), streak: finite(value?.streak) }
    }
    if (method === 'managed.claimRewards' || method === 'managed.completeTasks') {
      return {
        provider: text(value?.provider, 64),
        kind: MANAGED_TASK_OUTCOMES.has(value?.kind) ? value.kind : 'failed',
        claimed: finite(value?.claimed), completed: finite(value?.completed), points: finite(value?.points),
      }
    }
    if (method === 'managed.models' || method === 'managed.refreshModels' || MANAGED_MODEL_WRITES.includes(method)) {
      return {
        provider: text(value?.provider, 64),
        models: (Array.isArray(value?.models) ? value.models : []).slice(0, 256).map(mModel).filter(Boolean),
        source: value?.source === 'remote' ? 'remote' : value?.source === 'cached' ? 'cached' : 'fallback',
      }
    }
  }
  if (AUTOMATION_METHODS.has(method)) {
    if (method === 'automation.status' || method === 'automation.setConfig') return publicAutomationStatus(value)
    if (method === 'automation.run') {
      return {
        provider: text(value?.provider, 64),
        mode: value?.mode === 'completeTasks' ? 'completeTasks' : 'claimRewards',
        results: (Array.isArray(value?.results) ? value.results : []).slice(0, 32).map(row => ({
          accountId: text(row?.accountId, 64),
          nickname: text(row?.nickname, 80),
          repeated: row?.repeated === true,
          outcome: {
            kind: MANAGED_TASK_OUTCOMES.has(row?.outcome?.kind) ? row.outcome.kind : 'failed',
            ...(finite(row?.outcome?.claimed) !== null ? { claimed: row.outcome.claimed } : {}),
            ...(finite(row?.outcome?.completed) !== null ? { completed: row.outcome.completed } : {}),
            ...(finite(row?.outcome?.points) !== null ? { points: row.outcome.points } : {}),
          },
        })),
      }
    }
  }
  // 模型参数：只放行这三项数值/字符串，其余一律丢弃（不把上游结构透出去）。
  if (method === 'model.params' || method === 'model.setParams') return { provider: text(value?.provider, 64), params: Object.fromEntries(Object.entries(value?.params ?? {})
    .filter(([id, entry]) => typeof id === 'string' && id.length <= 256 && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => [id, {
      ...(finite(entry.contextWindow) !== null ? { contextWindow: entry.contextWindow } : {}),
      // ⚠️ 不再投影 temperature：后端 setModelParams 与客户端 paramsFrom 都不认它，
      // 发出去只会让人误以为已支持（读写都不会生效）。
      ...(finite(entry.maxTokens) !== null ? { maxTokens: entry.maxTokens } : {}),
      ...(typeof entry.reasoningEffort === 'string' && entry.reasoningEffort ? { reasoningEffort: text(entry.reasoningEffort, 40) } : {}),
      ...(typeof entry.supportsImage === 'boolean' ? { supportsImage: entry.supportsImage } : {}),
    }])) }
  if (method === 'model.list') return { ...publicCatalogStatus(value), models: (value?.models ?? []).map(m => ({
    id: text(m.id, 256), name: text(m.name), disabled: m.disabled === true, dead: m.dead === true, isFree: m.isFree === true,
    // 能力元数据：上下文窗口与推理档位，界面据此只给该模型真做得到的选项。
    ...(finite(m.contextWindow) !== null && m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    ...(finite(m.maxTokens) !== null && m.maxTokens > 0 ? { maxTokens: m.maxTokens } : {}),
    ...(finite(m.defaultMaxTokens) !== null && m.defaultMaxTokens > 0 ? { defaultMaxTokens: m.defaultMaxTokens } : {}),
    ...(Array.isArray(m.efforts) ? { efforts: m.efforts.filter(x => typeof x === 'string').slice(0, 8) } : {}),
    ...(typeof m.defaultEffort === 'string' ? { defaultEffort: text(m.defaultEffort, 20) } : {}),
    ...(typeof m.supportsImage === 'boolean' ? { supportsImage: m.supportsImage } : {}),
    ...(m.rateBadge ? { rate: publicRate(m.rateBadge) } : {}),
    // 老旧/凑数模型标记：界面据此把它们收进折叠分组并默认关闭。
    // ⚠️ 漏了这一行 = 分组功能整体失效（源码有标记、产物被投影过滤掉）。
    ...(m.stale === true ? { stale: true } : {}),
    ...(typeof m.staleReason === 'string' ? { staleReason: text(m.staleReason, 240) } : {}),
  })) }
  if (method === 'credits.balances') return { accounts: (value?.accounts ?? []).map(a => ({ accountId: a.accountId, nickname: text(a.nickname, 80), updatedAt: finite(a.updatedAt),
    balance: a.balance ? { total: finite(a.balance.total), packages: (a.balance.packages ?? []).map(p => ({
      name: text(p.name), remaining: finite(p.remaining), unit: text(p.unit, 20),
      expiresAt: finite(p.deductionEndTime ?? p.expiresAt), active: p.active !== false,
    })) } : null,
    ...(a.error ? { error: '余额读取失败' } : {}),
  })) }
  if (method === 'credits.claimAll') return { results: (value?.results ?? []).map(r => ({ accountId: r.accountId, nickname: text(r.nickname, 80), outcome: { kind: ['claimed','already-claimed','inactive','failed','pending'].includes(r.outcome?.kind) ? r.outcome.kind : 'failed', actionRequired: r.outcome?.actionRequired === true, credit: finite(r.outcome?.credit) } })) }
  if (method === 'credits.permanentLock') return { locked: value?.locked === true }
  // 目录刷新结果：只回「拉了多少条 + 是不是真拉到了」。
  // source 只认白名单里的两个值，未知值一律按离线兜底（宁可说没拉到，也不谎报远端）。
  if (method === 'model.refresh') return { count: finite(value?.count), source: 'fallback', ...publicCatalogStatus(value) }
  if (method === 'onboarding.claim' || method === 'onboarding.status') return { earned: finite(value?.earned), total: finite(value?.total), claimed: (value?.claimed ?? []).map(c => ({ key: text(c.key), title: text(c.title), points: finite(c.points) })), skipped: (value?.skipped ?? []).map(v => text(v)) }
  return null
}

export function apply(ctx, config = {}, testDeps = {}) {
  ctx.inject(['connection', 'credentials', 'llm'], host => {
    let channelRpc = null
    let active = true
    // ⚠️ **后端就绪要等，不要直接抛**（真实缺陷，用户报障「每次点开设置都是未识别/无账号，
    // 必须手动刷新」）：独立后端是 `import('./backend.js')` + `mountBackend()` 异步挂载的，
    // 设置页往往比它先挂载完成。旧实现在 channelRpc 还是 null 时**立刻抛
    // 「渠道后端未就绪」**，于是首屏那批 RPC 全失败 —— 界面显示空账号/未知状态，
    // 等用户去点刷新时后端早就 ready 了，看起来就像「必须手动刷新」。
    // 现在把它变成一个「就绪信号」：请求先 await，最多等 BACKEND_READY_TIMEOUT_MS。
    let markReady = () => {}
    const ready = new Promise(resolve => { markReady = resolve })
    const BACKEND_READY_TIMEOUT_MS = 15_000
    const plan = createSenseNovaManager(host, config.sensenova ?? {})
    const snapshotFile = testDeps.snapshotFile ?? settingsSnapshotFile(host)
    const workbuddy = createWorkBuddyManager(host, { ...config.workbuddy,
      modelSettingsFile: join(dirname(snapshotFile), 'workbuddy-models.json'),
      catalogFile: join(dirname(snapshotFile), 'workbuddy-catalog.json'),
    })
    // API Key 渠道懒装配：lib/apikey-providers.js 与 lib/apikey-channel.js 由同任务
    // 另一分支开发、可能尚不存在。这里不能顶层 import（会让整个宿主模块加载失败），
    // 改为首次调用时动态 import；模块缺失只让本次 apikey.* 调用明确失败，
    // 不影响其它渠道，也不影响本模块加载。规格可经 testDeps.apiKeyProviders 注入
    // （函数 apikeyProvider(id)、{APIKEY_PROVIDERS} 或 {id:spec} 映射均可）；
    // 工厂经 testDeps.createApiKeyManager 注入（测试用）。
    const apikeyResolveSpec = providers => {
      if (typeof providers === 'function') return providers
      if (providers && typeof providers === 'object') {
        return id => typeof providers.apikeyProvider === 'function' ? providers.apikeyProvider(id) : (providers.APIKEY_PROVIDERS ?? providers)[id]
      }
      return () => undefined
    }
    const injectedSpecs = apikeyResolveSpec(testDeps.apiKeyProviders)
    const createLazyApiKeyManager = id => {
      let manager = null
      let loading = null
      let disposed = false
      const load = () => {
        if (manager) return Promise.resolve(manager)
        if (disposed) throw new Error('请求已结束')
        if (loading) return loading
        loading = (async () => {
          const spec = injectedSpecs(id) ?? await import('./apikey-providers.js').then(m => m.apikeyProvider?.(id) ?? m.APIKEY_PROVIDERS?.[id], () => undefined)
          if (!spec) throw new Error('不支持此渠道')
          const factory = testDeps.createApiKeyManager ?? await import('./apikey-channel.js').then(m => m.createApiKeyManager, () => undefined)
          if (typeof factory !== 'function') throw new Error('API Key 渠道模块未就绪')
          const created = await factory(host, spec, {
            stateFile: join(dirname(snapshotFile), `${id}-state.json`),
            catalogFile: join(dirname(snapshotFile), `${id}-catalog.json`),
            modelSettingsFile: join(dirname(snapshotFile), `${id}-models.json`),
          })
          if (disposed) { created?.dispose?.(); throw new Error('请求已结束') }
          manager = created
          return created
        })().catch(error => { loading = null; throw error })
        return loading
      }
      return {
        call: (method, payload, signal) => load().then(loaded => loaded.call(method, payload, signal)),
        // 内部快照不带 provider：投影需要它，这里按本包装器的白名单 id 注入，
        // RPC 路由与设置快照采集两条路径都拿到同一形状。
        collectSnapshot: signal => load().then(loaded => loaded.collectSnapshot(signal)).then(snapshot => ({ ...snapshot, provider: id })),
        async invalidate() {
          const loaded = loading ? await loading.catch(() => null) : manager
          await loaded?.invalidate?.()
        },
        dispose() {
          disposed = true
          loading?.catch(() => {})
          loading?.then(loaded => loaded?.dispose?.())
          manager?.dispose?.()
          manager = null
        },
      }
    }
    // 每渠道一个懒包装器；方法 + payload.provider 两层路由，未知渠道在
    // guardedRpc 已先拒，这里是兜底（规格表缺失时同样报「不支持此渠道」）。
    const apikeyManagers = new Map(APIKEY_PROVIDER_IDS.map(id => [id, createLazyApiKeyManager(id)]))
    const apikeyRouter = {
      get(provider) {
        return apikeyManagers.get(provider) ?? { call: () => { throw new Error('不支持此渠道') } }
      },
      async invalidate() { await Promise.all([...apikeyManagers.values()].map(entry => entry.invalidate())) },
      dispose() { for (const entry of apikeyManagers.values()) entry.dispose() },
    }
    // 快照必须经 collectSnapshot 收集（契约 §管理器）；写方法走 manager.call。
    const apikeyManagerShim = {
      call: (method, payload, signal) => method === 'apikey.snapshot'
        ? apikeyRouter.get(payload?.provider).collectSnapshot(signal)
        : apikeyRouter.get(payload?.provider).call(method, payload, signal),
    }
    // 自管多账号渠道懒装配：按 MANAGED_PROVIDER_IDS（或测试注入）统一管理。
    const injectedManagedSpecs = apikeyResolveSpec(testDeps.managedProviders)
    const managedIds = Array.isArray(testDeps.managedProviderIds) ? testDeps.managedProviderIds : MANAGED_PROVIDER_IDS
    const createLazyManagedManager = id => {
      let manager = null
      let loading = null
      let disposed = false
      let cachedSpec = null
      const load = () => {
        if (manager) return Promise.resolve(manager)
        if (disposed) throw new Error('请求已结束')
        if (loading) return loading
        loading = (async () => {
          const spec = injectedManagedSpecs(id) ?? await import('./managed-providers/index.js').then(m => m.managedProvider?.(id), () => undefined)
          if (!spec) throw new Error('不支持此渠道')
          cachedSpec = spec
          const factory = testDeps.createManagedManager ?? createManagedChannelManager
          const created = await factory(host, spec, {
            stateFile: join(dirname(snapshotFile), `${id}-state.json`),
            catalogFile: join(dirname(snapshotFile), `${id}-catalog.json`),
            modelSettingsFile: join(dirname(snapshotFile), `${id}-models.json`),
          })
          if (disposed) { created?.dispose?.(); throw new Error('请求已结束') }
          manager = created
          return created
        })().catch(error => { loading = null; throw error })
        return loading
      }
      const initialSpec = injectedManagedSpecs(id) ?? defaultManagedProvider(id)
      return {
        id,
        get supportsCheckin() { return typeof (cachedSpec ?? initialSpec)?.checkin === 'function' },
        get checkinResetHour() { return (cachedSpec ?? initialSpec)?.checkinResetHour ?? 0 },
        get supportsClaimRewards() { return typeof (cachedSpec ?? initialSpec)?.claimRewards === 'function' },
        get supportsCompleteTasks() { return typeof (cachedSpec ?? initialSpec)?.completeTasks === 'function' },
        get taskResetHour() { return (cachedSpec ?? initialSpec)?.taskResetHour ?? 0 },
        call: (method, payload, signal) => load().then(loaded => loaded.call(method, payload, signal)),
        collectSnapshot: signal => load().then(loaded => loaded.collectSnapshot(signal)),
        listAccounts: signal => load().then(loaded => loaded.listAccounts(signal)),
        getLoginUrl: () => manager?.getLoginUrl?.() ?? '',
        async invalidate() {
          const loaded = loading ? await loading.catch(() => null) : manager
          await loaded?.invalidate?.()
        },
        dispose() {
          disposed = true
          loading?.catch(() => {})
          loading?.then(loaded => loaded?.dispose?.())
          manager?.dispose?.()
          manager = null
        },
      }
    }
    const managedManagers = new Map(managedIds.map(id => [id, createLazyManagedManager(id)]))
    // 预加载已知自管渠道的静态规格以获知签到/任务能力声明
    void import('./managed-providers/index.js').then(mod => {
      if (!active || !Array.isArray(mod?.MANAGED_PROVIDERS)) return
      for (const spec of mod.MANAGED_PROVIDERS) {
        if (managedManagers.has(spec.id)) {
          // 规格在 load 时同样会读取；这里无需阻塞 apply
        }
      }
    }).catch(() => {})
    const managedRouter = {
      get(provider) {
        return managedManagers.get(provider) ?? { call: () => { throw new Error('不支持此渠道') } }
      },
      async invalidate(provider) {
        if (provider) await managedManagers.get(provider)?.invalidate?.()
        else await Promise.all([...managedManagers.values()].map(entry => entry.invalidate()))
      },
      dispose() { for (const entry of managedManagers.values()) entry.dispose() },
    }
    const managedManagerShim = {
      call: (method, payload, signal) => method === 'managed.snapshot' && payload?.localOnly !== true
        ? managedRouter.get(payload?.provider).collectSnapshot(signal)
        : managedRouter.get(payload?.provider).call(method, payload, signal),
    }
    let automationService = null
    const automationShim = {
      call: (method, payload, signal) => {
        if (!automationService) throw new Error('自动化服务未就绪')
        return automationService.call(method, payload, signal)
      },
    }
    const managers = new Map([
      ...[...PLAN_METHODS].map(method => [method, plan]),
      ...[...WORKBUDDY_METHODS].map(method => [method, workbuddy]),
      ...[...APIKEY_METHODS].map(method => [method, apikeyManagerShim]),
      ...[...MANAGED_METHODS].map(method => [method, managedManagerShim]),
      ...[...AUTOMATION_METHODS].map(method => [method, automationShim]),
    ])
    const dispatch = async (method, payload, signal) => {
      const manager = managers.get(method)
      if (manager) return { ok: true, value: await manager.call(method, payload, signal) }
      if (!channelRpc) {
        let timeout
        try {
          await Promise.race([ready, new Promise(resolve => { timeout = setTimeout(resolve, BACKEND_READY_TIMEOUT_MS); timeout.unref?.() })])
        } finally { clearTimeout(timeout) }
      }
      signal?.throwIfAborted()
      if (!channelRpc) throw new Error('渠道后端未就绪')
      return channelRpc(method, payload, signal)
    }
    const rpc = guardedRpc(dispatch)
    const checkinKey = settingsResourceKey('checkin.status', 'daily')
    const automationKey = settingsResourceKey('automation.status', 'automation')
    const automationSettings = createAutomationSettings({
      file: testDeps.automationFile ?? join(dirname(snapshotFile), 'automation.json'),
      defaults: {
        autoCheckin: config.autoCheckin !== false,
        autoClaimRewards: config.autoClaimRewards !== false,
        autoCompleteTasks: config.autoCompleteTasks === true,
        cotLoopGuard: config.cotLoopGuard?.enabled !== false,
      },
      allowedProviders: () => [...ALL_PROVIDER_IDS, ...managedIds],
    })
    const cotLoopGuard = installCotLoopGuard(host, {
      watch: config.cotLoopGuard,
      maxResumes: config.cotLoopGuard?.maxResumes,
      isEnabled: provider => automationSettings.isCotLoopGuardEnabled(provider),
      createMessage: testDeps.createUserMessage,
    })
    const checkin = createDailyCheckin({
      dir: join(dirname(snapshotFile), 'daily-checkin'),
      adapters: settingsCheckinAdapters({ standalone: config.backend === 'standalone', rpc, workbuddy, managed: managedManagers }),
      isEnabled: provider => automationSettings.isAutoCheckinEnabled(provider),
      logger: host.logger,
      async onChange(provider, outcome) {
        await snapshots.changed(checkinKey)
        if (outcome.kind === 'claimed') {
          const writeMethod = provider === 'workbuddy' ? 'workbuddy.checkin'
            : managedManagers.has(provider) ? 'managed.checkin' : 'credits.claimAll'
          await updateSettingsSnapshots(snapshots, writeMethod, { provider }, null)
        }
      },
    })
    const autoTasks = createAutoTasks({
      dir: join(dirname(snapshotFile), 'auto-tasks'),
      adapters: settingsTaskAdapters({ standalone: config.backend === 'standalone', rpc, managed: managedManagers }),
      isEnabled: (provider, mode) => mode === 'completeTasks'
        ? automationSettings.isAutoCompleteTasksEnabled(provider)
        : automationSettings.isAutoClaimRewardsEnabled(provider),
      logger: host.logger,
      async onChange(provider, mode, outcome) {
        await snapshots.changed(automationKey)
        if (outcome.kind === 'claimed' || outcome.kind === 'completed') {
          const writeMethod = managedManagers.has(provider)
            ? (mode === 'completeTasks' ? 'managed.completeTasks' : 'managed.claimRewards')
            : 'onboarding.claim'
          await updateSettingsSnapshots(snapshots, writeMethod, { provider }, null)
        }
      },
    })
    automationService = {
      async call(method, payload, signal) {
        if (method === 'automation.status') {
          const tasks = await autoTasks.status()
          return { config: automationSettings.snapshot(), tasks: tasks.providers }
        }
        if (method === 'automation.setConfig') {
          const updated = await automationSettings.update(payload)
          if (testDeps.autoCollect !== false) {
            if (payload.autoCheckin === true) void checkin.tick()
            if (payload.autoClaimRewards === true || payload.autoCompleteTasks === true) void autoTasks.tick()
          }
          const tasks = await autoTasks.status()
          return { config: updated, tasks: tasks.providers }
        }
        if (method === 'automation.run') {
          const mode = payload.mode === 'completeTasks' ? 'completeTasks' : 'claimRewards'
          const results = await autoTasks.run(payload.provider, mode, payload.accountId, signal, false)
          return { provider: payload.provider, mode, results }
        }
        throw new Error('不支持此操作')
      },
    }
    const resources = settingsResources((method, payload, signal) =>
      method === 'plan.snapshot' ? plan.collectSnapshot(signal) : rpc(method, payload, signal), publicResult, { managedIds })
    resources.set(checkinKey, {
      collect: async () => publicCheckinStatus(await checkin.status(), managedIds),
      restore: value => publicCheckinStatus(value, managedIds),
    })
    resources.set(automationKey, {
      collect: async () => publicAutomationStatus(await automationService.call('automation.status', {})),
      restore: publicAutomationStatus,
    })
    const snapshots = createSettingsSnapshots(snapshotFile, resources, { logger: host.logger })
    if (testDeps.autoCollect !== false) {
      void snapshots.refresh(resources.keys())
      checkin.start()
      autoTasks.start()
    }
    host.effect(() => () => { active = false; markReady(); channelRpc = null; cotLoopGuard.dispose(); checkin.dispose(); autoTasks.dispose(); snapshots.dispose(); plan.dispose(); workbuddy.dispose(); apikeyRouter.dispose(); managedRouter.dispose() })
    if (config.backend === 'standalone') {
      if (host.get('accountPool')) {
        host.logger?.warn?.('[unified-router] 原插件账号池正在运行，请先选择共用模式。')
      } else void import('./backend.js').then(({ mountBackend }) => {
        if (active) mountBackend(host, raw => { if (active) { channelRpc = raw; markReady() } },
          { qoderCatalogFile: join(dirname(snapshotFile), 'qoder-cn-catalog.json'), catalogDir: dirname(snapshotFile) })
      }).catch((error) => {
        host.logger?.warn?.(`[unified-router] 独立后端启动失败：${error instanceof Error ? error.message : String(error)}`)
        markReady()
      })
    } else {
      try { channelRpc = sharedTransport(host.connection, host); markReady() }
      catch {
        host.logger?.warn?.('[unified-router] 当前主机不支持共用渠道后端。')
        markReady()
      }
    }
    const reply = (rpcId, result) => Response.json({ type: 'server-response', rpcId, result: result?.ok === false
      ? { ...result, error: { ...result.error, details: {} } } : result }, { headers: { 'cache-control': 'no-store' } })
    host.effect(() => host.connection.fetch.register({
      path: '/api/unified-router', methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
        if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return new Response('expected application/json', { status: 415 })
        let message
        try {
          // 先按 content-length 预判：超大请求直接拒，不把整份 body 读进内存。
          const declared = Number(request.headers.get('content-length'))
          if (Number.isFinite(declared) && declared > 65536) return new Response('request too large', { status: 413 })
          const body = await request.text()
          if (Buffer.byteLength(body) > 65536) return new Response('request too large', { status: 413 })
          message = JSON.parse(body)
        }
        catch { return new Response('invalid JSON', { status: 400 }) }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId.slice(0, 256) : 'invalid-request'
        const call = message?.payload
        if (message?.type !== 'client-request' || message.method !== 'unified-router' || typeof message.rpcId !== 'string' || message.rpcId.length > 256 || typeof call?.method !== 'string' || !call.payload || typeof call.payload !== 'object' || Array.isArray(call.payload)) return reply(rpcId, { ok: false, error: { code: 'unified-router/bad-request', message: '请求无效。' } })
        if (writeMethods.has(call.method) && !sameOriginRequest(request)) return reply(rpcId, { ok: false, error: { code: 'unified-router/forbidden', message: '请求来源无效。' } })
         if (writeMethods.has(call.method) && typeof host.connection.requestRejection === 'function') {
           let rejection = 403
           try { rejection = host.connection.requestRejection(request) } catch {}
           if (rejection !== undefined) return reply(rpcId, { ok: false, error: { code: 'unified-router/forbidden', message: '请求未通过主机授权。' } })
         }
         if (!active) return reply(rpcId, { ok: false, error: { code: 'unified-router/not-ready', message: '渠道后端未就绪，请检查后端模式和原插件状态。' } })
        try {
          const { method, payload } = call
          request.signal.throwIfAborted()
          if (method === 'settings.snapshot') {
            if (payload.resource === undefined) return reply(rpcId, { ok: true, value: await snapshots.readAll(payload.cursor) })
            const key = settingsResourceKey(payload.resource, payload.provider)
            if (!resources.has(key)) throw new Error('不支持此资源')
            return reply(rpcId, { ok: true, value: await snapshots.read(key) })
          }
          if (method === 'settings.refresh') {
            const provider = payload.provider
            if (provider === 'all') {
              void snapshots.refresh(resources.keys())
              return reply(rpcId, { ok: true, value: null })
            }
            if (typeof provider !== 'string') throw new Error('不支持此渠道')
            const keys = [...resources.keys()].filter(key => key.startsWith(provider + '/'))
            if (!keys.length) throw new Error('不支持此渠道')
            if (provider === PLAN_PROVIDER_ID) {
              plan.invalidateCatalog()
              await snapshots.changed(settingsResourceKey('plan.snapshot', provider))
            } else if (APIKEY_PROVIDER_IDS.includes(provider)) {
              await apikeyRouter.get(provider).invalidate()
              await snapshots.changed(settingsResourceKey('apikey.snapshot', provider))
            } else if (managedManagers.has(provider)) {
              await managedRouter.invalidate(provider)
              void snapshots.refresh([checkinKey, automationKey, ...keys])
            } else void snapshots.refresh(['provider.status', checkinKey, automationKey, ...keys])
            return reply(rpcId, { ok: true, value: null })
          }
          if (method === 'workbuddy.snapshot' && payload.localOnly === true) {
            if (payload.provider !== 'workbuddy') throw new Error('不支持此渠道')
            return reply(rpcId, { ok: true, value: publicResult(method, { loginUrl: workbuddy.getLoginUrl() }) })
          }
          if (method === 'managed.snapshot' && payload.localOnly === true) {
            if (!managedManagers.has(payload.provider)) throw new Error('不支持此渠道')
            return reply(rpcId, { ok: true, value: publicResult(method, { provider: payload.provider, loginUrl: managedRouter.get(payload.provider).getLoginUrl() }) })
          }
          if (payload.snapshot === true) {
            const key = settingsResourceKey(method, payload.provider)
            if (!resources.has(key)) throw new Error('不支持此资源')
            const entry = await snapshots.read(key)
            return reply(rpcId, { ok: true, value: { ...entry?.value, snapshot: { at: entry?.at ?? null, stale: entry?.stale === true } } })
          }
          if (checkin.canClaim(payload.provider)) {
            if (method === 'credits.claimAll' && payload.provider !== 'workbuddy' && !managedManagers.has(payload.provider)) {
              const records = await checkin.claim(payload.provider, undefined, request.signal)
              const results = records.map(({ accountId, nickname, outcome, repeated }) => ({
                accountId, nickname, outcome: repeated && outcome.kind === 'claimed' ? { kind: 'already-claimed' } : outcome,
              }))
              return reply(rpcId, { ok: true, value: publicResult(method, { results }) })
            }
            if (method === 'workbuddy.checkin' && payload.provider === 'workbuddy') {
              if (typeof payload.accountId !== 'string' || !payload.accountId) throw new Error('账号无效')
              const [record] = await checkin.claim(payload.provider, payload.accountId, request.signal)
              const { kind, credit, streak } = record.outcome
              const outcome = kind === 'already-claimed' || record.repeated && kind === 'claimed' ? 'done' : kind
              return reply(rpcId, { ok: true, value: publicResult(method, { outcome, credit, streak }) })
            }
            if (method === 'managed.checkin' && managedManagers.has(payload.provider)) {
              if (typeof payload.accountId !== 'string' || !payload.accountId) throw new Error('账号无效')
              const [record] = await checkin.claim(payload.provider, payload.accountId, request.signal)
              const { kind, credit, streak } = record.outcome
              const outcome = kind === 'already-claimed' || record.repeated && kind === 'claimed' ? 'done' : kind
              return reply(rpcId, { ok: true, value: publicResult(method, { provider: payload.provider, outcome, credit, streak }) })
            }
          }
          const value = publicResult(method, await rpc(method, payload, request.signal))
          if (testDeps.autoCollect !== false) await updateSettingsSnapshots(snapshots, method, payload, value)
          return reply(rpcId, { ok: true, value })
        } catch {
          return reply(rpcId, { ok: false, error: { code: request.signal.aborted ? 'unified-router/aborted' : 'unified-router/operation-failed', message: request.signal.aborted ? '请求已取消。' : '操作失败。' } })
        }
      },
    }))
  })
}
