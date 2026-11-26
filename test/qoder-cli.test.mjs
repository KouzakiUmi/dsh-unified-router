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
  assert.deepEqual(parseQoderCliModels(stdout).map(r => [r.id, r.name]), [
    ['qmodel_38max', 'Qwen3.8-Max'],
    ['qfmodel', 'Qwen3.8-Flash'],
    ['Auto', 'Auto'],
    ['dfmodel', 'DeepSeek-Flash'],
  ])
  // 括号里才是可调用 key：`Auto` 这类只有显示名的行 keyed=false。
  assert.deepEqual(parseQoderCliModels(stdout).map(r => r.keyed), [true, true, false, true])
  // 无后缀：显示名当 id，且标记为「没有 key」（不可调用）。
  const LF = String.fromCharCode(10)
  const plain = parseQoderCliModels(['MODEL', 'Auto', 'Fast'].join(LF))
  assert.deepEqual(plain.map(r => [r.id, r.name, r.keyed]), [['Auto', 'Auto', false], ['Fast', 'Fast', false]])
  // CRLF + 首尾空白。
  const crlf = parseQoderCliModels(['MODEL', '  GLM-5.3 (gmodel)  ', ''].join(String.fromCharCode(13, 10)))
  assert.deepEqual(crlf.map(r => [r.id, r.name, r.keyed]), [['gmodel', 'GLM-5.3', true]])
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
    const catalog = mergeQoderCatalog(parseQoderCliModels(
      ['MODEL', 'Qwen3.8-Flash (qfmodel)', 'New-Model (newmodel)'].join(String.fromCharCode(10))), fallback)
    assert.equal(catalog[0].id, 'qfmodel')
    assert.equal(catalog[0].supportsImage, true)
    assert.equal(catalog[1].id, 'newmodel', '带 key 的新 id 以最小条目并入')
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

test('Qoder 目录只保留带 key 的条目：显示名（无 key）不并入，auto/fast 路由名豁免', async () => {
  const { QODER_CN } = await import('../vendor/channel-pack/src/qoder-product.ts')
  const LF = String.fromCharCode(10)
  // `--list-models` 的 `显示名 (key)` 里 key 才是可调用 id；只回显示名的条目
  // （Qwen4-Max / GLM-5.4 / Step-5-Preview / HungerG）拿名字发请求会回落默认模型
  // 且不产出思考，故一律不并入目录。
  const parsed = parseQoderCliModels(['MODEL', 'Qwen3.8-Max (qmodel_38max)', 'Qwen4-Max', 'GLM-5.4', 'Auto', 'Fast', 'HungerG'].join(LF))
  assert.equal(parsed.find(r => r.id === 'qmodel_38max').keyed, true)
  assert.equal(parsed.find(r => r.id === 'Qwen4-Max').keyed, false)
  assert.equal(parsed.find(r => r.id === 'HungerG').keyed, false, '无括号即无 key')

  const merged = mergeQoderCatalog(parsed, QODER_CN.fallbackModels)
  // 带 key 的保留；`auto`/`fast` 作为路由名保留；其余无 key 条目全部剔除。
  // `Auto`/`Fast` 经策展表归一成本体 id `auto`/`fast`（路由名的真实 key）。
  // 策展表按真实目录重建后没有 `fast` 条目（上游 `chat` 分组无 Fast）。
  assert.deepEqual(merged.map(m => m.id), ['qmodel_38max', 'auto'])
  // 策展表里也不该再有「显示名冒充 id」的条目。
  // 策展表的 id 必须是真实调用 key，不能是显示名。
  for (const name of ['Qwen4-Max', 'GLM-5.4', 'Step-5-Preview']) {
    assert.equal(QODER_CN.fallbackModels.some(m => m.id === name), false, `${name} 是显示名，不应作 id`)
  }
  for (const key of ['qmodel_latest', 'gmodel_latest', 'jmodel']) {
    assert.ok(QODER_CN.fallbackModels.some(m => m.id === key), `${key} 应作为真实 key 在策展表`)
  }
  // 关掉该规则时保持原行为（其它区域不拿 CN 的结论去猜）。
  const unfiltered = mergeQoderCatalog(parsed, QODER_CN.fallbackModels, false)
  // 关掉过滤时：`byName` 会把显示名命中策展表的新条目（Qwen4-Max→qmodel_latest、
  // GLM-5.4→gmodel_latest），这正是旧行为的隐患 —— 名字对上了、key 却是猜的。
  assert.deepEqual(unfiltered.map(m => m.id), ['qmodel_38max', 'qmodel_latest', 'gmodel_latest', 'auto', 'Fast', 'HungerG'])
})

test('Qoder 加密端点 parameters：思考档位带预算，关闭统一发 none（对齐官方 lma）', async () => {
  const { buildQoderInferPayload, reasoningBudgetFor } = await import('../vendor/channel-pack/src/qoder-wasm.ts')
  // 官方 effortFromBudget 的逆：<=1024 low | <=8192 medium | <=24576 high | <=49152 xhigh | else max
  assert.equal(reasoningBudgetFor('low'), 1024)
  assert.equal(reasoningBudgetFor('medium'), 8192)
  assert.equal(reasoningBudgetFor('high'), 24_576)
  assert.equal(reasoningBudgetFor('xhigh'), 49_152)
  assert.equal(reasoningBudgetFor('max'), 65_536)
  assert.equal(reasoningBudgetFor('nonsense'), undefined, '未知档位不发预算，交给上游默认')

  const params = effort => buildQoderInferPayload({ modelKey: 'GLM-5.4', userText: 'hi', reasoningEffort: effort }, 'fixed-id').parameters
  // 选档必须同时给预算 —— 只发 effort/enable_thinking 时上游按「无预算」处理，回包无 reasoning_content。
  assert.deepEqual(params('high'), { reasoning_effort: 'high', reasoning_budget_tokens: 24_576, enable_thinking: true })
  assert.deepEqual(params('max'), { reasoning_effort: 'max', reasoning_budget_tokens: 65_536, enable_thinking: true })
  // DSH 规范名 off 必须翻成上游唯一认识的 none，且不发预算。
  assert.deepEqual(params('off'), { reasoning_effort: 'none', enable_thinking: false })
  assert.deepEqual(params('none'), { reasoning_effort: 'none', enable_thinking: false })
  // 没有档位时一个思考键都不发（官方 lma 的同一判据）。
  assert.deepEqual(params(undefined), {})
})

test('Qoder 上下文档位按渠道声明为 200K/400K/1M，不改全局默认表', async () => {
  const { qodercn } = await import('../src/client/providers/qodercn.js')
  // 上游目录的 `context_config` 实测就是这三档；与全局默认表（256K/500K）不同，
  // 所以按渠道声明，避免某个渠道的口径改写所有渠道。
  assert.deepEqual(qodercn.caps.contextTiers.map(t => [t.label, t.tokens]), [
    ['200K', 200_000], ['400K', 400_000], ['1M', 1_000_000],
  ])
})

test('Qoder 目录解析对齐客户端：取 assistant 组、窗口取 context_config 默认档、URL 带 Encode=1', async () => {
  const { QODER_MODEL_LIST_PATH, parseQoderModelList } = await import('../vendor/channel-pack/src/qoder-model-list.ts')
  assert.match(QODER_MODEL_LIST_PATH, /Encode=1$/, '与官方用法一致')
  // 客户端按 assistant → developer → chat 取第一个非空组。
  const models = parseQoderModelList({
    chat: [{ key: 'from_chat', display_name: 'X' }],
    assistant: [{ key: 'gmodel_latest', display_name: 'GLM-5.4', price_factor: 0.8, max_input_tokens: 180_000,
      context_config: { '1M': { token_count: 1_000_000 }, '200K': { token_count: 200_000, is_default: true }, '400K': { token_count: 400_000 } } }],
    developer: [{ key: 'from_developer', display_name: 'Y' }],
  })
  assert.deepEqual(models.map(m => m.id), ['gmodel_latest'], 'assistant 优先')
  // 窗口取默认档 200K，而不是 max_input_tokens 的 180K（含输出预留）。
  assert.equal(models[0].contextWindow, 200_000)
  assert.equal(models[0].priceFactor, 0.8)
  // 一组都没有 → null（调用方据此回退，不猜）。
  assert.equal(parseQoderModelList({ chat: [], assistant: [], developer: [] }), null)
})
