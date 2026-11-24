/**
 * Raccoon Work 积分（余额 + 一次性登录奖励）。
 *
 * ## ⚠️ 三个来源的语义（关键）
 *
 * | 来源 | 金额 | 触发方式 | 本模块 |
 * |---|---|---|---|
 * | 新人注册礼包 | 3000 | 注册时服务端自动发放 | 不涉及（用户注册即有） |
 * | 桌面端登录奖励 | 3000 | `POST …/login/points/grant` | ✅ `claimRaccoonLoginReward` |
 * | 每日积分发放 | 300 起（连续签到日更多） | `GET …/office/v3/setting_info` 触发 | ✅ `checkInRaccoon` |
 *
 * ⚠️ **没有专门的「签到」端点，但不等于不能签**：服务端在收到**带桌面端头**的
 * `GET /api/web/office/v3/setting_info` 时发放当日积分（`biz_type: 'daily_grant'`）。
 * 该 GET 因此**有副作用**，这正是官方客户端「打开就加积分」的行为。
 * 早期结论（「无端点 ⇒ 不可实现」）只对了前半句：端点不存在，但触发器存在。
 * 依据见 `checkInRaccoon`。
 *
 * ⚠️ **登录奖励是幂等一次性的**（已领过返回 `granted:false`），
 * 语义与 Loomy 的新手任务同构，故登记为 `onboardingTasks` 而**不是**
 * `dailyCheckin` —— 两者是不同来源，见 `checkInRaccoon` 的账单判据。
 *
 * ## 只读优先
 *
 * 余额查询用 `GET /points/v1/balance`（**只读**）。在「打开面板」这类
 * 高频路径上**绝不**触碰写端点（Loomy 的 `first-login` 就踩过这个坑：
 * 打开面板即意外触发签到）。
 */

import {
  RACCOON_POINTS_PREFIX,
  RACCOON_DESKTOP_PREFIX,
  RACCOON_OFFICE_PREFIX,
  RACCOON_REQUEST_TIMEOUT_MS,
  raccoonHeaders,
  type RaccoonCredential,
} from './raccoon.js'
import { RACCOON, type RaccoonProduct } from './raccoon-product.js'
import type { ClaimOutcome, CreditBalance, CreditPackage } from './credits.js'

/** 登录奖励的默认额度（服务端未在 popup 里给出时兜底）。 */
export const RACCOON_LOGIN_REWARD_POINTS = 3000

/** 登录奖励在账单里的 `event_name`（用于判定是否已领）。 */
export const RACCOON_LOGIN_REWARD_EVENT_NAME = '桌面端登录奖励'

/** 业务响应信封。 */
interface Envelope {
  ok: boolean
  code: number
  message: string
  data: Record<string, unknown> | undefined
}

/** 解析信封；`code === 0` 为成功。 */
function parseEnvelope(payload: unknown, status: number): Envelope {
  const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
  const code = typeof record.code === 'number' ? record.code : (status >= 400 ? status : 0)
  const message = typeof record.message === 'string' && record.message.length > 0
    ? record.message
    : (typeof record.details === 'string' ? record.details : '')
  const data = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined
  return { ok: code === 0, code, message, data }
}

/** 读成有限数字；非法返回 undefined（**不编造 0**）。 */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 发一次业务请求并拆信封。
 *
 * ⚠️ 不抛错 —— 调用方按 `ok` 分支处理。积分查询/领取属「尽力而为」，
 * 批量操作时单个账号失败不应中断其余账号。
 */
async function requestJson(
  url: string,
  credential: RaccoonCredential,
  product: RaccoonProduct,
  init: { method: string; body?: string },
  fetcher: typeof fetch,
): Promise<Envelope> {
  try {
    const response = await fetcher(url, {
      method: init.method,
      headers: raccoonHeaders(credential, {
        platform: product.clientPlatform,
        version: product.clientVersion,
      }),
      ...init.body === undefined ? {} : { body: init.body },
      signal: AbortSignal.timeout(RACCOON_REQUEST_TIMEOUT_MS),
    })
    const parsed: unknown = await response.json()
    return parseEnvelope(parsed, response.status)
  } catch (error) {
    return {
      ok: false,
      code: -1,
      message: error instanceof Error ? error.message : String(error),
      data: undefined,
    }
  }
}

/** 构造一个资源包条目。 */
function makePackage(name: string, remaining: number): CreditPackage {
  return {
    name,
    unit: '积分',
    remaining,
    total: remaining,
    used: 0,
    active: true,
    cycleStartTime: '',
    cycleEndTime: '',
    expiredTime: '',
  }
}

/**
 * 查询积分余额（映射成既有的 `CreditBalance` 形状）。
 *
 * ⚠️ 各池**分开作 package**，让用户看出「注册礼包 / 每日 / 充值」是独立来源
 * —— 它们的有效期与回补规则都不同（每日积分每日刷新、充值积分长期有效）。
 *
 * @returns 查不到时返回 `null`（卡片显示原因，**不是** 0）。
 */
export async function fetchRaccoonCreditBalance(
  product: RaccoonProduct,
  credential: RaccoonCredential,
  fetcher: typeof fetch = fetch,
): Promise<CreditBalance | null> {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/balance`,
    credential,
    product,
    { method: 'GET' },
    fetcher,
  )
  if (!envelope.ok || envelope.data === undefined) return null

  const available = readNumber(envelope.data.available_points)
  // `available_points` 是核心字段：没有它就说明响应形状不对，不编造数字。
  if (available === undefined) return null

  const packages: CreditPackage[] = []
  const reward = readNumber(envelope.data.reward_points)
  const daily = readNumber(envelope.data.daily_points)
  const topup = readNumber(envelope.data.topup_points)
  const monthly = readNumber(envelope.data.monthly_points)
  if (reward !== undefined) packages.push(makePackage('奖励积分', reward))
  if (daily !== undefined) packages.push(makePackage('每日积分', daily))
  if (monthly !== undefined && monthly > 0) packages.push(makePackage('会员积分', monthly))
  if (topup !== undefined) packages.push(makePackage('充值积分', topup))

  return {
    total: available,
    // 极端情形（服务端只给 total 不给分项）也要有至少一个包，否则 UI 空列表
    packages: packages.length > 0 ? packages : [makePackage('可用积分', available)],
    expiredTotal: 0,
  }
}

/**
 * 领取「桌面端登录奖励」（一次性，幂等）。
 *
 * ⚠️ **不是每日签到**：实测该端点是幂等一次性的（已领过返回 `granted:false`
 * 且账单里能看到上一次的记录）。映射到 `onboardingTasks` 能力。
 *
 * ⚠️ 需要 `X-Client-Platform` 头（值见 `product.clientPlatform`）——
 * 它标识「来自桌面端」，缺了会被拒。见 `raccoonHeaders`。
 *
 * 本函数**不抛错**（失败也返回 `failed`），保证批量领取不会因单个账号中断。
 */
export async function claimRaccoonLoginReward(
  product: RaccoonProduct,
  credential: RaccoonCredential,
  fetcher: typeof fetch = fetch,
): Promise<ClaimOutcome> {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_DESKTOP_PREFIX}/login/points/grant`,
    credential,
    product,
    { method: 'POST' },
    fetcher,
  )

  if (!envelope.ok) {
    return {
      kind: 'failed',
      code: envelope.code,
      message: envelope.message.length > 0 ? envelope.message : '领取登录奖励失败',
    }
  }

  // ⚠️ 幂等判据是 `granted`（重复领取同样返回 HTTP 200 + `granted:false`），
  // 故映射成 `already-claimed` 而**不是** `claimed` ——
  // 后者会让用户以为每天都真的加了额度。
  if (envelope.data?.granted !== true) {
    return {
      kind: 'already-claimed',
      message: '该账号已领取过桌面端登录奖励（每号一次）',
    }
  }

  const popup = typeof envelope.data.popup === 'object' && envelope.data.popup !== null
    ? envelope.data.popup as Record<string, unknown>
    : undefined
  const points = readNumber(popup?.points) ?? RACCOON_LOGIN_REWARD_POINTS
  return { kind: 'claimed', credit: points, streakDays: 0, isStreakDay: false }
}

/** 北京时间（UTC+8）的「今天」日键；与账单 `created_at` 的日历口径一致。 */
function beijingDayKey(now: number = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 账单行的稳定键（服务端可能只给其中一部分字段）。 */
function billKey(item: Record<string, unknown>): string {
  const id = item.bill_id ?? item.biz_id
  if (id !== undefined && id !== null) return String(id)
  return `${String(item.created_at ?? '')}:${String(item.points ?? '')}:${String(item.event_name ?? '')}`
}

/**
 * 是否是「签到类」发放账单：当天、正积分、且 `biz_type` 属于发放类。
 *
 * ⚠️ `biz_type` 为空也算 —— 实测有记录不带该字段，靠「当天 + 正积分」已足够
 * 区分（充值/消费账单的 `points` 为负或另有 `biz_type`）。
 */
function isDailyGrantBill(item: Record<string, unknown>, today: string): boolean {
  const points = readNumber(item.points)
  if (points === undefined || points <= 0) return false
  if (String(item.created_at ?? '').slice(0, 10) !== today) return false
  const biz = String(item.biz_type ?? '')
  return biz.length === 0 || biz === 'daily_grant' || biz === 'reward_grant'
}

/** 读账单明细；失败返回 `null`（调用方据此放弃金额判定，绝不编造）。 */
async function readBills(
  product: RaccoonProduct,
  credential: RaccoonCredential,
  fetcher: typeof fetch,
): Promise<Array<Record<string, unknown>> | null> {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/bills?paging.limit=20&paging.offset=0`,
    credential,
    product,
    { method: 'GET' },
    fetcher,
  )
  if (!envelope.ok || envelope.data === undefined) return null
  const items = Array.isArray(envelope.data.items) ? envelope.data.items : []
  return items.filter(
    (raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw),
  )
}

/**
 * 每日签到：触发服务端当日积分发放，并回报**本次新增**了多少。
 *
 * ## 为什么是「请求一个只读端点」
 *
 * 上游**没有**签到端点。当日积分由服务端在收到**带桌面端头**的
 * `GET /api/web/office/v3/setting_info` 时发放（`biz_type: 'daily_grant'`）——
 * 这就是官方客户端「打开即加积分」的行为。故签到 = 发一次该 GET，再由
 * `/points/v1/bills` 的前后差值确认新增金额。
 *
 * ## 幂等性
 *
 * 服务端**按日判定**：同一天再请求不会重复发放，账单也不新增，本函数据差值
 * 返回 `already-claimed`（不是错误）。因此重复调用安全，无需本地防重。
 *
 * ## 读不到账单时
 *
 * 返回 `already-claimed` 而非编造金额：服务端已幂等，明天照常再跑不会漏领；
 * 编一个数字反而会让用户以为拿到了没拿到的积分。
 */
export async function checkInRaccoon(
  product: RaccoonProduct,
  credential: RaccoonCredential,
  fetcher: typeof fetch = fetch,
): Promise<ClaimOutcome> {
  const today = beijingDayKey()

  // 前置快照：今天已发放的账单键。读不到就记为「无法比对」。
  const before = await readBills(product, credential, fetcher)
  const beforeKeys = before === null
    ? null
    : new Set(before.filter((item) => isDailyGrantBill(item, today)).map(billKey))

  // 触发器：只读 GET，副作用是服务端发放当日积分。
  const trigger = await requestJson(
    `${product.apiBase}${RACCOON_OFFICE_PREFIX}/setting_info`,
    credential,
    product,
    { method: 'GET' },
    fetcher,
  )
  if (!trigger.ok) {
    return {
      kind: 'failed',
      code: trigger.code,
      message: trigger.message.length > 0 ? trigger.message : '签到请求失败',
    }
  }

  const unsettled = { kind: 'already-claimed' as const, message: '已触发今日签到（账单未取到，金额未确认）' }
  if (beforeKeys === null) return unsettled
  const after = await readBills(product, credential, fetcher)
  if (after === null) return unsettled

  let credit = 0
  const names: string[] = []
  for (const item of after) {
    if (!isDailyGrantBill(item, today)) continue
    if (beforeKeys.has(billKey(item))) continue
    credit += Math.floor(readNumber(item.points) ?? 0)
    const event = String(item.event_name ?? '')
    if (event.length > 0 && !names.includes(event)) names.push(event)
  }

  if (credit > 0) {
    return {
      kind: 'claimed',
      credit,
      // 上游不回报连续天数：报 0 而不是猜。
      streakDays: 0,
      isStreakDay: false,
      ...(names.length > 0 ? { delayedMessage: names.join(' + ') } : {}),
    }
  }
  return { kind: 'already-claimed', message: '今日已签到' }
}

/**
 * 查询「桌面端登录奖励」是否已领（供 `onboarding.status` 用）。
 *
 * 判据：`GET /points/v1/bills` 里是否已有
 * `biz_type === 'reward_grant'` 且 `event_name === '桌面端登录奖励'` 的记录。
 *
 * ⚠️ **不能靠 `balance` 推断** —— 余额是多个来源（注册礼包/每日/充值）的
 * 合计，无法区分某一项是否已领。
 * ⚠️ **不能只按 `biz_type === 'reward_grant'` 判定** —— 「新人注册礼包」
 * 也是 `reward_grant`，把它算作登录奖励会让新用户一开始就显示「已领取」。
 * ⚠️ **服务端没有单独的奖励状态端点**（实测），故只能查账单明细。
 * ⚠️ 查询失败时保守返回 `claimed: false` —— 宁可让用户多点一次
 * （服务端幂等，无害），也不要误报「已领」而让他真的错过。
 */
export async function fetchRaccoonOnboardingStatus(
  product: RaccoonProduct,
  credential: RaccoonCredential,
  fetcher: typeof fetch = fetch,
): Promise<{ claimed: boolean; points: number }> {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/bills?paging.limit=50&paging.offset=0`,
    credential,
    product,
    { method: 'GET' },
    fetcher,
  )
  if (!envelope.ok || envelope.data === undefined) {
    return { claimed: false, points: RACCOON_LOGIN_REWARD_POINTS }
  }

  const items = Array.isArray(envelope.data.items) ? envelope.data.items : []
  let claimed = false
  let points = RACCOON_LOGIN_REWARD_POINTS
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    if (item.biz_type !== 'reward_grant') continue
    if (item.event_name !== RACCOON_LOGIN_REWARD_EVENT_NAME) continue
    claimed = true
    const billPoints = readNumber(item.points)
    if (billPoints !== undefined && billPoints > 0) points = billPoints
    break
  }
  return { claimed, points }
}

/** 默认产品配置下的便捷包装（供 `RaccoonAuth` 调用）。 */
export const raccoonCreditsForDefaultProduct = {
  fetchBalance: (credential: RaccoonCredential, fetcher?: typeof fetch) =>
    fetchRaccoonCreditBalance(RACCOON, credential, fetcher),
  claimLoginReward: (credential: RaccoonCredential, fetcher?: typeof fetch) =>
    claimRaccoonLoginReward(RACCOON, credential, fetcher),
  checkIn: (credential: RaccoonCredential, fetcher?: typeof fetch) =>
    checkInRaccoon(RACCOON, credential, fetcher),
  fetchOnboardingStatus: (credential: RaccoonCredential, fetcher?: typeof fetch) =>
    fetchRaccoonOnboardingStatus(RACCOON, credential, fetcher),
}
