// TRAE 用量帧的缓存计数解析（纯函数）。
// 上游自 2026-10-27 起不再如实回填缓存计数（恒 0 且 metadata 说没挂缓存池），
// 把 0 当「本次没命中」会让命中率恒为 0% —— 这里锁定「未知不计零」的口径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { traeCacheCount, traeCacheUsage, TRAE_CACHE_READ_FIELDS, TRAE_CACHE_WRITE_FIELDS } from '../vendor/channel-pack/src/trae-cache.ts'

test('三套命名都认：Anthropic / OpenAI / DeepSeek 口径取首个有值的', () => {
  assert.equal(traeCacheCount({ cache_read_input_tokens: 4224 }, TRAE_CACHE_READ_FIELDS), 4224)
  assert.equal(traeCacheCount({ prompt_tokens_details: { cached_tokens: 2688 } }, TRAE_CACHE_READ_FIELDS), 2688)
  assert.equal(traeCacheCount({ input_tokens_details: { cached_tokens: 100 } }, TRAE_CACHE_READ_FIELDS), 100)
  assert.equal(traeCacheCount({ prompt_cache_hit_tokens: 512 }, TRAE_CACHE_READ_FIELDS), 512)
  assert.equal(traeCacheCount({ cacheReadInputTokens: 64 }, TRAE_CACHE_READ_FIELDS), 64)
  assert.equal(traeCacheCount({ cached_tokens: 32 }, TRAE_CACHE_READ_FIELDS), 32)
})

test('多套命名镜像时取最大值（桩 0 不会盖掉真实值）', () => {
  const usage = {
    cache_read_input_tokens: 0,
    prompt_cache_hit_tokens: 4224,
    prompt_tokens_details: { cached_tokens: 4224 },
  }
  assert.equal(traeCacheCount(usage, TRAE_CACHE_READ_FIELDS), 4224)
})

test('缺失 / 非法值返回 undefined（不编造 0）', () => {
  assert.equal(traeCacheCount({}, TRAE_CACHE_READ_FIELDS), undefined)
  assert.equal(traeCacheCount({ cache_read_input_tokens: -1 }, TRAE_CACHE_READ_FIELDS), undefined)
  assert.equal(traeCacheCount({ cache_read_input_tokens: Number.NaN }, TRAE_CACHE_READ_FIELDS), undefined)
  assert.equal(traeCacheCount({ cache_read_input_tokens: '123' }, TRAE_CACHE_READ_FIELDS), undefined)
  assert.equal(traeCacheCount({ prompt_tokens_details: null }, TRAE_CACHE_READ_FIELDS), undefined)
})

test('非零计数恒可信：即使上游没说挂池也照常下发', () => {
  assert.deepEqual(traeCacheUsage({ cache_read_input_tokens: 4224 }, false), { read: 4224 })
})

test('上游没挂缓存池（poolRecord=null）时，0 按未知处理', () => {
  // 现场形态：同前缀连发，计数恒 0、metadata 说没挂池
  assert.deepEqual(traeCacheUsage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, false), {})
  assert.deepEqual(traeCacheUsage({ prompt_tokens: 18955, completion_tokens: 12 }, false), {})
})

test('上游明确挂了缓存池时，0 是可信的「本次没命中」', () => {
  assert.deepEqual(
    traeCacheUsage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, true),
    { read: 0, write: 0 },
  )
})

test('缓存写入沿用同一口径（非 0 恒可信，0 看池记录）', () => {
  assert.deepEqual(traeCacheUsage({ cache_creation_input_tokens: 128 }, false), { write: 128 })
  assert.deepEqual(traeCacheUsage({ cache_creation_input_tokens: 0 }, false), {})
  assert.deepEqual(traeCacheUsage({ cache_creation_input_tokens: 0 }, true), { write: 0 })
  assert.equal(traeCacheCount({ cache_creation_input_tokens: 77 }, TRAE_CACHE_WRITE_FIELDS), 77)
})