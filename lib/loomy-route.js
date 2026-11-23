// Loomy 上游路由检测、流式落地模型观测与本地状态持久化。
//
// 核心事实（参考 magpie-loomy 实证）：
// - Loomy 上游对受限账号会把 DeepSeek-V4.1-Flash 等请求静默降级路由到
//   spark-x2.6-low（或其它模型族），且照常扣 2x 积分、无 HTTP 错误。
// - 0 积分只读判定链（全程不发 chat 请求）：
//   ① GET /models（token 头）：401/403/100002/100003 判 expired；缺失 DeepSeek-V4.1-Flash 判 routed
//   ② GET /points/records?pageNo=1&pageSize=10（token 头，多副本连读取最新）：
//      余额 <= 0 判 exhausted；最新扣费 modelName 为 deepseek* 判 clean，spark* 或其它族判 routed；
//      账本可读但无任何对话扣费记录判 unknown（不覆盖已有定论）。
// - 安全边界：凭据与上游响应原文绝不进入返回值、快照或持久化文件。
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const LOOMY_API_BASE = 'https://loomyad.xunfei.cn/api/v1'
export const LOOMY_PROBE_MODEL = 'DeepSeek-V4.1-Flash'
export const LOOMY_ROUTE_METHODS = Object.freeze(new Set([
  'loomy.routeStatus',
  'loomy.checkRoute',
  'loomy.clearRoute',
  'loomy.setRouteConfig',
]))
export const LOOMY_ROUTE_VERDICTS = Object.freeze(new Set([
  'clean',
  'routed',
  'exhausted',
  'expired',
  'unknown',
]))
export const LOOMY_ROUTE_REASONS = Object.freeze(new Set([
  'ledger-deepseek',
  'ledger-spark',
  'ledger-other-family',
  'catalog-missing-ds41',
  'served-model-match',
  'served-model-mismatch',
  'no-quota',
  'session-expired',
  'account-disabled',
  'no-ledger-records',
]))
export const SETTLED_VERDICTS = Object.freeze(new Set([
  'clean',
  'routed',
  'exhausted',
  'expired',
]))

const CATALOG_TIMEOUT_MS = 15_000
const LEDGER_TIMEOUT_MS = 30_000
const LEDGER_PAGE_SIZE = 10
const DEFAULT_LEDGER_READS = 3
const DEFAULT_LEDGER_INTERVAL_MS = 1000
const MAX_LEDGER_CONCURRENCY = 2
const MAX_ACCOUNTS = 64

const SESSION_EXPIRED_MARKERS = ['缺少 token', '登录已失效', 'token 无效']
const ACCOUNT_DISABLED_MARKERS = ['停用', '禁用', '封禁', '已关闭']
const KNOWN_FAMILIES = ['deepseek', 'spark', 'glm', 'qwen', 'mimo', 'kimi', 'hy', 'step', 'sensenova']
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null

let ledgerInFlight = 0
const ledgerWaiting = []

async function withLedgerSlot(task, signal) {
  signal?.throwIfAborted?.()
  while (ledgerInFlight >= MAX_LEDGER_CONCURRENCY) {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const onAbort = () => {
        const index = ledgerWaiting.indexOf(wakeup)
        if (index !== -1) ledgerWaiting.splice(index, 1)
        reject(signal.reason)
      }
      const wakeup = () => {
        signal?.removeEventListener?.('abort', onAbort)
        resolve()
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      ledgerWaiting.push(wakeup)
    })
  }
  ledgerInFlight += 1
  try {
    return await task()
  } finally {
    ledgerInFlight -= 1
    const next = ledgerWaiting.shift()
    if (next) next()
  }
}

function requestSignal(timeoutMs, outerSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!outerSignal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outerSignal, timeout])
  return outerSignal
}

async function waitDelay(ms, sleepImpl, signal) {
  if (!(ms > 0)) return
  signal?.throwIfAborted?.()
  if (typeof sleepImpl === 'function') {
    await sleepImpl(ms)
    signal?.throwIfAborted?.()
    return
  }
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function modelTail(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  return (raw.split('/').at(-1) ?? '').trim()
}

export function modelFamilyOf(model) {
  const tail = modelTail(model).toLowerCase()
  if (!tail) return ''
  return KNOWN_FAMILIES.find(family => new RegExp(`^${family}(?=[-_\\.\\s\\d]|$)`, 'i').test(tail)) ?? ''
}

export function classifyLoomyServedModel(requestedModel, servedModel, now = Date.now) {
  const rawServed = typeof servedModel === 'string' ? servedModel.trim() : ''
  if (!/^(?:[a-z0-9_.-]+\/){0,2}[a-z0-9_. -]{1,96}$/i.test(rawServed)) return null
  const requestedFamily = modelFamilyOf(requestedModel)
  const servedFamily = modelFamilyOf(rawServed)
  if (!requestedFamily || !servedFamily) return null
  const cleanServed = modelTail(rawServed).slice(0, 120)
  const checkedAt = finite(now()) ?? Date.now()
  if (servedFamily !== requestedFamily) {
    return { verdict: 'routed', reason: 'served-model-mismatch', servedModel: cleanServed, checkedAt }
  }
  if (requestedFamily === 'deepseek') {
    return { verdict: 'clean', reason: 'served-model-match', servedModel: cleanServed, checkedAt }
  }
  return null
}

function classifyLedgerModel(modelName) {
  const clean = text(modelName, 120)
  if (!clean) return null
  const lower = clean.toLowerCase()
  if (lower.startsWith('spark')) return { verdict: 'routed', reason: 'ledger-spark', servedModel: clean }
  if (lower.startsWith('deepseek')) return { verdict: 'clean', reason: 'ledger-deepseek', servedModel: clean }
  return { verdict: 'routed', reason: 'ledger-other-family', servedModel: clean }
}

function expiredReason(code, desc) {
  const strCode = String(code ?? '')
  const strDesc = String(desc ?? '')
  if (strCode === '100003' && ACCOUNT_DISABLED_MARKERS.some(marker => strDesc.includes(marker))) {
    return { verdict: 'expired', reason: 'account-disabled', servedModel: '（账号已停用）' }
  }
  if (strCode === '100002' || strCode === '100003' || SESSION_EXPIRED_MARKERS.some(marker => strDesc.includes(marker))) {
    return { verdict: 'expired', reason: 'session-expired', servedModel: '（登录已失效）' }
  }
  return null
}

function readBalanceFromPayload(body) {
  const rows = [body, body?.data, body?.data?.data].filter(row => row && typeof row === 'object' && !Array.isArray(row))
  for (const row of rows) {
    if (row.availableBalance !== undefined && row.availableBalance !== null) {
      const available = Number(row.availableBalance)
      if (Number.isFinite(available)) return { known: true, available }
    }
    if (row.balance !== undefined && row.balance !== null && row.dailyBalance !== undefined && row.dailyBalance !== null) {
      const balance = Number(row.balance)
      const daily = Number(row.dailyBalance)
      if (Number.isFinite(balance) && Number.isFinite(daily)) return { known: true, available: balance + daily }
    }
  }
  return { known: false, available: 0 }
}

function readLedgerList(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.list)) return body.list
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.data?.list)) return body.data.list
  if (Array.isArray(body?.data?.data?.list)) return body.data.data.list
  return []
}

async function readCatalog({ root, session, fetchImpl, signal }) {
  let response
  let raw = ''
  try {
    response = await fetchImpl(`${root}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', token: session },
      signal: requestSignal(CATALOG_TIMEOUT_MS, signal),
    })
    raw = await response.text()
  } catch (error) {
    if (signal?.aborted) throw error
    return { status: 'unavailable', ids: [] }
  }
  if (response.status === 401 || response.status === 403) {
    return { status: 'expired', reason: 'session-expired', servedModel: '（登录已失效）', ids: [] }
  }
  if (response.status === 429 || !response.ok) {
    return { status: 'unavailable', ids: [] }
  }
  if (SESSION_EXPIRED_MARKERS.some(marker => raw.includes(marker))) {
    return { status: 'expired', reason: 'session-expired', servedModel: '（登录已失效）', ids: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'unavailable', ids: [] }
  }
  const code = String(parsed?.code ?? '')
  const expired = expiredReason(code, parsed?.desc ?? parsed?.message)
  if (expired) {
    return { status: 'expired', reason: expired.reason, servedModel: expired.servedModel, ids: [] }
  }
  if (code && code !== '000000') {
    return { status: 'unavailable', ids: [] }
  }
  const entries = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed?.models)
      ? parsed.models
      : null
  if (!entries) return { status: 'unavailable', ids: [] }
  const ids = entries
    .map(entry => String(typeof entry === 'string' ? entry : (entry?.id ?? '')).trim())
    .filter(Boolean)
  return { status: 'ok', ids }
}

async function readLedgerOnce({ root, session, fetchImpl, signal }) {
  const response = await withLedgerSlot(async () => fetchImpl(`${root}/points/records?pageNo=1&pageSize=${LEDGER_PAGE_SIZE}`, {
    method: 'GET',
    headers: { Accept: 'application/json', token: session },
    signal: requestSignal(LEDGER_TIMEOUT_MS, signal),
  }), signal)
  const raw = await response.text()
  if (response.status === 401 || response.status === 403) {
    return { kind: 'expired', reason: 'session-expired', servedModel: '（登录已失效）' }
  }
  if (!response.ok) return { kind: 'unavailable' }
  if (SESSION_EXPIRED_MARKERS.some(marker => raw.includes(marker))) {
    return { kind: 'expired', reason: 'session-expired', servedModel: '（登录已失效）' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unavailable' }
  }
  const code = String(parsed?.code ?? '')
  const expired = expiredReason(code, parsed?.desc ?? parsed?.message)
  if (expired) {
    return { kind: 'expired', reason: expired.reason, servedModel: expired.servedModel }
  }
  if (code && code !== '000000') return { kind: 'unavailable' }
  const data = parsed?.data ?? parsed
  return {
    kind: 'ok',
    balance: readBalanceFromPayload(parsed),
    list: readLedgerList(data),
  }
}

export async function probeLoomyRoute(session, options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const checkedAt = finite(now()) ?? Date.now()
  if (!session || typeof session !== 'string' || !session.trim()) {
    return { verdict: 'expired', reason: 'session-expired', servedModel: '（登录已失效）', checkedAt }
  }
  const root = String(options.apiBase ?? LOOMY_API_BASE).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch
  const signal = options.signal
  const reads = Math.max(1, Math.min(5, Math.floor(Number(options.ledgerReads ?? DEFAULT_LEDGER_READS) || DEFAULT_LEDGER_READS)))
  const intervalMs = Math.max(0, Number(options.ledgerIntervalMs ?? DEFAULT_LEDGER_INTERVAL_MS) || 0)

  const catalog = await readCatalog({ root, session, fetchImpl, signal })
  if (catalog.status === 'expired') {
    return { verdict: 'expired', reason: catalog.reason, servedModel: catalog.servedModel, checkedAt }
  }
  if (catalog.status === 'ok') {
    const hasDs41 = catalog.ids.some(id => id.toLowerCase() === LOOMY_PROBE_MODEL.toLowerCase())
    if (!hasDs41) {
      return {
        verdict: 'routed',
        reason: 'catalog-missing-ds41',
        servedModel: catalog.ids.slice(0, 6).map(id => text(id, 40)).filter(Boolean).join(', ') || '（目录无对话模型）',
        checkedAt,
      }
    }
  }

  let sawReply = false
  let newest = null
  let balanceKnown = false
  let balanceAvailable = 0

  for (let i = 0; i < reads; i += 1) {
    if (i > 0) await waitDelay(intervalMs, options.sleep, signal)
    let page
    try {
      page = await readLedgerOnce({ root, session, fetchImpl, signal })
    } catch (error) {
      if (signal?.aborted) throw error
      continue
    }
    if (page.kind === 'expired') {
      return { verdict: 'expired', reason: page.reason, servedModel: page.servedModel, checkedAt }
    }
    if (page.kind !== 'ok') continue
    sawReply = true
    if (page.balance.known) {
      balanceKnown = true
      balanceAvailable = page.balance.available
      if (balanceAvailable <= 0) {
        return { verdict: 'exhausted', reason: 'no-quota', servedModel: '（积分不足）', checkedAt }
      }
    }
    for (const item of page.list) {
      if (!item || typeof item !== 'object') continue
      const modelName = text(item.modelName, 120)
      if (!modelName) continue
      const at = Number(item.createdAt)
      const createdAt = Number.isFinite(at) ? at : 0
      if (!newest || createdAt > newest.createdAt) {
        newest = { modelName, createdAt }
      }
    }
  }

  if (balanceKnown && balanceAvailable <= 0) {
    return { verdict: 'exhausted', reason: 'no-quota', servedModel: '（积分不足）', checkedAt }
  }
  if (newest?.modelName) {
    const classified = classifyLedgerModel(newest.modelName)
    if (classified) {
      return {
        verdict: classified.verdict,
        reason: classified.reason,
        servedModel: classified.servedModel,
        checkedAt,
      }
    }
  }
  if (!sawReply) {
    return { verdict: 'error', reason: 'http-error', servedModel: '', checkedAt }
  }
  return { verdict: 'unknown', reason: 'no-ledger-records', servedModel: '（尚无对话扣费记录）', checkedAt }
}

export function publicLoomyRouteEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const verdict = LOOMY_ROUTE_VERDICTS.has(entry.verdict) ? entry.verdict : null
  if (!verdict) return null
  const reason = LOOMY_ROUTE_REASONS.has(entry.reason) ? entry.reason : ''
  const servedModel = text(entry.servedModel, 120)
  const checkedAt = finite(entry.checkedAt)
  return {
    verdict,
    ...(reason ? { reason } : {}),
    ...(servedModel ? { servedModel } : {}),
    ...(checkedAt !== null ? { checkedAt } : {}),
  }
}

function cleanRouteEntryWithUser(entry) {
  const pub = publicLoomyRouteEntry(entry)
  if (!pub) return null
  const userId = text(entry?.userId, 64)
  return { ...pub, ...(userId ? { userId } : {}) }
}

export function summarizeLoomyRoutes(accountsMap = {}) {
  const out = { total: 0, clean: 0, routed: 0, exhausted: 0, expired: 0, unknown: 0 }
  if (!accountsMap || typeof accountsMap !== 'object' || Array.isArray(accountsMap)) return out
  for (const [id, entry] of Object.entries(accountsMap)) {
    if (typeof id !== 'string' || !id || UNSAFE_KEYS.has(id)) continue
    const pub = publicLoomyRouteEntry(entry)
    if (!pub) continue
    out.total += 1
    if (pub.verdict === 'clean') out.clean += 1
    else if (pub.verdict === 'routed') out.routed += 1
    else if (pub.verdict === 'exhausted') out.exhausted += 1
    else if (pub.verdict === 'expired') out.expired += 1
    else out.unknown += 1
  }
  return out
}

export function publicLoomyRouteStatus(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rawAccounts = source.accounts && typeof source.accounts === 'object' && !Array.isArray(source.accounts) ? source.accounts : {}
  const accounts = {}
  for (const [id, entry] of Object.entries(rawAccounts).slice(0, MAX_ACCOUNTS)) {
    if (typeof id !== 'string' || !id || id.length > 128 || UNSAFE_KEYS.has(id)) continue
    const clean = publicLoomyRouteEntry(entry)
    if (clean) accounts[id] = clean
  }
  const summaryBase = summarizeLoomyRoutes(accounts)
  const rawSummary = source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary) ? source.summary : null
  const summary = {
    ...summaryBase,
    ...(rawSummary && finite(rawSummary.tested) !== null ? { tested: rawSummary.tested } : {}),
    ...(rawSummary && finite(rawSummary.error) !== null ? { error: rawSummary.error } : {}),
  }
  return {
    skipRouted: source.skipRouted !== false,
    accounts,
    summary,
  }
}

function readStateDocument(file) {
  const base = { version: 1, skipRouted: true, accounts: {}, byUserId: {} }
  if (!file) return base
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    const accounts = {}
    if (parsed.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)) {
      for (const [id, entry] of Object.entries(parsed.accounts)) {
        if (typeof id !== 'string' || !id || id.length > 128 || UNSAFE_KEYS.has(id)) continue
        const clean = cleanRouteEntryWithUser(entry)
        if (clean) accounts[id] = clean
      }
    }
    const byUserId = {}
    if (parsed.byUserId && typeof parsed.byUserId === 'object' && !Array.isArray(parsed.byUserId)) {
      for (const [uid, entry] of Object.entries(parsed.byUserId)) {
        if (typeof uid !== 'string' || !uid || uid.length > 64 || UNSAFE_KEYS.has(uid)) continue
        const clean = cleanRouteEntryWithUser(entry)
        if (clean) byUserId[uid] = clean
      }
    }
    return {
      version: 1,
      skipRouted: parsed.skipRouted !== false,
      accounts,
      byUserId,
    }
  } catch {
    return base
  }
}

function readMagpieState(magpieFile) {
  if (!magpieFile) return {}
  try {
    const parsed = JSON.parse(readFileSync(magpieFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [uid, entry] of Object.entries(parsed)) {
      if (typeof uid !== 'string' || !uid || uid.length > 64 || UNSAFE_KEYS.has(uid)) continue
      const clean = publicLoomyRouteEntry(entry)
      if (clean) out[uid] = { ...clean, userId: uid }
    }
    return out
  } catch {
    return {}
  }
}

export function createLoomyRouteService(options = {}) {
  const file = options.file || ''
  const magpieFile = options.magpieFile || ''
  const now = typeof options.now === 'function' ? options.now : Date.now
  const state = readStateDocument(file)
  const magpieAdopted = readMagpieState(magpieFile)
  for (const [uid, entry] of Object.entries(magpieAdopted)) {
    if (!state.byUserId[uid]) state.byUserId[uid] = entry
  }
  const userIdsByAccount = new Map()
  for (const [accountId, entry] of Object.entries(state.accounts)) {
    if (entry.userId) userIdsByAccount.set(accountId, entry.userId)
  }

  let writeQueue = Promise.resolve()
  const persist = () => {
    if (!file) return Promise.resolve()
    const snapshot = JSON.stringify({
      version: 1,
      skipRouted: state.skipRouted !== false,
      accounts: state.accounts,
      byUserId: state.byUserId,
    })
    const run = writeQueue.then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        await writeFile(temporary, snapshot, { mode: 0o600 })
        await rename(temporary, file)
      } finally {
        await unlink(temporary).catch(() => {})
      }
    })
    writeQueue = run.catch(() => {})
    return run
  }

  const getAccountRoute = (accountId, userId) => {
    const id = text(accountId, 128)
    const uid = text(userId, 64) || (id ? userIdsByAccount.get(id) : '')
    const direct = id && !UNSAFE_KEYS.has(id) ? state.accounts[id] : undefined
    if (direct) return publicLoomyRouteEntry(direct)
    if (uid && !UNSAFE_KEYS.has(uid) && state.byUserId[uid]) {
      return publicLoomyRouteEntry(state.byUserId[uid])
    }
    return null
  }

  const bindUserId = (accountId, userId) => {
    const id = text(accountId, 128)
    const uid = text(userId, 64)
    if (!id || UNSAFE_KEYS.has(id) || !uid || UNSAFE_KEYS.has(uid)) return null
    userIdsByAccount.set(id, uid)
    if (!state.accounts[id] && state.byUserId[uid]) {
      state.accounts[id] = { ...state.byUserId[uid], userId: uid }
    }
    return getAccountRoute(id, uid)
  }

  const storeResult = (accountId, result, { userId, allowUnknownOverwrite = false } = {}) => {
    const id = text(accountId, 128)
    const uid = text(userId, 64) || (id ? userIdsByAccount.get(id) : '')
    if (!result || result.verdict === 'error') return false
    const clean = publicLoomyRouteEntry(result)
    if (!clean) return false
    const prior = (id ? state.accounts[id] : null) ?? (uid ? state.byUserId[uid] : null)
    if (clean.verdict === 'unknown' && !allowUnknownOverwrite && prior && SETTLED_VERDICTS.has(prior.verdict)) {
      return false
    }
    const stored = { ...clean, ...(uid ? { userId: uid } : {}) }
    if (id && !UNSAFE_KEYS.has(id)) {
      state.accounts[id] = stored
      if (uid) userIdsByAccount.set(id, uid)
    }
    if (uid && !UNSAFE_KEYS.has(uid)) {
      state.byUserId[uid] = stored
    }
    return true
  }

  const status = () => publicLoomyRouteStatus({
    skipRouted: state.skipRouted !== false,
    accounts: state.accounts,
  })

  const notifyChange = () => {
    try {
      return Promise.resolve(options.onChange?.(status())).catch(() => {})
    } catch {
      return Promise.resolve()
    }
  }

  async function resolveAccountsList(signal) {
    if (typeof options.listAccounts !== 'function') return []
    const rows = await options.listAccounts(signal)
    const list = Array.isArray(rows) ? rows : []
    for (const row of list) {
      if (row?.id && row?.userId) bindUserId(row.id, row.userId)
    }
    return list
  }

  const observeServedModel = (accountId, requestedModel, servedModel, userId) => {
    const classified = classifyLoomyServedModel(requestedModel, servedModel, now)
    if (!classified) return false
    const uid = text(userId, 64) || (accountId ? userIdsByAccount.get(accountId) : '')
    const prior = getAccountRoute(accountId, uid)
    // 同为已定论状态且判定与实际模型未变化时避免频繁写盘。
    if (prior && prior.verdict === classified.verdict && prior.reason === classified.reason && prior.servedModel === classified.servedModel) {
      return false
    }
    const changed = storeResult(accountId, classified, { userId: uid })
    if (changed) {
      void persist().catch(() => {})
      void notifyChange()
    }
    return changed
  }

  const removeAccount = async (accountId) => {
    const id = text(accountId, 128)
    if (!id || UNSAFE_KEYS.has(id)) return false
    let changed = false
    if (Object.hasOwn(state.accounts, id)) {
      delete state.accounts[id]
      changed = true
    }
    userIdsByAccount.delete(id)
    if (changed) {
      await persist()
      await notifyChange()
    }
    return changed
  }

  async function call(method, payload = {}, signal) {
    if (!payload || typeof payload !== 'object' || payload.provider !== 'loomy') {
      throw new Error('不支持此渠道')
    }
    if (method === 'loomy.routeStatus') {
      return status()
    }
    if (method === 'loomy.setRouteConfig') {
      if (typeof payload.skipRouted !== 'boolean') throw new Error('路由配置无效')
      state.skipRouted = payload.skipRouted
      await persist()
      return status()
    }
    if (method === 'loomy.clearRoute') {
      if (payload.accountId !== undefined) {
        if (typeof payload.accountId !== 'string' || !payload.accountId || UNSAFE_KEYS.has(payload.accountId)) {
          throw new Error('账号无效')
        }
        delete state.accounts[payload.accountId]
        const uid = userIdsByAccount.get(payload.accountId)
        if (uid) delete state.byUserId[uid]
      } else {
        state.accounts = {}
        state.byUserId = {}
      }
      await persist()
      return status()
    }
    if (method === 'loomy.checkRoute') {
      const accounts = await resolveAccountsList(signal)
      let targets = accounts
      if (payload.accountId !== undefined) {
        if (typeof payload.accountId !== 'string' || !payload.accountId) throw new Error('账号无效')
        const found = accounts.find(account => account.id === payload.accountId)
        if (!found) throw new Error('账号已变化，请刷新后重试')
        targets = [found]
      } else if (Array.isArray(payload.accountIds)) {
        const want = new Set(payload.accountIds.filter(id => typeof id === 'string'))
        targets = accounts.filter(account => want.has(account.id))
      } else if (payload.mode === 'unhealthy') {
        targets = accounts.filter(account => {
          const entry = getAccountRoute(account.id, account.userId)
          return entry && entry.verdict !== 'clean'
        })
      } else if (payload.mode === 'unchecked') {
        targets = accounts.filter(account => {
          const entry = getAccountRoute(account.id, account.userId)
          return !entry || entry.verdict === 'unknown'
        })
      }
      let tested = 0
      let errors = 0
      let persistedAny = false
      for (const account of targets) {
        signal?.throwIfAborted?.()
        tested += 1
        let outcome
        if (!account.session || typeof account.session !== 'string') {
          outcome = { verdict: 'expired', reason: 'session-expired', servedModel: '（凭据未配置）', checkedAt: finite(now()) ?? Date.now() }
        } else {
          outcome = await probeLoomyRoute(account.session, {
            apiBase: options.apiBase,
            fetchImpl: options.fetchImpl ?? options.fetch,
            signal,
            ledgerReads: options.ledgerReads,
            ledgerIntervalMs: options.ledgerIntervalMs,
            sleep: options.sleep,
            now,
          })
        }
        if (outcome.verdict === 'error') {
          errors += 1
          continue
        }
        if (storeResult(account.id, outcome, { userId: account.userId })) {
          persistedAny = true
        }
      }
      if (persistedAny) await persist()
      const current = status()
      return {
        ...current,
        summary: {
          ...current.summary,
          tested,
          error: errors,
        },
      }
    }
    throw new Error('不支持此操作')
  }

  return {
    status,
    call,
    getAccountRoute,
    bindUserId,
    flushPersist: () => persist(),
    hasUserIdRoutes: () => Object.keys(state.byUserId).length > 0,
    isSkipRoutedEnabled: () => state.skipRouted !== false,
    isAccountExcluded: (accountId, userId) => {
      if (state.skipRouted === false) return false
      const entry = getAccountRoute(accountId, userId)
      return entry?.verdict === 'routed'
    },
    observeServedModel,
    removeAccount,
  }
}
