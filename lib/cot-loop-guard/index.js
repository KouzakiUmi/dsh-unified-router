// 思维链死循环保护模块入口（集成自 dsh-cot-loop-guard，MIT）。
// 挂在宿主 llm/stream（global: true）上，统一保护所有 provider（无跳过表），
// 取代原 channel-pack 适配器内分散的行去重检测器。
import { createResumeBook, CONTINUE_PROMPT } from './resume.js'
import { guardStream, watchOptionsFrom } from './stream.js'

const QUIET_PURPOSES = new Set(['compaction', 'session-title'])

function boundedInt(value, fallback, max) {
  if (value === undefined || !Number.isInteger(value) || value < 0) return fallback
  return Math.min(value, max)
}

export function installCotLoopGuard(ctx, options = {}) {
  const watchOptions = watchOptionsFrom(options.watch)
  const maxResumes = boundedInt(options.maxResumes, 2, 10)
  const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => options.enabled !== false
  const resumes = createResumeBook({ maxResumes }, ctx?.logger, options.createMessage)
  let agents
  let disposed = false
  const disposers = []

  if (typeof ctx?.on === 'function') {
    const offStream = ctx.on('llm/stream', (callOptions, next) => {
      if (disposed) return next()
      if (callOptions?.purpose !== undefined && QUIET_PURPOSES.has(callOptions.purpose)) return next()
      if (isEnabled(callOptions?.provider) !== true) return next()
      return guardStream(next(), watchOptions, report => {
        const agent = callOptions?.sessionId !== undefined && agents ? agents.get?.(callOptions.sessionId) : undefined
        resumes.noteCut(agent)
        ctx.logger?.warn?.(`[unified-router] cot-loop-guard: 已丢掉 ${callOptions?.provider ?? 'unknown'}/${callOptions?.model ?? 'unknown'} 的 ${report.droppedChars} 个重复思考字符。`)
      }, options.observer)
    }, { global: true })
    if (typeof offStream === 'function') disposers.push(offStream)
  }

  // 懒注入 agents 服务（headless 或无 agents 插件时不阻塞宿主启动）
  if (typeof ctx?.inject === 'function') {
    try {
      const offAgents = ctx.inject(['agents'], scope => {
        if (disposed) return
        agents = scope?.agents
        if (typeof scope?.on === 'function') {
          scope.on('agent/status', ({ agent, status }) => {
            if (!disposed && status === 'idle') resumes.onIdle(agent, scope.agents)
          })
          scope.on('agent/inbox/inserted', ({ agent, message }) => {
            if (!disposed) resumes.onInserted(agent, message?.id)
          })
          scope.on('agent/disposed', ({ agent }) => {
            resumes.forget(agent?.id)
          })
        }
      })
      if (typeof offAgents === 'function') disposers.push(offAgents)
    } catch {
      // 测试桩可能不支持二次 inject，忽略即可。
    }
  }

  return {
    resumes,
    watchOptions,
    dispose() {
      if (disposed) return
      disposed = true
      agents = undefined
      resumes.clear()
      for (const off of disposers.splice(0)) {
        try { off() } catch {}
      }
    },
  }
}

export { CONTINUE_PROMPT }
export { DEFAULT_WATCH, assessRepeat, createReasoningWatch } from './watch.js'
export { guardChunk, flushWatch, guardStream, watchOptionsFrom } from './stream.js'
export { createResumeBook } from './resume.js'
