import { AsyncLocalStorage } from 'node:async_hooks'

const fields = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const keyOf = ({ sessionId, provider, model }) => JSON.stringify([sessionId, provider, model])
const valid = value => fields(value?.sessionId) && fields(value.provider) && fields(value.model)
const QUIET = new Set(['compaction', 'session-title'])

export function createQuotaCallAccounts(providers) {
  const scope = new AsyncLocalStorage()
  const rows = new Map()
  // 智能路由「缓存优先」的全局记录：provider\u0000model → 最近实际服务的前台账号。
  // 只在 track 作用域内的 note 才写入（后台用途如 session-title 不参与粘滞）。
  const lastRows = new Map()
  return {
    track(options, next) {
      if (!valid(options) || !providers.has(options.provider) || QUIET.has(options.purpose)) return next()
      const key = keyOf(options)
      const attempt = { provider: options.provider, model: options.model, accountId: null, live: true }
      return (async function* () {
        rows.delete(key)
        rows.set(key, attempt)
        if (rows.size > 512) rows.delete(rows.keys().next().value)
        let iterator, completed = false
        try {
          const upstream = await scope.run(attempt, next)
          iterator = scope.run(attempt, () => upstream[Symbol.asyncIterator]())
          for (;;) {
            const step = await scope.run(attempt, () => iterator.next())
            if (step.done) { completed = true; return }
            yield step.value
          }
        } finally {
          attempt.live = false
          if (!completed && iterator?.return) await scope.run(attempt, () => iterator.return())
        }
      })()
    },
    note(provider, accountId, model) {
      const attempt = scope.getStore()
      if (!attempt?.live || attempt.provider !== provider || (model !== undefined && model !== attempt.model)) return
      if (fields(accountId)) {
        attempt.accountId = accountId
        lastRows.set(`${provider}\u0000${attempt.model}`, accountId)
        if (lastRows.size > 512) lastRows.delete(lastRows.keys().next().value)
      } else attempt.accountId = null
    },
    read(payload) {
      if (!valid(payload) || !providers.has(payload.provider)) return null
      const row = rows.get(keyOf(payload))
      return row?.accountId ? { accountId: row.accountId, live: row.live } : null
    },
    /** 缓存优先（粘滞）：某模型最近实际服务的前台账号；无记录返回 null。 */
    lastFor(provider, model) {
      if (!fields(provider) || !fields(model) || !providers.has(provider)) return null
      return lastRows.get(`${provider}\u0000${model}`) ?? null
    },
    clear() { rows.clear() },
  }
}
