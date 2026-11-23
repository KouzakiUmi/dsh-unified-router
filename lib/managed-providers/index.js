// 自管多账号渠道注册表（AStudio、CodeArts）。
// 新增自管多账号渠道只需在此目录添加渠道 spec 模块并登记到列表，
// 宿主 RPC、快照、签到、任务与推理适配器全部按此表自动装配。
import { astudioSpec } from './astudio.js'
import { codeartsSpec } from './codearts.js'

export const MANAGED_PROVIDERS = Object.freeze([
  astudioSpec,
  codeartsSpec,
])

export const MANAGED_PROVIDER_IDS = Object.freeze(MANAGED_PROVIDERS.map(spec => spec.id))

export function managedProvider(id) {
  return MANAGED_PROVIDERS.find(spec => spec.id === id)
}
