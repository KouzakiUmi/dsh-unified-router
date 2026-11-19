import { TraeAuth } from '../../../vendor/channel-pack/src/trae-auth.js'
import { TRAE } from '../../../vendor/channel-pack/src/trae-product.js'
import { registerTraeLlm } from '../../../vendor/channel-pack/src/trae-adapter.js'
import { type TraeCredential } from '../../../vendor/channel-pack/src/trae.js'
import type { ProviderContext } from './context.js'
import { pooledCredentials } from './pool-credentials.js'

export function mountTrae(context: ProviderContext) {
  const { ctx, pool, readImage } = context
  const trae = new TraeAuth(ctx)
  const traeAdapter = registerTraeLlm(ctx, {
    ...pooledCredentials<TraeCredential>(context, TRAE, trae),
    catalogFile: context.catalogFile(TRAE.id),
    fetchRemoteModels: force => trae.fetchModels(pool, force),
    // 图片字节桥接：TRAE 上游支持图片（模态按模型判定），这里只负责读字节。
    readImage,
    accountPool: pool,
    product: TRAE,
  })

  return { auth: trae, adapters: { [TRAE.id]: traeAdapter }, maintain: () => trae.refreshAll(pool) }
}
