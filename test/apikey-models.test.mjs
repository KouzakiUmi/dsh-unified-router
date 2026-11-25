import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APIKEY_MODEL_WRITES, createApiKeyModelSettings } from '../lib/apikey-models.js'

// API Key 渠道模型设置存储：目录行形状见 docs/APIKEY-CHANNELS.md §2
// （id/name/context/output/attachment/efforts/defaultEffort）。测试全程离线，
// 临时目录在用例结束时清理。

const provider = 'agnes'
const row = (id, extra = {}) => ({
  id,
  name: `模型 ${id}`,
  context: 524_288,
  output: 65_536,
  attachment: true,
  reasoning: true,
  efforts: ['off', 'low', 'medium', 'high'],
  defaultEffort: 'off',
  ...extra,
})
const catalog = () => [
  row('agnes-3.0-flash'),
  row('agnes-3.0-pro', { context: 1_048_576 }),
  row('agnes-3.0-lite', { context: 0, output: 0, attachment: false, reasoning: false, efforts: [], defaultEffort: undefined }),
]

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'apikey-models-'))
  return {
    dir,
    file: join(dir, 'model-settings.json'),
    create(file, id = provider) { return createApiKeyModelSettings(file ?? join(dir, 'model-settings.json'), id) },
    async saved(file) { return await readFile(file ?? join(dir, 'model-settings.json'), 'utf8').then(JSON.parse).catch(() => null) },
    async cleanup() { await rm(dir, { recursive: true, force: true }) },
  }
}
const getter = rows => () => rows

test('APIKEY_MODEL_WRITES 导出三个写方法名', () => {
  assert.deepEqual(APIKEY_MODEL_WRITES, ['apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels'])
})

test('list 推导默认值：开关全开、能力默认值与 reasoning 标记', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const models = await settings.list(catalog())
    assert.deepEqual(models.map(model => model.id), ['agnes-3.0-flash', 'agnes-3.0-pro', 'agnes-3.0-lite'])
    assert.ok(models.every(model => model.enabled === true), '空白偏好下全部启用')
    const flash = models[0]
    assert.equal(flash.contextWindow, 524_288)
    assert.equal(flash.maxOutputLength, 65_536)
    assert.equal(flash.vision, true)
    // 上游声明的默认档是 `off`（Agnes 实测默认不思考），但默认档策略把
    // 「关闭/低档」提到该模型支持的中档：默认不得落在 off/low/minimal。
    assert.equal(flash.effectiveEffort, 'medium')
    assert.equal(flash.defaultEffort, 'medium')
    assert.equal(flash.reasoning, true)
    assert.deepEqual(flash.params, {})
    // context/output 为 0 的行：上下文回退 128K、输出回退 32K，无思考档位
    const lite = models[2]
    assert.equal(lite.defaultContextWindow, 128_000)
    assert.equal(lite.defaultMaxOutputLength, 32_768)
    assert.equal(lite.contextWindow, 128_000)
    assert.equal(lite.maxOutputLength, 32_768)
    assert.equal(lite.vision, false)
    assert.equal(lite.reasoning, false)
    assert.equal(lite.effectiveEffort, undefined)
  } finally { await f.cleanup() }
})

test('setModelEnabled 开关落盘，新实例能读回', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    await settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter(catalog()))
    assert.deepEqual(await f.saved(), { disabled: { 'agnes-3.0-flash': true }, params: {} })
    const restored = f.create()
    const models = await restored.list(catalog())
    assert.equal(models.find(model => model.id === 'agnes-3.0-flash').enabled, false)
    assert.equal(models.find(model => model.id === 'agnes-3.0-pro').enabled, true)
    await restored.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: true }, getter(catalog()))
    assert.equal((await f.create().list(catalog()))[0].enabled, true)
    await assert.rejects(
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-pro', enabled: 'yes' }, getter(catalog())),
      /模型开关无效/,
    )
  } finally { await f.cleanup() }
})

test('setModelParams 合法参数落盘并生效', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const patch = { maxTokens: 32_000, contextWindow: 100_000, supportsImage: false, reasoningEffort: 'medium' }
    const models = await settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params: patch }, getter(catalog()))
    const flash = models.find(model => model.id === 'agnes-3.0-flash')
    assert.equal(flash.maxOutputLength, 32_000)
    assert.equal(flash.contextWindow, 100_000)
    assert.equal(flash.vision, false)
    assert.equal(flash.effectiveEffort, 'medium')
    assert.deepEqual(flash.params, patch)
    const saved = await f.saved()
    assert.deepEqual(saved.params['agnes-3.0-flash'], patch)
    // 新实例读回同样生效
    const restored = await f.create().list(catalog())
    assert.equal(restored[0].maxOutputLength, 32_000)
    assert.equal(restored[0].effectiveEffort, 'medium')
  } finally { await f.cleanup() }
})

test('setModelParams 拒绝未知档位、compat 与非法数值', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const rows = catalog()
    for (const params of [
      { reasoningEffort: 'xhigh' },          // 档位不在该行 efforts 里
      { reasoningEffort: 'banana' },         // 非法档位值
      { compat: { supportsStore: false } },  // compat 字段禁止
      { compat: null },                      // compat 置空也禁止
      { maxTokens: -1 }, { maxTokens: 1.5 }, { maxTokens: 'abc' }, { maxTokens: 10_000_001 },
      { contextWindow: 0 }, { supportsImage: 'yes' },
      {}, null, 'maxTokens=1',
    ]) {
      await assert.rejects(
        settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params }, getter(rows)),
        /模型参数无效/,
        `params=${JSON.stringify(params)}`,
      )
    }
    // 无思考档位的模型连合法档位也拒绝
    await assert.rejects(
      settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-lite', params: { reasoningEffort: 'low' } }, getter(rows)),
      /模型参数无效/,
    )
    assert.equal(await f.saved(), null, '非法写入不得产生落盘文件')
  } finally { await f.cleanup() }
})

test('resetModels 清空 disabled，参数保留', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const rows = catalog()
    await settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter(rows))
    await settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-pro', enabled: false }, getter(rows))
    await settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params: { maxTokens: 1234 } }, getter(rows))
    const models = await settings.change('apikey.resetModels', {}, getter(rows))
    assert.ok(models.every(model => model.enabled === true))
    const saved = await f.saved()
    assert.deepEqual(saved.disabled, {})
    assert.deepEqual(saved.params['agnes-3.0-flash'], { maxTokens: 1234 })
  } finally { await f.cleanup() }
})

test('modelId 不在目录里抛「模型已变动，请刷新」', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const rows = catalog()
    await assert.rejects(
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-9.9-ghost', enabled: false }, getter(rows)),
      /模型已变动，请刷新/,
    )
    await assert.rejects(
      settings.change('apikey.setModelParams', { modelId: 'agnes-9.9-ghost', params: { maxTokens: 1 } }, getter(rows)),
      /模型已变动，请刷新/,
    )
    assert.equal(await f.saved(), null, '未知 modelId 不得产生落盘文件')
  } finally { await f.cleanup() }
})

test('目录为空时三个写方法都抛「请先刷新模型目录」', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    await assert.rejects(
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter([])),
      /请先刷新模型目录/,
    )
    await assert.rejects(
      settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params: { maxTokens: 1 } }, getter([])),
      /请先刷新模型目录/,
    )
    await assert.rejects(settings.change('apikey.resetModels', {}, getter([])), /请先刷新模型目录/)
  } finally { await f.cleanup() }
})

test('损坏的落盘文件按空偏好处理', async () => {
  const f = await fixture()
  try {
    await writeFile(f.file, 'not json {{{')
    const settings = f.create()
    const models = await settings.list(catalog())
    assert.ok(models.every(model => model.enabled === true))
    assert.deepEqual(models[0].params, {})
    // 结构损坏但 JSON 合法的内容同样只取合法字段
    await writeFile(f.file, JSON.stringify({ disabled: { 'agnes-3.0-flash': 'yes', 'agnes-3.0-pro': true }, params: { 'agnes-3.0-flash': { maxTokens: 'bad' } } }))
    const second = f.create()
    const restored = await second.list(catalog())
    assert.equal(restored[0].enabled, true, '非布尔 disabled 项被丢弃')
    assert.equal(restored[1].enabled, false, '布尔 disabled 项保留')
    assert.deepEqual(restored[0].params, {}, '非法 params 被丢弃')
  } finally { await f.cleanup() }
})

test('并发写入串行化，最终状态一致', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const rows = catalog()
    await Promise.all([
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter(rows)),
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-pro', enabled: false }, getter(rows)),
      settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params: { maxTokens: 1111 } }, getter(rows)),
      settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-pro', params: { maxTokens: 2222 } }, getter(rows)),
    ])
    const saved = await f.saved()
    assert.deepEqual(saved.disabled, { 'agnes-3.0-flash': true, 'agnes-3.0-pro': true })
    assert.deepEqual(saved.params, { 'agnes-3.0-flash': { maxTokens: 1111 }, 'agnes-3.0-pro': { maxTokens: 2222 } })
    const restored = await f.create().list(rows)
    assert.deepEqual(restored.map(model => [model.id, model.enabled, model.maxOutputLength]), [
      ['agnes-3.0-flash', false, 1111],
      ['agnes-3.0-pro', false, 2222],
      ['agnes-3.0-lite', true, 32_768],
    ])
  } finally { await f.cleanup() }
})

test('推荐排除按 providerId 计算，不同渠道互不串', async () => {
  const f = await fixture()
  try {
    // deepseek-v4-flash-1017 在 agnes / workbuddy 都按独立旧代处理 → 默认排除；
    // 同代的 deepseek-v4-1-flash-1017 在两个渠道都默认启用。
    // 排除规则按 providerId 各自计算，两个渠道的结果互不影响。
    const rows = [
      row('deepseek-v4-flash-1017', { efforts: [] }),
      row('deepseek-v4-1-flash-1017', { efforts: [] }),
    ]
    const agnes = await f.create(join(f.dir, 'agnes.json'), 'agnes').list(rows)
    const workbuddy = await f.create(join(f.dir, 'workbuddy.json'), 'workbuddy').list(rows)
    assert.equal(agnes.find(model => model.id === 'deepseek-v4-flash-1017').enabled, false)
    assert.equal(workbuddy.find(model => model.id === 'deepseek-v4-flash-1017').enabled, false)
    assert.ok([agnes, workbuddy].every(models => models.find(model => model.id === 'deepseek-v4-1-flash-1017').enabled === true))
  } finally { await f.cleanup() }
})

test('文件路径为空时 list 可用、写入抛「模型设置存储不可用」', async () => {
  const settings = createApiKeyModelSettings(undefined, provider)
  const rows = catalog()
  const models = await settings.list(rows)
  assert.ok(models.every(model => model.enabled === true))
  await assert.rejects(
    settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter(rows)),
    /模型设置存储不可用/,
  )
  await assert.rejects(
    settings.change('apikey.setModelParams', { modelId: 'agnes-3.0-flash', params: { maxTokens: 1 } }, getter(rows)),
    /模型设置存储不可用/,
  )
  await assert.rejects(settings.change('apikey.resetModels', {}, getter(rows)), /模型设置存储不可用/)
})

test('取消信号在队列任务执行前生效', async () => {
  const f = await fixture()
  try {
    const settings = f.create()
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(
      settings.change('apikey.setModelEnabled', { modelId: 'agnes-3.0-flash', enabled: false }, getter(catalog()), abort.signal),
      error => error.name === 'AbortError',
    )
  } finally { await f.cleanup() }
})
