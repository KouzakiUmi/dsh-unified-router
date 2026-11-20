// 思维链流变换器（移植自 dsh-cot-loop-guard，MIT）：
// 维护打开的 StreamChunk 块、在 HOLDING 阶段扣留可疑重复尾、恢复时补发、
// 确认死循环时丢弃重复尾、关闭打开块、合成 finish{kind:'stop'} 并中止上游流。
import { createReasoningWatch, DEFAULT_WATCH } from './watch.js'

export function guardChunk(watch, open, chunk) {
  const events = []
  if (chunk.type === 'text-delta' || chunk.type === 'tool-call-delta') {
    const before = watch.snapshot()
    const held = watch.markAnswer()
    if (before.state === 'HOLDING') {
      events.push({ type: 'recover', cause: 'answer', snapshot: before, releasedChars: held.length })
    }
    const chunks = []
    if (held.length > 0) chunks.push(reasoningDelta(open, held))
    if (chunk.type === 'text-delta') noteText(open, chunk.index, chunk.text)
    else noteTool(open, chunk)
    chunks.push(chunk)
    return { chunks, cut: undefined, events }
  }
  if (chunk.type !== 'reasoning-delta') {
    if (chunk.type === 'block-start') {
      open.set(chunk.index, emptyBlock(chunk.blockType))
      return { chunks: [chunk], cut: undefined, events }
    }
    if (chunk.type === 'block-end') {
      const chunks = []
      const closing = open.get(chunk.index)
      // 在关闭 reasoning 块前先补发暂存的 reasoning 片段，避免 block-end 之后再出现迟到 delta。
      if (closing?.blockType === 'reasoning') {
        const before = watch.snapshot()
        const held = watch.flush()
        if (before.state === 'HOLDING') {
          events.push({ type: 'flush', cause: 'end-of-stream', snapshot: before, releasedChars: held.length })
        }
        if (held.length > 0) chunks.push(reasoningDelta(open, held))
        open.delete(chunk.index)
        // 未触发 CUT 时不改写上游权威 block-end（保留无 delta 完整文本与 signature 等附加属性）。
        chunks.push(chunk)
        return { chunks, cut: undefined, events }
      }
      open.delete(chunk.index)
      return { chunks: [chunk], cut: undefined, events }
    }
    if (chunk.type === 'finish') {
      // finish 前必须把仍处于 HOLDING 的 reasoning 冲刷完毕，绝不能在 finish 之后再产出 delta。
      const chunks = []
      const before = watch.snapshot()
      const held = watch.flush()
      if (before.state === 'HOLDING') {
        events.push({ type: 'flush', cause: 'end-of-stream', snapshot: before, releasedChars: held.length })
      }
      if (held.length > 0) chunks.push(reasoningDelta(open, held))
      chunks.push(chunk)
      return { chunks, cut: undefined, events }
    }
    return { chunks: [chunk], cut: undefined, events }
  }
  const decision = watch.push(chunk.text)
  const chunks = []
  if (decision.emit.length > 0) {
    noteReasoning(open, chunk.index, decision.emit)
    chunks.push({ type: 'reasoning-delta', index: chunk.index, text: decision.emit })
  }
  if (decision.transition === 'hold') {
    events.push({ type: 'hold', cause: 'repeat', snapshot: decision })
  } else if (decision.transition === 'recover') {
    events.push({ type: 'recover', cause: 'repeat', snapshot: decision, releasedChars: decision.emit.length })
  }
  if (!decision.cut) return { chunks, cut: undefined, events }

  events.push({ type: 'cut', cause: 'repeat', snapshot: decision })
  chunks.push(...closeOpen(open))
  chunks.push({ type: 'finish', reason: { kind: 'stop' } })
  return {
    chunks,
    cut: decision,
    events,
  }
}

export function flushWatch(watch, open, observer) {
  const before = watch.snapshot()
  const held = watch.flush()
  if (before.state === 'HOLDING') {
    observer?.({ type: 'flush', cause: 'end-of-stream', snapshot: before, releasedChars: held.length })
  }
  if (held.length === 0) return []
  return [reasoningDelta(open, held)]
}

function reasoningDelta(open, text) {
  const index = reasoningIndex(open)
  noteReasoning(open, index, text)
  return { type: 'reasoning-delta', index, text }
}

function reasoningIndex(open) {
  for (const [index, block] of open) {
    if (block.blockType === 'reasoning') return index
  }
  return 0
}

function emptyBlock(blockType) {
  return { blockType, text: '', toolName: '', toolId: '', toolArgs: '' }
}

function noteReasoning(open, index, text) {
  const block = open.get(index) ?? emptyBlock('reasoning')
  block.blockType = 'reasoning'
  block.text += text
  open.set(index, block)
}

function noteText(open, index, text) {
  const block = open.get(index) ?? emptyBlock('text')
  block.text += text
  open.set(index, block)
}

function noteTool(open, chunk) {
  const block = open.get(chunk.index) ?? emptyBlock('tool-call')
  block.toolId = chunk.id
  if (chunk.name !== undefined) block.toolName = chunk.name
  block.toolArgs += chunk.argumentsDelta
  open.set(chunk.index, block)
}

function closeOpen(open) {
  const chunks = []
  for (const [index, block] of open) chunks.push({ type: 'block-end', index, block: blockValue(block) })
  open.clear()
  return chunks
}

function blockValue(block) {
  if (block.blockType === 'reasoning') return { type: 'reasoning', text: block.text }
  if (block.blockType === 'text') return { type: 'text', text: block.text }
  if (block.blockType === 'tool-call') {
    return { type: 'tool-call', id: block.toolId, name: block.toolName, arguments: block.toolArgs }
  }
  return { type: block.blockType }
}

export async function* guardStream(upstream, options, onCut, observer) {
  const watch = createReasoningWatch(options ?? DEFAULT_WATCH)
  const open = new Map()
  const iterator = upstream[Symbol.asyncIterator]()
  try {
    while (true) {
      const step = await iterator.next()
      if (step.done) break
      const decision = guardChunk(watch, open, step.value)
      for (const event of decision.events) observer?.(event)
      yield* decision.chunks
      if (decision.cut !== undefined) {
        onCut?.(decision.cut)
        return
      }
    }
    yield* flushWatch(watch, open, observer)
  } finally {
    if (iterator.return !== undefined) {
      try {
        await iterator.return()
      } catch {
        // 切断后的上游迭代器取消为尽力而为。
      }
    }
  }
}

export function watchOptionsFrom(partial) {
  return {
    windowChars: positive(partial?.windowChars, DEFAULT_WATCH.windowChars),
    holdRepeatChars: positive(partial?.holdRepeatChars, DEFAULT_WATCH.holdRepeatChars),
    cutRepeatChars: positive(partial?.cutRepeatChars, DEFAULT_WATCH.cutRepeatChars),
    minCycleRepeats: positive(partial?.minCycleRepeats, DEFAULT_WATCH.minCycleRepeats),
    minPoolUnits: positive(partial?.minPoolUnits, DEFAULT_WATCH.minPoolUnits),
    maxPoolKinds: positive(partial?.maxPoolKinds, DEFAULT_WATCH.maxPoolKinds),
    poolShare: partial?.poolShare !== undefined && partial.poolShare > 0 && partial.poolShare <= 1 ? partial.poolShare : DEFAULT_WATCH.poolShare,
  }
}

function positive(value, fallback) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
