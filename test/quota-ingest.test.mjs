// 向 subusage 推送额度（ingest 被动接入）的载荷构造。
// 契约见 dsh-subusage 的 docs/ingest-handoff.md 与 lib/ingest.js。
// 关键口径：**按渠道拆源**（一渠道一张卡，卡标题 = 渠道名），条目才是账号名。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuotaIngestPayloads, emptyQuotaIngestSources, quotaIngestResourceKeys } from '../lib/quota-ingest.js'

const NOW = Date.parse('2026-11-27T10:00:00Z')
const build = resources => buildQuotaIngestPayloads(resources, { now: () => NOW })
const card = (resources, source) => build(resources).find(payload => payload.source === source)

test('账号池渠道：一张卡一个渠道，balance.total 变成 amount 元素', () => {
  const payload = card({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'trae-1', nickname: '账号一', balance: { total: 2196.998, packages: [] } },
    ] } },
  }, 'unified-router-trae')
  assert.ok(payload, '应生成 TRAE 卡')
  assert.equal(payload.label, 'TRAE')
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

test('按渠道拆源：不同渠道各自成卡，不混在一张卡里', () => {
  const payloads = build({
    'trae/credits.balances': { value: { accounts: [{ accountId: 't1', nickname: 'T', balance: { total: 1 } }] } },
    'codearts/managed.snapshot': { value: { accounts: [{ id: 'c1', name: 'C', balance: 2, unit: '积分' }] } },
  })
  assert.deepEqual(payloads.map(payload => payload.source).sort(), ['unified-router-codearts', 'unified-router-trae'])
  const trae = payloads.find(payload => payload.source === 'unified-router-trae')
  assert.equal(trae.label, 'TRAE')
  assert.equal(trae.quotas.length, 1)
})

test('自管渠道：balance 数字 + 渠道单位', () => {
  const payload = card({
    'codearts/managed.snapshot': { value: { accounts: [
      { id: 'codearts-1', name: 'CodeArts 账号', balance: 3264.75, unit: '积分' },
    ] } },
  }, 'unified-router-codearts')
  const [quota] = payload.quotas
  assert.equal(quota.amount.value, 3264.75)
  assert.equal(quota.amount.unit, '积分')
  assert.equal(quota.amount.unitKind, 'credit')
})

test('WorkBuddy：used 已是百分比，缺失时按绝对已用量换算', () => {
  const payload = card({
    'workbuddy/workbuddy.snapshot': { value: { accounts: [
      { id: 'workbuddy-1', name: 'WB', windows: [
        { name: 'Total credits', used: 51, amount: 510, limit: 1000, resetsAt: '2026-11-30T15:59:59.000Z' },
        { name: 'Tokens', used: null, amount: 31.13, limit: 500 },
        { name: 'Percent only', used: 100, limit: null },
      ] },
    ] } },
  }, 'unified-router-workbuddy')
  const [quota] = payload.quotas
  assert.equal(quota.type, 'window')
  assert.equal(quota.percent, 51)
  assert.equal(payload.quotas[1].percent, 6.2)
  assert.equal(payload.quotas[2].status, 'rate-limited')
  assert.equal(quota.resetsAt, '2026-11-30T15:59:59.000Z')
  assert.equal(quota.poolScope, 'independent')
})

test('没有可用额度时不产出卡（不伪造空成功）', () => {
  assert.deepEqual(build({}), [])
})

test('只撤回明确没有账号的渠道，查询失败或没有快照时保留旧卡', () => {
  const resources = {
    'codearts/managed.snapshot': { value: { accounts: [] }, at: NOW },
    'astudio/managed.snapshot': { value: { accounts: [] }, stale: true, at: NOW },
    'workbuddy/workbuddy.snapshot': { value: { accounts: [] }, at: NOW },
    'trae/credits.balances': null,
  }
  assert.deepEqual(build(resources), [])
  assert.deepEqual(emptyQuotaIngestSources(resources), ['unified-router-codearts'])
  resources['workbuddy/workbuddy.snapshot'].value.accountsEmptyConfirmed = true
  assert.deepEqual(emptyQuotaIngestSources(resources).sort(), ['unified-router-codearts', 'unified-router-workbuddy'])
})

test('非法数值（NaN / Infinity / 字符串 / 负数）一律不收', () => {
  const payloads = build({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'a', nickname: 'A', balance: { total: Number.NaN } },
      { accountId: 'b', nickname: 'B', balance: { total: -1 } },
      { accountId: 'c', nickname: 'C', balance: { total: '12' } },
    ] } },
  })
  assert.deepEqual(payloads, [])
})

test('资源键由渠道规格表派生（账号池 / 商汤 / 自管 / API Key / WorkBuddy）', () => {
  const keys = quotaIngestResourceKeys()
  for (const key of ['trae/credits.balances', 'sensenova-token-plan/plan.snapshot',
    'astudio/managed.snapshot', 'qianfan/apikey.snapshot', 'workbuddy/workbuddy.snapshot']) {
    assert.ok(keys.includes(key), `缺少 ${key}`)
  }
  assert.equal(new Set(keys).size, keys.length, '不应重复')
})

test('API Key 渠道：quota.windows 折算百分比，*-percent 直接用 used', () => {
  const payloads = build({
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
  })
  const qianfan = payloads.find(payload => payload.source === 'unified-router-qianfan')
  const credits = qianfan.quotas[0]
  assert.equal(credits.percent, 39.4)
  // 重置时间由数据时间（quota.updatedAt）+ resetInMs 推出，不随推送时刻后移。
  assert.equal(credits.resetsAt, new Date(NOW + 2413997701).toISOString())
  const bailian = payloads.find(payload => payload.source === 'unified-router-bailian')
  assert.equal(bailian.quotas[0].percent, 39.4)
  // needs-console + 无限额度 → 无条目，接收端会整条拒收，故不产出该卡。
  assert.equal(payloads.some(payload => payload.source === 'unified-router-agnes'), false)
})

test('控制台余额 0 优先于 API 余额，且不借 API 的 USD 单位', () => {
  const payload = card({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'ready', balance: 0, windows: [], updatedAt: NOW },
      balance: { used: 12, limit: 12, unlimited: false, unit: 'USD', updatedAt: NOW },
    } },
  }, 'unified-router-agnes')
  const balance = payload.quotas.find(quota => quota.type === 'amount')
  assert.ok(balance)
  assert.equal(balance.amount.value, 0, '控制台明确 0 要如实报')
  assert.equal(balance.amount.unit, undefined, '控制台投影没有单位字段，不能借 USD')
})

test('quota 非 ready 时仍报 API 余额', () => {
  const payload = card({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'needs-console' },
      balance: { used: 4, limit: 10, unlimited: false, unit: 'USD', updatedAt: NOW },
    } },
  }, 'unified-router-agnes')
  assert.equal(payload.quotas.find(quota => quota.type === 'amount')?.amount.value, 6)
})

test('窗口只给 remaining 时按 limit - remaining 折算', () => {
  const payload = card({
    'agnes/apikey.snapshot': { value: {
      quota: { status: 'ready', updatedAt: NOW, windows: [{ id: 'monthly-credits', used: null, limit: 10, remaining: 5 }] },
      balance: null,
    } },
  }, 'unified-router-agnes')
  assert.equal(payload.quotas[0].percent, 50)
})

test('商汤池窗口用绝对 resetAt 与真实周期（5h / 7d）', () => {
  const payload = card({
    'sensenova-token-plan/plan.snapshot': { value: {
      updatedAt: NOW,
      quota: { status: 'ready', plan: 'Free Plan', updatedAt: NOW, pools: [
        { name: '通用积分池', window5h: { limit: 120000, remaining: 60000, resetAt: 1795784382 },
          window7d: { limit: 1200000, remaining: 1200000, resetAt: 1796169582 }, grantBalance: 0 },
      ] },
    } },
  }, 'unified-router-sensenova-token-plan')
  const five = payload.quotas.find(quota => quota.id.includes(':window5h:'))
  assert.equal(five.period, '5h')
  assert.equal(five.percent, 50)
  assert.equal(five.resetsAt, new Date(1795784382 * 1000).toISOString())
  assert.equal(payload.quotas.find(quota => quota.id.includes(':window7d:')).period, '7d')
  assert.equal(payload.quotas.find(quota => quota.type === 'plan').value, 'Free Plan')
})

test('按接收端分别限制 16 个窗口和 40 个其他元素，截断标 partial', () => {
  const windows = Array.from({ length: 60 }, (_, index) => ({ id: `w-${index}`, used: 1, limit: 10 }))
  const payloads = build({
    'trae/credits.balances': { value: { accounts: Array.from({ length: 41 }, (_, i) => ({ accountId: `t${i}`, balance: { total: 5 }, updatedAt: i === 40 ? NOW - 1000 : NOW })) } },
    'agnes/apikey.snapshot': { value: { quota: { status: 'ready', updatedAt: NOW, windows, balance: 5 }, balance: null } },
  })
  const agnes = payloads.find(payload => payload.source === 'unified-router-agnes')
  assert.equal(agnes.quotas.filter(quota => quota.type === 'window').length, 16)
  assert.equal(agnes.quotas[0].type, 'amount')
  assert.equal(agnes.coverage, 'partial')
  const trae = payloads.find(payload => payload.source === 'unified-router-trae')
  assert.equal(trae.quotas.length, 40)
  assert.equal(trae.coverage, 'partial')
  assert.equal(trae.receivedAt, NOW, '被截断项的数据时间不影响已推送结果')
})

test('receivedAt 取保留项里最旧的数据时间（新快照不能把旧数据洗成 fresh）', () => {
  const payload = card({
    'trae/credits.balances': { value: { accounts: [
      { accountId: 'trae-old', nickname: '旧', balance: { total: 10 }, updatedAt: NOW - 3600_000 },
      { accountId: 'trae-new', nickname: '新', balance: { total: 20 }, updatedAt: NOW },
    ] } },
  }, 'unified-router-trae')
  assert.equal(payload.receivedAt, NOW - 3600_000)
})

test('账号级 error 与目录失败报 partial；needs-console 不算', () => {
  const failed = card({
    'workbuddy/workbuddy.snapshot': { value: { accounts: [
      { id: 'wb-1', name: 'WB', error: 'auth_error', windows: [{ name: 'Credits', used: 1, limit: 10 }] },
    ] } },
  }, 'unified-router-workbuddy')
  assert.equal(failed.coverage, 'partial')
  const consoleMissing = card({
    'qianfan/apikey.snapshot': { value: { quota: { status: 'needs-console' }, balance: null } },
  }, 'unified-router-qianfan')
  assert.equal(consoleMissing, undefined, '无条目时不产出卡（接收端会拒收空载荷）')
})