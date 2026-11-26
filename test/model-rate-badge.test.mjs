/**
 * 模型选择器徽标（DSH 核心原生 `LlmModelInfo.badge`）。
 *
 * ## 被测契约
 *
 * DSH 0.2.2+ 的模型目录接受 `LlmModelInfo.badge`，由
 * `dsh-client-ui-model-selection` 的 ModelSelect **原生**渲染成模型名旁的彩色
 * `Tag`（下拉行在名字后、收起态在名前）。适配器只需在 `listModels()` 里挂上。
 *
 * 本机 DSH 0.2.2-rc.3 安装的 `app.asar` 已逐层核验该字段确实被读取：
 *
 * 1. `@deepseek-ai/dsh-llm/src/types.ts`：`LlmModelInfo.badge?: LlmModelBadge`，
 *    `text: LocalizedText`（`string | { en: string } & Record<string, string>`，`en` 必填）、
 *    `tone: 'neutral'|'info'|'success'|'warning'`；
 * 2. `@deepseek-ai/dsh-llm/lib/index.js`：`listModels()` 归一化时**透传** `badge`
 *    （`...(badge === void 0 ? {} : { badge: { text, tone } })`）；
 * 3. `@deepseek-ai/dsh-api-session-controller`：目录投影同样透传；
 * 4. `@deepseek-ai/dsh-api-remotes`：wire 侧 zod schema 校验 `badge.text` 与 `tone`；
 * 5. `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js`：
 *    `Tag({ className: badge, tone: model.badge.tone, children: resolveText(model.badge.text) })`。
 *
 * ⚠️ 内核那一侧无法在离线单测里重放（`test/kernel.mjs` 是 `LlmAdapter` 空实现），
 * 故这里锁死**适配器侧**的两件事：徽标规则（纯函数矩阵）+ 四个渠道
 * `listModels()` 实际挂出的字段与既有字段（name/id/ctx/efforts）同时不被破坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
// 纯函数直接取源码（Node 的类型剥离），不必经过构建产物。
import { modelRateBadge } from '../vendor/channel-pack/src/model-rate-badge.ts'

const FREE = { text: { en: 'Free', zh: '免费' }, tone: 'success' }
const rate = value => ({ text: { en: `x${value}`, zh: `x${value}` }, tone: 'neutral' })
const promo = value => ({ text: { en: `x${value}`, zh: `x${value}` }, tone: 'info' })
const reference = value => ({ text: { en: `Ref. x${value}`, zh: `参考 x${value}` }, tone: 'neutral' })

test('modelRateBadge：免费→success、计费→neutral、促销→info、未知不给徽标', () => {
  // ⚠️ `0` 与 `undefined` 是两个结论：前者「对本账号免费」，后者「上游没下发」。
  // 把 undefined 当 0 会给未知模型挂上「免费」—— 那是谎报。
  assert.equal(modelRateBadge(undefined), undefined)
  assert.equal(modelRateBadge(Number.NaN), undefined)
  assert.equal(modelRateBadge(Number.POSITIVE_INFINITY), undefined)
  assert.equal(modelRateBadge(-1), undefined)

  // 免费（含 `status === 'limited_free'` 的限时免费）。
  assert.deepEqual(modelRateBadge(0), FREE)
  assert.deepEqual(modelRateBadge(0, { status: 'normal' }), FREE)
  assert.deepEqual(modelRateBadge(0.5, { status: 'limited_free' }), FREE)

  // 常规计费：两位小数，中英文同形（`en` 必填是 wire schema 的硬要求）。
  assert.deepEqual(modelRateBadge(1), rate('1.00'))
  assert.deepEqual(modelRateBadge(0.75), rate('0.75'))
  assert.deepEqual(modelRateBadge(12, { status: 'normal' }), rate('12.00'))

  // 促销：原价确实更高才标 info（否则按常规价，不伪造折扣）。
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount', baseMultiplier: 1 }), promo('0.40'))
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount', baseMultiplier: 0.4 }), rate('0.40'))
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount' }), rate('0.40'))
  assert.deepEqual(modelRateBadge(0.4, { status: 'discount', baseMultiplier: Number.NaN }), rate('0.40'))
})

test('四个渠道的模型选择器和设置页共享倍率徽标，模型 ID 保持稳定', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.startsWith('@deepseek-ai/') ? { url: kernel, shortCircuit: true } : next(specifier, context) } })
  const originalHome = process.env.DSH_HOME; const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR; const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch; process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
  // 全程离网（fetch 一律抛错）：qoder 走兜底表；raccoon 在用例中段
  // 才切成联机（下面的 fetch 桩供它一家的目录），trae 直接用 auth 的目录接口桩。
  let online = false
  const raccoonCatalog = {
    code: 0,
    data: { categories: [{ type: 'chat', models: [
      { name: 'sn-free', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [], billing_effective_multiplier: 0 },
      { name: 'sn-paid', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [], billing_effective_multiplier: 0.75 },
      // 促销：原价 1、生效 0.4（`billing_status: 'discount'`）。
      { name: 'sn-promo', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [], billing_effective_multiplier: 0.4, billing_multiplier: 1, billing_status: 'discount' },
      // 限时免费：按规则一律算免费（不显示成 `x0.5`）。
      { name: 'sn-limited', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [], billing_effective_multiplier: 0.5, billing_status: 'limited_free', billing_status_note: '限免一个月' },
      // 缺 `billing_effective_multiplier`：未知 → 不挂徽标。
      { name: 'sn-unknown', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [] },
    ] }] },
  }
  globalThis.fetch = async () => {
    if (!online) throw new Error('offline fixture')
    return new Response(JSON.stringify(raccoonCatalog), { status: 200, headers: { 'content-type': 'application/json' } })
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
    // 每个渠道一个已登录账号（目录门控要求本侧有可用凭据）；
    // raccoon 家族两侧各一个账号（同一单池，按 `plan` 分流）。
    for (const [provider, id, extra] of [
      ['raccoon', 'raccoon-fixture', { plan: 'free' }],
      ['raccoon', 'raccoon-pro-fixture', { plan: 'pro' }],
      ['trae', 'trae-fixture'], ['qodercn', 'qoder-fixture'],
    ]) {
      const ref = `REF_${id.toUpperCase()}`
      credentials.set(ref, { value: JSON.stringify({ access_token: `token-${id}`, uid: 'fixture', machine_id: '', device_id: '' }) })
      await pool.addAccount({ id, provider, nickname: id, credentialRef: ref, enabled: true, refreshable: false, createdAt: 1, ...extra })
    }
    /** 取某一渠道的 `id → badge`（`undefined` 表示未挂徽标）。 */
    const badges = async provider => {
      const models = await adapters.get(provider).listModels(provider)
      return { badgeOf: id => models.find(model => model.id === id)?.badge, models }
    }

    // Loomy 渠道已移除，其倍率徽标验证随之移除。

    // ===== qodercn：兜底表的 priceFactor / promotion（不能真拉上游，需 WASM 签名） =====
    const qoder = await badges('qodercn')
    // 错峰折扣窗口是 22:00–08:00（UTC+8），故折后价随运行时刻变化 —— 这里按同一
    // 规则算期望值，避免用例只在白天通过（口径见 `promotionActiveNow`）。
    const utc8 = new Date(Date.now() + 8 * 3_600_000)
    const minutes = utc8.getUTCHours() * 60 + utc8.getUTCMinutes()
    const peakPromo = minutes >= 22 * 60 || minutes < 8 * 60
    // `qfmodel`（Qwen3.8 Flash）已列为全平台旧版、默认关闭，不再出现在选择器列表（仍在 model.list 保留倍率）。
    // ⚠️ `Qwen4-Max` 只有显示名、没有可用 model key，已从策展表移除（拿显示名请求会回落
    // 默认模型且不产出思考），故这里改用同样带实测倍率的 `dfmodel`（DeepSeek-Flash）验证。
    assert.equal(qoder.badgeOf('qfmodel'), undefined)
    assert.equal(qoder.badgeOf('Qwen4-Max'), undefined, '显示名不是 id')
    assert.deepEqual(qoder.badgeOf('qmodel_latest'), reference('0.40'), 'Qwen4-Max 的真实 key')
    assert.deepEqual(qoder.badgeOf('auto'), reference('0.30'), '上游目录给 auto 0.3')
    assert.deepEqual(qoder.badgeOf('dfmodel'), reference('0.10'))
    // `model.list`（设置页读的 RPC）不吃徽标，name 里的倍率文本照旧 —— 契约未变。
    const listed = await rpc('model.list', { provider: 'qodercn' })
    assert.equal(listed.ok, true)
    // 名字里不再拼倍率（避免与选择器徽标重复）；倍率只出现在 badge 上。
    assert.equal(listed.value.models.some(model => typeof model.name === 'string' && /·\s*x|·\s*免费/.test(model.name)), false)
    assert.ok(listed.value.models.every(model => !('badge' in model)))
    assert.deepEqual(listed.value.models.find(model => model.id === 'qmodel_38max').rateBadge, peakPromo ? promo('0.20') : reference('0.50'))
    assert.deepEqual(listed.value.models.find(model => model.id === 'jmodel').rateBadge, reference('0.30'), 'Step-5-Preview 的真实 key 是 jmodel')
    assert.deepEqual(listed.value.models.find(model => model.id === 'qfmodel').rateBadge, reference('0.10'))

    const offlineTrae = await rpc('model.list', { provider: 'trae' })
    assert.deepEqual(offlineTrae.value.models.find(model => model.id === 'deepseek-v4.1-flash').rateBadge, reference('0.12'))
    // 订阅限定（官方会员门槛）：Seed-Evolving 仅 Pro 及以上可用，独立于倍率徽标。
    assert.equal(offlineTrae.value.models.find(model => model.id === 'Doubao-Seed-Evolving').subscriptionOnly, true)
    // 非订阅限定模型不挂该标志（缺失即不编造 false）。
    assert.equal(offlineTrae.value.models.find(model => model.id === 'deepseek-v4.1-flash').subscriptionOnly, undefined)
    assert.equal(offlineTrae.value.models.find(model => model.id === 'Doubao-Seed-2.1-Turbo').subscriptionOnly, undefined)
    const consumption = rate => ({ enable: true, data: { rate } })
    const detail = (id, name, contact) => ({ config_name: id, usage: 'chat_completion',
      display_config: { display_name: name }, ...contact })
    const fixtureFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ function_configs: [{
      function: 'solo_agent',
      config_info_list: [
        detail('trae-free', 'Trae Free', { display_contact_config: JSON.stringify({ consumption_rate: consumption(0) }) }),
        detail('trae-paid', 'Trae Paid', { display_contact_config: { consumption_rate: consumption(0.08) } }),
        detail('trae-promo', 'Trae Promo', { display_contact_config: {
          consumption_rate: consumption(0.8),
          activity_discount: { enable: true, data: { current: {
            discount_type: 'off_peak', before_consumption_rate: 0.8, consumption_rate: 0.08,
          } } },
        } }),
        detail('trae-unknown', 'Trae Unknown'),
      ],
    }] }))
    try {
      assert.equal((await adapters.get('trae').refreshRemoteModels()).source, 'remote')
    } finally { globalThis.fetch = fixtureFetch }
    const trae = await badges('trae')
    assert.deepEqual(trae.badgeOf('trae-free'), FREE)
    assert.deepEqual(trae.badgeOf('trae-paid'), rate('0.08'))
    assert.deepEqual(trae.badgeOf('trae-promo'), promo('0.08'))
    assert.deepEqual((await rpc('model.list', { provider: 'trae' })).value.models.find(model => model.id === 'trae-promo').rateBadge, promo('0.08'))
    assert.equal(trae.badgeOf('trae-unknown'), undefined)
    // name 仍是 `· 免费` / `· x0.08` / `· x0.8→x0.08`（未因徽标而改）。
    // trae 的展示名本来就来自上游 name（无倍率文本）；倍率只走 badge。
    assert.equal(trae.models.find(model => model.id === 'trae-promo').name, 'Trae Promo')

    // ===== raccoon：本侧账号在上游拿到的 billing_effective_multiplier =====
    online = true
    const raccoon = await badges('raccoon')
    assert.deepEqual(raccoon.badgeOf('sn-free'), FREE)
    assert.deepEqual(raccoon.badgeOf('sn-paid'), rate('0.75'))
    assert.deepEqual(raccoon.badgeOf('sn-promo'), promo('0.40'))
    assert.deepEqual(raccoon.badgeOf('sn-limited'), FREE)
    // ⚠️ 缺字段不是 0 —— 未知模型不得标成免费。
    assert.equal(raccoon.badgeOf('sn-unknown'), undefined)
    // 同上：raccoon 展示名不再拼倍率。
    assert.equal(raccoon.models.find(model => model.id === 'sn-promo').name, 'Sn Promo')
    assert.deepEqual((await rpc('model.list', { provider: 'raccoon' })).value.models.find(model => model.id === 'sn-paid').rateBadge, rate('0.75'))
    // 订阅面同一套规则（各用本侧账号的目录，倍率来源一致）。
    const raccoonPro = await badges('raccoon-pro')
    assert.deepEqual(raccoonPro.badgeOf('sn-free'), FREE)
    assert.deepEqual(raccoonPro.badgeOf('sn-promo'), promo('0.40'))
    assert.equal(raccoonPro.badgeOf('sn-unknown'), undefined)

    // ===== 徽标只属于**选择列表**：`resolveModel` 不带（与 name 去倍率同口径） =====
    for (const [provider, model] of [['qodercn', 'auto'], ['trae', 'trae-paid'], ['raccoon', 'sn-paid']]) {
      const resolved = await adapters.get(provider).resolveModel(provider, model)
      assert.equal('badge' in resolved, false, provider)
    }
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister(); globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR; else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})
