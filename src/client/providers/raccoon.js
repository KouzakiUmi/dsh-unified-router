export const raccoon = {
  id: 'raccoon',
  title: 'Raccoon',
  pack: true,
  family: [
    { id: 'raccoon', title: '免费模型' },
    { id: 'raccoon-pro', title: '订阅模型' },
  ],
  // 两个能力位是**不同维度**，不要合并：
  // - `dailyReward`：有没有「一键领取每日额度」（`credits.claimAll`）——raccoon 没有，
  //   该端点对它不适用（登录奖励走 `onboarding.claim`）；
  // - `autoCheckin`：有没有「自动每日签到」（`automation` 的 checkin 任务）——有。
  //   上游没有专门的签到端点，由 `raccoon.checkin` 以一次带桌面端头的只读
  //   `setting_info` 触发当日积分发放。
  caps: { accountPlan: true, onboarding: true, rewardLabel: '领登录奖励', unifiedModels: true, dailyReward: false, autoCheckin: true },
}
