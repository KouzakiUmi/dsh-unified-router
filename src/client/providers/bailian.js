export const bailian = apiKeyChannel({
  id: 'bailian',
  title: '阿里云百炼',
  host: 'token-plan.cn-beijing.maas.aliyuncs.com',
  consoleMeta: '用于读取百炼 Token Plan 个人版周期额度（支持阿里云 AK/SK 或 Cookie）',
  consoleFormHint: '粘贴 AccessKeyId:AccessKeySecret，或百炼控制台 Cookie / cURL',
  consoleFormGuide: '手机/无桌面推荐粘贴阿里云 RAM 子账号的 AccessKeyId:AccessKeySecret（长期有效），也可粘贴 bailian.console.aliyun.com 的 Cookie 或 cURL。',
})
