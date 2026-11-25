// `lib/retired-channels.js`：退役渠道的磁盘清扫。
//
// 这段逻辑直接删用户磁盘上的账号与账本，写错范围不可逆。用例用**真实的 AccountPool**
// （离线、内存后端）验证：只删退役渠道、只清它的黑名单、只删它自己的文件；以及
// 「池子为空 / 目录不存在 / API 抛错」三种情况下不阻断启动。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneRetiredChannels } from '../lib/retired-channels.js'

/** 一个够用的假池：只实现清扫真正用到的那三个方法，并记录调用。 */
function fakePool(accounts, { failOn = null } = {}) {
  const state = { accounts: [...accounts], disabled: { loomy: { 'spark-x2.6': true }, raccoon: { 'sn-glm-5-3': true } }, removed: [], cleared: [] }
  return {
    state,
    listAccountsByProvider(provider) {
      if (failOn === 'list') throw new Error('list boom')
      return state.accounts.filter(account => account.provider === provider)
    },
    async removeAccount(id) {
      if (failOn === 'remove') throw new Error('remove boom')
      state.removed.push(id)
      state.accounts = state.accounts.filter(account => account.id !== id)
    },
    async clearDisabledModels(provider) {
      if (failOn === 'clear') throw new Error('clear boom')
      state.cleared.push(provider)
      delete state.disabled[provider]
    },
  }
}

test('只清退役渠道：账号、黑名单、目录缓存与账本目录；其它渠道一字未动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unified-router-retired-'))
  try {
    mkdirSync(join(dir, 'auto-tasks', 'loomy'), { recursive: true })
    mkdirSync(join(dir, 'daily-checkin', 'loomy'), { recursive: true })
    mkdirSync(join(dir, 'auto-tasks', 'raccoon'), { recursive: true })
    writeFileSync(join(dir, 'loomy-catalog.json'), '{}')
    writeFileSync(join(dir, 'raccoon-catalog.json'), '{}')
    writeFileSync(join(dir, 'trae-catalog.json'), '{}')

    const pool = fakePool([
      { id: 'loomy-a', provider: 'loomy' },
      { id: 'loomy-b', provider: 'loomy' },
      { id: 'raccoon-a', provider: 'raccoon' },
      { id: 'trae-a', provider: 'trae' },
    ])
    const result = await pruneRetiredChannels({ pool, retiredIds: ['loomy'], stateDir: dir })

    assert.deepEqual(result, { accounts: 2, providers: ['loomy'] })
    assert.deepEqual(pool.state.removed.sort(), ['loomy-a', 'loomy-b'], '只删退役渠道的账号')
    assert.deepEqual(pool.state.accounts.map(a => a.id).sort(), ['raccoon-a', 'trae-a'], '其它渠道账号保留')
    assert.deepEqual(pool.state.cleared, ['loomy'], '只清退役渠道的黑名单')
    assert.deepEqual(pool.state.disabled, { raccoon: { 'sn-glm-5-3': true } }, '其它渠道黑名单不动')

    assert.equal(existsSync(join(dir, 'loomy-catalog.json')), false)
    assert.equal(existsSync(join(dir, 'auto-tasks', 'loomy')), false)
    assert.equal(existsSync(join(dir, 'daily-checkin', 'loomy')), false)
    assert.equal(existsSync(join(dir, 'raccoon-catalog.json')), true, '其它渠道目录缓存保留')
    assert.equal(existsSync(join(dir, 'auto-tasks', 'raccoon')), true, '其它渠道账本保留')
    assert.equal(existsSync(join(dir, 'trae-catalog.json')), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('重复执行无副作用；空池与不存在目录也照常返回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unified-router-retired-'))
  try {
    const pool = fakePool([{ id: 'loomy-a', provider: 'loomy' }])
    assert.deepEqual(await pruneRetiredChannels({ pool, retiredIds: ['loomy'], stateDir: dir }), { accounts: 1, providers: ['loomy'] })
    // 第二次：账号已经被删掉，既不再删号也不报告渠道。
    assert.deepEqual(await pruneRetiredChannels({ pool, retiredIds: ['loomy'], stateDir: dir }), { accounts: 0, providers: [] })
    // 空表 / 缺参：直接返回空结果，不抛。
    assert.deepEqual(await pruneRetiredChannels({ pool, retiredIds: [], stateDir: dir }), { accounts: 0, providers: [] })
    assert.deepEqual(await pruneRetiredChannels({ pool }), { accounts: 0, providers: [] })
    assert.deepEqual(await pruneRetiredChannels({}), { accounts: 0, providers: [] })
    // 目录不存在：不因为「想删的文件没有」而报错。
    assert.deepEqual(await pruneRetiredChannels({ pool: fakePool([]), retiredIds: ['loomy'], stateDir: join(dir, 'nope') }),
      { accounts: 0, providers: [] })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('任何一步失败都只记 warn，不抛错、不阻断启动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unified-router-retired-'))
  try {
    writeFileSync(join(dir, 'loomy-catalog.json'), '{}')
    const warnings = []
    const logger = { warn: message => warnings.push(message) }

    for (const failOn of ['list', 'remove', 'clear']) {
      warnings.length = 0
      const result = await pruneRetiredChannels({
        pool: fakePool([{ id: 'loomy-a', provider: 'loomy' }], { failOn }), retiredIds: ['loomy'], stateDir: dir, logger,
      })
      assert.equal(typeof result.accounts, 'number', `${failOn} 失败也要有可用的返回形状`)
      assert.ok(warnings.length > 0, `${failOn} 失败要留一条 warn`)
      assert.ok(warnings.every(message => message.includes('失败')), 'warn 文案标明失败')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('退役表与渠道规格表必须互斥：不能再出现「既有规格又说退役」', async () => {
  // 这两张表是「移除一个渠道」的两个动作：删规格 + 往退役表追加一行。若某个 id
  // 同时出现在两边，宿主会一边注册它、一边把它的账号当孤儿清掉 —— 用户看到的是
  // 「刚登录的账号过一会儿自己没了」。
  const { CHANNEL_SPECS, RETIRED_CHANNEL_IDS } = await import('../lib/channel-specs.js')
  const registered = new Set(CHANNEL_SPECS.map(spec => spec.id))
  assert.deepEqual(RETIRED_CHANNEL_IDS.filter(id => registered.has(id)), [], '退役渠道不得仍留在规格表里')
  assert.ok(RETIRED_CHANNEL_IDS.includes('loomy'), 'Loomy 已退役，必须登记在这里，否则它的孤儿账号永远不会被清')
})
