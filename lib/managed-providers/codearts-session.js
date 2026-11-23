import { createHash, randomUUID } from 'node:crypto'

const scopes = new WeakMap()
const BUSY_INTERVAL_MS = 25_000

export function codeArtsSessionId(id) {
  if (typeof id !== 'string' || !id) return randomUUID()
  return /^[a-zA-Z0-9_.:-]{1,128}$/.test(id) ? id : createHash('sha256').update(id).digest('hex')
}

// Concurrent streams for the same upstream account and session share one
// heartbeat. Serialize notifications so a slow idle cannot undo a later busy.
export function holdCodeArtsSession(scope, account, id, heartbeat) {
  let sessions = scopes.get(scope)
  if (!sessions) scopes.set(scope, sessions = new Map())
  const key = JSON.stringify([account, id])
  let state = sessions.get(key)
  if (!state) {
    state = { count: 0, tail: Promise.resolve(), timer: undefined, heartbeat }
    sessions.set(key, state)
  }
  const queue = status => {
    state.tail = state.tail.then(() => state.heartbeat(status)).catch(() => {})
    return state.tail
  }
  state.heartbeat = heartbeat
  if (state.count++ === 0) {
    queue('busy')
    state.timer = setInterval(() => { void queue('busy') }, BUSY_INTERVAL_MS)
    state.timer.unref?.()
  }
  let closeJob
  return {
    ready: state.tail,
    release() {
      if (closeJob) return closeJob
      if (--state.count > 0) return closeJob = Promise.resolve()
      clearInterval(state.timer)
      const idle = queue('idle')
      closeJob = idle.finally(() => {
        if (state.count === 0 && state.tail === idle && sessions.get(key) === state) sessions.delete(key)
      })
      return closeJob
    },
  }
}

// EOF, client cancellation, and provider errors all release the lease. The
// release request owns an independent deadline: the stream signal is cancelled
// precisely when the upstream slot still needs to be freed.
export function trackCodeArtsResponse(response, signal, release, normalize) {
  if (!response.ok || !response.body) return release().then(() => response)
  const stop = new AbortController()
  const stream = normalize(response, signal ? AbortSignal.any([signal, stop.signal]) : stop.signal)
  const reader = stream.body.getReader()
  let closing
  const close = () => closing ??= Promise.resolve().then(() => {
    signal?.removeEventListener('abort', abort)
    return release()
  })
  const abort = () => { stop.abort(signal.reason); void reader.cancel(signal.reason).catch(() => {}); void close() }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { await close(); controller.close() }
        else controller.enqueue(value)
      } catch (error) { await close(); controller.error(error) }
    },
    async cancel(reason) {
      stop.abort(reason)
      try { await reader.cancel(reason) } finally { await close() }
    },
  })
  return new Response(body, stream)
}
