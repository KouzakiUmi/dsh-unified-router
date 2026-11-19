// Loomy（讯飞办公助手）provider 模块：走 channel-pack 通用账号池面板。
// 渠道专有能力：新手任务奖励（onboarding.claim）、永久积分锁定（Loomy 专有）。
export const loomy = {
  id: 'loomy',
  title: 'Loomy',
  // channel-pack 通用渠道：账号池 + 模型目录 + 渠道开关。
  pack: true,
  caps: {
    // 新手任务 / 登录奖励：onboarding.claim 只接受 loomy 与 raccoon。
    onboarding: true,
    // 永久积分锁定：Loomy 专有。
    permanentLock: true,
  },
}
