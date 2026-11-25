// 每日签到调度器（与 auto-tasks.js 同构，账本原语见 automation-journal.js）。
// 铁律：主记录一旦存在（尤其 pending = 已提交但结果不明），绝不因陈旧、重启或手动
// 触发而重放。唯一释放途径是 preflight/verify 明确"未提交"（unsubmitted/retryable），
// 撤预留转为 .retry 退避票据，到期后仅自动路径重新提交。
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ACCOUNT_SCOPE, adoptAccountRecord, applyVerdict, dayOf, effectiveRecord,
  hashId, readLedgerRows, readRecord, releaseDeferred, reserve, scopeOf, finish,
} from './automation-journal.js'

const MINUTE = 60_000
// preflight 明确"未提交"后的自动重查退避。
const PREFLIGHT_BACKOFF = 15 * MINUTE
// pending 主记录（已提交、等待上游结算确认）的自动只读核实间隔：只查不重放。
const PENDING_VERIFY_INTERVAL = 5 * MINUTE
const OUTCOMES = new Set(['claimed', 'already-claimed', 'inactive', 'ineligible', 'failed', 'pending'])
// 上游确认已签（核实终态，可修复本地账本）。
const DONE_KINDS = new Set(['claimed', 'already-claimed'])
// 上游确认未达成（核实终态；仅当适配器显式声明"未提交"才可撤预留转退避）。
const OPEN_KINDS = new Set(['pending', 'inactive', 'ineligible'])
const pending = { kind: 'pending' }
const confirmedDone = (record, doneKinds) => !!record && doneKinds.has(record.outcome.kind)

function cleanOutcome(value) {
  const kind = OUTCOMES.has(value?.kind) ? value.kind : 'failed'
  return {
    kind,
    ...(Number.isFinite(value?.credit) ? { credit: value.credit } : {}),
    ...(Number.isFinite(value?.streak) ? { streak: value.streak } : {}),
    ...(value?.actionRequired === true ? { actionRequired: true } : {}),
  }
}
// 账本读取用严格清洗：无法识别的 kind 视为无记录，绝不伪造 failed。
const sanitizeOutcome = value => OUTCOMES.has(value?.kind) ? cleanOutcome(value) : null

// verify 只读结论分类：done=上游确认已签；open=上游确认未达成。
// proof=适配器显式声明"该请求未提交"（unsubmitted/retryable）——唯一允许撤预留的证据；
// 普通 pending/inactive/failed 绝不构成证明。null=查询失败/证据不足 → 不写账本。
function verifyState(value) {
  const outcome = sanitizeOutcome(value)
  if (!outcome) return null
  if (DONE_KINDS.has(outcome.kind)) return { state: 'done', outcome }
  const proof = value?.unsubmitted === true || value?.retryable === true
  if (OPEN_KINDS.has(outcome.kind) || proof) return { state: 'open', outcome, proof }
  return null
}

/**
 * Each provider supplies its roster and its existing single-account claim.
 * The exclusive file records intent before any upstream write. A missing or
 * incomplete response leaves that cycle reserved, including after restart —
 * unknown submissions are never replayed; only an explicit "unsubmitted"
 * preflight/verdict may release the reservation into the backoff ticket.
 */
export function createDailyCheckin({ dir, adapters, enabled = true, isEnabled, now = Date.now, onChange, logger }) {
  const lifetime = new AbortController()
  let timer = null
  let running = null
  const localJobs = new Map()
  const pendingVerifiedAt = new Map()
  const providerEnabled = provider => typeof isEnabled === 'function' ? isEnabled(provider) === true : enabled === true
  const anyEnabled = () => typeof isEnabled === 'function'
    ? (adapters.size ? [...adapters.keys()].some(providerEnabled) : isEnabled() === true)
    : enabled === true
  const read = path => readRecord(path, sanitizeOutcome)
  const effective = (path, deferred) => effectiveRecord(path, deferred, sanitizeOutcome)

  const scopeDir = (provider, adapter) => {
    const date = dayOf(now(), adapter.resetHour)
    const scope = scopeOf(adapter, date)
    return { date, scope, root: join(dir, provider), folder: join(dir, provider, scope) }
  }

  async function once(provider, account, adapter, signal, automatic) {
    signal.throwIfAborted()
    const { scope, root, folder } = scopeDir(provider, adapter)
    const path = join(folder, hashId(account.id))
    const deferred = path + '.retry'
    const existing = localJobs.get(path)
    if (existing) {
      const result = await existing
      return { ...result, repeated: true }
    }
    const job = (async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 })
      // 一次性事项最小迁移：账号级账本为空时采纳旧版按日账本（含 pending 与退避票据）。
      if (scope === ACCOUNT_SCOPE && !await read(path) && !await read(deferred)) {
        const adopted = await adoptAccountRecord(root, folder, hashId(account.id), sanitizeOutcome)
        if (adopted?.kind === 'main') {
          const confirmed = await read(path + '.confirmed')
          return { outcome: confirmed?.outcome ?? adopted.record.outcome, repeated: true }
        }
      }
      // reserve 前检查核实票据：上游已确认完成 → 直接应答，绝不提交（优先于退避门）。
      const confirmedBefore = await read(path + '.confirmed')
      if (confirmedDone(confirmedBefore, DONE_KINDS)) return { outcome: confirmedBefore.outcome, repeated: true }
      if (automatic) {
        const earlier = await read(deferred)
        if (earlier && earlier.retryAt > now()) return { outcome: earlier.outcome, repeated: true }
      }
      // 已有任何记录（pending 不明、终态、含跨日采纳）一律不再提交。
      if (!await reserve(path, account.id, pending)) {
        // reserve 后复查核实票据：它与并发查询可能刚落账。
        const confirmedAfter = await read(path + '.confirmed')
        if (confirmedDone(confirmedAfter, DONE_KINDS)) return { outcome: confirmedAfter.outcome, repeated: true }
        return { outcome: (await effective(path, deferred))?.outcome ?? pending, repeated: true }
      }
      const confirmed = await read(path + '.confirmed')
      if (confirmedDone(confirmed, DONE_KINDS)) return { outcome: confirmed.outcome, repeated: true }
      let value
      try {
        signal.throwIfAborted()
        value = await adapter.claim(account.id, signal)
      } catch {
        value = { kind: 'failed' }
      }
      const outcome = cleanOutcome(value)
      try {
        // 只有适配器明确"未提交成功"才允许撤预留转入退避重试；其余一律定主记录。
        if ((value?.unsubmitted === true || value?.retryable === true) && !DONE_KINDS.has(outcome.kind))
          await releaseDeferred(path, deferred, account.id, outcome, now() + PREFLIGHT_BACKOFF)
        else {
          await finish(path, { id: account.id, outcome })
          await unlink(deferred).catch(() => {})
        }
      }
      catch { logger?.warn?.('[unified-router] 签到结果写入失败') }
      await onChange?.(provider, outcome)
      return { outcome, repeated: false }
    })().finally(() => localJobs.delete(path))
    localJobs.set(path, job)
    return job
  }

  async function list(provider, signal = lifetime.signal) {
    const adapter = adapters.get(provider)
    if (!adapter) throw new Error('不支持每日签到')
    signal.throwIfAborted()
    return adapter.list(signal)
  }

  async function claim(provider, accountId, signal = lifetime.signal, automatic = false) {
    const adapter = adapters.get(provider)
    const accounts = await list(provider, signal)
    const targets = accountId === undefined ? accounts : accounts.filter(account => account.id === accountId)
    if (accountId !== undefined && targets.length === 0) throw new Error('账号已移除')
    const results = []
    // HTTP cancellation stops starting new accounts. An in-flight claim is
    // allowed to return and commit its result to the journal.
    for (const account of targets) {
      signal.throwIfAborted()
      const result = await once(provider, account, adapter, lifetime.signal, automatic)
      results.push({ accountId: account.id, nickname: account.name, ...result })
    }
    return results
  }

  // 只读核实：查询上游确认账本结果，绝不提交。适配器没有 verify 时只回账本现状。
  // 已确认签到仅增写核实票据。查询不撤预留，也不干预在途提交。
  async function query(provider, accountId, signal = lifetime.signal) {
    const adapter = adapters.get(provider)
    if (!adapter) throw new Error('不支持每日签到')
    signal.throwIfAborted()
    const accounts = await adapter.list(signal).catch(() => [])
    const { scope, root, folder } = scopeDir(provider, adapter)
    const targets = accountId === undefined
      ? accounts
      : accounts.filter(account => account.id === accountId)
    const list = accountId === undefined || targets.length ? targets : [{ id: accountId }]
    const results = []
    for (const account of list) {
      signal.throwIfAborted()
      const path = join(folder, hashId(account.id))
      const deferred = path + '.retry'
      let record = await effective(path, deferred)
      if (scope === ACCOUNT_SCOPE && !record) {
        const adopted = await adoptAccountRecord(root, folder, hashId(account.id), sanitizeOutcome)
        if (adopted) record = adopted.record
      }
      const row = { accountId: account.id, nickname: account.name ?? account.id }
      const confirmed = await read(path + '.confirmed')
      const secured = confirmedDone(confirmed, DONE_KINDS)
      const localDone = !!record && DONE_KINDS.has(record.outcome.kind)
      const serve = localDone ? record.outcome : secured ? confirmed.outcome : record?.outcome ?? pending
      // 在途提交绝不干预；无上游核实通道时只回账本现状。
      if (localJobs.has(path) || typeof adapter.verify !== 'function') {
        results.push({ ...row, outcome: serve, repeated: true, verified: false })
        continue
      }
      let verdict = null
      try {
        verdict = verifyState(await adapter.verify(account.id, signal))
      } catch (error) {
        if (signal.aborted) throw error
      }
      if (!verdict) {
        results.push({ ...row, outcome: serve, repeated: true, verified: false })
        continue
      }
      const { outcome, verified } = await applyVerdict({
        state: verdict.state, path, accountId: account.id,
        outcome: verdict.outcome, local: record,
        localIsDone: localDone, confirmed, confirmedIsDone: secured,
      })
      if (verified && verdict.state === 'done' && !localDone && !secured) {
        await onChange?.(provider, outcome)
      }
      results.push({ ...row, outcome, repeated: true, verified })
    }
    return results
  }

  async function status() {
    const providers = await Promise.all([...adapters].map(async ([id, adapter]) => {
      const { date, scope, root, folder } = scopeDir(id, adapter)
      const rows = await readLedgerRows(root, folder, scope, sanitizeOutcome)
      return [id, {
        date,
        resetHour: adapter.resetHour ?? 0,
        doneScope: adapter?.doneScope === ACCOUNT_SCOPE ? ACCOUNT_SCOPE : 'cycle',
        enabled: providerEnabled(id),
        accounts: rows.map(row => ({ accountId: row.id, kind: row.outcome.kind, retryable: row.retryAt !== null })),
      }]
    }))
    return { enabled: typeof isEnabled === 'function' ? isEnabled() === true : enabled === true, providers: Object.fromEntries(providers) }
  }

  function tick() {
    if (lifetime.signal.aborted || !anyEnabled()) return Promise.resolve()
    if (running) return running
    running = (async () => {
      for (const [provider, adapter] of adapters) {
        if (lifetime.signal.aborted) break
        if (!providerEnabled(provider)) continue
        // 只在本轮日界之后执行：Qoder 10:00 日界在 10:00 前属于上一轮，已在上一轮签过。
        if (dayOf(now(), adapter.resetHour) !== dayOf(now())) continue
        try {
          const rows = await claim(provider, undefined, lifetime.signal, true)
          // 已有 pending 主记录（已提交但结算未确认）且适配器有只读 verify：
          // 按间隔自动只读核实，上游结算后落 .confirmed 票据并刷新快照，绝不重复提交 claim。
          if (typeof adapter.verify === 'function') {
            for (const row of rows) {
              if (lifetime.signal.aborted) break
              if (row.outcome?.kind !== 'pending' || !row.repeated) continue
              const key = `${provider}:${row.accountId}`
              const last = pendingVerifiedAt.get(key) ?? 0
              if (now() - last < PENDING_VERIFY_INTERVAL) continue
              pendingVerifiedAt.set(key, now())
              try { await query(provider, row.accountId, lifetime.signal) } catch {}
            }
          }
        }
        catch { if (!lifetime.signal.aborted) logger?.warn?.('[unified-router] 自动签到暂未完成') }
      }
    })().finally(() => { running = null })
    return running
  }

  return {
    claim, status, tick, query,
    canClaim: provider => adapters.has(provider),
    canQuery: provider => typeof adapters.get(provider)?.verify === 'function',
    start(startupDelay = 65_000) {
      if ((typeof isEnabled !== 'function' && !enabled) || timer !== null || lifetime.signal.aborted) return
      timer = setTimeout(() => {
        void tick()
        timer = setInterval(() => { void tick() }, MINUTE)
        timer.unref?.()
      }, startupDelay)
      timer.unref?.()
    },
    dispose() {
      clearTimeout(timer)
      clearInterval(timer)
      lifetime.abort()
    },
  }
}
