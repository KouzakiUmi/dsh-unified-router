// 账号池渠道的**挂载注册表**（从 `lib/channel-specs.js` 派生）。
//
// 为什么要有它：`mountBackend` 过去手写三行挂载 + 一个手写的 slots 字面量
// （`{ qoderCn: qoder.auth, trae: trae.auth, raccoon: raccoon.auth }`）。新增一个
// 账号池渠道要同时改这两个地方，而漏改其中一处不会报错 —— 只是那个渠道的 auth
// 没被 vendor RPC 收到（登录、续期、签到全部静默失效），或它的适配器没进
// `allowedProviders`（模型选择器里整组消失）。
//
// 现在「接入一个账号池渠道」= 在规格表里加一条（含 `packSlot`）+ 在本文件的
// `MOUNTS` 里登记实现。两边不一致会在**加载期**直接抛错，而不是等用户点按钮才发现。
import { VENDOR_SLOTS } from '../../../lib/pack-slots.js'
import { CHANNEL_SPECS } from '../../../lib/channel-specs.js'
import type { ProviderContext } from './context.js'
import type { PackSlot } from './pack-bridge.js'
import { mountQoderCN } from './qodercn.js'
import { mountRaccoon } from './raccoon.js'
import { mountTrae } from './trae.js'

/** 每个挂载模块返回的共同形状（结构类型；各模块按需多带字段）。 */
export interface PackMount {
  auth: unknown
  adapters: Record<string, unknown>
  maintain: () => unknown
  /** 同族第二个模型 provider 的 auth（Raccoon 订阅面）。 */
  subscriptionAuth?: unknown
}

/** 挂载所需的运行时选项（来自 `mountBackend` 的调用方）。 */
export interface PackMountOptions {
  qoderCatalogFile?: string
  isRaccoonUnifiedModels?: () => boolean
}

export interface PackMountEntry {
  /** 该渠道的代表 provider id（第一张模型面）。 */
  id: string
  /** vendor `registerChannelPackRpc` 里承接这个渠道 auth 的形参名。 */
  slot: PackSlot
  mount: (context: ProviderContext, options: PackMountOptions) => PackMount
}

/**
 * 渠道 id → 挂载实现。**只在这里登记实现**，顺序与形参位由规格表决定。
 *
 * 键少了会在加载期抛错（「有规格没实现」）；键多了同样抛错（「有实现没规格」）。
 */
const MOUNTS: Record<string, PackMountEntry['mount']> = {
  qodercn: (context, options) => mountQoderCN(context, options.qoderCatalogFile),
  trae: context => mountTrae(context),
  raccoon: (context, options) => mountRaccoon(context, options.isRaccoonUnifiedModels),
}

/**
 * 已接入的账号池渠道：规格表里**有独立账号池**的那些（`raccoon-pro` 是家族第二张
 * 模型面，共用 Raccoon 的账号池，因此没有独立形参位）。
 */
export const PACK_MOUNTS: readonly PackMountEntry[] = CHANNEL_SPECS
  .filter(spec => spec.kind === 'pack' && spec.registered !== false && spec.accountPool !== false)
  .map(spec => {
    const mount = MOUNTS[spec.id]
    if (typeof mount !== 'function') throw new Error(`账号池渠道 ${spec.id} 在规格表里登记了，但 pack-registry 没有它的挂载实现`)
    const slot = spec.packSlot as PackSlot | undefined
    if (typeof slot !== 'string' || !(VENDOR_SLOTS as readonly string[]).includes(slot)) {
      throw new Error(`账号池渠道 ${spec.id} 的 packSlot 无效：${String(slot)}（必须取自 lib/pack-slots.js）`)
    }
    return { id: spec.id, slot, mount }
  })

// 反向校验：MOUNTS 里多登记的实现同样要报出来（否则那份实现永远没人调用）。
{
  const declared = new Set(PACK_MOUNTS.map(entry => entry.id))
  const orphans = Object.keys(MOUNTS).filter(id => !declared.has(id))
  if (orphans.length > 0) throw new Error(`pack-registry 登记了规格表之外的渠道：${orphans.join('、')}`)
  const slots = PACK_MOUNTS.map(entry => entry.slot)
  if (new Set(slots).size !== slots.length) throw new Error('两个账号池渠道占用了同一个 vendor 形参位')
}