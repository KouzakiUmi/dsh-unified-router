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
})
