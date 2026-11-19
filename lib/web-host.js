import { normalizePlanParams, PLAN_EFFORTS } from "./sensenova-params.js"
import { guardedRpc, sharedTransport, loginUrl, PROVIDERS, PLAN_PROVIDER_ID, PLAN_METHODS, WORKBUDDY_METHODS } from './rpc.js'
import { createSenseNovaManager } from './sensenova.js'
import { createWorkBuddyManager } from './workbuddy.js'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { createSettingsSnapshots } from './settings-snapshots.js'
import { dirname, join } from 'node:path'
import { createDailyCheckin } from './daily-checkin.js'
import { publicCheckinStatus, settingsCheckinAdapters, settingsResources, settingsResourceKey, settingsSnapshotFile, updateSettingsSnapshots } from './settings-providers.js'
export const name = 'dsh-unified-router'
const finite = value => Number.isFinite(value) ? value : null
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const planWriteMethods = new Set(['plan.setKey', 'plan.setEnabled', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels'])
// 登录会写凭据、开关会改注册状态：这些写操作要求同源 + 主机授权。
// workbuddy.snapshot 虽名为读，但 token 临期续期会经 client.auth.set 落盘新凭据，
// 同样按写操作门禁（客户端补读是同源请求，不受影响）。
const workbuddyWriteMethods = new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', ...WORKBUDDY_MODEL_WRITES])
const writeMethods = new Set([...planWriteMethods, ...workbuddyWriteMethods, 'settings.refresh', 'credits.claimAll'])
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
    const managers = new Map([
      ...[...PLAN_METHODS].map(method => [method, plan]),
      ...[...WORKBUDDY_METHODS].map(method => [method, workbuddy]),
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
    const checkin = createDailyCheckin({
      dir: join(dirname(snapshotFile), 'daily-checkin'),
      adapters: settingsCheckinAdapters({ standalone: config.backend === 'standalone', rpc, workbuddy }),
      enabled: config.autoCheckin !== false,
      logger: host.logger,
      async onChange(provider, outcome) {
        await snapshots.changed(checkinKey)
        if (outcome.kind === 'claimed') {
          await updateSettingsSnapshots(snapshots, provider === 'workbuddy' ? 'workbuddy.checkin' : 'credits.claimAll', { provider }, null)
        }
      },
    })
    const resources = settingsResources((method, payload, signal) =>
      method === 'plan.snapshot' ? plan.collectSnapshot(signal) : rpc(method, payload, signal), publicResult)
    resources.set(checkinKey, {
      collect: async () => publicCheckinStatus(await checkin.status()),
      restore: publicCheckinStatus,
    })
    const snapshots = createSettingsSnapshots(snapshotFile, resources, { logger: host.logger })
    if (testDeps.autoCollect !== false) {
      void snapshots.refresh(resources.keys())
      checkin.start()
    }
    host.effect(() => () => { active = false; markReady(); channelRpc = null; checkin.dispose(); snapshots.dispose(); plan.dispose(); workbuddy.dispose() })
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
            if (typeof provider !== 'string') throw new Error('不支持此渠道')
            const keys = [...resources.keys()].filter(key => key.startsWith(provider + '/'))
            if (!keys.length) throw new Error('不支持此渠道')
            if (provider === PLAN_PROVIDER_ID) {
              plan.invalidateCatalog()
              await snapshots.changed(settingsResourceKey('plan.snapshot', provider))
            } else void snapshots.refresh(['provider.status', checkinKey, ...keys])
            return reply(rpcId, { ok: true, value: null })
          }
          if (method === 'workbuddy.snapshot' && payload.localOnly === true) {
            if (payload.provider !== 'workbuddy') throw new Error('不支持此渠道')
            return reply(rpcId, { ok: true, value: publicResult(method, { loginUrl: workbuddy.getLoginUrl() }) })
          }
          if (payload.snapshot === true) {
            const key = settingsResourceKey(method, payload.provider)
            if (!resources.has(key)) throw new Error('不支持此资源')
            const entry = await snapshots.read(key)
            return reply(rpcId, { ok: true, value: { ...entry?.value, snapshot: { at: entry?.at ?? null, stale: entry?.stale === true } } })
          }
          if (checkin.canClaim(payload.provider)) {
            if (method === 'credits.claimAll' && payload.provider !== 'workbuddy') {
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
