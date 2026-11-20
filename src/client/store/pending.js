// 局部非阻塞状态锁：把全局单布尔 busy 拆分为按操作域追踪的 pending 映射。
// 同一 scope 防止重复提交，不同 scope（例如改模型参数与切换自动化开关、或不同账号操作）互不阻塞。
export function createPendingTracker(onChange) {
  const counts = new Map()

  const snapshot = () => Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0).map(([key]) => [key, true]))
  const hasAny = () => counts.size > 0
  const has = scope => (counts.get(scope) ?? 0) > 0

  function enter(scope = 'global') {
    counts.set(scope, (counts.get(scope) ?? 0) + 1)
    onChange?.(snapshot(), hasAny())
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (counts.get(scope) ?? 1) - 1
      if (next <= 0) counts.delete(scope)
      else counts.set(scope, next)
      onChange?.(snapshot(), hasAny())
    }
  }

  function clear() {
    counts.clear()
  }

  return { enter, has, hasAny, snapshot, clear }
}
