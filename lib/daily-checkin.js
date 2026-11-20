import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const PREFLIGHT_BACKOFF = 15 * MINUTE
const outcomes = new Set(['claimed', 'already-claimed', 'inactive', 'ineligible', 'failed', 'pending'])
const dayOf = (now, resetHour = 0) => new Date(now + (8 - resetHour) * HOUR).toISOString().slice(0, 10)
const hash = id => createHash('sha256').update(id).digest('hex')
const pending = { kind: 'pending' }

function cleanOutcome(value) {
  const kind = outcomes.has(value?.kind) ? value.kind : 'failed'
  return {
    kind,
    ...(Number.isFinite(value?.credit) ? { credit: value.credit } : {}),
    ...(Number.isFinite(value?.streak) ? { streak: value.streak } : {}),
    ...(value?.actionRequired === true ? { actionRequired: true } : {}),
  }
}

/**
 * Each provider supplies its roster and its existing single-account claim.
 * The exclusive file records intent before any upstream write. A missing or
 * incomplete response leaves that cycle reserved, including after restart.
 */
export function createDailyCheckin({ dir, adapters, enabled = true, isEnabled, now = Date.now, onChange, logger }) {
  const lifetime = new AbortController()
  let timer = null
  let running = null
  const localJobs = new Map()
  const providerEnabled = provider => typeof isEnabled === 'function' ? isEnabled(provider) === true : enabled === true
  const anyEnabled = () => typeof isEnabled === 'function'
    ? (adapters.size ? [...adapters.keys()].some(providerEnabled) : isEnabled() === true)
    : enabled === true

  const cycleDir = (provider, date) => join(dir, provider, date)
  async function readRecord(path) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      return typeof value?.id === 'string' && outcomes.has(value.outcome?.kind)
        ? { id: value.id, outcome: cleanOutcome(value.outcome), retryAt: Number.isFinite(value.retryAt) ? value.retryAt : null } : null
    } catch { return null }
  }

  async function reserve(path, id) {
    let handle
    try { handle = await open(path, 'wx', 0o600) }
    catch (error) {
      if (error?.code === 'EEXIST') return false
      throw error
    }
    try {
      await handle.writeFile(JSON.stringify({ id, outcome: pending }))
      await handle.sync()
    } finally { await handle.close() }
    return true
  }

  async function finish(path, record) {
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flush: true })
      await rename(temporary, path)
    } finally { await unlink(temporary).catch(() => {}) }
  }

  async function once(provider, account, adapter, signal, automatic) {
    signal.throwIfAborted()
    const date = dayOf(now(), adapter.resetHour)
    const folder = cycleDir(provider, date)
    const path = join(folder, hash(account.id))
    const deferred = path + '.retry'
    const existing = localJobs.get(path)
    if (existing) {
      const result = await existing
      return { ...result, repeated: true }
    }
    const job = (async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 })
      if (automatic) {
        const earlier = await readRecord(deferred)
        if (earlier && earlier.retryAt > now()) return { outcome: earlier.outcome, repeated: true }
      }
      if (!await reserve(path, account.id)) {
        return { outcome: (await readRecord(path))?.outcome ?? pending, repeated: true }
      }
      let value
      try {
        signal.throwIfAborted()
        value = await adapter.claim(account.id, signal)
      } catch {
        value = { kind: 'failed' }
      }
      const outcome = cleanOutcome(value)
      try {
        // Only a confirmed preflight failure can release the owner’s reservation.
        if (value?.unsubmitted === true && ['inactive', 'ineligible', 'failed'].includes(outcome.kind)) {
          await finish(deferred, { id: account.id, outcome, retryAt: now() + PREFLIGHT_BACKOFF })
          await unlink(path)
        } else {
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

  async function status() {
    const providers = await Promise.all([...adapters].map(async ([id, adapter]) => {
      const date = dayOf(now(), adapter.resetHour)
      const folder = cycleDir(id, date)
      let files
      try { files = await readdir(folder) }
      catch (error) { if (error?.code !== 'ENOENT') throw error; files = [] }
      const keys = new Set(files.filter(name => /^[0-9a-f]{64}(?:\.retry)?$/.test(name)).map(name => name.slice(0, 64)))
      const rows = await Promise.all([...keys].map(async name => {
        const path = join(folder, name)
        return await readRecord(path) ?? await readRecord(path + '.retry')
      }))
      return [id, { date, resetHour: adapter.resetHour ?? 0, enabled: providerEnabled(id),
        accounts: rows.filter(Boolean).map(row => ({ accountId: row.id, kind: row.outcome.kind, retryable: row.retryAt !== null })) }]
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
        if (dayOf(now(), adapter.resetHour) !== dayOf(now())) continue
        try { await claim(provider, undefined, lifetime.signal, true) }
        catch { if (!lifetime.signal.aborted) logger?.warn?.('[unified-router] 自动签到暂未完成') }
      }
    })().finally(() => { running = null })
    return running
  }

  return {
    claim, status, tick,
    canClaim: provider => adapters.has(provider),
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
