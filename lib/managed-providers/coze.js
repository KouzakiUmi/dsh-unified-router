// Coze 桌面端（扣子桌面版 1.1.49）自管多账号渠道规格。
// 证据来源：本机 Coze 桌面端 app.asar / runtime.json / coze-bridge 实测（2026-11-20）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const COZE_WEB_ORIGIN = 'https://www.coze.cn'
const COZE_LLM_GATEWAY_ORIGIN = 'https://llm-gateway.coze.cn'
const COZE_LLM_BASE_URL = `${COZE_LLM_GATEWAY_ORIGIN}/v1`
const COZE_LLM_CHAT_PATH = '/v1/chat/completions'

// 2026-11-20 实测 POST /api/coze_claw/resource/get_model_list 全部 16 条模型（上下文留空不编造）
export const COZE_FALLBACK_MODELS = Object.freeze([
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', attachment: true, reasoning: true, rate: 0.10, protocol: 'openai-completions' },
  { id: 'glm-5.3', name: 'GLM-5.3', attachment: true, reasoning: true, rate: 0.81, protocol: 'openai-completions' },
  { id: 'glm-5.2', name: 'GLM-5.2', attachment: true, reasoning: true, rate: 0.81, protocol: 'openai-completions' },
  { id: 'glm-5.1', name: 'GLM-5.1', attachment: true, reasoning: true, rate: 0.81, protocol: 'openai-completions' },
  { id: 'kimi-k3.1-pro-selected', name: 'Kimi-K3.1-Pro', attachment: true, reasoning: true, rate: 0.98, protocol: 'openai-completions' },
  { id: 'kimi-k3', name: 'Kimi-K3', attachment: true, reasoning: true, rate: 1.38, protocol: 'openai-completions' },
  { id: 'kimi-k2.7-code', name: 'Kimi-K2.7-Code', reasoning: true, rate: 0.51, protocol: 'openai-completions' },
  { id: 'deepseek-v4.1-flash-selected', name: 'DeepSeek-V4.1-Flash', reasoning: true, rate: 0.11, protocol: 'openai-completions' },
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek-V4-Pro', reasoning: true, rate: 0.62, protocol: 'openai-completions' },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek-V4-Flash', reasoning: true, rate: 0.12, protocol: 'openai-completions' },
  { id: 'seed-evolving', name: 'Seed-Evolving', attachment: true, reasoning: true, rate: 0.23, protocol: 'openai-completions' },
  { id: 'seed-2.1-pro', name: 'Seed-2.1-Pro', attachment: true, reasoning: true, rate: 0.47, protocol: 'openai-completions' },
  { id: 'seed-2.1-turbo', name: 'Seed-2.1-Turbo', attachment: true, reasoning: true, rate: 0.30, protocol: 'openai-completions' },
  { id: 'qwen3.8-max', name: 'Qwen3.8-Max', attachment: true, reasoning: true, rate: 0.65, protocol: 'openai-completions' },
  { id: 'qwen3.7-plus', name: 'Qwen3.7-Plus', attachment: true, reasoning: true, rate: 0.21, protocol: 'openai-completions' },
  { id: 'minimax-m3', name: 'MiniMax-M3', reasoning: true, rate: 0.19, protocol: 'openai-completions' },
])

function cozeHomeDir() {
  return join(homedir(), '.coze')
}

function readLocalCozeRuntime(expectedClawId = '') {
  const runtimePath = join(cozeHomeDir(), 'desktop', 'runtime.json')
  let patToken = ''
  if (existsSync(runtimePath)) {
    try {
      const json = JSON.parse(readFileSync(runtimePath, 'utf8'))
      const raw = json?.patToken?.accessToken
      if (typeof raw === 'string' && raw.trim()) patToken = raw.trim()
    } catch {}
  }
  // 仅当明确给出 expectedClawId 时，才从匹配该 clawId 的 agent 配置中读取 modelToken，
  // 绝不跨全部 agent 目录盲取最新 token（避免多账号切换时跨账号计费）。
  let modelToken = ''
  let latestTokenAt = 0
  const agentsDir = join(cozeHomeDir(), 'agents')
  if (expectedClawId && existsSync(agentsDir)) {
    try {
      for (const entry of readdirSync(agentsDir)) {
        const cfgPath = join(agentsDir, entry, 'config.json')
        if (!existsSync(cfgPath)) continue
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
        const cfgAgentId = String(cfg?.agentId ?? cfg?.clawId ?? entry)
        if (entry !== expectedClawId && cfgAgentId !== expectedClawId) continue
        for (const session of Object.values(cfg?.sessions ?? {})) {
          if (typeof session?.modelToken === 'string' && session.modelToken.trim()) {
            const at = Number(session.tokenGeneratedAt) || 0
            if (at >= latestTokenAt) {
              latestTokenAt = at
              modelToken = session.modelToken.trim()
            }
          }
        }
      }
    } catch {}
  }
  return { patToken, modelToken }
}

export function sanitizeCozeCredential(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const patToken = typeof raw.patToken === 'string' ? raw.patToken.trim().slice(0, 1024) : ''
  const modelToken = typeof raw.modelToken === 'string' ? raw.modelToken.trim().slice(0, 2048) : ''
  if (!patToken && !modelToken) return null
  return {
    ...(patToken ? { patToken } : {}),
    ...(modelToken ? { modelToken } : {}),
    ...(typeof raw.clawId === 'string' && raw.clawId ? { clawId: raw.clawId.slice(0, 128) } : {}),
    ...(typeof raw.ownerId === 'string' && raw.ownerId ? { ownerId: raw.ownerId.slice(0, 128) } : {}),
    ...(typeof raw.ownerName === 'string' && raw.ownerName ? { ownerName: raw.ownerName.slice(0, 80) } : {}),
    followDesktopRuntime: raw.followDesktopRuntime === true,
  }
}

async function cozePostJson(fetchImpl, path, token, body, signal, timeoutMs = 10_000) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const res = await fetchImpl(`${COZE_WEB_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal: combined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function cozeGetJson(fetchImpl, path, token, signal, timeoutMs = 10_000) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const res = await fetchImpl(`${COZE_WEB_ORIGIN}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
    signal: combined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function resolveLiveCozeCredential(handle, signal) {
  const cred = await handle.getCredential()
  if (!cred) return null
  // Coze 桌面端每 9 分钟刷新一次 ~/.coze/desktop/runtime.json 的 cztei_ PAT；
  // 仅当桌面端当前登录的 ownerId 与本账号一致时才热同步，防止多账号切换时跨账号串号。
  if (cred.followDesktopRuntime || handle.entry?.source === 'local') {
    const local = readLocalCozeRuntime(cred.clawId || '')
    let sameOwner = false
    if (local.patToken && local.patToken === cred.patToken) {
      sameOwner = true
    } else if (local.patToken && cred.ownerId) {
      try {
        const meta = await discoverAgentMeta(handle.fetch, local.patToken, signal)
        sameOwner = Boolean(meta.ownerId && meta.ownerId === cred.ownerId)
      } catch {
        sameOwner = false
      }
    }
    if (sameOwner) {
      let changed = false
      const next = { ...cred }
      if (local.patToken && local.patToken !== cred.patToken) {
        next.patToken = local.patToken
        changed = true
      }
      if (cred.clawId && local.modelToken && local.modelToken !== cred.modelToken) {
        next.modelToken = local.modelToken
        changed = true
      }
      if (changed) {
        await handle.saveCredential(next).catch(() => {})
        return next
      }
    }
  }
  return cred
}

async function discoverAgentMeta(fetchImpl, patToken, signal) {
  const json = await cozePostJson(fetchImpl, '/api/coze_claw/agent/list', patToken, {}, signal)
  if (json?.code !== 0) throw new Error('Coze PAT 无效或已过期')
  const agents = Array.isArray(json?.data?.agents) ? json.data.agents : []
  const first = agents.find(a => a?.agent_id || a?.id) ?? agents[0]
  return {
    clawId: String(first?.agent_id ?? first?.id ?? ''),
    ownerId: String(first?.owner?.owner_id ?? ''),
    ownerName: typeof first?.owner?.name === 'string' ? first.owner.name.trim() : '',
  }
}

export function parseCozeModelList(json) {
  const list = Array.isArray(json?.data?.models) ? json.data.models : []
  const out = []
  for (const m of list) {
    const id = typeof m?.name === 'string' ? m.name.trim() : ''
    if (!id) continue
    const caps = Array.isArray(m.capability) ? m.capability.map(String) : []
    const rate = Number(m.consumption_multiplier)
    out.push({
      id,
      name: typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim() : id,
      context: null,
      output: null,
      attachment: caps.some(c => c.includes('图片') || c.includes('视觉')),
      reasoning: caps.some(c => c.includes('推理') || c.includes('思考')),
      efforts: [],
      free: Number.isFinite(rate) && rate === 0,
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      protocol: 'openai-completions',
    })
  }
  return out
}

export const cozeSpec = {
  id: 'coze',
  title: 'Coze',
  protocol: 'openai-completions',
  baseUrl: COZE_LLM_BASE_URL,
  authMethods: ['local', 'credential'],
  credentialHint: '粘贴 Coze 桌面端 PAT（cztei_…）、coze-bridge modelToken 或 JSON 凭据',
  taskResetHour: 0,
  fallbackModels: COZE_FALLBACK_MODELS,
  sanitizeCredential: sanitizeCozeCredential,

  async importLocal({ fetch, signal }) {
    const initial = readLocalCozeRuntime('')
    if (!initial.patToken) {
      throw new Error('未检测到本机 Coze 桌面端运行凭据，请先启动并登录 Coze 桌面端')
    }
    const meta = await discoverAgentMeta(fetch, initial.patToken, signal)
    // 只有取得当前 PAT 所属的 clawId 后，才读取归属于该 clawId 的 modelToken，杜绝跨账号串号。
    const scoped = meta.clawId ? readLocalCozeRuntime(meta.clawId) : { patToken: initial.patToken, modelToken: '' }
    const credential = sanitizeCozeCredential({
      patToken: initial.patToken,
      modelToken: scoped.modelToken,
      clawId: meta.clawId,
      ownerId: meta.ownerId,
      ownerName: meta.ownerName,
      followDesktopRuntime: true,
    })
    return {
      credential,
      uid: meta.ownerId || '',
      name: meta.ownerName || (meta.ownerId ? `Coze (${meta.ownerId.slice(-4)})` : 'Coze 本机账号'),
    }
  },

  async parseCredential(raw, { fetch, signal }) {
    let parsed
    if (raw.startsWith('{')) {
      try { parsed = JSON.parse(raw) } catch { throw new Error('JSON 凭据格式无效') }
    } else if (raw.startsWith('cztei_')) {
      parsed = { patToken: raw }
    } else {
      parsed = { modelToken: raw }
    }
    let meta = { clawId: parsed.clawId || '', ownerId: parsed.ownerId || '', ownerName: parsed.ownerName || '' }
    if (parsed.patToken) {
      const discovered = await discoverAgentMeta(fetch, parsed.patToken, signal)
      meta = {
        clawId: meta.clawId || discovered.clawId,
        ownerId: meta.ownerId || discovered.ownerId,
        ownerName: meta.ownerName || discovered.ownerName,
      }
    }
    const credential = sanitizeCozeCredential({ ...parsed, ...meta })
    if (!credential) throw new Error('凭据内容无效')
    return {
      credential,
      uid: meta.ownerId || '',
      name: meta.ownerName || 'Coze 账号',
    }
  },

  async fetchModels(handle, { signal }) {
    const cred = await resolveLiveCozeCredential(handle, signal)
    if (!cred?.patToken) return []
    let clawId = cred.clawId
    if (!clawId) {
      const meta = await discoverAgentMeta(handle.fetch, cred.patToken, signal)
      clawId = meta.clawId
      if (clawId || meta.ownerId) {
        await handle.saveCredential({ ...cred, clawId, ownerId: meta.ownerId || cred.ownerId, ownerName: meta.ownerName || cred.ownerName }).catch(() => {})
      }
    }
    if (!clawId) return []
    const json = await cozePostJson(handle.fetch, '/api/coze_claw/resource/get_model_list', cred.patToken, {
      claw_id: clawId,
      include_inaccessible_models: true,
    }, signal)
    return parseCozeModelList(json)
  },

  async fetchUsage(handle, { signal }) {
    const cred = await resolveLiveCozeCredential(handle, signal)
    if (!cred) return { signedIn: false, error: 'credential_error' }
    if (!cred.patToken) {
      return {
        signedIn: Boolean(cred.modelToken),
        plan: cred.modelToken ? 'Bridge 推理模式' : '',
        balance: null,
        windows: [],
        updatedAt: Date.now(),
      }
    }
    let ownerId = cred.ownerId
    let ownerName = cred.ownerName
    if (!ownerId) {
      try {
        const meta = await discoverAgentMeta(handle.fetch, cred.patToken, signal)
        ownerId = meta.ownerId
        ownerName = meta.ownerName
        if (ownerId) await handle.saveCredential({ ...cred, clawId: meta.clawId || cred.clawId, ownerId, ownerName }).catch(() => {})
      } catch {
        return { signedIn: false, error: 'auth_expired' }
      }
    }
    const balJson = await cozeGetJson(
      handle.fetch,
      `/api/marketplace/trade/credit/balance?account_type=2&coze_account_id=${encodeURIComponent(ownerId)}`,
      cred.patToken,
      signal,
      8000,
    )
    if (balJson?.code !== 0) {
      return { signedIn: false, error: balJson?.code === 700012006 ? 'auth_expired' : 'upstream_error' }
    }
    const data = balJson.data ?? {}
    const totalRemain = Number(data.total_remain ?? data.total_balance)
    const items = Array.isArray(data.items) ? data.items : []
    const windows = items.map((item, idx) => {
      const total = Number(item.total)
      const remain = Number(item.remaining)
      if (!Number.isFinite(remain)) return null
      return {
        name: `积分池 #${idx + 1}`,
        balance: remain,
        limit: Number.isFinite(total) && total > 0 ? total : null,
        used: Number.isFinite(total) && total > 0 ? Math.round((1 - remain / total) * 100) : null,
        unit: '积分',
      }
    }).filter(Boolean)
    return {
      signedIn: true,
      uid: ownerId,
      name: ownerName || handle.entry?.name,
      plan: cred.modelToken ? '桌面端 + Bridge' : '桌面端（目录与额度）',
      balance: Number.isFinite(totalRemain) ? totalRemain : null,
      unit: '积分',
      windows,
      updatedAt: Date.now(),
    }
  },

  async claimRewards(handle, { signal }) {
    const cred = await resolveLiveCozeCredential(handle, signal)
    if (!cred?.patToken || !cred.ownerId) return { kind: 'empty', retryable: false }
    const listJson = await cozePostJson(handle.fetch, '/api/achievement/list', cred.patToken, { coze_account_id: cred.ownerId }, signal, 8000)
    const items = Array.isArray(listJson?.data?.achievements) ? listJson.data.achievements
      : Array.isArray(listJson?.data?.list) ? listJson.data.list : []
    let claimed = 0
    for (const item of items) {
      const id = item?.achievement_id ?? item?.id
      const claimable = item?.can_claim === true || item?.status === 2 || item?.claim_status === 1
      if (!id || !claimable) continue
      try {
        const res = await cozePostJson(handle.fetch, '/api/achievement/claim', cred.patToken, {
          achievement_id: id,
          coze_account_id: cred.ownerId,
        }, signal, 8000)
        if (res?.code === 0) claimed += 1
      } catch {}
    }
    return claimed > 0 ? { kind: 'claimed', claimed } : { kind: 'done', claimed: 0 }
  },

  async createTransport(handle) {
    const cred = await resolveLiveCozeCredential(handle)
    if (!cred?.modelToken) {
      throw new Error('Coze 桌面端推理需要 coze-bridge 配对后的 modelToken；未配对时仅提供目录与额度查询')
    }
    return {
      async fetch(input, init) {
        const isReq = typeof Request !== 'undefined' && input instanceof Request
        const url = new URL(isReq ? input.url : input)
        if (url.origin !== COZE_LLM_GATEWAY_ORIGIN || url.pathname !== COZE_LLM_CHAT_PATH) {
          throw new Error('Coze 请求地址无效')
        }
        const headers = new Headers(init?.headers ?? (isReq ? input.headers : undefined))
        headers.set('authorization', `Bearer ${cred.modelToken}`)
        headers.set('content-type', 'application/json')
        return handle.fetch(url.href, { ...init, headers })
      },
    }
  },
}
