/**
 * Loomy 客户端指纹头与请求体形态。
 *
 * ## 为什么保留这组测试（即使当前不给界面入口）
 *
 * 上游按「请求像不像官方客户端」决定是否**降级换模型**，同时简化 body 会被
 * 直接 429。这组能力**代码保留、入口关闭**（用户不暴露开关），所以：
 *
 * - 头必须仍然正确 —— 否则连「正常回复」都做不到（429 或挂死）；
 * - 但**不要**再指望它解决账号级降级：实测同一账号无论怎么伪装都落到
 *   `spark-x2.6-low`，那是上游标记，与请求形态无关。
 *
 * 本文件锁住两件事：
 *
 * 1. **头与客户端一致**：`traceparent`（每请求新生成、格式合法）、
 *    `loomy-version`、`X-Loomy-Request-Purpose`、`X-Session-Affinity`（按账号稳定）、
 *    `User-Agent`（opencode 运行时那串，**不是** Node/Electron）、`Accept`（通配符）。
 * 2. **双轨鉴权不变**：chat 端点仍两个头都发（`Authorization` + `token`）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

function installSourceHooks() {
  return registerHooks({
    resolve(specifier, context, next) {
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

installSourceHooks()
const {
  loomyChatHeaders,
  loomyBusinessHeaders,
  newTraceparent,
  sessionAffinity,
  LOOMY_CLIENT_USER_AGENT,
  LOOMY_CLIENT_ACCEPT,
  LOOMY_CLIENT_VERSION,
  LOOMY_REQUEST_PURPOSE_CHAT,
} = await import('../vendor/channel-pack/src/loomy.ts')

test('chat 头：客户端指纹齐全', () => {
  const h = loomyChatHeaders('session-token', { uid: 'uid-abc' })

  assert.match(h.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  assert.equal(h['loomy-version'], LOOMY_CLIENT_VERSION)
  assert.equal(h['X-Loomy-Request-Purpose'], LOOMY_REQUEST_PURPOSE_CHAT)
  assert.equal(h['User-Agent'], LOOMY_CLIENT_USER_AGENT)
  assert.equal(h.Accept, LOOMY_CLIENT_ACCEPT)
  assert.equal(h.Accept, '*/*')

  // ⚠️ UA 不能是 Node/undici 默认值 —— 那是最显眼的「不是客户端」痕迹。
  assert.notEqual(h['User-Agent'].toLowerCase(), 'node')
  assert.ok(h['User-Agent'].startsWith('opencode/'))

  assert.match(h['X-Session-Affinity'], /^ses_[A-Za-z0-9]{20}$/)
})

test('chat 头：traceparent 每请求新生成，affinity 按账号稳定', () => {
  const a = loomyChatHeaders('t', { uid: 'same-uid' })
  const b = loomyChatHeaders('t', { uid: 'same-uid' })
  assert.notEqual(a.traceparent, b.traceparent)
  assert.equal(a['X-Session-Affinity'], b['X-Session-Affinity'])
  assert.notEqual(sessionAffinity('uid-1'), sessionAffinity('uid-2'))
  assert.equal(sessionAffinity('uid-1'), sessionAffinity('uid-1'))
  assert.ok(newTraceparent() !== newTraceparent())
})

test('chat 头：无 uid 时不发 affinity（不编造）', () => {
  assert.equal(sessionAffinity(undefined), '')
  assert.equal(sessionAffinity('   '), '')
  const h = loomyChatHeaders('t', {})
  assert.equal('X-Session-Affinity' in h, false)
  assert.ok(h.traceparent)
  assert.equal(h['User-Agent'], LOOMY_CLIENT_USER_AGENT)
})

test('双轨鉴权不变：chat 两个头都发，业务端点只发 token', () => {
  const chat = loomyChatHeaders('session-token', { uid: 'u' })
  assert.equal(chat.Authorization, 'Bearer session-token')
  assert.equal(chat.token, 'session-token')

  const business = loomyBusinessHeaders('session-token')
  assert.equal(business.token, 'session-token')
  assert.equal('Authorization' in business, false, '业务端点带 Bearer 会被判缺少 token')
  assert.equal('traceparent' in business, false)
})
