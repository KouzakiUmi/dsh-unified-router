// 向 subusage 插件（`ctx.get('subUsage').ingest()`）推送本插件的额度。
//
// 契约见 dsh-subusage 的 docs/ingest-handoff.md 与 lib/ingest.js 的
// parseIngestPayload（实现比文档权威）：推送方负责取数与形状，subusage 只做
// 校验、持久化与展示。这里只把宿主已采集的公开快照翻译成 QuotaEntry 元素
// （`type: 'amount' | 'window'`），不新增任何上游请求。
//
// 覆盖：账号池渠道（`credits.balances`）、商汤（`plan.snapshot` 的 `quota.pools`）、
// 自管多账号渠道（`managed.snapshot`）、WorkBuddy（`workbuddy.snapshot` 的额度窗口）、
// API Key 渠道（`apikey.snapshot` 的 `quota` / `balance`）。
//
// 三条硬约束：
// 1. **时间用数据时间，不用推送时间**：`receivedAt` 取快照采集时间 / 上游
//    `updatedAt`，`resetsAt` 由数据时间 + `resetInMs` 推出；否则旧额度每次
//    重推都显得刚更新，重置时间还会不断后移。
// 2. **0 是合法值**：控制台明确余额 0 要如实报，不能被 API 余额顶掉。
// 3. **条数有上限**（接收端 `MAX_WINDOWS + MAX_EXTRAS` = 56）：超出截断并报
//    `coverage: 'partial'`，不静默丢。
import { CHANNEL_SPECS } from './channel-specs.js'

/** ingest 的 source（subusage 卡片 id 为 `ingest:<source>`）。 */
export const QUOTA_INGEST_SOURCE = 'unified-router'
/** 展示名。 */
export const QUOTA_INGEST_LABEL = 'Unified Router'
/** 推送有效期：与宿主快照采集周期同量级，过期只标 stale。 */
export const QUOTA_INGEST_TTL_MS = 10 * 60_000
/** 接收端 `parseIngestPayload` 的 quotas 上限（MAX_WINDOWS 16 + MAX_EXTRAS 40）。 */
export const QUOTA_INGEST_MAX_ITEMS = 56

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

/**
 * 窗口百分比：`*-percent` 类窗口的 `used` 本身就是百分比；其余按 `used/limit`
 * 折算。无法折算返回 null（不编造）。
 */
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

function windowPercent(id, used, limit, remaining) {
  const raw = rawPercent(id, used, limit, remaining)
  return raw === null ? null : roundPercent(raw)
}

/**
 * 百分比保留一位小数：四舍五入会把 99.5% 抬成 100%，而接收端把 100% 判为
 * 「已耗尽 / blocked」——那是错误的状态翻转。
 */
function roundPercent(value) {
  if (value >= 100) return 100
  // 非 100 的值绝不抬到 100：接收端把 100% 判为「已耗尽 / blocked」。
  return Math.min(99.9, Math.max(0, Math.round(value * 10) / 10))
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

/**
 * 参与推送的快照资源键（`settingsResourceKey(method, provider)` 形状）。
 *
 * 由渠道规格表派生，不写渠道名清单；宿主按这些键 `peek` 已采集的公开快照。
 * 没有对应资源的渠道（如 `accountPool: false` 的订阅面）peek 返回 null，静默跳过。
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
 * 把宿主快照翻译成 subusage 的 ingest 载荷。
 *
 * @param resources 键为 `settingsResourceKey(method, provider)` 的对象
 * @param options.now 时间源（测试注入）
 */
export function buildQuotaIngestPayload(resources = {}, { now = Date.now } = {}) {
  const quotas = []
  let stale = false
  let truncated = false
  // 每条最终保留项各自的数据时间：receivedAt 取**最旧**的一条（保守），
  // 避免「一条新快照把整批旧数据洗成 fresh」。
  const itemAts = []
  // 当前渠道/账号的池归属：窗口与余额据此分组，避免「任一个窗口耗尽 → 整卡报耗尽」
  // 时无法区分是哪个账号/渠道。
  let pool
  let poolLabel
  const add = (item, dataAt) => {
    if (pool) item.pool = pool
    if (poolLabel) item.poolLabel = poolLabel
    // 窗口属于可独立耗尽的预算维度（不同账号 / 渠道 / 周期）：不标 independent
    // 会让接收端把「某个窗口用尽」当成整张卡耗尽。
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
    const percent = windowPercent(rawId ?? id, used, limit, remaining)
    if (percent === null) return
    const raw = rawPercent(rawId ?? id, used, limit, remaining)
    add({
      id,
      type: 'window',
      period: 'period',
      label,
      percent,
      // 接收端只对显式 `rate-limited` 标限流；用原始值判定，取整不会造假限流。
      ...(raw !== null && raw >= 100 ? { status: 'rate-limited' } : {}),
      // 没有数据时间就不写 resetsAt：用 now 会让重置时间随每次推送后移。
      ...(Number.isSafeInteger(resetInMs) && resetInMs > 0 && Number.isFinite(dataAt)
        ? { resetsAt: new Date(dataAt + Math.min(resetInMs, 40 * 86400000)).toISOString() } : {}),
    }, dataAt)
  }

  for (const spec of CHANNEL_SPECS) {
    if (spec.kind === 'pack') {
      const { value: snapshot, at } = read(`${spec.id}/credits.balances`)
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) stale = true
        // 同渠道多账号是各自独立的钱包：pool 带账号短标识，poolLabel 加短后缀，
        // 否则接收端按 poolLabel 分池会把同名/默认账号合并成一份。
        pool = `${spec.id}:${shortId(account.accountId)}`
        poolLabel = `${safeLabel(account?.nickname, spec.title)} · ${shortId(account.accountId)}`
        const dataAt = finite(account?.updatedAt) ?? at
        pushAmount(`unified-router:${spec.id}:${shortId(account.accountId)}`,
          safeLabel(account?.nickname, spec.title), account?.balance?.total, '积分', dataAt)
      }
      continue
    }
    if (spec.kind === 'plan') {
      // 商汤：额度在 `plan.snapshot` 的 `quota.pools`（每个池带 5h / 7d 窗口）。
      const { value: snapshot, at } = read(`${spec.id}/plan.snapshot`)
      const quota = snapshot?.quota
      // 控制台读取失败/过期被其它渠道遮住时也要如实报 partial。
      // `needs-console` 是「没配控制台会话」而非读取失败：不算 partial。
      if (quota && quota.status !== 'ready' && quota.status !== 'needs-console') stale = true
      if (quota?.status === 'ready' && Array.isArray(quota.pools)) {
        const dataAt = finite(quota.updatedAt) ?? finite(snapshot?.updatedAt) ?? at
        // 池窗口的周期与绝对重置时间上游都给了（`window5h` / `window7d` +
        // `resetAt` 秒），直接用，不猜 now、不退化成通用 period。
        const pushPoolWindow = (pool, kind, period) => {
          const window = pool?.[kind]
          const label = safeLabel(pool?.name, spec.title)
          const percent = windowPercent(`pool:${kind}`, undefined, window?.limit, window?.remaining)
          if (percent === null) return
          const resetAt = Number.isFinite(window?.resetAt) ? window.resetAt * 1000 : undefined
          const raw = rawPercent(`pool:${kind}`, undefined, window?.limit, window?.remaining)
          add({
            id: `unified-router:${spec.id}:${kind}:${shortId(label)}`,
            type: 'window',
            period,
            label: `${label} · ${period}`,
            percent,
            ...(raw !== null && raw >= 100 ? { status: 'rate-limited' } : {}),
            ...(resetAt !== undefined ? { resetsAt: new Date(resetAt).toISOString() } : {}),
          }, dataAt)
        }
        for (const poolRow of quota.pools) {
          const label = safeLabel(poolRow?.name, spec.title)
          pool = `${spec.id}:${label}`
          poolLabel = label
          pushPoolWindow(poolRow, 'window5h', '5h')
          pushPoolWindow(poolRow, 'window7d', '7d')
          pushAmount(`unified-router:${spec.id}:grant:${shortId(label)}`, `${label} · 赠送`,
            poolRow?.grantBalance, '积分', dataAt)
        }
        if (typeof quota.plan === 'string' && quota.plan) {
          pool = undefined
          poolLabel = undefined
          add({ id: `unified-router:${spec.id}:plan`, type: 'plan', value: safeLabel(quota.plan, spec.title), label: spec.title }, dataAt)
        }
      }
      continue
    }
    if (spec.kind === 'managed') {
      const { value: snapshot, at } = read(`${spec.id}/managed.snapshot`)
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) stale = true
        pool = `${spec.id}:${shortId(account.id)}`
        poolLabel = `${safeLabel(account?.name, spec.title)} · ${shortId(account.id)}`
        const dataAt = finite(account?.updatedAt) ?? at
        pushAmount(`unified-router:${spec.id}:${shortId(account.id)}`,
          safeLabel(account?.name, spec.title), account?.balance, account?.unit, dataAt)
      }
      continue
    }
    if (spec.kind === 'workbuddy') {
      const { value: snapshot, at } = read('workbuddy/workbuddy.snapshot')
      const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : []
      for (const account of accounts) {
        if (account?.error) stale = true
        pool = `workbuddy:${shortId(account.id)}`
        poolLabel = `${safeLabel(account?.name, 'WorkBuddy')} · ${shortId(account.id)}`
        const dataAt = finite(account?.updatedAt) ?? at
        const windows = Array.isArray(account?.windows) ? account.windows : []
        for (const window of windows) {
          const resetsAt = typeof window?.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
            ? new Date(window.resetsAt).toISOString() : undefined
          const percent = windowPercent(`wb:${window?.name}`, window?.used, window?.limit, window?.remaining)
          if (percent === null) continue
          const raw = rawPercent(`wb:${window?.name}`, window?.used, window?.limit, window?.remaining)
          add({
            id: `unified-router:workbuddy:${shortId(account.id)}:${shortId(window?.name)}`,
            type: 'window',
            period: 'period',
            label: `${safeLabel(account?.name, 'WorkBuddy')} · ${safeLabel(window?.name, '窗口')}`,
            percent,
            ...(raw !== null && raw >= 100 ? { status: 'rate-limited' } : {}),
            ...(resetsAt ? { resetsAt } : {}),
          }, dataAt)
        }
      }
      continue
    }
    if (spec.kind === 'apikey') {
      // API Key 渠道的额度已由宿主采集进 `apikey.snapshot`（`quota` 来自控制台
      // 配方、`balance` 是 API 余额），这里只消费快照，不发任何上游请求。
      const { value: snapshot, at } = read(`${spec.id}/apikey.snapshot`)
      const quota = snapshot?.quota
      const apiBalance = snapshot?.balance
      pool = spec.id
      poolLabel = spec.title
      // 目录读取失败说明这次快照不完整：如实报 partial，不假装完整。
      if (snapshot?.catalogError) stale = true
      if (quota && quota.status !== 'ready' && quota.status !== 'needs-console') stale = true
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
  }

  // 接收端只留前 56 条且不回传 diagnostics：超出时截断并如实报 partial。
  // 截断前把 amount 提到前面（余额比窗口重要），同类型保持原有顺序。
  const ranked = quotas
    .map((item, index) => ({ item, at: itemAts[index] }))
    .sort((a, b) => (a.item.type === 'amount' ? 0 : 1) - (b.item.type === 'amount' ? 0 : 1))
  const kept = ranked.slice(0, QUOTA_INGEST_MAX_ITEMS)
  if (ranked.length > kept.length) truncated = true
  let items = kept.map(entry => entry.item)
  // receivedAt 取保留项里**最旧**的数据时间：一条新快照不能把整批旧数据洗成 fresh。
  const times = kept.map(entry => entry.at).filter(value => Number.isFinite(value))
  const receivedAt = times.length > 0 ? Math.min(...times) : now()
  const state = items.length > 0 ? 'ok' : 'error'
  const payload = {
    source: QUOTA_INGEST_SOURCE,
    label: QUOTA_INGEST_LABEL,
    state,
    ...(state === 'error' ? { error: '宿主还没有采集到任何渠道额度' } : {}),
    coverage: stale || truncated ? 'partial' : 'complete',
    quotas: items,
    ttlMs: QUOTA_INGEST_TTL_MS,
    receivedAt,
  }
  // 接收端单条上限 64KiB（秘密闸门之外的硬限制）：超了就逐步丢尾部条目，
  // 并如实标 partial —— 整源被拒比少几条更糟。
  while (items.length > 1 && JSON.stringify(payload).length > 60_000) {
    items = items.slice(0, -1)
    payload.quotas = items
    payload.coverage = 'partial'
    truncated = true
  }
  return payload
}