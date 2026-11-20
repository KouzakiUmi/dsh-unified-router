export const astudio = managedChannel({
  id: 'astudio',
  title: 'AStudio',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴 modelBearerToken（JWT）或 astron-session.json 内容',
  checkin: true,
  claimRewards: true,
})
