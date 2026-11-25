// `scripts/cleanup-loomy.mjs`：移除渠道后清理磁盘残留的 Loomy 数据。
//
// 为什么要单独测：这段逻辑直接删用户磁盘上的账号、快照与账本目录，一旦写错范围
// （例如误删别的渠道、或把 `state.json` 结构写坏）后果不可逆。用例在临时 DSH_HOME
// 上构造一份「移除前」的真实形状，跑脚本，再逐项核对：**Loomy 相关全消失、其它渠道
// 一字未动、可重复执行、dry-run 不落盘**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/cleanup-loomy.mjs', import.meta.url))

/** 造一份「Loomy 还在」的磁盘状态：其它渠道的数据用来验证不会被误删。 */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'unified-router-cleanup-'))
  mkdirSync(join(home, 'channel-pack'), { recursive: true })
  const state = {
    accounts: [
      { id: 'loomy-aaaa1111', provider: 'loomy', nickname: 'Loomy 甲', credentialRef: 'LOOMY_ACCOUNT_AAAA', enabled: true },
      { id: 'loomy-bbbb2222', provider: 'loomy', nickname: 'Loomy 乙', credentialRef: 'LOOMY_ACCOUNT_BBBB', enabled: true },
      { id: 'raccoon-cccc3333', provider: 'raccoon', nickname: '小浣熊', credentialRef: 'RACCOON_ACCOUNT_CCCC', enabled: true },
    ],
    disabledModels: { loomy: { 'spark-x2.6': true }, raccoon: { 'sn-glm-5-3': true } },
    loomyPermanentLocked: true,
    gatewayEnabled: true,
    providerOrder: [],
  }
  writeFileSync(join(home, 'channel-pack', 'state.json'), JSON.stringify(state, null, 2))
  writeFileSync(join(home, 'channel-pack', 'permanent-locks.json'), JSON.stringify({ schema: 'channel-pack/permanent-locks/v1', locks: { loomy: true } }))

  const stateDir = join(home, 'state', 'desktop', 'dsh-unified-router')
  mkdirSync(join(stateDir, 'auto-tasks', 'loomy'), { recursive: true })
  mkdirSync(join(stateDir, 'daily-checkin', 'loomy'), { recursive: true })
  mkdirSync(join(stateDir, 'auto-tasks', 'raccoon'), { recursive: true })
  writeFileSync(join(stateDir, 'auto-tasks', 'loomy', 'ledger.json'), '{}')
  writeFileSync(join(stateDir, 'auto-tasks', 'raccoon', 'ledger.json'), '{}')
  writeFileSync(join(stateDir, 'loomy-catalog.json'), '{"models":[]}')
  writeFileSync(join(stateDir, 'loomy-route-state.json'), '{"accounts":{}}')
  writeFileSync(join(stateDir, 'raccoon-catalog.json'), '{"models":[]}')
  writeFileSync(join(stateDir, 'settings.json'), JSON.stringify({
    version: 1,
    entries: {
      'loomy/model.list': { at: 1, value: { models: [] } },
      'loomy/account.list': { at: 1, value: { accounts: [] } },
      'loomy/loomy.routeStatus': { at: 1, value: { accounts: {} } },
      'raccoon/model.list': { at: 2, value: { models: [{ id: 'sn-glm-5-3' }] } },
      'provider.status': { at: 3, value: { statuses: {} } },
    },
  }))
  writeFileSync(join(home, '.credentials.yaml'), 'refs:\n  LOOMY_ACCOUNT_AAAA: enc\n  RACCOON_ACCOUNT_CCCC: enc\n')
  return home
}

const run = (home, args = []) => execFileSync(process.execPath, [script, ...args], {
  env: { ...process.env, DSH_HOME: home },
  encoding: 'utf8',
})

test('清理 Loomy 数据：只删 Loomy，其它渠道原样保留，备份先落盘', () => {
  const home = fixture()
  try {
    const output = run(home)
    assert.match(output, /已清理/)

    const state = JSON.parse(readFileSync(join(home, 'channel-pack', 'state.json'), 'utf8'))
    assert.deepEqual(state.accounts.map(account => account.id), ['raccoon-cccc3333'], 'Loomy 账号被删，小浣熊账号保留')
    assert.equal('loomy' in state.disabledModels, false, 'Loomy 的模型黑名单被删')
    assert.deepEqual(state.disabledModels.raccoon, { 'sn-glm-5-3': true }, '其它渠道的黑名单不动')
    assert.equal('loomyPermanentLocked' in state, false, '永久锁镜像字段被删')
    assert.equal(state.gatewayEnabled, true, '无关字段保留')

    const settings = JSON.parse(readFileSync(join(home, 'state/desktop/dsh-unified-router/settings.json'), 'utf8'))
    assert.deepEqual(Object.keys(settings.entries).sort(),
      ['provider.status', 'raccoon/model.list'], '只删 loomy/* 快照资源')

    const stateDir = join(home, 'state/desktop/dsh-unified-router')
    assert.equal(existsSync(join(stateDir, 'loomy-catalog.json')), false)
    assert.equal(existsSync(join(stateDir, 'loomy-route-state.json')), false)
    assert.equal(existsSync(join(stateDir, 'auto-tasks/loomy')), false)
    assert.equal(existsSync(join(stateDir, 'daily-checkin/loomy')), false)
    assert.equal(existsSync(join(stateDir, 'raccoon-catalog.json')), true, '其它渠道目录缓存保留')
    assert.equal(existsSync(join(stateDir, 'auto-tasks/raccoon')), true, '其它渠道账本保留')
    assert.equal(existsSync(join(home, 'channel-pack/permanent-locks.json')), false, '永久锁表删除')

    // 凭据引用只提示不擅自改：凭据文件是用户级秘密，脚本不碰。
    const refs = readFileSync(join(home, '.credentials.yaml'), 'utf8')
    assert.match(refs, /LOOMY_ACCOUNT_AAAA/, '凭据文件保持原样（代码已不再读取这些 ref）')
    assert.match(output, /凭据文件仍含 1 个 LOOMY_ACCOUNT_\* 引用/, '凭据引用只提示、不擅自改凭据文件')

    // 备份：清理前的内容必须能找回。
    const backupRoot = join(home, 'backups')
    assert.equal(existsSync(backupRoot), true, '备份目录已建立')
    const [entry] = execFileSync(process.execPath, ['-e',
      `console.log(require('fs').readdirSync(${JSON.stringify(backupRoot)})[0])`], { encoding: 'utf8' }).trim().split('\n')
    assert.match(entry, /^loomy-removal-/)
    const backedUp = JSON.parse(readFileSync(join(backupRoot, entry, 'channel-pack_state.json'), 'utf8'))
    assert.equal(backedUp.accounts.filter(account => account.provider === 'loomy').length, 2, '备份里仍有被删的 Loomy 账号')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('清理可重复执行；dry-run 只报告不落盘', () => {
  const home = fixture()
  try {
    run(home)
    const first = readFileSync(join(home, 'channel-pack', 'state.json'), 'utf8')

    // 再跑一次：已经没有 Loomy 数据，不应改动任何文件。
    const second = run(home)
    assert.match(second, /没有需要清理的 Loomy 数据/)
    assert.equal(readFileSync(join(home, 'channel-pack', 'state.json'), 'utf8'), first, '幂等：内容不变')

    // dry-run：在另一份「Loomy 还在」的现场上，只报告、不删除。
    const fresh = fixture()
    try {
      const preview = run(fresh, ['--dry-run'])
      assert.match(preview, /将清理/)
      const state = JSON.parse(readFileSync(join(fresh, 'channel-pack', 'state.json'), 'utf8'))
      assert.equal(state.accounts.filter(account => account.provider === 'loomy').length, 2, 'dry-run 不删账号')
      assert.equal(existsSync(join(fresh, 'state/desktop/dsh-unified-router/loomy-catalog.json')), true, 'dry-run 不删文件')
      assert.equal(existsSync(join(fresh, 'backups')), false, 'dry-run 不建备份目录')
    } finally { rmSync(fresh, { recursive: true, force: true }) }
  } finally { rmSync(home, { recursive: true, force: true }) }
})