const registeredProviders = [loomy, raccoon, raccoonPro, qodercn, trae, sensenova, workbuddy, agnes, unisound, astudio, codearts]
export const PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.card !== false)
  .map(provider => provider.pack ? packSettings(provider) : provider))
export const PACK_PROVIDERS = Object.freeze(registeredProviders.filter(provider => provider.pack))
export const PLAN_PROVIDER_ID = sensenova.id
export const RACCOON_FAMILY = Object.freeze(raccoon.family.map(side => side.id))
export const isRaccoonFamily = id => RACCOON_FAMILY.includes(id)
export const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? null
export const modelProvidersOf = id => providerById(id)?.family?.map(side => side.id) ?? [id]
