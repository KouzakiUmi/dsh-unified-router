import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { modelRecommendationExclusions } from '../lib/model-catalog.js'

test('推荐按发版批次和同渠道性能倍率筛选，保留能力有差异及缺少证据的型号', () => {
  const model = (id, rate, extra = {}) => ({ id, rate, contextWindow: 1_000_000, supportsImage: true, ...extra })
  const exclusions = modelRecommendationExclusions([
    model('deepseek-v4-1-flash-0901', 0.1),
    model('deepseek-v4-1-flash-1017', 0.3),
    model('glm-5-3', 0.6),
    model('step-5-preview', 0.5),
    model('kimi-k3-1-pro', 0.5, { supportsImage: false }),
    model('glm-5-3-flash', 0, { free: true }),
    model('unknown-expensive', 1),
    model('qwen-4-max', 0.5, { contextWindow: 128_000 }),
    model('qwen-5-max-preview', 0.4, { contextWindow: 128_000 }),
  ])
  assert.deepEqual([...exclusions].map(([id, reason]) => [id, reason.kind, reason.alternative]), [
    ['deepseek-v4-1-flash-0901', 'older', 'deepseek-v4-1-flash-1017'],
    ['step-5-preview', 'value', 'glm-5-3-flash'],
    ['glm-5-3', 'value', 'glm-5-3-flash'],
  ])
  const samePrice = modelRecommendationExclusions([
    model('glm-5-3-flash', 0.4), model('qwen-4-max', 0.4),
  ])
  assert.equal(samePrice.size, 0, '保留同价、用途不同的模型')
  const qoder = rate => [
    model('dmodel', rate, { name: '随时可变的供应商显示名' }),
    model('dfmodel', 0.1),
    model('unrelated', 0.9, { name: 'DeepSeek V4 Pro 0813' }),
  ]
  assert.deepEqual([...modelRecommendationExclusions(qoder(0.5), 'qodercn')], [
    ['dmodel', { kind: 'value', alternative: 'dfmodel' }],
  ])
  assert.equal(modelRecommendationExclusions(qoder(0.12), 'qodercn').size, 0)
  assert.equal(modelRecommendationExclusions(qoder(0.5), 'loomy').size, 0, 'Qoder 的别名不外溢')
})

test('独立后端渠道的精选列表、启停恢复与持久化', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.startsWith('@deepseek-ai/') ? { url: kernel, shortCircuit: true } : next(specifier, context) } })
  const originalHome = process.env.DSH_HOME; const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR; const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch; process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
  let network = 0; globalThis.fetch = async () => { network++; throw new Error('offline fixture') }
  const cleanup = []; const adapters = new Map(); const credentials = new Map(); const writes = []
  const services = {
    profileContext: { home: scratch },
    credentials: { resolve: async ref => credentials.get(ref), describe: async () => undefined,
      set: async (ref,value) => { writes.push(ref); credentials.set(ref, { value }) }, unset: async ref => credentials.delete(ref) },
    llm: { registerAdapter(ids, adapter) { for (const id of ids) adapters.set(id, adapter) }, listProviders: () => [...adapters.keys()].map(id => ({ id })),
      listModels: async id => adapters.get(id).listModels(id) },
    connection: { fetch: { register() { throw new Error('native-only must not mount HTTP RPC') } } },
  }
  const ctx = { ...services, logger: { info() {}, warn() {}, error() {}, debug() {} }, get: key => services[key],
    provide(key, value) { this[key] = services[key] = value },
    effect(fn) { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
    inject(deps, fn) { if (deps.every(d => services[d])) fn(this) }, emit() {} }
  try {
    let rpc
    const { mountBackend } = await import('../lib/backend.js')
    const pool = mountBackend(ctx, call => { rpc = call })
    // raccoon 家族拆成免费版 / 订阅版两个 provider（各自独立的适配器与账号池）。
    assert.deepEqual([...adapters.keys()].sort(), ['loomy', 'qodercn', 'raccoon', 'raccoon-pro', 'trae'])
    assert.notEqual(ctx.traeAuth, undefined); assert.equal(ctx.qoderAuth, undefined)
    assert.equal(writes.length, 0); assert.equal(network, 0)
    assert.equal(typeof rpc, 'function')
    await pool.addAccount({ id: 'loomy-fixture', provider: 'loomy', nickname: '离线测试', credentialRef: 'FIXTURE', enabled: true, refreshable: false, createdAt: 1 })
    const list = await rpc('account.list', { provider: 'loomy' }); assert.equal(list.ok, true); assert.equal(list.value.accounts.length, 1)
    const lock = await rpc('credits.permanentLock', { provider: 'loomy', locked: true }); assert.equal(lock.value.locked, true)
    for (const provider of ['loomy', 'qodercn', 'raccoon', 'raccoon-pro', 'trae']) {
      const catalog = await rpc('model.list', { provider }); assert.equal(catalog.ok, true)
      assert.ok(catalog.value.models.length > 0, provider)
      const modelId = catalog.value.models[0].id
      assert.equal((await rpc('model.setDisabled', { provider, modelId, disabled: true })).ok, true)
      const disabled = await rpc('model.list', { provider }); assert.equal(disabled.value.models.find(m => m.id === modelId).disabled, true)
      assert.equal((await rpc('model.setDisabled', { provider, modelId, disabled: false })).ok, true)
    }
    await pool.addAccount({ id: 'loomy-second', provider: 'loomy', nickname: '第二账号', credentialRef: 'FIXTURE_TWO', enabled: true, refreshable: false, createdAt: 2 })
    credentials.set('FIXTURE', { value: '{}' }); credentials.set('FIXTURE_TWO', { value: '{}' })
    const controller = new AbortController(); let claims = 0
    ctx.loomyAuth.claimDailyQuota = async () => { claims++; controller.abort(); return { kind: 'claimed', credit: 1 } }
    await assert.rejects(rpc('credits.claimAll', { provider: 'loomy' }, controller.signal))
    assert.equal(claims, 1)
    ctx.loomyAuth.claimDailyQuota = async () => { claims++; return { kind: 'claimed', credit: 1 } }
    const targeted = await rpc('credits.claimAll', { provider: 'loomy', accountIds: ['loomy-second'] })
    assert.equal(targeted.ok, true)
    assert.deepEqual(targeted.value.results.map(row => row.accountId), ['loomy-second'])
    assert.equal(claims, 2, '已签到的另一账号不会再次提交')
    const { publicResult } = await import('../lib/web-host.js')
    const providers = ['loomy', 'raccoon', 'raccoon-pro', 'qodercn', 'trae']
    // 恢复推荐只更新开关，目录仍保留所有上游模型。
    const expected = {
      loomy: { total: 7, off: ['DeepSeek-V4.1-Flash', 'mimo-v2.5'], legacy: [] },
      raccoon: { total: 7, off: ['sn-glm-5-3'], legacy: [] },
      'raccoon-pro': { total: 7, off: ['sn-glm-5-3-p'], legacy: [] },
      // 同族旧版：kmodel（K2.8-Preview）在 Kimi-K3.1-Pro 之后。
      qodercn: { total: 14, off: ['kmodel', 'qmodel_38max', 'Qwen4-Max-Preview', 'dmodel', 'gmodel', 'Step-5-Preview'], legacy: ['kmodel'] },
      // 同族旧版：kimi-k3 / minimax-m3。
      trae: { total: 20, off: ['kimi-k3', 'minimax-m3', 'qwen3.8-max', 'DeepSeek-V4-Pro-Official', 'glm-5.3'], legacy: ['kimi-k3', 'minimax-m3'] },
    }
    // ⚠️ 每个被断言 `visible()` 的 provider 都必须有账号：适配器的
    // `providerCatalogVisible` 门禁在「无已登录账号」时返回 []（隐藏分组），
    // 不给 fixture 渠道加账号会让 `visible(provider)` 恒为空而非目录内容。
    for (const provider of ['qodercn', 'trae']) await pool.addAccount({
      id: `${provider}-fixture`, provider, nickname: '离线测试', credentialRef: 'FIXTURE', enabled: true, refreshable: false, createdAt: 3,
    })
    // Raccoon 家族：**单池**（账号都在 `raccoon`），靠 `plan` 分流到两个模型面。
    // 免费侧要一个 plan≠'pro' 的账号、订阅侧要一个 plan==='pro' 的账号。
    await pool.addAccount({
      id: 'raccoon-fixture', provider: 'raccoon', nickname: '免费账号', credentialRef: 'FIXTURE',
      enabled: true, refreshable: false, createdAt: 3, plan: 'free',
    })
    await pool.addAccount({
      id: 'raccoon-pro-fixture', provider: 'raccoon', nickname: '订阅账号', credentialRef: 'FIXTURE',
      enabled: true, refreshable: false, createdAt: 4, plan: 'pro',
    })
    const visible = async provider => (await services.llm.listModels(provider)).map(m => m.id).sort()
    const catalog = async provider => {
      const result = await rpc('model.list', { provider })
      assert.equal(result.ok, true)
      return publicResult('model.list', result.value).models
    }

    await t.test('恢复推荐关闭旧版和可替代的低性价比型号，仍可逐项打开', async () => {
      for (const provider of providers) {
        let models = await catalog(provider)
        assert.equal(models.length, expected[provider].total)
        // 只允许「同族旧版」这一种标记（trae: kimi-k3 / minimax-m3；qoder: kmodel）；
        // 它不是主观性价比判断，而是「同目录已有更新一代」这条事实。
        const legacy = models.filter(m => m.stale).map(m => m.id).sort()
        assert.deepEqual(legacy, [...(expected[provider].legacy ?? [])].sort(), `${provider} 的旧版标记`)
        assert.deepEqual(models.filter(m => m.disabled).map(m => m.id).sort(), [...expected[provider].off].sort(), provider)

        assert.deepEqual(await visible(provider), models.filter(m => !m.disabled).map(m => m.id).sort())
        const status = await rpc('provider.status', { providers: [provider] })
        assert.equal(status.value.statuses[provider].models.disabled, expected[provider].off.length)
        for (const modelId of expected[provider].off) {
          for (const disabled of [false, true]) {
            assert.equal((await rpc('model.setDisabled', { provider, modelId, disabled })).ok, true)
            models = await catalog(provider)
            assert.equal(models.find(m => m.id === modelId).disabled, disabled)
            assert.equal((await visible(provider)).includes(modelId), !disabled)
          }
        }
        await rpc('model.resetDefaults', { provider })
      }
    })

    await t.test('Raccoon 单池 + plan 选号：离线兜底表各自独立、账号只在一个池、选号按 plan', async () => {
      // 离线（fetch 桩一律抛错）时走各自兜底表：两侧各 7 条，订阅侧 id 带 `-p`。
      // ⚠️ 这里是**两张静态兜底表**的差异，不是把同一份远端目录按倍率切开 ——
      // 联机时两侧各用本侧账号凭据拉上游目录，互不裁剪（见文件末尾的同名用例）。
      const freeIds = (await catalog('raccoon')).map(m => m.id).sort()
      const proIds = (await catalog('raccoon-pro')).map(m => m.id).sort()
      assert.deepEqual(freeIds, [
        'sn-deepseek-v4-1-flash-1017', 'sn-glm-5-3', 'sn-glm-5-3-flash',
        'sn-kimi-k3-1-pro', 'sn-qwen4-max', 'sn-sensenova-6-8-flash', 'sn-sensenova-6-8-flash-lite',
      ])
      assert.deepEqual(proIds, [
        'sn-deepseek-v4-1-flash-1017-p', 'sn-glm-5-3-flash-p', 'sn-glm-5-3-p',
        'sn-kimi-k3-1-pro-p', 'sn-qwen4-max-p', 'sn-sensenova-6-8-flash-lite-p', 'sn-sensenova-6-8-flash-p',
      ])
      // 两张兜底表不相交：订阅侧 id 一律带 `-p`，不会与免费侧撞 id。
      assert.deepEqual(freeIds.filter(id => proIds.includes(id)), [])

      // **单池**：全部账号都在 `raccoon` 池（含订阅套餐账号），`raccoon-pro` 池为空。
      const freeAccounts = (await rpc('account.list', { provider: 'raccoon' })).value.accounts
      const proAccounts = (await rpc('account.list', { provider: 'raccoon-pro' })).value.accounts
      assert.deepEqual(freeAccounts.map(a => a.id), ['raccoon-fixture', 'raccoon-pro-fixture'])
      // 投影白名单带上 plan（界面徽标与分流判断都靠它）。
      assert.deepEqual(publicResult('account.list', { accounts: freeAccounts }).accounts.map(a => a.plan), ['free', 'pro'])
      assert.deepEqual(proAccounts, [])
      const status = (await rpc('provider.status', { providers: ['raccoon', 'raccoon-pro'] })).value.statuses
      assert.equal(status.raccoon.accounts.total, 2)
      assert.equal(status['raccoon-pro'].accounts.total, 0)
      assert.equal(status.raccoon.models.total, 7)
      assert.equal(status['raccoon-pro'].models.total, 7)

      // 选号按 plan：免费侧绝不选订阅账号，订阅侧绝不选免费账号。
      // 这里用 `nextAccount` 直观看「可选的号只剩哪一侧」：
      // 传空的 tried 集合时，免费侧只会给出免费账号、订阅侧只会给出订阅账号。
      const freePick = await adapters.get('raccoon').options.nextAccount('', new Set())
      assert.equal(freePick.accountId, 'raccoon-fixture')
      const proPick = await adapters.get('raccoon-pro').options.nextAccount('', new Set())
      assert.equal(proPick.accountId, 'raccoon-pro-fixture')
      // 本侧唯一的账号被排除（模拟请求内轮换已试过）后返回 undefined，
      // **不会**退而求其次拿对侧账号顶替。
      assert.equal(await adapters.get('raccoon').options.nextAccount('', new Set(['raccoon-fixture'])), undefined)
      assert.equal(await adapters.get('raccoon-pro').options.nextAccount('', new Set(['raccoon-pro-fixture'])), undefined)

      // 家族分派：订阅版被 onboarding 接受（走到「账号不存在」而不是
      // 「unsupported provider」），非家族渠道仍被拒。
      const proOnboarding = await rpc('onboarding.status', { provider: 'raccoon-pro', accountId: 'missing' })
      assert.equal(proOnboarding.ok, false)
      assert.match(proOnboarding.error.message, /账号不存在/)
      const otherOnboarding = await rpc('onboarding.status', { provider: 'qodercn', accountId: 'missing' })
      assert.match(otherOnboarding.error.message, /unsupported provider/)
      // 两个变体都没有每日签到端点，返回同一条可读错误（不发上游请求）。
      for (const provider of ['raccoon', 'raccoon-pro']) {
        const claim = await rpc('credits.claimAll', { provider })
        assert.equal(claim.ok, false)
        assert.match(claim.error.message, /不支持每日签到/)
      }
    })

    await t.test('登录一律进 raccoon 池，并按套餐探测结果自动打 plan 标', async () => {
      // 桩掉「登录流程 + 凭据落盘」两个外部边界，只验证本插件负责的那段：
      // 占位账号入池 → persistLogin → fetchPlan → updateAccount({ plan })。
      // ⚠️ 家族有**两个** auth 实例（免费 / 订阅各一个服务名），两条分支的
      // 登录后台任务共用同一段打标逻辑，故两个实例都要桩。
      const raccoon = ctx.raccoonAuth
      const raccoonPro = ctx.raccoonProAuth
      const originalStart = raccoon.startLogin
      const originalPersist = raccoon.persistLogin
      const originalStartPro = raccoonPro.startLogin
      const originalPersistPro = raccoonPro.persistLogin
      const originalFetch = globalThis.fetch
      const entitlement = { office: { pro_enable: true, active_plan: { type: 'subscription' } } }
      const sawUrls = []
      try {
        const fakeStart = async () => ({
          loginUrl: 'http://127.0.0.1:9/login',
          result: Promise.resolve({ access_token: 'login-token', refresh_token: 'refresh', office_identity: 'org' }),
        })
        const fakePersist = async credential => ({ access: JSON.stringify(credential), expires: 0, ref: 'REF', refreshable: true })
        raccoon.startLogin = fakeStart
        raccoon.persistLogin = fakePersist
        raccoonPro.startLogin = fakeStart
        raccoonPro.persistLogin = fakePersist
        globalThis.fetch = async url => {
          sawUrls.push(String(url))
          return new Response(JSON.stringify(entitlement), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        const listedPlan = async id => {
          const accounts = (await rpc('account.list', { provider: 'raccoon' })).value.accounts
          return accounts.find(account => account.id === id)?.plan ?? ''
        }
        const waitForPlan = async id => {
          for (let i = 0; i < 100; i++) {
            const plan = await listedPlan(id)
            if (plan !== '') return plan
            await new Promise(resolve => setTimeout(resolve, 5))
          }
          return ''
        }
        // 请求的是**订阅版**，但账号必须进 `raccoon` 池（单池），套餐只体现在 plan 上。
        const created = await rpc('account.create', { provider: 'raccoon-pro' })
        assert.equal(created.ok, true)
        const id = created.value.accountId
        assert.ok((await rpc('account.list', { provider: 'raccoon' })).value.accounts.some(a => a.id === id))
        assert.deepEqual((await rpc('account.list', { provider: 'raccoon-pro' })).value.accounts, [])
        assert.equal(await waitForPlan(id), 'pro')
        assert.ok(sawUrls.some(url => url.endsWith('/api/web/auth/v1/entitlement_info')), '套餐探测打的是权益端点')

        // 探测**失败**（403）时标 unknown（按免费侧处理），且登录本身照常成功。
        globalThis.fetch = async () => new Response('forbidden', { status: 403 })
        const failed = await rpc('account.create', { provider: 'raccoon' })
        assert.equal(failed.ok, true)
        assert.equal(await waitForPlan(failed.value.accountId), 'unknown')
        // 账号仍在池里（探测失败不删号、不阻塞登录）。
        assert.ok((await rpc('account.list', { provider: 'raccoon' })).value.accounts.some(a => a.id === failed.value.accountId))
      } finally {
        raccoon.startLogin = originalStart
        raccoon.persistLogin = originalPersist
        raccoonPro.startLogin = originalStartPro
        raccoonPro.persistLogin = originalPersistPro
        globalThis.fetch = originalFetch
      }
    })

    await t.test('目录默认值与实际解析一致，输出上限不冒充默认，关图不改默认能力', async () => {
      for (const provider of providers) {
        const models = await catalog(provider)
        for (const model of models) {
          const resolved = await adapters.get(provider).resolveModel(provider, model.id)
          assert.equal(model.defaultEffort, resolved.reasoning?.defaultEffort)
          assert.equal(model.defaultMaxTokens, resolved.defaultMaxTokens)
        }
      }
      const adapter = adapters.get('loomy')
      const originalRemote = adapter.remoteModels
      adapter.remoteModels = [{ id: 'spark-x2.6', name: '远端', contextWindow: 1000000, efforts: ['low', 'high'], defaultEffort: 'low', supportsImage: true }]
      try {
        const model = (await catalog('loomy')).find(m => m.id === 'spark-x2.6')
        assert.equal(model.defaultEffort, 'low')
      } finally { adapter.remoteModels = originalRemote }
      const provider = 'raccoon', modelId = 'sn-sensenova-6-8-flash'
      await rpc('model.setParams', { provider, modelId, params: { supportsImage: false } })
      const model = (await catalog(provider)).find(m => m.id === modelId)
      assert.equal(model.supportsImage, true)
      // Raccoon 的思考档位改成了**逐模型**（上游 `params.raccoon_thinking`）：
      // 该模型 5 档、不允许关闭，默认档取目录的 `default_level`（level_1）。
      assert.deepEqual(model.efforts, ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'])
      assert.equal(model.defaultEffort, 'level_1')
      assert.equal(model.defaultMaxTokens, 63999)
      const listed = (await services.llm.listModels(provider)).find(m => m.id === modelId)
      assert.equal(listed.inputModalities.includes('image'), false)
      await rpc('model.setParams', { provider, modelId, params: {} })
    })

    await t.test('显式启用 false 与模型参数经过真实磁盘加载仍保留', async () => {
      for (const provider of providers) {
        // TRAE 兜底表没有默认关闭（stale）条目，`off` 为空时退回目录首项：
        // 该断言只关心「显式 false」的持久化语义，不挑默认态。
        const modelId = expected[provider].off[0] ?? (await catalog(provider))[0].id
        await rpc('model.setDisabled', { provider, modelId, disabled: false })
        await rpc('model.setParams', { provider, modelId, params: { contextWindow: 200000, supportsImage: false } })
      }
      const restored = new pool.constructor(ctx)
      const saved = JSON.parse(fs.readFileSync(path.join(scratch, 'channel-pack/state.json'), 'utf8'))
      for (const provider of providers) {
        const modelId = expected[provider].off[0] ?? (await catalog(provider))[0].id
        assert.equal(saved.disabledModels[provider][modelId], false)
        assert.equal(restored.listDisabledModels(provider)[modelId], false)
        assert.deepEqual(restored.modelParamsFor(provider, modelId), { contextWindow: 200000, supportsImage: false })
        // `raccoon-pro` 的适配器拿到的是「按 plan 门控」的池视图（单池后它的
        // 真池恒为空），换成裸池会让目录可见性判定变成「没有已登录账号」→ 空目录。
        // 那是单池架构的正确行为，不是持久化缺陷，故这里只断到黑名单/参数这一层。
        if (provider === 'raccoon-pro') continue
        const adapter = adapters.get(provider), originalPool = adapter.options.accountPool
        adapter.options.accountPool = restored
        try { assert.ok((await visible(provider)).includes(modelId)) }
        finally { adapter.options.accountPool = originalPool }
      }
    })

    await t.test('联网目录缓存保留实时价格和能力；未知模型默认启用', async () => {
      for (const provider of ['loomy', 'raccoon', 'raccoon-pro']) {
        await rpc('model.setAllDisabled', { provider, disabled: false })
        const adapter = adapters.get(provider)
        const originalRemote = adapter.remoteModels
        const source = adapter.listAllModels().map(m => ({ id: m.id, name: `实时报价 ${m.id}`, contextWindow: 400000, supportsImage: true }))
        adapter.remoteModels = [...source, { id: 'unreviewed-next-model', name: '新上架模型', contextWindow: 200000, supportsImage: false }]
        try {
          const models = await catalog(provider)
          // 目录就是上游/缓存原样：没有策展标记，全部默认启用（含上游新上的未知模型）。
          assert.equal(models.filter(m => m.stale).length, 0)
          assert.equal(models.filter(m => m.disabled).length, 0)
          const selected = await visible(provider)
          assert.ok(selected.includes('unreviewed-next-model'))
          const first = models.find(m => m.id === models[0].id)
          assert.equal(first.contextWindow, 400000)
          assert.equal(first.supportsImage, true)
          assert.match(first.name, /^实时报价 /)
        } finally { adapter.remoteModels = originalRemote }
      }
    })

    await t.test('恢复推荐只重置本渠道显示偏好，保留参数和账号', async () => {
      const qoderBefore = pool.listDisabledModels('qodercn')
      const accountCount = (await rpc('account.list', { provider: 'loomy' })).value.accounts.length
      await rpc('model.setAllDisabled', { provider: 'loomy', disabled: false })
      assert.equal((await visible('loomy')).length, 7)
      assert.equal((await catalog('loomy')).filter(m => m.disabled).length, 0)
      await rpc('model.resetDefaults', { provider: 'loomy' })
      assert.equal((await visible('loomy')).length, 5)
      assert.equal((await catalog('loomy')).filter(m => m.disabled).length, 2)
      assert.deepEqual(pool.listDisabledModels('loomy'), {})
      assert.deepEqual(pool.listDisabledModels('qodercn'), qoderBefore)
      // 参数是**用户数据**：目录重置显示偏好不能把它清掉（上一轮用例在这个模型上写过参数）。
      const paramModel = expected.loomy.off[0]
      assert.deepEqual(pool.modelParamsFor('loomy', paramModel), { contextWindow: 200000, supportsImage: false })
      assert.equal((await rpc('account.list', { provider: 'loomy' })).value.accounts.length, accountCount)
      const restored = new pool.constructor(ctx)
      assert.deepEqual(restored.modelParamsFor('loomy', paramModel), { contextWindow: 200000, supportsImage: false })
    })

    assert.equal((await rpc('account.create', { provider: 'qoder' })).ok, false)
    // 白名单之外的 provider 必须被拒绝（trae 已接入后用 devin 代位）。
    assert.equal((await rpc('provider.status', { providers: ['devin'] })).ok, false)
    const disk = JSON.parse(fs.readFileSync(path.join(scratch, 'channel-pack/state.json'), 'utf8'))
    assert.equal(disk.accounts[0].id, 'loomy-fixture')
    assert.ok(fs.existsSync(path.join(scratch, 'channel-pack/permanent-locks.json')))
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister(); globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR; else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    assert.equal(path.dirname(scratch), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(scratch).startsWith('unified-router-test-'))
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

/**
 * 联机路径：两侧模型池完全独立。
 *
 * 为什么单独起一个 test（而不是塞进上面的大用例）：远端目录在适配器里是
 * **成功即永久缓存**、失败则进入 `RemoteCatalogGate` 的 30s 冷却。上面的大用例
 * 全程离网，两个 raccoon 适配器早已记下「拉取失败」，冷却窗口内不会再发请求 ——
 * 在那里换掉 fetch 桩也拉不到目录。故这里新建一个干净的后端实例。
 *
 * ⚠️ 本用例锁死的是「**不按倍率过滤**」：免费面与订阅面各自用本侧账号的凭据去
 * 拉上游目录，上游对这个账号返回什么模型就展示什么模型。上一版把同一份目录按
 * `billing_effective_multiplier === 0` 劈成两半，结果免费账号明明看得到计费模型，
 * 却被目录过滤整条删掉。两侧目录的独立性来自「用不同账号拉」，不是来自过滤。
 */
test('两侧模型池完全独立：各用自己的账号凭据拉上游目录，不按倍率过滤', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.startsWith('@deepseek-ai/') ? { url: kernel, shortCircuit: true } : next(specifier, context) } })
  const originalHome = process.env.DSH_HOME; const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR; const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch; process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
  // 免费账号看到 A、订阅账号看到 B：两组**不同**模型，且倍率**混杂**
  //（A 里有 >0× 的模型，B 里有 0× 与缺字段的模型 —— 倍率不是归属判据）。
  const catalog = models => ({ code: 0, data: { categories: [{ type: 'chat', models }] } })
  const entry = (name, multiplier) => ({
    name,
    visible: true,
    params: { context_window: 256_000, max_tokens: 63_999 },
    tags: ['vision'],
    ...multiplier === undefined ? {} : { billing_effective_multiplier: multiplier },
  })
  const freeCatalog = catalog([
    entry('sn-sensenova-6-8-flash', 0),
    // ⚠️ 免费账号的目录里出现的计费模型必须保留（过滤方案正是在这里删掉了它）。
    entry('sn-glm-5-3', 0.75),
  ])
  const paidCatalog = catalog([
    entry('sn-kimi-k3', 1),
    // ⚠️ 订阅账号目录里也可能有 0× 模型（活动赠送）：同样必须保留。
    entry('sn-free-for-paid', 0),
    // 缺 `billing_effective_multiplier` 的模型照旧展示（字段缺失不是归属判据）。
    entry('sn-multiplier-missing', undefined),
  ])
  let network = 0
  const authorization = []
  globalThis.fetch = async (_url, init) => {
    network++
    const bearer = String(init?.headers?.Authorization ?? '')
    authorization.push(bearer)
    const body = bearer === 'Bearer token-raccoon-free' ? freeCatalog
      : bearer === 'Bearer token-raccoon-paid' ? paidCatalog
        : undefined
    // 用错凭据就报错：证明两侧确实各用各的账号，没有互相借用。
    if (body === undefined) throw new Error(`unexpected credential: ${bearer}`)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const cleanup = []; const adapters = new Map(); const credentials = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: { resolve: async ref => credentials.get(ref), describe: async () => undefined,
      set: async (ref, value) => { credentials.set(ref, { value }) }, unset: async ref => credentials.delete(ref) },
    llm: { registerAdapter(ids, adapter) { for (const id of ids) adapters.set(id, adapter) }, listProviders: () => [...adapters.keys()].map(id => ({ id })),
      listModels: async id => adapters.get(id).listModels(id) },
    connection: { fetch: { register() { throw new Error('native-only must not mount HTTP RPC') } } },
  }
  const ctx = { ...services, logger: { info() {}, warn() {}, error() {}, debug() {} }, get: key => services[key],
    provide(key, value) { this[key] = services[key] = value },
    effect(fn) { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
    inject(deps, fn) { if (deps.every(d => services[d])) fn(this) }, emit() {} }
  try {
    let rpc
    const { mountBackend } = await import('../lib/backend.js')
    const pool = mountBackend(ctx, call => { rpc = call })
    // **单池**两个账号（同一 provider、不同 plan），各自一份可用凭据。
    for (const [accountId, plan] of [['raccoon-free', 'free'], ['raccoon-paid', 'pro']]) {
      const ref = `REF_${accountId.toUpperCase()}`
      credentials.set(ref, { value: JSON.stringify({ access_token: `token-${accountId}` }) })
      await pool.addAccount({
        id: accountId, provider: 'raccoon', nickname: accountId, credentialRef: ref,
        enabled: true, refreshable: false, createdAt: 1, plan,
      })
    }
    const ids = async provider => {
      const result = await rpc('model.list', { provider })
      assert.equal(result.ok, true, provider)
      return result.value.models.map(m => m.id).sort()
    }
    // 免费面 = 免费账号的上游目录（含 0.75× 那条，没有被过滤掉）。
    await rpc('model.refresh', { provider: 'raccoon' })
    await rpc('model.refresh', { provider: 'raccoon-pro' })
    assert.deepEqual(await ids('raccoon'), ['sn-glm-5-3', 'sn-sensenova-6-8-flash'])
    // 订阅面 = 订阅账号的上游目录（含 0× 与缺倍率字段的两条）。
    assert.deepEqual(await ids('raccoon-pro'), ['sn-free-for-paid', 'sn-kimi-k3', 'sn-multiplier-missing'])
    // 两个模型面各真拉一次，且各自用的是本侧账号的凭据。
    assert.equal(network, 2)
    assert.deepEqual(authorization, ['Bearer token-raccoon-free', 'Bearer token-raccoon-paid'])
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister(); globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR; else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

/**
 * `model.refresh`：设置页「刷新目录」与首次进模型分区的唯一拉取入口。
 *
 * `model.list` 是同步读缓存（缓存空就用硬编码兜底表），所以「真去上游拉一次」
 * 必须单独成一个方法。本用例覆盖四件事：突破失败冷却、成功写缓存并被后续读取
 * 看见、无本侧账号如实回报兜底且**不发请求**、拉取失败回落兜底且不写缓存。
 */
test('model.refresh：成功目录跨重启保存，刷新失败保留，免费与订阅隔离', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.startsWith('@deepseek-ai/') ? { url: kernel, shortCircuit: true } : next(specifier, context) } })
  const originalHome = process.env.DSH_HOME; const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR; const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch; process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
  const catalog = models => ({ code: 0, data: { categories: [{ type: 'chat', models }] } })
  const entry = name => ({ name, visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [] })
  let online = false, requests = 0
  globalThis.fetch = async () => {
    requests++
    if (!online) throw new Error('offline fixture')
    return new Response(JSON.stringify(catalog([
      entry('sn-glm-5-3'), entry('sn-kimi-k3'), entry('sn-deepseek-v4-1-flash-1017'),
    ])), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const cleanup = []; const adapters = new Map(); const credentials = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: { resolve: async ref => credentials.get(ref), describe: async () => undefined,
      set: async (ref, value) => { credentials.set(ref, { value }) }, unset: async ref => credentials.delete(ref) },
    llm: { registerAdapter(ids, adapter) { for (const id of ids) adapters.set(id, adapter) }, listProviders: () => [...adapters.keys()].map(id => ({ id })),
      listModels: async id => adapters.get(id).listModels(id) },
    connection: { fetch: { register() { throw new Error('native-only must not mount HTTP RPC') } } },
  }
  const ctx = { ...services, logger: { info() {}, warn() {}, error() {}, debug() {} }, get: key => services[key],
    provide(key, value) { this[key] = services[key] = value },
    effect(fn) { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
    inject(deps, fn) { if (deps.every(d => services[d])) fn(this) }, emit() {} }
  try {
    let rpc
    const { mountBackend } = await import('../lib/backend.js')
    const mount = target => mountBackend(target, call => { rpc = call }, { catalogDir: scratch })
    const pool = mount(ctx)
    credentials.set('REF_FREE', { value: JSON.stringify({ access_token: 'token-free' }) })
    await pool.addAccount({
      id: 'raccoon-free', provider: 'raccoon', nickname: '免费账号', credentialRef: 'REF_FREE',
      enabled: true, refreshable: false, createdAt: 1, plan: 'free',
    })
    const ids = async provider => (await rpc('model.list', { provider })).value.models.map(m => m.id).sort()
    const FALLBACK_IDS = [
      'sn-deepseek-v4-1-flash-1017', 'sn-glm-5-3', 'sn-glm-5-3-flash',
      'sn-kimi-k3-1-pro', 'sn-qwen4-max', 'sn-sensenova-6-8-flash', 'sn-sensenova-6-8-flash-lite',
    ]
    // 1) 首次读取立即返回本地目录，显式刷新才打上游。
    assert.deepEqual(await ids('raccoon'), FALLBACK_IDS)
    assert.equal(requests, 0)
    assert.equal((await rpc('model.refresh', { provider: 'raccoon' })).value.source, 'fallback')
    // 2) 上游恢复：手动刷新必须**绕过冷却**真拉一次（自动路径在冷却内不会重试）。
    online = true
    const refreshed = await rpc('model.refresh', { provider: 'raccoon' })
    assert.equal(refreshed.ok, true)
    assert.deepEqual(refreshed.value, { count: 3, source: 'remote' })
    // 缓存已写：紧接的 model.list 读到真目录，不需要再打上游。
    const afterRefresh = requests
    assert.deepEqual(await ids('raccoon'), ['sn-deepseek-v4-1-flash-1017', 'sn-glm-5-3', 'sn-kimi-k3'])
    assert.equal(requests, afterRefresh, 'model.list 只读缓存，不得自己触发拉取')
    // 3) 订阅面没有本侧账号：不打上游，如实回报兜底表条数（7 条）。
    const beforePro = requests
    const pro = await rpc('model.refresh', { provider: 'raccoon-pro' })
    assert.deepEqual(pro.value, { count: 7, source: 'fallback' })
    assert.equal(requests, beforePro, '没有本侧账号时不得发上游请求')
    // 4) 上游再次失败：保留原目录。新实例立即读到已保存目录，且无需发请求。
    online = false
    const failed = await rpc('model.refresh', { provider: 'raccoon' })
    assert.deepEqual(failed.value, { count: 3, source: 'cached' })
    assert.deepEqual(await ids('raccoon'), ['sn-deepseek-v4-1-flash-1017', 'sn-glm-5-3', 'sn-kimi-k3'])
    const beforeRestart = requests
    mount({ ...ctx })
    const reopened = await rpc('model.list', { provider: 'raccoon' })
    assert.equal(reopened.value.source, 'cached')
    assert.deepEqual(reopened.value.models.map(m => m.id).sort(), await ids('raccoon'))
    assert.equal((await rpc('model.list', { provider: 'raccoon-pro' })).value.source, 'fallback')
    assert.equal(requests, beforeRestart)
    // 5) 白名单之外的 provider 仍被拒绝。
    assert.equal((await rpc('model.refresh', { provider: 'devin' })).ok, false)
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister(); globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR; else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})
