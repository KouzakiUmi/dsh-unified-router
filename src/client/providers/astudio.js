export const astudio = managedChannel({
  id: 'astudio',
  title: 'AStudio',
  // ⚠️ 已停用（2026-11-24）：上游无法回报正确积分——积分用尽后仍显示满值，
  // 用户以为还有额度却调不动。`card: false` 让卡片从设置页消失；声明保留，
  // 与后端 `lib/managed-providers/index.js` 的停用说明对应，恢复时一起改回。
  card: false,
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴 modelBearerToken（JWT）或 astron-session.json 内容',
  checkin: true,
  claimRewards: true,
  extraCaps: {
    // AStudio 的窗口没有可算的百分比：上游只给剩余量与一段展示文本，
    // 强行算 fraction 会画出错误的进度条，所以不画、不占主位、也不显示重置时刻。
    quotaWindow: { noFraction: true, resetKind: 'none' },
    // 该渠道的额度以「窗口列表」本身就是积分包（没有独立的 packages 数组）。
    quotaAccount: { windowsAsCredits: true },
  },
})
