import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTools, registerSenseNovaTools } from '../lib/image-tools.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApiKeyManager } from '../lib/apikey-channel.js'
import { apikeyProvider } from '../lib/apikey-providers.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64')
const ref = (char, bytes = PNG.length) => ({ attachmentId: `sha256:${char.repeat(64)}`, mediaType: 'image/png', bytes, width: 1, height: 1 })
const first = ref('a'), second = ref('b'), output = ref('c')
const renderImages = (...refs) => ({ deriveMessages: () => [{ role: 'user', content: refs.map(attachment => ({ type: 'image', attachment })) }] })
const ok = () => Response.json({ data: [{ b64_json: PNG.toString('base64') }] })

function fixture(fetcher = ok, key = 'test-key', register = registerTools) {
  const calls = [], read = [], saves = []
  let definition, removed = false
  const dispose = register({
    tools: { register(tool) { definition = tool; return () => { removed = true } } },
    defineTool: value => value, resolveKey: async () => key,
    attachments: {
      async readImage(attachment, signal) { signal.throwIfAborted(); read.push(attachment); return { data: PNG } },
      async saveImage(data) { saves.push(data); return output },
    },
    async fetchImpl(url, options) { calls.push({ url, options, body: JSON.parse(options.body) }); return fetcher(url, options) },
  })
  const execute = (args, session, signal = new AbortController().signal) => definition.execute(args, { signal, agent: { session } })
  return { execute, calls, read, saves, definition, dispose, removed: () => removed }
}

test('Agnes 文生图发送官方字段，并给模型与结果卡片返回图片附件', async () => {
  const f = fixture()
  try {
    const result = await f.execute({ prompt: '画一个球' })
    assert.equal(f.definition.name, 'agnes_image_generate')
    assert.deepEqual(f.calls[0].body, { model: 'agnes-image-2.5-flash', prompt: '画一个球', size: '1K', ratio: '1:1', return_base64: true })
    assert.equal(f.calls[0].url, 'https://api.agnes-ai.cn/v1/images/generations')
    assert.equal(f.calls[0].options.redirect, 'error')
    assert.equal(f.calls[0].options.headers.authorization, 'Bearer test-key')
    assert.deepEqual(f.saves[0].data, PNG)
    assert.equal(result.operation, 'generate')
    const blocks = f.definition.output.render({}, result)
    assert.deepEqual(blocks[1], { type: 'image', attachment: result.image })
    assert.deepEqual(f.definition.presentResult({}, { meta: f.definition.output.presentationMeta({}, result) }).content, blocks.slice(1))
    assert.doesNotMatch(JSON.stringify(result), /test-key|base64/)
  } finally { f.dispose() }
  assert.equal(f.removed(), true)
})

test('商汤 Token Plan 生图和编辑使用各自的路径与尺寸', async () => {
  const f = fixture(ok, 'test-key', registerSenseNovaTools)
  try {
    await f.execute({ prompt: '画图' })
    await f.execute({ prompt: '改图', size: '2K', ratio: '16:9', references: [first.attachmentId] }, renderImages(first))
    assert.equal(f.definition.name, 'sensenova_image_generate')
    assert.equal(f.calls[0].url, 'https://token.sensenova.cn/v1/images/generations')
    assert.equal(f.calls[1].url, 'https://token.sensenova.cn/v1/images/edits')
    assert.equal(f.calls[0].body.size, '1024x1024')
    assert.equal(f.calls[1].body.size, '2048x1152')
    assert.deepEqual(f.calls[1].body.images, [{ image_url: `data:image/png;base64,${PNG.toString('base64')}` }])
    assert.equal(f.calls[1].body.response_format, 'b64_json')
  } finally { f.dispose() }
})

test('Agnes 编辑按参数顺序读取当前对话附件，拒绝外部 ID、路径和超量输入', async () => {
  const f = fixture()
  try {
    const session = renderImages(first, second, ref('e', 21 * 1024 * 1024))
    const args = { prompt: '改蓝色', model: 'agnes-image-2.1-flash', ratio: '4:3', references: [second.attachmentId, first.attachmentId] }
    const result = await f.execute(args, session)
    assert.deepEqual(f.read, [second, first])
    assert.deepEqual(f.calls[0].body, { model: args.model, prompt: args.prompt, size: '1K', ratio: '4:3', extra_body: {
      image: [first, second].map(() => `data:image/png;base64,${PNG.toString('base64')}`), response_format: 'b64_json',
    } })
    assert.equal(result.operation, 'edit')
    await assert.rejects(f.execute({ ...args, references: [output.attachmentId] }, session), /找不到参考图/)
    await assert.rejects(f.execute({ ...args, references: ['C:/secret.png'] }, session), /对话图片附件/)
    await assert.rejects(f.execute({ ...args, references: [ref('e').attachmentId] }, session), /20 MiB/)
    assert.equal(f.calls.length, 1)
  } finally { f.dispose() }
})

test('Agnes 脱敏上游错误，关闭工具会取消进行中的生成', async () => {
  const bad = fixture(() => new Response('private test-key', { status: 429 }))
  try { await assert.rejects(bad.execute({ prompt: '画图' }), { message: 'Agnes 图片请求失败（HTTP 429）。' }) }
  finally { bad.dispose() }
  const f = fixture((_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const call = f.execute({ prompt: '画图' })
  await new Promise(resolve => setImmediate(resolve))
  f.dispose()
  await assert.rejects(call, { name: 'AbortError' })
  assert.equal(f.saves.length, 0)
  const missing = fixture(ok, null)
  try { await assert.rejects(missing.execute({ prompt: '画图' }), /API Key/); assert.equal(missing.calls.length, 0) }
  finally { missing.dispose() }
})

test('Agnes 恢复工具开关后重新注册，关闭不改变聊天提供方', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agnes-image-settings-'))
  let registered = null
  const context = {
    credentials: { resolve: async () => ({ value: 'test-key' }) },
    tools: { register(definition) { registered = definition; return () => { registered = null } } },
    attachments: { async readImage() {}, async saveImage() {} },
  }
  const setup = () => createApiKeyManager(context, apikeyProvider('agnes'), {
    stateFile: join(dir, 'channel.json'), fetch: async () => Response.json({ data: [] }),
    loadToolsRuntime: async () => ({ defineTool: value => value }),
  })
  let manager = setup()
  const payload = { provider: 'agnes' }
  try {
    const before = await manager.call('apikey.snapshot', payload)
    assert.equal(before.toolsSupported, true)
    assert.equal(before.toolsEnabled, false)
    assert.equal(before.registered, false)
    assert.deepEqual(await manager.call('apikey.setToolsEnabled', { ...payload, enabled: true }), { toolsEnabled: true, toolsRegistered: true })
    assert.equal(registered.name, 'agnes_image_generate')
    manager.dispose()
    assert.equal(registered, null)
    manager = setup()
    const revived = await manager.call('apikey.snapshot', payload)
    assert.equal(revived.toolsRegistered, true)
    assert.equal(revived.registered, false)
    await manager.call('apikey.setToolsEnabled', { ...payload, enabled: false })
    assert.equal(registered, null)
  } finally { manager.dispose(); await rm(dir, { recursive: true, force: true }) }
})



test('读图工具返回 sha256 句柄：本地路径入库、会话附图可读、句柄能填进生成工具', async () => {
  const { registerImageReadTool, IMAGE_READ_TOOL_NAME } = await import('../lib/image-tools.js')
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'image-read-'))
  let definition
  const saved = []
  const dispose = registerImageReadTool({
    tools: { register(tool) { definition = tool; return () => {} } },
    defineTool: value => value,
    attachments: {
      async saveImage(data) { saved.push(data); return output },
      async readImage() { throw new Error('读图工具不应重新读字节') },
    },
    limits: { maxImageBytes: 20 * 1024 * 1024 },
  })
  try {
    assert.equal(definition.name, IMAGE_READ_TOOL_NAME)
    // 1) 本地路径 → saveImage 入库，文本里给出句柄。
    const file = join(dir, 'a.png')
    await writeFile(file, PNG)
    const local = await definition.execute({ path: file }, { signal: new AbortController().signal })
    assert.equal(saved.length, 1, '本地图片入库')
    assert.equal(local.attachmentId, output.attachmentId, '返回入库后的附件引用')
    // content 由 render 生成：文本里必须带句柄，且附带图片本体。
    const rendered = definition.output.render({}, local)
    assert.match(rendered[0].text, /sha256:[a-f0-9]{64}/, '文本给出句柄供模型复制')
    assert.ok(rendered.some(b => b.type === 'image'), '同时返回图片本体')
    // 2) 省略参数 → 读用户这条消息附带的图片。
    const latest = await definition.execute({}, { signal: new AbortController().signal, agent: { session: renderImages(first) } })
    assert.equal(latest.attachmentId, first.attachmentId, '句柄是用户附图那张')
    // 无名附件（夹具 ref 不带 name）：返回值不得含 undefined 属性 —— 宿主对工具输出做
    // lossless-JSON 快照，任一 undefined 值会让整条结果作废（核验 F1 回归）。
    assert.ok(!Object.hasOwn(latest, 'name'), 'name 缺席时不写该键')
    for (const [key, value] of Object.entries(latest)) assert.notEqual(value, undefined, `字段 ${key} 不得为 undefined`)
    // 3) 非法句柄 / 会话里没有 → 明确报错（不静默）。
    await assert.rejects(definition.execute({ attachmentId: 'C:/x.png' }, { signal: new AbortController().signal }), /句柄格式/)
    await assert.rejects(definition.execute({}, { signal: new AbortController().signal }), /没有可读的图片/)
  } finally { dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('生图工具的说明明确要求先调 image_read 取句柄', async () => {
  const f = fixture(ok, 'test-key', registerTools)
  try {
    // 模型只能看到工具描述与参数说明 —— 两处都必须指向读图工具，否则它仍会凭猜填句柄。
    assert.match(f.definition.description, /image_read/, '工具说明里点名读图工具')
    assert.match(f.definition.description, /sha256/, '说明要的是 sha256 句柄')
    assert.match(f.definition.parameters.references.description, /image_read/, '参数说明同样指引')
    assert.match(f.definition.parameters.references.description, /改图必填/)
  } finally { f.dispose() }
})

test('百炼图像生成：DashScope 协议、图生图 image 在前、b64_json 直出', async () => {
  const { registerBailianTools } = await import('../lib/image-tools.js')
  const calls = []
  let definition
  const dispose = registerBailianTools({
    tools: { register(tool) { definition = tool; return () => {} } },
    defineTool: value => value,
    resolveKey: async () => 'sk-sp-test',
    attachments: {
      async readImage() { return { data: PNG } },
      async saveImage(data) { return { ...output, bytes: data.length } },
    },
    // 百炼在 `response_format:'b64_json'` 下把图放在 output.choices[].message.content[].image（Data URL）。
    async fetchImpl(url, options) {
      calls.push({ url, body: JSON.parse(options.body) })
      return Response.json({ output: { choices: [{ message: { role: 'assistant', content: [{ image: `data:image/png;base64,${PNG.toString('base64')}` }] } }] } })
    },
  })
  try {
    assert.equal(definition.name, 'bailian_image_generate')
    // 文生图
    await definition.execute({ prompt: '一只橘猫', size: '2K', ratio: '16:9' }, { signal: new AbortController().signal })
    const gen = calls[0]
    assert.equal(gen.url, 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    assert.equal(gen.body.input.messages[0].content.length, 1, '文生图只有 text')
    assert.equal(gen.body.input.messages[0].content[0].text, '一只橘猫')
    assert.equal(gen.body.parameters.response_format, 'b64_json')
    assert.match(gen.body.parameters.size, /^\d+\*\d+$/, 'DashScope 用星号分隔')
    // 图生图：参考图必须在 text **之前**
    await definition.execute({ prompt: '改成水彩', references: [first.attachmentId] }, { signal: new AbortController().signal, agent: { session: renderImages(first) } })
    const edit = calls[1].body.input.messages[0].content
    assert.equal(edit.length, 2)
    assert.ok(edit[0].image?.startsWith('data:image/png;base64,'), '第一项是参考图')
    assert.equal(edit[1].text, '改成水彩', '第二项才是提示词')
  } finally { dispose() }
})

// 给最小 PNG 追加一个 tEXt 附加块（模拟上游 AIGC 标识），CRC 按 PNG 规范计算。
function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngWithText(base, keyword, text) {
  const payload = Buffer.from(`${keyword}\0${text}`, 'latin1')
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write('tEXt', 4, 'latin1')
  payload.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length)
  const iend = base.length - 12
  return Buffer.concat([base.subarray(0, iend), chunk, base.subarray(iend)])
}
function pngChunkTypes(bytes) {
  const types = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    types.push(bytes.toString('latin1', offset + 4, offset + 8))
    offset += 12 + length
    if (types.at(-1) === 'IEND') break
  }
  return types
}

test('PNG 输出单份保真：去元数据让宿主直通 PNG，不再另存原图', async () => {
  const upstream = pngWithText(PNG, 'AIGC', 'generated-content-label')
  assert.ok(pngChunkTypes(upstream).includes('tEXt'), '上游 PNG 带元数据块')
  const calls = []
  let definition
  const dispose = registerTools({
    tools: { register(tool) { definition = tool; return () => {} } },
    defineTool: value => value,
    resolveKey: async () => 'k',
    attachments: {
      // 去元数据后宿主直通，落盘仍是 PNG。
      async saveImage(input) { calls.push(['saveImage', input]); return { ...output, mediaType: 'image/png', name: 'stored.png' } },
      async saveFile(input) { calls.push(['saveFile', input]); return { attachment: { attachmentId: output.attachmentId } } },
      async readImage() { throw new Error('本轮无参考图') },
    },
    async fetchImpl() { return Response.json({ data: [{ b64_json: upstream.toString('base64') }] }) },
  })
  try {
    const value = await definition.execute({ prompt: '画个茶杯' }, { signal: new AbortController().signal })
    assert.deepEqual(calls.map(c => c[0]), ['saveImage'], '只存一份，不再 saveFile 留原图')
    const saved = calls[0][1]
    assert.equal(saved.mediaType, 'image/png')
    assert.deepEqual(pngChunkTypes(saved.data), ['IHDR', 'IDAT', 'IEND'], '附加元数据块被去掉，解码必需块保留')
    assert.equal(value.image.mediaType, 'image/png', '工具规定 PNG 就输出 PNG')
    assert.match(value.image.name, /\.png$/)
    assert.equal(value.original, undefined, '没有第二份原图字段')
  } finally { dispose() }
})

test('宿主仍转码时（超尺寸/字节上限）：扩展名跟随宿主类型，依旧单份保存', async () => {
  const calls = []
  let definition
  const dispose = registerTools({
    tools: { register(tool) { definition = tool; return () => {} } },
    defineTool: value => value,
    resolveKey: async () => 'k',
    attachments: {
      async saveImage(input) { calls.push(['saveImage', input.mediaType]); return { ...output, mediaType: 'image/jpeg', name: 'stored.jpg' } },
      async saveFile(input) { calls.push(['saveFile', input.name]); return { attachment: { attachmentId: output.attachmentId } } },
      async readImage() { throw new Error('本轮无参考图') },
    },
    async fetchImpl() { return Response.json({ data: [{ b64_json: PNG.toString('base64') }] }) },
  })
  try {
    const value = await definition.execute({ prompt: '画个茶杯' }, { signal: new AbortController().signal })
    assert.equal(value.image.mediaType, 'image/jpeg', '以宿主返回的真实类型为准')
    assert.match(value.image.name, /\.jpg$/, '扩展名跟随宿主类型，不能 .png 装 JPEG 字节')
    assert.deepEqual(calls.map(c => c[0]), ['saveImage'], '仍然只存一份')
    assert.equal(value.original, undefined)
  } finally { dispose() }
})
