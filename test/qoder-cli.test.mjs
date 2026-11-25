/**
 * Qoder CN 官方 CLI 目录拉取（P0）。
 *
 * 被测契约：插件不重实现 WASM 签名，而是 spawn 本机官方 CLI `--list-models`，
 * 解析纯文本表（`显示名 (key)`，key 才是目录 id），id 以 CLI 为准、能力/倍率
 * 属性与产品策展表合并；任一失败回落兜底 `source:'fallback'`。
 *
 * 这里只测**纯逻辑**（parse / merge / refreshQoderCatalog 注入 mock runCli），
 * 绝不真跑 CLI。适配器的 cliCatalog 接线（`this.cliCatalog ?? fallbackModels`）
 * 由构建 + 既有 model-rate-badge 集成用例（qoder listModels 不回归）覆盖；
 * 真实 CLI 拉取需用户先 `qoderclicn login`，属实机未覆盖项。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQoderCliModels, mergeQoderCatalog, refreshQoderCatalog, readQoderCatalog, saveQoderCatalog } from '../vendor/channel-pack/src/qoder-cli.ts'
import { readableModelName } from '../lib/model-catalog.js'

const ok = stdout => ({ stdout, stderr: '', code: 0 })

test('parseQoderCliModels：key 后缀才是 id，跳过表头/警告/未登录行，去重', () => {
  const stdout = [
    'MODEL',
    'Qwen3.8-Max (qmodel_38max)',
    'Qwen3.8-Flash (qfmodel)',
    'Auto',
    'DeepSeek-Flash (dfmodel)',
    'Qwen3.8-Max (qmodel_38max)', // 重复 id
    '',
    'Warning: no models available for your account.',
  ].join('\n')
  assert.deepEqual(parseQoderCliModels(stdout), [
    { id: 'qmodel_38max', name: 'Qwen3.8-Max' },
    { id: 'qfmodel', name: 'Qwen3.8-Flash' },
    { id: 'Auto', name: 'Auto' },
    { id: 'dfmodel', name: 'DeepSeek-Flash' },
  ])
  // 无后缀：显示名当 id。
  assert.deepEqual(parseQoderCliModels('MODEL\nAuto\nFast'), [{ id: 'Auto', name: 'Auto' }, { id: 'Fast', name: 'Fast' }])
  // CRLF + 首尾空白。
  assert.deepEqual(parseQoderCliModels('MODEL\r\n  GLM-5.3 (gmodel)  \r\n'), [{ id: 'gmodel', name: 'GLM-5.3' }])
  // 未登录 / 空 / 纯警告 → 0 条。
  assert.deepEqual(parseQoderCliModels('Not logged in. Run `qoderclicn login` to authenticate.'), [])
  assert.deepEqual(parseQoderCliModels(''), [])
  assert.deepEqual(parseQoderCliModels('MODEL\nWarning: no models available for your account.'), [])
})

const fallback = [
  { id: 'qfmodel', name: 'Qwen3.8-Flash', contextWindow: 1_000_000, priceFactor: 0, supportsImage: true },
  { id: 'gmodel', name: 'GLM-5.3', contextWindow: 1_000_000, priceFactor: 0.8, efforts: ['low', 'high'] },
  { id: 'old-model', name: 'Old', contextWindow: 200_000, priceFactor: 1 },
]

test('mergeQoderCatalog：id 以 CLI 为准、属性取策展表、新 id 最小不编造、下架不并入', () => {
  const cli = [
    { id: 'qfmodel', name: 'Qwen3.8-Flash' },
    { id: 'gmodel', name: 'GLM-5.3' },
    { id: 'brand-new', name: 'Brand New' },
  ]
  const merged = mergeQoderCatalog(cli, fallback)
  assert.deepEqual(merged.map(m => m.id), ['qfmodel', 'gmodel', 'brand-new'])
  // 命中策展表：保留全部能力/倍率属性。
  assert.equal(merged[0].priceFactor, 0)
  assert.equal(merged[0].contextWindow, 1_000_000)
  assert.deepEqual(merged[1].efforts, ['low', 'high'])
  // 新 id：最小条目，contextWindow=0 哨兵（不编造假窗口），无 priceFactor/efforts。
  assert.equal(merged[2].contextWindow, 0)
  assert.equal(merged[2].priceFactor, undefined)
  assert.equal(merged[2].efforts, undefined)
  // 策展表有、CLI 无（old-model）→ 不并入。
  assert.equal(merged.some(m => m.id === 'old-model'), false)
  // CLI 重复 id 去重。
  assert.deepEqual(mergeQoderCatalog([{ id: 'qfmodel', name: 'A' }, { id: 'qfmodel', name: 'B' }], fallback).map(m => m.id), ['qfmodel'])
})

test('refreshQoderCatalog：成功→remote+合并目录；未登录/非0/空/抛错→fallback', async () => {
  // 成功：CLI 给 id，合并策展属性。
  const good = await refreshQoderCatalog(async () => ok('MODEL\nQwen3.8-Flash (qfmodel)\nNew (new-id)'), fallback)
  assert.equal(good.source, 'remote')
  assert.equal(good.count, 2)
  assert.deepEqual(good.catalog.map(m => m.id), ['qfmodel', 'new-id'])
  assert.equal(good.catalog[0].priceFactor, 0)

  // 未登录（exit 1 + 文案）→ fallback，catalog=null。
  const notLogged = await refreshQoderCatalog(async () => ({ stdout: '', stderr: 'Not logged in. Run `qoderclicn login` to authenticate.', code: 1 }), fallback)
  assert.equal(notLogged.source, 'fallback')
  assert.equal(notLogged.catalog, null)
  assert.equal(notLogged.count, fallback.length)
  assert.equal(notLogged.issue, 'login-required')
  assert.equal((await refreshQoderCatalog(async () => ({ ...ok(''), code: 1, spawnError: 'timeout' }), fallback)).issue, 'timeout')

  // exit 0 但输出含未登录文案（保险）→ fallback。
  const textNotLogged = await refreshQoderCatalog(async () => ok('Not logged in. Run `qoderclicn login` to authenticate.'), fallback)
  assert.equal(textNotLogged.source, 'fallback')

  // 空表 / 解析 0 条 → fallback（不把解析 bug 当目录为空）。
  const empty = await refreshQoderCatalog(async () => ok('MODEL\n'), fallback)
  assert.equal(empty.source, 'fallback')
  assert.equal(empty.catalog, null)

  // spawn 抛错 → fallback，不抛到调用方。
  const threw = await refreshQoderCatalog(async () => { throw new Error('ENOENT') }, fallback)
  assert.equal(threw.source, 'fallback')
  assert.equal(threw.count, fallback.length)
})

test('Qoder 文本目录保留已知调用 ID 和模型能力，成功目录可跨进程读取', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qoder-cli-catalog-'))
  try {
    const file = join(dir, 'catalog.json')
    const catalog = mergeQoderCatalog(parseQoderCliModels('MODEL\nQwen3.8-Flash\nNew-Model'), fallback)
    assert.equal(catalog[0].id, 'qfmodel')
    assert.equal(catalog[0].supportsImage, true)
    assert.equal(catalog[1].supportsImage, undefined)
    await saveQoderCatalog(file, catalog)
    assert.deepEqual(readQoderCatalog(file, fallback), catalog)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('机械可读化保留版本小数和原模型标识', () => {
  for (const id of ['qwen-3.8-flash', 'qwen-3-8-flash', 'qwen3.8-flash']) {
    assert.equal(readableModelName(id), 'Qwen 3.8 Flash')
  }
  assert.equal(readableModelName('sn-glm-5-3-flash-p', 'GLM-5.3-Flash'), 'GLM 5.3 Flash')
  assert.equal(readableModelName('model-id', '正式模型 中文版'), '正式模型 中文版')
  assert.equal(readableModelName('opaque-model-id', 'Seed-Evolving'), 'Seed Evolving')
  assert.equal(readableModelName('provider-736', 'vendor/qwen3-8-flash 免费'), 'Qwen 3.8 Flash 免费')
  assert.equal(readableModelName('hy4flash', 'Hy4-flash (hy4flash)'), 'Hy4 Flash')
  assert.equal(readableModelName('sn-qwen4-max-p', 'sn-qwen4-max-p'), 'Qwen 4 Max')
})

test('Qoder CN 策展表为 GLM-5.4 提供 1M/128K、视觉与三档思考能力，不编造倍率', async () => {
  const { QODER_CN } = await import('../vendor/channel-pack/src/qoder-product.ts')
  const merged = mergeQoderCatalog(parseQoderCliModels('MODEL\nGLM-5.4'), QODER_CN.fallbackModels)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 'GLM-5.4')
  assert.equal(merged[0].contextWindow, 1_000_000)
  assert.equal(merged[0].maxTokens, 131_072)
  assert.equal(merged[0].supportsImage, true)
  assert.deepEqual(merged[0].efforts, ['low', 'high', 'max'])
  assert.equal(merged[0].defaultEffort, 'high')
  assert.equal(merged[0].priceFactor, undefined, '未实测倍率不编造')
})
