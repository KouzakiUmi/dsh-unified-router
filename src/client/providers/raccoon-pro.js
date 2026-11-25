// Raccoon 订阅版（`raccoon-pro`）provider 模块：**不是一张卡片**（`card: false`）。
//
// 它只作为 Raccoon 家族卡的**订阅模型面**存在：provider.status 轮询、模型目录、
// 模型启停与参数写入仍走这个 provider id（主机侧独立适配器），而账号池共用
// 家族卡那一张（`raccoon`，按账号套餐自动分流）。
//
// 因此模型数、状态、账号行都由家族卡的合并渲染负责；本模块只保留身份与能力声明，
// 避免「模型层拆分」被误解成「UI 也要拆成两张卡」。
export const raccoonPro = {
  id: 'raccoon-pro',
  title: 'Raccoon 订阅版',
  pack: true,
  // 不作为渠道卡片渲染（登录、账号池、模型分区都归家族卡）。
  card: false,
  caps: {
    onboarding: true,
    permanentLock: false,
    // 家族里本侧代表订阅面：账号按 plan 取 `pro`。与 `raccoon` 的 `free` 对称。
    familySide: 'pro',
    permanentPackageNames: ['奖励积分'],
  },
}
