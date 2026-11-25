/**
 * 模型黑名单的**过期条目卫生**（2026-11-18，用户报障）。
 *
 * ## 症状
 *
 * 设置页的模型列表里出现 `qwen-3.8-max` —— 上游目录早就没有这个 id 了。
 *
 * ## 根因（两个叠加）
 *
 * 1. `disabledModels` 是**历史累积**的用户状态：模型下架后它的开关记录仍留在
 *    `state.json` 里（`raccoon: { 'qwen-3.8-max': true }`）。
 * 2. `model.list` 旧实现有一条「保底」逻辑：把黑名单里存在、目录里不存在的 id
 *    用裸 id 补成一行（`catalog.push({ id, name: id })`），本意是防止「关掉的
 *    模型找不到、无法重新打开」。于是**过期状态被复活成幽灵模型行**。
 *
 * ## 本用例锁定的行为
 *
 * 1. 黑名单里存在、目录里没有的 id **不得出现**在 `model.list`（只认目录）；
 * 2. 目录来自**远端真拉**时，`model.list` 顺手剪掉这些无效黑名单条目并落盘；
 * 3. 目录来自**离线兜底**时**不剪**（兜底表只是精选子集，剪了会误删用户对
 *    表外模型的偏好）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const KERNEL = new URL('./kernel.mjs', import.meta.url).href

/** 装最小后端：真 `lib/backend.js` + 桩 llm/credentials/connection。 */
async function mount(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-blacklist-'))
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier.startsWith('@deepseek-ai/') ? { url: KERNEL, shortCircuit: true } : next(specifier, context)
    },
  })
  const originalHome = process.env.DSH_HOME
  const stateDir = process.env.DSH_CHANNEL_PACK_STATE_DIR
  const originalFetch = globalThis.fetch
  process.env.DSH_HOME = scratch
  process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch

  // 上游目录：只有 sn-a / sn-b 两个模型；黑名单里另有已下架的 sn-gone。
  const catalog = {
    code: 0,
    data: { categories: [{ type: 'chat', models: [
      { name: 'sn-a', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [] },
      { name: 'sn-b', visible: true, params: { context_window: 256_000, max_tokens: 63_999 }, tags: [] },
    ] }] },
  }
  let online = true
  globalThis.fetch = async (url) => {
    if (!online) throw new Error('offline fixture')
    if (String(url).includes('model_catalog')) {
      return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch: ${String(url)}`)
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

  let rpc
  const { mountBackend } = await import('../lib/backend.js')
  const pool = mountBackend(ctx, call => { rpc = call })
  credentials.set('REF_FREE', { value: JSON.stringify({ access_token: 'token-free' }) })
  await pool.addAccount({
    id: 'raccoon-free', provider: 'raccoon', nickname: '免费账号', credentialRef: 'REF_FREE',
    enabled: true, refreshable: false, createdAt: 1, plan: 'free',
  })
  // 历史遗留：一个上游已经不存在的 id 被用户「关掉」过。
  await pool.setModelDisabled('raccoon', 'sn-gone', true)

  t.after(async () => {
    for (const stop of cleanup.reverse()) await stop()
    hooks.deregister()
    globalThis.fetch = originalFetch
    if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
    if (stateDir === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR
    else process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir
    fs.rmSync(scratch, { recursive: true, force: true })
  })
  return {
    rpc,
    pool,
    adapter: adapters.get('raccoon'),
    goOffline() { online = false },
    statePath: path.join(scratch, 'channel-pack/state.json'),
  }
}

const ids = async (rpc) => (await rpc('model.list', { provider: 'raccoon' })).value.models.map(model => model.id).sort()

test('离线兜底目录里没有的黑名单 id 不出现在列表里（不复活幽灵模型）', async (t) => {
  const f = await mount(t)
  // 上游不可达：目录只能退回兜底表（7 条），其中没有任何 sn-gone。
  f.goOffline()
  const listed = await ids(f.rpc)
  assert.equal(f.adapter.isRemoteCatalog(), false, '拉取失败时目录是兜底表')
  assert.equal(listed.includes('sn-gone'), false, '黑名单里的过期 id 不得被补成一行模型')
  // 兜底目录下**不剪枝**：那是精选子集，剪了会误删表外模型的偏好。
  assert.equal(f.pool.listDisabledModels('raccoon')['sn-gone'], true)
})

test('远端目录成功后会剪掉过期黑名单条目并落盘，保留仍在目录内的条目', async (t) => {
  const f = await mount(t)
  // 真拉一次远端目录（只有 sn-a / sn-b），并把 sn-a 也关掉——它是真实模型，必须保留。
  await f.rpc('model.refresh', { provider: 'raccoon' })
  await f.pool.setModelDisabled('raccoon', 'sn-a', true)
  assert.equal(f.adapter.isRemoteCatalog(), true)

  const listed = await ids(f.rpc)
  assert.deepEqual(listed, ['sn-a', 'sn-b'])
  assert.equal(listed.includes('sn-gone'), false)

  const persisted = JSON.parse(fs.readFileSync(f.statePath, 'utf8'))
  assert.equal(persisted.disabledModels.raccoon['sn-gone'], undefined, '过期条目必须从 state.json 里消失')
  assert.equal(persisted.disabledModels.raccoon['sn-a'], true, '真实模型上的用户偏好不得被误删')
})

test('刷新失败继续读上次目录，且不根据缓存剪枝', async (t) => {
  const f = await mount(t)
  await f.rpc('model.refresh', { provider: 'raccoon' })
  await f.pool.setModelDisabled('raccoon', 'sn-a', true)
  await ids(f.rpc) // 触发一次剪枝：sn-gone 被清掉
  const before = f.pool.listDisabledModels('raccoon')
  assert.deepEqual(Object.keys(before).sort(), ['sn-a'])

  await f.pool.setModelDisabled('raccoon', 'sn-real-but-not-in-fallback', true)
  f.goOffline()
  const refresh = await f.rpc('model.refresh', { provider: 'raccoon' })
  assert.equal(refresh.value.source, 'cached')
  assert.deepEqual(await ids(f.rpc), ['sn-a', 'sn-b'])
  assert.equal(f.pool.listDisabledModels('raccoon')['sn-real-but-not-in-fallback'], true)
})
