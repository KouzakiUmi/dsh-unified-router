export const coze = managedChannel({
  id: 'coze',
  title: 'Coze',
  authMethods: ['local', 'credential'],
  accountLinks: [{ label: '打开 Coze 官网', href: 'https://www.coze.cn/home' }],
  credentialHint: '粘贴 Coze 桌面端 PAT（cztei_…）、Cookie、coze-bridge modelToken 或 JSON 凭据',
  checkin: false,
  claimRewards: true,
})
