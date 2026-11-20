export const codearts = managedChannel({
  id: 'codearts',
  title: 'CodeArts',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkin: true,
  claimRewards: true,
})
