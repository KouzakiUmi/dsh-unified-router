// Loomy onboarding 任务模式归属回归：
// `onboarding.claim` 对 Loomy 实际是「主动上报任务完成」（POST tasks/complete），
// 必须归 completeTasks（默认关闭，须显式开启）；Raccoon 是幂等登录奖励，留在
// claimRewards（默认开启）。本文件只依赖 lib 模块与 provider 声明，不触真实上游。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsTaskAdapters } from '../lib/settings-providers.js'
import { createAutomationSettings } from '../lib/automation-settings.js'
import { createAutoTasks } from '../lib/auto-tasks.js'
import { loomy } from '../src/client/providers/loomy.js'
import { raccoon } from '../src/client/providers/raccoon.js'

function loomyRaccoonAdapters(rpc) {
  return settingsTaskAdapters({ standalone: true, rpc })
}

test('settingsTaskAdapters：Loomy 归 completeTasks，Raccoon 保留 claimRewards', () => {
  const adapters = loomyRaccoonAdapters(async () => ({ accounts: [] }))
  const loomyAdapter = adapters.get('loomy')
  const raccoonAdapter = adapters.get('raccoon')

  assert.equal(typeof loomyAdapter?.completeTasks, 'function', 'Loomy 必须有 completeTasks')
  assert.equal(loomyAdapter?.claimRewards, undefined, 'Loomy 不得留在 claimRewards')
  assert.equal(typeof raccoonAdapter?.claimRewards, 'function', 'Raccoon 保留 claimRewards')
  assert.equal(raccoonAdapter?.completeTasks, undefined, 'Raccoon 不得归 completeTasks')

  // 两者都是账号级一次性事项：新手任务/登录奖励每号只发生一次。
  assert.equal(loomyAdapter?.doneScope, 'account')
  assert.equal(raccoonAdapter?.doneScope, 'account')

  // capabilities 投影完全由函数键推导：Loomy 只暴露任务执行，Raccoon 只暴露奖励领取。
  const tasks = createAutoTasks({ dir: join(tmpdir(), 'unused'), adapters, isEnabled: () => true })
  try {
    assert.deepEqual(tasks.capabilitiesOf('loomy'), { claimRewards: false, completeTasks: true })
    assert.deepEqual(tasks.capabilitiesOf('raccoon'), { claimRewards: true, completeTasks: false })
  } finally { tasks.dispose() }
})

test('verify*：只读走 onboarding.status，按任务键完成率给 done/pending/failed', async () => {
  const calls = []
  const adapters = loomyRaccoonAdapters(async (method, payload) => {
    calls.push([method, payload])
    if (method === 'onboarding.status') {
      if (payload.provider === 'loomy' && payload.accountId === 'full') {
        return { tasks: { a: true, b: true }, earned: 300, total: 300 }
      }
      if (payload.provider === 'loomy' && payload.accountId === 'half') {
        return { tasks: { a: true, b: false, c: false }, earned: 100, total: 300 }
      }
      if (payload.provider === 'raccoon') {
        return { tasks: { desktop_login_reward: payload.accountId === 'claimed' }, earned: payload.accountId === 'claimed' ? 3000 : 0, total: 3000 }
      }
      throw new Error('unknown account')
    }
    throw new Error('verify 不得触发写路径')
  })

  assert.deepEqual(await adapters.get('loomy').verifyCompleteTasks('full'),
    { kind: 'done', completed: 2, points: 300 }, '全部已达 → done + 已完成计数')
  assert.deepEqual(await adapters.get('loomy').verifyCompleteTasks('half'),
    { kind: 'pending', completed: 1, points: 100 }, '未达全部 → pending + 有证据的已完成计数')
  assert.deepEqual(await adapters.get('raccoon').verifyClaimRewards('claimed'), { kind: 'done', completed: 1, points: 3000 })
  assert.deepEqual(await adapters.get('raccoon').verifyClaimRewards('fresh'), { kind: 'pending', completed: 0, points: 0 })
  assert.equal((await adapters.get('loomy').verifyCompleteTasks('bad')).kind, 'failed', '状态查询失败 → failed')

  assert.ok(calls.every(([method]) => method === 'onboarding.status'), 'verify 只允许只读查询')
})

test('调度分组：Loomy 默认不会自动上报任务，显式开启后才执行；Raccoon 照常自动领取', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loomy-tasks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const settings = createAutomationSettings({ file: join(dir, 'automation.json'), allowedProviders: ['loomy', 'raccoon'] })
  const calls = []
  const rpc = async (method, payload) => {
    calls.push([method, payload])
    if (method === 'account.list') {
      return { accounts: [{ id: 'u1', provider: payload.provider, nickname: 'U1', enabled: true }] }
    }
    return { claimed: ['daily-check'], skipped: ['already'], earned: 300 }
  }
  const tasks = createAutoTasks({
    dir: join(dir, 'tasks'),
    adapters: loomyRaccoonAdapters(rpc),
    isEnabled: (provider, mode) => mode === 'completeTasks'
      ? settings.isAutoCompleteTasksEnabled(provider)
      : settings.isAutoClaimRewardsEnabled(provider),
    now: () => Date.parse('2026-11-20T06:00:00Z'),
  })
  try {
    await tasks.tick()
    const onboardingCalls = () => calls.filter(([method]) => method === 'onboarding.claim')
    assert.deepEqual(onboardingCalls(), [['onboarding.claim', { provider: 'raccoon', accountId: 'u1' }]],
      '默认状态下只许 Raccoon 领取，Loomy 不得自动上报任务')

    await settings.update({ provider: 'loomy', autoCompleteTasks: true })
    await tasks.tick()
    assert.deepEqual(onboardingCalls(), [
      ['onboarding.claim', { provider: 'raccoon', accountId: 'u1' }],
      ['onboarding.claim', { provider: 'loomy', accountId: 'u1' }],
    ], '显式开启 autoCompleteTasks 后 Loomy 才执行，且 Raccoon 不重复触发')
  } finally { tasks.dispose() }
})

test('Loomy completeTasks 结果映射：上报数计入 completed，积分沿用 earned', async () => {
  const adapters = loomyRaccoonAdapters(async (method, payload) => {
    if (method === 'account.list') return { accounts: [] }
    return { claimed: ['a', 'b'], skipped: ['c'], earned: 400 }
  })
  const outcome = await adapters.get('loomy').completeTasks('u1')
  assert.deepEqual(outcome, { kind: 'completed', completed: 2, points: 400 })

  const raccoonOutcome = await adapters.get('raccoon').claimRewards('u1')
  assert.deepEqual(raccoonOutcome, { kind: 'claimed', claimed: 2, points: 400 })
})

test('客户端 caps：Loomy 声明 completeTasks 与动作准确的按钮文案，Raccoon 保持领登录奖励', () => {
  assert.equal(loomy.caps.completeTasks, true, '快照到达前也要显示「自动完成任务」行')
  assert.equal(loomy.caps.onboarding, true, '手动入口保留')
  assert.equal(loomy.caps.rewardLabel, '完成新手任务', '按钮文案须描述实际动作：上报任务完成而非被动领取')
  assert.equal(loomy.caps.dailyReward, undefined, '每日签到领取不得被关掉')

  assert.equal(raccoon.caps.onboarding, true)
  assert.equal(raccoon.caps.rewardLabel, '领登录奖励', 'Raccoon 登录奖励仍是被动领取')
})
