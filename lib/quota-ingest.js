// 向 subusage 插件（`ctx.get('subUsage').ingest()`）推送本插件的额度。
//
// 契约见 dsh-subusage 的 docs/ingest-handoff.md 与 lib/ingest.js 的
// parseIngestPayload（实现比文档权威）：推送方负责取数与形状，subusage 只做
// 校验、持久化与展示。这里只把宿主已采集的公开快照翻译成 QuotaEntry 元素
// （`type: 'amount' | 'window'`），不新增任何上游请求。
//
// **按渠道拆源**：每个渠道一张卡（`source = unified-router-<provider>`，
// 卡标题 = 渠道名），条目才是账号名。全部挤在一张卡里会让接收端无法识别
// provider，只看到一串账号名。
//
// 覆盖：账号池渠道（`credits.balances`）、商汤（`plan.snapshot` 的 `quota.pools`）、
// 自管多账号渠道（`managed.snapshot`）、WorkBuddy（`workbuddy.snapshot` 的额度窗口）、
// API Key 渠道（`apikey.snapshot` 的 `quota` / `balance`）。
//
// 三条硬约束：
// 1. **时间用数据时间，不用推送时间**：`receivedAt` 取该卡保留项里最旧的数据时间，
//    `resetsAt` 由数据时间 + `resetInMs`（或上游绝对 `resetAt`）推出。
// 2. **0 是合法值**：控制台明确余额 0 要如实报，不能被 API 余额顶掉。
// 3. **条数有上限**（接收端 `MAX_WINDOWS + MAX_EXTRAS` = 56）：超出截断并报
//    `coverage: 'partial'`，不静默丢。
import { CHANNEL_SPECS } from './channel-specs.js'

/** source 前缀（每张卡是 `unified-router-<provider>`）。 */
export const QUOTA_INGEST_PREFIX = 'unified-router'
/** 展示名（单源兼容用）。 */
export const QUOTA_INGEST_LABEL = 'Unified Router'
/** 推送有效期：与宿主快照采集周期同量级，过期只标 stale。 */
export const QUOTA_INGEST_TTL_MS = 10 * 60_000
/** 接收端 `parseIngestPayload` 的 quotas 上限（MAX_WINDOWS 16 + MAX_EXTRAS 40）。 */
export const QUOTA_INGEST_MAX_ITEMS = 56
/** 接收端单条 64KiB；留一点余量后逐步丢尾。 */
const MAX_PAYLOAD_BYTES = 60_000

/** QuotaEntry 的 `amount.unitKind` 白名单：cash / credit / token / quota。 */
function unitKindOf(unit) {
  const text = String(unit ?? '').trim().toLowerCase()
  if (!text) return 'quota'
  if (text.includes('积分') || text === 'credit' || text === 'credits') return 'credit'
  if (text.includes('token')) return 'token'
  if (text.includes('元') || text === 'cny' || text === 'usd' || text === 'rmb') return 'cash'
  return 'quota'
}

/** 快照条目取值：宿主存的是 `{ value, at, stale }`，测试里可能直接给 value。 */
function valueOf(entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry) return entry.value
  return entry
}

/** 快照条目的采集时间（毫秒）；测试里直接给 value 时没有。 */
function atOf(entry) {
  const at = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.at : undefined
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : undefined
}

/** 有限数才收（0 合法；NaN / Infinity / 字符串不收）。 */
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null

/** 原始百分比（未做展示取整）：`status` 判定必须用原始值，避免取整造假限流。 */
function rawPercent(id, used, limit, remaining) {
  if (String(id ?? '').endsWith('-percent')) return finite(used)
  const l = finite(limit)
  let u = finite(used)
  if (u === null) {
    // 上游只给 remaining（如 Agnes 的 `used: null, limit: 10, remaining: 5`）。
    const r = finite(remaining)
    if (l !== null && l > 0 && r !== null) u = l - r
  }
  if (l === null || l <= 0 || u === null || u < 0) return null
  return (u / l) * 100
}

/**
 * 百分比保留一位小数：非 100 的值绝不抬到 100%，接收端把 100% 判为
 * 「已耗尽 / blocked」——那是错误的状态翻转。
 */
function roundPercent(value) {
  if (value >= 100) return 100
  return Math.min(99.9, Math.max(0, Math.round(value * 10) / 10))
}

function windowPercent(id, used, limit, remaining) {
  const raw = rawPercent(id, used, limit, remaining)
  return raw === null ? null : roundPercent(raw)
}

/** 接收端秘密闸门会整条拒绝含令牌形态的文本：所有自由文本先兜底成渠道名。 */
function safeLabel(value, fallback) {
  const text = String(value ?? '').trim().slice(0, 64)
  if (!text || /Bearer|sk-|eyJ|gh[pousr]_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|cog_|devin-session-token/i.test(text)) return fallback
  return text
}

/**
 * 稳定短 ID：账号 id 可能很长（历史/手改状态无长度上限），原样进 id 会撑爆
 * 接收端的 64KiB 上限并让整源被拒。djb2 足够做展示用去重，且同输入恒定。
 */
function shortId(value) {
  const text = String(value ?? '')
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

/** 一个渠道的收集器：条目、每条的数据时间、stale 与截断标记。 */
function createCollector(now, resources) {
  const quotas = []
  const itemAts = []
  let stale = false
  let truncated = false
  // 当前账号的池归属：接收端按 `poolLabel` 分池，同名账号必须可区分。
  let pool
  let poolLabel
  const add = (item, dataAt) => {
    if (pool) item.pool = pool
    if (poolLabel) item.poolLabel = poolLabel
    // 窗口属于可独立耗尽的预算维度：不标 independent 会让「某个窗口用尽」
    // 被当成整张卡耗尽。
    if (item.type === 'window' && pool) item.poolScope = 'independent'
    item.order = quotas.length
    quotas.push(item)
    itemAts.push(Number.isFinite(dataAt) ? dataAt : undefined)
  }
  const read = key => {
    const entry = resources[key]
    if (entry && typeof entry === 'object' && entry.stale === true) stale = true
    return { value: valueOf(entry), at: atOf(entry) }
  }
  const setPool = (nextPool, nextLabel) => {
    pool = nextPool
    poolLabel = nextLabel
  }
  const pushAmount = (id, label, value, unit, dataAt) => {
    const amount = finite(value)
    if (amount === null || amount < 0) return
    add({
      id,
      type: 'amount',
      role: 'balance',
      label,
      // 单位只在来源明确时写：控制台余额没有单位字段，不能借 API 的 USD/CNY。
      amount: { value: amount, ...(unit ? { unit, unitKind: unitKindOf(unit) } : { unitKind: 'quota' }) },
      ...(Number.isFinite(dataAt) ? { updatedAt: dataAt } : {}),
    }, dataAt)
  }
  // `rawId` 是上游原始窗口 id（如 `monthly-percent`）：输出 id 已哈希，不能拿它判类型。
  const pushWindow = (id, label, used, limit, resetInMs, dataAt, remaining, rawId) => {
    const raw = rawPercent(rawId ?? id, used, limit, remaining)
    if (raw === null) return
    add({
      id,
      type: 'window',
      period: 'period',
      label,
      percent: roundPercent(raw),
      // 接收端只对显式 `rate-limited` 标限流；用原始值判定，取整不会造假限流。
      ...(raw >= 100 ? { status: 'rate-limited' } : {}),
      // 没有数据时间就不写 resetsAt：用 now 会让重置时间随每次推送后移。
      ...(Number.isSafeInteger(resetInMs) && resetInMs > 0 && Number.isFinite(dataAt)
        ? { resetsAt: new Date(dataAt + Math.min(resetInMs, 40 * 86400000)).toISOString() } : {}),
    }, dataAt)
  }
  const finish = spec => {
    // 截断前把 amount 提到前面（余额比窗口重要），同类型保持原有顺序。
    const ranked = quotas
      .map((item, index) => ({ item, at: itemAts[index] }))
      .sort((a, b) => (a.item.type === 'amount' ? 0 : 1) - (b.item.type === 'amount' ? 0 : 1))
    let kept = ranked.slice(0, QUOTA_INGEST_MAX_ITEMS)
    if (ranked.length > kept.length) truncated = true
    let items = kept.map(entry => entry.item)
    // receivedAt 取保留项里**最旧**的数据时间：一条新快照不能把整批旧数据洗成 fresh。
    const times = kept.map(entry => entry.at).filter(value => Number.isFinite(value))
    const receivedAt = times.length > 0 ? Math.min(...times) : now()
    const state = items.length > 0 ? 'ok' : 'error'
    const payload = {
      source: `${QUOTA_INGEST_PREFIX}-${spec.id}`,
      label: spec.title,
      state,
      ...(state === 'error' ? { error: `未采集到 ${spec.title} 的额度` } : {}),
      coverage: stale || truncated ? 'partial' : 'complete',
      quotas: items,
      ttlMs: QUOTA_INGEST_TTL_MS,
      receivedAt,
    }
    // 接收端单条上限 64KiB：超了就逐步丢尾部条目并标 partial。
    while (items.length > 1 && JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
      items = items.slice(0, -1)
      payload.quotas = items
      payload.coverage = 'partial'
      truncated = true
    }
    if (state === 'error') return undefined
    return payload
  }
  return { add, read, pushAmount, pushWindow, finish, setPool, markStale: () => { stale = true } }
}

/**
 * 参与推送的快照资源键（`settingsResourceKey(method, provider)` 形状）。
 * 由渠道规格表派生，不写渠道名清单。
 */
export function quotaIngestResourceKeys() {
  const keys = []
  for (const spec of CHANNEL_SPECS) {
    if (spec.kind === 'pack') keys.push(`${spec.id}/credits.balances`)
    else if (spec.kind === 'plan') keys.push(`${spec.id}/plan.snapshot`)
    else if (spec.kind === 'managed') keys.push(`${spec.id}/managed.snapshot`)
    else if (spec.kind === 'apikey') keys.push(`${spec.id}/apikey.snapshot`)
    else if (spec.kind === 'workbuddy') keys.push('workbuddy/workbuddy.snapshot')
  }
  return keys
}

/**
 * 把宿主快照翻译成**按渠道拆分**的 ingest 载荷数组（每渠道一张卡）。
 *
 * @param resources 键为 `settingsResourceKey(method, provider)` 的对象
 * @param options.now 时间源（测试注入）
 */
export function buildQuotaIngestPayloads(resources = {}, { now = Date.now } = {}) {
  const payloads = []
  for (const spec of CHANNEL_SPECS) {
    const collector = createCollector(now, resources)
    const { add, read, pushAmount, pushWindow, finish, setPool, markStale } = collector
    if (spec.kind === 'pack') {
      const { value: snapshot, at } = read(`${spec.id}/credits.balances`)
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) markStale()
        setPool(`${spec.id}:${shortId(account.accountId)}`,
          `${safeLabel(account?.nickname, spec.title)} · ${shortId(account.accountId)}`)
        const dataAt = finite(account?.updatedAt) ?? at
        pushAmount(`unified-router:${spec.id}:${shortId(account.accountId)}`,
          safeLabel(account?.nickname, spec.title), account?.balance?.total, '积分', dataAt)
      }
    } else if (spec.kind === 'plan') {
      const { value: snapshot, at } = read(`${spec.id}/plan.snapshot`)
      const quota = snapshot?.quota
      // `needs-console` 是「没配控制台会话」而非读取失败：不算 partial。
      if (quota && quota.status !== 'ready' && quota.status !== 'needs-console') markStale()
      if (quota?.status === 'ready' && Array.isArray(quota.pools)) {
        const dataAt = finite(quota.updatedAt) ?? finite(snapshot?.updatedAt) ?? at
        for (const poolRow of quota.pools) {
          const label = safeLabel(poolRow?.name, spec.title)
          setPool(`${spec.id}:${shortId(label)}`, label)
          const pushPoolWindow = (kind, period) => {
            const window = poolRow?.[kind]
            const raw = rawPercent(`pool:${kind}`, undefined, window?.limit, window?.remaining)
            if (raw === null) return
            const resetAt = Number.isFinite(window?.resetAt) ? window.resetAt * 1000 : undefined
            add({
              id: `unified-router:${spec.id}:${kind}:${shortId(label)}`,
              type: 'window',
              period,
              label: `${label} · ${period}`,
              percent: roundPercent(raw),
              ...(raw >= 100 ? { status: 'rate-limited' } : {}),
              ...(resetAt !== undefined ? { resetsAt: new Date(resetAt).toISOString() } : {}),
            }, dataAt)
          }
          pushPoolWindow('window5h', '5h')
          pushPoolWindow('window7d', '7d')
          pushAmount(`unified-router:${spec.id}:grant:${shortId(label)}`, `${label} · 赠送`,
            poolRow?.grantBalance, '积分', dataAt)
        }
        if (typeof quota.plan === 'string' && quota.plan) {
          setPool(undefined, undefined)
          add({ id: `unified-router:${spec.id}:plan`, type: 'plan', value: safeLabel(quota.plan, spec.title), label: spec.title }, dataAt)
        }
      }
    } else if (spec.kind === 'managed') {
      const { value: snapshot, at } = read(`${spec.id}/managed.snapshot`)
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) markStale()
        setPool(`${spec.id}:${shortId(account.id)}`,
          `${safeLabel(account?.name, spec.title)} · ${shortId(account.id)}`)
        const dataAt = finite(account?.updatedAt) ?? at
        pushAmount(`unified-router:${spec.id}:${shortId(account.id)}`,
          safeLabel(account?.name, spec.title), account?.balance, account?.unit, dataAt)
      }
    } else if (spec.kind === 'workbuddy') {
      const { value: snapshot, at } = read('workbuddy/workbuddy.snapshot')
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) markStale()
        setPool(`workbuddy:${shortId(account.id)}`,
          `${safeLabel(account?.name, 'WorkBuddy')} · ${shortId(account.id)}`)
        const dataAt = finite(account?.updatedAt) ?? at
        for (const window of Array.isArray(account?.windows) ? account.windows : []) {
          const raw = rawPercent(`wb:${window?.name}`, window?.used, window?.limit, window?.remaining)
          if (raw === null) continue
          const resetsAt = typeof window?.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
            ? new Date(window.resetsAt).toISOString() : undefined
          add({
            id: `unified-router:workbuddy:${shortId(account.id)}:${shortId(window?.name)}`,
            type: 'window',
            period: 'period',
            label: `${safeLabel(account?.name, 'WorkBuddy')} · ${safeLabel(window?.name, '窗口')}`,
            percent: roundPercent(raw),
            ...(raw >= 100 ? { status: 'rate-limited' } : {}),
            ...(resetsAt ? { resetsAt } : {}),
          }, dataAt)
        }
      }
    } else if (spec.kind === 'apikey') {
      const { value: snapshot, at } = read(`${spec.id}/apikey.snapshot`)
      const quota = snapshot?.quota
      const apiBalance = snapshot?.balance
      setPool(spec.id, spec.title)
      if (snapshot?.catalogError) markStale()
      if (quota && quota.status !== 'ready' && quota.status !== 'needs-console') markStale()
      const dataAt = finite(quota?.updatedAt) ?? finite(apiBalance?.updatedAt) ?? at
      if (quota?.status === 'ready') {
        for (const window of Array.isArray(quota.windows) ? quota.windows : []) {
          pushWindow(`unified-router:${spec.id}:window:${shortId(window?.id)}`, `${spec.title} · ${window?.id}`,
            window?.used, window?.limit, window?.resetInMs, dataAt, window?.remaining, window?.id)
        }
        for (const gift of Array.isArray(quota.gifts) ? quota.gifts : []) {
          pushWindow(`unified-router:${spec.id}:gift:${shortId(gift?.modelId)}`, `${spec.title} · ${gift?.modelId}`,
            gift?.used, gift?.limit, undefined, dataAt, gift?.remaining, gift?.modelId)
        }
      }
      // 控制台余额优先（明确 0 也如实报）；没有控制台余额时退回 API 余额，
      // 无限额度不编造。控制台投影没有单位字段，不借 API 的 USD/CNY。
      const consoleBalance = finite(quota?.balance)
      if (consoleBalance !== null && consoleBalance >= 0) {
        pushAmount(`unified-router:${spec.id}:balance`, spec.title, consoleBalance, undefined, dataAt)
      } else if (apiBalance && apiBalance.unlimited !== true) {
        const limit = finite(apiBalance.limit)
        const used = finite(apiBalance.used)
        pushAmount(`unified-router:${spec.id}:balance`, spec.title,
          limit !== null && used !== null ? Math.max(0, limit - used) : undefined, apiBalance.unit, dataAt)
      }
    }
    const payload = finish(spec)
    if (payload) payloads.push(payload)
  }
  return payloads
}