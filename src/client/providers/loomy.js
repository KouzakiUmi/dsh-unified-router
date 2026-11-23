// Loomy（讯飞办公助手）provider 模块：走 channel-pack 通用账号池面板。
// 渠道专有能力：新手任务（onboarding.claim）、永久积分锁定、上游路由检测（Loomy 专有）。
export const loomy = {
  id: 'loomy',
  title: 'Loomy',
  // channel-pack 通用渠道：账号池 + 模型目录 + 渠道开关。
  pack: true,
  caps: {
    // 手动入口：onboarding.claim 只接受 loomy 与 raccoon。
    // Loomy 实际是向上游**上报任务完成**（POST tasks/complete），不是被动领取，
    // 按钮文案按动作写「完成新手任务」。
    onboarding: true,
    rewardLabel: '完成新手任务',
    // 自动化调度归「自动完成任务」（默认关闭），不是「自动领取奖励」。
    completeTasks: true,
    // 永久积分锁定：Loomy 专有。
    permanentLock: true,
    // 0 积分只读上游路由检测（目录 + 积分账本）：Loomy 专有。
    routeCheck: true,
  },
  createActions({ getState, publish, mutate, rememberChannel }) {
    const applyRouteState = value => {
      const nextRoute = loomyRouteFrom(value)
      const state = getState()
      const accounts = state.provider === 'loomy'
        ? state.accounts.map(({ route: _old, ...account }) => ({
          ...account,
          ...(nextRoute.accounts[account.id] ? { route: nextRoute.accounts[account.id] } : {}),
        }))
        : state.accounts
      publish({ loomyRoute: nextRoute, ...(state.provider === 'loomy' ? { accounts } : {}) })
      if (state.provider === 'loomy') rememberChannel?.('loomy')
    }
    return {
      loomyCheckRoute(accountId, mode) {
        const single = typeof accountId === 'string' && accountId !== ''
        return mutate('loomy.checkRoute', {
          provider: 'loomy',
          ...(single ? { accountId } : {}),
          ...(!single && typeof mode === 'string' && mode ? { mode } : {}),
        }, {
          refresh: false,
          scope: single ? `account:${accountId}` : 'route:loomy',
          progress: single ? '正在只读检测该账号上游路由…' : '正在只读检测 Loomy 上游路由（0 积分）…',
          message: value => loomyRouteMessage(value, single ? accountId : ''),
          result: applyRouteState,
        })
      },
      loomySetSkipRouted(skipRouted) {
        return mutate('loomy.setRouteConfig', {
          provider: 'loomy',
          skipRouted: skipRouted === true,
        }, {
          refresh: false,
          scope: 'route:loomy',
          message: value => value?.skipRouted === false
            ? '已允许选用上游改路由账号。'
            : '已开启：自动避开上游改路由账号。',
          result: applyRouteState,
        })
      },
      loomyClearRoute(accountId) {
        const single = typeof accountId === 'string' && accountId !== ''
        return mutate('loomy.clearRoute', {
          provider: 'loomy',
          ...(single ? { accountId } : {}),
        }, {
          refresh: false,
          scope: single ? `account:${accountId}` : 'route:loomy',
          message: single ? '已清除该账号路由记录。' : '已清空 Loomy 路由检测记录。',
          result: applyRouteState,
        })
      },
    }
  },
}
