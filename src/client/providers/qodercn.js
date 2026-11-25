// Qoder 中国版 provider 模块：走 channel-pack 通用账号池面板。
// 无渠道专有能力（每日额度领取走上游活动，暂不在此暴露）。
export const qodercn = {
  id: 'qodercn',
  title: 'Qoder 中国版',
  pack: true,
  caps: {
    cliCatalog: true,
    // 目录经本机官方 CLI 真拉，可能带回 `issue`（未登录 / CLI 不存在等），
    // 快照把它透出给界面提示。共享层读这个声明，不写 `=== 'qodercn'`。
    catalogIssue: true,
    // 每日额度要在官方客户端里开通：领取结果里带 actionRequired 时给这句话。
    claimActionHint: '每日额度开通入口：Qoder 中国版官方客户端。',
  },
}
