import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSenseNovaManager, adoptStateDir } from '../lib/sensenova.js'
import { m as parsePools, s as exhaustedModelIds, h as parseTrend } from '../vendor/sensenova-token-plan/llm-models.js'

function context(credentials, llm = {}) {
  const services = { credentials, llm, logger: { warn() {}, error() {}, info() {} } }
  return { ...services, get(name) { return this[name] }, emit() {} }
}

function credentialsFixture() {
  const values = new Map(), records = new Map(), operations = []
  return {
    values, records, operations,
    async resolve(key) { operations.push(['resolve', key]); return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) { operations.push(['set', key]); values.set(key, value) },
    async unset(key) { operations.push(['unset', key]); values.delete(key) },
    async readRecord(key) { operations.push(['readRecord', key]); return records.get(key) },
    async modifyRecord(key, fn) { operations.push(['modifyRecord', key]); const result = await fn(records.get(key)); if (result !== undefined) records.set(key, result); return records.get(key) },
    async deleteRecord(key) { operations.push(['deleteRecord', key]); records.delete(key) },
  }
}

test('缺失或无效的窗口数值保持未知，不把模型误判为额度耗尽', () => {
  const parsed = parsePools({ plan: { id: 'plan' }, pools: [
    { id: 'unknown', model_ids: ['m1'], window_5h: { limit: '100', used: null, remaining: '' }, window_7d: { limit: '100', remaining: 'invalid' } },
    { id: 'empty', model_ids: ['m2'], window_5h: { limit: '100', used: '100', remaining: '0' }, window_7d: { limit: '200', remaining: '50' } },
  ] })
  assert.equal(parsed.pools[0].window5h.remaining, null)
  assert.equal(parsed.pools[0].window5h.used, null)
  assert.equal(parsed.pools[0].window7d.remaining, null)
  assert.equal(parsed.pools[0].grantBalance, null)
  assert.equal(parsed.pools[1].window5h.remaining, 0)
  assert.deepEqual(exhaustedModelIds(parsed), ['m2'])
})

test('模型消耗对缺失、空或无效数据展示未知，真实零仍为零', () => {
  const trend = parseTrend({ series: [
    { model_id: 'good', points: [{ credits: '1.2' }, { credits: 0 }] },
    { model_id: 'zero', points: [{ credits: '0' }] },
    { model_id: 'blank', points: [] },
    { model_id: 'partial', points: [{ credits: 1 }, { credits: null }] },
    { model_id: 'invalid', points: [{ credits: 'bad' }] },
  ] }, 24)
  const amounts = Object.fromEntries(trend.models.map(row => [row.model, row.credits]))
  assert.deepEqual(amounts, { good: 1.2, zero: 0, blank: null, partial: null, invalid: null })
})

test('独立商汤管理器返回安全空快照，失败不泄露上游正文', async () => {
  const originalFetch = globalThis.fetch
  const originalHome = process.env.DSH_HOME
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-'))
  process.env.DSH_HOME = scratch
  globalThis.fetch = async () => { throw new Error('Bearer SECRET_NEVER_DISPLAY') }
  const creds = credentialsFixture()
  const manager = createSenseNovaManager(context(creds))
  try {
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    assert.equal(snapshot.configured, undefined)
    assert.equal(snapshot.hasApiKey, false)
    assert.equal(snapshot.catalogError, false)
    assert.equal(snapshot.pools, undefined)
    assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_NEVER_DISPLAY|Bearer/)
  } finally {
    manager.dispose()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('商汤 API Key 只写凭据服务，RPC 返回不含 Key', async () => {
  const originalHome = process.env.DSH_HOME
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-key-'))
  process.env.DSH_HOME = scratch
  const creds = credentialsFixture()
  const manager = createSenseNovaManager(context(creds))
  try {
    const result = await manager.call('plan.setKey', { provider: 'sensenova-token-plan', apiKey: 'sk-SECRET_NEVER_DISPLAY' })
    assert.deepEqual(result, { hasApiKey: true })
    assert.equal(creds.values.get('UNIFIED_ROUTER_SENSENOVA_API_KEY'), 'sk-SECRET_NEVER_DISPLAY')
    assert.equal(creds.values.has('SENSENOVA_API_KEY'), false, '不得覆盖参考插件的 Key')
    assert.doesNotMatch(JSON.stringify(result), /SECRET_NEVER_DISPLAY/)
  } finally {
    manager.dispose()
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('商汤独立目录不读取或更改参考插件开关和凭据', async () => {
  const originalHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-isolation-'))
  process.env.DSH_HOME = scratch
  globalThis.fetch = async () => { throw new Error('offline fixture') }
  const oldDir = path.join(scratch, 'state', 'web', 'dsh-connect-sensenova-token-plan')
  fs.mkdirSync(oldDir, { recursive: true })
  const oldSwitch = path.join(oldDir, 'provider.json')
  const original = '{"version":1,"enabled":true}'
  fs.writeFileSync(oldSwitch, original)
  const creds = credentialsFixture()
  creds.values.set('SENSENOVA_API_KEY', 'sk-original-fixture')
  creds.values.set('SENSENOVA_USERNAME', 'old-user')
  const ctx = context(creds)
  ctx.profileContext = { name: 'web' }
  const manager = createSenseNovaManager(ctx)
  try {
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    assert.equal(snapshot.hasApiKey, false)
    assert.equal(snapshot.registerProvider, false, '旧插件启用状态不得被继承')
    await manager.call('plan.setKey', { provider: 'sensenova-token-plan', apiKey: 'sk-new-fixture' })
    await assert.rejects(manager.call('plan.setEnabled', { provider: 'sensenova-token-plan', enabled: true }))
    assert.equal(fs.readFileSync(oldSwitch, 'utf8'), original)
    assert.equal(creds.values.get('SENSENOVA_API_KEY'), 'sk-original-fixture')
    assert.equal(creds.values.get('SENSENOVA_USERNAME'), 'old-user')
    assert.equal(creds.values.get('UNIFIED_ROUTER_SENSENOVA_API_KEY'), 'sk-new-fixture')
    assert.equal(creds.operations.some(([, key]) => String(key).endsWith('/sensenova-console')), false)
    assert.equal(creds.operations.some(([, key]) => String(key).startsWith('dsh-connect-sensenova-token-plan/')), false)
  } finally {
    manager.dispose()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    assert.equal(path.dirname(scratch), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(scratch).startsWith('unified-sensenova-isolation-'))
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('启用商汤提供方时没有 Host LLM 注册服务会失败并回滚开关', async () => {
  const originalHome = process.env.DSH_HOME
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-switch-'))
  process.env.DSH_HOME = scratch
  const manager = createSenseNovaManager(context(credentialsFixture(), {}))
  try {
    await assert.rejects(manager.call('plan.setEnabled', { provider: 'sensenova-token-plan', enabled: true }))
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    assert.equal(snapshot.registerProvider, false)
    assert.equal(snapshot.providerRegistered, false)
  } finally {
    manager.dispose()
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('商汤 API Key 从改名前的引用名回退读取，新写入只落新引用名', async () => {
  const originalHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-legacy-key-'))
  process.env.DSH_HOME = scratch
  globalThis.fetch = async () => { throw new Error('offline fixture') }
  const creds = credentialsFixture()
  creds.values.set('EAC_SENSENOVA_API_KEY', 'sk-legacy-fixture')
  const manager = createSenseNovaManager(context(creds))
  try {
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    assert.equal(snapshot.hasApiKey, true, '改名前的 Key 必须仍然生效')
    assert.ok(creds.operations.some(([op, key]) => op === 'resolve' && key === 'EAC_SENSENOVA_API_KEY'))
    // 回退读取不得搬移或删除旧值。
    assert.equal(creds.values.get('EAC_SENSENOVA_API_KEY'), 'sk-legacy-fixture')
    await manager.call('plan.setKey', { provider: 'sensenova-token-plan', apiKey: 'sk-new-fixture' })
    assert.equal(creds.values.get('UNIFIED_ROUTER_SENSENOVA_API_KEY'), 'sk-new-fixture')
  } finally {
    manager.dispose()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('商汤状态目录从旧命名空间搬迁一次，搬迁失败时继续读旧目录', async () => {
  const originalHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
  const catalog = id => JSON.stringify({ version: 2, fetchedAt: Date.now(), entries: [{ id, name: id.toUpperCase() }], enabledModelIds: [id] })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-state-move-'))
  process.env.DSH_HOME = scratch
  globalThis.fetch = async () => { throw new Error('offline fixture') }
  const legacyDir = path.join(scratch, 'state', 'web', 'dsh-eac-router-sensenova')
  const newDir = path.join(scratch, 'state', 'web', 'dsh-unified-router-sensenova')
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'catalog.json'), catalog('from-legacy'))
  const ctx = context(credentialsFixture())
  ctx.profileContext = { name: 'web' }
  const manager = createSenseNovaManager(ctx)
  try {
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    assert.equal(fs.existsSync(newDir), true, '旧目录应搬迁到新命名空间')
    assert.equal(fs.existsSync(legacyDir), false, '搬迁后旧目录不应残留')
    assert.deepEqual(snapshot.models.map(model => model.id), ['from-legacy'], '搬迁后应从新目录读到原状态')
  } finally {
    manager.dispose()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  // 搬迁失败：Windows 下无法用文件系统状态稳定制造 rename 失败（目标为文件会被
  // 覆盖成功，目标为非空目录时 isDirectory 已为 true 而走「已就绪」分支），因此注入
  // 一个必定抛错的 rename。断言用只有旧目录才有的 catalog 观察实际生效的状态来源，
  // 只看「旧目录还在」会假阳性。
  const scratch2 = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-state-blocked-'))
  process.env.DSH_HOME = scratch2
  const legacy2 = path.join(scratch2, 'state', 'web', 'dsh-eac-router-sensenova')
  const new2 = path.join(scratch2, 'state', 'web', 'dsh-unified-router-sensenova')
  fs.mkdirSync(legacy2, { recursive: true })
  fs.writeFileSync(path.join(legacy2, 'catalog.json'), catalog('from-legacy'))
  const warnings = []
  const blockedContext = context(credentialsFixture())
  blockedContext.profileContext = { name: 'web' }
  blockedContext.logger = { warn: message => warnings.push(String(message)), error() {}, info() {} }
  const failingRename = () => { const error = new Error('rename blocked'); error.code = 'EPERM'; throw error }
  const manager2 = createSenseNovaManager(blockedContext, {}, { rename: failingRename })
  try {
    const snapshot = await manager2.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    // 旧目录里的 catalog 被读到 => 状态目录确实回退到旧路径。
    assert.deepEqual(snapshot.models.map(model => model.id), ['from-legacy'], '搬迁失败时必须继续读旧目录的状态')
    assert.ok(warnings.some(message => message.includes('继续使用旧目录')), `应记录回退告警，实际：${JSON.stringify(warnings)}`)
    assert.equal(fs.existsSync(path.join(legacy2, 'catalog.json')), true, '搬迁失败时旧目录必须保留')
    assert.equal(fs.existsSync(new2), false, '搬迁失败时不得凭空创建新目录')
  } finally {
    manager2.dispose()
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch2, { recursive: true, force: true })
  }
})

test('搬迁时另一进程抢先完成：沿用新目录，不回退到已消失的旧目录', async () => {
  const originalHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-state-race-'))
  process.env.DSH_HOME = scratch
  globalThis.fetch = async () => { throw new Error('offline fixture') }
  const legacyDir = path.join(scratch, 'state', 'web', 'dsh-eac-router-sensenova')
  const newDir = path.join(scratch, 'state', 'web', 'dsh-unified-router-sensenova')
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'catalog.json'), JSON.stringify({ version: 2, fetchedAt: Date.now(), entries: [{ id: 'moved', name: 'MOVED' }], enabledModelIds: ['moved'] }))
  const warnings = []
  const ctx = context(credentialsFixture())
  ctx.profileContext = { name: 'web' }
  ctx.logger = { warn: message => warnings.push(String(message)), error() {}, info() {} }
  // 模拟竞态：本进程调用 rename 时，另一进程已经完成了同一次搬迁（旧目录已搬到
  // 新路径），于是本次 rename 抛错。此时目标已是真目录、旧目录已消失——旧实现会在
  // 「目标存在即视为被文件占用」的分支返回已不存在的旧目录，导致状态分裂。
  const racingRename = (from, to) => {
    if (fs.existsSync(from)) fs.renameSync(from, to)
    const error = new Error('EEXIST'); error.code = 'EEXIST'; throw error
  }
  const manager = createSenseNovaManager(ctx, {}, { rename: racingRename })
  try {
    const snapshot = await manager.call('plan.snapshot', { provider: 'sensenova-token-plan' })
    // 从新目录读到状态 => 沿用了已搬迁的新目录，而不是回到已消失的旧目录。
    assert.deepEqual(snapshot.models.map(model => model.id), ['moved'], '应沿用另一进程搬好的新目录')
    // 关键：旧路径不得被重新创建，否则状态会分裂成两份。
    assert.equal(fs.existsSync(legacyDir), false, '不得在旧路径上重建状态目录')
  } finally {
    manager.dispose()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('状态目录选择的各分支：目标已是目录时绝不返回旧目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-sensenova-adopt-'))
  const legacy = path.join(root, 'legacy')
  const dir = path.join(root, 'target')
  const logger = () => { const messages = []; return { messages, warn: m => messages.push(`W:${m}`), info: m => messages.push(`I:${m}`) } }
  try {
    // 1) 新目录已就绪（另一进程刚搬完、旧目录已消失）：必须用新目录。
    fs.mkdirSync(legacy); fs.writeFileSync(path.join(legacy, 'catalog.json'), 'x')
    fs.renameSync(legacy, dir)
    const l1 = logger()
    assert.equal(adoptStateDir(dir, legacy, l1), dir, '目标已是目录时必须沿用它')
    assert.equal(fs.existsSync(legacy), false)

    // 2) rename 抛错，但目标此刻已成为目录（竞态终态）：仍须用新目录，不能回退旧目录。
    fs.rmSync(dir, { recursive: true }); fs.rmSync(legacy, { recursive: true, force: true })
    fs.mkdirSync(legacy); fs.writeFileSync(path.join(legacy, 'catalog.json'), 'x')
    const l2 = logger()
    const raceRename = (from, to) => { fs.renameSync(from, to); const error = new Error('EEXIST'); error.code = 'EEXIST'; throw error }
    assert.equal(adoptStateDir(dir, legacy, l2, raceRename), dir, 'rename 失败但目标已是目录时必须沿用新目录')
    assert.equal(fs.existsSync(legacy), false, '不得回退到已消失的旧目录')

    // 3) rename 抛错且目标仍不存在：回退旧目录并告警（先重新铺好旧目录）。
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'catalog.json'), 'x')
    const l3 = logger()
    const failRename = () => { const error = new Error('EPERM'); error.code = 'EPERM'; throw error }
    assert.equal(adoptStateDir(dir, legacy, l3, failRename), legacy, 'rename 彻底失败时应回退旧目录')
    assert.ok(l3.messages.some(m => m.includes('继续使用旧目录')))

    // 4) 目标路径被非目录文件占据：不动该文件，回退旧目录并告警。
    fs.writeFileSync(dir, 'occupied')
    const l4 = logger()
    const result = adoptStateDir(dir, legacy, l4, () => { throw new Error('should not run') })
    assert.equal(result, legacy, '目标被文件占用时应回退旧目录')
    assert.equal(fs.readFileSync(dir, 'utf8'), 'occupied', '不得覆盖占用该路径的文件')
    assert.ok(l4.messages.some(m => m.includes('继续使用旧目录')))

    // 5) 新旧都没有：用新目录（不必搬迁、不必告警）。
    fs.rmSync(dir, { force: true }); fs.rmSync(legacy, { recursive: true, force: true })
    const l5 = logger()
    assert.equal(adoptStateDir(dir, legacy, l5), dir)
    assert.deepEqual(l5.messages, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
