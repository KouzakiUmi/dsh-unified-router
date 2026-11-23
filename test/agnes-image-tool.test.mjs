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
