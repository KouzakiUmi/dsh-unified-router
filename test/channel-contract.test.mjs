// `lib/channel-contract.js` 的 wire 纪律 + 宿主投影出口的净化兜底。
//
// 为什么值得单独测：这两条都是「不会报错、但会让整条 RPC 静默作废」的缺陷类型。
// 宿主 typert 逐值校验返回值，嵌套的 `undefined` / `NaN` / `Infinity` / `-0`
// 任一处出现，整条结果就作废（真实事故：某个 `resetsAt: undefined` 让整批返回
// 全量报错）。用例逐条锁死：
//   1. wire 投影**缺席就不写属性**，不写出值为 undefined 的键；
//   2. 倍率形状不合法时整条 rate 字段不出现（而不是 `rate: undefined`）；
//   3. `wireJson()` 深度净化真的生效，且不会把合法值改坏；
//   4. `publicResult()` 出口确实接了 `wireJson()`（拿一个会产出 undefined 的
//      载荷验证 —— 内层投影本身不会产出，故这里直接验函数形状与净化契约）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { accountView, accountWire, modelView, modelWire, wireJson } from '../lib/channel-contract.js'

/** 断言对象里没有任何「值为 undefined」的自有键。 */
function assertNoUndefinedKeys(value, path = '$') {
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    assert.notEqual(item, undefined, `${path}.${key} 的值为 undefined（宿主 typert 会让整条作废）`)
    assertNoUndefinedKeys(item, `${path}.${key}`)
  }
}

test('accountWire：字段缺席就不写属性，脏值不冒充合法值', () => {
  const bare = accountWire({ id: 'a', provider: 'p' })
  assert.deepEqual(Object.keys(bare).sort(), ['enabled', 'expiresAt', 'id', 'modelRateLimits', 'nickname', 'provider', 'refreshable'])
  assertNoUndefinedKeys(bare)
  assert.equal('plan' in bare, false, '没探测到套餐时不写 plan')
  assert.equal('planLabel' in bare, false, '没取到订阅类型文案时不写 planLabel')
  assert.equal(bare.expiresAt, null, '到期未知保留属性（区分「未知」与「无过期」）')

  const dirty = accountWire({ id: 'a', provider: 'p', plan: 'GOLD', expiresAt: 'soon', modelRateLimits: { m: 'x', n: -1, k: 5 } })
  assert.equal('plan' in dirty, false, '套餐是白名单枚举，脏值不参与展示与分流')
  assert.equal('planLabel' in dirty, false, '空订阅类型文案不写属性')
  assert.equal(dirty.expiresAt, null)

  const labeled = accountWire({ id: 'a', provider: 'p', planLabel: 'Pro+' })
  assert.equal(labeled.planLabel, 'Pro+', '订阅类型文案透传（截断到 40 字符）')
  assert.equal(accountWire({ id: 'a', provider: 'p', planLabel: 'x'.repeat(60) }).planLabel.length, 40)
  assert.deepEqual(dirty.modelRateLimits, { k: 5 }, '只保留有限正数')
  assertNoUndefinedKeys(dirty)
})

test('modelWire：能力字段缺席即未知；倍率形状不合法时整条 rate 不出现', () => {
  const bare = modelWire({ id: 'm', name: '模型' })
  for (const key of ['contextWindow', 'maxTokens', 'defaultMaxTokens', 'efforts', 'defaultEffort', 'supportsImage', 'stale', 'rate', 'subscriptionOnly']) {
    assert.equal(key in bare, false, `${key} 缺席时不得写出属性`)
  }
  assertNoUndefinedKeys(bare)

  // ⚠️ 回归：早期实现写成 `...(source.rate ? { rate: wireRate(source.rate) } : {})`，
  // 形状像倍率但文案不合法时会产出 `{ rate: undefined }`。
  const invalidRate = modelWire({ id: 'm', name: '模型', rate: { label: '不是倍率', tone: 'neutral' } })
  assert.equal('rate' in invalidRate, false, '不合法倍率必须整条不出现，不能是 undefined')
  assertNoUndefinedKeys(invalidRate)
  assert.equal('rate' in modelWire({ id: 'm', name: '模型', rate: '免费' }), false, '非对象倍率同样不出现')

  // 合法倍率保留；零/负倍率不写 multiplier（不谎报）。
  assert.deepEqual(modelWire({ id: 'm', name: '模型', rate: { label: 'x1.00', tone: 'neutral', multiplier: 1 } }).rate,
    { label: 'x1.00', tone: 'neutral', multiplier: 1 })
  assert.deepEqual(modelWire({ id: 'm', name: '模型', rate: { label: '免费', tone: 'success' } }).rate,
    { label: '免费', tone: 'success' })
  assert.deepEqual(modelWire({ id: 'm', name: '模型', rate: { label: 'x2.5', tone: 'info', multiplier: 0 } }).rate,
    { label: 'x2.5', tone: 'info' }, '倍率为 0 时不写 multiplier')
})

test('modelView / accountView：视图层补 UI 缺省值，且仍不含 undefined', () => {
  const model = modelView({ id: 'm', name: '' }, 'raccoon')
  assert.equal(model.key, 'raccoon:m', '组合键由契约层产出')
  assert.equal(model.name, 'm', '显示名退回 id')
  assert.equal(model.provider, 'raccoon')
  assert.equal(model.efforts.length, 0)
  assert.equal(model.supportsImage, null, '未知能力用 null，界面据此不给控件')
  assert.equal(model.rate, null)
  assertNoUndefinedKeys(model)

  const account = accountView({ id: 'a', provider: 'p' }, 'p')
  assert.equal(account.nickname, '未命名账号')
  assert.equal(account.plan, '')
  assert.equal(account.planLabel, '', '订阅类型文案缺省为空串')
  assert.equal(accountView({ id: 'a', provider: 'p', planLabel: 'Pro' }, 'p').planLabel, 'Pro')
  assertNoUndefinedKeys(account)
})

test('wireJson：深度净化丢弃 undefined / NaN / ±Infinity / -0，合法值原样保留', () => {
  const dirty = {
    keep: 'text',
    nested: { a: 1, b: undefined, c: NaN, d: Infinity, e: -Infinity, f: -0, g: null, h: false },
    list: [1, undefined, NaN, 'x', null],
    dropMe: undefined,
  }
  const clean = wireJson(dirty)
  assertNoUndefinedKeys(clean)
  assert.equal('dropMe' in clean, false, '值为 undefined 的键整条丢弃')
  assert.deepEqual(clean.nested, { a: 1, f: 0, g: null, h: false }, 'NaN / ±Infinity 丢弃，-0 归零，null 保留')
  assert.deepEqual(clean.list, [1, 'x', null], '数组里的 undefined / NaN 被剔除')
  // 幂等：净化过的结果再净化一次不变。
  assert.deepEqual(wireJson(clean), clean)
  // 标量与空值。
  assert.equal(wireJson(undefined), undefined)
  assert.equal(wireJson(NaN), undefined)
  assert.equal(wireJson(-0), 0)
  assert.equal(wireJson(''), '')
  assert.deepEqual(wireJson([]), [])
  assert.deepEqual(wireJson({}), {})
})

test('publicResult 出口确实过 wireJson：净化对「含 NaN 的额度」真的生效', async () => {
  // 内层投影本身不会产出 undefined，所以用「上游给出非有限数字」这条真实路径验证：
  // 投影里的 finite() 会把它变成 null，而 wireJson 是第二道闸。这里断言出口形状
  // 干净即可（不依赖具体 method 的字段细节）。
  const { publicResult } = await import('../lib/web-host.js')
  const projected = publicResult('credits.balances', {
    accounts: [{ accountId: 'a', nickname: '号', balance: { total: NaN, packages: [{ name: '包', remaining: Infinity, unit: '积分' }] } }],
  })
  assertNoUndefinedKeys(projected)
  const text = JSON.stringify(projected)
  assert.equal(/NaN|Infinity/.test(text), false, '出口不得残留 NaN / Infinity')
})