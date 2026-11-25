// **接入一个新 API Key 渠道只需要写规格数据** —— 这条用例就是这句话的验收。
//
// 为什么需要它：模块化最容易退化成「文件分开了，但加渠道还是得改共享层」。
// 本次重写前，控制台额度和限流识别是 `lib/apikey-quota.js` 里一串
// `provider === 'agnes' ? … : …`：凭据形态、鉴权头、成功码、窗口字段全都要么走
// agnes 分支要么走 else 分支，第三个渠道接进来只能继续嵌套三元。
//
// 这里用一个**完全虚构的渠道**（`fixture-key`，上游地址都是 example 域）走通
// 额度读取、限流识别与管理器全链路。如果哪天它必须改 `lib/` 里的共享文件才能过，
// 就说明模块化退化了 —— 这条用例会先红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiKeyManager } from '../lib/apikey-channel.js'
import { detectApiKeyRateLimit, readApiKeyQuota } from '../lib/apikey-quota.js'
import { apiQuotaWindow } from '../lib/apikey-quota-projection.js'

/**
 * 虚构渠道的完整规格。除了自带的上游地址，形状与真实渠道（Agnes / 云知声）完全一致
 * —— 这正是「只加数据」的意思：共享层不认识 `fixture-key` 这个名字。
 */
const FIXTURE = Object.freeze({
  id: 'fixture-key',
  title: 'Fixture',
  endpoint: 'https://api.fixture.example',
  chatPath: '/v1/chat/completions',
  baseUrl: 'https://api.fixture.example/v1',
  credentialRef: 'UNIFIED_ROUTER_FIXTURE_API_KEY',
  consoleCredentialRef: 'UNIFIED_ROUTER_FIXTURE_CONSOLE',
  consoleQuota: {
    consoleUrl: 'https://console.fixture.example/subscription',
    baseUrl: 'https://console.fixture.example/api',
    credentialEnv: 'UNIFIED_ROUTER_FIXTURE_CONSOLE_TOKEN',
    headers: session => ({ authorization: 'Bearer ' + session }),
    paths: ['/usage'],
    pick: json => (json?.ok === true ? json.payload : null),
    read([usage]) {
      return {
        windows: [apiQuotaWindow('monthly-credits', usage?.used, usage?.total, usage?.remaining)].filter(Boolean),
        gifts: [],
        balance: typeof usage?.cash === 'number' ? usage.cash : null,
      }
    },
    expiredCodes: ['401'],
  },
  rateLimit: { scanOnOk: true, codes: { fixture_rpm: 'rpm', fixture_tpm: 'tpm' } },
  catalog: {
    request: key => ({ url: 'https://api.fixture.example/v1/models', headers: { authorization: 'Bearer ' + key } }),
    parse(json) {
      if (!Array.isArray(json?.data)) return []
      return json.data.map(row => ({
        id: row.id, name: row.id, context: 8192, output: 1024,
        attachment: false, reasoning: false, efforts: [], defaultEffort: undefined,
      }))
    },
  },
  fallback: [{
    id: 'fixture-fallback', name: 'fixture-fallback', context: 8192, output: 1024,
    attachment: false, reasoning: false, efforts: [], defaultEffort: undefined,
  }],
  effortBody: () => undefined,
  balance: null,
})

function credentialsFixture(values = new Map()) {
  return {
    values,
    async resolve(key) { return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) { values.set(key, value) },
    async unset(key) { values.delete(key) },
  }
}
function context(credentials) {
  const services = { credentials, logger: { warn() {}, error() {}, info() {} } }
  return { ...services, get(name) { return this[name] } }
}

test('虚构渠道：控制台额度按规格里的配方取数与解析，执行器不认识渠道名', async () => {
  const seen = []
  const quota = await readApiKeyQuota(FIXTURE, async ({ url, headers }) => {
    seen.push({ url, headers })
    return { ok: true, payload: { used: 10, total: 100, cash: 5 } }
  }, undefined, { UNIFIED_ROUTER_FIXTURE_CONSOLE_TOKEN: 'console-token' })
  assert.equal(quota.status, 'ready')
  assert.deepEqual(seen, [{ url: 'https://console.fixture.example/api/usage', headers: { authorization: 'Bearer console-token' } }])
  assert.deepEqual(quota.windows.map(row => [row.id, row.used, row.limit]), [['monthly-credits', 10, 100]])
  assert.equal(quota.balance, 5)
})

test('虚构渠道：没有控制台会话时报 needs-console，不发任何请求', async () => {
  const quota = await readApiKeyQuota(FIXTURE, () => assert.fail('不该发请求'), undefined, {})
  assert.deepEqual(quota, { status: 'needs-console' })
})

test('虚构渠道：会话失效判据也由规格声明（业务码 + 中文错误串）', async () => {
  const byCode = await readApiKeyQuota(FIXTURE, async () => ({ ok: false, code: '401' }), undefined,
    { UNIFIED_ROUTER_FIXTURE_CONSOLE_TOKEN: 'x' })
  assert.deepEqual(byCode, { status: 'expired' })
})

test('虚构渠道：限流码由规格声明，2xx 也按 scanOnOk 扫描', async () => {
  const rpm = await detectApiKeyRateLimit(FIXTURE, new Response(JSON.stringify({ error: { code: 'fixture_rpm' } }), {
    headers: { 'content-type': 'application/json', 'retry-after': '3' },
  }), 1000)
  assert.deepEqual(rpm, { until: 4000, reason: 'rpm', estimated: false })
  const tpm = await detectApiKeyRateLimit(FIXTURE, new Response(JSON.stringify({ error: { code: 'fixture_tpm' } }), {
    headers: { 'content-type': 'application/json' },
  }), 1000)
  assert.equal(tpm.reason, 'tpm')
})

test('没有 consoleQuota 的渠道不读控制台额度（可选字段，不是必填）', async () => {
  assert.equal(await readApiKeyQuota({ ...FIXTURE, consoleQuota: undefined }, () => assert.fail('不该发请求'), undefined, {}), null)
})

test('管理器全链路：虚构渠道的账号状态、目录与控制台额度全部从规格派生', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apikey-fixture-'))
  const credentials = credentialsFixture()
  const fetchImpl = async (url, init = {}) => {
    const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (String(url).endsWith('/v1/models')) {
      assert.equal(init.headers.authorization, 'Bearer sk-fixture-key')
      return json({ data: [{ id: 'fixture-1' }] })
    }
    if (String(url).endsWith('/api/usage')) return json({ ok: true, payload: { used: 3, total: 50 } })
    return json({})
  }
  const manager = createApiKeyManager(context(credentials), FIXTURE, {
    stateFile: join(dir, 'state.json'),
    catalogFile: join(dir, 'catalog.json'),
    modelSettingsFile: join(dir, 'models.json'),
    fetch: fetchImpl,
    env: {},
    modelSettings: { list: async rows => rows, change: async () => [] },
  })
  try {
    await manager.call('apikey.setKey', { provider: 'fixture-key', apiKey: 'sk-fixture-key' })
    const snap = await manager.call('apikey.snapshot', { provider: 'fixture-key' })
    assert.equal(snap.hasKey, true)
    // 控制台页面地址从规格透出（客户端不再维护渠道 id → URL 的映射表）。
    assert.equal(snap.consoleQuotaUrl, 'https://console.fixture.example/subscription')
    assert.deepEqual(snap.models.map(model => model.id), ['fixture-1'])
    // 凭据原文不进快照。
    assert.doesNotMatch(JSON.stringify(snap), /sk-fixture-key/)
  } finally {
    manager.dispose?.()
    await rm(dir, { recursive: true, force: true })
  }
})
