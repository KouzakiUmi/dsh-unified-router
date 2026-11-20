// 统一自动领取奖励与自动执行完成任务调度器（与 daily-checkin.js 同构）。
// 两种模式物理分离：
// - claimRewards：无副作用领取（新手奖励、每日弹窗、已达标任务奖励）；
// - completeTasks：主动执行完成平台任务（需显式开启，默认关闭）。
// 均采用先写周期提交记录（wx 原子创建）再请求上游的防重策略，重启与并发不重复触发。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const RETRY_BACKOFF = 30 * MINUTE
const MODES = new Set(['claimRewards', 'completeTasks'])
const OUTCOMES = new Set(['claimed', 'completed', 'done', 'empty', 'unsupported', 'failed', 'pending'])
const dayOf = (now, resetHour = 0) => new Date(now + (8 - resetHour) * HOUR).toISOString().slice(0, 10)
const hash = value => createHash('sha256').update(value).digest('hex')
const pendingOutcome = { kind: 'pending' }

function cleanOutcome(value) {
  const kind = OUTCOMES.has(value?.kind) ? value.kind : 'failed'
  return {
    kind,
    ...(Number.isFinite(value?.claimed) ? { claimed: value.claimed } : {}),
    ...(Number.isFinite(value?.completed) ? { completed: value.completed } : {}),
    ...(Number.isFinite(value?.points) ? { points: value.points } : {}),
  }
}

export function createAutoTasks({ dir, adapters, isEnabled, now = Date.now, onChange, logger }) {
  const lifetime = new AbortController()
  let timer = null
  let running = null
  const localJobs = new Map()

  const cycleDir = (provider, mode, date) => join(dir, provider, mode, date)

  async function readRecord(path) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      return typeof value?.id === 'string' && OUTCOMES.has(value.outcome?.kind)
        ? { id: value.id, outcome: cleanOutcome(value.outcome), retryAt: Number.isFinite(value.retryAt) ? value.retryAt : null }
        : null
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
      await handle.writeFile(JSON.stringify({ id, outcome: pendingOutcome }))
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

  async function runOnce(provider, mode, account, adapter, signal, automatic) {
    signal.throwIfAborted()
    const fn = adapter?.[mode]
    if (typeof fn !== 'function') return { outcome: { kind: 'unsupported' }, repeated: false }
    const date = dayOf(now(), adapter.resetHour)
    const folder = cycleDir(provider, mode, date)
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
        const existingRecord = await readRecord(path)
        // 手动触发时，如果上次只是 failed/empty/done，允许再次尝试（只拦截 pending 或已成功 claimed/completed）。
        if (automatic || !existingRecord || ['pending', 'claimed', 'completed'].includes(existingRecord.outcome.kind)) {
          return { outcome: existingRecord?.outcome ?? pendingOutcome, repeated: true }
        }
      }
      let value
      try {
        signal.throwIfAborted()
        value = await fn(account.id, signal)
      } catch {
        value = { kind: 'failed' }
      }
      const outcome = cleanOutcome(value)
      try {
        if (value?.retryable === true && ['empty', 'failed'].includes(outcome.kind)) {
          await finish(deferred, { id: account.id, outcome, retryAt: now() + RETRY_BACKOFF })
          await unlink(path).catch(() => {})
        } else {
          await finish(path, { id: account.id, outcome })
          await unlink(deferred).catch(() => {})
        }
      } catch { logger?.warn?.('[unified-router] 自动任务结果写入失败') }
      await onChange?.(provider, mode, outcome)
      return { outcome, repeated: false }
    })().finally(() => localJobs.delete(path))
    localJobs.set(path, job)
    return job
  }

  async function run(provider, mode, accountId, signal = lifetime.signal, automatic = false) {
    if (!MODES.has(mode)) throw new Error('不支持此任务类型')
    const adapter = adapters.get(provider)
    if (!adapter || typeof adapter[mode] !== 'function') throw new Error('该渠道不支持此任务操作')
    signal.throwIfAborted()
    const accounts = await adapter.list(signal)
    const targets = accountId === undefined ? accounts : accounts.filter(account => account.id === accountId)
    if (accountId !== undefined && targets.length === 0) throw new Error('账号已移除')
    const results = []
    for (const account of targets) {
      signal.throwIfAborted()
      const result = await runOnce(provider, mode, account, adapter, lifetime.signal, automatic)
      results.push({ accountId: account.id, nickname: account.name, ...result })
    }
    return results
  }

  async function status() {
    const entries = await Promise.all([...adapters].map(async ([provider, adapter]) => {
      const date = dayOf(now(), adapter.resetHour)
      const capabilities = {
        claimRewards: typeof adapter.claimRewards === 'function',
        completeTasks: typeof adapter.completeTasks === 'function',
      }
      const readMode = async mode => {
        if (!capabilities[mode]) return []
        const folder = cycleDir(provider, mode, date)
        let files
        try { files = await readdir(folder) }
        catch (error) { if (error?.code !== 'ENOENT') throw error; files = [] }
        const keys = new Set(files.filter(name => /^[0-9a-f]{64}(?:\.retry)?$/.test(name)).map(name => name.slice(0, 64)))
        const rows = await Promise.all([...keys].map(async name => {
          const path = join(folder, name)
          return await readRecord(path) ?? await readRecord(path + '.retry')
        }))
        return rows.filter(Boolean).map(row => ({
          accountId: row.id,
          kind: row.outcome.kind,
          ...(Number.isFinite(row.outcome.claimed) ? { claimed: row.outcome.claimed } : {}),
          ...(Number.isFinite(row.outcome.completed) ? { completed: row.outcome.completed } : {}),
          ...(Number.isFinite(row.outcome.points) ? { points: row.outcome.points } : {}),
          retryable: row.retryAt !== null,
        }))
      }
      const [claimRewards, completeTasks] = await Promise.all([readMode('claimRewards'), readMode('completeTasks')])
      return [provider, { date, capabilities, claimRewards, completeTasks }]
    }))
    return { providers: Object.fromEntries(entries) }
  }

  function tick() {
    if (lifetime.signal.aborted) return Promise.resolve()
    if (running) return running
    running = (async () => {
      for (const [provider, adapter] of adapters) {
        if (lifetime.signal.aborted) break
        if (dayOf(now(), adapter.resetHour) !== dayOf(now())) continue
        for (const mode of MODES) {
          if (lifetime.signal.aborted) break
          if (typeof adapter[mode] !== 'function') continue
          if (typeof isEnabled === 'function' && !isEnabled(provider, mode)) continue
          try { await run(provider, mode, undefined, lifetime.signal, true) }
          catch { if (!lifetime.signal.aborted) logger?.warn?.('[unified-router] 自动任务暂未完成') }
        }
      }
    })().finally(() => { running = null })
    return running
  }

  return {
    run,
    status,
    tick,
    canRun: (provider, mode) => typeof adapters.get(provider)?.[mode] === 'function',
    capabilitiesOf: provider => ({
      claimRewards: typeof adapters.get(provider)?.claimRewards === 'function',
      completeTasks: typeof adapters.get(provider)?.completeTasks === 'function',
    }),
    start(startupDelay = 75_000) {
      if (timer !== null || lifetime.signal.aborted) return
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
