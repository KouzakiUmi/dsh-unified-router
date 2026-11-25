import test from 'node:test'
import assert from 'node:assert/strict'
import { APIKEY_PROVIDERS, APIKEY_PROVIDER_IDS, apikeyProvider } from '../lib/apikey-providers.js'
import { detectApiKeyRateLimit, readApiKeyQuota } from '../lib/apikey-quota.js'
import { projectApiKeyQuota } from '../lib/apikey-quota-projection.js'

// 规格对象就是额度执行器的入参：渠道差异全在规格里，执行器不含渠道名。
const SPEC_UNISOUND = apikeyProvider('unisound')
const SPEC_AGNES = apikeyProvider('agnes')


test('控制台额度使用独立凭据，按渠道投影且丢弃敏感字段', async () => {
  assert.deepEqual(await readApiKeyQuota(SPEC_UNISOUND, () => assert.fail('未配置不发请求'), undefined, {}), { status: 'needs-console' })
  const u = await readApiKeyQuota(SPEC_UNISOUND, async ({ url, headers }) => {
    assert.equal(url, 'https://maas.unisound.com/manager/u-plan/subscription/current')
    assert.deepEqual(headers, { cookie: 'session=fake' })
    return { errorCode: '0', result: { weeklyPointsTotal: 2500, weeklyPointsUsed: 100, window5hLimit: 500, window5hRemain: 300, apiKey: 'NEVER_DISPLAY' } }
  }, undefined, { UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE: 'session=fake' })
  assert.deepEqual(u.windows.map(row => [row.id, row.remaining]), [['window-points', 300], ['weekly-points', 2400]])
  assert.doesNotMatch(JSON.stringify(projectApiKeyQuota(u)), /NEVER_DISPLAY|session/)
  const a = await readApiKeyQuota(SPEC_AGNES, async ({ url, headers }) => {
    assert.equal(new URL(url).origin, 'https://platform-backend.agnes-ai.cn')
    assert.equal(headers.authorization, 'Bearer console-fixture')
    if (url.endsWith('/credits')) return { code: 200, data: { plan_quota_credits: 200, plan_balance_credits: 150 } }
    if (url.endsWith('/balance')) return { code: 200, data: { available_total_minor: 1234, currency: 'cny' } }
    throw new Error('isolated failed resource')
  }, undefined, { UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN: 'console-fixture' })
  assert.equal(a.balance, 12.34)
  assert.equal(a.windows[0].remaining, 150)
  const denied = await readApiKeyQuota(SPEC_UNISOUND, async () => ({ errorCode: '1', errorMsg: '用户未登录或session超时' }), undefined, { UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE: 'session=fake' })
  assert.deepEqual(denied, { status: 'expired' })
})

test('云知声控制台额度：兼容字符串积分与赠送额度 giftQuotas 投影', async () => {
  // 真实接口返回 weeklyPointsTotal/Remain/Used 为十进制字符串，且未开启 5 小时窗口时省略 window5h*。
  const u = await readApiKeyQuota(SPEC_UNISOUND, async () => ({
    errorCode: '0',
    result: {
      weeklyPointsTotal: '10000',
      weeklyPointsUsed: '0',
      weeklyPointsRemain: '10000',
      giftQuotas: [
        { modelId: 'u2-asr', remainAmount: 30, totalAmount: 30, usedAmount: 0, unit: 'HOUR', displayUnit: '小时' },
        { modelId: 'u2-tts', remainAmount: '150000', totalAmount: '150000', usedAmount: '0', unit: 'CHAR', displayUnit: '字' },
        { modelId: 'u2-ocr', remainAmount: 29500000, totalAmount: 29500000, usedAmount: 0, unit: 'TOKEN', displayUnit: 'Token' },
        { modelId: 'bad id with spaces', remainAmount: 1, totalAmount: 1, unit: 'TOKEN' },
      ],
      apiKey: 'NEVER_DISPLAY',
    },
  }), undefined, {}, 'session=fake')
  assert.equal(u.status, 'ready')
  assert.deepEqual(u.windows, [
    { id: 'window-points', used: null, limit: 2000, remaining: 2000 },
    { id: 'weekly-points', used: 0, limit: 10000, remaining: 10000 },
  ])
  const projected = projectApiKeyQuota(u)
  assert.equal(projected.status, 'ready')
  assert.deepEqual(projected.windows, [
    { id: 'window-points', used: null, limit: 2000, remaining: 2000 },
    { id: 'weekly-points', used: 0, limit: 10000, remaining: 10000 },
  ])
  assert.deepEqual(projected.gifts, [
    { modelId: 'u2-asr', used: 0, limit: 30, remaining: 30, unit: '小时' },
    { modelId: 'u2-tts', used: 0, limit: 150000, remaining: 150000, unit: '字' },
    { modelId: 'u2-ocr', used: 0, limit: 29500000, remaining: 29500000, unit: 'Token' },
  ])
  assert.doesNotMatch(JSON.stringify(projected), /NEVER_DISPLAY/)
  const freeIdle = await readApiKeyQuota(SPEC_UNISOUND, async () => ({
    errorCode: '0',
    result: { planCode: 'U-FREE', weeklyPointsTotal: '2500', weeklyPointsUsed: '100', weeklyPointsRemain: '2400' },
  }), undefined, {}, 'session=fake')
  assert.deepEqual(freeIdle.windows[0], { id: 'window-points', used: null, limit: 500, remaining: 500 })
  const clamped = await readApiKeyQuota(SPEC_UNISOUND, async () => ({
    errorCode: '0',
    result: { window5hLimit: '500', window5hRemain: '-3.5', weeklyPointsTotal: 10000, weeklyPointsRemain: -1 },
  }), undefined, {}, 'session=fake')
  assert.deepEqual(clamped.windows, [
    { id: 'window-points', used: null, limit: 500, remaining: 0 },
    { id: 'weekly-points', used: null, limit: 10000, remaining: 0 },
  ])
})

test('云知声保留窗口重置倒计时，不借用套餐结束时间', async () => {
  const quota = await readApiKeyQuota(SPEC_UNISOUND, async () => ({ errorCode: '0', result: {
    weeklyPointsTotal: 2500, weeklyPointsRemain: 2000, weeklyResetInDays: 2, weeklyResetInHours: 3,
    window5hLimit: 500, window5hRemain: 300, window5hResetInLessThanOneMinute: true,
    periodEnd: '2030-01-01',
  } }), undefined, {}, 'session=fake')
  assert.deepEqual(projectApiKeyQuota(quota).windows.map(row => row.resetInMs), [60000, 51 * 3600000])
  assert.ok(Number.isFinite(quota.updatedAt))
  assert.doesNotMatch(JSON.stringify(quota), /periodEnd/)
})

test('限速区分 RPM/TPM、账单耗尽、明确等待时间与估算', async () => {
  const now = 1_800_000_000_000
  const rpm = Response.json({ base_resp: { status_code: 100501 } })
  assert.deepEqual(await detectApiKeyRateLimit(SPEC_UNISOUND, rpm, now), { reason: 'rpm', until: now + 60_000, estimated: true })
  assert.equal((await rpm.json()).base_resp.status_code, 100501, '观察不消费原始响应')
  const tpm = Response.json({ base_resp: { status_code: 100502 } }, { status: 429, headers: { 'Retry-After': '12' } })
  assert.deepEqual(await detectApiKeyRateLimit(SPEC_UNISOUND, tpm, now), { reason: 'tpm', until: now + 12_000, estimated: false })
  const quota = Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 })
  assert.equal(await detectApiKeyRateLimit(SPEC_AGNES, quota, now), null)
  assert.equal(await detectApiKeyRateLimit(SPEC_UNISOUND, new Response('data: test\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), now), null)
})

// API Key 渠道规格（docs/APIKEY-CHANNELS.md §2）：端点、目录解析、兜底表、
// 思考方言与余额解析。测试全程离线，只验证纯函数形状与文档给出的事实。

const agnes = apikeyProvider('agnes')
const unisound = apikeyProvider('unisound')
const AGNES_EFFORTS = ['off', 'low', 'medium', 'high']
const UNISOUND_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

test('注册表：两个渠道、id 顺序与冻结', () => {
  assert.deepEqual(APIKEY_PROVIDER_IDS, ['agnes', 'unisound'])
  assert.deepEqual(Object.keys(APIKEY_PROVIDERS), ['agnes', 'unisound'])
  assert.equal(apikeyProvider('agnes'), APIKEY_PROVIDERS.agnes)
  assert.equal(apikeyProvider('unisound'), APIKEY_PROVIDERS.unisound)
  assert.equal(Object.isFrozen(APIKEY_PROVIDERS), true)
  assert.throws(() => { APIKEY_PROVIDERS.x = 1 }, TypeError)
})

test('apikeyProvider 对未知 id 返回 undefined', () => {
  for (const id of [undefined, null, '', 'AGNES', 'raccoon', 'u2', 'constructor', 'hasOwnProperty']) {
    assert.equal(apikeyProvider(id), undefined, `id=${String(id)}`)
  }
})

test('两个 spec 的静态字段', () => {
  assert.deepEqual(
    {
      id: agnes.id, title: agnes.title, endpoint: agnes.endpoint, chatPath: agnes.chatPath,
      baseUrl: agnes.baseUrl, credentialRef: agnes.credentialRef,
    },
    {
      id: 'agnes', title: 'Agnes', endpoint: 'https://api.agnes-ai.cn', chatPath: '/v1/chat/completions',
      baseUrl: 'https://api.agnes-ai.cn/v1', credentialRef: 'UNIFIED_ROUTER_AGNES_API_KEY',
    },
  )
  assert.deepEqual(
    {
      id: unisound.id, title: unisound.title, endpoint: unisound.endpoint, chatPath: unisound.chatPath,
      baseUrl: unisound.baseUrl, credentialRef: unisound.credentialRef,
    },
    {
      id: 'unisound', title: '云知声', endpoint: 'https://maas-api.unisound.com', chatPath: '/v1/chat/completions',
      baseUrl: 'https://maas-api.unisound.com/v1', credentialRef: 'UNIFIED_ROUTER_UNISOUND_API_KEY',
    },
  )
})

test('Agnes catalog.request：URL 与 Bearer 头；next 恒 undefined', () => {
  assert.deepEqual(agnes.catalog.request('KEY-1'), {
    url: 'https://api.agnes-ai.cn/v1/models',
    headers: { authorization: 'Bearer KEY-1' },
  })
  assert.equal(agnes.catalog.next({ has_more: true, last_id: 'x' }), undefined)
  assert.equal(agnes.catalog.next({ data: [] }), undefined)
  assert.equal(agnes.catalog.next(undefined), undefined)
})

test('Agnes parse：规格合并、图片/视频与无端点决策模型过滤、免费/付费区分、去重', () => {
  const rows = agnes.catalog.parse({ data: [
    { id: 'agnes-2.5-flash', supported_endpoint_types: ['chat'] },
    { id: 'agnes-image-pro' },
    { id: 'agnes-video-x' },
    { id: 'agnes-sys1-1.0', supported_endpoint_types: [] }, // 非聊天决策模型：过滤
    { id: 'agnes-3.0-flash' },
    { id: 'agnes-3.0-pro' },
    { id: 'agnes-2.5-pro' },
    { id: 'agnes-2.5-pro-beta' },
    { id: 'agnes-2.5-pro-alpha' },
    { id: 'agnes-2.5-pro-theta' },
    { id: 'agnes-9.9-new' },     // 表外新 id：不编造规格
    { id: 'agnes-2.5-flash' },   // 重复 id 去重（保留首个）
  ] })
  assert.deepEqual(rows.map(row => row.id), [
    'agnes-2.5-flash', 'agnes-3.0-flash', 'agnes-3.0-pro', 'agnes-2.5-pro',
    'agnes-2.5-pro-beta', 'agnes-2.5-pro-alpha', 'agnes-2.5-pro-theta', 'agnes-9.9-new',
  ])
  assert.deepEqual(rows[0], {
    id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash', context: 524_288, output: 65_536,
    attachment: true, reasoning: true, efforts: AGNES_EFFORTS, defaultEffort: 'off', free: true,
  })
  assert.equal(rows.find(entry => entry.id === 'agnes-3.0-flash').free, true)
  for (const id of ['agnes-3.0-pro', 'agnes-2.5-pro', 'agnes-2.5-pro-beta', 'agnes-2.5-pro-alpha']) {
    const row = rows.find(entry => entry.id === id)
    assert.equal(row.context, 1_048_576, id)
    assert.equal(row.output, 65_536, id)
    assert.equal(row.attachment, true, id)
    assert.equal(row.reasoning, true, id)
    assert.equal(row.paidOnly, true, id)
  }
  // 文档未给规格的 theta 与表外新 id：context/output 记 0，不假设图片输入。
  const theta = rows.find(row => row.id === 'agnes-2.5-pro-theta')
  assert.equal(theta.context, 0)
  assert.equal(theta.output, 0)
  assert.equal(theta.attachment, false)
  assert.equal(theta.name, 'Agnes 2.5 Pro Theta')
  const fresh = rows.find(row => row.id === 'agnes-9.9-new')
  assert.equal(fresh.context, 0)
  assert.equal(fresh.output, 0)
  assert.equal(fresh.attachment, false)
  assert.equal(fresh.name, 'agnes-9.9-new', '表外 id 用 id 本身作展示名')
  // 所有聊天文本模型统一思考档位（实测 reasoning_effort，默认关思考）。
  assert.ok(rows.every(row => row.reasoning === true))
  assert.ok(rows.every(row => assert.deepEqual(row.efforts, AGNES_EFFORTS) === undefined))
  assert.ok(rows.every(row => row.defaultEffort === 'off'))
})

test('Agnes parse：坏形状返回 []，坏条目跳过', () => {
  for (const bad of [undefined, null, 'x', 42, [], { data: 'x' }, { data: {} }, { data: null }]) {
    assert.deepEqual(agnes.catalog.parse(bad), [], JSON.stringify(bad))
  }
  const longId = 'a'.repeat(257)
  assert.deepEqual(agnes.catalog.parse({ data: [
    { id: '' }, { id: longId }, { id: 12 }, 'not-object', null, {}, { id: 'agnes-ok' },
  ] }).map(row => row.id), ['agnes-ok'])
  assert.equal(agnes.catalog.parse({ data: [{ id: 'a'.repeat(256) }] }).length, 1, '256 字符 id 合法')
})

test('Agnes effortBody：off→none、有效档直发、其他 undefined', () => {
  const row = agnes.fallback[0]
  assert.deepEqual(agnes.effortBody('off', row), { reasoning_effort: 'none' })
  for (const effort of ['low', 'medium', 'high']) {
    assert.deepEqual(agnes.effortBody(effort, row), { reasoning_effort: effort })
  }
  for (const effort of [undefined, 'none', 'minimal', 'xhigh', 'max', 'banana', '']) {
    assert.equal(agnes.effortBody(effort, row), undefined, `effort=${String(effort)}`)
  }
  // 绝不使用 thinking:{type:'disabled'}（实测关不掉思考）。
  assert.equal(JSON.stringify(agnes.effortBody('off', row)).includes('thinking'), false)
})

test('Agnes balance：两个请求、美分换算、unlimited 阈值、缺字段 null', () => {
  const requests = agnes.balance.requests('KEY-2')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0], {
    url: 'https://api.agnes-ai.cn/v1/dashboard/billing/subscription',
    headers: { authorization: 'Bearer KEY-2' },
  })
  assert.deepEqual(requests[1], {
    url: 'https://api.agnes-ai.cn/v1/dashboard/billing/usage',
    headers: { authorization: 'Bearer KEY-2' },
  })
  // total_usage 是美分（OpenAI 账单口径），hard_limit_usd 是美元。
  assert.deepEqual(
    agnes.balance.parse([{ hard_limit_usd: 50 }, { total_usage: 12345 }]),
    { used: 123.45, limit: 50, unlimited: false, unit: 'USD' },
  )
  assert.deepEqual(
    agnes.balance.parse([{ hard_limit_usd: 10_000_000 }, { total_usage: 100 }]),
    { used: 1, limit: null, unlimited: true, unit: 'USD' },
  )
  assert.deepEqual(
    agnes.balance.parse([{ hard_limit_usd: 100_000_000 }, { total_usage: 0 }]),
    { used: 0, limit: null, unlimited: true, unit: 'USD' },
  )
  assert.equal(agnes.balance.parse([{ hard_limit_usd: 9_999_999 }, { total_usage: 0 }]).unlimited, false)
  for (const bad of [
    undefined, null, [], [{}, {}], [null, null],
    [{ hard_limit_usd: '50' }, { total_usage: 1 }],
    [{ hard_limit_usd: 50 }, { total_usage: 'x' }],
    [{ hard_limit_usd: Number.NaN }, { total_usage: 1 }],
    [{ hard_limit_usd: 50 }, { total_usage: Number.POSITIVE_INFINITY }],
    [{ hard_limit_usd: 50 }],
  ]) {
    assert.equal(agnes.balance.parse(bad), null, JSON.stringify(bad))
  }
})

test('Agnes fallback：七个确认存在的文本模型，字段与 parse 一致', () => {
  assert.deepEqual(agnes.fallback.map(row => row.id), [
    'agnes-2.5-flash', 'agnes-3.0-flash', 'agnes-3.0-pro', 'agnes-2.5-pro',
    'agnes-2.5-pro-beta', 'agnes-2.5-pro-alpha', 'agnes-2.5-pro-theta',
  ])
  const parsed = Object.fromEntries(
    agnes.catalog.parse({ data: agnes.fallback.map(row => ({ id: row.id })) }).map(row => [row.id, row]),
  )
  assert.deepEqual(Object.fromEntries(agnes.fallback.map(row => [row.id, row])), parsed)
  assert.equal(agnes.fallback.find(row => row.id === 'agnes-3.0-flash').name, 'Agnes 3.0 Flash')
  assert.equal(agnes.fallback.find(row => row.id === 'agnes-2.5-pro-theta').context, 0)
})

test('云知声 catalog.request：固定分页 URL、游标拼接与双鉴权头', () => {
  assert.deepEqual(unisound.catalog.request('KEY-3'), {
    url: 'https://maas-api.unisound.com/anthropic/v1/models?limit=1000',
    headers: { 'x-api-key': 'KEY-3', authorization: 'Bearer KEY-3' },
  })
  const paged = unisound.catalog.request('KEY-3', 'model id/1')
  assert.equal(paged.url, 'https://maas-api.unisound.com/anthropic/v1/models?limit=1000&after_id=model%20id%2F1')
  assert.deepEqual(paged.headers, { 'x-api-key': 'KEY-3', authorization: 'Bearer KEY-3' })
})

test('云知声 parse：字段映射、校验、去重', () => {
  const rows = unisound.catalog.parse({ data: [
    { id: 'u2-flash', display_name: '宇视 U2 Flash', context_window: 1_048_576, max_output: 131_072 },
    { id: 'u2', display_name: 'U2', context_window: 262_144, max_output: 65_536 },
    { id: 'u2-med', context_window: 128_000, max_output: 32_768 }, // 缺 display_name → 用 id
    { id: 'u2-radimed', display_name: 'U2 RadiMed', context_window: 0, max_output: -1 },
    { id: 'doubao-seed-1-6', display_name: '豆包', context_window: 'x', max_output: 1.5 }, // 非正整数 → 0
    { id: 'u2-flash' }, // 去重
    { id: '' }, { id: 'x'.repeat(257) }, { id: 9 }, 'junk', {},
  ], has_more: false })
  assert.deepEqual(rows.map(row => row.id), ['u2-flash', 'u2', 'u2-med', 'u2-radimed', 'doubao-seed-1-6'])
  const flash = rows[0]
  assert.equal(flash.name, '宇视 U2 Flash')
  assert.equal(flash.context, 1_048_576)
  assert.equal(flash.output, 131_072)
  assert.equal(rows.find(row => row.id === 'u2-med').name, 'u2-med')
  assert.equal(rows.find(row => row.id === 'u2-radimed').context, 0)
  assert.equal(rows.find(row => row.id === 'u2-radimed').output, 0)
  const doubao = rows.find(row => row.id === 'doubao-seed-1-6')
  assert.equal(doubao.context, 0)
  assert.equal(doubao.output, 0)
  // 官方模型页「输入模态」声明：u2-flash / u2-med 为「文本、图片」，
  // u2-radimed 为影像与文本混合输入；u2 只声明文本输入。
  // u2 系列按官方文档；转售第三方模型按「同 id 在其它渠道上游目录的声明」
  //（大小写归一）。未列出的保守判不支持。
  assert.deepEqual(rows.filter(row => row.attachment).map(row => row.id), ['u2-flash', 'u2-med', 'u2-radimed'])
  // 转售第三方模型按 pi-ai 内置目录（@earendil-works/pi-ai providers/data）逐 provider
  // 全票判定；大小写归一后匹配。
  const cross = unisound.catalog.parse({ data: [
    { id: 'Qwen3.8-Max', context_window: 1_048_576, max_output: 131_072 },
    { id: 'qwen3.7-plus', context_window: 1_048_576, max_output: 131_072 },
    { id: 'glm-5.3-flash', context_window: 1_048_576, max_output: 131_072 },
    { id: 'doubao-seed-2.1-turbo', context_window: 262_144, max_output: 262_144 },
    { id: 'GLM-5.3', context_window: 1_048_576, max_output: 131_072 },
    { id: 'deepseek-v4-pro', context_window: 1_048_576, max_output: 393_216 },
    { id: 'qwen3.7-max', context_window: 1_048_576, max_output: 131_072 },
    { id: 'hy3', context_window: 262_144, max_output: 131_072 },
  ] })
  assert.equal(cross.find(r => r.id === 'Qwen3.8-Max').attachment, true, '大小写归一到 pi-ai 判定')
  assert.equal(cross.find(r => r.id === 'qwen3.7-plus').attachment, true)
  // pi-ai 无条目时按官方文档：阿里云百炼「原生视觉语言模型」，输入 Image/Text/Video。
  assert.equal(unisound.catalog.parse({ data: [{ id: 'Qwen3.6-35B-A3B' }] })[0].attachment, true)
  assert.equal(cross.find(r => r.id === 'glm-5.3-flash').attachment, true, 'pi-ai 多数 provider 判支持')
  assert.equal(cross.find(r => r.id === 'doubao-seed-2.1-turbo').attachment, true, '无 pi-ai 条目时按渠道上游声明')
  // pi-ai 全部 provider 判纯文本的模型不得放开（WorkBuddy 声明支持也不改云知声口径）。
  for (const id of ['GLM-5.3', 'deepseek-v4-pro', 'qwen3.7-max', 'hy3'])
    assert.equal(cross.find(r => r.id === id).attachment, false, id + ' 应判纯文本')
  assert.deepEqual(doubao.efforts, [])
  assert.equal(doubao.reasoning, false)
  for (const bad of [undefined, null, 'x', [], { data: {} }, { data: 'list' }]) {
    assert.deepEqual(unisound.catalog.parse(bad), [], JSON.stringify(bad))
  }
})

test('云知声 u2 系列思考档位', () => {
  const catalog = unisound.catalog.parse({ data: [
    { id: 'u2-flash' }, { id: 'u2' }, { id: 'u2-med' }, { id: 'u2-radimed' }, { id: 'kimi-k2' },
  ] })
  for (const id of ['u2-flash', 'u2', 'u2-med']) {
    const row = catalog.find(entry => entry.id === id)
    assert.deepEqual(row.efforts, UNISOUND_EFFORTS, id)
    assert.equal(row.defaultEffort, 'high', id)
    assert.equal(row.reasoning, true, id)
  }
  // u2-radimed 默认关闭且不支持开启。
  const radimed = catalog.find(row => row.id === 'u2-radimed')
  assert.deepEqual(radimed.efforts, [])
  assert.equal(radimed.reasoning, false)
  // 其余模型不确认就不声明。
  const kimi = catalog.find(row => row.id === 'kimi-k2')
  assert.deepEqual(kimi.efforts, [])
  assert.equal(kimi.reasoning, false)
})

test('云知声 catalog.next：has_more+last_id 才翻页', () => {
  assert.equal(unisound.catalog.next({ has_more: true, last_id: 'u2' }), 'u2')
  for (const json of [
    undefined, null, 'x', {},
    { has_more: false, last_id: 'u2' },
    { has_more: true },
    { has_more: true, last_id: '' },
    { has_more: true, last_id: 7 },
    { has_more: 'true', last_id: 'u2' },
  ]) {
    assert.equal(unisound.catalog.next(json), undefined, JSON.stringify(json))
  }
})

test('云知声 effortBody：只在行档位表内发 reasoning_effort', () => {
  const u2 = unisound.fallback.find(row => row.id === 'u2')
  assert.deepEqual(unisound.effortBody('off', u2), { reasoning_effort: 'none' })
  for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
    assert.deepEqual(unisound.effortBody(effort, u2), { reasoning_effort: effort })
  }
  for (const effort of [undefined, 'max', 'banana', 'none']) {
    assert.equal(unisound.effortBody(effort, u2), undefined, `effort=${String(effort)}`)
  }
  // 无思考档位的行（含兜底表外模型）任何档位都不发。
  const radimed = unisound.fallback.find(row => row.id === 'u2-radimed')
  for (const effort of ['off', 'low', 'high']) {
    assert.equal(unisound.effortBody(effort, radimed), undefined)
  }
  assert.equal(unisound.effortBody('low'), undefined)
  assert.equal(unisound.effortBody('low', {}), undefined)
})

test('云知声 fallback：四个官方确认的 u2 模型取官方规格；无余额接口', () => {
  assert.deepEqual(unisound.fallback.map(row => row.id), ['u2-flash', 'u2', 'u2-med', 'u2-radimed'])
  const flash = unisound.fallback[0]
  assert.equal(flash.context, 1_048_576) // 官方产品页：上下文 1M
  assert.equal(flash.output, 262_144)    // 1118 官方规格：最大输出 256K
  const u2 = unisound.fallback[1]
  // 上游目录真值（2026-11-23 真实 Key 拉取），优先于第三方转述的 163K/65K
  assert.equal(u2.context, 160_000)
  assert.equal(u2.output, 64_000)
  const med = unisound.fallback[2]
  assert.equal(med.context, 262_144)
  assert.equal(med.output, 0, '上游 max_output 为 null，记 0 不编造')
  const radimed = unisound.fallback[3]
  assert.equal(radimed.context, 40_960, '上游目录真值')
  assert.equal(radimed.output, 0, '上游 max_output 为 null')
  assert.deepEqual(unisound.fallback.filter(row => row.attachment).map(row => row.id), ['u2-flash', 'u2-med', 'u2-radimed'])
  assert.equal(unisound.balance, null)
})

test('云知声断网时沿用旧目录并修正图片标记', () => {
  const source = { id: 'u2-flash', name: '缓存名称', attachment: false, context: 1048576, output: 131072 }
  assert.deepEqual(unisound.catalog.restore(source), { ...source, attachment: true })
  // u2-med 官方声明支持图片：旧缓存里 attachment=false 也要按当前声明修正。
  assert.equal(unisound.catalog.restore({ ...source, id: 'u2-med', attachment: false }).attachment, true)
  // u2 只声明文本输入：旧缓存里的 true 同样按当前声明修正。
  assert.equal(unisound.catalog.restore({ ...source, id: 'u2', attachment: true }).attachment, false)
})

test('分渠道默认输出上限：只在上游缺输出规格时生效，上游有值不覆盖', async () => {
  const { createApiKeyModelSettings } = await import('../lib/apikey-models.js')
  const remote = [
    // 上游给了真实规格 → 必须用上游值，即使配了默认上限
    { id: 'u2-flash', name: 'U2 Flash', context: 1_048_576, output: 262_144, attachment: true, efforts: [], defaultEffort: undefined },
    // 上游 max_output 为 null → 用渠道默认上限（受上下文约束）
    { id: 'u2-med', name: 'U2 Med', context: 262_144, output: 0, attachment: true, efforts: [], defaultEffort: undefined },
    // 上下文比配置值小时取上下文
    { id: 'small', name: 'Small', context: 40_960, output: 0, attachment: false, efforts: [], defaultEffort: undefined },
  ]
  const none = await createApiKeyModelSettings(null, 'unisound').list(remote)
  assert.equal(none.find(r => r.id === 'u2-med').maxOutputLength, 32_768, '未配置时按上下文推导')
  const capped = await createApiKeyModelSettings(null, 'unisound', { defaultMaxOutput: () => 131_072 }).list(remote)
  assert.equal(capped.find(r => r.id === 'u2-flash').maxOutputLength, 262_144, '上游有值不覆盖')
  assert.equal(capped.find(r => r.id === 'u2-med').maxOutputLength, 131_072, '上游缺失时用渠道默认')
  // modelTokenBudget 始终保留「输出 < 上下文」的保护，故取 context - 1。
  assert.equal(capped.find(r => r.id === 'small').maxOutputLength, 40_959, '不超过上下文窗口')
  // 设置清除后回到推导
  const cleared = await createApiKeyModelSettings(null, 'unisound', { defaultMaxOutput: () => undefined }).list(remote)
  assert.equal(cleared.find(r => r.id === 'u2-med').maxOutputLength, 32_768)
})
