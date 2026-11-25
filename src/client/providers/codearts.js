export const codearts = managedChannel({
  id: 'codearts',
  title: 'CodeArts',
  authMethods: ['local', 'browser', 'credential'],
  credentialHint: '粘贴含 accessKey / secretKey / securityToken 的 JSON 凭据',
  checkin: true,
  extraCaps: {
    // 签到查不到当日记录时，用「未查到今日签到记录」而不是通用的「活动未开启」
    //（CodeArts 的签到入口在活动页，未参加活动与查不到记录是两件事）。
    checkinLabels: { inactive: '未查到今日签到记录' },
    // 额度药丸要读模型目录：CodeArts 的窗口按「免费日额度 / 总积分包」分流，
    // 得先知道当前模型是免费还是付费，才能挑对窗口。
    quotaExtraResources: ['managed.models'],
    // 窗口的重置时刻在 CodeArts 语义上是「周期结束」，不是通用的「重置」。
    quotaWindow: { resetKind: 'cycleEnd' },
    // 账号额度行按模型的免费/付费属性挑窗口；模型额度属性未知时宁可不显示窗口。
    quotaAccount: { gateWindowsByModelFree: true },
  },
})
