// 自管多账号渠道注册表。
// 新增自管多账号渠道只需在此目录添加渠道 spec 模块并登记到列表，
// 宿主 RPC、快照、签到、任务与推理适配器全部按此表自动装配。
import { codeartsSpec } from './codearts.js'

/**
 * 已停用的渠道。
 *
 * ⚠️ **AStudio 停用**（2026-11-24）：上游无法回报正确积分 —— 积分用尽后仍显示满值，
 * 用户据此以为还有额度却调不动，几乎无法正常使用。**实现文件 `astudio.js` 完整保留**，
 * 恢复时把 import 与列表登记加回来即可。
 *
 * 停用后 `MANAGED_PROVIDER_IDS` 不再含 `astudio`，因此它的 RPC（`managed.*`）会被
 * 白名单拒绝、快照/签到/任务不再装配、客户端卡片隐藏 —— 即「支持已移除」。
 */
export const MANAGED_PROVIDERS = Object.freeze([
  codeartsSpec,
])

export const MANAGED_PROVIDER_IDS = Object.freeze(MANAGED_PROVIDERS.map(spec => spec.id))

export function managedProvider(id) {
  return MANAGED_PROVIDERS.find(spec => spec.id === id)
}
