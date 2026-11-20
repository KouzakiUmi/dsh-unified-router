// 通用自管多账号渠道管理器（供 AStudio、豆包工作、Coze、CodeArts 等多账号渠道共用）。
//
// 职责：
// - 账号索引与独立凭据存储（UNIFIED_ROUTER_<UPPER>_ACCOUNTS + UNIFIED_ROUTER_<UPPER>_ACCOUNT_<6HEX>）
// - 三类接入方式：浏览器登录（managed.login）、导入本机桌面端登录态（managed.importLocal）、粘贴凭据（managed.importCredential）
// - 逐账号额度/窗口采集、软失败容错、凭据续期严格回写本账号引用（删号不复活）
// - 实时模型目录拉取、磁盘缓存（catalog-cache.js）、兜底表与模型设置持久化（managed-models.js）
// - 多账号轮询选号与推理适配器发布（managed-llm.js）
// - 每日签到（checkin）、奖励领取（claimRewards）与显式任务执行（completeTasks）
//
// 安全边界：凭据原文与上游响应正文绝不进入返回值、快照或错误文案。
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createManagedModelSettings, MANAGED_MODEL_WRITES } from './managed-models.js'
import { createManagedAdapter } from './managed-llm.js'
import { readCatalogCache, saveCatalogCache } from './catalog-cache.js'
import { readableModelName } from './model-catalog.js'
import { PLAN_EFFORTS } from './sensenova-params.js'

export const MANAGED_METHODS = Object.freeze(new Set([
  'managed.snapshot',
  'managed.models',
  'managed.refreshModels',
  'managed.login',
  'managed.importLocal',
  'managed.importCredential',
  'managed.updateAccount',
  'managed.logout',
  'managed.setEnabled',
  'managed.checkin',
  'managed.claimRewards',
  'managed.completeTasks',
  ...MANAGED_MODEL_WRITES,
]))

export const MANAGED_WRITE_METHODS = Object.freeze(new Set([
  // snapshot / models 可能触发凭据续期、目录落盘缓存或适配器注册，按写操作同源 + 主机授权门禁（与 workbuddy.snapshot 一致）。
  'managed.snapshot',
  'managed.models',
  'managed.login',
  'managed.importLocal',
  'managed.importCredential',
  'managed.updateAccount',
  'managed.logout',
  'managed.setEnabled',
  'managed.checkin',
  'managed.claimRewards',
  'managed.completeTasks',
  'managed.refreshModels',
  ...MANAGED_MODEL_WRITES,
]))

export const MANAGED_MAX_ACCOUNTS = 8
export const MANAGED_ERROR_CODES = Object.freeze(new Set([
  'not_configured', 'credential_error', 'auth_expired', 'auth_error', 'upstream_error', 'checkin_error', 'task_error', 'import_error', 'unsupported',
]))
export const MANAGED_CHECKIN_OUTCOMES = Object.freeze(new Set(['claimed', 'already-claimed', 'done', 'inactive', 'ineligible', 'failed', 'pending']))
export const MANAGED_TASK_OUTCOMES = Object.freeze(new Set(['claimed', 'completed', 'done', 'empty', 'unsupported', 'failed', 'pending']))

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

function serviceOf(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {}
  try { return ctx?.[name] } catch { return undefined }
}

function assertLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址无效')
  let url
  try { url = new URL(value) } catch { throw new Error('登录地址无效') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址无效')
  return url.href
}

export function publicManagedWindow(source) {
  const row = object(source)
  const name = text(row.name, 80)
  if (!name) return null
  return {
    name,
    used: finite(row.used),
    amount: finite(row.amount),
    limit: finite(row.limit),
    balance: finite(row.balance),
    display: text(row.display, 120),
    unit: text(row.unit, 40),
    resetsAt: text(row.resetsAt, 48),
    span: finite(row.span),
    runsOutAt: text(row.runsOutAt, 48),
    runsOut: finite(row.runsOut),
  }
}

export function publicManagedModel(source) {
  const row = object(source)
  const id = text(row.id, 256)
  if (!id || id.trim() !== id || ['__proto__', 'prototype', 'constructor'].includes(id)) return null
  const rawEfforts = Array.isArray(row.efforts) ? row.efforts.filter(e => typeof e === 'string').slice(0, 16) : []
  const mappedEfforts = rawEfforts.map(e => e === 'none' ? 'off' : e)
  const efforts = PLAN_EFFORTS.filter(level => mappedEfforts.includes(level))
  return {
    id,
    name: readableModelName(id, text(row.name, 160)),
    context: finite(row.context) ?? finite(row.contextWindow),
    output: finite(row.output) ?? finite(row.maxOutputLength),
    attachment: typeof row.attachment === 'boolean' ? row.attachment : typeof row.vision === 'boolean' ? row.vision : null,
    reasoning: row.reasoning === true || efforts.length > 0,
    efforts,
    defaultEffort: row.defaultEffort === 'none' ? 'off' : text(row.defaultEffort, 40),
    free: row.free === true || (row.free !== false && row.rate === 0),
    rate: finite(row.rate),
    rateWas: finite(row.rateWas),
    rateLabel: text(row.rateLabel, 24),
    rateTone: ['neutral', 'info', 'success', 'warning'].includes(row.rateTone) ? row.rateTone : '',
    protocol: ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(row.protocol) ? row.protocol : '',
    api: row.api && typeof row.api === 'object' ? {
      npm: text(row.api.npm, 120),
      url: text(row.api.url, 512),
      protocol: text(row.api.protocol, 40),
    } : null,
    // 严格白名单过滤内部路由元信息，防止上游任意字段透传进磁盘缓存。
    meta: row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? Object.fromEntries([
      ...(typeof row.meta.maasType === 'string' && row.meta.maasType ? [['maasType', text(row.meta.maasType, 32)]] : []),
      ...(typeof row.meta.modelItemKey === 'string' && row.meta.modelItemKey ? [['modelItemKey', text(row.meta.modelItemKey, 160)]] : []),
      ...(typeof row.meta.itemId === 'string' || typeof row.meta.itemId === 'number' ? [['itemId', text(String(row.meta.itemId), 64)]] : []),
      ...(typeof row.meta.memoryProfile === 'string' && row.meta.memoryProfile ? [['memoryProfile', text(row.meta.memoryProfile, 64)]] : []),
    ]) : undefined,
  }
}

export function createManagedChannelManager(ctx, spec, deps = {}) {
  const id = spec.id
  const upperId = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const accountsRef = `UNIFIED_ROUTER_${upperId}_ACCOUNTS`
  const accountRefPrefix = `UNIFIED_ROUTER_${upperId}_ACCOUNT_`
  const accountIdPattern = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-f]{8}$`)
  const accountRefPattern = new RegExp(`^${accountRefPrefix}[0-9A-F]{6}$`)

  const credentials = () => serviceOf(ctx, 'credentials') ?? null
  const logger = serviceOf(ctx, 'logger') ?? ctx?.logger
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const stateFile = deps.stateFile
  const catalogFile = deps.catalogFile
  const modelSettingsFile = deps.modelSettingsFile
  const adapterFactory = deps.createAdapter ?? createManagedAdapter
  const modelSettings = createManagedModelSettings(modelSettingsFile, id)

  let disposed = false
  let activeLoginUrl = ''
  let registration = null
  let registered = false
  let regGeneration = 0
  let catalogRows = []
  let catalogSource = 'fallback'
  let catalogAt = 0
  let catalogJob = null
  let rrCursor = 0
  const rateLimitedUntil = new Map() // `${accountId}:${modelId}` -> ts

  // 渠道开关持久化（默认：有账号后自动启用，显式关闭则保持关闭）。
  function readChannelState() {
    if (!stateFile) return { enabled: true, explicit: false }
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
      if (typeof saved?.enabled === 'boolean') return { enabled: saved.enabled, explicit: true }
    } catch {}
    return { enabled: true, explicit: false }
  }
  let channelState = readChannelState()

  async function writeChannelState(nextEnabled) {
    if (!stateFile) return
    const temporary = stateFile + '.' + randomUUID() + '.tmp'
    try {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify({ enabled: nextEnabled === true }), { mode: 0o600 })
      await rename(temporary, stateFile)
    } finally { await unlink(temporary).catch(() => {}) }
    channelState = { enabled: nextEnabled === true, explicit: true }
  }

  // 串行写队列
  let writeQueue = Promise.resolve()
  const serialized = task => {
    const run = writeQueue.then(task, task)
    writeQueue = run.then(() => {}, () => {})
    return run
  }

  // 凭据服务读写封装
  async function resolveRaw(ref) {
    const service = credentials()
    if (!service || typeof service.resolve !== 'function') return null
    try {
      const raw = (await service.resolve(ref))?.value
      return typeof raw === 'string' && raw ? raw : null
    } catch { return null }
  }

  async function writeRaw(ref, value) {
    const service = credentials()
    if (!service || typeof service.set !== 'function') throw new Error('凭据服务不可用')
    await service.set(ref, value)
  }

  async function deleteRaw(ref) {
    const service = credentials()
    if (!service) return
    if (typeof service.delete === 'function') {
      await service.delete(ref).catch(() => {})
    } else if (typeof service.set === 'function') {
      await service.set(ref, '').catch(() => {})
    }
  }

  function sanitizeEntry(raw) {
    const row = object(raw)
    const entryId = typeof row.id === 'string' && accountIdPattern.test(row.id) ? row.id : ''
    const credentialRef = typeof row.credentialRef === 'string' && accountRefPattern.test(row.credentialRef) ? row.credentialRef : ''
    if (!entryId || !credentialRef) return null
    return {
      id: entryId,
      credentialRef,
      name: text(row.name, 80) || entryId,
      uid: text(row.uid, 120),
      // 老索引条目缺 deviceId 时按渠道+账号 id 确定性派生，避免每次读取漂移。
      deviceId: typeof row.deviceId === 'string' && /^[0-9a-f]{32}$/.test(row.deviceId)
        ? row.deviceId
        : createHash('sha256').update(`managed-device|${id}|${entryId}`).digest('hex').slice(0, 32),
      enabled: row.enabled !== false,
      source: ['browser', 'local', 'credential'].includes(row.source) ? row.source : 'browser',
      createdAt: finite(row.createdAt) ?? Date.now(),
    }
  }

  async function readIndex() {
    const raw = await resolveRaw(accountsRef)
    if (!raw) return { entries: [], corrupted: false }
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { entries: [], corrupted: true }
      const entries = parsed.slice(0, MANAGED_MAX_ACCOUNTS).map(sanitizeEntry).filter(Boolean)
      return { entries, corrupted: false }
    } catch {
      return { entries: [], corrupted: true }
    }
  }

  async function writeIndex(entries) {
    await writeRaw(accountsRef, JSON.stringify(entries.slice(0, MANAGED_MAX_ACCOUNTS)))
  }

  function generateAccountId(existing) {
    for (let i = 0; i < 32; i += 1) {
      const candidate = `${id}-${randomBytes(4).toString('hex')}`
      if (!existing.some(entry => entry.id === candidate)) return candidate
    }
    throw new Error('账号标识生成失败')
  }

  function generateCredentialRef(existing) {
    for (let i = 0; i < 32; i += 1) {
      const candidate = `${accountRefPrefix}${randomBytes(3).toString('hex').toUpperCase()}`
      if (!existing.some(entry => entry.credentialRef === candidate)) return candidate
    }
    throw new Error('凭据引用生成失败')
  }

  function sanitizeCredential(value) {
    if (typeof spec.sanitizeCredential === 'function') return spec.sanitizeCredential(value)
    const row = object(value)
    if (!Object.keys(row).length) return null
    return row
  }

  async function readAccountCredential(entry) {
    const raw = await resolveRaw(entry.credentialRef)
    if (!raw) return null
    try {
      return sanitizeCredential(JSON.parse(raw))
    } catch { return null }
  }

  async function saveAccountCredential(entryId, nextCredential) {
    const clean = sanitizeCredential(nextCredential)
    if (!clean) return false
    return serialized(async () => {
      if (disposed) return false
      const { entries, corrupted } = await readIndex()
      if (corrupted) return false
      const target = entries.find(entry => entry.id === entryId)
      // 删号后不得复活凭据
      if (!target) return false
      await writeRaw(target.credentialRef, JSON.stringify(clean))
      return true
    })
  }

  async function upsertAccount({ credential, name, uid, source }) {
    const clean = sanitizeCredential(credential)
    if (!clean) throw new Error('凭据格式无效')
    return serialized(async () => {
      if (disposed) throw new Error('请求已结束')
      const { entries, corrupted } = await readIndex()
      if (corrupted) throw new Error('账号索引异常，请先检查存储')
      const cleanUid = text(uid, 120)
      const existing = cleanUid ? entries.find(entry => entry.uid && entry.uid === cleanUid) : null
      if (existing) {
        await writeRaw(existing.credentialRef, JSON.stringify(clean))
        const updated = {
          ...existing,
          name: text(name, 80) || existing.name,
          source: ['browser', 'local', 'credential'].includes(source) ? source : existing.source,
        }
        await writeIndex(entries.map(entry => entry.id === existing.id ? updated : entry))
        return updated
      }
      if (entries.length >= MANAGED_MAX_ACCOUNTS) throw new Error(`最多支持 ${MANAGED_MAX_ACCOUNTS} 个账号`)
      const entry = {
        id: generateAccountId(entries),
        credentialRef: generateCredentialRef(entries),
        name: text(name, 80) || cleanUid || `${spec.title} 账号 ${entries.length + 1}`,
        uid: cleanUid,
        deviceId: randomBytes(16).toString('hex'),
        enabled: true,
        source: ['browser', 'local', 'credential'].includes(source) ? source : 'browser',
        createdAt: Date.now(),
      }
      await writeRaw(entry.credentialRef, JSON.stringify(clean))
      await writeIndex([...entries, entry])
      return entry
    })
  }

  function makeAccountHandle(entry) {
    return {
      entry,
      fetch: fetchImpl,
      getCredential: () => readAccountCredential(entry),
      saveCredential: next => saveAccountCredential(entry.id, next),
    }
  }

  // ---- 模型目录与适配器发布 ----
  function fallbackCatalog() {
    return (Array.isArray(spec.fallbackModels) ? spec.fallbackModels : []).map(publicManagedModel).filter(Boolean)
  }

  async function loadCatalog({ force = false, signal } = {}) {
    if (!force && catalogRows.length && Date.now() - catalogAt < 60_000 && catalogSource === 'remote') {
      return { rows: catalogRows, source: catalogSource }
    }
    if (!force && catalogJob) return catalogJob
    const job = (async () => {
      const { entries } = await readIndex()
      const enabledEntries = entries.filter(entry => entry.enabled !== false)
      let remote = null
      if (typeof spec.fetchModels === 'function') {
        const candidates = enabledEntries.length ? enabledEntries : entries
        for (const entry of candidates) {
          signal?.throwIfAborted()
          const cred = await readAccountCredential(entry)
          if (!cred) continue
          try {
            const raw = await spec.fetchModels(makeAccountHandle(entry), { signal })
            const parsed = (Array.isArray(raw) ? raw : []).map(publicManagedModel).filter(Boolean)
            if (parsed.length) { remote = parsed; break }
          } catch { /* 尝试下一个账号 */ }
        }
        if (!remote && !candidates.length && spec.publicCatalog === true) {
          try {
            const raw = await spec.fetchModels({ entry: null, fetch: fetchImpl, getCredential: async () => null, saveCredential: async () => false }, { signal })
            const parsed = (Array.isArray(raw) ? raw : []).map(publicManagedModel).filter(Boolean)
            if (parsed.length) remote = parsed
          } catch {}
        }
      }
      if (remote?.length) {
        catalogRows = remote
        catalogSource = 'remote'
        catalogAt = Date.now()
        await saveCatalogCache(catalogFile, remote, id).catch(() => {})
        return { rows: catalogRows, source: catalogSource }
      }
      const cached = readCatalogCache(catalogFile, id)
      if (cached?.length) {
        catalogRows = cached.map(publicManagedModel).filter(Boolean)
        catalogSource = 'cached'
      } else {
        catalogRows = fallbackCatalog()
        catalogSource = 'fallback'
      }
      return { rows: catalogRows, source: catalogSource }
    })().finally(() => { if (catalogJob === job) catalogJob = null })
    catalogJob = job
    return job
  }

  function releaseRegistration() {
    if (registration) {
      try { registration() } catch {}
      registration = null
    }
    registered = false
  }

  async function selectTransport(modelId, request, excludeIds = new Set()) {
    const { entries } = await readIndex()
    const enabledEntries = entries.filter(entry => entry.enabled !== false && !excludeIds.has(entry.id))
    if (!enabledEntries.length) throw new Error(`${spec.title}：尚未添加可用账号`)
    const now = Date.now()
    const healthy = enabledEntries.filter(entry => (rateLimitedUntil.get(`${entry.id}:${modelId}`) ?? 0) <= now)
    const pool = healthy.length ? healthy : enabledEntries
    if (typeof spec.createTransport !== 'function') {
      throw new Error(`${spec.title}：推理传输层未实现`)
    }
    const start = rrCursor++ % pool.length
    let lastError = null
    // 按轮询顺序逐账号故障切换：某个账号缺少推理凭据或初始化失败时自动尝试下一个账号。
    for (let offset = 0; offset < pool.length; offset += 1) {
      const picked = pool[(start + offset) % pool.length]
      const handle = makeAccountHandle(picked)
      const cred = await handle.getCredential()
      if (!cred) {
        lastError = new Error(`${spec.title}：账号凭据缺失，请重新登录`)
        continue
      }
      try {
        const baseTransport = await spec.createTransport(handle, { modelId, request })
        return {
          accountId: picked.id,
          markRateLimited(ms = 60_000) {
            rateLimitedUntil.set(`${picked.id}:${modelId}`, Date.now() + Math.max(5_000, ms))
          },
          ...baseTransport,
        }
      } catch (err) {
        lastError = err
      }
    }
    throw lastError ?? new Error(`${spec.title}：当前没有可用于推理的账号`)
  }

  async function syncRegistration(describedRows) {
    const ticket = ++regGeneration
    if (disposed) return false
    const llm = serviceOf(ctx, 'llm')
    if (!llm || typeof llm.registerAdapter !== 'function') return false
    const { entries } = await readIndex()
    const hasSignedIn = entries.some(entry => entry.enabled !== false)
    if (!channelState.enabled || !hasSignedIn) {
      releaseRegistration()
      llm.emitAdaptersUpdated?.()
      return false
    }
    const rows = describedRows ?? await modelSettings.list((await loadCatalog()).rows)
    if (disposed || ticket !== regGeneration) return false
    if (!rows.some(row => row.enabled)) {
      releaseRegistration()
      llm.emitAdaptersUpdated?.()
      return false
    }
    const built = await adapterFactory({
      spec,
      rows,
      selectTransport,
      get: name => serviceOf(ctx, name),
      providerId: id,
    })
    // 异步边界后复核：防止 await 期间发生 logout / setEnabled(false) / dispose 复活注册。
    const latest = await readIndex()
    const stillValid = !disposed && ticket === regGeneration && channelState.enabled
      && latest.entries.some(entry => entry.enabled !== false)
    if (!stillValid) {
      built?.adapter?.dispose?.()
      return false
    }
    releaseRegistration()
    const providerIds = Array.isArray(built?.providerIds) && built.providerIds.length ? built.providerIds : [id]
    const adapterObj = built?.adapter ?? built
    const disposer = llm.registerAdapter(providerIds, adapterObj)
    registration = typeof disposer === 'function' ? disposer : () => disposer?.dispose?.()
    registered = true
    llm.emitAdaptersUpdated?.()
    return true
  }

  async function collectSnapshot(signal) {
    if (disposed) throw new Error('请求已结束')
    signal?.throwIfAborted()
    const { entries } = await readIndex()
    const accounts = await Promise.all(entries.map(async entry => {
      signal?.throwIfAborted()
      const handle = makeAccountHandle(entry)
      const cred = await handle.getCredential()
      if (!cred) {
        return {
          id: entry.id, name: entry.name, uid: entry.uid, enabled: entry.enabled !== false,
          source: entry.source, signedIn: false, plan: '', balance: null, windows: [],
          updatedAt: null, error: 'credential_error',
        }
      }
      if (typeof spec.fetchUsage !== 'function') {
        return {
          id: entry.id, name: entry.name, uid: entry.uid, enabled: entry.enabled !== false,
          source: entry.source, signedIn: true, plan: '', balance: null, windows: [],
          updatedAt: Date.now(), error: '',
        }
      }
      try {
        const usage = await spec.fetchUsage(handle, { signal })
        const windows = (Array.isArray(usage?.windows) ? usage.windows : []).slice(0, 16).map(publicManagedWindow).filter(Boolean)
        const error = typeof usage?.error === 'string' && MANAGED_ERROR_CODES.has(usage.error) ? usage.error : ''
        return {
          id: entry.id,
          name: text(usage?.name, 80) || entry.name,
          uid: text(usage?.uid, 120) || entry.uid,
          enabled: entry.enabled !== false,
          source: entry.source,
          signedIn: usage?.signedIn !== false,
          plan: text(usage?.plan, 120),
          balance: finite(usage?.balance),
          unit: text(usage?.unit, 24),
          windows,
          updatedAt: finite(usage?.updatedAt) ?? Date.now(),
          error,
        }
      } catch {
        return {
          id: entry.id, name: entry.name, uid: entry.uid, enabled: entry.enabled !== false,
          source: entry.source, signedIn: true, plan: '', balance: null, windows: [],
          updatedAt: null, error: 'upstream_error',
        }
      }
    }))
    // 顺手同步一次模型适配器注册（仅首次或状态变化时生效）
    if (accounts.some(account => account.signedIn && account.enabled) && channelState.enabled && !registered) {
      await syncRegistration().catch(() => {})
    }
    return {
      provider: id,
      enabled: channelState.enabled,
      registered,
      authMethods: Array.isArray(spec.authMethods) ? spec.authMethods : ['browser'],
      credentialHint: text(spec.credentialHint, 160),
      accounts,
      loginUrl: activeLoginUrl,
    }
  }

  async function call(method, payload = {}, signal) {
    if (disposed) throw new Error('请求已结束')
    signal?.throwIfAborted()
    if (payload.provider !== id) throw new Error('不支持此渠道')

    if (method === 'managed.snapshot') {
      if (payload.localOnly === true) return { provider: id, loginUrl: activeLoginUrl }
      return collectSnapshot(signal)
    }

    if (method === 'managed.models' || method === 'managed.refreshModels') {
      const { rows, source } = await loadCatalog({ force: method === 'managed.refreshModels', signal })
      const models = await modelSettings.list(rows)
      if (method === 'managed.refreshModels') await syncRegistration(models).catch(() => {})
      return { provider: id, models, source }
    }

    if (MANAGED_MODEL_WRITES.includes(method)) {
      const models = await modelSettings.change(method, payload, () => catalogRows.length ? catalogRows : fallbackCatalog(), signal)
      await syncRegistration(models).catch(() => {})
      return { provider: id, models, source: catalogSource }
    }

    if (method === 'managed.setEnabled') {
      if (typeof payload.enabled !== 'boolean') throw new Error('渠道开关无效')
      await writeChannelState(payload.enabled)
      const isReg = await syncRegistration().catch(() => false)
      return { provider: id, enabled: channelState.enabled, registered: isReg }
    }

    if (method === 'managed.login') {
      if (typeof spec.loginWithBrowser !== 'function') throw new Error('该渠道不支持浏览器登录')
      activeLoginUrl = ''
      try {
        const result = await spec.loginWithBrowser({
          fetch: fetchImpl,
          signal,
          onUrl(url) {
            activeLoginUrl = assertLoginUrl(url)
          },
        })
        if (!result?.credential) return { provider: id, signedIn: false }
        const entry = await upsertAccount({
          credential: result.credential,
          name: result.name,
          uid: result.uid,
          source: 'browser',
        })
        await loadCatalog({ force: true, signal }).catch(() => {})
        const isReg = await syncRegistration().catch(() => false)
        return { provider: id, id: entry.id, signedIn: true, name: entry.name, uid: entry.uid, enabled: channelState.enabled, registered: isReg }
      } finally {
        activeLoginUrl = ''
      }
    }

    if (method === 'managed.importLocal') {
      if (typeof spec.importLocal !== 'function') throw new Error('该渠道不支持导入本机桌面端登录态')
      const result = await spec.importLocal({ fetch: fetchImpl, signal })
      if (!result?.credential) throw new Error('未检测到本机已登录账号')
      const entry = await upsertAccount({
        credential: result.credential,
        name: result.name,
        uid: result.uid,
        source: 'local',
      })
      await loadCatalog({ force: true, signal }).catch(() => {})
      const isReg = await syncRegistration().catch(() => false)
      return { provider: id, id: entry.id, signedIn: true, name: entry.name, uid: entry.uid, enabled: channelState.enabled, registered: isReg }
    }

    if (method === 'managed.importCredential') {
      if (typeof spec.parseCredential !== 'function') throw new Error('该渠道不支持手动粘贴凭据')
      const raw = typeof payload.credential === 'string' ? payload.credential.trim() : ''
      if (!raw || raw.length > 32_768) throw new Error('凭据内容无效')
      const result = await spec.parseCredential(raw, { fetch: fetchImpl, signal })
      if (!result?.credential) throw new Error('凭据验证失败')
      const entry = await upsertAccount({
        credential: result.credential,
        name: result.name,
        uid: result.uid,
        source: 'credential',
      })
      await loadCatalog({ force: true, signal }).catch(() => {})
      const isReg = await syncRegistration().catch(() => false)
      return { provider: id, id: entry.id, signedIn: true, name: entry.name, uid: entry.uid, enabled: channelState.enabled, registered: isReg }
    }

    if (method === 'managed.updateAccount') {
      const accountId = text(payload.accountId, 64)
      const patch = object(payload.patch)
      if (!accountId) throw new Error('账号无效')
      if (patch.nickname !== undefined && (typeof patch.nickname !== 'string' || !patch.nickname.trim() || [...patch.nickname.trim()].length > 80)) {
        throw new Error('账号名称无效')
      }
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('账号开关无效')
      const updated = await serialized(async () => {
        const { entries, corrupted } = await readIndex()
        if (corrupted) throw new Error('账号索引异常')
        const target = entries.find(entry => entry.id === accountId)
        if (!target) throw new Error('账号已变化，请刷新后重试')
        const next = {
          ...target,
          ...(patch.nickname !== undefined ? { name: patch.nickname.trim() } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        }
        await writeIndex(entries.map(entry => entry.id === accountId ? next : entry))
        return next
      })
      await syncRegistration().catch(() => {})
      return { provider: id, id: updated.id, name: updated.name, enabled: updated.enabled }
    }

    if (method === 'managed.logout') {
      const accountId = text(payload.accountId, 64)
      if (!accountId) throw new Error('账号无效')
      await serialized(async () => {
        const { entries, corrupted } = await readIndex()
        if (corrupted) throw new Error('账号索引异常')
        const target = entries.find(entry => entry.id === accountId)
        if (!target) throw new Error('账号已变化，请刷新后重试')
        await writeIndex(entries.filter(entry => entry.id !== accountId))
        await deleteRaw(target.credentialRef)
      })
      await syncRegistration().catch(() => {})
      return { provider: id, signedIn: false }
    }

    if (method === 'managed.checkin') {
      if (typeof spec.checkin !== 'function') throw new Error('该渠道不支持每日签到')
      const accountId = text(payload.accountId, 64)
      const { entries } = await readIndex()
      const target = entries.find(entry => entry.id === accountId)
      if (!target) throw new Error('账号已变化，请刷新后重试')
      const result = await spec.checkin(makeAccountHandle(target), { signal })
      const outcome = MANAGED_CHECKIN_OUTCOMES.has(result?.outcome) ? result.outcome : 'failed'
      return {
        provider: id,
        outcome,
        credit: finite(result?.credit),
        streak: finite(result?.streak),
        unsubmitted: result?.unsubmitted === true,
      }
    }

    if (method === 'managed.claimRewards' || method === 'managed.completeTasks') {
      const fn = method === 'managed.claimRewards' ? spec.claimRewards : spec.completeTasks
      if (typeof fn !== 'function') throw new Error('该渠道不支持此任务操作')
      const accountId = text(payload.accountId, 64)
      const { entries } = await readIndex()
      const target = entries.find(entry => entry.id === accountId)
      if (!target) throw new Error('账号已变化，请刷新后重试')
      const result = await fn(makeAccountHandle(target), { signal })
      const kind = MANAGED_TASK_OUTCOMES.has(result?.kind) ? result.kind : 'failed'
      return {
        provider: id,
        kind,
        claimed: finite(result?.claimed),
        completed: finite(result?.completed),
        points: finite(result?.points),
        retryable: result?.retryable === true,
      }
    }

    throw new Error('不支持此操作')
  }

  return {
    id,
    spec,
    call,
    collectSnapshot,
    getLoginUrl: () => activeLoginUrl,
    async listAccounts() {
      const { entries } = await readIndex()
      return entries.filter(entry => entry.enabled !== false).map(entry => ({ id: entry.id, name: entry.name }))
    },
    async invalidate() {
      catalogAt = 0
    },
    dispose() {
      if (disposed) return
      disposed = true
      regGeneration += 1
      activeLoginUrl = ''
      releaseRegistration()
    },
  }
}
