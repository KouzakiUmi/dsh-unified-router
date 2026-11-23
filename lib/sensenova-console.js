import { createHash, randomBytes } from 'node:crypto'
import { launchIsolatedBrowserRedirectLogin } from './browser-login.js'
import { readSenseNovaQuota, SENSENOVA_CONSOLE_REF } from './sensenova-quota.js'

const origin = 'https://platform.sensenova.cn'
const tokenEndpoint = 'https://signin.sensecore.cn/oauth2/token'
const oauth = { client_id: 'nova', scope: 'openid offline offline_access' }
const token = value => typeof value === 'string' && /^[A-Za-z0-9_.~+\/=-]{1,16384}$/.test(value) ? value : ''

function parseStored(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('{')) return { accessToken: token(value.trim().replace(/^Bearer\s+/i, '')) }
  try {
    const row = JSON.parse(value)
    return { accessToken: token(row?.accessToken), refreshToken: token(row?.refreshToken), expiresAt: row?.expiresAt }
  } catch { return null }
}

export function createSenseNovaConsole(credentials, { fetchQuota, fetchOAuth = globalThis.fetch, browserLogin = launchIsolatedBrowserRedirectLogin } = {}) {
  const lifetime = new AbortController()
  let pendingRefresh, pendingLogin, rejectedRefresh
  const combine = signal => signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
  const quotaFor = (accessToken, signal) => readSenseNovaQuota({ resolve: () => ({ value: accessToken }) }, fetchQuota, signal)

  async function exchange(fields, signal) {
    const response = await fetchOAuth(tokenEndpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...oauth, ...fields }),
    })
    const body = await response.json().catch(() => null)
    if (response.status === 400 && body?.error === 'invalid_grant') return null
    const accessToken = token(body?.access_token)
    if (!response.ok || !accessToken) throw new Error('商汤控制台授权失败')
    return { accessToken, refreshToken: token(body?.refresh_token) || fields.refresh_token || '',
      expiresAt: Date.now() + (Number(body.expires_in) > 0 ? Math.min(86400, Number(body.expires_in)) : 10800) * 1000 }
  }

  async function refresh(service, raw, old) {
    if (rejectedRefresh === raw) return null
    if (!pendingRefresh) {
      pendingRefresh = (async () => {
        const next = await exchange({ grant_type: 'refresh_token', refresh_token: old.refreshToken }, lifetime.signal)
        lifetime.signal.throwIfAborted()
        if ((await service.resolve(SENSENOVA_CONSOLE_REF))?.value !== raw) return null
        if (!next) { rejectedRefresh = raw; return null }
        await service.set(SENSENOVA_CONSOLE_REF, JSON.stringify(next))
        return next
      })().finally(() => { pendingRefresh = null })
    }
    return pendingRefresh
  }

  async function read() {
    try {
      const service = credentials()
      const raw = (await service?.resolve(SENSENOVA_CONSOLE_REF))?.value
      const grant = parseStored(raw)
      if (!grant?.accessToken) return { status: 'needs-console' }
      const quota = grant.refreshToken && Number.isFinite(grant.expiresAt) && grant.expiresAt <= Date.now() + 60_000
        ? { status: 'expired' } : await quotaFor(grant.accessToken, lifetime.signal)
      if (quota.status !== 'expired' || !grant.refreshToken || pendingLogin) return quota
      const next = await refresh(service, raw, grant)
      return next ? quotaFor(next.accessToken, lifetime.signal) : quota
    } catch { return { status: 'error' } }
  }

  async function login(signal) {
    if (pendingLogin) throw new Error('商汤控制台登录正在进行')
    const active = combine(signal)
    const service = credentials()
    if (typeof service?.set !== 'function') throw new Error('凭据服务未就绪')
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({ ...oauth, response_type: 'code', redirect_uri: origin, state,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })
    pendingLogin = (async () => {
      const code = await browserLogin({ url: `${origin}/oauth2/auth?${query}`, callbackOrigin: origin, signal: active,
        matchRedirect(value) {
          const url = new URL(value)
          if (url.origin !== origin || url.pathname !== '/' || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) return null
          if (url.searchParams.has('error')) throw new Error('商汤控制台授权未完成')
          return url.searchParams.getAll('code').length === 1 ? token(url.searchParams.get('code')) : null
        },
      })
      active.throwIfAborted()
      if (!code) throw new Error('商汤控制台登录未完成')
      const grant = await exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: origin }, active)
      if (!grant) throw new Error('商汤控制台授权已过期')
      const quota = await quotaFor(grant.accessToken, active)
      if (quota.status === 'expired') throw new Error('商汤控制台未接受授权')
      // A rotation already in flight must finish before replacing the grant.
      await pendingRefresh?.catch(() => {})
      active.throwIfAborted()
      await service.set(SENSENOVA_CONSOLE_REF, JSON.stringify(grant))
      rejectedRefresh = undefined
      return quota
    })()
    try { return await pendingLogin } finally { pendingLogin = null }
  }

  return { read, login, dispose: () => lifetime.abort() }
}
