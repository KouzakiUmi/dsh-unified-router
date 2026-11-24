/**
 * Raccoon 每日签到（`checkInRaccoon`）。
 *
 * ## 被测契约
 *
 * 上游**没有专门的签到端点**：当日积分由服务端在收到**带桌面端头**的
 * `GET /api/web/office/v3/setting_info` 时发放（`biz_type: 'daily_grant'`）。
 * 因此签到 = 发一次该 GET，再由 `/points/v1/bills` 的前后差值确认新增金额。
 *
 * 1. **新增即以账单为准**：只统计「当天 + 正积分 + 发放类 biz_type」的新增行，
 *    金额取 `points` 之和 —— 不按余额推断（余额是多个来源的合计）。
 * 2. **不重复加钱**：第二次调用账单无新增 ⇒ `already-claimed`，绝不报 `claimed: 0`。
 * 3. **账单读不到不编造**：返回 `already-claimed`（服务端按日幂等，明天照常再跑），
 *    而不是声称一个没确认的金额。
 * 4. **失败如实上报**：`setting_info` 非 0 码 ⇒ `failed` 且带上游 code。
 * 5. **必须带桌面端头**：缺 `X-Client-Platform` 时上游不发放。
 *
 * 实测依据：Magpie 的 `opencode-raccoon-auth` 插件（`performCheckIn`）用同一路径
 * 在 2026-11-17…11-24 连续签到成功，日志形如
 * `plugin check-in: Raccoon-pu-… +300` / `+500` / `: done`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 让单测能直接 import `vendor/channel-pack/src/*.ts`（同 raccoon-thinking 测试）。 */
function installSourceHooks() {
  return registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL !== undefined) {
        const parent = fileURLToPath(context.parentURL)
        if (parent.includes(`${path.sep}channel-pack${path.sep}src${path.sep}`)) {
          const candidate = path.resolve(path.dirname(parent), specifier.replace(/\.js$/u, '.ts'))
          if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }
      return next(specifier, context)
    },
  })
}

installSourceHooks()
const { checkInRaccoon } = await import('../vendor/channel-pack/src/raccoon-credits.ts')
const { RACCOON } = await import('../vendor/channel-pack/src/raccoon-product.ts')

/** 北京时间（UTC+8）的「今天」——与被测函数的口径一致。 */
const todayKey = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const yesterdayKey = () => new Date(Date.now() + 8 * 60 * 60 * 1000 - 86_400_000).toISOString().slice(0, 10)

const credential = { access_token: 'test-access-token' }
const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })

/**
 * 桩 fetcher：`/setting_info` 回一个可配置的响应，`/bills` 第一次回 before、
 * 第二次回 after（模拟「签到前快照 → 签到后比对」）。
 */
function stubFetcher({ before = [], after = [], settingInfo, billsFail = false } = {}) {
  let billCalls = 0
  const calls = []
  const fetcher = async (url, init) => {
    const text = String(url)
    calls.push({ url: text, init })
    if (text.includes('/office/v3/setting_info')) {
      return settingInfo ?? json({ code: 0, data: { ok: true } })
    }
    if (text.includes('/points/v1/bills')) {
      if (billsFail) return json({ code: 50000, message: 'bills unavailable' })
      billCalls += 1
      return json({ code: 0, data: { items: billCalls === 1 ? before : after } })
    }
    throw new Error(`unexpected url: ${text}`)
  }
  return { fetcher, calls, billCalls: () => billCalls }
}

const grant = (points, extra = {}) => ({
  bill_id: `bill-${points}-${Math.random().toString(36).slice(2, 8)}`,
  points,
  created_at: `${todayKey()}T15:06:25`,
  biz_type: 'daily_grant',
  event_name: '每日积分发放',
  ...extra,
})

test('签到：账单新增即按差值回报 claimed 与金额，且请求带桌面端头', async () => {
  const { fetcher, calls } = stubFetcher({ before: [], after: [grant(300)] })
  const outcome = await checkInRaccoon(RACCOON, credential, fetcher)

  assert.equal(outcome.kind, 'claimed')
  assert.equal(outcome.credit, 300)
  // 连续天数上游不回报 → 报 0，不猜。
  assert.equal(outcome.streakDays, 0)

  // 顺序固定：先快照、再触发、再比对。
  assert.match(calls[0].url, /\/points\/v1\/bills/)
  assert.match(calls[1].url, /\/office\/v3\/setting_info/)
  assert.match(calls[2].url, /\/points\/v1\/bills/)

  // 桌面端头是发放的前提。
  assert.equal(calls[1].init.headers['X-Client-Platform'], RACCOON.clientPlatform)
  assert.equal(calls[1].init.method, 'GET')
})

test('签到：第二次调用无新增账单 ⇒ already-claimed，绝不报 0 积分', async () => {
  const same = grant(300)
  const { fetcher } = stubFetcher({ before: [same], after: [same] })
  const outcome = await checkInRaccoon(RACCOON, credential, fetcher)

  assert.equal(outcome.kind, 'already-claimed')
  assert.equal(outcome.message, '今日已签到')
  assert.equal('credit' in outcome, false)
})

test('签到：只统计当天新增，前一天与负积分/消费行不计入', async () => {
  const { fetcher } = stubFetcher({
    before: [],
    after: [
      grant(300),
      grant(500, { event_name: '连续签到奖励' }),
      // 昨天的不算（跨日重算会让今天的数字虚高）。
      { bill_id: 'old', points: 300, created_at: `${yesterdayKey()}T23:59:59`, biz_type: 'daily_grant' },
      // 消费/扣减不算（负积分）。
      { bill_id: 'spend', points: -120, created_at: `${todayKey()}T15:10:00`, biz_type: 'consume' },
    ],
  })
  const outcome = await checkInRaccoon(RACCOON, credential, fetcher)

  assert.equal(outcome.kind, 'claimed')
  assert.equal(outcome.credit, 800)
})

test('签到：setting_info 非 0 码 ⇒ failed 并带上游 code', async () => {
  const { fetcher } = stubFetcher({
    before: [],
    after: [grant(300)],
    settingInfo: json({ code: 40003, message: 'token invalid' }),
  })
  const outcome = await checkInRaccoon(RACCOON, credential, fetcher)

  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.code, 40003)
  assert.equal(outcome.message, 'token invalid')
})

test('签到：账单读不到时报 already-claimed，不编造金额', async () => {
  const { fetcher } = stubFetcher({ billsFail: true })
  const outcome = await checkInRaccoon(RACCOON, credential, fetcher)

  // 服务端按日幂等：明天照常再跑不会漏领，编一个数字反而误导。
  assert.equal(outcome.kind, 'already-claimed')
  assert.equal('credit' in outcome, false)
})
