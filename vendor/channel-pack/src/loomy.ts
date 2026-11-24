/**
 * Loomy（讯飞办公助手）协议常量与纯函数。
 *
 * ## 与既有 provider 的关系
 *
 * Loomy 是本插件第 8 个、也是**唯一一个用短信验证码登录**的 provider
 * （其余 7 个都是浏览器 URL + 轮询）。认证走讯飞 CAccount
 * （`https://account.xfinfr.com`，HMAC-SHA1 签名，见 `loomy-sign.ts`），
 * 业务/推理走 `https://loomyad.xunfei.cn/api/v1`。
 *
 * ## 三个必须记住的坑
 *
 * 1. **两套认证头**：`/chat/completions` 只认 `Authorization: Bearer`，
 *    而 `/models`、`/points/*`、`/onboarding/*` 只认 `token`。实测交叉验证：
 *    带错的那个 → HTTP 200 + `{"code":"100002","desc":"缺少 token"}`。
 *    故 `loomyChatHeaders` 两个都发。
 * 2. **倍率在 `name` 字符串里**，没有独立字段（实测搜 `credit`/`multiplier`/
 *    `price`/`factor`/`rate` 全部 0 命中），且三种括号风格混用，必须规范化。
 * 3. **没有 refresh 端点**：`session` 是登录时声明 14 天得来的，过期只能重新
 *    短信登录。故 `isLoomyRefreshable` 恒 false —— 诚实标记，不是遗漏。
 *
 * ## 为什么复用 `openai-compat.ts`
 *
 * 实测 `/chat/completions` 是**标准 OpenAI 兼容 + 标准 SSE**
 * （`data:` 帧 + 空 `data:` 终止帧，无加密、无信封、无格式转换），
 * 与 qoder 同形，正是 `openai-compat.ts` 的适用场景。
 */

import { createHash } from 'node:crypto'

/** 业务端点基址（推理 / 模型列表 / 积分 / 新手任务）。 */
export const LOOMY_API_BASE = 'https://loomyad.xunfei.cn/api/v1'

/** 讯飞账号（CAccount）基址。 */
export const LOOMY_ACCOUNT_BASE = 'https://account.xfinfr.com'

/** 业务成功码。 */
export const LOOMY_OK_CODE = '000000'

/** 登录失效码。收到它**不得重试**，应标记凭据失效并提示重新登录。 */
export const LOOMY_AUTH_ERROR_CODE = '100002'

/** 参数错误码（如未知 task key）。 */
export const LOOMY_BAD_REQUEST_CODE = '100001'

/** 请求超时（毫秒）。与 Loomy 客户端一致。 */
export const LOOMY_REQUEST_TIMEOUT_MS = 60_000

/**
 * Loomy 凭据。
 */
export interface LoomyCredential {
  /** 讯飞 session（32 位小写 hex）。 */
  access_token: string
  /** 讯飞用户 id（18 位数字串）。 */
  userid: string
  /** 绑定的手机号（11 位）。 */
  phone: string
  /** 展示用昵称；Loomy 无昵称接口，缺省时 UI 回退到账号 id。 */
  nickname?: string
  /**
   * 过期时间（**毫秒时间戳字符串**）。
   *
   * 由登录时刻 + 14 天推算，**不是**服务端下发的值 —— 服务端只接受
   * 登录请求里的 `expire` 参数，响应里不带到期时间。
   */
  expires_at?: string
}

/** 业务响应信封。 */
export interface LoomyEnvelope<T> {
  ok: boolean
  code: string
  message: string
  data: T | undefined
}

/**
 * 解析 Loomy 的业务信封。
 *
 * ⚠️ Loomy 的业务失败**恒返回 HTTP 200**，成败只能读 body 的 `code`。
 * 只看状态码会把「登录已失效」误判成成功。
 */
export function parseLoomyEnvelope<T>(payload: unknown): LoomyEnvelope<T> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: '', message: '响应不是 JSON 对象', data: undefined }
  }
  const record = payload as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.desc === 'string' && record.desc.length > 0
    ? record.desc
    : (typeof record.message === 'string' ? record.message : '')
  if (code !== LOOMY_OK_CODE) {
    return {
      ok: false,
      code,
      message: message.length > 0 ? message : `业务错误 ${code || '(缺少 code)'}`,
      data: undefined,
    }
  }
  return { ok: true, code, message, data: record.data as T }
}

/**
 * 从展示名抽出倍率。
 *
 * 认**两种**形态，因为本模块同时处理「远端原值」与「已规范化的兜底表名」：
 *
 * 1. **远端原值**：倍率在末尾括号里，全角半角都认、括号前后空格可有可无
 *    —— 实测三种风格混用：`MiniMax M3 （x4.0）` / `Qwen 3.8 Max (x12.0)` /
 *    `GLM 5.3 Flash(x0.8)`。
 * 2. **已规范化形态** `{name} · x{n}`：兜底表（`loomy-product.ts`）存的就是
 *    这个形态。**必须支持**，否则 `resolveModel` 无法从兜底表名里去掉倍率
 *    （真实缺陷：`resolveModel` 会返回 `Spark X2.5 · x0.1` 而非 `Spark X2.5`）。
 *
 * ⚠️ 因此本函数**幂等**：`splitLoomyRate(loomyDisplayName(x))` 与
 * `splitLoomyRate(x)` 结果一致。单测锁死了这一点。
 *
 * 只认**末尾**的倍率（中间的括号属于模型名本身）。
 *
 * @returns `rate` 为**空串**表示该模型无倍率（如生图模型）。
 */
export function splitLoomyRate(rawName: string): { name: string; rate: string } {
  const original = typeof rawName === 'string' ? rawName.trim() : ''
  if (original.length === 0) return { name: '', rate: '' }

  // 形态 1：末尾括号 `（x1.0）` / `(x1.0)`
  const bracketed = original.match(/^(.*?)\s*[（(]\s*(x\s*[\d.]+)\s*[)）]\s*$/i)
  if (bracketed !== null) {
    const name = String(bracketed[1] ?? '').trim()
    const rate = String(bracketed[2] ?? '').replace(/\s+/g, '').toLowerCase()
    // 主体为空说明整个 name 就是个括号（畸形数据）：原样保留，不产出空名字。
    if (name.length > 0) return { name, rate }
    return { name: original, rate: '' }
  }

  // 形态 2：已规范化的 `{name} · x1.0`
  const normalized = original.match(/^(.*?)\s*·\s*(x\s*[\d.]+)\s*$/i)
  if (normalized !== null) {
    const name = String(normalized[1] ?? '').trim()
    const rate = String(normalized[2] ?? '').replace(/\s+/g, '').toLowerCase()
    if (name.length > 0) return { name, rate }
  }

  return { name: original, rate: '' }
}

/**
 * 最终展示名：`MiniMax M3 · x4.0`。
 *
 * ⚠️ 倍率必须拼进 `name`（**不是** `description`）：composer 的模型切换菜单
 * 只渲染 `name`，`description` 仅用于 `/model` 弹窗。无倍率时不追加分隔符，
 * 避免出现「模型名 · 」这种孤立分隔符。
 */
export function loomyDisplayName(rawName: string): string {
  const { name, rate } = splitLoomyRate(rawName)
  return rate.length > 0 ? `${name} · ${rate}` : name
}

/**
 * 是否为可对话的 chat 模型。
 *
 * ⚠️ 判据是 `type === 'chat'`。**不要**改用 `output_modalities` ——
 * 实测 5 个 chat 模型的 `input_modalities` 含 `image`（能看图），
 * 那是输入多模态，与「是不是生图模型」无关。
 */
export function isLoomyChatModel(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
  const record = entry as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  return id.length > 0 && record.type === 'chat'
}

/** 解析 `expires_at`（毫秒时间戳字符串）；缺失或非法返回 undefined。 */
export function credentialExpiresAtMs(credential: LoomyCredential): number | undefined {
  const raw = credential.expires_at
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * 凭据是否已过期。
 *
 * 无 `expires_at` 时视为**不过期**：宁可用一个可能过期的凭据去试
 * （服务端会回 `100002`，我们能识别），也不要凭猜测阻止用户使用。
 */
export function isLoomyExpired(credential: LoomyCredential): boolean {
  const expiresAt = credentialExpiresAtMs(credential)
  return expiresAt !== undefined && expiresAt <= Date.now()
}

/**
 * 凭据是否可静默续期。
 *
 * ⚠️ **恒返回 `false`** —— Loomy 没有任何 refresh 端点（实测：登录请求里的
 * `expire: 1209600` 只是向服务端声明有效期，凭据里没有 refresh_token）。
 * 这是**诚实标记**：账号卡片会据此显示「凭证过期，请重新登录」，
 * 而不是假装能续期却永远失败。
 */
export function isLoomyRefreshable(_credential: LoomyCredential): boolean {
  return false
}

/**
 * 客户端版本号（`loomy-version` 头）。
 *
 * 上游可能据此开关行为；跟客户端升级即可。取值依据抓包实证。
 */
export const LOOMY_CLIENT_VERSION = '0.9.39'

/**
 * 客户端 `User-Agent`。
 *
 * ⚠️ **不是 Electron/Chromium 串**：客户端实际发的是 **opencode 运行时**那一串
 * （抓包实证）。三个版本号要一起跟。
 * ⚠️ 不设时 Node 的 undici 会发 `user-agent: node`（实测），是最显眼的
 * 「不是客户端」痕迹之一。
 */
export const LOOMY_CLIENT_USER_AGENT = 'opencode/1.14.22 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13'

/** 客户端对话链路发出的 `Accept`（抓包实证：通配符，由 body 的 `stream` 决定是否流式）。 */
export const LOOMY_CLIENT_ACCEPT = '*/*'

/** 客户端 `Accept-Language`（不设时 undici 发 `*`，形态不同）。 */
export const LOOMY_CLIENT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9'

/** 对话主链路固定的请求用途。 */
export const LOOMY_REQUEST_PURPOSE_CHAT = 'chat.message'

/** 一个 8 位十六进制片段。 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * 生成一个 W3C `traceparent`：`00-<32hex>-<16hex>-01`。
 *
 * ⚠️ **每次请求都要新生成**：客户端每请求一个新 ID；复用同一个会被当成重放。
 */
export function newTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`
}

/**
 * 由账号身份派生一个**稳定**的 `ses_<20 位 [A-Za-z0-9]>`（`X-Session-Affinity`）。
 *
 * 这是「会话粘性」信号：同一个 uid 恒定、不同 uid 不同，纯派生不落盘。
 */
export function sessionAffinity(uid: string | undefined): string {
  const key = String(uid ?? '').trim()
  if (key.length === 0) return ''
  const digest = createHash('sha256').update(key).digest()
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let n = BigInt(`0x${digest.toString('hex')}`)
  let out = ''
  for (let i = 0; i < 20; i += 1) {
    out += alphabet[Number(n % 62n)]
    n /= 62n
  }
  return `ses_${out}`
}

/**
 * 业务端点请求头（`/models`、`/points/*`、`/onboarding/*`）。
 *
 * ⚠️ 这些端点**只认小写 `token` 头**，带 `Authorization: Bearer` 会被判
 * 「缺少 token」。故这里刻意不加 Authorization。
 */
export function loomyBusinessHeaders(token: string): Record<string, string> {
  return { Accept: 'application/json', token }
}

/**
 * chat 端点请求头。
 *
 * ⚠️ **两个头都发**：`/chat/completions` 只认 `Authorization: Bearer`，
 * 但官方客户端（`llm-completion.js:149-151`）在 session 模式下也是两个都发，
 * 保持一致可避免上游将来改判据。
 * ⚠️ `Bearer ` 前缀**必需**：实测无前缀同样回 `100002 缺少 token`。
 */
export function loomyChatHeaders(
  token: string,
  opts: { uid?: string } = {},
): Record<string, string> {
  const affinity = sessionAffinity(opts.uid)
  return {
    Accept: LOOMY_CLIENT_ACCEPT,
    'Content-Type': 'application/json',
    // ⚠️ 缺 traceparent 时上游 chat/completions 会挂死到超时（客户端注释实证）。
    // 每次请求都要新生成，复用同一个等于重放。
    traceparent: newTraceparent(),
    'loomy-version': LOOMY_CLIENT_VERSION,
    'X-Loomy-Request-Purpose': LOOMY_REQUEST_PURPOSE_CHAT,
    'User-Agent': LOOMY_CLIENT_USER_AGENT,
    'Accept-Language': LOOMY_CLIENT_ACCEPT_LANGUAGE,
    ...affinity.length > 0 ? { 'X-Session-Affinity': affinity } : {},
    Authorization: `Bearer ${token}`,
    token,
  }
}

/**
 * 官方客户端请求体里带的 `$comment`（构建遗留注释，每个请求都发）。
 *
 * 内容无业务含义，作用只是让出站 body 与客户端**形态一致**。
 */
export const LOOMY_CLIENT_BODY_COMMENT = '双写约束：下方 prompt 字面必须与 src/data/builtin-souls.js 的 BUILTIN_SOULS[id=loomy].prompt 完全一致。本文件是 bootstrap fallback，运行时以 BUILTIN_SOULS 注入为准；任何修改需两处同步。'
