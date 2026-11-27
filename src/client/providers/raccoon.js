export const raccoon = {
  id: 'raccoon',
  title: 'Raccoon',
  pack: true,
  family: [
    { id: 'raccoon', title: '体验模型' },
    { id: 'raccoon-pro', title: '订阅模型' },
  ],
  // 两个能力位是**不同维度**，不要合并：
  // - `dailyReward`：有没有「一键领取每日额度」（`credits.claimAll`）——raccoon 没有，
  //   该端点对它不适用（登录奖励走 `onboarding.claim`）；
  // - `autoCheckin`：有没有「自动每日签到」（`automation` 的 checkin 任务）——有。
  //   上游没有专门的签到端点，由 `raccoon.checkin` 以一次带桌面端头的只读
  //   `setting_info` 触发当日积分发放。
  // 额度药丸要多读一份自动化配置：统一模型开关决定药丸显示全部账号还是按套餐分侧。
  // 领取结果里带 actionRequired 时给的提示文案；「奖励积分」这类包算永久积分。
  // `familySide` 声明本 provider 代表家族的哪一侧（账号按 plan 分流用）。
  caps: {
    accountPlan: true, onboarding: true, rewardLabel: '领登录奖励',
    unifiedModels: true, dailyReward: false, autoCheckin: true,
    familySide: 'free',
    quotaExtraResources: ['automation.status'],
    permanentPackageNames: ['奖励积分'],
    // 全局「向 subusage 推送额度」开关只在本卡渲染（家族卡是设置页第一张）。
    quotaIngestToggle: true,
  },
}
