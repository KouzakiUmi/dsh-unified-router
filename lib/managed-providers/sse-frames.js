const MAX_FRAME_CHARS = 2 * 1024 * 1024

export async function* readSseFrames(body, { signal, frameTooLarge }) {
  signal?.throwIfAborted()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  let buffer = '', event = '', data = [], size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true })
      // Retain a trailing CR until the next chunk can distinguish CRLF from CR.
      const trailingCR = !done && buffer.endsWith('\r')
      const lines = (trailingCR ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/)
      buffer = (lines.pop() ?? '') + (trailingCR ? '\r' : '')
      for (const line of lines) {
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') }
          event = ''; data = []; size = 0
          continue
        }
        size += line.length + 1
        if (size > MAX_FRAME_CHARS) throw frameTooLarge()
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (buffer.length + size > MAX_FRAME_CHARS) throw frameTooLarge()
      if (done) return
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function isSseResponse(response) {
  return /^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')
}
