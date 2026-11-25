// 按类型排布：Agent（账号池 + 自管多账号）在前，API（单 Key / Token Plan）在后。
const registeredProviders = [
  raccoon, raccoonPro, qodercn, trae, workbuddy, astudio, codearts,
  sensenova, agnes, unisound, qianfan, bailian, stepfun,
]
export const PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.card !== false)
  .map(provider => provider.pack ? packSettings(provider) : provider))
const AGENT_KINDS = new Set(['pack', 'workbuddy', 'managed'])
export const PROVIDER_GROUPS = Object.freeze([
  { id: 'agent', title: 'Agent', providers: Object.freeze(PROVIDERS.filter(p => AGENT_KINDS.has(channelSpec(p.id)?.kind))) },
  { id: 'api', title: 'API', providers: Object.freeze(PROVIDERS.filter(p => !AGENT_KINDS.has(channelSpec(p.id)?.kind))) },
].filter(group => group.providers.length > 0))
export const PACK_PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.pack))
export const PLAN_PROVIDER_ID = sensenova.id
export const RACCOON_FAMILY = Object.freeze(raccoon.family.map(side => side.id))
export const isRaccoonFamily = id => RACCOON_FAMILY.includes(id)
export const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? null
/**
 * 按 id 查**全部已注册**渠道（含 `card: false` 的、不作为卡片渲染的那些）。
 *
 * `providerById` 只查带卡片的 `PROVIDERS`，所以 `raccoon-pro` 这类家族成员查不到；
 * 需要读它的标题或能力声明时用本函数。注意返回的是渠道原始声明（未经 `packSettings`
 * 包装），只适合读身份与 `caps`。
 */
export const registeredById = id => registeredProviders.find(provider => provider.id === id) ?? null
export const modelProvidersOf = id => providerById(id)?.family?.map(side => side.id) ?? [id]
