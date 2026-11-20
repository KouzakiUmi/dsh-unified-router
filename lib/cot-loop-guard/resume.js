// 思考循环切断后的有界自动续跑台账（移植自 dsh-cot-loop-guard，MIT）。
// 仅在 agent 进入 idle 且收件箱为空时投递续跑指令；有其他消息插入时清零计数。
import { randomUUID } from 'node:crypto'

export const CONTINUE_PROMPT = '继续未完成的任务。上一段思考在原地打转，重复的部分已经丢掉，没有写进上下文。换一条路直接做完，不要把刚才那段推理再写一遍。'

let cachedCreateUserMessage = null
async function loadCreateUserMessage() {
  if (cachedCreateUserMessage !== null) return cachedCreateUserMessage
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (typeof mod?.createUserMessage === 'function') {
      cachedCreateUserMessage = mod.createUserMessage
      return cachedCreateUserMessage
    }
  } catch {}
  cachedCreateUserMessage = fallbackCreateUserMessage
  return cachedCreateUserMessage
}

function fallbackCreateUserMessage({ content, source }) {
  return {
    id: `cot-resume-${randomUUID()}`,
    role: 'user',
    content,
    source: source ?? { kind: 'user' },
    createdAt: Date.now(),
  }
}

export function createResumeBook(policy, log, createMessage) {
  const states = new Map()
  const maxResumes = Number.isInteger(policy?.maxResumes) && policy.maxResumes >= 0 ? Math.min(policy.maxResumes, 10) : 2
  let messageBuilder = typeof createMessage === 'function' ? createMessage : null
  // 启动期预热 dsh-llm 的 createUserMessage，避免 onIdle 时等待动态 import。
  if (!messageBuilder) {
    void loadCreateUserMessage().then(fn => { if (!messageBuilder) messageBuilder = fn })
  }

  function stateFor(agentId) {
    const existing = states.get(agentId)
    if (existing !== undefined) return existing
    const created = { attempts: 0, waiting: false, injected: new Set() }
    states.set(agentId, created)
    return created
  }

  return {
    noteCut(agent) {
      if (!agent || typeof agent.id !== 'string') return
      const state = stateFor(agent.id)
      state.attempts += 1
      state.waiting = state.attempts <= maxResumes
    },
    onIdle(agent, agents) {
      if (!agent || typeof agent.id !== 'string') return false
      const state = states.get(agent.id)
      if (state === undefined || !state.waiting) return false
      state.waiting = false
      if (agent.status !== 'idle') return false
      if (agent.inbox?.hasPending === true) return false
      if ((agent.inbox?.nextTurn?.length ?? 0) > 0) return false
      if (state.attempts > maxResumes) {
        log?.warn?.(`[unified-router] cot-loop-guard: ${agent.id} 已连续 ${state.attempts} 次思考打转，超过自动续跑上限 ${maxResumes}，不再发送。`)
        return false
      }
      const build = messageBuilder ?? fallbackCreateUserMessage
      const message = build({
        content: [{ type: 'text', text: CONTINUE_PROMPT }],
        source: { kind: 'user' },
      })
      state.injected.add(message.id)
      try {
        const deliver = () => agent.followup(message)
        if (typeof agents?.withoutInitiator === 'function') agents.withoutInitiator(deliver)
        else deliver()
      } catch (error) {
        state.injected.delete(message.id)
        log?.warn?.(`[unified-router] cot-loop-guard: 续跑投递失败（${agent.id}）：${error instanceof Error ? error.message : String(error)}`)
        return false
      }
      log?.info?.(`[unified-router] cot-loop-guard: ${agent.id} 已丢掉重复思考并续跑（${state.attempts}/${maxResumes}）。`)
      return true
    },
    onInserted(agent, messageId) {
      if (!agent || typeof agent.id !== 'string') return
      const state = states.get(agent.id)
      if (state === undefined) return
      if (state.injected.delete(messageId)) return
      state.attempts = 0
      state.waiting = false
    },
    forget(agentId) {
      states.delete(agentId)
    },
    clear() {
      states.clear()
    },
  }
}
