import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_WATCH,
  assessRepeat,
  createReasoningWatch,
  guardStream,
  createResumeBook,
  installCotLoopGuard,
  CONTINUE_PROMPT,
  GUARD_EVENT,
} from '../lib/cot-loop-guard/index.js'
import { apply } from '../lib/web-host.js'

async function collect(iterable) {
  const out = []
  for await (const item of iterable) out.push(item)
  return out
}

test('原 channel-pack 适配器内旧守卫已移除（恒返回 false，避免双重判定）', () => {
  const sseSource = readFileSync(new URL('../vendor/channel-pack/src/sse.ts', import.meta.url), 'utf8')
  assert.match(sseSource, /export function isReasoningLoopGuardEnabled\(\):\s*boolean\s*\{\s*return false\s*\}/)
  const backendSource = readFileSync(new URL('../lib/backend.js', import.meta.url), 'utf8')
  assert.match(backendSource, /function isReasoningLoopGuardEnabled\(\)\s*\{\s*return false;\s*\}/)
})

test('watch 三态滞回：健康直通、周期重复暂存后恢复、持续重复确认切断并丢弃尾部', () => {
  const w = createReasoningWatch(DEFAULT_WATCH)
  const healthy = w.push('先检查目录结构并确认接口签名。')
  assert.equal(healthy.state, 'FORWARD')
  assert.equal(healthy.cut, false)
  assert.equal(healthy.emit, '先检查目录结构并确认接口签名。')

  // 制造周期重复进入 HOLDING（180 <= repeat < 720，不含分句标点）
  const phrase = 'abcdefghijklmno1' // 16 chars
  const holdPush = w.push(phrase.repeat(14)) // 224 chars
  assert.equal(holdPush.state, 'HOLDING')
  assert.equal(holdPush.transition, 'hold')
  assert.equal(holdPush.emit, '')

  // 出现新推理文本恢复到 FORWARD，释放之前暂存的片段
  const recover = w.push('现在已经确认根因是端口绑定冲突，准备修改配置并验证结果。')
  assert.equal(recover.state, 'FORWARD')
  assert.equal(recover.transition, 'recover')
  assert.ok(recover.emit.includes(phrase))
  assert.ok(recover.emit.includes('端口绑定冲突'))

  // 再次陷入持续循环直到超过 720 触发 CUT
  const w2 = createReasoningWatch(DEFAULT_WATCH)
  let cutResult = null
  for (let i = 0; i < 60; i += 1) {
    const step = w2.push(phrase)
    if (step.cut) { cutResult = step; break }
  }
  assert.ok(cutResult, '应命中 CUT')
  assert.equal(cutResult.state, 'CUT')
  assert.ok(cutResult.droppedChars > 0)
})

test('watch 子句池检测与 answered 闩锁：正文出现后不再切断', () => {
  const pool = ['先检查一下当前配置。', '再确认一下依赖状态。', '等等这里有点不对劲。', '重新核对一下输出结果。']
  let text = ''
  for (let i = 0; i < 100; i += 1) text += pool[i % pool.length] + '\n'
  const verdict = assessRepeat(text, DEFAULT_WATCH)
  assert.ok(verdict.poolChars >= DEFAULT_WATCH.cutRepeatChars)

  // 正文出现后 markAnswer 闩锁生效，后续不再触发切断
  const w = createReasoningWatch(DEFAULT_WATCH)
  w.push('初步思考')
  w.markAnswer()
  const after = w.push('重复的短语用于测试。'.repeat(100))
  assert.equal(after.cut, false)
  assert.equal(after.state, 'FORWARD')
})

test('guardStream：命中切断后关闭已打开块、合成 finish{stop} 并取消上游迭代器', async () => {
  let returned = false
  const phrase = '反复检查同一行代码有没有遗漏。'
  async function* loopingUpstream() {
    try {
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: '正常开头。' }
      for (let i = 0; i < 80; i += 1) {
        yield { type: 'reasoning-delta', index: 0, text: phrase }
      }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } }
    } finally {
      returned = true
    }
  }
  let cutReport = null
  const chunks = await collect(guardStream(loopingUpstream(), DEFAULT_WATCH, report => { cutReport = report }))
  assert.ok(cutReport, '应触发 onCut')
  assert.equal(returned, true, '切断后应尽力关闭上游迭代器')
  assert.equal(chunks.at(-1)?.type, 'finish')
  assert.deepEqual(chunks.at(-1)?.reason, { kind: 'stop' })
  assert.ok(chunks.some(c => c.type === 'block-end' && c.index === 0))
})

test('guardStream：HOLDING 态下自然结束 reasoning 块与 finish，必须在 block-end 和 finish 之前冲刷 held 文本', async () => {
  const phrase = 'abcdefghijklmno1' // 16 chars
  async function* holdingThenEnd() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: phrase.repeat(14) } // 224 chars → HOLDING
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: phrase.repeat(14) } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const chunks = await collect(guardStream(holdingThenEnd(), DEFAULT_WATCH, () => assert.fail('HOLDING 未超阈值不应切断')))
  const types = chunks.map(c => c.type)
  assert.deepEqual(types, ['block-start', 'reasoning-delta', 'block-end', 'finish'])
  assert.equal(chunks[1].text, phrase.repeat(14))
  assert.equal(chunks[2].block.text, phrase.repeat(14))

  // 无 reasoning-delta、仅 block-start + 权威 block-end 时，不得清空 block.text 或丢弃附加属性
  async function* directBlockEnd() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '上游完整思考内容', signature: 'sig-1' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const direct = await collect(guardStream(directBlockEnd(), DEFAULT_WATCH, () => assert.fail('不应切断')))
  assert.equal(direct[1].block.text, '上游完整思考内容')
  assert.equal(direct[1].block.signature, 'sig-1')
})

test('resume 台账：idle 且收件箱为空时自动续跑、受上限保护、他人消息插入时清零', () => {
  const sent = []
  const book = createResumeBook({ maxResumes: 2 }, {}, ({ content }) => ({ id: `msg-${sent.length + 1}`, content }))
  const agent = {
    id: 'agent-1',
    status: 'idle',
    inbox: { hasPending: false, nextTurn: [] },
    followup(msg) { sent.push(msg) },
  }
  const agents = { withoutInitiator: fn => fn() }

  book.noteCut(agent)
  assert.equal(book.onIdle(agent, agents), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].content[0].text, CONTINUE_PROMPT)
  // 自身注入的消息回流不应清零计数
  book.onInserted(agent, sent[0].id)

  book.noteCut(agent)
  assert.equal(book.onIdle(agent, agents), true)
  assert.equal(sent.length, 2)
  book.onInserted(agent, sent[1].id)

  // 第 3 次超上限不再发送
  book.noteCut(agent)
  assert.equal(book.onIdle(agent, agents), false)
  assert.equal(sent.length, 2)

  // 人类插入新消息后计数清零，可重新续跑
  book.onInserted(agent, 'human-msg-1')
  book.noteCut(agent)
  assert.equal(book.onIdle(agent, agents), true)
  assert.equal(sent.length, 3)
})

test('web-host 集成：cot-loop-guard 统一挂载到 llm/stream 覆盖所有 provider，并受分渠道开关动态控制', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cot-guard-host-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }))
  const listeners = new Map()
  const routes = new Map()
  const cleanup = []
  const followups = []
  const agent = {
    id: 'sess-1',
    status: 'idle',
    inbox: { hasPending: false, nextTurn: [] },
    followup(msg) { followups.push(msg) },
  }
  const agentsService = { get: id => id === 'sess-1' ? agent : undefined, withoutInitiator: fn => fn() }
  const ctx = {
    connection: {
      createPeer: () => ({ dispose() {} }),
      createSharedFetchHandler: () => ({ fetch: async () => Response.json({ type: 'server-response', rpcId: 'x', result: { ok: true, value: {} } }) }),
      fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    },
    credentials: {},
    llm: {},
    agents: agentsService,
    logger: { info() {}, warn() {} },
    emitted: [],
    emit(name, payload) { this.emitted.push({ name, payload }) },
    get(key) { return this[key] },
    on(event, fn, opts) {
      listeners.set(event, { fn, opts })
      return () => listeners.delete(event)
    },
    inject(deps, fn) {
      if (deps.includes('agents')) fn(this)
      else fn(this)
    },
    effect(fn) { cleanup.push(fn()) },
  }

  apply(ctx, { backend: 'shared', cotLoopGuard: { emitEvents: true } }, {
    autoCollect: false,
    snapshotFile: join(dir, 'settings.json'),
    automationFile: join(dir, 'automation.json'),
    createUserMessage: ({ content }) => ({ id: 'u-1', content }),
  })

  try {
    const streamHook = listeners.get('llm/stream')
    assert.ok(streamHook, '应在宿主挂载 llm/stream 拦截器')
    assert.equal(streamHook.opts?.global, true, '必须使用 global: true 覆盖全部会话')

    const makeLoopStream = () => (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      for (let i = 0; i < 80; i += 1) {
        yield { type: 'reasoning-delta', index: 0, text: '不断重复思考同一句话用来验证切断。' }
      }
    })()

    // 验证覆盖所有类型 provider（不仅限于原 channel-pack，也覆盖新渠道、API Key 及宿主任意其它 provider）
    for (const provider of ['raccoon-pro', 'trae', 'workbuddy', 'astudio', 'doubaowork', 'codearts', 'agnes', 'any-third-party-provider']) {
      const out = await collect(streamHook.fn({ provider, model: 'test-m' }, makeLoopStream))
      assert.equal(out.at(-1)?.type, 'finish', `${provider} 应被统一保护并切断`)
      assert.deepEqual(out.at(-1)?.reason, { kind: 'stop' })
    }

    // 单会话触发一次切断后进入 idle，验证自动续跑
    await collect(streamHook.fn({ provider: 'astudio', model: 'test-m', sessionId: 'sess-1' }, makeLoopStream))
    listeners.get('agent/status')?.fn({ agent, status: 'idle' })
    assert.equal(followups.length, 1)

    // 监控广播：每次切断与续跑都发一条只含元数据的事件
    const guardEvents = ctx.emitted.filter(e => e.name === GUARD_EVENT).map(e => e.payload)
    const cuts = guardEvents.filter(e => e.type === 'cut')
    assert.ok(cuts.length >= 9, '每个被切断的调用都应广播 cut')
    const sessCut = cuts.find(e => e.provider === 'astudio' && e.sessionHash)
    assert.match(sessCut.sessionHash, /^[0-9a-f]{16}$/)
    assert.equal(sessCut.state, 'CUT')
    assert.ok(sessCut.droppedChars > 0)
    assert.ok(guardEvents.some(e => e.type === 'resume' && /^[0-9a-f]{16}$/.test(e.agentHash)))
    const serialized = JSON.stringify(guardEvents)
    assert.ok(!serialized.includes('不断重复思考'), '广播不得含 reasoning 原文')
    assert.ok(!serialized.includes('sess-1'), '广播不得含原始 session/agent id')

    // 通过 RPC 关闭单个渠道（trae）的思考循环保护，验证动态生效
    const route = routes.get('/api/unified-router')
    const res = await route.fetch(new Request('http://dsh.internal/api/unified-router', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'cfg-1', method: 'unified-router',
        payload: { method: 'automation.setConfig', payload: { provider: 'trae', cotLoopGuard: false } },
      }),
    }))
    const body = await res.json()
    assert.equal(body.result.ok, true)
    assert.equal(body.result.value.config.providers.trae.cotLoopGuard, false)

    // trae 关闭后不再拦截，但 astudio 仍然保持保护
    const traeOut = await collect(streamHook.fn({ provider: 'trae', model: 'test-m' }, makeLoopStream))
    assert.equal(traeOut.some(c => c.type === 'finish'), false, '关闭后的渠道应透传原流')
    const astudioOut = await collect(streamHook.fn({ provider: 'astudio', model: 'test-m' }, makeLoopStream))
    assert.equal(astudioOut.at(-1)?.type, 'finish', '未关闭的渠道仍保持保护')
  } finally {
    for (const stop of cleanup.reverse()) stop?.()
  }
})

test('广播失败不影响守卫：监听器抛错时仍正常切断', async () => {
  const listeners = new Map()
  const ctx = {
    on(event, fn) { listeners.set(event, fn); return () => {} },
    emit() { throw new Error('listener boom') },
  }
  const guard = installCotLoopGuard(ctx, {})
  const loop = async function* () {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    for (let i = 0; i < 80; i += 1) yield { type: 'reasoning-delta', index: 0, text: '不断重复思考同一句话用来验证切断。' }
  }
  const out = await collect(listeners.get('llm/stream')({ provider: 'p', model: 'm' }, loop))
  assert.equal(out.at(-1)?.type, 'finish')
  guard.dispose()
})

test('监控广播默认关闭：未显式开启 emitEvents 时不发任何事件', async () => {
  const listeners = new Map()
  const emitted = []
  const ctx = {
    on(event, fn) { listeners.set(event, fn); return () => {} },
    emit(name, payload) { emitted.push({ name, payload }) },
  }
  const guard = installCotLoopGuard(ctx, {})
  const loop = async function* () {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    for (let i = 0; i < 80; i += 1) yield { type: 'reasoning-delta', index: 0, text: '不断重复思考同一句话用来验证切断。' }
  }
  const out = await collect(listeners.get('llm/stream')({ provider: 'p', model: 'm' }, loop))
  assert.equal(out.at(-1)?.type, 'finish', '守卫照常切断')
  assert.equal(emitted.length, 0, '默认不对外广播')
  guard.dispose()
})
