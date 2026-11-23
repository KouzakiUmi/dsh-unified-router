/**
 * 倍率/免费价签的两条链路：
 *
 * 1. **会话模型名旁**：适配器 `listModels()` 的 `badge`（DSH 核心原生
 *    `LlmModelInfo.badge`）。⚠️ 自管渠道经 `PiAiAdapter`，它只回四个基础字段，
 *    所以 `lib/rate-badge.js` 的 `withListedRateBadges()` 必须在适配器外层补一次。
 * 2. **设置页模型列表**：`lib/web-host.js` 的 `rate` 投影（`publicModelRate`）。
 *
 * 本用例锁死三件事：
 * - 规则本身：免费 / 计费 / 促销 / 参考 / 未知（未知**不挂**，不谎报免费）；
 * - 补标位置：`listModels` 带、`resolveModel` 不带（核心也只从目录复制 badge）；
 * - 两条链路同口径：同一份目录行在会话与设置页得到同样的文案与语气。
 *
 * peer（pi-ai / dsh-llm / dsh-llm-pi-ai）用 `test/rate-badge-peers.mjs` 的桩，
 * 桩按本机 DSH 0.2.2-rc.3 的真实 `PiAiAdapter.listModels()` 行为只回四字段。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const PEERS = new Set([
  '@earendil-works/pi-ai',
  '@earendil-works/pi-ai/api/openai-completions.lazy',
  '@earendil-works/pi-ai/api/anthropic-messages.lazy',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-llm',
])

const stubUrl = new URL('./rate-badge-peers.mjs', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return PEERS.has(specifier) ? { url: stubUrl, shortCircuit: true } : next(specifier, context)
  },
})

const { modelRateBadge, rateBadgeFromRow, rateBadgeIndex, withListedRateBadges } = await import('../lib/rate-badge.js')
const { createManagedAdapter } = await import('../lib/managed-llm.js')
const { createApiKeyAdapter } = await import('../lib/apikey-llm.js')
const { createWorkBuddyAdapter } = await import('../lib/workbuddy-llm.js')
const { createManagedModelSettings } = await import('../lib/managed-models.js')
const { publicManagedModel } = await import('../lib/managed-channel.js')
const { parseCodeArtsBuiltinModels } = await import('../lib/managed-providers/codearts.js')
const { createSensenovaAdapter } = await import('../vendor/sensenova-token-plan/llm-adapter.js')
const { publicResult } = await import('../lib/web-host.js')

process.on('exit', () => hooks.deregister())

async function dispatch(adapter, provider, model, options = {}, prepared = true) {
  const route = prepared ? await adapter.prepareCall(provider, model) : adapter
  for await (const event of route.stream({ provider, model, messages: [], maxTokens: 512, ...options })) return event.options
}

test('CodeArts：普通模型和旧缓存空档位在 direct/prepared 请求中都不注入思考参数', async () => {
  const spec = { id: 'codearts', title: 'CodeArts', baseUrl: 'https://example.invalid/v1' }
  const modelId = 'openpangu-2.0-flash'
  const [catalogRow] = parseCodeArtsBuiltinModels({ builtinModels: [{ model_id: modelId }] })
  assert.deepEqual(catalogRow.efforts, [])
  for (const legacyDefault of [undefined, '', 'high']) {
    const rows = await createManagedModelSettings(undefined, spec.id).list([publicManagedModel({ ...catalogRow, defaultEffort: legacyDefault })])
    assert.equal(rows[0].defaultEffort, undefined)
    assert.equal(rows[0].effectiveEffort, undefined)
    const { adapter } = await createManagedAdapter({ spec, rows })
    assert.equal((await adapter.resolveModel(spec.id, modelId)).reasoning, undefined)
    for (const prepared of [false, true]) {
      for (const reasoningEffort of [undefined, null, '', '   ']) {
        const options = reasoningEffort === undefined ? {} : { reasoningEffort }
        assert.equal(Object.hasOwn(await dispatch(adapter, spec.id, modelId, options, prepared), 'reasoningEffort'), false)
      }
    }
  }
})

test('共用 PiAiAdapter 思考参数：模型默认、显式 off、短输出与非法档位在各条路由一致', async () => {
  const row = { id: 'test-model', name: 'Test', enabled: true, efforts: ['off', 'high'], effectiveEffort: 'high' }
  const spec = id => ({ id, title: id, baseUrl: 'https://example.invalid/v1' })
  const providers = [
    ['astudio', await createManagedAdapter({ spec: spec('astudio'), rows: [row] })],
    ['agnes', await createApiKeyAdapter({ spec: spec('agnes'), rows: [row] })],
    ['workbuddy', createWorkBuddyAdapter({ providerId: 'workbuddy', endpoint: 'https://example.invalid', catalog: [row] })],
  ]
  for (const [provider, { adapter }] of providers) {
    const handle = await adapter.prepareCall(provider, row.id)
    assert.equal(handle.model.reasoning.defaultEffort, 'high')
    assert.equal((await dispatch(adapter, provider, row.id)).reasoningEffort, 'high')
    assert.equal((await dispatch(adapter, provider, row.id, { reasoningEffort: '' })).reasoningEffort, 'high')
    assert.equal((await dispatch(adapter, provider, row.id, { reasoningEffort: 'off' })).reasoningEffort, 'off')
    await assert.rejects(dispatch(adapter, provider, row.id, { reasoningEffort: 'max' }), { code: 'UNSUPPORTED_REASONING_EFFORT' })
  }
})

test('商汤按模型公布并使用已保存的默认档，单次请求档优先', async () => {
  const { adapter, providerIds: [provider] } = createSensenovaAdapter({
    entries: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
    baseUrl: 'https://example.invalid/v1', modelParams: { 'deepseek-flash': { reasoningEffort: 'medium' } },
  })
  const model = 'deepseek-flash'
  assert.equal((await adapter.resolveModel(provider, model)).reasoning.defaultEffort, 'medium')
  assert.equal((await dispatch(adapter, provider, model)).reasoningEffort, 'medium')
  assert.equal((await dispatch(adapter, provider, model, { reasoningEffort: 'high' })).reasoningEffort, 'high')
})

const FREE = { text: { en: 'Free', zh: '免费' }, tone: 'success' }
const rate = value => ({ text: { en: `x${value}`, zh: `x${value}` }, tone: 'neutral' })
const promo = value => ({ text: { en: `x${value}`, zh: `x${value}` }, tone: 'info' })
const reference = value => ({ text: { en: `Ref. x${value}`, zh: `参考 x${value}` }, tone: 'neutral' })

test('modelRateBadge（lib 版）与 channel-pack 同规则：免费/计费/促销/参考/未知', () => {
  // 未知必须是 undefined，不能落成 0（0 = 免费，会谎报）。
  assert.equal(modelRateBadge(undefined), undefined)
  assert.equal(modelRateBadge(Number.NaN), undefined)
  assert.equal(modelRateBadge(Number.POSITIVE_INFINITY), undefined)
  assert.equal(modelRateBadge(-0.1), undefined)

  assert.deepEqual(modelRateBadge(0), FREE)
  assert.deepEqual(modelRateBadge(0.4, { status: 'limited_free' }), FREE)
  assert.deepEqual(modelRateBadge(1), rate('1.00'))
  assert.deepEqual(modelRateBadge(0.135), rate('0.14'))
  // 促销只在原价确实更高时标 info（否则不伪造折扣）。
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount', baseMultiplier: 1 }), promo('0.40'))
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount', baseMultiplier: 0.4 }), rate('0.40'))
  // 渠道自报优惠但没有原价：tone 用 info，文案仍是实测倍率本身。
  assert.deepEqual(modelRateBadge(0.4, { promoted: true }), promo('0.40'))
  assert.deepEqual(modelRateBadge(0.75, { reference: true }), reference('0.75'))
})

test('rateBadgeFromRow：只认渠道给出的免费/倍率/原价证据', () => {
  // 渠道明说免费（free 标志或文案「免费」）。
  assert.deepEqual(rateBadgeFromRow({ id: 'a', free: true }), FREE)
  assert.deepEqual(rateBadgeFromRow({ id: 'a', free: true, rate: 0 }), FREE)
  assert.deepEqual(rateBadgeFromRow({ id: 'a', free: false, rateLabel: '免费' }), FREE)
  // 定价记录就是 0（点倍率 0 / 消费倍率 0）→ 免费。
  assert.deepEqual(rateBadgeFromRow({ id: 'a', rate: 0 }), FREE)
  // ⚠️ WorkBuddy 读不出倍率时用 rate:0 且显式 free:false —— 不能当免费。
  assert.equal(rateBadgeFromRow({ id: 'a', rate: 0, free: false }), undefined)
  // 常规计费 / 促销（有原价才标 info）。
  assert.deepEqual(rateBadgeFromRow({ id: 'a', rate: 0.8 }), rate('0.80'))
  assert.deepEqual(rateBadgeFromRow({ id: 'a', rate: 0.4, rateWas: 1 }), promo('0.40'))
  // 上游文案只当「免费」证据；其余一律按数值重新格式化（文案与数字不打架）。
  assert.deepEqual(rateBadgeFromRow({ id: 'a', rate: 0.5, rateLabel: 'x0.5' }), rate('0.50'))
  // 渠道标签自己说「优惠」且没有原价 → info 语气，倍率数字不变。
  assert.deepEqual(rateBadgeFromRow({ id: 'a', rate: 0.3, rateTone: 'info' }), promo('0.30'))
  // 没有可用证据（缺倍率 / 非数字 / 负数）→ 不挂标。
  assert.equal(rateBadgeFromRow({ id: 'a' }), undefined)
  assert.equal(rateBadgeFromRow({ id: 'a', rate: '0.5' }), undefined)
  assert.equal(rateBadgeFromRow({ id: 'a', rate: -1 }), undefined)
})

test('rateBadgeIndex / withListedRateBadges：补徽标、不覆盖、未知不挂、resolveModel 不动', async () => {
  const index = rateBadgeIndex([
    { id: 'free', rate: 0 },
    { id: 'paid', rate: 0.75 },
    { id: 'unknown' },
  ])
  assert.deepEqual([...index.keys()], ['free', 'paid'])

  const inner = {
    listModels: async provider => [
      { provider, id: 'free', name: 'Free', inputModalities: ['text'] },
      { provider, id: 'paid', name: 'Paid', inputModalities: ['text'] },
      { provider, id: 'unknown', name: 'Unknown', inputModalities: ['text'] },
      { provider, id: 'pre', name: 'Pre', inputModalities: ['text'], badge: { text: { en: 'own', zh: '自带' }, tone: 'warning' } },
    ],
    resolveModel: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] }),
    providerInfo: provider => ({ id: provider, name: 'Demo' }),
  }
  const wrapped = withListedRateBadges(inner, id => index.get(id))
  const models = await wrapped.listModels('demo')
  assert.deepEqual(models.find(model => model.id === 'free').badge, FREE)
  assert.deepEqual(models.find(model => model.id === 'paid').badge, rate('0.75'))
  // 未知模型保持无字段（不能落成免费）。
  assert.equal('badge' in models.find(model => model.id === 'unknown'), false)
  // 底层自带徽标时不覆盖。
  assert.deepEqual(models.find(model => model.id === 'pre').badge, { text: { en: 'own', zh: '自带' }, tone: 'warning' })
  // 其他方法原样可用；resolveModel 不补 badge。
  assert.deepEqual(wrapped.providerInfo('demo'), { id: 'demo', name: 'Demo' })
  assert.equal('badge' in await wrapped.resolveModel('demo', 'paid'), false)
  // 没有 listModels 的适配器原样返回（不制造新对象）。
  const plain = { stream() {} }
  assert.equal(withListedRateBadges(plain, id => index.get(id)), plain)
  assert.equal(withListedRateBadges(null, id => index.get(id)), null)
})

test('自管渠道：PiAiAdapter 丢字段后仍有倍率徽标，resolveModel 不带', async () => {
  const spec = { id: 'doubaowork', title: '豆包工作', protocol: 'openai-completions', baseUrl: 'https://demo.invalid/v1' }
  const rows = [
    { id: 'free', name: '免费模型', enabled: true, efforts: [], free: true, rate: 0 },
    { id: 'paid', name: '计费模型', enabled: true, efforts: [], free: false, rate: 0.8 },
    { id: 'promo', name: '促销模型', enabled: true, efforts: [], free: false, rate: 0.4, rateWas: 1 },
    { id: 'unknown', name: '未知模型', enabled: true, efforts: [], free: false, rate: 0 },
  ]
  const built = await createManagedAdapter({
    spec, rows,
    selectTransport: async () => ({ accountId: 'a', fetch: async () => new Response('{}') }),
    get: () => undefined,
  })
  const models = await built.adapter.listModels('doubaowork')
  const badgeOf = id => models.find(model => model.id === id)?.badge
  assert.deepEqual(badgeOf('free'), FREE)
  assert.deepEqual(badgeOf('paid'), rate('0.80'))
  assert.deepEqual(badgeOf('promo'), promo('0.40'))
  assert.equal(badgeOf('unknown'), undefined)
  for (const model of models) {
    assert.equal(model.provider, 'doubaowork')
    assert.equal(typeof model.name, 'string')
  }
  const resolved = await built.adapter.resolveModel('doubaowork', 'paid')
  assert.equal(resolved.name, '计费模型')
  assert.equal('badge' in resolved, false)
})

test('API Key 渠道：免费/需付费徽标经同一条补标路径到达选择器', async () => {
  const spec = {
    id: 'agnes', title: 'Agnes',
    endpoint: 'https://api.agnes-ai.cn', chatPath: '/v1/chat/completions', baseUrl: 'https://api.agnes-ai.cn/v1',
  }
  const rows = [
    { id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash', efforts: ['off'], effectiveEffort: 'off', free: true },
    { id: 'agnes-3.0-pro', name: 'Agnes 3.0 Pro', efforts: ['off'], effectiveEffort: 'off', paidOnly: true },
    { id: 'agnes-3.0-plain', name: 'Agnes 3.0 Plain', efforts: ['off'], effectiveEffort: 'off' },
  ]
  const built = await createApiKeyAdapter({ spec, rows, resolveKey: async () => 'test-key' })
  const models = await built.adapter.listModels('agnes')
  const badgeOf = id => models.find(model => model.id === id)?.badge
  assert.deepEqual(badgeOf('agnes-3.0-flash'), FREE)
  assert.deepEqual(badgeOf('agnes-3.0-pro'), { text: { en: 'Paid', zh: '需付费' }, tone: 'info' })
  // 没有免费/付费证据的模型不挂标（不编造）。
  assert.equal(badgeOf('agnes-3.0-plain'), undefined)
  assert.equal('badge' in await built.adapter.resolveModel('agnes', 'agnes-3.0-flash'), false)
})

test('WorkBuddy：目录 free/rate 变成选择器徽标，未知兜底 rate:0 不谎报免费', async () => {
  const catalog = [
    { id: 'glm-5.3', name: 'GLM 5.3', enabled: true, efforts: ['high'], vision: false, free: false, rate: 0.13, rateWas: 0.33 },
    { id: 'free-model', name: 'Free', enabled: true, efforts: [], vision: false, free: true, rate: 0 },
    { id: 'unknown-model', name: 'Unknown', enabled: true, efforts: [], vision: false, free: false, rate: 0 },
    { id: 'disabled-model', name: 'Disabled', enabled: false, efforts: [], vision: false, free: true, rate: 0 },
  ]
  const built = createWorkBuddyAdapter({
    catalog, getFetch: async () => globalThis.fetch, get: () => undefined,
    sessionHeader: 'x-session', providerId: 'workbuddy', endpoint: 'https://workbuddy.invalid',
  })
  const models = await built.adapter.listModels('workbuddy')
  const badgeOf = id => models.find(model => model.id === id)?.badge
  assert.deepEqual(badgeOf('glm-5.3'), promo('0.13'))
  assert.deepEqual(badgeOf('free-model'), FREE)
  assert.equal(badgeOf('unknown-model'), undefined)
  // 未启用的模型不进目录（也就没有徽标）。
  assert.equal(models.some(model => model.id === 'disabled-model'), false)
  assert.equal('badge' in await built.adapter.resolveModel('workbuddy', 'glm-5.3'), false)
})

test('设置页 rate 投影与选择器徽标同口径（managed / workbuddy）', () => {
  const managed = publicResult('managed.models', {
    provider: 'doubaowork',
    source: 'remote',
    models: [
      { id: 'free', free: true, rate: 0 },
      { id: 'paid', free: false, rate: 0.5 },
      { id: 'promo', free: false, rate: 0.4, rateWas: 1 },
      { id: 'tone', free: false, rate: 0.3, rateTone: 'info', rateLabel: 'x0.3' },
      { id: 'unknown', free: false, rate: 0 },
      { id: 'plain' },
    ],
  }).models
  const rateOf = id => managed.find(model => model.id === id)?.rate
  assert.deepEqual(rateOf('free'), { label: '免费', tone: 'success' })
  assert.deepEqual(rateOf('paid'), { label: 'x0.50', tone: 'neutral', multiplier: 0.5 })
  assert.deepEqual(rateOf('promo'), { label: 'x0.40', tone: 'info', multiplier: 0.4 })
  assert.deepEqual(rateOf('tone'), { label: 'x0.30', tone: 'info', multiplier: 0.3 })
  // 未知（rate 0 且显式不免费）不挂标。
  assert.equal(rateOf('unknown'), undefined)
  assert.equal(rateOf('plain'), undefined)
  // 幂等：投影结果再投影一次，rate 不变（快照恢复/乐观补丁会走到这条路径）。
  const reprojected = publicResult('managed.models', { provider: 'doubaowork', models: managed }).models
  assert.deepEqual(reprojected.map(model => model.rate), managed.map(model => model.rate))

  const workbuddy = publicResult('workbuddy.models', {
    models: [
      { id: 'w-free', free: true },
      { id: 'w-paid', rate: 0.135 },
      { id: 'w-unknown', free: false, rate: 0 },
    ],
  }).models
  const wbRate = id => workbuddy.find(model => model.id === id)?.rate
  assert.deepEqual(wbRate('w-free'), { label: '免费', tone: 'success' })
  assert.deepEqual(wbRate('w-paid'), { label: 'x0.14', tone: 'neutral', multiplier: 0.135 })
  assert.equal(wbRate('w-unknown'), undefined)
})
