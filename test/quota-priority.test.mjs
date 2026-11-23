import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQuotaAccountOrder, quotaPriorityProviders } from '../lib/quota-priority.js'

const now = Date.parse('2026-11-21T08:30:00+08:00')
const day = 24 * 60 * 60_000
const recent = now - 32_000
const entry = (accounts, fields) => ({ value: { accounts }, at: recent, ...fields })
const pack = (accountId, name, time = null, fields) => ({ accountId, updatedAt: recent,
  balance: { packages: [{ name, remaining: 42, active: true, expiresAt: time, ...fields }] } })
const managed = (id, name, resetsAt = null) => ({ id, signedIn: true, updatedAt: recent,
  windows: [{ name, balance: 20, resetsAt }] })

test('额度优先只重排已筛账号：每日、免费、临期；同档先到期、证据相同保留顺序', () => {
  let mode = 'manual', reads = 0
  const snapshot = entry([
    pack('permanent', '充值积分'), pack('gift', '注册礼包'), pack('daily', '每日积分'),
    pack('later', '指定额度', now + 2 * day), pack('sooner', '指定额度', now + day),
    pack('wrong-side', '每日积分', now + 60_000), pack('expired', '每日积分', now - 10),
    pack('empty', '每日积分', null, { remaining: 0 }), pack('inactive', '每日积分', null, { active: false }),
    { ...pack('old', '每日积分'), updatedAt: now - 180_001 }, { ...pack('bad', '每日积分'), error: 'failed' },
  ])
  const rank = createQuotaAccountOrder({ mode: () => mode, clock: () => now,
    read: key => { reads++; assert.equal(key, 'raccoon/credits.balances'); return snapshot } })
  const ids = ['permanent', 'gift', 'later', 'empty', 'inactive', 'old', 'daily', 'expired', 'sooner', 'bad']
  assert.equal(rank('raccoon', ids), ids)
  assert.equal(reads, 0)
  mode = 'expiring'
  assert.deepEqual(rank('raccoon', ids), ['daily', 'gift', 'sooner', 'later', 'permanent', 'empty', 'inactive', 'old', 'expired', 'bad'])
  assert.deepEqual(rank('raccoon', ['permanent']), ['permanent'])
  assert.equal(reads, 1, '单账号不读快照')
  // 免费额度优先：只有每日与免费赠送参与排序，计费额度（含临期）保持原顺序。
  mode = 'free'
  assert.deepEqual(rank('raccoon', ids), ['daily', 'gift', 'permanent', 'later', 'empty', 'inactive', 'old', 'expired', 'sooner', 'bad'])
})

test('Qoder 用实际截止时间；快照失败、未知或超过七天回到原顺序', () => {
  let snapshot = entry([pack('long', '专用包', now + day * 30), pack('soon', '专用包', now + day * 2)])
  const rank = createQuotaAccountOrder({ read: () => snapshot, mode: () => 'expiring', clock: () => now })
  const ids = ['long', 'soon']
  assert.deepEqual(rank('qodercn', ids), ['soon', 'long'])
  snapshot = { ...snapshot, stale: true }
  assert.equal(rank('qodercn', ids), ids)
  assert.equal(rank('workbuddy', ids), ids)
  assert.deepEqual(quotaPriorityProviders(false), ['astudio', 'codearts'])
  assert.equal(rank('doubaowork', ids), ids)
})

test('自管渠道分辨真实赠送余额与签到奖励文案，CodeArts 区分免费和非免费模型', () => {
  const snapshots = {
    'astudio/managed.snapshot': entry([managed('a', '购买积分', now + day), managed('b', '活动赠送积分', now + 10 * day)]),
    'codearts/managed.snapshot': entry([managed('b', '赠送积分包'), managed('a', '免费日额度')]),
  }
  const rank = createQuotaAccountOrder({ read: key => snapshots[key], mode: () => 'expiring', clock: () => now })
  assert.deepEqual(rank('astudio', ['a', 'b']), ['b', 'a'])
  assert.deepEqual(rank('codearts', ['b', 'a'], { model: { free: true } }), ['a', 'b'])
  assert.deepEqual(rank('codearts', ['a', 'b'], { model: { free: false } }), ['b', 'a'])
  // 免费模式同样只用赠送窗口排序（购买积分不参与）。
  const free = createQuotaAccountOrder({ read: key => snapshots[key], mode: () => 'free', clock: () => now })
  assert.deepEqual(free('astudio', ['a', 'b']), ['b', 'a'])
})

test('粘滞（缓存优先）：最近服务账号置顶；无记录、记录失效或不在候选时回手动顺序', () => {
  let last = null
  const rank = createQuotaAccountOrder({ read: () => null, mode: () => 'sticky', lastAccount: () => last })
  const ids = ['a', 'b', 'c']
  assert.equal(rank('raccoon', ids, { modelId: 'm' }), ids, '无记录保持原顺序')
  last = 'c'
  assert.deepEqual(rank('raccoon', ids, { modelId: 'm' }), ['c', 'a', 'b'])
  assert.deepEqual(rank('raccoon', ['a', 'b'], { modelId: 'm' }), ['a', 'b'], '记录不在候选里时忽略')
  assert.equal(rank('raccoon', ids), ids, '缺 modelId 不做粘滞')
  last = 'a'
  assert.deepEqual(rank('raccoon', ids, { modelId: 'm' }), ['a', 'b', 'c'])
  // manual 模式不读记录。
  const manual = createQuotaAccountOrder({ read: () => null, mode: () => 'manual', lastAccount: () => 'c' })
  assert.equal(manual('raccoon', ids, { modelId: 'm' }), ids)
})

test('跨日不拿昨晚缓存的每日额度排序', () => {
  const midnight = Date.parse('2026-11-22T00:00:10+08:00')
  const snapshot = entry([{ ...pack('daily', '每日积分'), updatedAt: midnight - 20_000 }], { at: midnight - 20_000 })
  const rank = createQuotaAccountOrder({ read: () => snapshot, mode: () => 'expiring', clock: () => midnight })
  assert.deepEqual(rank('raccoon', ['other', 'daily']), ['other', 'daily'])
})
