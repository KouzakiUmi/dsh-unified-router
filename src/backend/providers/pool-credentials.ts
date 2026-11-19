import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { reportLedgerAccount } from '../../../vendor/channel-pack/src/token-ledger.js'
import type { AccountPool } from '../../../vendor/channel-pack/src/account-pool.js'
import type { ProviderContext } from './context.js'

interface PoolAuth {
  refresh(): Promise<unknown>
  refreshAccountCredential(ref: string, pool: AccountPool, id: string): Promise<unknown>
}

export function pooledCredentials<T>(
  { ctx, pool, accountForRefresh, throwIfAllAccountsRateLimited }: ProviderContext,
  product: { id: string; displayName: string; defaultCredentialRef: string },
  auth: PoolAuth,
  onAccount?: (id?: string) => void,
) {
  const ref = credentialRef(product.defaultCredentialRef)
  return {
    credentialRef: ref,
    async resolveCredential(modelId?: string): Promise<T | undefined> {
      const available = await pool.getAvailableAccount(product.id, modelId ?? '')
      onAccount?.(available?.entry.id)
      if (available) {
        reportLedgerAccount(product.id, available.entry.id)
        return available.credential as T
      }
      throwIfAllAccountsRateLimited(product, modelId)
      const resolved = await ctx.credentials.resolve(ref)
      if (!resolved) return undefined
      try { return JSON.parse(resolved.value) as T } catch { return undefined }
    },
    async refresh(accountId?: string) {
      const available = await accountForRefresh(product.id, accountId)
      if (available) await auth.refreshAccountCredential(available.entry.credentialRef, pool, available.entry.id)
      else await auth.refresh()
    },
  }
}
