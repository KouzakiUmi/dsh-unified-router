// 思维链死循环实时检测器（移植自 dsh-cot-loop-guard，MIT）。
// 纯字符串计算，零外部依赖：周期得分 + 子句池得分 + FORWARD/HOLDING/CUT 三态滞回。
export const DEFAULT_WATCH = Object.freeze({
  windowChars: 2400,
  holdRepeatChars: 180,
  cutRepeatChars: 720,
  minCycleRepeats: 3,
  minPoolUnits: 16,
  maxPoolKinds: 8,
  poolShare: 0.72,
})

export function assessRepeat(text, options = DEFAULT_WATCH) {
  const tail = text.length > options.windowChars ? text.slice(-options.windowChars) : text
  const cycleChars = cycleRepeatChars(tail, options.minCycleRepeats)
  const poolChars = poolRepeatChars(tail, options)
  return {
    repeatChars: Math.max(cycleChars, poolChars),
    cycleChars,
    poolChars,
  }
}

function cycleRepeatChars(tail, minRepeats) {
  const maxPeriod = Math.min(180, Math.floor(tail.length / minRepeats))
  let best = 0
  for (let period = 8; period <= maxPeriod; period += 1) {
    const block = tail.slice(tail.length - period)
    if (uniqueChars(block) < 2) continue
    let count = 1
    let pos = tail.length - period
    while (pos >= period && tail.slice(pos - period, pos) === block) {
      count += 1
      pos -= period
      if (count * period >= tail.length) break
    }
    if (count >= minRepeats) best = Math.max(best, count * period)
  }
  return best
}

function poolRepeatChars(tail, options) {
  const units = tail
    .split(/[\n\r。！？!?；;]+/u)
    .map(unit => unit.trim())
    .filter(unit => unit.length >= 1)
  if (units.length < options.minPoolUnits) return 0
  const counts = new Map()
  let total = 0
  for (const unit of units) {
    counts.set(unit, (counts.get(unit) ?? 0) + 1)
    total += unit.length
  }
  let repeated = 0
  let kinds = 0
  for (const [unit, count] of counts) {
    if (count < 2) continue
    kinds += 1
    repeated += unit.length * count
  }
  if (kinds === 0 || kinds > options.maxPoolKinds) return 0
  if (kinds === 1 && repeatedUnitsAreSingleChar(counts)) return 0
  if (total === 0 || repeated / total < options.poolShare) return 0
  return repeated
}

function repeatedUnitsAreSingleChar(counts) {
  for (const [unit, count] of counts) {
    if (count >= 2 && unit.length >= 2) return false
  }
  return true
}

function uniqueChars(text) {
  return new Set(text).size
}

export function createReasoningWatch(options = DEFAULT_WATCH) {
  let kept = ''
  let held = ''
  let answered = false
  let state = 'FORWARD'
  let receivedChars = 0
  let droppedChars = 0
  let verdict = { repeatChars: 0, cycleChars: 0, poolChars: 0 }

  function release(extra) {
    const emit = held + extra
    held = ''
    kept += emit
    state = 'FORWARD'
    return emit
  }

  function snapshot() {
    return {
      ...verdict,
      state,
      keptChars: kept.length,
      heldChars: held.length,
      receivedChars,
      droppedChars,
    }
  }

  function result(emit, cut, transition) {
    return { emit, cut, transition, ...snapshot() }
  }

  return {
    push(delta) {
      if (delta.length === 0) return result('', false)
      receivedChars += delta.length
      if (answered) return result(release(delta), false)

      verdict = assessRepeat(kept + held + delta, options)
      if (verdict.repeatChars < options.holdRepeatChars) {
        const transition = held.length > 0 ? 'recover' : undefined
        return result(release(delta), false, transition)
      }
      if (verdict.repeatChars < options.cutRepeatChars) {
        const transition = held.length === 0 ? 'hold' : undefined
        held += delta
        state = 'HOLDING'
        return result('', false, transition)
      }

      droppedChars += held.length + delta.length
      held = ''
      state = 'CUT'
      return result('', true, 'cut')
    },
    markAnswer() {
      answered = true
      verdict = { repeatChars: 0, cycleChars: 0, poolChars: 0 }
      return this.flush()
    },
    flush() {
      const emit = release('')
      verdict = { repeatChars: 0, cycleChars: 0, poolChars: 0 }
      return emit
    },
    kept() {
      return kept
    },
    snapshot,
  }
}
