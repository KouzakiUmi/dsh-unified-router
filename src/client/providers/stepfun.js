export const stepfun = apiKeyChannel({
  id: 'stepfun',
  title: 'Step Plan',
  host: 'api.stepfun.com',
  consoleMeta: '用于读取阶跃星辰 Step Plan 周期与月度 Credit 额度',
  consoleFormHint: '粘贴 platform.stepfun.com 的 Oasis-Token、Cookie 或 cURL',
  consoleFormGuide: '登录 platform.stepfun.com/step-plan 后，复制请求头中的 Oasis-Token 值，或整段 Cookie / cURL 粘贴。',
})
