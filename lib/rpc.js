import { randomUUID } from 'node:crypto'
import { WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'

export const PROVIDERS = Object.freeze([
  { id: 'loomy', title: 'Loomy', claim: true },
  // Raccoon 家族：同一上游账号体系拆成免费版 / 订阅版两个 provider（两侧各自
  // 用本侧账号凭据拉上游目录，不做倍率过滤；账号只有一个池）。两者都没有每日
  // 签到端点，故 claim 为 false。
  { id: 'raccoon', title: 'Raccoon 免费版', claim: false },
  { id: 'raccoon-pro', title: 'Raccoon 订阅版', claim: false, accountPool: false },
  { id: 'qodercn', title: 'Qoder 中国版', claim: true },
  { id: 'trae', title: 'TRAE', claim: true },
])
export const PLAN_PROVIDER_ID = 'sensenova-token-plan'
export const PLAN_METHODS = Object.freeze(new Set(['plan.snapshot', 'plan.setKey', 'plan.setEnabled', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels']))
export const WORKBUDDY_PROVIDER_ID = 'workbuddy'
export const WORKBUDDY_METHODS = Object.freeze(new Set(['workbuddy.snapshot', 'workbuddy.login', 'workbuddy.logout', 'workbuddy.checkin', 'workbuddy.models', ...WORKBUDDY_MODEL_WRITES]))
// API Key 渠道（Agnes / 云知声）：id 与 lib/apikey-providers.js 的 APIKEY_PROVIDER_IDS
// 保持一致；web-host 装配时也会对每个 id 校验渠道规格存在。
export const APIKEY_PROVIDER_IDS = Object.freeze(['agnes', 'unisound'])
export const APIKEY_METHODS = Object.freeze(new Set(['apikey.snapshot', 'apikey.setKey', 'apikey.setEnabled', 'apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels']))
const ids = new Set(PROVIDERS.map(p => p.id))
// model.refresh：手动刷新远端模型目录（设置页「刷新目录」与首次进模型分区时调用）。
// 它的 provider 校验沿用现有 ids 逻辑（raccoon-pro 已在 PROVIDERS 内）。
const methods = new Set([...['provider.status', 'provider.setEnabled', 'account.list', 'account.create', 'account.update', 'account.delete', 'account.reorder', 'account.refresh', 'account.retest', 'account.reset', 'login.poll', 'model.list', 'model.refresh', 'model.setDisabled', 'model.clearDead', 'model.setAllDisabled', 'model.resetDefaults', 'model.params', 'model.setParams', 'credits.balances', 'credits.claimAll', 'credits.permanentLock', 'onboarding.status', 'onboarding.claim'], ...PLAN_METHODS, ...WORKBUDDY_METHODS, ...APIKEY_METHODS])

export function guardedRpc(raw) {
  return async (method, payload = {}, signal) => {
    if (!methods.has(method) || !payload || typeof payload !== 'object') throw new Error('不支持此操作')
    if (method === 'provider.status') {
      if (!Array.isArray(payload.providers) || payload.providers.some(id => !ids.has(id))) throw new Error('不支持此渠道')
    } else if (PLAN_METHODS.has(method)) {
      if (payload.provider !== PLAN_PROVIDER_ID) throw new Error('不支持此渠道')
    } else if (WORKBUDDY_METHODS.has(method)) {
      if (payload.provider !== WORKBUDDY_PROVIDER_ID) throw new Error('不支持此渠道')
    } else if (APIKEY_METHODS.has(method)) {
      if (!APIKEY_PROVIDER_IDS.includes(payload.provider)) throw new Error('不支持此渠道')
    } else if (!ids.has(payload.provider)) throw new Error('不支持此渠道')
    signal?.throwIfAborted()
    if (PLAN_METHODS.has(method) || WORKBUDDY_METHODS.has(method) || APIKEY_METHODS.has(method)) {
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
