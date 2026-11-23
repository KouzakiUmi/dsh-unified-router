/**
 * Raccoon 逐模型思考档位（上游 `params.raccoon_thinking`，2026-11 上线）。
 *
 * ## 被测契约
 *
 * 1. **解析**：只认 `managed === true`、`supported !== false`；`display_levels`
 *    只采纳 `level_1`…`level_5`（去重、按强度重排）；`can_disable` 为真才多一个 `off`。
 * 2. **默认档**：上游 `default_level` 是有效中/高档（`level_3` 及以上）时照抄；
 *    是 `off` / 缺失 / 低档时取该模型支持的中档或更强档（`defaultModelEffort`
 *    的统一策略）。既不落到「关思考」（关思考会让这类模型把规划写进正文，
 *    即用户报的「CoT 泄漏到 assistant」），也不落到最低档。
 * 3. **请求字段**：有托管档位 → **顶层** `raccoon_thinking_level`（实测放进
 *    `extra_body` 会 400 invalid），且**不发** `extra_body`；没有托管档位的模型
 *    继续用旧方言 `extra_body.thinking.type`。两套方言互斥。
 *
 * 2026-11-18 实测三层对照（`sn-qwen4-max-p`，pro 目录生效倍率 0，不产生扣费）：
 * 不发音思参数 → `reasoning_tokens=0`、无 `reasoning_content`；
 * 顶层 `raccoon_thinking_level:"level_3"` → `reasoning_content` 独立成通道；
 * `extra_body:{"raccoon_thinking_level":…}` → `HTTP 400 param … invalid`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 让单测能直接 import `vendor/channel-pack/src/*.ts`。
 *
 * TS 源码按 TS 惯例写 `import … from './x.js'`（编译后才是 .js），Node 直接跑
 * .ts 时解析不到；这里把 channel-pack 源码目录内的 `./*.js` 映射到同名 `.ts`。
 * 其余 `@deepseek-ai/*` 仍指向测试内核桩 `test/kernel.mjs`。
 */
function installSourceHooks() {
  const kernel = new URL('./kernel.mjs', import.meta.url).href
  return registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@deepseek-ai/')) return { url: kernel, shortCircuit: true }
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL !== undefined) {
        const parent = fileURLToPath(context.parentURL)
        if (parent.includes(`${path.sep}channel-pack${path.sep}src${path.sep}`)) {
          const candidate = path.resolve(path.dirname(parent), specifier.replace(/\.js$/u, '.ts'))
          if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }
      return next(specifier, context)
    },
  })
}

// 纯函数 import 前就必须装好钩子（ESM 静态 import 先于下方代码执行，故这里用
// 动态 import 取源码）。
const hooks = installSourceHooks()
// 纯函数直接取源码（Node 的类型剥离），不必经过构建产物。
const {
  parseRaccoonThinking,
  raccoonThinkingEfforts,
  raccoonThinkingEffortName,
} = await import('../vendor/channel-pack/src/raccoon-product.ts')

test('parseRaccoonThinking：只认 managed 目录，档位去重按强度重排，off 取决于 can_disable', () => {
  // 非托管 / 不支持 / 形状不对：一律 undefined（适配器回退旧方言两态）。
  assert.equal(parseRaccoonThinking(undefined), undefined)
  assert.equal(parseRaccoonThinking(null), undefined)
  assert.equal(parseRaccoonThinking('level_3'), undefined)
  assert.equal(parseRaccoonThinking({}), undefined)
  assert.equal(parseRaccoonThinking({ managed: false, display_levels: [{ value: 'level_3' }] }), undefined)
  assert.equal(parseRaccoonThinking({ managed: true, supported: false }), undefined)
  // managed 但没有可选档位、又不允许关闭 → 没有任何可选项，不编造。
  assert.equal(parseRaccoonThinking({ managed: true, can_disable: false }), undefined)

  // 五档 + 不允许关闭：没有 `off`。上游 `default_level: level_1`（最低档）
  // 不算「有效默认」→ 按默认档策略提到该模型支持的中档 `level_3`。
  assert.deepEqual(
    parseRaccoonThinking({
      managed: true,
      can_disable: false,
      display_levels: ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'].map(value => ({ value })),
      default_level: 'level_1',
    }),
    { levels: ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'], defaultLevel: 'level_3' },
  )

  // 允许关闭 → `off` 置首；未知 value 丢弃；重复去重；乱序按强度重排。
  assert.deepEqual(
    parseRaccoonThinking({
      managed: true,
      can_disable: true,
      display_levels: [
        { value: 'level_5' }, { value: 'level_1' }, { value: 'level_5' },
        { value: 'level_9' }, { value: '  level_3  ' }, { label: 'no-value' },
      ],
      default_level: 'level_3',
    }),
    { levels: ['off', 'level_1', 'level_3', 'level_5'], defaultLevel: 'level_3' },
  )

  // 上游默认 off → 不取「关思考」（否则正文 CoT 泄漏），也不取最低档，
  // 而取该模型支持的中档（`defaultModelEffort` 的默认档策略）。
  assert.deepEqual(
    parseRaccoonThinking({
      managed: true,
      can_disable: true,
      display_levels: [{ value: 'level_1' }, { value: 'level_3' }, { value: 'level_5' }],
      default_level: 'off',
    }),
    { levels: ['off', 'level_1', 'level_3', 'level_5'], defaultLevel: 'level_3' },
  )
  // 默认档缺失 → 取该模型支持的较强档（level_4 = high；没有 level_3 时不上编）。
  assert.deepEqual(
    parseRaccoonThinking({ managed: true, display_levels: [{ value: 'level_2' }, { value: 'level_4' }] }),
    { levels: ['level_2', 'level_4'], defaultLevel: 'level_4' },
  )
  // 只允许关闭、没有任何档位：只剩 `off`（不编造档位）。
  assert.deepEqual(
    parseRaccoonThinking({ managed: true, can_disable: true, default_level: 'off' }),
    { levels: ['off'], defaultLevel: 'off' },
  )
})

test('raccoonThinkingEfforts / raccoonThinkingEffortName：逐模型档位与展示名', () => {
  // 没有托管档位 → 旧方言两态（开 / 关）。
  assert.deepEqual(raccoonThinkingEfforts(undefined), { efforts: ['on', 'off'], defaultEffort: 'on' })

  const managed = { levels: ['off', 'level_1', 'level_3', 'level_5'], defaultLevel: 'level_1' }
  assert.deepEqual(raccoonThinkingEfforts(managed), { efforts: ['off', 'level_1', 'level_3', 'level_5'], defaultEffort: 'level_1' })

  // 展示名两套方言都认（`ui.js` 的 EFFORT_LABELS 与这里保持一致）。
  assert.equal(raccoonThinkingEffortName('level_1'), '极少')
  assert.equal(raccoonThinkingEffortName('level_5'), '最大')
  assert.equal(raccoonThinkingEffortName('off'), '关闭')
  assert.equal(raccoonThinkingEffortName('on'), '开启')
  assert.equal(raccoonThinkingEffortName('unknown-level'), 'unknown-level')
})

test('托管档位模型只发顶层 raccoon_thinking_level，旧模型只发 extra_body.thinking', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const originalHome = process.env.DSH_HOME
  const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR
  const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch
  process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch

  const catalog = {
    code: 0,
    data: { categories: [{ type: 'chat', models: [
      {
        name: 'sn-managed',
        visible: true,
        params: {
          context_window: 1_000_000,
          max_tokens: 100_000,
          raccoon_thinking: {
            managed: true,
            supported: true,
            can_disable: true,
            display_levels: [
              { value: 'level_1', label: 'Minimal' },
              { value: 'level_3', label: 'Medium' },
              { value: 'level_5', label: 'Max' },
            ],
            default_level: 'off',
          },
        },
        tags: [],
      },
      // 老模型：目录没有 `raccoon_thinking` → 走旧方言。
      { name: 'sn-legacy', visible: true, params: { context_window: 1_000_000, max_tokens: 100_000 }, tags: [] },
      // 托管但**不允许关闭**（`can_disable: false`）：档位表里没有 `off`，
      // 手改配置残留 off 时也不能把 off 发出去（上游会钳掉，行为会变）。
      {
        name: 'sn-locked',
        visible: true,
        params: {
          context_window: 1_000_000,
          max_tokens: 100_000,
          raccoon_thinking: {
            managed: true,
            supported: true,
            can_disable: false,
            display_levels: [{ value: 'level_1' }, { value: 'level_3' }, { value: 'level_5' }],
            default_level: 'level_1',
          },
        },
        tags: [],
      },
    ] }] },
  }

  const chatBodies = []
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('model_catalog')) {
      return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    chatBodies.push(JSON.parse(init.body))
    // 最小合法 SSE：一个正文增量 + 结束标记。
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  }

  const cleanup = []
  const adapters = new Map()
  const credentials = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: {
      resolve: async ref => credentials.get(ref),
      describe: async () => undefined,
      set: async (ref, value) => { credentials.set(ref, { value }) },
      unset: async ref => credentials.delete(ref),
    },
    llm: {
      registerAdapter(ids, adapter) { for (const id of ids) adapters.set(id, adapter) },
      listProviders: () => [...adapters.keys()].map(id => ({ id })),
      listModels: async id => adapters.get(id).listModels(id),
    },
    connection: { fetch: { register() { throw new Error('native-only must not mount HTTP RPC') } } },
  }
  const ctx = {
    ...services,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get: key => services[key],
    provide(key, value) { this[key] = services[key] = value },
    effect(fn) { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
    inject(deps, fn) { if (deps.every(d => services[d])) fn(this) },
    emit() {},
  }

  try {
    let rpc
    const { mountBackend } = await import('../lib/backend.js')
    const pool = mountBackend(ctx, call => { rpc = call })
    credentials.set('REF_TEST', { value: JSON.stringify({ access_token: 'token-test' }) })
    await pool.addAccount({
      id: 'raccoon-account', provider: 'raccoon', nickname: '测试账号', credentialRef: 'REF_TEST',
      enabled: true, refreshable: false, createdAt: 1, plan: 'free',
    })
    assert.equal((await rpc('model.refresh', { provider: 'raccoon' })).value.source, 'remote')

    const adapter = adapters.get('raccoon')

    // ---- 目录默认值：逐模型档位 + 默认档 ----
    const listed = Object.fromEntries(adapter.listAllModels().map(model => [model.id, model]))
    // 对外暴露的是 DSH 规范档位名（level_1→minimal、level_3→medium、level_5→xhigh）：
    // 宿主聚合会丢弃不认识的 id，用 level_N 会让整个档位菜单消失；wire 值在出站时翻译回去。
    assert.deepEqual(listed['sn-managed'].efforts, ['off', 'minimal', 'medium', 'xhigh'])
    // 上游 default_level=off → 默认档取该模型支持的中档（level_3 → medium）：
    // 既不落到「关思考」，也不落到最低档 minimal。
    assert.equal(listed['sn-managed'].defaultEffort, 'medium')
    assert.deepEqual(listed['sn-legacy'].efforts, ['high', 'off'])
    assert.equal(listed['sn-legacy'].defaultEffort, 'high')

    // `resolveModel` 播报同一份档位（DSH 按它渲染选择器并校验档位合法）。
    const resolvedManaged = await adapter.resolveModel('raccoon', 'sn-managed')
    assert.deepEqual(resolvedManaged.reasoning.efforts.map(effort => effort.id), ['off', 'minimal', 'medium', 'xhigh'])
    assert.deepEqual(resolvedManaged.reasoning.efforts.map(effort => effort.name), ['关闭', '极少', '中', '最大'])
    assert.equal(resolvedManaged.reasoning.defaultEffort, 'medium')

    /** 跑一次 stream 并取实际发出的请求体。 */
    const bodyFor = async (model, reasoningEffort) => {
      chatBodies.length = 0
      for await (const _chunk of adapter.stream({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      })) { /* 只为触发一次请求 */ }
      assert.equal(chatBodies.length, 1)
      return chatBodies[0]
    }

    // ---- 托管模型：顶层字段，且不带 extra_body ----
    // 界面传规范名 medium → 出站翻译回上游 level_3
    const managedLevel3 = await bodyFor('sn-managed', 'medium')
    assert.equal(managedLevel3.raccoon_thinking_level, 'level_3')
    // 旧调用方直接传私有名也照旧可用
    const managedRaw = await bodyFor('sn-managed', 'level_3')
    assert.equal(managedRaw.raccoon_thinking_level, 'level_3')
    assert.equal('extra_body' in managedLevel3, false, '托管路径不得再发 extra_body.thinking（两套方言互斥）')

    const managedOff = await bodyFor('sn-managed', 'off')
    assert.equal(managedOff.raccoon_thinking_level, 'off')

    // 没传档位时也要发：托管模型的上游默认可能是 off（关思考 → 正文出现规划）。
    const managedDefault = await bodyFor('sn-managed', undefined)
    assert.equal(managedDefault.raccoon_thinking_level, 'level_3')

    // 宿主用 prepareCall 的元数据补齐输出上限与思考默认档，然后交给绑定的请求。
    const saved = await rpc('model.setParams', { provider: 'raccoon', modelId: 'sn-managed',
      params: { maxTokens: 7_500, reasoningEffort: 'xhigh' } })
    assert.equal(saved.ok, true)
    const prepared = await adapter.prepareCall('raccoon', 'sn-managed')
    assert.equal(prepared.model.defaultMaxTokens, 7_500)
    assert.equal(prepared.model.reasoning.defaultEffort, 'xhigh')
    chatBodies.length = 0
    for await (const _chunk of prepared.stream({ provider: 'raccoon', model: 'sn-managed',
      maxTokens: prepared.model.defaultMaxTokens, reasoningEffort: prepared.model.reasoning.defaultEffort,
      messages: [{ role: 'user', content: 'hi' }] })) { /* 捕获请求体 */ }
    assert.equal(chatBodies[0].max_tokens, 7_500)
    assert.equal(chatBodies[0].raccoon_thinking_level, 'level_5')

    // ---- 老模型：旧方言，绝不发托管字段 ----
    const legacyOff = await bodyFor('sn-legacy', 'off')
    assert.deepEqual(legacyOff.extra_body, { thinking: { type: 'disabled' } })
    assert.equal('raccoon_thinking_level' in legacyOff, false)

    const legacyOn = await bodyFor('sn-legacy', 'high')
    assert.deepEqual(legacyOn.extra_body, { thinking: { type: 'enabled' } })
    assert.equal('raccoon_thinking_level' in legacyOn, false)

    // ---- 容错：档位表里没有 off / 档位不认识 → 退回该模型默认档 ----
    const lockedDefault = await adapter.resolveModel('raccoon', 'sn-locked')
    assert.deepEqual(lockedDefault.reasoning.efforts.map(effort => effort.id), ['minimal', 'medium', 'xhigh'])
    const lockedOff = await bodyFor('sn-locked', 'off')
    assert.equal(lockedOff.raccoon_thinking_level, 'level_3')
    // 真不认识的档位（"ultra" 不在该模型档位表里）→ 退回默认档
    const managedUnknownEffort = await bodyFor('sn-managed', 'ultra')
    assert.equal(managedUnknownEffort.raccoon_thinking_level, 'level_3')
  } finally {
    for (const stop of cleanup.reverse()) await stop()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR
    else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
    hooks.deregister()
  }
})

test('档位名双向翻译：私有 id → DSH 规范名，出站再翻译回私有值', async () => {
  const { canonicalEffortId, privateEffortFor } = await import('../vendor/channel-pack/src/reasoning-ladder.ts')
  // 宿主只认这 8 个规范名，私有 id 会被整条丢弃（选择器里就没有档位了）。
  assert.equal(canonicalEffortId('light'), 'low')
  assert.equal(canonicalEffortId('extra_high'), 'xhigh')
  assert.equal(canonicalEffortId('none'), 'off')
  assert.equal(canonicalEffortId('on'), 'high')
  assert.equal(canonicalEffortId('level_1'), 'minimal')
  assert.equal(canonicalEffortId('level_5'), 'xhigh')
  // 已是规范名 → 原样
  assert.equal(canonicalEffortId('high'), 'high')
  // 出站：规范名 → 该模型真正接受的私有值
  assert.equal(privateEffortFor('low', ['light', 'high', 'extra_high']), 'light')
  assert.equal(privateEffortFor('xhigh', ['light', 'high', 'extra_high']), 'extra_high')
  assert.equal(privateEffortFor('medium', ['off', 'level_1', 'level_3', 'level_5']), 'level_3')
  assert.equal(privateEffortFor('off', ['off', 'level_1']), 'off')
  // 该模型不提供该档 → undefined（调用方据此不发 wire 字段）
  assert.equal(privateEffortFor('max', ['light', 'high']), undefined)
  assert.equal(privateEffortFor(undefined, ['light']), undefined)
})

test('图片能力两个真相源不分叉：白名单必须与兜底表一致，且已知实测支持者不漏', async () => {
  const { RACCOON_FREE_FALLBACK_MODELS, RACCOON_PRO_FALLBACK_MODELS, RACCOON_IMAGE_CAPABILITY_OVERRIDES, raccoonSupportsImage } =
    await import('../vendor/channel-pack/src/raccoon-product.ts')
  const freeById = new Map(RACCOON_FREE_FALLBACK_MODELS.map(m => [m.id, m]))
  // ① 白名单只放兜底表声明支持图片的模型：白名单写错会让纯文本模型被放行。
  for (const id of RACCOON_IMAGE_CAPABILITY_OVERRIDES) {
    // 白名单可覆盖只在远端目录出现的 id（如早于当前兜底表的
    // `sn-deepseek-v4-1-flash`）；只要进了兜底表就必须声明支持图片。
    const entry = freeById.get(id)
    if (entry !== undefined) assert.equal(entry.supportsImage, true, `白名单 ${id} 在兜底表里声明为不支持图片`)
    // 订阅侧同 id 去 `-p` 后必须同样命中（远端路径先剥后缀再比对）。
    assert.equal(raccoonSupportsImage(`${id}-p`, []), true, `订阅侧 ${id}-p 未命中白名单`)
  }
  // ② 正向：兜底表声明支持图片的模型，**即使远端目录没给任何标签**也必须判支持。
  //   这是本次真实分叉的方向（兜底表 true / 远端空标签 false），旧断言只覆盖了
  //   反向且因全表皆 true 而空转。要求：兜底表 true ⇒ 必须命中白名单。
  let checked = 0
  for (const model of [...RACCOON_FREE_FALLBACK_MODELS, ...RACCOON_PRO_FALLBACK_MODELS]) {
    assert.equal(typeof model.supportsImage, 'boolean', `${model.id} 兜底表缺 supportsImage`)
    if (model.supportsImage !== true) {
      assert.equal(raccoonSupportsImage(model.id, []), false, `${model.id} 声明不支持却被空标签放行`)
      continue
    }
    checked += 1
    assert.equal(raccoonSupportsImage(model.id, []), true,
      `${model.id} 兜底表说支持图片，空标签下却判不支持 —— 需加入 RACCOON_IMAGE_CAPABILITY_OVERRIDES`)
  }
  assert.ok(checked >= 7, '兜底表应至少 7 条声明支持图片，实际 ' + checked)
  // ③ 定向回归：`sn-glm-5-3` 远端这版目录不带 `vision` 标签，但实测能看图，
  //    必须靠白名单兜住 —— 2026-11-23 审计发现的真实分叉。
  assert.equal(raccoonSupportsImage('sn-glm-5-3', []), true)
  assert.equal(raccoonSupportsImage('sn-glm-5-3-p', []), true)
})
