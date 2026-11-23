import { isSseResponse, readSseFrames } from './sse-frames.js'

const encoder = new TextEncoder()
const encode = value => encoder.encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
const gatewayError = { error: { message: 'CodeArts 网关返回了流式请求错误' } }
const malformed = { error: { message: 'CodeArts 网关返回了无法解析的回复' } }
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasCalls = value => Array.isArray(value?.tool_calls) && value.tool_calls.length > 0
const hasText = value => typeof value?.content === 'string' && value.content.length > 0
const hasReasoning = value => ['reasoning_content', 'reasoning', 'reasoning_text']
  .some(key => typeof value?.[key] === 'string' && value[key].length > 0)

export function normalizeCodeArtsStream(response, { model, signal }) {
  if (!response.ok || !response.body) return response
  const sse = isSseResponse(response)
  if (!sse && !/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.set('content-type', 'text/event-stream')
  const body = ReadableStream.from(sse ? codeArtsFrames(response.body, { model, signal }) : codeArtsJson(response.body, signal))
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

function hasBusinessError(value) {
  return value?.error || (value?.error_code != null && String(value.error_code) !== '0')
}

function normalizeChoice(choice, state, complete = false) {
  if (!isObject(choice)) return choice
  const message = isObject(choice.message) ? choice.message : null
  let delta = choice.delta
  if (message) {
    delta = isObject(delta) ? { ...delta } : {}
    if (!state.text && !hasText(delta) && hasText(message)) delta.content = message.content
    if (!state.reasoning && !hasReasoning(delta) && hasReasoning(message)) {
      delta.reasoning_content = message.reasoning_content || message.reasoning || message.reasoning_text
    }
    if (!state.tools && !hasCalls(delta) && hasCalls(message)) {
      delta.tool_calls = message.tool_calls.map((call, index) => ({ ...call, index: call?.index ?? index }))
    }
  }
  state.text ||= hasText(delta)
  state.reasoning ||= hasReasoning(delta)
  state.tools ||= hasCalls(delta)
  let reason = choice.finish_reason ?? (complete ? 'stop' : null)
  if (reason === 'other' || (reason === 'stop' && state.tools)) reason = state.tools ? 'tool_calls' : 'stop'
  state.finished ||= Boolean(reason)
  return { ...choice, delta, finish_reason: reason }
}

async function* codeArtsJson(body, signal) {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  let size = 0, data = ''
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) { yield encode(malformed); return }
      data += decoder.decode(value, { stream: true })
    }
    let value
    try { value = JSON.parse(data + decoder.decode()) } catch { yield encode(malformed); return }
    if (hasBusinessError(value)) { yield encode(gatewayError); return }
    if (!Array.isArray(value?.choices) || !value.choices.length || !value.choices.every(choice => isObject(choice?.message))) {
      yield encode(malformed)
      return
    }
    yield encode({ ...value, object: 'chat.completion.chunk', choices: value.choices.map(choice => normalizeChoice(choice, {}, true)) })
    yield encode('[DONE]')
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function* codeArtsFrames(body, { model, signal }) {
  const chunk = (content, finish_reason = null) => ({ model, choices: [{ index: 0, delta: { content }, finish_reason }] })
  const choices = new Map()
  let legacy = false, text = ''
  for await (const frame of readSseFrames(body, { signal, frameTooLarge: () => new Error('CodeArts 回复事件过大') })) {
    const data = frame.data.trim()
    if (!data) continue
    const rawDone = data === '[DONE]'
    if (frame.event === 'error') { yield encode(gatewayError); return }
    let value
    try { value = rawDone ? null : JSON.parse(data) } catch { yield encode(malformed); return }
    if (hasBusinessError(value)) {
      yield encode(gatewayError)
      return
    }
    if (rawDone || value?.text === '[DONE]') {
      const primary = choices.get(0)
      if (!primary?.finished) yield encode(chunk('', primary?.tools ? 'tool_calls' : 'stop'))
      yield encode('[DONE]')
      return
    }
    if (Array.isArray(value?.choices)) {
      yield encode({ ...value, choices: value.choices.map((choice, index) => {
        const key = choice?.index ?? index
        if (!choices.has(key)) choices.set(key, { text: legacy && key === 0 })
        return normalizeChoice(choice, choices.get(key))
      }) })
      continue
    }
    // The legacy gateway sends single deltas or cumulative `text` snapshots.
    const delta = value?.delta?.content
    if (typeof delta === 'string' && delta) {
      legacy = true
      text += delta
      yield encode(chunk(delta))
    } else if (typeof value?.text === 'string' && value.text.length > text.length && value.text.startsWith(text)) {
      legacy = true
      yield encode(chunk(value.text.slice(text.length)))
      text = value.text
    }
  }
}
