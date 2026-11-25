// vendor `registerChannelPackRpc` 的**位置形参顺序**（纯数据）。
//
// 这里单独一份而不是写在 `src/backend/pack-bridge.ts` 里，是为了让**回归用例**
// 也能读到它：桥接表少传/多传一位的后果是把后面的 `modelAdapters` / `config` 顶到
// 错误的形参上（实测：`nativeOnly` 丢失、HTTP RPC 被错误装配），而那种错误在
// 类型层面往往看不出来。用例与实现共用同一份，才不会「测试跟着实现一起错」。
//
// ⚠️ 升级 vendor 时**先核对这一行**：数量与顺序都必须与 `channel-pack-rpc.ts` 的
// `registerChannelPackRpc` 签名逐位对齐。
export const VENDOR_SLOT_ORDER = Object.freeze([
  'qoder', 'qoderCn', 'trae', 'raccoon',
])

/** 合法形参名（供规格表与注册表校验）。 */
export const VENDOR_SLOTS = VENDOR_SLOT_ORDER