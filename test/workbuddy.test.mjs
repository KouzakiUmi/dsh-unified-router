import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkBuddyManager, WORKBUDDY_METHODS, WORKBUDDY_ACCOUNTS_REF,
  WORKBUDDY_ACCOUNT_REF_PREFIX, WORKBUDDY_LEGACY_AUTH_REF, WORKBUDDY_MAX_ACCOUNTS,
} from '../lib/workbuddy.js'
import { _internal } from '../vendor/workbuddy/index.mjs'

// 离线桩与 sensenova-manager 测试同一套：凭据服务用 Map 假实现，
// 网络用假 fetch 按 URL（与账号 uid 头）应答。上游 bundle 只发 copilot.tencent.com
// 的请求；断言从不包含凭据原文或上游错误正文。

function context(credentials, extras = {}) {
  const emitted = []
  const services = {
    credentials,
    logger: { warn() {}, error() {}, info() {} },
    emit(type, payload) { emitted.push({ type, payload }) },
    ...extras,
  }
  const ctx = { ...services, get(name) { return this[name] }, emitted }
  return ctx
}

// failSet 用来模拟「某个引用写不进去」（采纳/登录的回滚路径）。
function credentialsFixture({ failSet = () => false } = {}) {
  const values = new Map(), operations = []
  return {
    values, operations,
    async resolve(key) { operations.push(['resolve', key]); return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) {
      operations.push(['set', key])
      if (failSet(key)) throw new Error('credential store failure')
      values.set(key, value)
    },
    async unset(key) { operations.push(['unset', key]); values.delete(key) },
  }
}

// env 是 WorkBuddy 接口的信封：{ code: 0, data }。
const env = data => JSON.stringify({ code: 0, data })

// resolve({method, path, headers}) 返回 Response / 字符串 / 对象；返回 undefined 表示未桩。
// 上游有的请求用普通对象头、有的用 Headers 实例，两种都要能读。
const headerOf = (headers, name) => {
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(name) ?? '')
  return String(headers[name] ?? headers[name.toLowerCase()] ?? '')
}

function fetchFixture(resolve, calls = []) {
  return async (input, init = {}) => {
    const { pathname, search } = new URL(String(input))
    const method = init.method ?? 'GET'
    const headers = init.headers ?? {}
    const path = pathname + search
    const call = {
      method, path,
      uid: headerOf(headers, 'X-User-Id'),
      authorization: headerOf(headers, 'Authorization'),
      refresh: headerOf(headers, 'X-Refresh-Token'),
    }
    calls.push(call)
    const out = await resolve(call, init)
    if (out === undefined) return new Response(JSON.stringify({ code: 99999, msg: 'unstubbed' }), { status: 404 })
    if (out instanceof Response) return out
    return new Response(typeof out === 'string' ? out : JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

async function withFetch(resolve, fn) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = fetchFixture(resolve, calls)
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// 额度桩：按 uid 区分账号；summary 给出计划窗口，packages/free 为空，config 给模型。
function usageStub(overrides = {}) {
  return call => {
    if (call.path.startsWith('/billing/meter/get-user-resource-summary')) {
      const custom = overrides.summary?.[call.uid]
      if (custom) return custom
      return env({
        IsPaidUser: true,
        SubscriptionPackageCode: '',
        CreditGroups: [{ Kind: 'plan_base', CycleTotalCapacity: '500', CycleUsedCapacity: '100' }],
        Packages: [],
      })
    }
    if (call.path.startsWith('/billing/meter/get-user-resource-paid-packages')) return env({ Accounts: [], TotalCount: 0 })
    if (call.path.startsWith('/billing/meter/get-user-resource-free-packages')) return env({ Accounts: [], TotalCount: 0 })
    if (call.path.startsWith('/billing/meter/get-enterprise-user-usage')) return env({})
    if (call.path.startsWith('/v3/config')) {
      const custom = overrides.config?.[call.uid]
      if (custom) return custom
      return env({
        models: [{ id: `m-${call.uid || 'none'}`, name: 'M', maxInputTokens: 1000, supportsImages: true, credits: 'x0.00' }],
        agents: [{ name: 'cli', models: [`m-${call.uid || 'none'}`] }],
      })
    }
    return undefined
  }
}

const authJson = (access, refresh, overrides = {}) => JSON.stringify({
  type: 'oauth',
  access,
  refresh,
  expires: Date.now() + 3600_000,
  uid: 'u-1',
  accountId: '测试用户',
  domain: 'copilot.tencent.com',
  ...overrides,
})

const SEED = {
  a: { id: 'workbuddy-aaaaaaaa', credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}AAAAAA`, name: '账号甲', uid: 'u-1', createdAt: 1 },
  b: { id: 'workbuddy-bbbbbbbb', credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}BBBBBB`, name: '账号乙', uid: 'u-2', createdAt: 2 },
}

function seed(creds, rows) {
  creds.values.set(WORKBUDDY_ACCOUNTS_REF, JSON.stringify(rows.map(({ entry }) => entry)))
  for (const { entry, auth } of rows) creds.values.set(entry.credentialRef, typeof auth === 'string' ? auth : JSON.stringify(auth))
}

const accountIdPattern = /^workbuddy-[0-9a-f]{8}$/

test('WorkBuddy 模型开关和实际调用参数实时更新，重启继续生效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbuddy-settings-'))
  const creds = credentialsFixture()
  creds.values.set(WORKBUDDY_ACCOUNTS_REF, JSON.stringify([SEED.a]))
  creds.values.set(SEED.a.credentialRef, JSON.stringify({ type: 'oauth', access: 'FIXTURE_A', uid: 'u-1' }))
  const provider = 'workbuddy'
  const catalog = {
    'glm-5.2': { limit: { context: 100_000, output: 24_000 }, attachment: false },
    'glm-5.3': { limit: { context: 128_000, output: 64_000 }, attachment: true, rate: 0.13, efforts: ['none', 'medium', 'high'], defaultEffort: 'high' },
    'step-5-preview': { limit: { context: 128_000, output: 64_000 }, attachment: true, rate: 0.33 },
  }
  let router, lastBuild
  const ctx = context(creds, { llm: { registerAdapter(_ids, adapter) { router = adapter; return () => { router = null } } } })
  const deps = {
    plugin: {
      provider: { models: async () => catalog },
      auth: { async loader(getAuth) { return { fetch: async () => (await getAuth()).uid } } },
    },
    loadLlmAdapter: async () => ({ createWorkBuddyAdapter(options) {
      lastBuild = options
      return { adapter: { listModels: () => options.catalog }, providerIds: [provider] }
    } }),
  }
  const config = { modelSettingsFile: join(dir, 'preferences.json'), catalogFile: join(dir, 'catalog.json') }
  let manager = createWorkBuddyManager(ctx, config, deps)
  const call = (method, payload) => manager.call(method, { provider, ...payload })
  try {
    const { models } = await call('workbuddy.models')
    assert.equal(models.find(model => model.id === 'glm-5.3').defaultEffort, 'high')
    assert.deepEqual(router.listModels().map(model => model.id), ['glm-5.3'])
    const request = await lastBuild.getFetch()
    assert.equal(await request(), 'u-1')
    await call('workbuddy.setModelEnabled', { modelId: 'step-5-preview', enabled: true })
    await call('workbuddy.setModelEnabled', { modelId: 'glm-5.3', enabled: false })
    assert.deepEqual(router.listModels().map(model => model.id), ['step-5-preview'])
    await call('workbuddy.setModelParams', { modelId: 'glm-5.3', params: { reasoningEffort: 'medium', maxTokens: 32_000, supportsImage: false } })
    await call('workbuddy.resetModels')
    assert.deepEqual(router.listModels().map(model => model.id), ['glm-5.3'])
    assert.equal(router.listModels()[0].effectiveEffort, 'medium')
    assert.equal(router.listModels()[0].maxOutputLength, 32_000)
    assert.equal(router.listModels()[0].vision, false)
    manager.dispose()
    deps.plugin.provider.models = async () => { throw new Error('offline fixture') }
    manager = createWorkBuddyManager(ctx, config, deps)
    assert.equal((await call('workbuddy.models')).source, 'cached')
    assert.equal(router.listModels().length, 1)
    assert.equal(router.listModels()[0].id, 'glm-5.3')
    assert.equal(router.listModels()[0].effectiveEffort, 'medium')
  } finally {
    manager.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
const accountRefPattern = new RegExp(`^${WORKBUDDY_ACCOUNT_REF_PREFIX}[0-9A-F]{6}$`)
const indexOf = creds => JSON.parse(creds.values.get(WORKBUDDY_ACCOUNTS_REF))

test('空索引快照返回 accounts:[] 与空登录地址，不发任何请求', async () => {
  const creds = credentialsFixture()
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async calls => {
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.deepEqual(snapshot.accounts, [])
      assert.equal(snapshot.loginUrl, null)
      assert.equal(calls.length, 0, '没有账号不得发出网络请求')
      // 索引缺失但旧引用也没有：不写索引（不制造空数据）。
      assert.equal(creds.operations.some(([op, key]) => op === 'set' && key === WORKBUDDY_ACCOUNTS_REF), false)
    })
  } finally {
    manager.dispose()
  }
})

test('旧单账号采纳为第一个账号：写索引与新引用，然后清除旧引用', async () => {
  const creds = credentialsFixture()
  creds.values.set(WORKBUDDY_LEGACY_AUTH_REF, authJson('ACCESS_SECRET_TOKEN', 'REFRESH_SECRET_TOKEN'))
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async calls => {
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.equal(snapshot.accounts.length, 1)
      const [account] = snapshot.accounts
      assert.match(account.id, accountIdPattern)
      assert.equal(account.name, '测试用户', '展示名取旧凭据的 accountId')
      assert.equal(account.uid, 'u-1')
      assert.equal(account.signedIn, true)
      assert.equal(account.error, '')
      assert.ok(account.windows.length > 0)
      // 索引与新引用已落盘，旧引用按项目约定只清除。
      const index = indexOf(creds)
      assert.equal(index.length, 1)
      assert.match(index[0].credentialRef, accountRefPattern)
      assert.equal(index[0].id, account.id)
      assert.equal(index[0].name, '测试用户')
      const stored = JSON.parse(creds.values.get(index[0].credentialRef))
      assert.equal(stored.access, 'ACCESS_SECRET_TOKEN')
      assert.equal(stored.type, 'oauth')
      assert.equal(creds.values.has(WORKBUDDY_LEGACY_AUTH_REF), false, '采纳后必须清除旧引用')
      assert.ok(creds.operations.some(([op, key]) => op === 'unset' && key === WORKBUDDY_LEGACY_AUTH_REF))
      // 再次快照不重复采纳：仍是同一个账号。
      const again = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.deepEqual(again.accounts.map(a => a.id), [account.id])
      assert.equal(indexOf(creds).length, 1)
      // 快照里不得出现凭据原文。
      assert.doesNotMatch(JSON.stringify(snapshot), /ACCESS_SECRET_TOKEN|REFRESH_SECRET_TOKEN/)
      assert.ok(calls.length > 0, '采纳后应真的读了额度')
    })
  } finally {
    manager.dispose()
  }
})

test('旧单账号损坏或采纳写盘失败时按空账号处理，不抛错也不销毁旧凭据', async () => {
  // 旧凭据不是合法 JSON：不采纳、不清除。
  const broken = credentialsFixture()
  broken.values.set(WORKBUDDY_LEGACY_AUTH_REF, '{not-json')
  const first = createWorkBuddyManager(context(broken))
  try {
    const snapshot = await first.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.deepEqual(snapshot.accounts, [])
    assert.equal(broken.values.has(WORKBUDDY_LEGACY_AUTH_REF), true, '损坏的旧凭据不静默销毁')
  } finally {
    first.dispose()
  }
  // 索引写失败：本次按空账号处理，刚写的新引用回滚，旧引用保留待下次重试。
  const failing = credentialsFixture({ failSet: key => key === WORKBUDDY_ACCOUNTS_REF })
  failing.values.set(WORKBUDDY_LEGACY_AUTH_REF, authJson('ACCESS_SECRET_TOKEN', 'REFRESH_SECRET_TOKEN'))
  const second = createWorkBuddyManager(context(failing))
  try {
    const snapshot = await second.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.deepEqual(snapshot.accounts, [])
    assert.equal(failing.values.has(WORKBUDDY_LEGACY_AUTH_REF), true)
    const written = failing.operations.filter(([op, key]) => op === 'set' && key.startsWith(WORKBUDDY_ACCOUNT_REF_PREFIX))
    assert.equal(written.length, 1, '应尝试写一次新凭据引用')
    assert.ok(failing.operations.some(([op, key]) => op === 'unset' && key === written[0][1]), '索引失败要回滚新引用')
  } finally {
    second.dispose()
  }
})

test('浏览器登录新增账号：凭据落独立引用、索引追加、返回值不含 token', async () => {
  const creds = credentialsFixture()
  const ctx = context(creds)
  const manager = createWorkBuddyManager(ctx)
  let logins = 0
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v2/plugin/auth/state')) return env({ state: `st-${logins + 1}`, authUrl: 'https://copilot.tencent.com/login?from=plugin' })
      if (call.path.startsWith('/v2/plugin/auth/token')) {
        return env({ accessToken: `ACCESS_${logins + 1}`, refreshToken: `REFRESH_${logins + 1}`, expiresIn: 3600, tokenType: 'Bearer' })
      }
      if (call.path.startsWith('/v2/plugin/login/account')) {
        return env({ uid: `u-${logins + 1}`, nickname: `账号${logins + 1}`, type: 'personal' })
      }
      return usageStub()(call)
    }, async () => {
      const first = await manager.call('workbuddy.login', { provider: 'workbuddy' })
      assert.equal(first.signedIn, true)
      assert.match(first.id, accountIdPattern)
      assert.equal(first.uid, 'u-1')
      assert.doesNotMatch(JSON.stringify(first), /ACCESS_1|REFRESH_1/)
      let index = indexOf(creds)
      assert.equal(index.length, 1)
      assert.equal(index[0].id, first.id)
      assert.match(index[0].credentialRef, accountRefPattern)
      assert.equal(JSON.parse(creds.values.get(index[0].credentialRef)).access, 'ACCESS_1')
      // 登录期间地址经 emit 与快照透出，结束后不残留。
      assert.ok(ctx.emitted.some(e => e.type === 'unified-router.workbuddy.login-url' && e.payload.loginUrl))
      assert.equal((await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })).loginUrl, null)
      // 第二次登录：新增账号，id 与引用都不重复。
      logins = 1
      const second = await manager.call('workbuddy.login', { provider: 'workbuddy' })
      assert.notEqual(second.id, first.id)
      index = indexOf(creds)
      assert.equal(index.length, 2)
      assert.notEqual(index[1].credentialRef, index[0].credentialRef)
      assert.equal(JSON.parse(creds.values.get(index[1].credentialRef)).access, 'ACCESS_2')
    })
  } finally {
    manager.dispose()
  }
})

test('登录地址非法时整个登录作废，不写凭据也不建账号', async () => {
  const creds = credentialsFixture()
  const manager = createWorkBuddyManager(context(creds), {}, {
    authorize: async () => ({ url: 'javascript:alert(1)', method: 'auto', async callback() { return { type: 'success', access: 'x' } } }),
  })
  try {
    await assert.rejects(manager.call('workbuddy.login', { provider: 'workbuddy' }), /登录地址无效/)
    assert.equal(creds.values.has(WORKBUDDY_ACCOUNTS_REF), false)
    assert.equal(creds.operations.some(([op, key]) => op === 'set' && key.startsWith(WORKBUDDY_ACCOUNT_REF_PREFIX)), false)
  } finally {
    manager.dispose()
  }
})

test('账号上限：已有 8 个账号时登录被拒', async () => {
  const creds = credentialsFixture()
  const rows = Array.from({ length: WORKBUDDY_MAX_ACCOUNTS }, (_, i) => ({
    entry: {
      id: `workbuddy-${String(i).padStart(8, '0')}`,
      credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}${String(i).padStart(6, 'A')}`,
      name: `账号${i}`, uid: `u-${i}`, createdAt: i,
    },
    auth: { type: 'oauth', access: `ACCESS_${i}`, uid: `u-${i}` },
  }))
  seed(creds, rows)
  const manager = createWorkBuddyManager(context(creds), {}, {
    authorize: async () => ({ url: 'https://copilot.tencent.com/login', method: 'auto', async callback() { return { type: 'success', access: 'NEW' } } }),
  })
  try {
    await assert.rejects(manager.call('workbuddy.login', { provider: 'workbuddy' }), /账号数量已达上限/)
    assert.equal(indexOf(creds).length, WORKBUDDY_MAX_ACCOUNTS)
  } finally {
    manager.dispose()
  }
})

test('双账号快照逐账号聚合：一个账号读失败不影响另一个', async () => {
  const creds = credentialsFixture()
  seed(creds, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', expires: Date.now() + 3600_000, uid: 'u-1', accountId: '账号甲' } },
    { entry: SEED.b, auth: { type: 'oauth', access: 'ACCESS_B', refresh: 'REFRESH_B', expires: Date.now() + 3600_000, uid: 'u-2', accountId: '账号乙' } },
  ])
  const manager = createWorkBuddyManager(context(creds))
  try {
    const stub = usageStub({ summary: {
      'u-2': JSON.stringify({ code: 10001, msg: 'uid or enterpriseID is empty; INTERNAL_SECRET_BODY' }),
    } })
    await withFetch(stub, async () => {
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.deepEqual(snapshot.accounts.map(a => a.id), [SEED.a.id, SEED.b.id])
      const [ok, bad] = snapshot.accounts
      assert.equal(ok.name, '账号甲')
      assert.equal(ok.signedIn, true)
      assert.equal(ok.error, '')
      assert.equal(ok.plan, 'Pro')
      assert.ok(ok.windows.some(w => w.name === 'Credits'))
      // 失败账号收成固定码，但仍保留登录事实（上游只是读失败）。
      assert.equal(bad.signedIn, true)
      assert.equal(bad.error, 'auth_error')
      assert.deepEqual(bad.windows, [])
      assert.doesNotMatch(JSON.stringify(snapshot), /ACCESS_A|ACCESS_B|INTERNAL_SECRET_BODY/)
    })
  } finally {
    manager.dispose()
  }
})

test('续期结果只回写给触发续期的那个账号', async () => {
  const creds = credentialsFixture()
  const expired = { expires: Date.now() - 1000 }
  seed(creds, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'OLD_A', refresh: 'REFRESH_A', uid: 'u-1', accountId: '账号甲', ...expired } },
    { entry: SEED.b, auth: { type: 'oauth', access: 'OLD_B', refresh: 'REFRESH_B', uid: 'u-2', accountId: '账号乙', ...expired } },
  ])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v2/plugin/auth/token/refresh')) {
        // 按刷新令牌区分账号：每个账号只拿到自己的新令牌。
        const suffix = call.refresh === 'REFRESH_A' ? 'A' : 'B'
        return env({ accessToken: `NEW_${suffix}`, refreshToken: `NEWREFRESH_${suffix}`, expiresIn: 3600 })
      }
      return usageStub()(call)
    }, async () => {
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.equal(snapshot.accounts.length, 2)
      const a = JSON.parse(creds.values.get(SEED.a.credentialRef))
      const b = JSON.parse(creds.values.get(SEED.b.credentialRef))
      assert.equal(a.access, 'NEW_A', '账号甲的续期结果必须写回甲的引用')
      assert.equal(a.refresh, 'NEWREFRESH_A')
      assert.equal(a.uid, 'u-1')
      assert.equal(a.accountId, '账号甲')
      assert.equal(b.access, 'NEW_B', '账号乙的续期结果必须写回乙的引用')
      assert.equal(b.refresh, 'NEWREFRESH_B')
      assert.equal(b.uid, 'u-2')
      assert.doesNotMatch(JSON.stringify(snapshot), /NEW_A|NEW_B|OLD_A|OLD_B/)
    })
  } finally {
    manager.dispose()
  }
})

test('已删除账号的续期不得复活凭据', async () => {
  const creds = credentialsFixture()
  seed(creds, [{ entry: SEED.a, auth: { type: 'oauth', access: 'OLD_A', refresh: 'REFRESH_A', uid: 'u-1', expires: Date.now() - 1000 } }])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v2/plugin/auth/token/refresh')) return env({ accessToken: 'NEW_A', refreshToken: 'NEWREFRESH_A', expiresIn: 3600 })
      return usageStub()(call)
    }, async () => {
      // 并发地删掉账号：索引清空后，接下来这条续期回写必须被丢弃。
      const pending = manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      await manager.call('workbuddy.logout', { provider: 'workbuddy', accountId: SEED.a.id })
      await pending
      assert.equal(creds.values.has(SEED.a.credentialRef), false, '已删除账号的凭据不能被续期写回')
      assert.deepEqual(indexOf(creds), [])
    })
  } finally {
    manager.dispose()
  }
})

test('按账号签到：只签指定的那个账号', async () => {
  const creds = credentialsFixture()
  seed(creds, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', expires: Date.now() + 3600_000, uid: 'u-1', accountId: '账号甲' } },
    { entry: SEED.b, auth: { type: 'oauth', access: 'ACCESS_B', refresh: 'REFRESH_B', expires: Date.now() + 3600_000, uid: 'u-2', accountId: '账号乙' } },
  ])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v2/billing/meter/checkin-activity-status')) return env({ active: true, today_checked_in: false })
      if (call.path.startsWith('/v2/billing/meter/daily-checkin')) {
        return env({ credit: call.uid === 'u-2' ? 99 : 10, streak_days: call.uid === 'u-2' ? 7 : 3, message: 'UPSTREAM_MESSAGE_NEVER_SHOWN' })
      }
      return usageStub()(call)
    }, async calls => {
      const second = await manager.call('workbuddy.checkin', { provider: 'workbuddy', accountId: SEED.b.id })
      assert.deepEqual(second, { outcome: 'claimed', credit: 99, streak: 7, error: '' })
      const first = await manager.call('workbuddy.checkin', { provider: 'workbuddy', accountId: SEED.a.id })
      assert.deepEqual(first, { outcome: 'claimed', credit: 10, streak: 3, error: '' })
      assert.doesNotMatch(JSON.stringify([first, second]), /ACCESS_A|ACCESS_B|UPSTREAM_MESSAGE_NEVER_SHOWN/)
      // 每个账号各打一次签到接口，没有串号。
      const checkins = calls.filter(c => c.path.startsWith('/v2/billing/meter/daily-checkin'))
      assert.deepEqual(checkins.map(c => c.uid), ['u-2', 'u-1'])
    })
  } finally {
    manager.dispose()
  }
})

test('签到/退出/目录都必须点名已存在的账号', async () => {
  const creds = credentialsFixture()
  seed(creds, [{ entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', expires: Date.now() + 3600_000, uid: 'u-1' } }])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async () => {
      // 签到与退出必须点名账号（多账号下没有「当前账号」）；目录的 accountId 可选。
      for (const method of ['workbuddy.checkin', 'workbuddy.logout']) {
        await assert.rejects(manager.call(method, { provider: 'workbuddy' }), /账号已变化/, `${method} 缺 accountId 必须拒绝`)
        await assert.rejects(manager.call(method, { provider: 'workbuddy', accountId: 'workbuddy-ffffffff' }), /账号已变化/, `${method} 未知 accountId 必须拒绝`)
      }
      await assert.rejects(manager.call('workbuddy.models', { provider: 'workbuddy', accountId: 'workbuddy-ffffffff' }), /账号已变化/, 'models 指定了未知账号也必须拒绝')
      assert.equal(indexOf(creds).length, 1, '拒绝的操作不得改动索引')
    })
  } finally {
    manager.dispose()
  }
})

test('按账号退出：只删该账号的凭据与索引条目', async () => {
  const creds = credentialsFixture()
  seed(creds, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', uid: 'u-1' } },
    { entry: SEED.b, auth: { type: 'oauth', access: 'ACCESS_B', refresh: 'REFRESH_B', uid: 'u-2' } },
  ])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async () => {
      const result = await manager.call('workbuddy.logout', { provider: 'workbuddy', accountId: SEED.b.id })
      assert.deepEqual(result, { signedIn: false })
      assert.equal(creds.values.has(SEED.b.credentialRef), false)
      assert.equal(creds.values.has(SEED.a.credentialRef), true, '另一个账号的凭据必须留下')
      assert.deepEqual(indexOf(creds).map(row => row.id), [SEED.a.id])
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.deepEqual(snapshot.accounts.map(a => a.id), [SEED.a.id])
    })
  } finally {
    manager.dispose()
  }
})

test('账号索引损坏时按空账号处理，不抛错也不覆盖原数据', async () => {
  const creds = credentialsFixture()
  creds.values.set(WORKBUDDY_ACCOUNTS_REF, '{not-json')
  const manager = createWorkBuddyManager(context(creds))
  try {
    const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.deepEqual(snapshot.accounts, [])
    assert.equal(creds.values.get(WORKBUDDY_ACCOUNTS_REF), '{not-json', '损坏的索引不被覆盖')
  } finally {
    manager.dispose()
  }
  // 条目形状不合约（id/引用命名不符）时逐条丢弃，只留合法条目。
  const mixed = credentialsFixture()
  mixed.values.set(WORKBUDDY_ACCOUNTS_REF, JSON.stringify([
    { id: 'not-a-workbuddy-id', credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}ABCDEF` },
    { id: 'workbuddy-cccccccc', credentialRef: 'WRONG_PREFIX' },
    { id: 'workbuddy-aaaaaaaa', credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}AAAAAA`, name: '账号甲', uid: 'u-1' },
    'garbage',
  ]))
  mixed.values.set(SEED.a.credentialRef, JSON.stringify({ type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', uid: 'u-1' }))
  const second = createWorkBuddyManager(context(mixed))
  try {
    await withFetch(usageStub(), async () => {
      const snapshot = await second.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.deepEqual(snapshot.accounts.map(a => a.id), [SEED.a.id])
    })
  } finally {
    second.dispose()
  }
})

test('模型目录：指定账号优先，否则用第一个已登录账号，未登录回落站点清单', async () => {
  const creds = credentialsFixture()
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async calls => {
      // 未登录：hook 直接回站点清单（不发请求）。
      const offline = await manager.call('workbuddy.models', { provider: 'workbuddy' })
      assert.ok(offline.models.length >= 3)
      assert.ok(offline.models.every(m => typeof m.id === 'string' && m.id))
      assert.equal(calls.length, 0)
    })
  } finally {
    manager.dispose()
  }
  const seeded = credentialsFixture()
  seed(seeded, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', expires: Date.now() + 3600_000, uid: 'u-1' } },
    // 乙的凭据损坏：目录仍应取第一个「已登录」的甲。
    { entry: SEED.b, auth: '{broken' },
  ])
  const second = createWorkBuddyManager(context(seeded))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v3/config')) {
        return env({ models: [{ id: `m-${call.uid}`, name: `模型 ${call.uid}`, credits: 'x0.00' }], agents: [{ name: 'cli', models: [`m-${call.uid}`] }] })
      }
      return usageStub()(call)
    }, async () => {
      const live = await second.call('workbuddy.models', { provider: 'workbuddy' })
      assert.deepEqual(live.models.map(m => m.id), ['m-u-1'])
      assert.equal(live.models[0].free, true)
      const explicit = await second.call('workbuddy.models', { provider: 'workbuddy', accountId: SEED.a.id })
      assert.deepEqual(explicit.models.map(m => m.id), ['m-u-1'])
      assert.doesNotMatch(JSON.stringify(live), /ACCESS_A/)
    })
  } finally {
    second.dispose()
  }
})

test('取消：预中止的快照立即拒绝；登录等待中取消后清理登录地址且不留账号', async () => {
  const creds = credentialsFixture()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const manager = createWorkBuddyManager(context(creds), {}, {
    authorize: async () => ({ url: 'https://copilot.tencent.com/login?x=1', method: 'auto', callback: () => gate }),
  })
  try {
    const preAborted = new AbortController()
    preAborted.abort()
    await assert.rejects(manager.call('workbuddy.snapshot', { provider: 'workbuddy' }, preAborted.signal))

    const controller = new AbortController()
    const pending = manager.call('workbuddy.login', { provider: 'workbuddy' }, controller.signal)
    // 等 authorize 完成、登录地址挂上后再取消。
    await new Promise(resolve => setTimeout(resolve, 30))
    const during = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.equal(during.loginUrl, 'https://copilot.tencent.com/login?x=1')
    controller.abort()
    await assert.rejects(pending)
    const after = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
    assert.equal(after.loginUrl, null, '取消后不得残留登录地址')
    release({ type: 'failed', error: 'test release' })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(creds.values.has(WORKBUDDY_ACCOUNTS_REF), false, '取消的登录不得建账号')
  } finally {
    manager.dispose()
  }
})

test('dispose 后所有方法拒绝且不再发请求', async () => {
  const creds = credentialsFixture()
  seed(creds, [{ entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', uid: 'u-1' } }])
  const manager = createWorkBuddyManager(context(creds))
  await withFetch(usageStub(), async calls => {
    manager.dispose()
    manager.dispose()
    await assert.rejects(manager.call('workbuddy.snapshot', { provider: 'workbuddy' }), /请求已结束/)
    await assert.rejects(manager.call('workbuddy.checkin', { provider: 'workbuddy', accountId: SEED.a.id }), /请求已结束/)
    assert.equal(calls.length, 0)
  })
})

test('任意输入形状不抛未捕获异常，方法名与 provider 受校验', async () => {
  const creds = credentialsFixture()
  seed(creds, [{ entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', uid: 'u-1' } }])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await assert.rejects(manager.call('workbuddy.nope', { provider: 'workbuddy' }), /不支持此操作/)
    await assert.rejects(manager.call('workbuddy.login', { provider: 'other' }), /不支持此渠道/)
    for (const payload of ['a string', 42, null, undefined, ['workbuddy'], { provider: 'x'.repeat(100000) }]) {
      await assert.rejects(manager.call('workbuddy.checkin', payload), /不支持此渠道/)
    }
    // 合法 provider 但带任意嵌套垃圾字段：不抛错，按账号已变化收编。
    await assert.rejects(manager.call('workbuddy.checkin', { provider: 'workbuddy', nested: { deep: { array: [1, { two: 2 }] } } }), /账号已变化/)
    // snapshot 只关心自身，不受 payload 形状影响。
    const snapshot = await manager.call('workbuddy.snapshot', 'not-an-object')
    assert.equal(Array.isArray(snapshot.accounts), true)
    assert.equal(WORKBUDDY_METHODS.has('workbuddy.snapshot'), true)
  } finally {
    manager.dispose()
  }
})

test('凭据原文永远不出现在任何返回值里（投影白名单兜底）', async () => {
  const creds = credentialsFixture()
  seed(creds, [{ entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_SECRET_TOKEN', refresh: 'REFRESH_SECRET_TOKEN', uid: 'u-1', accountId: '测试用户' } }])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/billing/meter/get-user-resource-summary')) {
        return env({ IsPaidUser: false, CreditGroups: [], Packages: [], WeirdField: 'ACCESS_SECRET_TOKEN' })
      }
      if (call.path.startsWith('/v2/billing/meter/checkin-activity-status')) return env({ active: false })
      return usageStub()(call)
    }, async () => {
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      const models = await manager.call('workbuddy.models', { provider: 'workbuddy', accountId: SEED.a.id })
      const checked = await manager.call('workbuddy.checkin', { provider: 'workbuddy', accountId: SEED.a.id })
      const payload = JSON.stringify([snapshot, models, checked])
      assert.doesNotMatch(payload, /ACCESS_SECRET_TOKEN|REFRESH_SECRET_TOKEN/)
      // 账号展示名与 uid 属契约内的账号标识，允许出现在快照里。
      assert.equal(snapshot.accounts[0].name, '账号甲')
      assert.equal(snapshot.accounts[0].uid, 'u-1')
      assert.ok(_internal.configModels)
    })
  } finally {
    manager.dispose()
  }
})

test('WorkBuddy 签到收到上游 5xx 后只提交一次', async () => {
  const creds = credentialsFixture()
  seed(creds, [
    { entry: SEED.a, auth: { type: 'oauth', access: 'ACCESS_A', refresh: 'REFRESH_A', expires: Date.now() + 3600_000, uid: 'u-1', accountId: '账号甲' } },
  ])
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(call => {
      if (call.path.startsWith('/v2/billing/meter/checkin-activity-status')) return env({ active: true, today_checked_in: false })
      if (call.path.startsWith('/v2/billing/meter/daily-checkin')) return new Response('{}', { status: 503 })
      return usageStub()(call)
    }, async calls => {
      const result = await manager.call('workbuddy.checkin', { provider: 'workbuddy', accountId: SEED.a.id })
      assert.equal(result.outcome, 'failed')
      assert.equal(calls.filter(call => call.path.startsWith('/v2/billing/meter/daily-checkin')).length, 1)
    })
  } finally { manager.dispose() }
})

test('账号开关：停用写入索引并反映到快照，凭据保留', async () => {
  const creds = credentialsFixture()
  const id = 'workbuddy-aaaaaaaa', ref = `${WORKBUDDY_ACCOUNT_REF_PREFIX}AAAAAA`
  creds.values.set(WORKBUDDY_ACCOUNTS_REF, JSON.stringify([{ id, credentialRef: ref, name: '主号', uid: 'u-1', createdAt: 1 }]))
  creds.values.set(ref, JSON.stringify({ type: 'oauth', access: 'a1', accountId: 'u-1' }))
  const manager = createWorkBuddyManager(context(creds))
  try {
    await withFetch(usageStub(), async () => {
      await manager.call('workbuddy.setAccountEnabled', { provider: 'workbuddy', accountId: id, enabled: false })
      assert.equal(indexOf(creds)[0].enabled, false, '停用必须写进索引')
      assert.ok(creds.values.has(ref), '停用不得删除凭据（重新启用即恢复）')
      const snapshot = await manager.call('workbuddy.snapshot', { provider: 'workbuddy' })
      assert.equal(snapshot.accounts.find(row => row.id === id).enabled, false)
      await manager.call('workbuddy.setAccountEnabled', { provider: 'workbuddy', accountId: id, enabled: true })
      assert.equal(indexOf(creds)[0].enabled, undefined, '启用时不写字段（缺省即启用）')
      await assert.rejects(
        manager.call('workbuddy.setAccountEnabled', { provider: 'workbuddy', accountId: id, enabled: 'yes' }),
        /账号开关无效/,
      )
    })
  } finally { manager.dispose() }
})

test('推理 429：自动切到下一个启用账号，跳过已停用账号', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-failover-'))
  const creds = credentialsFixture()
  const [a, b, c] = [['aaaaaaaa', 'AAAAAA'], ['bbbbbbbb', 'BBBBBB'], ['cccccccc', 'CCCCCC']].map(([hex, ref6]) => ({
    id: `workbuddy-${hex}`, credentialRef: `${WORKBUDDY_ACCOUNT_REF_PREFIX}${ref6}`, uid: `u-${hex}`,
  }))
  creds.values.set(WORKBUDDY_ACCOUNTS_REF, JSON.stringify([
    { ...a, name: '主号', createdAt: 1 },
    { ...b, name: '停用号', createdAt: 2, enabled: false },
    { ...c, name: '备号', createdAt: 3 },
  ]))
  for (const row of [a, b, c]) {
    creds.values.set(row.credentialRef, JSON.stringify({ type: 'oauth', access: `token-${row.uid}`, accountId: row.uid }))
  }
  const hits = []
  let lastBuild
  const provider = 'workbuddy'
  const catalog = [
    { id: 'glm-5.3', name: 'GLM 5.3', enabled: true, api: { npm: '@ai-sdk/openai-compatible' }, limit: { context: 128_000, output: 64_000 } },
  ]
  const ctx = context(creds, { llm: { registerAdapter() { return () => {} } } })
  const deps = {
    plugin: {
      provider: { models: async () => catalog },
      auth: {
        async loader(getAuth) {
          const auth = await getAuth()
          return {
            fetch: async () => {
              hits.push(auth.accountId)
              // 主号额度耗尽：上游回 429；备号正常。
              return auth.accountId === a.uid
                ? new Response('{"error":"rate_limited"}', { status: 429 })
                : new Response('{"ok":true}', { status: 200 })
            },
          }
        },
      },
    },
    loadLlmAdapter: async () => ({
      createWorkBuddyAdapter(options) {
        lastBuild = options
        return { adapter: { listModels: () => options.catalog }, providerIds: [provider] }
      },
    }),
  }
  const config = { modelSettingsFile: join(dir, 'preferences.json'), catalogFile: join(dir, 'catalog.json') }
  const manager = createWorkBuddyManager(ctx, config, deps)
  try {
    await manager.call('workbuddy.models', { provider })
    const fetch = await lastBuild.getFetch()
    const response = await fetch('https://copilot.tencent.com/v2/chat/completions', { method: 'POST', body: '{"messages":[]}' })
    assert.equal(response.status, 200, '主号 429 后应拿到备号的正常响应')
    assert.deepEqual(hits, [a.uid, c.uid], '先试主号，再跳过停用账号直接用备号')
  } finally {
    manager.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
