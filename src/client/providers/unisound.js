export const unisound = apiKeyChannel({
  id: 'unisound',
  title: '云知声',
  host: 'maas-api.unisound.com',
  consoleMeta: '用于读取控制台额度（U Plan 积分 / 按量余额）',
  consoleFormHint: '粘贴 maas.unisound.com 的 Cookie（含 JSESSIONID）或 cURL',
  consoleFormGuide: '登录 maas.unisound.com 后，复制任意 /manager/ 请求的 Cookie 头或整段 cURL（需含 JSESSIONID）粘贴。',
})
