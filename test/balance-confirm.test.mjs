// 「额度增长即确认」：签到与自动化任务在上游核实给不出 done 证据时，
// 用「当前额度 > 提交前基线」作为到账证据，落 .confirmed 观察票据。
// 铁律不变：主记录（含 pending 预留）绝不覆盖、绝不重放。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDailyCheckin } from '../lib/daily-checkin.js'
import { createAutoTasks } from '../lib/auto-tasks.js'

const sha = id => createHash('sha256').update(id).digest('hex')
const NOW = Date.parse('2026-11-20T02:00:00Z')

async function seed(dir, relative, id, record) {
  const folder = join(dir, ...relative)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, sha(id)), JSON.stringify(record))
  return join(folder, sha(id))
}

test('签到：额度增长即确认（pending + 基线 → .confirmed 票据，主记录不被覆盖）', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-checkin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const main = await seed(dir, ['astudio', '2026-11-20'], 'a1', { id: 'a1', outcome: { kind: 'pending' }, baseline: 120 })
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', {
      resetHour: 0,
      list: async () => [{ id: 'a1', name: 'A1' }],
      claim: async () => { throw new Error('不应提交') },
      async verify() { return { kind: 'pending', unsubmitted: true } },
    }]]),
    now: () => NOW,
    readBalance: async () => 220,
  })
  try {
    const rows = await checkin.query('astudio')
    assert.equal(rows[0].outcome.kind, 'claimed')
    assert.equal(rows[0].outcome.credit, 100)
    assert.equal(rows[0].verified, true)
    // 账本契约：主记录原样保留，核实事实只写 .confirmed 观察票据
    assert.equal(JSON.parse(await readFile(main, 'utf8')).outcome.kind, 'pending', '核实不覆盖预留')
    const confirmed = JSON.parse(await readFile(main + '.confirmed', 'utf8'))
    assert.equal(confirmed.outcome.kind, 'claimed')
    assert.equal(confirmed.outcome.credit, 100)
    // 状态页经票据如实显示已确认，并带本次到账量
    const row = (await checkin.status()).providers.astudio.accounts.find(item => item.accountId === 'a1')
    assert.equal(row.kind, 'claimed')
    assert.equal(row.credit, 100)
  } finally { checkin.dispose() }
})

test('签到：额度未增长 / 无基线 / 无额度通道时一律保持 pending', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-checkin-neg-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await seed(dir, ['astudio', '2026-11-20'], 'flat', { id: 'flat', outcome: { kind: 'pending' }, baseline: 120 })
  await seed(dir, ['astudio', '2026-11-20'], 'nobase', { id: 'nobase', outcome: { kind: 'pending' } })
  const adapter = {
    resetHour: 0,
    list: async () => [{ id: 'flat', name: 'F' }, { id: 'nobase', name: 'N' }],
    claim: async () => { throw new Error('不应提交') },
    async verify() { return { kind: 'pending', unsubmitted: true } },
  }
  const make = readBalance => createDailyCheckin({
    dir, adapters: new Map([['astudio', adapter]]), now: () => NOW, readBalance,
  })
  try {
    // 额度没变（120 → 120）：不是到账证据
    const flat = await make(async () => 120)
    const flatRow = (await flat.query('astudio', 'flat'))[0]
    assert.equal(flatRow.outcome.kind, 'pending')
    assert.equal(flatRow.verified, true, '上游明确未达成 → verified，但额度无增长不确认')
    flat.dispose()

    // 无基线（旧记录/读取失败）：即使有增长也不确认
    const nobase = await make(async () => 999)
    const nobaseRow = (await nobase.query('astudio', 'nobase'))[0]
    assert.equal(nobaseRow.outcome.kind, 'pending')
    nobase.dispose()

    // 没有额度通道：保持账本现状
    const none = await make(undefined)
    const noneRow = (await none.query('astudio', 'flat'))[0]
    assert.equal(noneRow.outcome.kind, 'pending')
    none.dispose()
  } finally { /* 三个实例已在上面分别 dispose */ }
})

test('签到：提交时写入额度基线，终态改写仍保留基线', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-checkin-base-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', {
      resetHour: 0,
      list: async () => [{ id: 'a1', name: 'A1' }],
      claim: async () => ({ kind: 'pending' }),
    }]]),
    now: () => NOW,
    readBalance: async () => 120,
  })
  try {
    const rows = await checkin.claim('astudio')
    assert.equal(rows[0].outcome.kind, 'pending')
    const record = JSON.parse(await readFile(join(dir, 'astudio', '2026-11-20', sha('a1')), 'utf8'))
    assert.equal(record.baseline, 120, '基线随主记录落盘，供后续核实比对')
  } finally { checkin.dispose() }
})

test('签到：自动调度对 pending 行只读核实，额度增长后落确认票据', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-checkin-tick-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const main = await seed(dir, ['astudio', '2026-11-20'], 'a1', { id: 'a1', outcome: { kind: 'pending' }, baseline: 120 })
  const checkin = createDailyCheckin({
    dir,
    adapters: new Map([['astudio', {
      resetHour: 0,
      list: async () => [{ id: 'a1', name: 'A1' }],
      claim: async () => ({ kind: 'pending' }),
      async verify() { return { kind: 'pending', unsubmitted: true } },
    }]]),
    now: () => NOW,
    readBalance: async () => 260,
  })
  try {
    await checkin.tick()
    const confirmed = JSON.parse(await readFile(main + '.confirmed', 'utf8'))
    assert.equal(confirmed.outcome.kind, 'claimed')
    assert.equal(confirmed.outcome.credit, 140)
  } finally { checkin.dispose() }
})

test('领取奖励：额度增长即确认（claimed + points，主记录不被覆盖）', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-tasks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const main = await seed(dir, ['astudio', 'claimRewards', '2026-11-20'], 'a1', {
    id: 'a1', outcome: { kind: 'pending' }, baseline: 400,
  })
  const changes = []
  const tasks = createAutoTasks({
    dir,
    adapters: new Map([['astudio', {
      resetHour: 0,
      list: async () => [{ id: 'a1', name: 'A1' }],
      claimRewards: async () => { throw new Error('不应提交') },
      verifyClaimRewards: async () => ({ kind: 'pending' }),
    }]]),
    now: () => NOW,
    readBalance: async () => 500,
    onChange: (provider, mode, outcome) => { changes.push([provider, mode, outcome.kind]) },
  })
  try {
    await tasks.tick()
    assert.deepEqual(changes, [['astudio', 'claimRewards', 'claimed']], '自动核实也应通知刷新')
    const rows = await tasks.query('astudio', 'claimRewards')
    assert.equal(changes.length, 1, '再次查询不重复通知已确认记录')
    assert.deepEqual(rows[0].outcome, { kind: 'claimed', claimed: 1, points: 100 })
    assert.equal(JSON.parse(await readFile(main, 'utf8')).outcome.kind, 'pending', '核实不覆盖预留')
    const confirmed = JSON.parse(await readFile(main + '.confirmed', 'utf8'))
    assert.equal(confirmed.outcome.points, 100)
  } finally { tasks.dispose() }
})

test('完成任务：额度增长即确认（completed + points）', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-tasks-done-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const main = await seed(dir, ['codearts', 'completeTasks', '2026-11-20'], 'c1', {
    id: 'c1', outcome: { kind: 'pending' }, baseline: 50,
  })
  const tasks = createAutoTasks({
    dir,
    adapters: new Map([['codearts', {
      resetHour: 0,
      list: async () => [{ id: 'c1', name: 'C1' }],
      completeTasks: async () => { throw new Error('不应提交') },
    }]]),
    now: () => NOW,
    readBalance: async () => 80,
  })
  try {
    // 无 verify 通道：额度增长也能确认
    const rows = await tasks.query('codearts', 'completeTasks')
    assert.equal(rows[0].outcome.kind, 'completed')
    assert.equal(rows[0].outcome.completed, 1)
    assert.equal(rows[0].outcome.points, 30)
    assert.equal(JSON.parse(await readFile(main, 'utf8')).outcome.kind, 'pending')
  } finally { tasks.dispose() }
})

test('额度异常（非有限数 / 超上限 / 负数）不作为到账证据', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'balance-tasks-edge-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // 上限是「增量」上限：1_000_101 - 100 = 1_000_001 恰好越界。
  const values = [Number.NaN, Infinity, 1_000_101, -5]
  for (const [index, value] of values.entries()) {
    const id = `e${index}`
    await seed(dir, ['astudio', 'claimRewards', '2026-11-20'], id, {
      id, outcome: { kind: 'pending' }, baseline: 100,
    })
    const tasks = createAutoTasks({
      dir,
      adapters: new Map([['astudio', {
        resetHour: 0,
        list: async () => [{ id, name: id }],
        claimRewards: async () => { throw new Error('不应提交') },
      }]]),
      now: () => NOW,
      readBalance: async () => value,
    })
    try {
      const rows = await tasks.query('astudio', 'claimRewards', id)
      assert.equal(rows[0].outcome.kind, 'pending', `额度 ${String(value)} 不应确认`)
    } finally { tasks.dispose() }
  }
})