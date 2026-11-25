// Agnes 设置页视图。渠道差异只剩三件事：端点、工具文案、以及两个能力声明。
//
// freeTier：Agnes 给免费用户一个额度恒为 0 的账户面 —— 界面要说「免费用户
//   （额度读取为 0）」，而不是把 0 当成「读取失败」或「没有额度」；有 API Key
//   余额时优先显示余额，不去提示「未配置控制台会话」。
// preferCreditsWindows：该站同时下发 credits 与 requests 两类窗口，
//   credits 是主口径，requests 窗口不占主位。
export const agnes = apiKeyChannel({
  id: 'agnes',
  title: 'Agnes',
  host: 'api.agnes-ai.cn',
  toolsLabel: '图像生成与编辑',
  toolsMeta: '',
  freeTier: true,
  preferCreditsWindows: true,
})
