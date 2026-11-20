export const coze = managedChannel({
  id: 'coze',
  title: 'Coze',
  authMethods: ['local', 'credential'],
  credentialHint: '粘贴 Coze 桌面端 PAT（cztei_…）、coze-bridge modelToken 或 JSON 凭据',
  checkin: false,
  claimRewards: true,
})
