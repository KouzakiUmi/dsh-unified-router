// vendor channel-pack RPC 的**唯一接线点**。
//
// 为什么需要它：`registerChannelPackRpc` 用位置形参接收各渠道的 auth 实例，
// vendored 源码自己承认「历史上已因少传 / 插队错位复发 6 次」。位置传参本身不改
// （vendored 签名一旦分叉就没人敢同步上游），但本插件只在**这一个文件**里出现位置：
// 调用方一律传具名 `slots` 对象，未接线的渠道由 `undefined` 自动补齐。
//
// 形参顺序住在 `lib/pack-slots.js`（纯数据）：回归用例与实现读同一份，避免
// 「测试跟着实现一起错位」。
import { registerChannelPackRpc } from '../../vendor/channel-pack/src/channel-pack-rpc.js'
import { VENDOR_SLOT_ORDER } from '../../lib/pack-slots.js'

/** 合法形参名。`channel-specs.js` 里每个账号池渠道的 `packSlot` 必须取自这里。 */
export type PackSlot = typeof VENDOR_SLOT_ORDER[number]

/** 已接线渠道 → vendor 形参位的映射（具名传参，不按位置）。 */
export function registerPackRpc(
  ctx: any,
  pool: any,
  slots: Partial<Record<PackSlot, any>>,
  modelAdapters: any,
  config: any,
): void {
  const unknown = Object.keys(slots).filter(slot => !(VENDOR_SLOT_ORDER as readonly string[]).includes(slot))
  if (unknown.length > 0) throw new Error(`channel-pack 接线位不存在：${unknown.join('、')}`)
  const args = (VENDOR_SLOT_ORDER as readonly string[]).map(slot => slots[slot as PackSlot] ?? undefined)
  ;(registerChannelPackRpc as any)(ctx, pool, ...args, modelAdapters, config)
}