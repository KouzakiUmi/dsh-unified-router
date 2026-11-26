/**
 * TRAE 用量帧的缓存计数解析（纯函数，无外部依赖，可单测）。
 *
 * ## 背景：上游自 2026-10-27 起不再如实回填缓存计数
 *
 * 同前缀连发多次，`cache_read_input_tokens` 恒为 0、`cache_creation_input_tokens`
 * 与全部 `*_total` 也是 0，且 `metadata.prompt_cache_pool_record` 恒为 `null`
 * （= 上游明说这次没挂缓存池）；但账单侧同前缀第二次仍便宜约 3 倍
 * （冷 1.75 / 热 0.50 积分），**折扣真实存在、字段确实没报**。
 *
 * 把 0 当成「本次没命中」写进账本，等于替上游编造一次它没做的测量 ——
 * 这正是「缓存命中率恒为 0%」的报障形态。故：
 *
 * - 非 0 计数：恒可信，原样下发；
 * - 0 计数：仅当上游明确挂了缓存池（`prompt_cache_pool_record` 非 null）才下发；
 * - 缺失 / 非法 / 不可信的 0：一律省略，交由消费方按「未知」处理。
 *
 * ⚠️ `cluster` 不能当缓存判据：实测常规档恒为 `normal_context`，没有任何一条
 * 实测把它与缓存状态对上。要用它之前先补探针。
 */

/** `token_usage` 里「缓存读取」的候选字段名（含嵌套路径）。 */
export const TRAE_CACHE_READ_FIELDS: readonly string[] = [
  'cache_read_input_tokens',
  'cacheReadInputTokens',
  'prompt_cache_hit_tokens',
  'cached_tokens',
  'prompt_tokens_details.cached_tokens',
  'input_tokens_details.cached_tokens',
]

/** 缓存写入的同款候选字段（Trae 目前恒为 0，留着是为了字段改名时不丢数）。 */
export const TRAE_CACHE_WRITE_FIELDS: readonly string[] = [
  'cache_creation_input_tokens',
  'cacheCreationInputTokens',
  'cache_write_tokens',
  'prompt_tokens_details.cache_write_tokens',
]

/** 按点号路径取值（`a.b.c`；中途类型不对就当作没有）。 */
function readPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/**
 * 从 `token_usage` 取缓存计数：**原样返回上游给的值（含 0）**，取候选字段里的
 * 最大值（同一个数常被几套命名镜像，也可能被镜像成桩 0）；缺失 / 非法返回
 * `undefined`。
 *
 * ⚠️「0 算不算数」不在这里判断 —— 由 {@link traeCacheUsage} 按
 * `metadata.prompt_cache_pool_record` 决定。
 */
export function traeCacheCount(usage: Record<string, unknown>, fields: readonly string[]): number | undefined {
  let best: number | undefined
  for (const field of fields) {
    const raw = readPath(usage, field)
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue
    const value = Math.trunc(raw)
    if (best === undefined || value > best) best = value
  }
  return best
}

/**
 * 把一次 `token_usage` 归一成「可下发的缓存计数」。
 *
 * 只在**有值且可信**时返回该字段：非 0 恒可信；0 仅在上游明确挂了缓存池
 * （`cachePoolAssigned`）时可信。缺失 / 非法 / 不可信的 0 一律省略 ——
 * 让消费方按「未知」处理，而不是替上游编造一次 0% 未命中。
 */
export function traeCacheUsage(
  usage: Record<string, unknown>,
  cachePoolAssigned: boolean,
): { read?: number; write?: number } {
  const read = traeCacheCount(usage, TRAE_CACHE_READ_FIELDS)
  const write = traeCacheCount(usage, TRAE_CACHE_WRITE_FIELDS)
  const readKnown = read !== undefined && (read > 0 || cachePoolAssigned)
  const writeKnown = write !== undefined && (write > 0 || cachePoolAssigned)
  return {
    ...(readKnown && read !== undefined ? { read } : {}),
    ...(writeKnown && write !== undefined ? { write } : {}),
  }
}