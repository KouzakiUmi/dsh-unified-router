// 自动化动作周期账本共享模块（daily-checkin 与 auto-tasks 共用）。
//
// 布局：<dir>/<provider>[/<mode>]/<scope>/<sha256(accountId)>[.retry|.confirmed]
// - scope：日界周期为 YYYY-MM-DD；adapter.doneScope === 'account' 的一次性事项固定为 'account'。
// - 主记录：提交预留 + 结论（先 wx 原子创建 pending，再请求上游，最后原子改写终态）。
// - .retry：上游/适配器明确"未提交成功"后的退避重试票据。
//
// 铁律：主记录一旦存在（尤其 pending = 已提交但结果不明），绝不因陈旧、重启或手动
// 触发而重放。只有预留持有人能依据明确的未提交结果释放记录。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const HOUR = 60 * 60_000
export const ACCOUNT_SCOPE = 'account'
const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/
const RECORD_NAME = /^[0-9a-f]{64}(?:\.(?:retry|confirmed))?$/

export const dayOf = (now, resetHour = 0) => new Date(now + (8 - resetHour) * HOUR).toISOString().slice(0, 10)
export const hashId = id => createHash('sha256').update(id).digest('hex')

// adapter.doneScope === 'account' → 跨日一次性账本；否则当日周期账本。
export const scopeOf = (adapter, date) => adapter?.doneScope === 'account' ? ACCOUNT_SCOPE : date

export function parseRecord(text, sanitizeOutcome) {
  try {
    const value = JSON.parse(text)
    if (typeof value?.id !== 'string') return null
    const outcome = sanitizeOutcome(value.outcome)
    if (!outcome) return null
    return { id: value.id, outcome, retryAt: Number.isFinite(value.retryAt) ? value.retryAt : null }
  } catch { return null }
}

export async function readRecord(path, sanitizeOutcome) {
  try { return parseRecord(await readFile(path, 'utf8'), sanitizeOutcome) }
  catch { return null }
}

// 主记录或退避票据：账本的当前真相（主记录优先）。
export const effectiveRecord = async (path, deferred, sanitizeOutcome) =>
  await readRecord(path, sanitizeOutcome) ?? await readRecord(deferred, sanitizeOutcome)

// 以 wx 原子创建完整记录：并发预留/采纳冲突时只认先到者，绝不覆盖。
export async function reserveRecord(path, record) {
  let handle
  try { handle = await open(path, 'wx', 0o600) }
  catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
  try {
    await handle.writeFile(JSON.stringify(record))
    await handle.sync()
  } finally { await handle.close() }
  return true
}

export const reserve = (path, id, pendingOutcome) => reserveRecord(path, { id, outcome: pendingOutcome })

export async function finish(path, record) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flush: true })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}

// preflight/适配器明确声明"未提交成功"（unsubmitted / retryable）：
// 撤销主记录预留，改写为退避票据，到期前自动路径不再提交。
export async function releaseDeferred(path, deferred, id, outcome, retryAt) {
  await finish(deferred, { id, outcome, retryAt })
  await unlink(path).catch(() => {})
}

// 只读核实结论处理：绝不删除/覆盖任何预留，不做读-改-写，天然并发安全。
// - done：写 `${path}.confirmed` 观察票据（wx 原子一次成型，先到为准，永不覆盖）。
//   本地/票据已确认完成的保留其细节；pending 主记录原样保留，由票据提供核实事实，
//   后续 run 在 reserve 前后检查票据，见票即答、绝不提交。
// - open：只应答不落账。本地或票据已确认完成的不被"未达成"推翻（verified:false）。
//   撤票不在此发生——真正"未提交"只能由持有预留的 run 依据上游应答自行释放。
// 返回 {outcome, verified}。
export async function applyVerdict({ state, path, accountId, outcome, local, localIsDone, confirmed, confirmedIsDone }) {
  try {
    if (state === 'done') {
      if (localIsDone) return { outcome: local.outcome, verified: true }
      if (confirmedIsDone) return { outcome: confirmed.outcome, verified: true }
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await reserveRecord(path + '.confirmed', { id: accountId, outcome })
      } catch { /* 观察票据写入失败不影响应答 */ }
      return { outcome, verified: true }
    }
    if (state === 'open') {
      // 已确认成功（本地终态或确认票据）不被"未达成"结论推翻。
      if (localIsDone) return { outcome: local.outcome, verified: false }
      if (confirmedIsDone) return { outcome: confirmed.outcome, verified: false }
      return { outcome, verified: true }
    }
    return { outcome: local?.outcome ?? outcome, verified: false }
  } catch {
    return { outcome: local?.outcome ?? outcome, verified: false }
  }
}

// 一次性事项的最小迁移机制：账号级账本缺失时，回扫旧版按日账本目录。
// 历史主记录（含 pending"不明"）与 .retry 退避票据一律采纳到账号级账本，
// 确保"已确认或不明"都不会被再次提交；按日界取最新一条。root 是渠道/模式根目录，
// folder 是账号级账本目录（root 下的 'account' 子目录）。crossRoots 声明可跨模式
// 采纳的旧版账本源（如 Loomy 老 claimRewards 账本迁入 completeTasks），每个源可带
// 自己的 sanitize 做 outcome 换算。采纳写入一律用 wx 原子创建：并发实例先到的
// 预留/记录优先，绝不覆盖。
export async function adoptAccountRecord(root, folder, accountHash, sanitizeOutcome, crossRoots = []) {
  const trySource = async (sourceRoot, sanitize) => {
    let entries
    try { entries = await readdir(sourceRoot, { withFileTypes: true }) }
    catch { return null }
    const dates = entries
      .filter(entry => entry.isDirectory() && DATE_NAME.test(entry.name))
      .map(entry => entry.name)
      .sort()
      .reverse()
    for (const date of dates) {
      const base = join(sourceRoot, date, accountHash)
      const main = await readRecord(base, sanitize)
      const retry = main ? null : await readRecord(base + '.retry', sanitize)
      const found = main ?? retry
      if (!found) continue
      try {
        await mkdir(folder, { recursive: true, mode: 0o700 })
        const target = join(folder, accountHash + (retry ? '.retry' : ''))
        await reserveRecord(target, retry
          ? { id: found.id, outcome: found.outcome, retryAt: found.retryAt }
          : { id: found.id, outcome: found.outcome })
      } catch { /* 持久化失败仍返回读到的事实，由主记录读取路径兜底 */ }
      return { record: found, kind: retry ? 'retry' : 'main' }
    }
    return null
  }
  const own = await trySource(root, sanitizeOutcome)
  if (own) return own
  for (const cross of crossRoots) {
    const adopted = await trySource(cross.root, cross.sanitize ?? sanitizeOutcome)
    if (adopted) return adopted
  }
  return null
}

// 读取一个账本目录内的全部记录（主记录优先于 .retry 票据）。
// account 作用域额外只读并入旧版按日目录中未被覆盖的账号记录（含 crossRoots
// 跨模式旧账本），防止历史"已确认/不明"结果在状态页里消失
// （不写盘，真正采纳发生在 run/query）。
export async function readLedgerRows(root, folder, scope, sanitizeOutcome, crossRoots = []) {
  const rows = new Map()
  const collect = async (ledgerDir, sanitize = sanitizeOutcome) => {
    let files
    try { files = await readdir(ledgerDir) }
    catch { return }
    for (const name of files) {
      if (!RECORD_NAME.test(name)) continue
      const key = name.slice(0, 64)
      if (rows.has(key)) continue
      const base = join(ledgerDir, key)
      const record = await readRecord(base, sanitize) ?? await readRecord(base + '.retry', sanitize)
      const confirmed = await readRecord(base + '.confirmed', sanitize)
      // 核实票据（只存 done 结论）作为展示覆盖层：本地仍 pending/failed 时如实显示已核实结果。
      const merged = confirmed ? { id: record?.id ?? confirmed.id, outcome: confirmed.outcome, retryAt: null } : record
      if (merged) rows.set(key, merged)
    }
  }
  await collect(folder)
  if (scope === ACCOUNT_SCOPE) {
    const sources = [
      { root, sanitize: sanitizeOutcome },
      ...crossRoots.map(cross => ({ root: cross.root, sanitize: cross.sanitize ?? sanitizeOutcome })),
    ]
    for (const source of sources) {
      let entries
      try { entries = await readdir(source.root, { withFileTypes: true }) }
      catch { continue }
      const dates = entries
        .filter(entry => entry.isDirectory() && DATE_NAME.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .reverse()
      for (const date of dates) await collect(join(source.root, date), source.sanitize)
    }
  }
  return [...rows.values()]
}
