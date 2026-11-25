import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiKeyManager } from '../lib/apikey-channel.js'
import { readApiKeyQuota } from '../lib/apikey-quota.js'
import { apikeyProvider } from '../lib/apikey-providers.js'
import { unisoundToolSpecs, registerUnisoundTools } from '../lib/unisound-tools.js'

// 规格对象就是额度执行器的入参：渠道差异全在规格里，执行器不含渠道名。
const SPEC_UNISOUND = apikeyProvider('unisound')
const SPEC_AGNES = apikeyProvider('agnes')


const KEY = 'sk-unisound-tools-SECRET'
const COOKIE = 'sessionid=console-SECRET; XSRF-TOKEN=xsrf%2Dvalue'

function credentialsFixture(values = new Map()) {
  return {
    values,
    async resolve(key) { return values.has(key) ? { value: values.get(key) } : undefined },
    async set(key, value) { values.set(key, value) },
    async unset(key) { values.delete(key) },
  }
}
function context(credentials, extras = {}) {
  const services = { credentials, logger: { warn() {}, error() {}, info() {} }, ...extras }
  return { ...services, get(name) { return this[name] } }
}

// 云知声规格的最小测试替身：目录/余额与真实规格同形，tools/console 字段照抄。
// 真规格打底，只把与上游交互的部分覆盖成测试专用。
// 这样契约加字段时本用例自动跟随（控制台额度的配方搬进规格后就撞上过：内联假
// spec 缺 consoleQuota，快照读不到额度，断言直接变成 undefined）。
const spec = {
  ...apikeyProvider('unisound'),
  catalog: { request: () => ({ url: 'https://maas-api.unisound.com/anthropic/v1/models', headers: {} }), parse: () => [], next: () => undefined },
  fallback: [],
  effortBody: () => undefined,
}

async function filesFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'unisound-tools-test-'))
  return { dir, stateFile: join(dir, 'state.json'), catalogFile: join(dir, 'catalog.json'), modelSettingsFile: join(dir, 'models.json') }
}

// 假 fetch：按 URL 应答云知声工作流；记录请求供断言（Authorization 只验存在）。
function workflowFetch({ taskStatus = 'success', failUpload = false } = {}) {
  const requests = []
  const impl = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body })
    const u = String(url)
    const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (u.endsWith('/v1/files/upload')) {
      if (failUpload) return json({ base_resp: { status_code: 100001, status_msg: 'bad file' } })
      return json({ base_resp: { status_code: 0 }, file_id: 42 })
    }
    if (u.endsWith('/v1/audio/asr/tasks') && init.method === 'POST') return json({ base_resp: { status_code: 0 }, task_id: 't-asr' })
    if (u.includes('/v1/audio/asr/tasks/')) return json({ base_resp: { status_code: 0 }, status: taskStatus, duration: 12, results: [{ text: '你好 世界' }] })
    if (u.endsWith('/v1/audio/voices/query')) return json({ base_resp: { status_code: 0 }, system_voice: [{ voice_id: 'sys-1', name: '系统音色' }], voice_cloning: [{ voice_id: 'clone-1', name: '克隆音色' }] })
    if (u.endsWith('/v1/audio/speech/tasks') && init.method === 'POST') return json({ base_resp: { status_code: 0 }, task_id: 't-tts', usage_characters: 4 })
    if (u.includes('/v1/audio/speech/tasks?')) return json({ base_resp: { status_code: 0 }, status: taskStatus, file_id: 77 })
    if (u.includes('/v1/files/retrieve_content')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
    if (u.endsWith('/v1/audio/voices/clone')) return json({ base_resp: { status_code: 0 }, demo_audio: 'x', input_sensitive: false })
    if (u.endsWith('/v1/files/parser/tasks') && init.method === 'POST') return json({ base_resp: { status_code: 0 }, task_id: 't-ocr' })
    if (u.includes('/v1/files/parser/tasks/')) return json({ base_resp: { status_code: 0 }, status: taskStatus, data_info: { num_pages: 2 }, md_file_url: 'https://files.example/md' })
    if (u === 'https://files.example/md') return new Response('# 标题\n正文')
    if (u.endsWith('/v1/ocr/image/extract')) {
      const form = init.body
      if (!['u2-ocr', 'u2-ocr-med'].includes(form?.get('model')) || form?.get('type') !== 'image'
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(form?.get('file') ?? '') || form?.has('image')) {
        return new Response('{"base_resp":{"status_code":100105}}', { status: 404 })
      }
      return json({ base_resp: { status_code: 0 }, content: '[{"docType":"增值税发票"}]' })
    }
    if (u.endsWith('/manager/account/info')) return json({ errorCode: '0', result: { userName: '测试' } })
    if (u.endsWith('/manager/u-plan/subscription/current')) return json({ errorCode: '0', result: { weeklyPointsTotal: 2500, weeklyPointsUsed: 100, window5hLimit: 500, window5hRemain: 300 } })
    return json({ base_resp: { status_code: 0 } })
  }
  return { impl, requests }
}

function toolsStub() {
  const registered = []
  return {
    registered,
    register(definition) {
      const record = { definition, released: false }
      registered.push(record)
      return () => { record.released = true }
    },
  }
}

// defineTool 测试替身：保留 name/execute/output，参数校验从简（真实校验由核心做）。
const defineToolStub = options => ({
  name: options.name, description: options.description, parameters: options.parameters,
  output: options.output, execute: options.execute,
})

test('工具规格：六个工具、名称与参数契约稳定', () => {
  const specs = unisoundToolSpecs()
  assert.deepEqual(specs.map(s => s.name), [
    'unisound_transcribe', 'unisound_list_voices', 'unisound_synthesize',
    'unisound_clone_voice', 'unisound_parse_document', 'unisound_extract_image',
  ])
  for (const s of specs) {
    assert.ok(s.description.length > 10)
    assert.equal(typeof s.run, 'function')
  }
})

test('真实规格：控制台登录直达 /login（避免 SPA 匿名会话干扰收割）', async () => {
  const { apikeyProvider } = await import('../lib/apikey-providers.js')
  const real = apikeyProvider('unisound')
  assert.equal(real.consoleLogin.url, 'https://maas.unisound.com/login')
  assert.equal(real.consoleLogin.verifyUrl, 'https://maas.unisound.com/manager/account/info')
})

test('工具工作流：转写/合成/克隆/解析/抽取走官方端点，Key 只进请求头不进结果', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unisound-wf-'))
  const audio = join(dir, 'a.wav'); const { writeFile } = await import('node:fs/promises')
  await writeFile(audio, 'RIFFfake')
  const image = join(dir, '样本.PNG')
  const fixtureImage = Buffer.from('89504e470d0a1a0a', 'hex')
  await writeFile(image, fixtureImage)
  const wf = workflowFetch()
  const tools = toolsStub()
  const dispose = await registerUnisoundTools({
    tools, resolveKey: async () => KEY, fetchImpl: wf.impl, outputDir: dir, defineTool: defineToolStub,
  })
  try {
    assert.equal(tools.registered.length, 6)
    const byName = Object.fromEntries(tools.registered.map(r => [r.definition.name, r.definition]))
    const exec = (name, args) => byName[name].execute(args, { signal: undefined })
    const asr = await exec('unisound_transcribe', { file_path: audio })
    assert.equal(asr.task_id, 't-asr'); assert.equal(asr.text, '你好 世界')
    const voices = await exec('unisound_list_voices', {})
    assert.deepEqual(voices.system_voice.map(v => v.voice_id), ['sys-1'])
    const tts = await exec('unisound_synthesize', { text: '你好', voice_id: 'sys-1', output_path: join(dir, 'out.mp3') })
    assert.equal(tts.model, 'u2-tts'); assert.equal(tts.bytes, 3)
    assert.equal((await readFile(join(dir, 'out.mp3'))).length, 3)
    const clone = await exec('unisound_clone_voice', { audio_path: audio, voice_id: 'my-voice' })
    assert.equal(clone.voice_id, 'my-voice')
    const ocr = await exec('unisound_parse_document', { file_path: audio })
    assert.equal(ocr.num_pages, 2); assert.match(ocr.text, /标题/)
    const extract = await exec('unisound_extract_image', { image_path: image, task_type: 'general_classify' })
    assert.equal(extract.model, 'u2-ocr')
    assert.match(extract.content, /增值税发票/)
    // Key 只出现在请求头；任何结果 JSON 都不含 Key。
    for (const r of wf.requests) {
      if (r.headers?.authorization) assert.equal(r.headers.authorization, `Bearer ${KEY}`)
    }
    assert.doesNotMatch(JSON.stringify([asr, voices, tts, clone, ocr, extract]), /SECRET/)
    // 医疗分类 prompt 从资产文件加载（含候选类型表）。
    const med = await exec('unisound_extract_image', { image_path: image, task_type: 'medical_classify' })
    assert.equal(med.model, 'u2-ocr-med')
    const medReq = wf.requests.filter(r => r.url.endsWith('/v1/ocr/image/extract')).at(-1)
    assert.ok(medReq.body instanceof FormData)
    assert.equal(medReq.body.get('type'), 'image')
    assert.equal(medReq.body.get('file'), `data:image/png;base64,${fixtureImage.toString('base64')}`)
    assert.equal(medReq.body.has('image'), false)
    assert.match(medReq.body.get('prompt'), /其他文书/)
  } finally { dispose() }
  assert.ok(tools.registered.every(r => r.released))
  await rm(dir, { recursive: true, force: true })
})

test('工具工作流：业务码非 0 抛错且文案不含 Key；file_path/file_url 互斥', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unisound-wf-err-'))
  const { writeFile } = await import('node:fs/promises')
  const audio = join(dir, 'a.wav'); await writeFile(audio, 'x')
  const wf = workflowFetch({ failUpload: true })
  const tools = toolsStub()
  const dispose = await registerUnisoundTools({ tools, resolveKey: async () => KEY, fetchImpl: wf.impl, outputDir: dir, defineTool: defineToolStub })
  try {
    const byName = Object.fromEntries(tools.registered.map(r => [r.definition.name, r.definition]))
    await assert.rejects(() => byName.unisound_transcribe.execute({ file_path: audio }, { signal: undefined }), /100001/)
    await assert.rejects(() => byName.unisound_transcribe.execute({}, { signal: undefined }), /二选一/)
    await assert.rejects(() => byName.unisound_transcribe.execute({ file_path: audio, file_url: 'https://x/a.mp3' }, { signal: undefined }), /二选一/)
    await assert.rejects(() => byName.unisound_extract_image.execute({ image_path: audio, task_type: 'general_extract' }, { signal: undefined }), /schema/)
    await assert.rejects(() => byName.unisound_extract_image.execute({ image_path: audio }, { signal: undefined }), /图片格式/)
  } finally { dispose() }
  await rm(dir, { recursive: true, force: true })
})

test('管理器：工具开关持久化、需 Key、注册/释放生命周期；快照透出工具状态', async () => {
  const files = await filesFixture()
  const credentials = credentialsFixture()
  const tools = toolsStub()
  const wf = workflowFetch()
  const manager = createApiKeyManager(context(credentials, { tools }), spec, {
    ...files, fetch: wf.impl, env: {},
    modelSettings: { list: async rows => rows.map(r => ({ ...r, enabled: true })), change: async () => [] },
    loadLlmAdapter: async () => ({ createApiKeyAdapter: async () => ({ adapter: {}, providerIds: ['unisound'] }) }),
    loadToolsModule: async () => ({ registerTools: registerUnisoundTools }),
    loadToolsRuntime: async () => ({ defineTool: defineToolStub }),
  })
  try {
    // 无 Key：开关拒绝。
    await assert.rejects(() => manager.call('apikey.setToolsEnabled', { provider: 'unisound', enabled: true }), /API Key/)
    await manager.call('apikey.setKey', { provider: 'unisound', apiKey: KEY })
    const on = await manager.call('apikey.setToolsEnabled', { provider: 'unisound', enabled: true })
    assert.deepEqual(on, { toolsEnabled: true, toolsRegistered: true })
    assert.equal(tools.registered.length, 6)
    assert.deepEqual(JSON.parse(await readFile(files.stateFile, 'utf8')), { enabled: false, toolsEnabled: true })
    const snap = await manager.call('apikey.snapshot', { provider: 'unisound' })
    assert.equal(snap.toolsSupported, true); assert.equal(snap.toolsEnabled, true); assert.equal(snap.toolsRegistered, true)
    const off = await manager.call('apikey.setToolsEnabled', { provider: 'unisound', enabled: false })
    assert.deepEqual(off, { toolsEnabled: false, toolsRegistered: false })
    assert.ok(tools.registered.every(r => r.released))
    // 新实例读回 toolsEnabled=false。
    const reborn = createApiKeyManager(context(credentials, { tools: toolsStub() }), spec, {
      ...files, fetch: wf.impl, env: {},
      modelSettings: { list: async rows => rows, change: async () => [] },
      loadToolsModule: async () => ({ registerTools: registerUnisoundTools }), loadToolsRuntime: async () => ({ defineTool: defineToolStub }),
    })
    const snap2 = await reborn.call('apikey.snapshot', { provider: 'unisound' })
    assert.equal(snap2.toolsEnabled, false)
    reborn.dispose()
  } finally { manager.dispose() }
  assert.ok(tools.registered.every(r => r.released))
  await rm(files.dir, { recursive: true, force: true })
})

test('管理器：控制台会话粘贴验证后存凭据；浏览器登录收割 Cookie；清除；额度读凭据优先', async () => {
  const files = await filesFixture()
  const credentials = credentialsFixture()
  const wf = workflowFetch()
  let harvestedCookie = null
  const manager = createApiKeyManager(context(credentials), spec, {
    ...files, fetch: wf.impl, env: {},
    modelSettings: { list: async rows => rows, change: async () => [] },
    browserLogin: async ({ matchCookies, onUrl }) => {
      onUrl('https://maas.unisound.com/login')
      const cookies = [
        { domain: '.maas.unisound.com', name: 'sessionid', value: 'console-SECRET' },
        { domain: 'maas.unisound.com', name: 'XSRF-TOKEN', value: 'xsrf%2Dvalue' },
        { domain: 'other.example', name: 'x', value: 'y' },
      ]
      // 第一轮：候选记录（返回 null）；第二轮（≥1.5s 后同一会话）：接受。
      const first = await matchCookies(cookies)
      if (first) return first
      await new Promise(resolve => setTimeout(resolve, 1600))
      harvestedCookie = await matchCookies(cookies)
      return harvestedCookie
    },
  })
  try {
    await manager.call('apikey.setKey', { provider: 'unisound', apiKey: KEY })
    // 粘贴：验证通过 → 存凭据；快照只透出布尔。
    const saved = await manager.call('apikey.setConsoleSession', { provider: 'unisound', cookie: COOKIE })
    assert.deepEqual(saved, { hasConsoleSession: true })
    assert.equal(credentials.values.get('UNIFIED_ROUTER_UNISOUND_CONSOLE'), COOKIE)
    const snap = await manager.call('apikey.snapshot', { provider: 'unisound' })
    assert.equal(snap.hasConsoleSession, true)
    assert.doesNotMatch(JSON.stringify(snap), /SECRET/)
    // 额度：凭据会话优先于 env（env 给一个不同的值，请求头应带凭据里的）。
    assert.equal(snap.quota?.status, 'ready')
    const quotaReq = wf.requests.filter(r => r.url.endsWith('/u-plan/subscription/current')).at(-1)
    assert.equal(quotaReq.headers.cookie, COOKIE)
    assert.equal(quotaReq.headers['x-xsrf-token'], 'xsrf-value')
    // 清除。
    const cleared = await manager.call('apikey.clearConsoleSession', { provider: 'unisound' })
    assert.deepEqual(cleared, { hasConsoleSession: false })
    assert.equal(credentials.values.has('UNIFIED_ROUTER_UNISOUND_CONSOLE'), false)
    // 浏览器登录：收割 → 验证 → 存凭据。
    const login = await manager.call('apikey.consoleLogin', { provider: 'unisound' })
    assert.deepEqual(login, { signedIn: true, hasConsoleSession: true })
    assert.equal(credentials.values.get('UNIFIED_ROUTER_UNISOUND_CONSOLE'), harvestedCookie)
    assert.match(harvestedCookie, /sessionid=console-SECRET/)
    assert.doesNotMatch(harvestedCookie, /other\.example|x=y/)
  } finally { manager.dispose() }
  await rm(files.dir, { recursive: true, force: true })
})

test('额度：凭据会话优先于环境变量；无会话报 needs-console；XSRF 头随 Cookie', async () => {
  const seen = []
  const fetchJson = async ({ headers }) => { seen.push(headers); return { errorCode: '0', result: { weeklyPointsTotal: 100, weeklyPointsUsed: 0 } } }
  const fromCred = await readApiKeyQuota(SPEC_UNISOUND, fetchJson, undefined, { UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE: 'env=1' }, 'cred=1; XSRF-TOKEN=t%20k')
  assert.equal(fromCred.status, 'ready')
  assert.equal(seen.at(-1).cookie, 'cred=1; XSRF-TOKEN=t%20k')
  assert.equal(seen.at(-1)['x-xsrf-token'], 't k')
  const fromEnv = await readApiKeyQuota(SPEC_UNISOUND, fetchJson, undefined, { UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE: 'env=1' })
  assert.equal(fromEnv.status, 'ready')
  assert.equal(seen.at(-1).cookie, 'env=1')
  assert.deepEqual(await readApiKeyQuota(SPEC_UNISOUND, fetchJson, undefined, {}), { status: 'needs-console' })
})