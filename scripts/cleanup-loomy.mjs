// 清理磁盘上残留的 Loomy 渠道数据（渠道已于 2026-11-25 移除）。
//
// 为什么需要它：移除只改了代码，用户磁盘上仍有旧账号、凭据引用、路由检测状态、
// 目录缓存与账本目录。**必须在插件重新加载（或宿主重启）之后运行** —— 旧版插件
// 进程仍在内存里持有这些数据，清理后它会再写回去（实测 `channel-pack/state.json`
// 会在数分钟内被旧进程覆盖）。
//
// 幂等：可以反复运行；每一步都先备份到 `<dsh home>/backups/loomy-removal-<时间戳>/`。
// 只删 Loomy 相关条目，不碰其它渠道。
//
// 用法：
//   node scripts/cleanup-loomy.mjs           # 执行清理（先备份）
//   node scripts/cleanup-loomy.mjs --dry-run # 只列出将要删除的内容
import { existsSync, readFileSync, renameSync, rmSync, mkdirSync, copyFileSync, cpSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const dryRun = process.argv.includes('--dry-run')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupDir = join(dshHome, 'backups', `loomy-removal-${stamp}`)
/**
 * 是否连**真实用户目录之外**的历史遗留文件一起清理。
 *
 * Magpie 的路由状态住在 `~/.config/magpie`（不在 `DSH_HOME` 下）。测试与
 * 「只在某个 DSH_HOME 上演练」的场景必须跳过它，否则一次演练会删掉用户真实的
 * 路由记录 —— 因此只有 `DSH_HOME` **未被覆盖**（即真的在用户主目录上跑）时才动它。
 */
const cleanLegacyHomePaths = !process.env.DSH_HOME

/** 找到插件状态目录（`<dsh home>/state/<profile>/dsh-unified-router`）。 */
function stateDirs() {
  const root = join(dshHome, 'state')
  if (!existsSync(root)) return []
  const out = []
  for (const profile of ['desktop', '']) {
    const dir = profile ? join(root, profile, 'dsh-unified-router') : join(root, 'dsh-unified-router')
    if (existsSync(dir)) out.push(dir)
  }
  return out
}

function backup(file) {
  if (dryRun || !existsSync(file)) return
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(file, join(backupDir, file.slice(dshHome.length + 1).replace(/[\\/]/g, '_')))
}

const actions = []

// 1) channel-pack 状态：账号、黑名单、永久锁镜像字段
const stateFile = join(dshHome, 'channel-pack', 'state.json')
if (existsSync(stateFile)) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const loomyAccounts = accounts.filter(account => account.provider === 'loomy')
  const removed = []
  if (loomyAccounts.length > 0) removed.push(`账号 ${loomyAccounts.length} 个（${loomyAccounts.map(a => a.id).join('、')}）`)
  if (state.disabledModels && 'loomy' in state.disabledModels) removed.push('disabledModels.loomy')
  if ('loomyPermanentLocked' in state) removed.push('loomyPermanentLocked 镜像字段')
  if (removed.length > 0) {
    actions.push(`channel-pack/state.json：${removed.join('、')}`)
    if (!dryRun) {
      backup(stateFile)
      state.accounts = accounts.filter(account => account.provider !== 'loomy')
      if (state.disabledModels) delete state.disabledModels.loomy
      delete state.loomyPermanentLocked
      writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2))
      renameSync(stateFile + '.tmp', stateFile)
    }
  }
}

// 2) 各 profile 的设置快照里的 `loomy/*` 资源
for (const dir of stateDirs()) {
  const settingsFile = join(dir, 'settings.json')
  if (!existsSync(settingsFile)) continue
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'))
  const keys = Object.keys(saved.entries ?? {}).filter(key => key.toLowerCase().startsWith('loomy/'))
  if (keys.length === 0) continue
  actions.push(`${settingsFile.slice(dshHome.length + 1)}：快照资源 ${keys.length} 个（${keys.join('、')}）`)
  if (dryRun) continue
  backup(settingsFile)
  for (const key of keys) delete saved.entries[key]
  writeFileSync(settingsFile + '.tmp', JSON.stringify(saved))
  renameSync(settingsFile + '.tmp', settingsFile)
}

// 3) 独立文件：永久锁表、渠道目录、路由检测状态、账本目录
const removable = [
  join(dshHome, 'channel-pack', 'permanent-locks.json'),
]
if (cleanLegacyHomePaths) removable.push(join(homedir(), '.config', 'magpie', 'loomy-route-state.json'))
const removableDirs = []
for (const dir of stateDirs()) {
  removable.push(join(dir, 'loomy-catalog.json'), join(dir, 'loomy-route-state.json'))
  removableDirs.push(join(dir, 'auto-tasks', 'loomy'), join(dir, 'daily-checkin', 'loomy'))
}
for (const file of removable) {
  if (!existsSync(file)) continue
  actions.push(`删除文件 ${file}`)
  if (!dryRun) { backup(file); rmSync(file, { force: true }) }
}
for (const dir of removableDirs) {
  if (!existsSync(dir)) continue
  actions.push(`删除目录 ${dir}`)
  if (!dryRun) { cpSync(dir, join(backupDir, dir.slice(dshHome.length + 1).replace(/[\\/]/g, '_')), { recursive: true }); rmSync(dir, { recursive: true, force: true }) }
}

// 4) 凭据引用（`LOOMY_ACCOUNT_*`）：只**提示**，不直接改凭据文件
//
// ⚠️ 这是一条 note 而不是 action：它不产生任何改动。混进 actions 会让「已经
// 清理干净」的第二次运行也报「已清理」并新建一个空备份目录，破坏幂等观感。
const credentials = join(dshHome, '.credentials.yaml')
const refs = existsSync(credentials)
  ? (readFileSync(credentials, 'utf8').match(/LOOMY_ACCOUNT_[0-9A-F]+/g) ?? [])
  : []
const notes = refs.length > 0
  ? [`凭据文件仍含 ${refs.length} 个 LOOMY_ACCOUNT_* 引用（代码已不再读取这些凭据，可保留，脚本不擅自改凭据）`]
  : []

if (actions.length === 0) {
  console.log('没有需要清理的 Loomy 数据。')
} else {
  console.log(`${dryRun ? '将清理' : '已清理'}：`)
  for (const line of actions) console.log(`- ${line}`)
  if (!dryRun) console.log(`\n备份目录：${backupDir}`)
}
for (const line of notes) console.log(`- ${line}`)
