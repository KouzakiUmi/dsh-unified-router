// RPC 门面：方法白名单与渠道校验**全部由渠道规格表派生**，不在这里手写渠道清单。
//
// 为什么：这一层过去是「每加一个渠道就在这里补一个 Set、一个 if 分支」的集中分派点，
// 客户端还要把同一份清单再抄一遍。现在清单的唯一事实源是 `lib/channel-specs.js`
// （纯数据，宿主与客户端共用），本文件只做两件事：派生与门禁。
import { randomUUID } from 'node:crypto'
import {
  CHANNEL_SPECS, GLOBAL_METHODS, methodsOfKind,
} from './channel-specs.js'

/** 账号池渠道（vendor channel-pack）：`provider.status` / `account.list` 的轮询范围。 */
export const PROVIDERS = Object.freeze(
  CHANNEL_SPECS.filter(spec => spec.kind === 'pack')
    .map(spec => Object.freeze({
      id: spec.id,
      title: spec.title,
      claim: spec.claim === true,
      ...(spec.accountPool === false ? { accountPool: false } : {}),
    })),
)
const ids = new Set(PROVIDERS.map(provider => provider.id))
const idsOfKind = kind => CHANNEL_SPECS.filter(spec => spec.kind === kind && spec.registered !== false).map(spec => spec.id)
const setOfKind = kind => {
  const { read, write } = methodsOfKind(kind)
  return Object.freeze(new Set([...read, ...write]))
}

/** 单 Key 订阅渠道（商汤 Token Plan）。 */
export const PLAN_PROVIDER_ID = idsOfKind('plan')[0]
export const PLAN_METHODS = setOfKind('plan')
/** 自管单渠道（WorkBuddy）。 */
export const WORKBUDDY_PROVIDER_ID = idsOfKind('workbuddy')[0]
export const WORKBUDDY_METHODS = setOfKind('workbuddy')
/** API Key 渠道（Agnes / 云知声）。 */
export const APIKEY_PROVIDER_IDS = Object.freeze(idsOfKind('apikey'))
export const APIKEY_METHODS = setOfKind('apikey')
/** 自管多账号渠道（CodeArts；AStudio 停用故不在表内）。 */
export const MANAGED_PROVIDER_IDS = Object.freeze(idsOfKind('managed'))
export const MANAGED_METHODS = setOfKind('managed')
/** 自动化调度（与渠道无关的全局方法）。 */
export const AUTOMATION_METHODS = Object.freeze(new Set(GLOBAL_METHODS.filter(method => method.startsWith('automation.'))))

/** 全部渠道 id：宿主侧 `provider.status` 与写操作的校验范围。 */
export const ALL_PROVIDER_IDS = Object.freeze(
  CHANNEL_SPECS.filter(spec => spec.registered !== false).map(spec => spec.id),
)

/** 全部可调用方法：直接遍历规格，避免第三处清单。 */
const methods = new Set(GLOBAL_METHODS)
for (const spec of CHANNEL_SPECS) {
  if (spec.registered === false) continue
  for (const method of [...methodsOfKind(spec.kind).read, ...methodsOfKind(spec.kind).write, ...(spec.methods?.extra ?? [])]) methods.add(method)
}

/**
 * 渠道校验：方法 → 允许的 provider id。
 *
 * 规则按「方法的类别」判，不按方法名字面量写 if 链：
 * - 类别级方法（`<kind>.*` 且整类只有一种范式）→ 该类别的注册渠道；
 * - 其余方法 → 账号池渠道（`provider.status` / `account.*` / `model.*` / `credits.*`）。
 *
 * 单渠道专属方法在规格的 `methods.extra` 里声明，其归属由该渠道的 `id` 决定。
 */
const allowedProvidersOf = method => {
  if (method.startsWith('plan.')) return PLAN_PROVIDER_IDS()
  if (method.startsWith('workbuddy.')) return [WORKBUDDY_PROVIDER_ID]
  if (method.startsWith('apikey.')) return APIKEY_PROVIDER_IDS
  if (method.startsWith('managed.')) return MANAGED_PROVIDER_IDS
  return null
}
const PLAN_PROVIDER_IDS = () => [PLAN_PROVIDER_ID]
/** 渠道专属方法（`methods.extra`）的归属：方法名只属于声明它的渠道。 */
const extraOwners = new Map()
for (const spec of CHANNEL_SPECS) for (const method of spec.methods?.extra ?? []) extraOwners.set(method, spec.id)

export function guardedRpc(raw) {
  return async (method, payload = {}, signal) => {
    if (!methods.has(method) || !payload || typeof payload !== 'object') throw new Error('不支持此操作')
    if (method === 'provider.status') {
      if (!Array.isArray(payload.providers) || payload.providers.some(id => !ids.has(id))) throw new Error('不支持此渠道')
    } else if (method.startsWith('automation.')) {
      if (payload.provider !== undefined && !ALL_PROVIDER_IDS.includes(payload.provider)) throw new Error('不支持此渠道')
    } else if (extraOwners.has(method)) {
      const owner = extraOwners.get(method)
      // 家族渠道（Raccoon 免费/订阅两个 provider 共用一个账号池）允许家族内任一面调用。
      const family = CHANNEL_SPECS.find(spec => spec.id === owner)?.family?.map(side => side.id) ?? [owner]
      if (!family.includes(payload.provider)) throw new Error('不支持此渠道')
    } else {
      const allowed = allowedProvidersOf(method)
      if (allowed) {
        if (!allowed.includes(payload.provider)) throw new Error('不支持此渠道')
      } else if (!ids.has(payload.provider)) throw new Error('不支持此渠道')
    }
    signal?.throwIfAborted()
    // 非账号池渠道（自管/API Key/单 Key/WorkBuddy/自动化）没有账号归属校验，
    // 它们的结果形状由各自管理器保证。
    if (PLAN_METHODS.has(method) || WORKBUDDY_METHODS.has(method) || APIKEY_METHODS.has(method)
      || MANAGED_METHODS.has(method) || AUTOMATION_METHODS.has(method)) {
      const result = await raw(method, payload, signal)
      signal?.throwIfAborted()
      if (result?.ok !== true) throw new Error('引擎未接受操作，请刷新后重试')
      return result.value
    }
    if (method === 'account.update') {
      const patch = payload.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['nickname', 'enabled'].includes(key))) throw new Error('账号设置无效')
      if (patch.nickname !== undefined && (typeof patch.nickname !== 'string' || !patch.nickname.trim() || [...patch.nickname].length > 80)) throw new Error('账号名称无效')
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('账号开关无效')
      payload = { ...payload, patch: { ...(patch.nickname === undefined ? {} : { nickname: patch.nickname.trim() }), ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }) } }
    }
    // Account methods upstream often take only an ID. Verify ownership before
    // forwarding, including in shared mode where other channels also exist.
    // WorkBuddy 的 accountId 是它自管账号索引里的 id（不在 channel-pack 账号池里，
    // account.list 不认识它），必须豁免——否则 checkin/logout/models 会一律失败。
    if (payload.accountId !== undefined && method !== 'login.poll' && !WORKBUDDY_METHODS.has(method)) {
      const listed = await raw('account.list', { provider: payload.provider }, signal)
      if (listed?.ok !== true || !listed.value?.accounts?.some(a => a.id === payload.accountId && a.provider === payload.provider)) throw new Error('账号已变动，请刷新')
    }
    const result = await raw(method, payload, signal)
    signal?.throwIfAborted()
    if (result?.ok !== true) throw new Error('引擎未接受操作，请刷新后重试')
    return result.value
  }
}

export function sharedTransport(connection, ctx) {
  if (typeof connection?.createSharedFetchHandler !== 'function' || typeof connection?.createPeer !== 'function') throw new Error('当前引擎不支持共用账号池')
  const peer = connection.createPeer({ principal: { kind: 'owner' } })
  ctx.effect(() => () => peer.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  return async (method, payload, signal) => {
    const rpcId = randomUUID()
    const response = await handler.fetch(new Request('http://dsh.internal/api/channel-pack', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'channel-pack', payload: { method, payload } }), signal,
    }), peer)
    if (!response.ok) throw new Error('原渠道后端未运行，请检查插件设置')
    const body = await response.json()
    if (body?.type !== 'server-response' || body.rpcId !== rpcId) throw new Error('渠道后端返回异常')
    return body.result
  }
}

export function loginUrl(value) {
  // 限长与客户端 safeLoginUrl 保持一致：主机侧先拒的超长地址，客户端不该放行再报错。
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址无效')
  const url = new URL(value)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址无效')
  return url.href
}
