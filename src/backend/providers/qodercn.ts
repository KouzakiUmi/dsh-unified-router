import { QoderAuth } from '../../../vendor/channel-pack/src/qoder-auth.js'
import { QODER_CN } from '../../../vendor/channel-pack/src/qoder-product.js'
import { registerQoderLlm } from '../../../vendor/channel-pack/src/qoder-adapter.js'
import { type QoderCredential } from '../../../vendor/channel-pack/src/qoder.js'
import type { ProviderContext } from './context.js'
import { pooledCredentials } from './pool-credentials.js'

export function mountQoderCN(context: ProviderContext, cliCatalogFile?: string) {
  const { ctx, pool, readImage, readImageRequest } = context
  let currentAccountId: string | undefined
  const qoderCn = new QoderAuth(ctx, { product: QODER_CN })
  const qoderCnAdapter = registerQoderLlm(ctx, {
    ...pooledCredentials<QoderCredential>(context, QODER_CN, qoderCn, id => { currentAccountId = id }),
    readImage,
    // 同 QODER：两站共用同一个适配器类，缩放桥接也必须两边都接
    //（只接一边会让中国版的截图照样撞 57 MiB）。
    readImageRequest,
    accountPool: pool,
    product: QODER_CN,
    cliCatalogFile,
    // 额度受限时用它标记「当前账号」（见 `QoderAdapter.switchAccountOnQuota`）。
    // ⚠️ 取「**本次实际使用**的账号」而非池里默认那一个：池的默认账号可能与之
    // 不同（例如本账号被限流、池已切到别的账号），标错就会让标记落在无辜账号上。
    currentAccountId: () => currentAccountId,
    queueAccountIdForCredential: async credential => {
      const id = await pool.findAccountIdByCredential(QODER_CN.id, credential.access_token)
      return id.length > 0 ? id : undefined
    },
    onQueueAccountSwitch: () => {
      ctx.logger?.info?.(`[channel-pack] ${QODER_CN.displayName} 排队时已尝试切换账号`)
    },
    onQueueRotationFailure: reason => {
      ctx.logger?.warn?.(`[channel-pack] ${QODER_CN.displayName} 排队换号失败，将继续等待并重试`)
      if (reason !== undefined) ctx.logger?.debug?.(`[channel-pack] ${QODER_CN.id} queue rotation detail: ${String(reason)}`)
    },
  })

  return { auth: qoderCn, adapters: { [QODER_CN.id]: qoderCnAdapter }, maintain: () => qoderCn.refreshAll(pool) }
}
