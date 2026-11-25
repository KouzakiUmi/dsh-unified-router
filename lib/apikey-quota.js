// 控制台额度读取与限流识别的**通用执行器**。
//
// 渠道差异（请求哪个地址、用什么鉴权头、成功码在 `code` 还是 `errorCode`、
// 窗口字段怎么解、哪些码算限流）全部由规格的 `consoleQuota` / `rateLimit`
// 声明，见 `lib/apikey-providers.js`。本文件**不含任何渠道名判断** ——
// 加一个 API Key 渠道只需要写规格，不需要改这里。
//
// 上一版把两家写成共享层里的一串 `provider === 'agnes' ? … : …`：凭据形态、
// 鉴权头、成功码、五个窗口全都要么走 agnes 分支要么走 else 分支，第三个渠道
// 接进来只能继续嵌套三元。这是本次重写要消掉的那类耦合。
import { projectApiKeyRateLimit } from './apikey-quota-projection.js'

/**
 * 读控制台额度。
 *
 * @param spec 渠道规格（必须带 `consoleQuota` 才读控制台）
 * @param fetchJson 注入的取数函数，签名 `(request, signal) => json`
 * @param consoleSession 宿主凭据里存的控制台会话（浏览器登录收割或粘贴）；
 *        优先于环境变量；两者都没有报 `needs-console`。会话原文不进任何返回值。
 * @returns `null`（该渠道没有控制台额度）或 `{ status, windows?, gifts?, balance?, updatedAt? }`
 */
export async function readApiKeyQuota(spec, fetchJson, signal, env = process.env, consoleSession = null) {
  const recipe = spec?.consoleQuota
  if (!recipe) return null
  const session = (typeof consoleSession === 'string' && consoleSession.trim()
    ? consoleSession
    : env?.[recipe.credentialEnv])?.trim()
  if (!session) return { status: 'needs-console' }
  const readyResult = parsed => {
    if ((parsed?.windows?.length ?? 0) > 0 || (parsed?.gifts?.length ?? 0) > 0 || parsed?.balance != null) {
      return {
        status: 'ready',
        windows: parsed.windows ?? [],
        ...(parsed.gifts?.length ? { gifts: parsed.gifts } : {}),
        balance: parsed.balance ?? null,
        updatedAt: Date.now(),
      }
    }
    return null
  }
  // 多步/自定义协议（如先 GET 页面取 CSRF/SEC_TOKEN 再 POST 网关）由规格通过 `fetch` 声明。
  if (typeof recipe.fetch === 'function') {
    try {
      const outcome = await recipe.fetch(session, fetchJson, signal)
      signal?.throwIfAborted()
      if (outcome?.expired === true) return { status: 'expired' }
      return readyResult(outcome) ?? { status: 'unavailable' }
    } catch (error) {
      signal?.throwIfAborted()
      if (error?.expired === true || [401, 403].includes(error?.status)) return { status: 'expired' }
      return { status: 'error' }
    }
  }
  const headers = recipe.headers(session)
  const settled = await Promise.allSettled(
    recipe.paths.map(path => fetchJson({ url: recipe.baseUrl + path, headers }, signal)),
  )
  signal?.throwIfAborted()
  const parsed = recipe.read(settled.map(item => item.status === 'fulfilled' ? recipe.pick(item.value) : null))
  // 「有数据」的判据沿用上游口径：任一窗口、任一赠送额度、或余额非空即算读到。
  const ready = readyResult(parsed)
  if (ready) return ready
  // 过期判据：HTTP 401/403 的拒答，或业务码 / 错误串命中规格声明。
  const expiredCodes = new Set(recipe.expiredCodes ?? [])
  const expired = settled.some(item => {
    if (item.status === 'rejected') return [401, 403].includes(item.reason?.status)
    if (item.value == null) return false
    if (expiredCodes.has(String(item.value?.code ?? item.value?.errorCode ?? item.value?.status ?? ''))) return true
    return recipe.expiredPattern
      ? recipe.expiredPattern.test(String(item.value?.errorMsg ?? item.value?.message ?? item.value?.msg ?? ''))
      : false
  })
  if (expired) return { status: 'expired' }
  return { status: settled.some(item => item.status === 'fulfilled') ? 'unavailable' : 'error' }
}

// Inspect small JSON envelopes without consuming the caller's response or touching SSE.
async function peekApiKeyError(response) {
  if (!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body || response.bodyUsed) return null
  const reader = response.clone().body.getReader()
  const decoder = new TextDecoder()
  let timer, size = 0, text = ''
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 300) })
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), timeout])
      if (!part) return null
      if (part.done) return JSON.parse(text + decoder.decode())
      size += part.value.byteLength
      if (size > 16_384) return null
      text += decoder.decode(part.value, { stream: true })
    }
  } catch { return null } finally { clearTimeout(timer); void reader.cancel().catch(() => {}) }
}

/**
 * 通用限流/耗尽判据（默认值，渠道规格可用 `throttlePattern` / `exhaustedPattern` 覆盖）。
 *
 * 为什么用文本判据而不是错误码表：上游对「每分钟 Token 超限」与「账户额度用尽」
 * 用同一个错误码（百炼 429 实测两者都是 `insufficient_quota`），只查码必然误判；
 * 而各家的码表既不稳定也无法穷举。同类实现（magpie 网关）同样以正文措辞为主判据，
 * 只在少数明确码上走快路径 —— 这里沿用同一口径。
 *
 * 判定顺序：**先认「明确指向用尽」且不指向限流的**（真耗尽不能换号/不能当可重试），
 * 其余落到限流或未知。文本取自错误正文的 message。
 */
const DEFAULT_THROTTLE_PATTERN = new RegExp([
  'rate[\\s_.-]?limit', 'frequency[\\s_.-]?limit', 'too many requests',
  'per[\\s_.-]?(?:second|sec|minute|min)\\b', '\\b[rt]p[ms]\\b',
  '(?:token|call|request)[\\s_.-]+rate[\\s_.-]+limit',
  '每分钟', '每秒', '频率', '太频繁', '过于频繁', '速率',
  'token[\\s_.-]?limit',
].join('|'), 'i')
const DEFAULT_EXHAUSTED_PATTERN = new RegExp([
  'insufficient[\\s_.-]?(?:balance|credit|fund)', '\\bcredits? (?:are )?exhausted\\b',
  'credit[\\s_.-]?balance[\\s_.-]?exhausted', 'out of (?:credits?|budget)',
  'budget.{0,32}(?:exceeded|exhausted)', 'free[\\s_.-]?tier', 'free[\\s_.-]?quota',
  '余额不足', '欠费', '请充值', 'arrears',
].join('|'), 'i')

/**
 * 识别限流信号。
 *
 * 规格用四个字段表达差异：
 * - `scanOnOk`：有的上游用 2xx + 业务码回限流（云知声 `100501`/`100502`），
 *   这类渠道连成功响应也要读 body；其余渠道只在 429 时读。
 * - `codes`：业务码 → `rpm` / `tpm` 的映射。
 * - `throttlePattern` / `exhaustedPattern`：可选覆盖默认文本判据。
 */
export async function detectApiKeyRateLimit(spec, response, now = Date.now()) {
  const recipe = spec?.rateLimit
  if (!recipe || !response?.headers) return null
  // 只在 429，或规格声明「2xx 也可能带限流」时才读 body。
  if (response.status !== 429 && !(recipe.scanOnOk === true && response.ok)) return null
  const body = await peekApiKeyError(response)
  // 错误信封有两种形状：OpenAI 兼容（`{error:{code,type,message}}`）与阿里云风格
  // （顶层 `{code,type,message}`）。只查 `error.*` 会把后者读成空串，进而把限流
  // 误判为「unknown」。两种都要取。
  const code = String(body?.base_resp?.status_code ?? body?.error?.code ?? body?.code ?? body?.error?.type ?? body?.type ?? '')
  const type = String(body?.error?.type ?? body?.type ?? '')
  const message = String(body?.error?.message ?? body?.message ?? body?.msg ?? '')
  // 额度耗尽不是限流：这类信号交给额度面板，不参与换号。
  const exhausted = new Set([
    '100104', '220107', '220108', '220109',
    'insufficient_quota', 'insufficient_balance', 'billing_hard_limit_reached',
    ...(recipe.exhaustedCodes ?? []),
  ])
  // ⚠️ 上游会把**每分钟 Token 限流**也标成 `insufficient_quota`（百炼 429 实测：
  // `{"code":"insufficient_quota","message":"Allocated quota exceeded, please
  // increase your quota limit. …#token-limit"}`），只按错误码一刀切会把可恢复的
  // TPM 限流当成账户额度用尽。故用正文二次判定：明确指向限流的不算耗尽，
  // 明确指向额度/余额用尽的仍然排除。
  const looksThrottled = (recipe.throttlePattern ?? DEFAULT_THROTTLE_PATTERN).test(message)
  const looksExhausted = (recipe.exhaustedPattern ?? DEFAULT_EXHAUSTED_PATTERN).test(message)
  if (looksExhausted && !looksThrottled) return null
  if ((exhausted.has(code) || exhausted.has(type)) && !looksThrottled) return null
  const reason = recipe.codes?.[code] ?? recipe.codes?.[type] ?? (looksThrottled ? 'tpm' : 'unknown')
  if (reason === 'unknown' && response.status !== 429) return null
  const header = response.headers.get('retry-after')?.trim()
  const delay = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000
    : header && /^[A-Z]{3},/i.test(header) ? Date.parse(header) - now : NaN
  const estimated = !Number.isFinite(delay)
  return projectApiKeyRateLimit({ until: now + (estimated ? 60_000 : Math.max(0, Math.ceil(delay))), reason, estimated })
}
