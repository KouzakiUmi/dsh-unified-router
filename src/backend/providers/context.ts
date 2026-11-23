import type { Context } from '@deepseek-ai/cordis'
import type { AccountPool } from '../../../vendor/channel-pack/src/account-pool.js'
import type { ProviderAccountEntry } from '../../../vendor/channel-pack/src/types.js'
import type { makeReadImage, makeReadImageRequest } from '../../backend.js'

export interface ProviderContext {
  ctx: Context
  pool: AccountPool
  noteQuotaAccount?: (provider: string, accountId: string, model?: string) => void
  catalogFile(provider: string): string | undefined
  readImage: ReturnType<typeof makeReadImage>
  readImageRequest: ReturnType<typeof makeReadImageRequest>
  accountForRefresh(provider: string, id?: string): Promise<{ entry: ProviderAccountEntry } | null | undefined>
  throwIfAllAccountsRateLimited(
    product: { id: string; displayName: string },
    modelId?: string,
    entries?: readonly Pick<ProviderAccountEntry, 'enabled' | 'modelRateLimits'>[],
  ): void
}
