/**
 * Raccoon「统一免费与订阅模型」开关（raccoonUnifiedModels）。
 *
 * ## 被测契约
 *
 * 1. **目录合并**：订阅侧条目去 `-p` 后并入免费侧目录；免费侧条目优先
 *    （它是默认服务面），订阅独有的模型补进差集；`raccoon-pro` 从模型
 *    选择器整体隐藏（`listModels` 返回空），设置页目录不受影响。
 * 2. **跨侧选号**：免费侧优先（宁可用免费模型也不误扣付费额度）；
 *    免费侧无可用账号（受限/已试过）时自动改用订阅账号。
 * 3. **出站翻译**：请求体与限流键按**实际服务账号的套餐**翻译
 *    （订阅账号 = `<统一 id>-p`，免费账号 = 原样）；选号、账本与调用账号
 *    记录仍用统一 id。
 * 4. **开关恢复**：关闭后回到两侧独立 —— 订阅面重新可见、免费侧不再跨侧。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier.startsWith('@deepseek-ai/') ? { url: new URL('./kernel.mjs', import.meta.url).href, shortCircuit: true } : next(specifier, context)
} })

test('统一免费与订阅模型：合并目录、跨侧选号、出站 -p 翻译、订阅面隐藏', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))
  const originalHome = process.env.DSH_HOME
  const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR
  const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch
  process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch

  // 目录按账号套餐返回不同条目（免费：sn-a/sn-b；订阅：sn-a-p/sn-c-p），
  // 用于验证「合并按凭据取两侧、免费优先、订阅独有补差集」。
  const catalogRows = (ids, multiplier) => ({ code: 0, data: { categories: [{ type: 'chat', models: ids.map(id => ({
    name: id, description: `显示 ${id}`, visible: true,
    billing_effective_multiplier: multiplier, billing_multiplier: multiplier,
    params: { context_window: 256_000, max_tokens: 63_999 }, tags: [],
  })) }] } })
  const freeCatalog = catalogRows(['sn-a', 'sn-b'], 0)
  const proCatalog = catalogRows(['sn-a-p', 'sn-c-p'], 0.75)
  const chatBodies = []
  let freeQuotaFails = true
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    const token = String(init.headers?.Authorization ?? '')
    if (target.includes('model_catalog')) {
      const payload = token.endsWith('free-token') ? freeCatalog : token.endsWith('pro-token') ? proCatalog : null
      if (payload === null) throw new Error(`unexpected catalog token: ${token}`)
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('chat/completions')) {
      chatBodies.push({ body: JSON.parse(init.body), token })
      if (token.endsWith('free-token') && freeQuotaFails) {
        return new Response(JSON.stringify({ error: { code: '402', message: '积分不足' } }),
          { status: 402, headers: { 'content-type': 'application/json' } })
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error(`unexpected fetch: ${target}`)
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

  let unifiedFlag = true
  try {
    let rpc
    const { mountBackend, mergeUnifiedRaccoonCatalogs } = await import('../lib/backend.js')
    const pool = mountBackend(ctx, call => { rpc = call }, { isRaccoonUnifiedModels: () => unifiedFlag })

    // ---- 合并纯函数：免费优先、订阅去 -p 补差集、不覆盖同名 ----
    const merged = mergeUnifiedRaccoonCatalogs(
      [{ id: 'sn-a', name: 'A' }, { id: 'sn-b', name: 'B' }],
      [{ id: 'sn-a-p', name: 'A-p' }, { id: 'sn-c-p', name: 'C' }, { id: 'sn-d', name: 'D' }],
    )
    assert.deepEqual(merged.map(model => [model.id, model.name]), [
      ['sn-a', 'A'], ['sn-b', 'B'], ['sn-c', 'C'], ['sn-d', 'D'],
    ])

    credentials.set('REF_FREE', { value: JSON.stringify({ access_token: 'free-token', office_identity: 'org' }) })
    credentials.set('REF_PRO', { value: JSON.stringify({ access_token: 'pro-token', office_identity: 'org' }) })
    await pool.addAccount({ id: 'free-acc', provider: 'raccoon', nickname: '免费号', credentialRef: 'REF_FREE', enabled: true, refreshable: false, createdAt: 1, plan: 'free' })
    await pool.addAccount({ id: 'pro-acc', provider: 'raccoon', nickname: '订阅号', credentialRef: 'REF_PRO', enabled: true, refreshable: false, createdAt: 2, plan: 'pro' })

    const adapter = adapters.get('raccoon')
    const proAdapter = adapters.get('raccoon-pro')

    // ---- 统一模式：合并目录 + 订阅面隐藏 ----
    const refresh = await rpc('model.refresh', { provider: 'raccoon' })
    assert.equal(refresh.value.source, 'remote')
    assert.deepEqual(adapter.listAllModels().map(model => model.id), ['sn-a', 'sn-b', 'sn-c'])
    assert.deepEqual((await services.llm.listModels('raccoon')).map(model => model.id).sort(), ['sn-a', 'sn-b', 'sn-c'])
    assert.deepEqual(await services.llm.listModels('raccoon-pro'), [], '统一模式下订阅面从选择器隐藏')
    // 订阅独有的模型可用统一 id 解析（出站时才翻译回 -p）。
    assert.equal((await adapter.resolveModel('raccoon', 'sn-c')).id, 'sn-c')

    // ---- 跨侧选号：免费优先；出站翻译按账号套餐 ----
    const outbound = adapter.options.outboundModelId
    assert.equal(typeof outbound, 'function')
    assert.equal(outbound('sn-a', 'free-acc'), 'sn-a')
    assert.equal(outbound('sn-a', 'pro-acc'), 'sn-a-p')
    assert.equal(outbound('sn-a', undefined), 'sn-a')
    assert.equal(proAdapter.options.outboundModelId, undefined, '订阅面不做出站翻译')
    assert.equal((await adapter.options.nextAccount('sn-a', new Set())).accountId, 'free-acc')
    assert.equal((await adapter.options.nextAccount('sn-a', new Set(['free-acc']))).accountId, 'pro-acc')
    assert.equal(await adapter.options.nextAccount('sn-a', new Set(['free-acc', 'pro-acc'])), undefined)

    // ---- 流式跨侧换号：免费号 402 → 限流键按统一 id → 换订阅号 → 出站 -p ----
    chatBodies.length = 0
    let chunks = 0
    for await (const _chunk of adapter.stream({ model: 'sn-a', messages: [{ role: 'user', content: 'hi' }] })) chunks++
    assert.ok(chunks > 0, '换号后拿到正文')
    assert.deepEqual(chatBodies.map(row => [row.body.model, row.token.endsWith('free-token') ? 'free' : 'pro']), [
      ['sn-a', 'free'], ['sn-a-p', 'pro'],
    ], '两笔请求的模型 id 按服务账号套餐翻译')
    const freeEntry = pool.listAccountsByProvider('raccoon').find(account => account.id === 'free-acc')
    assert.ok(Number.isFinite(freeEntry.modelRateLimits?.['sn-a']), '免费号的限流键是统一 id')
    assert.equal(freeEntry.modelRateLimits?.['sn-a-p'], undefined, '订阅侧键不得写进免费号')
    assert.equal((await adapter.options.nextAccount('sn-a', new Set())).accountId, 'pro-acc', '免费号受限后自动落到订阅号')

    // ---- 两侧都限流：报精确的限流原因，而不是误导性的「未登录」 ----
    await pool.updateModelRateLimit('pro-acc', 'sn-a-p', Date.now() + 60_000)
    await assert.rejects(adapter.options.resolveCredential('sn-a'), { code: 'QUOTA_EXCEEDED' })
    await pool.updateModelRateLimit('free-acc', 'sn-a', Date.now() - 1)
    await pool.updateModelRateLimit('pro-acc', 'sn-a-p', Date.now() - 1)

    // ---- 关闭开关：回到两侧独立 ----
    unifiedFlag = false
    const proRefresh = await rpc('model.refresh', { provider: 'raccoon-pro' })
    assert.equal(proRefresh.value.source, 'remote')
    assert.deepEqual((await services.llm.listModels('raccoon-pro')).map(model => model.id).sort(), ['sn-a-p', 'sn-c-p'])
    assert.equal(await adapter.options.nextAccount('sn-a', new Set(['free-acc'])), undefined, '关闭后免费侧不再跨侧选号')
  } finally {
    unifiedFlag = false
    for (const stop of cleanup.reverse()) await stop()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR
    else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
    hooks.deregister()
  }
})
