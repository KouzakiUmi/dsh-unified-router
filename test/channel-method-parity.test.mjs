// 客户端与宿主的**方法集一致性**（防漂移）。
//
// 背景：方法清单曾经在宿主 `lib/rpc.js` 与客户端 `core.js` 各写一遍。加渠道或改端点
// 名时漏改一侧的表现是「按钮点了报『不支持此操作』」或「界面能点、后端拒绝」，
// 而两处各自都能单测通过 —— 只有把两份放在一起比对才拦得住。
//
// 现在客户端由 `lib/channel-specs.js` 的 `clientMethodSets()` 派生，本用例锁死：
//   1. 客户端声明的每个方法，宿主都必须接受（否则就是死按钮）；
//   2. 宿主只比客户端多**明确登记的**宿主内部端点（挡住「新端点忘了接进界面」）；
//   3. 各分类集合与规格表逐项一致（挡住「又手写一份」）；
//   4. 规格表自身自洽（专属方法唯一归属、类别前缀不串）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHANNEL_SPECS, GLOBAL_METHODS, HOST_INTERNAL_METHODS, INVALIDATE_RULES, KIND_METHODS, RETIRED_CHANNEL_IDS,
  allChannelMethods, clientMethodSets, invalidationRule, methodsOfKind,
} from '../lib/channel-specs.js'

/** 客户端可能发起的全部方法（各个分类集合的并集）。 */
function clientUnion(sets = clientMethodSets()) {
  return new Set([...sets.all, ...sets.plan, ...sets.workbuddy, ...sets.apikey, ...sets.managed, ...sets.automation])
}

test('客户端方法集全部落在宿主白名单内：不存在「界面能点、宿主拒绝」的死按钮', () => {
  const host = allChannelMethods()
  const unknown = [...clientUnion()].filter(method => !host.has(method))
  assert.deepEqual(unknown, [], '客户端声明了宿主不认识的方法')
})

test('宿主只比客户端多 HOST_INTERNAL_METHODS：新增端点时必须显式决定要不要开放给界面', () => {
  const host = allChannelMethods()
  const client = clientUnion()
  const hostOnly = [...host].filter(method => !client.has(method)).sort()
  assert.deepEqual(hostOnly, [...HOST_INTERNAL_METHODS].sort(),
    '宿主多出来的方法必须正好是登记的宿主内部端点；否则说明有新端点没接进客户端白名单')
  // 这些端点都必须真是宿主调度独占的：客户端既不声明，也不经由 provider.rpcMethods 声明。
  for (const method of HOST_INTERNAL_METHODS) {
    assert.ok(host.has(method), `${method} 必须仍在宿主白名单里`)
    assert.equal(client.has(method), false, `${method} 不该出现在客户端白名单里`)
  }
})

test('各分类集合与规格表逐项一致（挡住「又手写一份」）', () => {
  const sets = clientMethodSets()
  const omit = new Set(HOST_INTERNAL_METHODS)
  const expected = kind => [...new Set([...methodsOfKind(kind).read, ...methodsOfKind(kind).write])]
    .filter(method => !omit.has(method)).sort()

  assert.deepEqual([...sets.plan].sort(), expected('plan'), 'plan 类别的方法集漂移')
  assert.deepEqual([...sets.workbuddy].sort(), expected('workbuddy'), 'workbuddy 类别的方法集漂移')
  assert.deepEqual([...sets.apikey].sort(), expected('apikey'), 'apikey 类别的方法集漂移')
  assert.deepEqual([...sets.managed].sort(), expected('managed'), 'managed 类别的方法集漂移')
  assert.deepEqual([...sets.automation].sort(),
    GLOBAL_METHODS.filter(method => method.startsWith('automation.')).sort(), 'automation 方法集漂移')

  // `all` = pack 类别（收窄后）+ 全局方法 + 单 Key 订阅类别。
  const allExpected = new Set([...expected('pack'), ...GLOBAL_METHODS, ...expected('plan')])
  assert.deepEqual([...sets.all].sort(), [...allExpected].sort(), '客户端主白名单漂移')
})

test('规格表自洽：每个渠道的专属方法都被宿主白名单收录且只归属一个渠道', () => {
  const host = allChannelMethods()
  const owners = new Map()
  for (const spec of CHANNEL_SPECS) {
    for (const method of spec.methods?.extra ?? []) {
      assert.ok(host.has(method), `渠道 ${spec.id} 的专属方法 ${method} 没进宿主白名单`)
      assert.equal(owners.has(method), false, `专属方法 ${method} 被 ${owners.get(method)} 与 ${spec.id} 同时声明`)
      owners.set(method, spec.id)
    }
    if (spec.registered === false) continue
    const kindMethods = new Set([...methodsOfKind(spec.kind).read, ...methodsOfKind(spec.kind).write])
    for (const method of spec.methods?.write ?? []) {
      assert.ok(kindMethods.has(method), `渠道 ${spec.id} 声明了 ${spec.kind} 类别之外的方法 ${method}`)
    }
  }
})

test('KIND_METHODS 的方法都归属于它自己的类别前缀', () => {
  // 挡住「把某类别的方法写进另一个类别的表」这类手误：它不会报错，只会让宿主
  // 按错误的类别做渠道校验（例如把 managed.* 当成账号池方法）。
  const OWN_PREFIX = { plan: 'plan.', workbuddy: 'workbuddy.', apikey: 'apikey.', managed: 'managed.' }
  for (const [kind, group] of Object.entries(KIND_METHODS)) {
    for (const method of [...group.read, ...group.write]) {
      if (!OWN_PREFIX[kind]) {
        assert.equal(/^(plan|workbuddy|apikey|managed|automation)\./.test(method), false,
          `pack 类别里混进了别的类别的方法：${method}`)
        continue
      }
      assert.ok(method.startsWith(OWN_PREFIX[kind]), `${kind} 类别里混进了别的方法：${method}`)
    }
  }
})

test('退役渠道不得同时留在规格表里（否则会一边注册、一边被清扫）', () => {
  const registered = new Set(CHANNEL_SPECS.map(spec => spec.id))
  assert.deepEqual(RETIRED_CHANNEL_IDS.filter(id => registered.has(id)), [],
    '退役渠道仍在规格表里：宿主会注册它，同时启动清扫又会删它的账号')
})

test('每个写方法都有失效归属：不存在「写了但界面不刷新」的静默缺口', () => {
  // 写操作的失效来源有两处：
  //   1. 类别级处理器（plan / apikey / managed / workbuddy / automation 各有自己的补丁逻辑）；
  //   2. 通用规则表 `INVALIDATE_RULES`（账号池的账号 / 模型 / 额度）。
  // 新加一个写方法却两边都没登记，表现是「操作成功但界面还是旧状态」——不报错，
  // 只能靠这条覆盖率断言发现。
  const kindHandled = new Set([
    ...methodsOfKind('plan').write,
    ...methodsOfKind('apikey').write,
    ...methodsOfKind('managed').write,
    ...methodsOfKind('workbuddy').write,
    ...GLOBAL_METHODS.filter(method => method.startsWith('automation.')),
  ])
  const ruleHandled = new Set(INVALIDATE_RULES.flatMap(rule => rule.methods))

  const uncovered = []
  for (const spec of CHANNEL_SPECS) {
    const writes = [...methodsOfKind(spec.kind).write, ...(spec.methods?.write ?? [])]
    for (const method of writes) {
      if (kindHandled.has(method) || ruleHandled.has(method)) continue
      uncovered.push(`${spec.id}: ${method}`)
    }
  }
  assert.deepEqual(uncovered, [], '这些写方法既没有类别处理器、也不在 INVALIDATE_RULES 里')
})

test('失效规则本身自洽：资源名合法、不重复、不吞掉只有读语义的方法', () => {
  const RESOURCES = new Set(['provider.status', 'account.list', 'model.list', 'model.params', 'credits.balances'])
  const seen = new Map()
  for (const rule of INVALIDATE_RULES) {
    assert.ok(rule.id && typeof rule.id === 'string', '规则必须有 id')
    assert.ok(rule.methods.length > 0, `${rule.id} 没有任何方法`)
    assert.ok(rule.resources.length > 0, `${rule.id} 没有任何资源`)
    for (const resource of rule.resources) assert.ok(RESOURCES.has(resource), `${rule.id} 声明了未采集的资源 ${resource}`)
    for (const method of rule.methods) {
      assert.equal(seen.has(method), false, `${method} 同时属于 ${seen.get(method)} 与 ${rule.id}`)
      seen.set(method, rule.id)
    }
  }
  // `credits.status` / `onboarding.status` 是**只读**核实端点：写进失效规则只会每次
  // 轮询都触发一次无意义的重采集。注意 `raccoon.checkin` 同属宿主内部端点，但它是
  // **写**（会改积分余额），因此必须有失效规则 ——「内部」不等于「只读」。
  for (const readOnly of HOST_INTERNAL_METHODS.filter(method => method.endsWith('.status'))) {
    assert.equal(invalidationRule(readOnly), null, `${readOnly} 是只读端点，不该有失效规则`)
  }
  assert.notEqual(invalidationRule('raccoon.checkin'), null, 'raccoon.checkin 是写操作，必须有失效规则')
  // 抽查两条最关键的行为：登录轮询只在成功时算写操作；签到/领取只刷额度。
  assert.equal(invalidationRule('login.poll').whenSuccess, true)
  assert.deepEqual([...invalidationRule('raccoon.checkin').resources], ['credits.balances'])
  assert.deepEqual([...invalidationRule('account.delete').resources].sort(),
    ['account.list', 'credits.balances', 'provider.status'])
})

test('账号池渠道的 vendor 形参位：规格表登记的必须真实存在、且不重复', async () => {
  // 形参位错/漏的后果是把后面的 modelAdapters / config 顶到错误的形参上，类型层面
  // 看不出来。形参顺序住在 lib/pack-slots.js（实现与用例共用同一份）。
  const { VENDOR_SLOTS } = await import('../lib/pack-slots.js')
  const poolSpecs = CHANNEL_SPECS.filter(spec => spec.kind === 'pack' && spec.registered !== false && spec.accountPool !== false)
  assert.ok(poolSpecs.length > 0, '至少要有一个账号池渠道')
  for (const spec of poolSpecs) {
    assert.ok(typeof spec.packSlot === 'string', `${spec.id} 没有登记 packSlot`)
    assert.ok(VENDOR_SLOTS.includes(spec.packSlot), `${spec.id} 的 packSlot 不在 vendor 签名里：${spec.packSlot}`)
  }
  // 共用账号池的第二张模型面（raccoon-pro）不得再占一个形参位。
  const withPool = poolSpecs.map(spec => spec.packSlot)
  assert.deepEqual([...new Set(withPool)].sort(), [...withPool].sort(), '两个账号池渠道占用了同一个 vendor 形参位')
  const faces = CHANNEL_SPECS.filter(spec => spec.kind === 'pack' && spec.accountPool === false)
  assert.ok(faces.every(spec => spec.packSlot === undefined), '共用账号池的模型面不该登记形参位')
})
