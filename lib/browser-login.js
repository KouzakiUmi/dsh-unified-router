// 通用浏览器打开器与独立临时 Profile CDP Cookie 收割器（零第三方依赖，使用 Node 22+ 原生 WebSocket）。
// 用于 AStudio、豆包工作、Coze 等需要网页登录收割 Cookie 的渠道，以及 CodeArts 等 OAuth 渠道的多账号隔离登录。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function validateBrowserUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 4096 || /["\r\n]/.test(url)) return ''
  try {
    const parsed = new URL(url)
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return ''
    return parsed.href
  } catch {
    return ''
  }
}

export function findChromiumBrowser(platform = process.platform, env = process.env) {
  const explicit = env.UNIFIED_ROUTER_BROWSER || env.CHROME_PATH || env.EDGE_PATH
  if (explicit && existsSync(explicit)) return explicit
  const home = env.HOME || env.USERPROFILE || ''
  const candidates = platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ]
    : platform === 'win32'
      ? [
          join(env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/usr/bin/microsoft-edge',
        ]
  return candidates.find(candidate => candidate && existsSync(candidate)) || ''
}

export function openSystemBrowser(url) {
  const safe = validateBrowserUrl(url)
  if (!safe) return false
  try {
    if (process.platform === 'win32') {
      // 转义 % 防止 cmd 环境变量展开，双引号已在 validateBrowserUrl 中拒绝。
      const cmdSafe = safe.replace(/%/g, '%%')
      const child = spawn('cmd', ['/c', 'start', '""', `"${cmdSafe}"`], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      })
      child.on('error', () => {})
      child.unref()
      return true
    }
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(cmd, [safe], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

function removeProfileDir(profileDir) {
  if (!profileDir) return
  void rm(profileDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }).catch(() => {})
}

// 优先在隔离临时 Profile 的独立浏览器窗口打开 OAuth 链接（天然支持多账号），找不到 Chromium 时回退系统默认浏览器。
export async function openIsolatedOAuthBrowser(url, signal) {
  const safe = validateBrowserUrl(url)
  if (!safe) return { close() {} }
  const browserPath = findChromiumBrowser()
  if (!browserPath) {
    openSystemBrowser(safe)
    return { close() {} }
  }
  let profileDir = ''
  let child = null
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    try { child?.kill() } catch {}
    const dir = profileDir
    profileDir = ''
    setTimeout(() => removeProfileDir(dir), 300).unref?.()
  }
  try {
    profileDir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'))
    child = spawn(browserPath, [
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-default-apps',
      '--new-window',
      safe,
    ], { stdio: 'ignore' })
    child.on('error', () => {
      cleanup()
      openSystemBrowser(safe)
    })
  } catch {
    cleanup()
    openSystemBrowser(safe)
    return { close() {} }
  }
  signal?.addEventListener('abort', cleanup, { once: true })
  return {
    close() {
      signal?.removeEventListener('abort', cleanup)
      cleanup()
    },
  }
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function getCdpWsUrl(port, fetchImpl = globalThis.fetch) {
  try {
    const verRes = await fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    if (verRes.ok) {
      const ver = await verRes.json()
      if (typeof ver?.webSocketDebuggerUrl === 'string' && ver.webSocketDebuggerUrl) {
        return ver.webSocketDebuggerUrl
      }
    }
  } catch {}
  try {
    const listRes = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (listRes.ok) {
      const list = await listRes.json()
      const page = Array.isArray(list) ? list.find(t => t?.type === 'page' && t.webSocketDebuggerUrl) : null
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    }
  } catch {}
  return ''
}

function cdpCall(wsUrl, method, params = {}, timeoutMs = 4000, WebSocketImpl = globalThis.WebSocket) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocketImpl !== 'function') return reject(new Error('当前运行时缺少 WebSocket'))
    let ws
    try { ws = new WebSocketImpl(wsUrl) } catch (err) { return reject(err) }
    let settled = false
    const finish = (fn, val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      fn(val)
    }
    const timer = setTimeout(() => finish(reject, new Error('CDP 请求超时')), timeoutMs)
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ id: 1, method, params })) } catch (err) { finish(reject, err) }
    }
    ws.onerror = () => finish(reject, new Error('CDP 连接失败'))
    ws.onmessage = event => {
      let msg
      try { msg = JSON.parse(String(event.data)) } catch { return }
      if (msg.id !== 1) return
      if (msg.error) finish(reject, new Error(msg.error.message || 'CDP 错误'))
      else finish(resolve, msg.result)
    }
  })
}

async function readBrowserCookies(port, cookieUrls, fetchImpl = globalThis.fetch) {
  const wsUrl = await getCdpWsUrl(port, fetchImpl)
  if (!wsUrl) return []
  try {
    const res = await cdpCall(wsUrl, 'Storage.getCookies', {})
    if (Array.isArray(res?.cookies)) return res.cookies
  } catch {}
  try {
    const res = await cdpCall(wsUrl, 'Network.getCookies', cookieUrls?.length ? { urls: cookieUrls } : {})
    if (Array.isArray(res?.cookies)) return res.cookies
  } catch {}
  return []
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已取消'))
    const onAbort = () => { clearTimeout(timer); reject(new Error('已取消')) }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 启动独立临时 Profile 的本机 Chrome/Edge 打开官方登录页，轮询 CDP Cookie 直到 matchCookies 返回非空结果。
 */
export async function launchIsolatedBrowserCookieLogin({
  url,
  cookieUrls = [],
  matchCookies,
  onUrl,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5 * 60_000,
  pollIntervalMs = 1500,
}) {
  const safe = validateBrowserUrl(url)
  if (!safe) throw new Error('登录地址无效')
  const browserPath = findChromiumBrowser()
  if (!browserPath) {
    throw new Error('未找到本机 Chrome 或 Edge 浏览器，请改用「导入本机登录」或「粘贴凭据」')
  }
  const port = await getFreeLoopbackPort()
  let profileDir = ''
  let child = null
  let exited = false
  let spawnError = null
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { if (child && !exited) child.kill() } catch {}
    const dir = profileDir
    profileDir = ''
    setTimeout(() => removeProfileDir(dir), 400).unref?.()
  }
  const onAbort = () => cleanup()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    profileDir = await mkdtemp(join(tmpdir(), 'dsh-browser-login-'))
    onUrl?.(safe)
    child = spawn(browserPath, [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-background-mode',
      '--new-window',
      safe,
    ], { stdio: 'ignore' })
    child.on('error', err => {
      spawnError = err
      exited = true
    })
    child.once('exit', () => { exited = true })

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      if (spawnError) throw new Error('启动浏览器失败，请改用「导入本机登录」或「粘贴凭据」')
      if (exited) return null
      await sleep(pollIntervalMs, signal)
      if (spawnError) throw new Error('启动浏览器失败，请改用「导入本机登录」或「粘贴凭据」')
      if (exited) return null
      const cookies = await readBrowserCookies(port, cookieUrls, fetchImpl)
      if (!cookies.length) continue
      const matched = await matchCookies(cookies)
      if (matched) return matched
    }
    return null
  } finally {
    signal?.removeEventListener('abort', onAbort)
    cleanup()
  }
}
