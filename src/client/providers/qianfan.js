export const qianfan = apiKeyChannel({
  id: 'qianfan',
  title: '千帆 Token Plan',
  host: 'qianfan.baidubce.com',
  consoleMeta: '用于读取千帆 Token Plan 个人版月度额度',
  consoleFormHint: '粘贴 console.bce.baidu.com 的 Cookie（含 BDUSS）或 cURL',
  consoleFormGuide: '登录千帆控制台后，复制 tokenPlanPersonal/resource 请求的 Cookie 头或整段 cURL（需含 BDUSS）粘贴。',
})
