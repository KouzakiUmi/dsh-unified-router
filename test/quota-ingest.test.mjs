// 向 subusage 推送额度（ingest 被动接入）的载荷构造。
// 契约见 dsh-subusage 的 docs/ingest-handoff.md。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuotaIngestPayload, quotaIngestResourceKeys, QUOTA_INGEST_SOURCE } from '../lib/quota-ingest.js'

const NOW = Date.parse('2026-11-27T10:00:00Z')

// 输出 id 用稳定短哈希（原始账号/窗口名可能很长或含敏感串），断言按前缀取。
const pick = (payload, prefix) => payload.quotas.find(quota => quota.id.startsWith(prefix))

test('账号池渠道：balance.total 变成 amount 元素（积分 → credit）', () => {
  const payload = buildQuotaIngestPayload({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'trae-1', nickname: '账号一', balance: { total: 2196.998, packages: [] } },
    ] } },
  }, { now: () => NOW })
  assert.equal(payload.source, QUOTA_INGEST_SOURCE)
  assert.equal(payload.state, 'ok')
  assert.equal(payload.ttlMs, 600000)
  assert.equal(payload.receivedAt, NOW)
  const [quota] = payload.quotas
  assert.equal(quota.type, 'amount')
  assert.equal(quota.role, 'balance')
  assert.equal(quota.label, '账号一')
  assert.equal(quota.amount.value, 2196.998)
  assert.equal(quota.amount.unitKind, 'credit')
  assert.match(quota.id, /^unified-router:trae:[0-9a-z]+$/)
})

test('自管渠道：balance 数字 + 渠道单位', () => {
  const payload = buildQuotaIngestPayload({
    'codearts/managed.snapshot': { value: { accounts: [
      { id: 'codearts-1', name: 'CodeArts 账号', balance: 3264.75, unit: '积分' },
    ] } },
  }, { now: () => NOW })
  const [quota] = payload.quotas
  assert.equal(quota.amount.value, 3264.75)
  assert.equal(quota.amount.unit, '积分')
  assert.equal(quota.amount.unitKind, 'credit')
})

test('WorkBuddy：额度窗口变成 window 元素（used/limit → percent）', () => {
  const payload = buildQuotaIngestPayload({
    'workbuddy/workbuddy.snapshot': { value: { accounts: [
      { id: 'workbuddy-1', name: 'WB', windows: [
        { name: 'Credits', used: 31.13, limit: 500, resetsAt: '2026-11-30T15:59:59.000Z' },
      ] },
    ] } },
  }, { now: () => NOW })
  const [quota] = payload.quotas
  assert.equal(quota.type, 'window')
  assert.equal(quota.percent, 6.2)
  assert.equal(quota.resetsAt, '2026-11-30T15:59:59.000Z')
})

test('没有可用额度时如实报 error，不伪造空列表成功', () => {
  const payload = buildQuotaIngestPayload({}, { now: () => NOW })
  assert.equal(payload.state, 'error')
  assert.ok(payload.error)
  assert.deepEqual(payload.quotas, [])
})

test('非法数值（NaN / Infinity / 字符串 / 负数）一律不收', () => {
  const payload = buildQuotaIngestPayload({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'a', nickname: 'A', balance: { total: Number.NaN } },
      { accountId: 'b', nickname: 'B', balance: { total: -1 } },
      { accountId: 'c', nickname: 'C', balance: { total: '12' } },
      { accountId: 'd', nickname: 'D', balance: {} },
    ] } },
  }, { now: () => NOW })
  assert.equal(payload.state, 'error')
})

test('资源键由渠道规格表派生（账号池 / 自管 / WorkBuddy）', () => {
  const keys = quotaIngestResourceKeys()
  assert.ok(keys.includes('trae/credits.balances'))
  assert.ok(keys.includes('astudio/managed.snapshot'))
  assert.ok(keys.includes('workbuddy/workbuddy.snapshot'))
  assert.ok(keys.includes('qianfan/apikey.snapshot'))
  assert.equal(new Set(keys).size, keys.length, '不应重复')
})

test('API Key 渠道：quota.windows 折算百分比，*-percent 直接用 used', () => {
  const payload = buildQuotaIngestPayload({
    'qianfan/apikey.snapshot': { value: {
      quota: { status: 'ready', balance: null, updatedAt: NOW, windows: [
        { id: 'monthly-credits', used: 8661.32, limit: 22000, remaining: 13338.68, resetInMs: 2413997701 },
      ] },
      balance: null,
    } },
    'bailian/apikey.snapshot': { value: {
      quota: { status: 'ready', windows: [{ id: 'monthly-percent', used: 39.4, limit: 100, remaining: 60.6 }] },
      balance: null,
    } },
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'needs-console' },
      balance: { used: 0, limit: null, unlimited: true, unit: 'USD' },
    } },
  }, { now: () => NOW })
  const byId = new Map(payload.quotas.map(quota => [quota.id, quota]))
  const credits = pick(payload, 'unified-router:qianfan:window:')
  assert.ok(credits, 'qianfan 月额度应出现')
  assert.equal(credits.percent, 39.4)
  // 重置时间由**数据时间**（quota.updatedAt）+ resetInMs 推出，不再随推送时刻后移。
  assert.equal(credits.resetsAt, new Date(NOW + 2413997701).toISOString())
  assert.equal(pick(payload, 'unified-router:bailian:window:').percent, 39.4)
  assert.equal(pick(payload, 'unified-router:agnes:window:'), undefined, 'needs-console 不产出条目')
})

test('API Key 渠道：控制台余额 → amount；赠品额度 → window', () => {
  const payload = buildQuotaIngestPayload({
    'unisound/apikey.snapshot': { value: {
      quota: { status: 'ready', balance: 12.5, windows: [], gifts: [
        { modelId: 'u2-ocr', used: 30616, limit: 29500000, remaining: 2946938, unit: '积分' },
      ] },
      balance: null,
    } },
  }, { now: () => NOW })
  const byId = new Map(payload.quotas.map(quota => [quota.id, quota]))
  assert.equal(byId.get('unified-router:unisound:balance').amount.value, 12.5)
  assert.equal(pick(payload, 'unified-router:unisound:gift:').type, 'window')
})

test('receivedAt 取保留项里最旧的数据时间（新快照不能把旧数据洗成 fresh）', () => {
  const payload = buildQuotaIngestPayload({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'trae-old', nickname: '旧', balance: { total: 10 }, updatedAt: NOW - 3600_000 },
      { accountId: 'trae-new', nickname: '新', balance: { total: 20 }, updatedAt: NOW },
    ] } },
  }, { now: () => NOW })
  assert.equal(payload.receivedAt, NOW - 3600_000)
})

test('控制台余额 0 优先于 API 余额，且不借 API 的 USD 单位', () => {
  const payload = buildQuotaIngestPayload({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'ready', balance: 0, windows: [], updatedAt: NOW },
      balance: { used: 12, limit: 12, unlimited: false, unit: 'USD', updatedAt: NOW },
    } },
  }, { now: () => NOW })
  const balance = payload.quotas.find(quota => quota.id === 'unified-router:agnes:balance')
  assert.ok(balance)
  assert.equal(balance.amount.value, 0, '控制台明确 0 要如实报')
  assert.equal(balance.amount.unit, undefined, '控制台投影没有单位字段，不能借 USD')
})

test('quota 非 ready 时仍报 API 余额', () => {
  const payload = buildQuotaIngestPayload({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'needs-console' },
      balance: { used: 4, limit: 10, unlimited: false, unit: 'USD', updatedAt: NOW },
    } },
  }, { now: () => NOW })
  const balance = payload.quotas.find(quota => quota.id === 'unified-router:agnes:balance')
  assert.equal(balance?.amount.value, 6)
})

test('窗口只给 remaining 时按 limit - remaining 折算', () => {
  const payload = buildQuotaIngestPayload({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'ready', updatedAt: NOW, windows: [{ id: 'monthly-credits', used: null, limit: 10, remaining: 5 }] },
      balance: null,
    } },
  }, { now: () => NOW })
  assert.equal(payload.quotas[0].percent, 50)
})

test('商汤池窗口用绝对 resetAt 与真实周期（5h / 7d）', () => {
  const payload = buildQuotaIngestPayload({
    'sensenova-token-plan/plan.snapshot': { value: {
      updatedAt: NOW,
      quota: { status: 'ready', plan: 'Free Plan', updatedAt: NOW, pools: [
        { name: '通用积分池', window5h: { limit: 120000, remaining: 60000, resetAt: 1795784382 },
          window7d: { limit: 1200000, remaining: 1200000, resetAt: 1796169582 }, grantBalance: 0 },
      ] },
    } },
  }, { now: () => NOW })
  const byId = new Map(payload.quotas.map(quota => [quota.id, quota]))
  const five = pick(payload, 'unified-router:sensenova-token-plan:window5h:')
  assert.equal(five.period, '5h')
  assert.equal(five.percent, 50)
  assert.equal(five.resetsAt, new Date(1795784382 * 1000).toISOString())
  assert.equal(pick(payload, 'unified-router:sensenova-token-plan:window7d:').period, '7d')
})

test('超过 56 条时截断报 partial，且 amount 优先保留', () => {
  const windows = Array.from({ length: 60 }, (_, index) => ({ id: `w-${index}`, used: 1, limit: 10 }))
  const payload = buildQuotaIngestPayload({
    'trae/credits.balances': { value: { accounts: [{ accountId: 't1', nickname: 'T', balance: { total: 5 } }] } },
    'agnes/apikey.snapshot': { value: { quota: { status: 'ready', updatedAt: NOW, windows }, balance: null } },
  }, { now: () => NOW })
  assert.equal(payload.quotas.length, 56)
  assert.equal(payload.coverage, 'partial')
  assert.ok(payload.quotas.some(quota => quota.type === 'amount'), '余额不能被窗口挤掉')
})