// 思维链死循环保护模块入口（集成自 dsh-cot-loop-guard，MIT）。
// 挂在宿主 llm/stream（global: true）上，统一保护所有 provider（无跳过表），
// 取代原 channel-pack 适配器内分散的行去重检测器。
import { createHash } from 'node:crypto'
import { createResumeBook, CONTINUE_PROMPT } from './resume.js'
import { guardStream, watchOptionsFrom } from './stream.js'

const QUIET_PURPOSES = new Set(['compaction', 'session-title'])

/**
 * 对外广播的 Cordis 事件名。负载只含元数据（见 guardEventPayload），
 * 不含 reasoning/正文/工具参数；session 与 agent id 以 sha256 前 16 位替换。
 * 监控插件 dsh-research-monitor-collector 订阅此事件。
 */
export const GUARD_EVENT = 'unified-router/cot-loop-guard'

const SNAPSHOT_NUMBERS = ['keptChars', 'heldChars', 'receivedChars', 'droppedChars', 'repeatChars', 'cycleChars', 'poolChars']

function hash16(value) {
  return typeof value === 'string' ? createHash('sha256').update(value).digest('hex').slice(0, 16) : undefined
}

export function guardEventPayload(event, callOptions) {
  const payload = { schemaVersion: 1, ts: new Date().toISOString(), type: event.type, cause: event.cause }
  if (typeof callOptions?.provider === 'string') payload.provider = callOptions.provider
  if (typeof callOptions?.model === 'string') payload.model = callOptions.model
  if (typeof callOptions?.purpose === 'string') payload.purpose = callOptions.purpose
  const sessionHash = hash16(callOptions?.sessionId)
  if (sessionHash !== undefined) payload.sessionHash = sessionHash
  const snapshot = event.snapshot ?? {}
  if (typeof snapshot.state === 'string') payload.state = snapshot.state
  for (const key of SNAPSHOT_NUMBERS) if (Number.isFinite(snapshot[key])) payload[key] = snapshot[key]
  if (Number.isFinite(event.releasedChars)) payload.releasedChars = event.releasedChars
  return payload
}

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

  // 广播失败（宿主无 emit、监听器抛错）一律吞掉：观测不得影响流与续跑。
  // 默认关闭：事件是给外部监控项目用的，宿主未显式开启（emitEvents: true）时不发。
  const broadcast = payload => {
    if (disposed || options.emitEvents !== true || typeof ctx?.emit !== 'function') return
    try { ctx.emit(GUARD_EVENT, payload) } catch {}
  }

  if (typeof ctx?.on === 'function') {
    const offStream = ctx.on('llm/stream', (callOptions, next) => {
      if (disposed) return next()
      if (callOptions?.purpose !== undefined && QUIET_PURPOSES.has(callOptions.purpose)) return next()
      if (isEnabled(callOptions?.provider) !== true) return next()
      const observer = event => {
        try { options.observer?.(event) } catch {}
        broadcast(guardEventPayload(event, callOptions))
      }
      return guardStream(next(), watchOptions, report => {
        const agent = callOptions?.sessionId !== undefined && agents ? agents.get?.(callOptions.sessionId) : undefined
        resumes.noteCut(agent)
        ctx.logger?.warn?.(`[unified-router] cot-loop-guard: 已丢掉 ${callOptions?.provider ?? 'unknown'}/${callOptions?.model ?? 'unknown'} 的 ${report.droppedChars} 个重复思考字符。`)
      }, observer)
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
            if (disposed || status !== 'idle') return
            if (resumes.onIdle(agent, scope.agents)) {
              const payload = { schemaVersion: 1, ts: new Date().toISOString(), type: 'resume', cause: 'idle' }
              const sessionHash = hash16(agent?.session?.id)
              if (sessionHash !== undefined) payload.sessionHash = sessionHash
              const agentHash = hash16(agent?.id)
              if (agentHash !== undefined) payload.agentHash = agentHash
              broadcast(payload)
            }
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
