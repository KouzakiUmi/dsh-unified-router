// 从本机 magpie 网关迁移凭据到 dsh-unified-router。
//
// 用法：
//   node scripts/migrate-from-magpie.mjs            # dry-run：只输出脱敏迁移计划
//   node scripts/migrate-from-magpie.mjs --apply    # 执行：备份 + 原子写
//
// 源：~/.config/magpie/plugin-auth.json（账号凭据）+ quotas.json（raccoon 套餐）
// 目标：~/.dsh/.credentials.yaml（refs 段，凭据服务 chokidar 热重载）
//       ~/.dsh/channel-pack/state.json（channel-pack 账号池）
//
// 安全口径：全程不打印凭据值；标识符只输出打码手机号/uid 前缀/昵称。
// 幂等：按身份匹配既有账号，令牌相同则跳过；重复运行只更新不重复新增。
//
// 映射规则（2026-11-17 与用户确认）：
// - Loomy **不迁移**：该渠道已于 2026-11-25 移除，迁移它的账号只会生产出孤儿条目。
// - qoder-cn×N → qodercn 池（按 uid 去重）
// - raccoon×N → **全部进 `raccoon` 单池**，套餐只写成 entry 的 `plan` 标记：
//   Free → 'free'；subscription/one_time_purchase → 'pro'；未知 → 'unknown'
//   （按打码手机号去重；旧版按套餐分到 `raccoon-pro` 池的账号**迁回 `raccoon`**：
//    保留 id/nickname/enabled，只改 provider 与凭据 ref，旧 RACCOONPRO ref 清除。
//    令牌相同的账号并不改写凭据，但同样补写 `plan` 字段。）
// - trae-cn×N → trae 池（按 uid 去重）
// - workbuddy×N（仅 CN 域名）→ 多账号索引 UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS
//   + 每账号 UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6HEX>（按 uid 去重）
// - sensenova → 覆盖 UNIFIED_ROUTER_SENSENOVA_API_KEY；控制台 email/password 写入
//   UNIFIED_ROUTER_SENSENOVA_USERNAME / _PASSWORD（下次打开面板自动登录）
// - 其他 provider（gemini/buddy/cline/zcode/qoder/minimax/codearts/国际版 workbuddy 等）不动。

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'

const APPLY = process.argv.includes('--apply')
const home = homedir()
const MAGPIE_AUTH = join(home, '.config/magpie/plugin-auth.json')
const MAGPIE_QUOTAS = join(home, '.config/magpie/quotas.json')
const CREDS_YAML = join(home, '.dsh/.credentials.yaml')
const POOL_STATE = join(home, '.dsh/channel-pack/state.json')

const sha = s => createHash('sha256').update(String(s)).digest('hex')
const hex = n => randomBytes(n).toString('hex').toUpperCase()
const maskPhone = p => typeof p === 'string' && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : (p || '')
const tail4 = p => typeof p === 'string' ? p.replace(/\*/g, '').slice(-4) : ''
const maskUid = u => String(u || '').slice(0, 8) + '…'

// ── 读取源 ──────────────────────────────────────────────────────────────
const magpie = JSON.parse(readFileSync(MAGPIE_AUTH, 'utf8'))
const quotas = existsSync(MAGPIE_QUOTAS) ? JSON.parse(readFileSync(MAGPIE_QUOTAS, 'utf8')) : {}
const yamlText = readFileSync(CREDS_YAML, 'utf8')
const state = JSON.parse(readFileSync(POOL_STATE, 'utf8'))

// raccoon 套餐：quotas 顶层键 'raccoon/raccoon-pu-<uuid>'（小写），magpie accountId 首字母大写
const raccoonPlan = accountId => {
  const key = 'raccoon/' + String(accountId).toLowerCase()
  return quotas[key]?.quota?.plan || quotas[key]?.plan || ''
}
// magpie 的套餐名 → 账号池的 `plan` 标记（单池分流用）。
// ⚠️ 认不出的套餐名一律 'unknown'（按免费侧处理），**不猜**成 pro：
// 猜成 pro 会让一个其实是免费的账号去服务计费模型。
const raccoonPlanTag = (plan) => {
  const value = String(plan || '').trim().toLowerCase()
  if (value === 'free') return 'free'
  if (value === 'subscription' || value === 'one_time_purchase') return 'pro'
  return 'unknown'
}

// ── YAML refs 解析/序列化（单引号字符串，'' 转义） ────────────────────────
// 注意：version: 1 等顶层行在 refs 段之后，必须原样保留，否则凭据服务
// 会判为 pre-release flat layout 拒绝重载。
const refsSplit = yamlText.split(/^refs:/m)
if (refsSplit.length !== 2) throw new Error('credentials.yaml 结构异常：找不到唯一 refs: 段')
const beforeRefs = refsSplit[0]
const refs = new Map()
const tailLines = []
for (const line of refsSplit[1].split('\n')) {
  const m = line.match(/^ {2}([^:\s]+):[ \t]*(.*)$/)
  if (m) refs.set(m[1], m[2].trim())
  else if (line.trim()) {
    // 只允许顶层键（无缩进）作为尾部；更深的缩进可能是多行值，拒绝处理以免损坏
    if (/^\S/.test(line)) tailLines.push(line)
    else throw new Error('credentials.yaml refs 段存在多行值，本脚本不支持，请人工处理')
  }
}
const yamlUnquote = v => {
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  if (v.startsWith('"') && v.endsWith('"')) { try { return JSON.parse(v) } catch { return v.slice(1, -1) } }
  return v
}
const yamlQuote = v => "'" + String(v).replace(/'/g, "''") + "'"
const refGet = name => refs.has(name) ? yamlUnquote(refs.get(name)) : undefined
const refGetJson = name => { const v = refGet(name); if (v === undefined) return undefined; try { return JSON.parse(v) } catch { return undefined } }
const refSet = (name, value) => refs.set(name, yamlQuote(typeof value === 'string' ? value : JSON.stringify(value)))
const refDel = name => refs.delete(name)
const serializeRefs = entries => beforeRefs + 'refs:\n' + [...entries.entries()].map(([k, v]) => `  ${k}: ${v}`).join('\n') + '\n' + tailLines.join('\n') + '\n'

// ── 既有账号身份索引 ─────────────────────────────────────────────────────
const PACK_PROVIDERS = ['raccoon', 'raccoon-pro', 'qodercn', 'trae']
const accounts = state.accounts
const findByIdentity = (provider, ident) => accounts.find(a => {
  if (a.provider !== provider) return false
  const v = refGetJson(a.credentialRef)
  if (!v) return false
  if (provider === 'raccoon' || provider === 'raccoon-pro') return maskPhone(v.phone) === ident
  return v.uid === ident
})

// ── 凭据构造器（magpie auth → channel-pack 凭据形状） ────────────────────
const buildQoder = a => {
  // deviceChat 账号用设备令牌对（与既有 DSH 记录形态一致）；否则用 access/refresh。
  const useDevice = a.deviceChat === true && a.deviceToken
  const access = useDevice ? a.deviceToken : a.access
  const refresh = useDevice ? (a.deviceRefresh || a.refresh) : a.refresh
  return {
    security_oauth_token: access, access_token: access, refresh_token: refresh,
    expire_time: a.expires, machine_id: a.machineId, uid: a.uid,
    nickname: a.name || a.cardName || 'Qoder',
  }
}
const buildRaccoon = (a, nickname) => ({
  access_token: a.access, refresh_token: a.refresh, expires_at: String(a.expires),
  user_id: a.uid, nickname, phone: a.phone || '',
})
const buildTrae = a => ({
  access_token: a.access, refresh_token: a.refresh, expires_at: String(a.expires),
  uid: a.uid, nickname: a.accountId || `TRAE (${maskUid(a.uid)})`,
  machine_id: a.machineId, device_id: a.deviceId, domain: 'trae.cn',
  ...(a.account?.TenantID ? { enterprise_id: String(a.account.TenantID) } : {}),
})
const buildWorkbuddy = a => ({
  type: 'oauth', access: a.access, refresh: a.refresh,
  accountId: a.accountId, uid: a.uid, domain: a.domain,
  expires: a.expires, refreshExpiresAt: a.refreshExpiresAt, tokenType: a.tokenType,
})

// ── 迁移计划 ─────────────────────────────────────────────────────────────
const plan = []          // {provider, ident, action, detail}
const refWrites = []     // [name, value]
const refDeletes = []
const stateOps = []      // {op:'add'|'update'|'remove', ...}
// workbuddy 索引在循环外累积（循环内读原始 refs 会丢失前面新增的账号）
const wbIndexRaw = refGetJson('UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS')
const wbIndex = Array.isArray(wbIndexRaw) ? [...wbIndexRaw] : []
let wbIndexChanged = false

const poolAdd = (provider, credential, nickname, ident, refreshable = true, extra = {}) => {
  const suffix = hex(4).toLowerCase()
  const id = `${provider}-${suffix}`
  const refPrefix = provider.toUpperCase().replace(/[^A-Z0-9]+/g, '')
  const credentialRef = `${refPrefix}_ACCOUNT_${hex(3)}`
  refWrites.push([credentialRef, credential])
  stateOps.push({ op: 'add', entry: { id, provider, nickname, enabled: true, credentialRef, refreshable, createdAt: Date.now(), expiresAt: Number(credential.expires_at || credential.expire_time || 0) || undefined, ...extra } })
  plan.push({ provider, ident, action: '新增', detail: nickname })
}
const poolUpdate = (entry, credential, ident, note = '', extra = {}) => {
  const old = refGetJson(entry.credentialRef)
  if (old && sha(JSON.stringify(old)) === sha(JSON.stringify(credential))) {
    // 令牌相同：凭据不动，但**本次架构新增的字段仍要补写**（`plan`）——
    // 否则「令牌没变」的账号永远拿不到套餐标记，永远落在免费侧。
    const patch = { ...extra }
    if (Object.keys(patch).length > 0) stateOps.push({ op: 'update', id: entry.id, patch })
    plan.push({ provider: entry.provider, ident, action: '跳过',
      detail: '令牌相同' + note + (Object.keys(patch).length > 0 ? `（补 plan=${patch.plan}）` : '') })
    return
  }
  refWrites.push([entry.credentialRef, credential])
  stateOps.push({ op: 'update', id: entry.id, patch: { expiresAt: Number(credential.expires_at || credential.expire_time || 0) || entry.expiresAt, ...extra } })
  plan.push({ provider: entry.provider, ident, action: '更新令牌', detail: entry.nickname + note })
}

for (const [key, auth] of Object.entries(magpie)) {
  const base = key.split('#')[0]
  if (!auth || typeof auth !== 'object') continue

  if (base === 'qoder-cn') {
    const ident = auth.uid
    const existing = findByIdentity('qodercn', ident)
    const cred = buildQoder(auth)
    if (existing) poolUpdate(existing, cred, maskUid(ident))
    else poolAdd('qodercn', cred, cred.nickname, maskUid(ident))
  }

  else if (base === 'raccoon') {
    // **单池**：所有小浣熊账号都进 `raccoon`，套餐只写成 `plan` 标记。
    // 旧版按套餐分池（Free→raccoon、付费→raccoon-pro），故既有 `raccoon-pro`
    // 账号要按打码手机号匹配后**迁回** `raccoon`：保留 id/nickname/enabled，
    // 只改 provider 与凭据 ref，旧 `RACCOONPRO_ACCOUNT_*` ref 清除。
    const rawPlan = raccoonPlan(auth.accountId)
    const planTag = raccoonPlanTag(rawPlan)
    const planNote = `${rawPlan || '套餐未知'} → plan=${planTag}`
    const ident = maskPhone(auth.phone)
    const nickname = `Raccoon (${tail4(auth.phone)})`
    // 两个池都找（既有账号可能还在旧的分池里）
    const existing = findByIdentity('raccoon', ident) || findByIdentity('raccoon-pro', ident)
    const cred = buildRaccoon(auth, existing?.nickname || nickname)
    if (existing && existing.provider === 'raccoon') {
      poolUpdate(existing, cred, ident, `（${planNote}）`, { plan: planTag })
    } else if (existing) {
      // 迁回单池：**同一个账号条目**，只换 provider 与 ref（不新建 id），
      // 这样昵称、启停状态、创建时间都原样保留下来。
      const credentialRef = `RACCOON_ACCOUNT_${hex(3)}`
      refWrites.push([credentialRef, cred])
      refDeletes.push(existing.credentialRef)
      stateOps.push({ op: 'update', id: existing.id, patch: {
        provider: 'raccoon', credentialRef, plan: planTag,
        expiresAt: Number(cred.expires_at) || existing.expiresAt,
      } })
      plan.push({ provider: 'raccoon', ident, action: '迁回 raccoon 池',
        detail: `${existing.nickname}（${planNote}；保留 id/启停${existing.enabled === false ? '=停用' : ''}）` })
    } else {
      poolAdd('raccoon', cred, nickname, ident, true, { plan: planTag })
      plan[plan.length - 1].detail += `（${planNote}）`
    }
  }

  else if (base === 'trae-cn') {
    const ident = auth.uid
    const existing = findByIdentity('trae', ident)
    const cred = buildTrae(auth)
    if (existing) poolUpdate(existing, cred, maskUid(ident))
    else poolAdd('trae', cred, cred.nickname, maskUid(ident))
  }

  else if (base === 'workbuddy') {
    // 只接 CN 版（copilot.tencent.com / www.workbuddy.cn）
    if (!/workbuddy\.cn|tencent/.test(auth.domain || '')) {
      plan.push({ provider: 'workbuddy', ident: maskUid(auth.uid), action: '跳过', detail: `非 CN 域名（${auth.domain}）` })
      continue
    }
    const cred = buildWorkbuddy(auth)
    const dup = wbIndex.find(e => e.uid === auth.uid)
    if (dup) {
      const old = refGetJson(dup.credentialRef)
      if (old && sha(JSON.stringify(old)) === sha(JSON.stringify(cred))) {
        plan.push({ provider: 'workbuddy', ident: maskUid(auth.uid), action: '跳过', detail: '令牌相同' })
      } else {
        refWrites.push([dup.credentialRef, cred])
        plan.push({ provider: 'workbuddy', ident: maskUid(auth.uid), action: '更新令牌', detail: dup.name })
      }
    } else {
      const credentialRef = `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_${hex(3)}`
      const entry = { id: `workbuddy-${hex(4).toLowerCase()}`, credentialRef, name: auth.accountId || maskUid(auth.uid), uid: auth.uid, createdAt: Date.now() }
      refWrites.push([credentialRef, cred])
      wbIndex.push(entry)
      wbIndexChanged = true
      plan.push({ provider: 'workbuddy', ident: maskUid(auth.uid), action: '新增', detail: entry.name })
    }
  }

  else if (base === 'sensenova') {
    const meta = auth.metadata || {}
    if (auth.key) {
      const old = refGet('UNIFIED_ROUTER_SENSENOVA_API_KEY')
      if (old && sha(old) === sha(auth.key)) plan.push({ provider: 'sensenova', ident: 'API Key', action: '跳过', detail: '相同' })
      else { refWrites.push(['UNIFIED_ROUTER_SENSENOVA_API_KEY', auth.key]); plan.push({ provider: 'sensenova', ident: 'API Key', action: '覆盖', detail: '以 magpie 为准' }) }
    }
    if (meta.email && meta.password) {
      refWrites.push(['UNIFIED_ROUTER_SENSENOVA_USERNAME', meta.email])
      refWrites.push(['UNIFIED_ROUTER_SENSENOVA_PASSWORD', meta.password])
      plan.push({ provider: 'sensenova', ident: '控制台', action: '写入账密', detail: 'email 登录，下次打开面板自动换取令牌' })
    }
  }
}

// 旧单账号 workbuddy 凭据采纳（若存在且不在索引中）
const legacyWb = refGetJson('UNIFIED_ROUTER_WORKBUDDY_AUTH')
if (legacyWb?.access) {
  if (!wbIndex.some(e => e.uid === legacyWb.uid)) {
    const credentialRef = `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_${hex(3)}`
    refWrites.push([credentialRef, legacyWb])
    wbIndex.push({ id: `workbuddy-${hex(4).toLowerCase()}`, credentialRef, name: legacyWb.accountId || maskUid(legacyWb.uid), uid: legacyWb.uid, createdAt: Date.now() })
    wbIndexChanged = true
    refDeletes.push('UNIFIED_ROUTER_WORKBUDDY_AUTH')
    plan.push({ provider: 'workbuddy', ident: maskUid(legacyWb.uid), action: '采纳旧单账号', detail: legacyWb.accountId || '' })
  }
}
if (wbIndexChanged) refWrites.push(['UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS', wbIndex])

// ── 输出计划（脱敏） ─────────────────────────────────────────────────────
console.log(APPLY ? '== 执行迁移 ==' : '== 迁移计划（dry-run，加 --apply 执行）==')
console.table(plan)
const counts = {}
for (const p of plan) counts[p.action] = (counts[p.action] || 0) + 1
console.log('汇总:', JSON.stringify(counts), '| ref 写入:', refWrites.length, '| ref 清除:', refDeletes.length, '| 池操作:', stateOps.length)

if (!APPLY) {
  console.log('\ndry-run 结束。确认计划后运行：node scripts/migrate-from-magpie.mjs --apply')
  process.exit(0)
}

// ── 执行：备份 + 原子写 ──────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const bakCreds = CREDS_YAML + `.bak-migrate-${ts}`
const bakState = POOL_STATE + `.bak-migrate-${ts}`
copyFileSync(CREDS_YAML, bakCreds)
copyFileSync(POOL_STATE, bakState)
console.log('备份:', bakCreds, '|', bakState)

// 应用 ref 写入/清除（同名多次写入以最后一次为准——workbuddy 索引）
const finalRefs = new Map(refs)
for (const [name, value] of refWrites) finalRefs.set(name, yamlQuote(typeof value === 'string' ? value : JSON.stringify(value)))
for (const name of refDeletes) finalRefs.delete(name)
const newYaml = serializeRefs(finalRefs)

// 应用池操作
let newAccounts = [...accounts]
for (const op of stateOps) {
  if (op.op === 'remove') newAccounts = newAccounts.filter(a => a.id !== op.id)
  else if (op.op === 'update') newAccounts = newAccounts.map(a => a.id === op.id ? { ...a, ...op.patch } : a)
  else newAccounts.push(op.entry)
}
const newState = { ...state, accounts: newAccounts }

// 原子写（同目录临时文件 + rename；凭据服务 chokidar 热重载）
const atomicWrite = (target, content) => {
  const tmp = target + `.tmp-migrate-${process.pid}`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, target)
}
atomicWrite(CREDS_YAML, newYaml)
atomicWrite(POOL_STATE, JSON.stringify(newState, null, 2) + '\n')
console.log('✓ 迁移完成。凭据服务会热重载；账号池在插件下次装载时读取。')
console.log('  回滚：用上述备份覆盖原文件即可。')
