// TRAE（字节 TRAE IDE，中国版）provider 模块：走 channel-pack 通用账号池面板。
// 浏览器 OAuth 登录（本机回调）、每日签到领取（credits.claimAll）、余额查询。
export const trae = {
  id: 'trae',
  title: 'TRAE',
  pack: true,
  caps: {
    // 上游自 2026-10-27 起不再下发缓存命中计数（同前缀连发恒 0、metadata 说
    // 没挂缓存池），命中率只能按 0 计。模型分区用一行状态如实说明，避免用户
    // 以为缓存没生效。文案只写数据与状态，不写防御性句式。
    modelNotice: '缓存命中率：上游未上报（按 0 计）',
  },
}
