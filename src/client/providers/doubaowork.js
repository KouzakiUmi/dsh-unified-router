export const doubaowork = managedChannel({
  id: 'doubaowork',
  title: '豆包工作',
  authMethods: ['browser', 'credential'],
  credentialHint: '粘贴含 sessionid / sessionid_ss 的豆包 Cookie 字符串',
  checkin: false,
  claimRewards: false,
  completeTasks: true,
})
