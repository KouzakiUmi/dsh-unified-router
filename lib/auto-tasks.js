// 统一自动领取奖励与自动执行完成任务调度器（与 daily-checkin.js 同构，
// 账本原语见 automation-journal.js）。
// 两种模式物理分离：
// - claimRewards：无副作用领取（新手奖励、每日弹窗、已达标任务奖励）；
// - completeTasks：主动执行完成平台任务（需显式开启，默认关闭）。
// 均采用先写周期提交记录（wx 原子创建）再请求上游的防重策略。
// 铁律：主记录一旦存在（尤其 pending = 已提交但结果不明），绝不因陈旧、重启或
// 手动触发而重放。唯一释放途径是 preflight/verify 明确"未提交"（unsubmitted/
// retryable），撤预留转为 .retry 退避票据，到期后仅自动路径重新提交。
// 手动 run 跳过退避门（用户显式触发即放行），但仍绝不重放已有主记录。
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ACCOUNT_SCOPE, adoptAccountRecord, applyVerdict, balanceGrowth, dayOf, effectiveRecord,
  hashId, readLedgerRows, readRecord, releaseDeferred, reserve, scopeOf, finish,
} from './automation-journal.js'

const MINUTE = 60_000
// preflight 明确"未提交"后的自动重试退避。
const RETRY_BACKOFF = 30 * MINUTE
// pending 主记录（已提交、等待上游结算确认）的自动只读核实间隔：只查不重放。
const PENDING_VERIFY_INTERVAL = 5 * MINUTE
const MODES = new Set(['claimRewards', 'completeTasks'])
const OUTCOMES = new Set(['claimed', 'completed', 'done', 'empty', 'unsupported', 'failed', 'pending'])
const DONE_KINDS = new Set(['claimed', 'completed', 'done'])
// 上游确认未达成（核实终态；仅当适配器显式声明"未提交"才可撤预留转退避）。
// 'failed' 不是 open：上游核实"失败"只是无结论，绝不据此撤预留。
const OPEN_KINDS = new Set(['pending', 'empty'])
const pendingOutcome = { kind: 'pending' }
const confirmedDone = (record, doneKinds) => !!record && doneKinds.has(record.outcome.kind)
const verifyName = mode => 'verify' + mode[0].toUpperCase() + mode.slice(1)

function cleanOutcome(value) {
  const kind = OUTCOMES.has(value?.kind) ? value.kind : 'failed'
  return {
    kind,
    ...(Number.isFinite(value?.claimed) ? { claimed: value.claimed } : {}),
    ...(Number.isFinite(value?.completed) ? { completed: value.completed } : {}),
    ...(Number.isFinite(value?.points) ? { points: value.points } : {}),
  }
}
// 账本读取用严格清洗：无法识别的 kind 视为无记录，绝不伪造 failed。
const sanitizeOutcome = value => OUTCOMES.has(value?.kind) ? cleanOutcome(value) : null

// 老 claimRewards 按日账本 → completeTasks 一次性账本的跨模式换算：
// claimed → completed，claimed 计数 → completed；done/empty 原样；pending/其他原样（绝不重放）。
const LEGACY_MAPS = {
  'completeTasks<=claimRewards': value => {
    if (!value || typeof value !== 'object') return value
    if (value.kind === 'claimed') {
      return {
        kind: 'completed',
        ...(Number.isFinite(value.claimed) ? { completed: value.claimed } : {}),
        ...(Number.isFinite(value.points) ? { points: value.points } : {}),
      }
    }
    if (Number.isFinite(value.claimed) && !Number.isFinite(value.completed)) {
      return { ...value, completed: value.claimed }
    }
    return value
  },
}

// verify 只读结论分类：done=上游确认已办妥；open=上游确认未达成。
// proof=适配器显式声明"该请求未提交"（unsubmitted/retryable）——唯一允许撤预留的证据。
// null=查询失败/证据不足 → 不写账本。
function verifyState(value) {
  const outcome = sanitizeOutcome(value)
  if (!outcome || outcome.kind === 'unsupported') return null
  if (DONE_KINDS.has(outcome.kind)) return { state: 'done', outcome }
  const proof = value?.unsubmitted === true || value?.retryable === true
  if (OPEN_KINDS.has(outcome.kind) || proof) return { state: 'open', outcome, proof }
  return null
}

export function createAutoTasks({ dir, adapters, isEnabled, now = Date.now, onChange, logger, readBalance }) {
  const lifetime = new AbortController()
  let timer = null
  let running = null
  const localJobs = new Map()
  const pendingVerifiedAt = new Map()
  const read = path => readRecord(path, sanitizeOutcome)
  const effective = (path, deferred) => effectiveRecord(path, deferred, sanitizeOutcome)
  // 额度读取（宿主注入，读已采集的快照）：失败/不可用一律返回 null，
  // 「额度增长即确认」只在拿到两侧有限数值时才成立。
  const currentBalance = async (provider, accountId, signal) => {
    if (typeof readBalance !== 'function') return null
    try { return await readBalance(provider, accountId, signal) }
    catch { return null }
  }

  const scopeDir = (provider, mode, adapter) => {
    const date = dayOf(now(), adapter.resetHour)
    const scope = scopeOf(adapter, date)
    return { date, scope, root: join(dir, provider, mode), folder: join(dir, provider, mode, scope) }
  }

  // adapter.adoptFrom 声明可跨模式采纳的旧版账本源（仅 account 作用域生效）：
  // 字符串 = 同层旧模式目录名；{name, map} 可自定义 outcome 换算。
  const legacySources = (provider, mode, adapter) => {
    if (scopeOf(adapter, dayOf(now(), adapter.resetHour)) !== ACCOUNT_SCOPE) return []
    const declared = Array.isArray(adapter.adoptFrom) ? adapter.adoptFrom : []
    return declared.flatMap(entry => {
      const name = typeof entry === 'string' ? entry : entry?.name
      if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\')) return []
      const map = typeof entry === 'object' && typeof entry.map === 'function'
        ? entry.map
        : LEGACY_MAPS[`${mode}<=${name}`]
      return [{
        root: join(dir, provider, name),
        sanitize: value => sanitizeOutcome(map ? map(value) : value),
      }]
    })
  }

  async function runOnce(provider, mode, account, adapter, signal, automatic) {
    signal.throwIfAborted()
    const fn = adapter?.[mode]
    if (typeof fn !== 'function') return { outcome: { kind: 'unsupported' }, repeated: false }
    const { scope, root, folder } = scopeDir(provider, mode, adapter)
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
        const adopted = await adoptAccountRecord(root, folder, hashId(account.id), sanitizeOutcome, legacySources(provider, mode, adapter))
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
      // 提交前额度基线：供后续「额度增长即确认」核实使用。读不到就留空，
      // 既不影响提交，也不会让核实侧产生无证据的结论。
      const baseline = await currentBalance(provider, account.id, signal)
      // 已有任何记录（pending 不明、终态、含跨日采纳）一律不再提交。
      if (!await reserve(path, account.id, pendingOutcome, Number.isFinite(baseline) ? { baseline } : undefined)) {
        // reserve 后复查核实票据：它与并发查询可能刚落账。
        const confirmedAfter = await read(path + '.confirmed')
        if (confirmedDone(confirmedAfter, DONE_KINDS)) return { outcome: confirmedAfter.outcome, repeated: true }
        return { outcome: (await effective(path, deferred))?.outcome ?? pendingOutcome, repeated: true }
      }
      const confirmed = await read(path + '.confirmed')
      if (confirmedDone(confirmed, DONE_KINDS)) return { outcome: confirmed.outcome, repeated: true }
      let value
      try {
        signal.throwIfAborted()
        value = await fn(account.id, signal)
      } catch {
        value = { kind: 'failed' }
      }
      const outcome = cleanOutcome(value)
      try {
        // 只有适配器明确"未提交成功"才允许撤预留转入退避重试；其余一律定主记录。
        if ((value?.unsubmitted === true || value?.retryable === true)
          && !DONE_KINDS.has(outcome.kind) && outcome.kind !== 'unsupported')
          await releaseDeferred(path, deferred, account.id, outcome, now() + RETRY_BACKOFF)
        else {
          // 终态改写保留基线：后续核实仍可用「额度增长」比对（额度可能在提交后才到账）。
          await finish(path, {
            id: account.id, outcome,
            ...(Number.isFinite(baseline) ? { baseline } : {}),
          })
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

  // 只读核实：查询上游确认账本结果，绝不提交。适配器没有 verify* 时只回账本现状。
  // 已确认完成仅增写核实票据。查询不撤预留，也不干预在途提交。
  async function query(provider, mode, accountId, signal = lifetime.signal) {
    if (!MODES.has(mode)) throw new Error('不支持此任务类型')
    const adapter = adapters.get(provider)
    if (!adapter || (typeof adapter[mode] !== 'function' && typeof adapter[verifyName(mode)] !== 'function'))
      throw new Error('该渠道不支持此任务操作')
    signal.throwIfAborted()
    const accounts = await adapter.list(signal).catch(() => [])
    const { scope, root, folder } = scopeDir(provider, mode, adapter)
    const targets = accountId === undefined
      ? accounts
      : accounts.filter(account => account.id === accountId)
    const list = accountId === undefined || targets.length ? targets : [{ id: accountId }]
    const verify = adapter[verifyName(mode)]
    const results = []
    for (const account of list) {
      signal.throwIfAborted()
      const path = join(folder, hashId(account.id))
      const deferred = path + '.retry'
      let record = await effective(path, deferred)
      if (scope === ACCOUNT_SCOPE && !record) {
        const adopted = await adoptAccountRecord(root, folder, hashId(account.id), sanitizeOutcome, legacySources(provider, mode, adapter))
        if (adopted) record = adopted.record
      }
      const row = { accountId: account.id, nickname: account.name ?? account.id }
      const confirmed = await read(path + '.confirmed')
      const secured = confirmedDone(confirmed, DONE_KINDS)
      const localDone = !!record && DONE_KINDS.has(record.outcome.kind)
      const serve = localDone ? record.outcome : secured ? confirmed.outcome : record?.outcome ?? pendingOutcome
      // 在途提交绝不干预。
      if (localJobs.has(path)) {
        results.push({ ...row, outcome: serve, repeated: true, verified: false })
        continue
      }
      let verdict = null
      if (typeof verify === 'function') {
        try {
          verdict = verifyState(await verify.call(adapter, account.id, signal))
        } catch (error) {
          if (signal.aborted) throw error
        }
      }
      // 「额度增长即确认」：上游核实给不出 done 证据时（pending / 无 verify 通道 /
      // 查询失败），只要当前额度高于提交前基线，就按已到账确认。
      if (verdict?.state !== 'done' && !localDone && !secured) {
        const growth = balanceGrowth(record?.baseline, await currentBalance(provider, account.id, signal))
        if (growth !== null) {
          verdict = { state: 'done', outcome: mode === 'completeTasks'
            ? { kind: 'completed', completed: 1, points: growth }
            : { kind: 'claimed', claimed: 1, points: growth } }
        }
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
        await onChange?.(provider, mode, outcome)
      }
      results.push({ ...row, outcome, repeated: true, verified })
    }
    return results
  }

  async function status() {
    const entries = await Promise.all([...adapters].map(async ([provider, adapter]) => {
      const date = dayOf(now(), adapter.resetHour)
      const scope = scopeOf(adapter, date)
      const capabilities = {
        claimRewards: typeof adapter.claimRewards === 'function',
        completeTasks: typeof adapter.completeTasks === 'function',
      }
      const readMode = async mode => {
        if (!capabilities[mode]) return []
        const { root, folder } = scopeDir(provider, mode, adapter)
        const rows = await readLedgerRows(root, folder, scope, sanitizeOutcome, legacySources(provider, mode, adapter))
        return rows.map(row => ({
          accountId: row.id,
          kind: row.outcome.kind,
          ...(Number.isFinite(row.outcome.claimed) ? { claimed: row.outcome.claimed } : {}),
          ...(Number.isFinite(row.outcome.completed) ? { completed: row.outcome.completed } : {}),
          ...(Number.isFinite(row.outcome.points) ? { points: row.outcome.points } : {}),
          retryable: row.retryAt !== null,
        }))
      }
      const [claimRewards, completeTasks] = await Promise.all([readMode('claimRewards'), readMode('completeTasks')])
      return [provider, {
        date,
        doneScope: adapter?.doneScope === ACCOUNT_SCOPE ? ACCOUNT_SCOPE : 'cycle',
        capabilities, claimRewards, completeTasks,
      }]
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
          try {
            const rows = await run(provider, mode, undefined, lifetime.signal, true)
            // pending（已提交、结果不明）按间隔只读核实：上游结算或额度增长后落
            // .confirmed 票据并刷新快照，绝不重复提交。
            if (typeof adapter[verifyName(mode)] === 'function' || typeof readBalance === 'function') {
              for (const row of rows) {
                if (lifetime.signal.aborted) break
                if (row.outcome?.kind !== 'pending' || !row.repeated) continue
                const key = `${provider}:${mode}:${row.accountId}`
                const last = pendingVerifiedAt.get(key) ?? 0
                if (now() - last < PENDING_VERIFY_INTERVAL) continue
                pendingVerifiedAt.set(key, now())
                try { await query(provider, mode, row.accountId, lifetime.signal) } catch {}
              }
            }
          }
          catch { if (!lifetime.signal.aborted) logger?.warn?.('[unified-router] 自动任务暂未完成') }
        }
      }
    })().finally(() => { running = null })
    return running
  }

  return {
    run,
    status,
    query,
    tick,
    canRun: (provider, mode) => typeof adapters.get(provider)?.[mode] === 'function',
    canQuery: (provider, mode) =>
      typeof adapters.get(provider)?.[verifyName(mode)] === 'function' || typeof readBalance === 'function',
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
