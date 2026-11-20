// 豆包工作（DoubaoWork）自管多账号渠道规格。
// 参考：miaocell/magpie-doubao-work-auth@0.4.0 (MIT) 与本机 DoubaoWork 2.37.11 实测（2026-11-20）。
import { randomBytes, randomUUID } from 'node:crypto'
import { launchIsolatedBrowserCookieLogin } from '../browser-login.js'

const DOUBAO_ORIGIN = 'https://www.doubao.com'
const DOUBAO_CHAT_URL = `${DOUBAO_ORIGIN}/chat/completion`
const AID = '497858'
const VERSION_CODE = '20800'
const PC_VERSION = '2.37.11'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

// 档位映射（豆包数字 level ↔ DSH 规范档位）
const LEVEL_TO_EFFORT = Object.freeze({ 3: 'low', 4: 'medium', 5: 'high', 6: 'xhigh', 7: 'max' })
const EFFORT_TO_LEVEL = Object.freeze({ low: 3, medium: 4, high: 5, xhigh: 6, max: 7 })

// 2026-11 实测豆包工作模型兜底基线（与 SSR 实时目录取并集）
export const DOUBAOWORK_FALLBACK_MODELS = Object.freeze([
  { id: 'auto', name: '自动', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', free: true, protocol: 'openai-completions', meta: { modelItemKey: 'auto' } },
  { id: 'doubao-2.1-lite', name: '豆包 2.1 Lite', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', rate: 0.01, protocol: 'openai-completions' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context: 300_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.01, protocol: 'openai-completions' },
  { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.9, protocol: 'openai-completions' },
  { id: 'glm-5.3', name: 'GLM 5.3', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.8, protocol: 'openai-completions' },
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.1, protocol: 'openai-completions' },
  { id: 'doubao-2.1-pro', name: '豆包 2.1 Pro', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', rate: 0.5, protocol: 'openai-completions' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.7, protocol: 'openai-completions' },
  { id: 'minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', context: 256_000, output: 32_768, attachment: false, efforts: ['low', 'high', 'max'], defaultEffort: 'high', rate: 0.15, protocol: 'openai-completions' },
])

function parseCookieString(raw) {
  const map = new Map()
  for (const part of String(raw || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k && v) map.set(k, v)
  }
  return map
}

function buildCookieHeader(cred) {
  if (typeof cred.cookie === 'string' && cred.cookie.includes('sessionid')) return cred.cookie
  const parts = []
  if (cred.sessionid) parts.push(`sessionid=${cred.sessionid}`)
  if (cred.sessionidSs) parts.push(`sessionid_ss=${cred.sessionidSs}`)
  if (cred.csrfToken) parts.push(`passport_csrf_token=${cred.csrfToken}`)
  if (cred.fp) parts.push(`s_v_web_id=${cred.fp}`)
  if (cred.ttwid) parts.push(`ttwid=${cred.ttwid}`)
  return parts.join('; ')
}

export function sanitizeDoubaoWorkCredential(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  let cookie = typeof raw.cookie === 'string' ? raw.cookie.trim() : ''
  const map = parseCookieString(cookie)
  const sessionid = (typeof raw.sessionid === 'string' && raw.sessionid.trim()) || map.get('sessionid') || ''
  const sessionidSs = (typeof raw.sessionidSs === 'string' && raw.sessionidSs.trim()) || map.get('sessionid_ss') || ''
  if (!sessionid && !sessionidSs) return null
  const csrfToken = (typeof raw.csrfToken === 'string' && raw.csrfToken.trim()) || map.get('passport_csrf_token') || map.get('passport_csrf_token_default') || ''
  const fp = (typeof raw.fp === 'string' && raw.fp.trim()) || map.get('s_v_web_id') || ''
  const ttwid = (typeof raw.ttwid === 'string' && raw.ttwid.trim()) || map.get('ttwid') || ''
  if (!cookie) {
    cookie = buildCookieHeader({ sessionid, sessionidSs, csrfToken, fp, ttwid })
  }
  return {
    cookie: cookie.slice(0, 16_384),
    ...(sessionid ? { sessionid: sessionid.slice(0, 512) } : {}),
    ...(sessionidSs ? { sessionidSs: sessionidSs.slice(0, 512) } : {}),
    ...(csrfToken ? { csrfToken: csrfToken.slice(0, 256) } : {}),
    ...(fp ? { fp: fp.slice(0, 256) } : {}),
    ...(ttwid ? { ttwid: ttwid.slice(0, 512) } : {}),
    ...(typeof raw.webId === 'string' && raw.webId ? { webId: raw.webId.slice(0, 128) } : {}),
    ...(typeof raw.botId === 'string' && raw.botId ? { botId: raw.botId.slice(0, 128) } : {}),
    ...(typeof raw.country === 'string' && raw.country ? { country: raw.country.slice(0, 32) } : {}),
    ...(typeof raw.uid === 'string' && raw.uid ? { uid: raw.uid.slice(0, 120) } : {}),
    ...(typeof raw.screenName === 'string' && raw.screenName ? { screenName: raw.screenName.slice(0, 80) } : {}),
  }
}

function buildDoubaoUrl(path, cred, extra = {}, deviceId = '') {
  const url = new URL(path, DOUBAO_ORIGIN)
  const webId = cred.webId || ''
  const stableDevice = webId || deviceId || ''
  const params = {
    aid: AID,
    real_aid: AID,
    device_platform: 'web',
    doubao_device_platform: 'web',
    version_code: VERSION_CODE,
    pkg_type: 'release_version',
    web_platform: 'browser',
    language: 'zh',
    samantha_web: '1',
    'use-olympus-account': '1',
    tz_name: 'Asia/Shanghai',
    region: cred.country || 'CN',
    sys_region: cred.country || 'CN',
    pc_version: PC_VERSION,
    doubao_pc_version: PC_VERSION,
    ...(webId ? { web_id: webId } : {}),
    ...(stableDevice ? { device_id: stableDevice, tea_uuid: stableDevice } : {}),
    ...(cred.ttwid ? { ttwid: cred.ttwid } : {}),
    ...(cred.fp ? { fp: cred.fp } : {}),
    ...extra,
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  return url.href
}

function commonHeaders(cred, extra = {}) {
  return {
    'User-Agent': DESKTOP_UA,
    Origin: DOUBAO_ORIGIN,
    Referer: `${DOUBAO_ORIGIN}/`,
    Accept: 'application/json, text/plain, */*',
    'Agw-Js-Conv': 'str',
    Cookie: buildCookieHeader(cred),
    ...(cred.csrfToken ? { 'x-tt-passport-csrf-token': cred.csrfToken } : {}),
    ...extra,
  }
}

async function fetchJson(fetchImpl, url, init, timeoutMs = 10_000) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  const res = await fetchImpl(url, { ...init, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function hydrateSessionContext(fetchImpl, cred, signal) {
  const next = { ...cred }
  const infoUrl = `${DOUBAO_ORIGIN}/passport/account/info/v2/?aid=${AID}&account_sdk_source=web&sdk_version=2.2.11-doubao.0`
  const info = await fetchJson(fetchImpl, infoUrl, { headers: commonHeaders(next), signal }, 8000)
  const user = info?.data
  if (!user || !user.user_id_str || user.user_id_str === '0' || user.is_visitor_account === true) {
    throw new Error('豆包工作登录态无效或已过期')
  }
  next.uid = String(user.user_id_str)
  next.screenName = typeof user.screen_name === 'string' ? user.screen_name.trim() : ''

  try {
    const launch = await fetchJson(fetchImpl, buildDoubaoUrl('/alice/user/launch', next), {
      method: 'POST',
      headers: commonHeaders(next, { 'Content-Type': 'application/json' }),
      body: '{}',
      signal,
    }, 8000)
    const cfg = launch?.data?.config ?? launch?.data ?? {}
    if (typeof cfg.web_id === 'string' && cfg.web_id) next.webId = cfg.web_id
    if (typeof cfg.ttwid === 'string' && cfg.ttwid && !next.ttwid) next.ttwid = cfg.ttwid
    if (typeof cfg.country === 'string' && cfg.country) next.country = cfg.country
    if (typeof launch?.data?.assistant_bot_id === 'string' && launch.data.assistant_bot_id) {
      next.botId = launch.data.assistant_bot_id
    }
    next.campaignGroupCode = typeof launch?.data?.ug_campaign_info?.campaign_group_code === 'string'
      ? launch.data.ug_campaign_info.campaign_group_code : ''
  } catch {}
  return next
}

function parseTagRate(tagList) {
  if (!Array.isArray(tagList)) return { free: false, rate: null, rateLabel: '', rateTone: '' }
  for (const tag of tagList) {
    const t = typeof tag?.text === 'string' ? tag.text.trim() : ''
    if (!t) continue
    if (t.includes('免费')) return { free: true, rate: 0, rateLabel: '免费', rateTone: 'success' }
    const m = /([\d.]+)\s*[xX×]/.exec(t)
    if (m) {
      const num = Number(m[1])
      if (Number.isFinite(num) && num >= 0) {
        return {
          free: num === 0,
          rate: num,
          rateLabel: num === 0 ? '免费' : `x${num}`,
          rateTone: tag.type === 6 || t.includes('优惠') ? 'info' : 'neutral',
        }
      }
    }
  }
  return { free: false, rate: null, rateLabel: '', rateTone: '' }
}

// 从 /chat SSR HTML 中提取 modeSelectData（双路径兼容：mode.model_list 与 menuConfV2.model_list）
export function parseDoubaoSsrModels(html) {
  if (typeof html !== 'string' || !html) return []
  const marker = html.indexOf('"modeSelectData"')
  if (marker < 0) return []
  const start = html.indexOf('{', marker + 16)
  if (start < 0) return []
  let depth = 0, inStr = false, escaped = false, end = -1
  for (let i = start; i < Math.min(html.length, start + 512_000); i++) {
    const ch = html[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }
  if (end < 0) return []
  let data
  try { data = JSON.parse(html.slice(start, end)) } catch { return [] }
  const rawItems = []
  const conf = data?.menuConfV2 ?? data
  if (Array.isArray(conf?.model_list?.item_list)) rawItems.push(...conf.model_list.item_list)
  for (const mode of Array.isArray(conf?.mode_list?.item_list) ? conf.mode_list.item_list : []) {
    if (Array.isArray(mode?.model_list?.item_list)) rawItems.push(...mode.model_list.item_list)
  }
  const seen = new Set()
  const out = []
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue
    if (item.subscribe_config?.need_upgrade === true) continue
    if (Array.isArray(item.conversation_mode_list) && !item.conversation_mode_list.includes('office')) continue
    const key = typeof item.model_item_key === 'string' ? item.model_item_key.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const levels = Array.isArray(item.reasoning_effort_config?.option_list)
      ? item.reasoning_effort_config.option_list.map(o => LEVEL_TO_EFFORT[o?.level]).filter(Boolean)
      : []
    const defaultEffort = LEVEL_TO_EFFORT[item.reasoning_effort_config?.default_level] || (levels.includes('high') ? 'high' : levels[0] || '')
    const rateInfo = parseTagRate(item.tag_list)
    const ctxSize = Number(item.model_extra_params?.total_window_size)
    out.push({
      id: key,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : key,
      context: Number.isFinite(ctxSize) && ctxSize > 0 ? ctxSize : 256_000,
      output: 32_768,
      attachment: false, // /alice/resource/prepare_upload 需要远端 webmssdk a_bogus，纯 HTTP 不支持图片上传
      efforts: [...new Set(levels)],
      defaultEffort,
      ...rateInfo,
      protocol: 'openai-completions',
      meta: {
        modelItemKey: key,
        itemId: item.item_id ?? '',
        ...(typeof item.model_extra_params?.memory_profile === 'string' ? { memoryProfile: item.model_extra_params.memory_profile } : {}),
      },
    })
  }
  return out
}

// 打包 pi-ai/OpenAI 上下文为豆包 /chat/completion 单块载荷（拒绝图片，不静默丢弃）
function packDoubaoMessages(context) {
  const msgs = Array.isArray(context?.messages) ? context.messages : []
  const packed = []
  for (const msg of msgs) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'image' || part?.type === 'image_url') {
          throw new Error('豆包工作纯 HTTP 模式不支持图片输入，请改用其它支持视觉的渠道')
        }
      }
    }
    packed.push(msg)
  }
  const hasTools = Array.isArray(context?.tools) && context.tools.length > 0
  const envelope = {
    ...(context?.systemPrompt ? { instructions: context.systemPrompt } : {}),
    messages: packed,
    ...(hasTools ? { tools: context.tools } : {}),
  }
  const prefix = hasTools
    ? 'Respond in plain text or JSON {"content":"...","tool_calls":[{"name":"...","arguments":{...}}]} when calling tools.\n'
    : ''
  return prefix + JSON.stringify(envelope)
}

function buildDoubaoCompletionBody({ cred, row, textPrompt, effort }) {
  const modelKey = row?.meta?.modelItemKey || row?.id || 'auto'
  const itemId = String(row?.meta?.itemId ?? '')
  const level = EFFORT_TO_LEVEL[effort] ?? 5
  const localConvId = `local_${randomBytes(16).toString('hex')}`
  return {
    client_meta: {
      bot_id: cred.botId || '',
      conversation_id: '',
      local_conversation_id: localConvId,
      last_section_id: '',
      last_message_index: 0,
      local_permissions: [],
    },
    messages: [{
      local_message_id: randomUUID(),
      message_status: 0,
      content_block: [{
        block_type: 10000,
        content: { text_block: { text: textPrompt } },
      }],
    }],
    option: {
      need_create_conversation: true,
      agent_mode: 1,
      conversation_mode: 2,
      conversation_type: 3,
      ...(itemId ? { need_deep_think: itemId } : {}),
      conversation_init_option: { need_ack_conversation: true },
      conversation_init_ext: { model_item_key: modelKey, mode_id: '3', reasoning_effort: String(level) },
      model_config: {
        model_item_key: modelKey,
        model_extra_params: row?.meta?.memoryProfile ? { memory_profile: row.meta.memoryProfile } : {},
        reasoning_effort: level,
      },
      aggregate_params: { conversation_mode: '2', mode_id: '3', model_item_key: modelKey, agent_mode: '1', reasoning_effort: String(level), provider_id: '' },
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: false,
      recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(Date.now() / 1000), append_sse_event_scene: 0 },
      message_from: 0,
      scene_type: 0,
      message_storage_type: 0,
      is_audio: false,
      tts_switch: false,
      answer_with_suggest: false,
    },
    chat_ability: {},
    user_context: [],
    ext: { is_finish: '1', agent_mode: '1', ...(itemId ? { use_deep_think: itemId } : {}) },
  }
}

// 解析豆包工作自定义 SSE 补丁流 → pi-ai 兼容事件流
export function parseDoubaoSseBlock(eventType, payload, state) {
  const out = []
  if (!payload || typeof payload !== 'object') return out
  if (eventType === 'SSE_ACK' && payload.ack_client_meta?.conversation_id) {
    state.conversationId = payload.ack_client_meta.conversation_id
    return out
  }
  if (eventType === 'CHUNK_DELTA') {
    const delta = typeof payload.text === 'string' ? payload.text : ''
    if (delta) out.push({ kind: state.lastIsThinking ? 'thinking' : 'text', text: delta })
    return out
  }
  const ops = Array.isArray(payload.patch_op) ? payload.patch_op : []
  for (const op of ops) {
    const blocks = Array.isArray(op?.patch_value?.content_block) ? op.patch_value.content_block : []
    for (const block of blocks) {
      const id = String(block?.block_id ?? '')
      const parentId = String(block?.parent_id ?? '')
      const isThinking = block?.block_type === 10040 || (parentId && state.thinkingBlocks.has(parentId))
      if (isThinking && id) state.thinkingBlocks.add(id)
      const text = block?.content?.text_block?.text
      if (typeof text === 'string' && text) {
        state.lastIsThinking = Boolean(isThinking)
        out.push({ kind: isThinking ? 'thinking' : 'text', text })
      }
    }
  }
  return out
}

function extractSetCookies(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const pairs = []
  for (const line of list) {
    const first = String(line).split(';', 1)[0].trim()
    if (first && first.includes('=')) pairs.push(first)
  }
  return pairs.join('; ')
}

// 严格解析豆包工具调用包络：
// 1. 整个回复（去首尾空白）必须是单个 JSON 对象，或仅包含一个顶层 Markdown json 代码块（前后不得混排自然语言说明），
//    防止模型在回答中展示示例代码块时被误当作真实工具调用执行；
// 2. 每个工具名必须命中本次请求声明的 allowedToolNames 白名单。
export function extractDoubaoToolCalls(text, allowedToolNames = null) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed || !trimmed.includes('"tool_calls"')) return null
  let raw = ''
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    raw = trimmed
  } else {
    const fullFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
    if (fullFence?.[1]) raw = fullFence[1].trim()
  }
  if (!raw || !raw.startsWith('{') || !raw.endsWith('}')) return null
  const allowSet = allowedToolNames ? new Set(allowedToolNames) : null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (!Array.isArray(parsed.tool_calls) || !parsed.tool_calls.length) return null
    // 顶层键只能是合法包络键（content / tool_calls），拒绝任意无关 JSON 结构
    const keys = Object.keys(parsed)
    if (keys.some(k => k !== 'content' && k !== 'tool_calls')) return null
    const calls = parsed.tool_calls
      .filter(tc => tc && typeof tc.name === 'string' && tc.name.trim() && (!allowSet || allowSet.has(tc.name.trim())))
      .map((tc, idx) => ({
        id: typeof tc.id === 'string' && tc.id ? tc.id : `doubao_tc_${idx}_${randomBytes(4).toString('hex')}`,
        name: tc.name.trim(),
        arguments: tc.arguments && typeof tc.arguments === 'object' ? tc.arguments
          : typeof tc.arguments === 'string' ? (() => { try { return JSON.parse(tc.arguments) } catch { return { raw: tc.arguments } } })()
            : {},
      }))
    if (calls.length === parsed.tool_calls.length) {
      return { content: typeof parsed.content === 'string' ? parsed.content : '', toolCalls: calls }
    }
  } catch {}
  return null
}

export const doubaoworkSpec = {
  id: 'doubaowork',
  title: '豆包工作',
  protocol: 'openai-completions',
  baseUrl: DOUBAO_ORIGIN,
  // 豆包客户端运行中 Cookies 被独占锁，提供扫码登录 + 粘贴 Cookie 两种稳定方式
  authMethods: ['browser', 'credential'],
  credentialHint: '粘贴含 sessionid / sessionid_ss 的豆包 Cookie 字符串',
  // 纯 HTTP 每日签到会触发 710010702 并导致当日额度作废，因此不提供自动签到写操作，只做只读查询与显式任务领取。
  taskResetHour: 0,
  fallbackModels: DOUBAOWORK_FALLBACK_MODELS,
  sanitizeCredential: sanitizeDoubaoWorkCredential,

  async loginWithBrowser({ fetch, signal, onUrl }) {
    const loginUrl = `${DOUBAO_ORIGIN}/chat`
    const harvested = await launchIsolatedBrowserCookieLogin({
      url: loginUrl,
      cookieUrls: [DOUBAO_ORIGIN, 'https://www.doubao.com', 'https://doubao.com'],
      onUrl,
      signal,
      fetchImpl: fetch,
      async matchCookies(cookies) {
        const matched = cookies.filter(c => typeof c?.domain === 'string' && /(^|\.)doubao\.com$/i.test(c.domain))
        const byName = new Map()
        for (const c of matched) {
          if (c?.name && typeof c.value === 'string' && c.value) byName.set(c.name, c.value)
        }
        if (!byName.get('sessionid') && !byName.get('sessionid_ss')) return null
        const cookieStr = [...byName.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
        const base = sanitizeDoubaoWorkCredential({ cookie: cookieStr })
        if (!base) return null
        try {
          const hydrated = await hydrateSessionContext(fetch, base, signal)
          return {
            credential: sanitizeDoubaoWorkCredential(hydrated),
            uid: hydrated.uid,
            name: hydrated.screenName || `豆包工作 (${hydrated.uid.slice(-4)})`,
          }
        } catch {
          return null
        }
      },
    })
    return harvested ?? { signedIn: false }
  },

  async parseCredential(raw, { fetch, signal }) {
    let input = raw
    if (raw.startsWith('{')) {
      try { input = JSON.parse(raw) } catch { throw new Error('JSON 凭据格式无效') }
    } else {
      input = { cookie: raw }
    }
    const base = sanitizeDoubaoWorkCredential(input)
    if (!base) throw new Error('Cookie 中缺少 sessionid 或 sessionid_ss')
    const hydrated = await hydrateSessionContext(fetch, base, signal)
    return {
      credential: sanitizeDoubaoWorkCredential(hydrated),
      uid: hydrated.uid,
      name: hydrated.screenName || `豆包工作 (${hydrated.uid.slice(-4)})`,
    }
  },

  async fetchModels(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred) return []
    const res = await handle.fetch(`${DOUBAO_ORIGIN}/chat`, {
      headers: commonHeaders(cred, { Accept: 'text/html,application/xhtml+xml' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)].filter(Boolean)),
    })
    if (!res.ok) return []
    const html = await res.text()
    const live = parseDoubaoSsrModels(html)
    if (!live.length) return []
    const seen = new Set(live.map(m => m.id))
    return [...live, ...DOUBAOWORK_FALLBACK_MODELS.filter(m => !seen.has(m.id))]
  },

  async fetchUsage(handle, { signal }) {
    let cred = await handle.getCredential()
    if (!cred) return { signedIn: false, error: 'credential_error' }
    let campaignGroupCode = ''
    try {
      const hydrated = await hydrateSessionContext(handle.fetch, cred, signal)
      campaignGroupCode = hydrated.campaignGroupCode || ''
      cred = sanitizeDoubaoWorkCredential(hydrated) || cred
      await handle.saveCredential(cred).catch(() => {})
    } catch {
      return { signedIn: false, error: 'auth_expired' }
    }
    const post = (path, body) => fetchJson(handle.fetch, buildDoubaoUrl(path, cred), {
      method: 'POST',
      headers: commonHeaders(cred, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    }, 8000)

    const [summary, overview, campaign] = await Promise.all([
      post('/alice/commerce/sale/subscription/quota/summary/', { product_line: 'membership' }).catch(() => null),
      post('/alice/commerce/sale/subscription/overview/', { product_line: 'membership' }).catch(() => null),
      campaignGroupCode
        ? post('/alice/ug/campaign/v3/detail/', { campaign_group_code: campaignGroupCode }).catch(() => null)
        : Promise.resolve(null),
    ])

    const windows = []
    const sections = [
      summary?.data?.window_limit_section,
      summary?.data?.incentive_quota_section,
      summary?.data?.enterprise_window_limit_section,
    ].filter(Boolean)
    let firstBalance = null
    for (const sec of sections) {
      for (const group of Array.isArray(sec.window_limit_groups) ? sec.window_limit_groups : []) {
        for (const lim of Array.isArray(group.window_limits) ? group.window_limits : []) {
          const total = Number(lim.total_amount)
          const usedAmt = Number(lim.used_amount)
          // 赠送套餐 used_percent 恒为 0：优先以 total_amount - used_amount 为准
          const hasTotal = Number.isFinite(total) && total > 0
          const remain = hasTotal && Number.isFinite(usedAmt) ? Math.max(0, total - usedAmt) : null
          const pct = hasTotal && Number.isFinite(usedAmt)
            ? Math.min(100, Math.max(0, Math.round((usedAmt / total) * 100)))
            : (Number.isFinite(lim.used_percent) ? lim.used_percent : null)
          if (firstBalance === null && remain !== null) firstBalance = remain
          windows.push({
            name: group.feature_group_name || '订阅额度',
            used: pct,
            amount: Number.isFinite(usedAmt) ? usedAmt : null,
            limit: hasTotal ? total : null,
            balance: remain,
            unit: '积分',
            resetsAt: Number.isFinite(lim.end_time) && lim.end_time > 0 ? new Date(lim.end_time * 1000).toISOString() : '',
          })
        }
      }
    }
    // 只读展示今日签到状态（不写请求，避免纯 HTTP 签到触发当日额度作废）
    const tasks = Array.isArray(campaign?.data?.tasks) ? campaign.data.tasks : []
    const checkinTask = tasks.find(t => t?.daily_checkin)
    if (checkinTask?.daily_checkin) {
      const dc = checkinTask.daily_checkin
      windows.push({
        name: dc.checked_in_today ? '今日签到（已签）' : '今日签到（待去客户端）',
        balance: Number(dc.reward?.reward_amount) || null,
        unit: '积分',
      })
    }
    const sub = overview?.data?.current_subscription
    const plan = sub?.display?.short_name || sub?.display?.product_name || (overview?.data?.is_membership_gift ? '赠送订阅' : '免费版')
    return {
      signedIn: true,
      uid: cred.uid || '',
      name: cred.screenName || handle.entry?.name,
      plan,
      balance: firstBalance,
      unit: '积分',
      windows,
      updatedAt: Date.now(),
    }
  },

  // 显式任务奖励领取（只对已 Completed 且带完整 task_id 的任务尝试领取；biz_error.code===3 按 pending 返回）
  async completeTasks(handle, { signal }) {
    const cred = await handle.getCredential()
    if (!cred) return { kind: 'failed', retryable: true }
    const hydrated = await hydrateSessionContext(handle.fetch, cred, signal)
    const groupCode = hydrated.campaignGroupCode
    if (!groupCode) return { kind: 'empty', completed: 0 }
    const detail = await fetchJson(handle.fetch, buildDoubaoUrl('/alice/ug/campaign/v3/detail/', hydrated), {
      method: 'POST',
      headers: commonHeaders(hydrated, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ campaign_group_code: groupCode }),
      signal,
    }, 8000)
    const tasks = Array.isArray(detail?.data?.tasks) ? detail.data.tasks : []
    const okBizCodes = new Set(['0', '4', '6'])
    let completed = 0
    let pending = 0
    for (const task of tasks) {
      // 跳过每日签到任务，只尝试已达标（Completed）且具备 task_id 与 campaign_code 的普通任务
      if (!task?.task_id || !task?.campaign_code || task.daily_checkin) continue
      if (task.task_status !== 3 && task.task_status !== 'Completed') continue
      try {
        const res = await fetchJson(handle.fetch, buildDoubaoUrl('/alice/ug/campaign/item/reward/claim/', hydrated), {
          method: 'POST',
          headers: commonHeaders(hydrated, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            task_id: task.task_id,
            campaign_group_code: groupCode,
            campaign_item_code: task.campaign_code,
          }),
          signal,
        }, 8000)
        const bizCode = res?.biz_error?.code !== undefined ? String(res.biz_error.code) : '0'
        if (!res?.biz_error || okBizCodes.has(bizCode)) completed += 1
        else if (bizCode === '3') pending += 1
      } catch {}
    }
    if (completed > 0) return { kind: 'completed', completed }
    if (pending > 0) return { kind: 'pending', retryable: false }
    return { kind: 'done', completed: 0 }
  },

  async createTransport(handle) {
    const cred = await handle.getCredential()
    if (!cred) throw new Error('豆包工作凭据缺失')
    return {
      cred,
      deviceId: handle.entry?.deviceId || '',
      fetch: handle.fetch,
    }
  },

  // 豆包工作自定义 SSE 补丁流适配器（兼容 pi-ai stream / streamSimple，含工具调用解析与流取消）
  customStream({ model, row, context, options, request, selectTransport }) {
    const eventStream = (async function* () {
      const transport = await selectTransport(model.id, request)
      const prompt = packDoubaoMessages(context)
      const body = buildDoubaoCompletionBody({
        cred: transport.cred,
        row,
        textPrompt: prompt,
        effort: request?.reasoningEffort || row?.effectiveEffort || 'high',
      })
      const url = buildDoubaoUrl('/chat/completion', transport.cred, {}, transport.deviceId)
      const res = await transport.fetch(url, {
        method: 'POST',
        headers: commonHeaders(transport.cred, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        signal: options?.signal,
      })
      if (!res.ok || !res.body) throw new Error(`豆包工作请求失败（HTTP ${res.status}）`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const hasTools = Array.isArray(context?.tools) && context.tools.length > 0
      let buffer = ''
      let currentEvent = ''
      const parseState = { thinkingBlocks: new Set(), lastIsThinking: false, conversationId: '' }
      let fullText = ''
      let fullThinking = ''
      let thinkingStarted = false
      let textStarted = false
      const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      const partial = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: emptyUsage, stopReason: 'stop', timestamp: Date.now() }
      yield { type: 'start', partial }
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim()
              continue
            }
            if (!line.startsWith('data:')) continue
            const dataStr = line.slice(5).trim()
            if (!dataStr || dataStr === '[DONE]') continue
            let parsed
            try { parsed = JSON.parse(dataStr) } catch { continue }
            const events = parseDoubaoSseBlock(currentEvent, parsed, parseState)
            for (const ev of events) {
              if (ev.kind === 'thinking') {
                if (!thinkingStarted) {
                  thinkingStarted = true
                  yield { type: 'thinking_start', contentIndex: 0, partial }
                }
                fullThinking += ev.text
                yield { type: 'thinking_delta', contentIndex: 0, delta: ev.text, partial }
              } else {
                fullText += ev.text
                // 带工具时缓存正文至流尾以判断是否工具调用 JSON；无工具时实时流式输出
                if (!hasTools) {
                  if (thinkingStarted && !textStarted) {
                    yield { type: 'thinking_end', contentIndex: 0, content: fullThinking, partial }
                  }
                  const idx = thinkingStarted ? 1 : 0
                  if (!textStarted) {
                    textStarted = true
                    yield { type: 'text_start', contentIndex: idx, partial }
                  }
                  yield { type: 'text_delta', contentIndex: idx, delta: ev.text, partial }
                }
              }
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
      }

      if (thinkingStarted && !textStarted) {
        yield { type: 'thinking_end', contentIndex: 0, content: fullThinking, partial }
      }
      const content = []
      let nextIndex = 0
      if (fullThinking) {
        content.push({ type: 'thinking', thinking: fullThinking })
        nextIndex = 1
      }
      const allowedTools = hasTools ? context.tools.map(t => t?.name).filter(Boolean) : null
      const extracted = hasTools ? extractDoubaoToolCalls(fullText, allowedTools) : null
      if (extracted) {
        if (extracted.content) {
          yield { type: 'text_start', contentIndex: nextIndex, partial }
          yield { type: 'text_delta', contentIndex: nextIndex, delta: extracted.content, partial }
          yield { type: 'text_end', contentIndex: nextIndex, content: extracted.content, partial }
          content.push({ type: 'text', text: extracted.content })
          nextIndex += 1
        }
        for (const tc of extracted.toolCalls) {
          const toolBlock = { type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.arguments }
          const argsJson = JSON.stringify(tc.arguments)
          yield { type: 'toolcall_start', contentIndex: nextIndex, partial: { ...partial, content: [...content, toolBlock] } }
          yield { type: 'toolcall_delta', contentIndex: nextIndex, delta: argsJson, partial: { ...partial, content: [...content, toolBlock] } }
          yield { type: 'toolcall_end', contentIndex: nextIndex, toolCall: toolBlock, partial: { ...partial, content: [...content, toolBlock] } }
          content.push(toolBlock)
          nextIndex += 1
        }
        yield {
          type: 'done',
          reason: 'toolUse',
          message: { ...partial, content, stopReason: 'toolUse', timestamp: Date.now() },
        }
        return
      }
      if (fullText) {
        if (!textStarted) {
          yield { type: 'text_start', contentIndex: nextIndex, partial }
          yield { type: 'text_delta', contentIndex: nextIndex, delta: fullText, partial }
        }
        yield { type: 'text_end', contentIndex: nextIndex, content: fullText, partial }
        content.push({ type: 'text', text: fullText })
      }
      yield {
        type: 'done',
        reason: 'stop',
        message: { ...partial, content, stopReason: 'stop', timestamp: Date.now() },
      }
    })()
    return eventStream
  },
}
