// Independent WorkBuddy（腾讯 CodeBuddy 中国版）controller for Unified Router.
// 协议与网络原语在 vendor/workbuddy/index.mjs（上游
// @magpie-community/opencode-workbuddy-auth 0.2.35，MIT）中原样保留；本模块只负责
// 插件生命周期、DSH 凭据服务封装，以及对外的、不含秘密的快照契约。
//
// 驱动方式：WorkBuddyAuthPlugin 已是绑定中国站（SITES.workbuddy，
// copilot.tencent.com）的插件工厂，await 后得到 OpenCode 1.x 插件对象，本模块调用
// 其公开 hooks——auth.methods[].authorize()（浏览器登录）、auth.usage(getAuth)
// （额度）、auth.checkin(getAuth)（每日签到）、provider.models(provider,{auth})
// （模型目录）。_internal 仅作模型目录兜底（configModels）；不复制插件内部逻辑。
//
// 多账号：WorkBuddy 与 channel-pack 的账号池无关，自己维护一份账号索引——
//   UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS          JSON 数组 [{id, credentialRef, name, uid, createdAt}]
//   UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6HEX大写> 该账号的 auth JSON（sanitizeAuth 后的形状）
// 上游 hooks 都接受 getAuth 形参，故按账号闭包绑定 getAuth 即可隔离读取；续期回写
// 走 client.auth.set，而 client 是插件工厂期绑定的——所以**每个账号一个插件实例**，
// 每个实例的 client.auth.set 只知道自己那个账号的凭据引用，绝不会把 A 的续期结果
// 写到 B 名下（见 clientFor）。插件实例本身不持有账号状态（缓存按 uid 分键）。
//
// 旧单账号（UNIFIED_ROUTER_WORKBUDDY_AUTH）在索引缺失/为空时采纳为第一个账号，
// 采纳成功后清除旧引用——项目约定旧名只许「清除」，不复活。
//
// 安全性：凭据原文、上游响应正文与错误消息绝不进入快照或返回值。错误一律收编为
// SAFE_ERROR_CODES 里的固定码；窗口/模型/签到结果走白名单字段投影。
// 账号展示名（auth.accountId）与 uid 属账号标识，按契约出现在快照的 name/uid 字段。
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WorkBuddyAuthPlugin, _internal } from '../vendor/workbuddy/index.mjs'
import { createWorkBuddyModelSettings, WORKBUDDY_MODEL_WRITES } from './workbuddy-models.js'
import { readableModelName } from './model-catalog.js'
import { readCatalogCache, saveCatalogCache } from './catalog-cache.js'
import { PLAN_EFFORTS } from './sensenova-params.js'

export const WORKBUDDY_PROVIDER_ID = 'workbuddy'
export const WORKBUDDY_METHODS = Object.freeze(new Set([
  'workbuddy.snapshot',
  'workbuddy.login',
  'workbuddy.logout',
  'workbuddy.checkin',
  'workbuddy.setAccountEnabled',
  'workbuddy.models',
  ...WORKBUDDY_MODEL_WRITES,
]))

// 存储布局（迁移脚本需要对齐这三个名字）。
export const WORKBUDDY_ACCOUNTS_REF = 'UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS'
export const WORKBUDDY_ACCOUNT_REF_PREFIX = 'UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_'
// 改名前的单账号引用：采纳后只清除，不再写入。
export const WORKBUDDY_LEGACY_AUTH_REF = 'UNIFIED_ROUTER_WORKBUDDY_AUTH'

// 账号上限：索引里最多 8 条，登录时超过即拒绝。
export const WORKBUDDY_MAX_ACCOUNTS = 8

const ACCOUNT_ID_PATTERN = /^workbuddy-[0-9a-f]{8}$/
const ACCOUNT_REF_PATTERN = new RegExp(`^${WORKBUDDY_ACCOUNT_REF_PREFIX}[0-9A-F]{6}$`)

// 快照/签到/读凭据的固定文案：账号不存在（含刚被删除、并发变化）。
const ACCOUNT_CHANGED = '账号已变化，请刷新后重试'

// 签到 outcome 白名单：上游可能附带 message（上游原文），按设计不透出，只留 outcome。
const CHECKIN_OUTCOMES = new Set(['claimed', 'done', 'inactive', 'ineligible', 'failed'])

// 凭据字段白名单：只存登录成功对象给出的这几类标量字段；type 固定为 oauth。
// 不白名单的字段一律丢弃，避免凭据文件里长出未知结构。
const AUTH_STRING_FIELDS = new Set(['access', 'refresh', 'accountId', 'uid', 'domain', 'tokenType', 'enterpriseId', 'plan', 'machineId'])
const AUTH_NUMBER_FIELDS = new Set(['expires', 'refreshExpiresAt'])
const MAX_AUTH_FIELD = 8192

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const isoText = (value, max = 64) => typeof value === 'string' ? value.slice(0, max) : ''

function serviceOf(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {}
  try { return ctx?.[name] } catch { return undefined }
}

function assertProvider(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.provider !== WORKBUDDY_PROVIDER_ID) {
    throw new Error('不支持此渠道')
  }
}

// 登录地址沿用 rpc.js loginUrl 的校验口径（https，或本机回环的 http），
// 但报错文案不跨文件依赖：校验失败时整个登录作废，不把可疑地址交出去。
function assertLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('登录地址无效')
  let url
  try { url = new URL(value) } catch { throw new Error('登录地址无效') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('登录地址无效')
  return url.href
}

// sanitizeAuth 把任意输入收敛为可存储/可回喂给插件的 auth 对象：
// 必须有非空 access（或 source 非空——本模块不接 desktop/key，故只认 access），
// 字符串字段限长，数字字段须有限。解析失败的凭据按「损坏」处理而不是误当未登录。
function sanitizeAuth(value) {
  const row = object(value)
  const auth = { type: 'oauth' }
  for (const key of AUTH_STRING_FIELDS) {
    if (typeof row[key] === 'string' && row[key]) auth[key] = row[key].slice(0, MAX_AUTH_FIELD)
  }
  for (const key of AUTH_NUMBER_FIELDS) {
    if (typeof row[key] === 'number' && Number.isFinite(row[key])) auth[key] = row[key]
  }
  if (typeof auth.access !== 'string' || !auth.access) return null
  return auth
}

// sanitizeEntry 收敛索引条目：id/credentialRef 必须符合命名规则，否则整条丢弃
// （索引被手工改坏时按「少一个账号」处理，不让脏结构流进快照）。
function sanitizeEntry(value) {
  const row = object(value)
  const id = typeof row.id === 'string' && ACCOUNT_ID_PATTERN.test(row.id) ? row.id : ''
  const credentialRef = typeof row.credentialRef === 'string' && ACCOUNT_REF_PATTERN.test(row.credentialRef) ? row.credentialRef : ''
  if (!id || !credentialRef) return null
  return {
    id,
    credentialRef,
    name: text(row.name, 80),
    uid: text(row.uid, 120),
    createdAt: finite(row.createdAt) ?? Date.now(),
    // 账号开关：缺省视为启用（旧索引没有该字段）。只在显式关闭时落盘，
    // 避免给既有条目凭空加上字段。
    ...(row.enabled === false ? { enabled: false } : {}),
  }
}

// publicWindow 是 usage hook 返回窗口的白名单投影：上游窗口字段名固定（见
// usageOf/creditWindow/totalOf/enterpriseUsageOf/freeWindowOf），逐个按类型收敛，
// display 之类上游拼好的展示串保留但限长。
function publicWindow(source) {
  const row = object(source)
  const name = text(row.name, 80)
  if (!name) return null
  const out = {
    name,
    used: finite(row.used),
    amount: finite(row.amount),
    limit: finite(row.limit),
    balance: finite(row.balance),
    display: text(row.display, 120),
    unit: text(row.unit, 40),
    resetsAt: isoText(row.resetsAt),
    span: finite(row.span),
    runsOutAt: isoText(row.runsOutAt),
    runsOut: finite(row.runsOut),
    aside: row.aside === true,
    estimate: row.estimate === true,
  }
  if (Array.isArray(row.notModels)) {
    out.notModels = row.notModels.filter(id => typeof id === 'string').slice(0, 256).map(id => id.slice(0, 256))
  }
  if (Array.isArray(row.models)) {
    out.models = row.models.filter(id => typeof id === 'string').slice(0, 256).map(id => id.slice(0, 256))
  }
  return out
}

// publicModel 统一两种来源的模型投影：provider.models hook 的 OpenCode 条目
// （limit.context/limit.output、capabilities、free/rate）与 configModels 兜底
// （同名 limit 结构）。能力字段逐白名单，未声明的按 null/false。
function publicModel(source) {
  const row = object(source)
  const id = text(row.id, 256)
  if (!id || id.trim() !== id || ['__proto__', 'prototype', 'constructor'].includes(id)) return null
  const limit = object(row.limit)
  const capabilities = object(row.capabilities)
  const api = object(row.api).url !== undefined || object(row.provider).api !== undefined
    ? { npm: text(object(row.api).npm ?? object(row.provider).npm, 120), url: text(object(row.api).url ?? object(row.provider).api, 512) }
    : null
  const efforts = Array.isArray(row.efforts) ? row.efforts.filter(e => typeof e === 'string').slice(0, 32).map(e => e.slice(0, 40)) : null
  const variants = row.variants && typeof row.variants === 'object' && !Array.isArray(row.variants)
    ? Object.keys(row.variants).filter(e => typeof e === 'string').slice(0, 32).map(e => e.slice(0, 40))
    : null
  const effortIds = (efforts ?? variants ?? []).map(effort => effort === 'none' ? 'off' : effort)
  return {
    id,
    name: readableModelName(id, text(row.name, 160)),
    context: finite(limit.context) ?? finite(row.context),
    output: finite(limit.output) ?? finite(row.output),
    attachment: [object(capabilities.input).image, row.attachment, capabilities.attachment].find(value => typeof value === 'boolean') ?? null,
    reasoning: row.reasoning === true || capabilities.reasoning === true,
    efforts: PLAN_EFFORTS.filter(effort => effortIds.includes(effort)),
    defaultEffort: row.defaultEffort === 'none' ? 'off' : text(row.defaultEffort, 40),
    free: row.free === true || (row.free !== false && row.rate === 0),
    rate: finite(row.rate),
    rateWas: finite(row.rateWas),
    api,
  }
}

function publicCheckin(result) {
  const row = object(result)
  return {
    outcome: CHECKIN_OUTCOMES.has(row.outcome) ? row.outcome : 'failed',
    credit: finite(row.credit),
    streak: finite(row.streak),
  }
}

// 账号标识生成：id 是 workbuddy-<8hex>，凭据引用是 <前缀><6HEX 大写>。
// 两者都在已有序列表之外取值，避免碰撞（碰撞时重试，最多 32 次）。
function newAccountId(existing) {
  for (let i = 0; i < 32; i += 1) {
    const candidate = `workbuddy-${randomBytes(4).toString('hex')}`
    if (!existing.some(entry => entry.id === candidate)) return candidate
  }
  throw new Error('账号标识生成失败')
}

function newCredentialRef(existing) {
  for (let i = 0; i < 32; i += 1) {
    const candidate = `${WORKBUDDY_ACCOUNT_REF_PREFIX}${randomBytes(3).toString('hex').toUpperCase()}`
    if (!existing.some(entry => entry.credentialRef === candidate)) return candidate
  }
  throw new Error('凭据引用生成失败')
}

export function createWorkBuddyManager(ctx, rawConfig = {}, testDeps = {}) {
  const credentials = () => serviceOf(ctx, 'credentials') ?? null
  const logger = serviceOf(ctx, 'logger') ?? ctx?.logger
  const emit = typeof ctx?.emit === 'function' ? ctx.emit.bind(ctx) : undefined
  let disposed = false
  let loginQueue = Promise.resolve()
  // pendingLoginUrl：authorize() 给出的浏览器登录地址，仅在一次登录窗口内存在；
  // 快照透出它，让前端在 login 调用阻塞期间也能取到地址打开浏览器。
  let pendingLoginUrl = null
  // 每账号一个插件实例（client 绑定该账号的凭据引用），'' 表示无账号上下文
  // 的默认实例（登录流程与未登录时的站点目录兜底用，不会触发续期回写）。
  const pluginCache = new Map()
  const modelSettings = createWorkBuddyModelSettings(rawConfig.modelSettingsFile, { defaultMaxOutput: rawConfig.defaultMaxOutput })

  /**
   * 429 限流记账：账号 → 「被拒到什么时候」。
   *
   * ## 为什么需要它
   *
   * WorkBuddy 的免费模型（`deepseek-v4.1-flash`，中国版）有**独立于 credits** 的
   * 每账号 24 小时 token 窗口（约 2e8）。撞墙时上游回 429 并在文案里给出重置时刻：
   * `... your usage will reset at 2026-10-20 19:47:41 UTC+8, ...`。
   *
   * vendor 自带的 token 窗口计算**只读 Magpie 的 usage.jsonl**，DSH 的调用不写那里，
   * 所以在纯 DSH 环境该窗口永远不会亮。这里退一步：只记**被拒信号本身**，用于在
   * 额度面板如实显示「已满 · 重置于 X」——不需要 token 统计就能回答「还能不能用」。
   *
   * ⚠️ 记账必须发生在**换号之前**：换号成功后上层只看到 200，429 信号会丢失。
   */
  // 路径未知时置空：记账退化为不持久化（快照里也就不显示该窗口），不影响推理。
  const limitsFile = typeof rawConfig.limitsFile === 'string' && rawConfig.limitsFile
    ? rawConfig.limitsFile
    : typeof rawConfig.modelSettingsFile === 'string' && rawConfig.modelSettingsFile
      ? join(dirname(rawConfig.modelSettingsFile), 'workbuddy-limits.json')
      : ''

  const readLimits = () => {
    if (!limitsFile) return {}
    try {
      const parsed = JSON.parse(readFileSync(limitsFile, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }

  const writeLimits = next => {
    if (!limitsFile) return
    try {
      const temporary = `${limitsFile}.tmp`
      writeFileSync(temporary, JSON.stringify(next))
      renameSync(temporary, limitsFile)
    } catch { /* 记账失败不得影响推理 */ }
  }

  /**
   * 从 429 文案里取重置时刻（毫秒）。取不到返回 null（不猜）。
   * 上游按 UTC+8 报时且文案自带 `UTC+8`，因此固定按 +0800 解释。
   */
  const parseResetAt = text => {
    const match = /reset at\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/i.exec(String(text ?? ''))
    if (!match) return null
    const at = Date.parse(`${match[1]}T${match[2]}+08:00`)
    return Number.isFinite(at) ? at : null
  }

  const noteRateLimited = (accountId, until) => {
    if (!accountId || !Number.isFinite(until)) return
    const limits = readLimits()
    // 同一账号只保留更晚的重置时刻（并发请求可能先后撞墙）。
    const previous = finite(limits[accountId])
    if (previous !== undefined && previous >= until) return
    writeLimits({ ...limits, [accountId]: until })
  }

  const clearRateLimited = accountId => {
    const limits = readLimits()
    if (!(accountId in limits)) return
    const next = { ...limits }
    delete next[accountId]
    writeLimits(next)
  }
  const site = _internal.SITES[WORKBUDDY_PROVIDER_ID]
  let catalog = []
  let catalogAccount = null
  let catalogSource = 'fallback'
  let catalogJob = null
  let releaseAdapter = null
  let currentAdapter = null
  let adapterSignature = ''
  let routingJob = Promise.resolve()
  const lifetime = new AbortController()

  // ---- 凭据服务封装 -------------------------------------------------------
  const credentialRaw = async ref => {
    const service = credentials()
    if (!service || typeof service.resolve !== 'function') return { readable: false, raw: null }
    try {
      const raw = (await service.resolve(ref))?.value
      return { readable: true, raw: raw == null || raw === '' ? null : raw }
    } catch {
      // 凭据服务读失败等同「读不到」；按未登录处理，不让一次快照因存储故障抛错。
      return { readable: false, raw: null }
    }
  }

  const writeCredential = async (ref, value) => {
    const service = credentials()
    if (!service || typeof service.set !== 'function') throw new Error('凭据服务不可用')
    await service.set(ref, value)
  }

  const clearCredential = async ref => {
    const service = credentials()
    if (service && typeof service.unset === 'function') await service.unset(ref)
  }

  // ---- 账号索引 -----------------------------------------------------------
  const readIndex = async () => {
    const { readable, raw } = await credentialRaw(WORKBUDDY_ACCOUNTS_REF)
    if (!readable) return { state: 'unavailable', entries: [] }
    if (raw === null) return { state: 'absent', entries: [] }
    let parsed
    try { parsed = JSON.parse(raw) } catch { return { state: 'corrupt', entries: [] } }
    if (!Array.isArray(parsed)) return { state: 'corrupt', entries: [] }
    const entries = []
    for (const item of parsed) {
      const entry = sanitizeEntry(item)
      if (!entry) continue
      if (entries.some(other => other.id === entry.id || other.credentialRef === entry.credentialRef)) continue
      entries.push(entry)
      if (entries.length >= WORKBUDDY_MAX_ACCOUNTS) break
    }
    return { state: entries.length ? 'ok' : 'empty', entries }
  }

  const writeIndex = async entries => {
    // ⚠️ 必须透传 `enabled`：早期这里按字段白名单重建条目，新增字段会被静默丢弃。
    const rows = entries.slice(0, WORKBUDDY_MAX_ACCOUNTS).map(({ id, credentialRef, name, uid, createdAt, enabled }) => ({
      id, credentialRef, name, uid, createdAt,
      ...(enabled === false ? { enabled: false } : {}),
    }))
    await writeCredential(WORKBUDDY_ACCOUNTS_REF, JSON.stringify(rows))
  }

  // 旧单账号采纳：索引缺失/为空且旧引用存在时，把它复制成第一个账号。
  // 任何一步失败都按空账号处理（不抛错）；失败时保留旧引用，下次启动还能重试。
  // 成功后才清除旧引用——旧名只允许「清除」这一个写动作。
  const adoptLegacy = async () => {
    const { readable, raw } = await credentialRaw(WORKBUDDY_LEGACY_AUTH_REF)
    if (!readable || raw === null) return []
    let parsed
    try { parsed = JSON.parse(raw) } catch { return [] }
    const auth = sanitizeAuth(parsed)
    // 旧凭据损坏就不采纳（也不清除）：留着让用户手动重登，而不是静默销毁。
    if (!auth) return []
    const entry = {
      id: newAccountId([]),
      credentialRef: newCredentialRef([]),
      name: text(auth.accountId, 80),
      uid: text(auth.uid, 120),
      createdAt: Date.now(),
    }
    try {
      await writeCredential(entry.credentialRef, JSON.stringify(auth))
    } catch {
      return []
    }
    try {
      await writeIndex([entry])
    } catch {
      // 索引写失败：清掉刚写的凭据，保持「要么都成，要么都不成」。
      try { await clearCredential(entry.credentialRef) } catch {}
      return []
    }
    try { await clearCredential(WORKBUDDY_LEGACY_AUTH_REF) } catch {}
    return [entry]
  }

  // accounts 是所有方法的账号来源：索引损坏按空处理（不采纳、不覆盖，避免把
  // 损坏状态写成「一个账号都没有」的数据丢失），缺失/为空才走旧单账号采纳。
  const accounts = async () => {
    const index = await readIndex()
    if (index.state === 'ok' || index.state === 'unavailable') return index.entries
    if (index.state === 'corrupt') return []
    return adoptLegacy()
  }

  const readAccountAuth = async entry => {
    const { raw } = await credentialRaw(entry.credentialRef)
    if (raw === null) return { auth: null, corrupt: false }
    let parsed
    try { parsed = JSON.parse(raw) } catch { return { auth: null, corrupt: true } }
    const auth = sanitizeAuth(parsed)
    return { auth, corrupt: auth === null }
  }

  // ---- 插件实例 -----------------------------------------------------------
  // client 是 OpenCode 插件工厂参数：上游只在续期成功时调 client.auth.set，
  // body 已是合并后的完整账号对象。实例按账号绑定，回写只落到本账号的引用；
  // 账号已被删除时丢弃（不复活已登出的账号）。
  const clientFor = accountId => testDeps.client ?? {
    auth: {
      async set({ body } = {}) {
        try {
          const sanitized = sanitizeAuth(body)
          if (!sanitized || !accountId) return
          const service = credentials()
          if (!service || typeof service.set !== 'function') return
          const index = await readIndex()
          if (index.state !== 'ok') return
          const entry = index.entries.find(row => row.id === accountId)
          if (!entry) return
          await service.set(entry.credentialRef, JSON.stringify(sanitized))
        } catch {
          logger?.warn?.('[unified-router] WorkBuddy 登录续期未能写回凭据。')
        }
      },
    },
  }

  // 插件实例按需创建：工厂只注册 hooks，不发请求。
  const pluginFor = accountId => {
    const cached = pluginCache.get(accountId)
    if (cached) return cached
    const built = testDeps.plugin
      ? Promise.resolve().then(() => typeof testDeps.plugin === 'function' ? testDeps.plugin(accountId) : testDeps.plugin)
      : Promise.resolve().then(() => WorkBuddyAuthPlugin({ client: clientFor(accountId), magpie: undefined }))
    const promise = built.catch(error => {
      pluginCache.delete(accountId)
      throw error
    })
    pluginCache.set(accountId, promise)
    return promise
  }

  // getAuth 喂给插件 hooks：返回该账号当前凭据（不含 type 以外的附加结构）。
  // 上游 current()/fresh() 会自行判断 access 是否临近过期并续期；
  // 续期结果经 client.auth.set 回写本账号的凭据引用。
  const getAuthFor = entry => async () => (await readAccountAuth(entry)).auth

  /** 参与选号/轮换的账号：`enabled !== false` 且凭据可用，保持索引顺序。 */
  const activeAccounts = async () => (await accounts()).filter(entry => entry.enabled !== false)

  const firstReadyAccount = async () => {
    for (const entry of await activeAccounts()) {
      const { auth } = await readAccountAuth(entry)
      if (auth) return { entry, auth }
    }
    return null
  }

  /** 取某账号的推理 transport（凭据过期由上游 hook 自行续期并回写本账号引用）。 */
  const transportFor = async entry => {
    const plugin = await pluginFor(entry.id)
    const transport = await plugin.auth.loader(getAuthFor(entry))
    if (typeof transport?.fetch !== 'function') throw new Error('请重新登录 WorkBuddy')
    return transport.fetch
  }

  /**
   * 推理请求的 fetch：**按账号顺序尝试，429 时自动切到下一个账号**。
   *
   * ## 为什么需要它
   *
   * WorkBuddy 的 `DeepSeek-V4.1-Flash` 每账号有约 2 亿 token 的额度，**用尽后上游
   * 直接回 429**，而早期实现把推理固定绑在「目录来源账号」上：该账号耗尽后，
   * 整个 provider 一起 429，其它已登录账号完全用不上。
   *
   * ## 边界
   *
   * - 只对 429 换号；其它错误（401/5xx/网络）原样返回，交给上层重试语义。
   * - 请求体必须是**可重放**的（JSON 字符串 / Uint8Array）。pi-ai 的
   *   openai-completions / anthropic-messages 都是这种形态；若是流式 body 就不重试。
   * - 轮换只在**本次请求内**按顺序试一遍，不做跨请求的粘滞记账：下一次请求仍从
   *   首选账号开始（首选账号恢复额度后自然继续用它）。
   */
  const getInferenceFetch = async preferredAccountId => {
    if (disposed) throw new Error('请刷新 WorkBuddy 目录或重新登录')
    const entries = await activeAccounts()
    if (entries.length === 0) throw new Error('没有启用的 WorkBuddy 账号，请在设置中启用账号')
    // 首选账号置前，其余按索引顺序；同 id 只出现一次。
    const ordered = []
    for (const entry of entries) {
      if (entry.id === preferredAccountId) ordered.unshift(entry)
      else ordered.push(entry)
    }
    const replayable = body => body === undefined || body === null
      || typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer

    return async (input, init) => {
      let lastResponse
      for (let index = 0; index < ordered.length; index += 1) {
        const entry = ordered[index]
        const fetch = await transportFor(entry)
        // Request 需要克隆：一旦被消费就无法用于下一个账号。
        const attemptInput = input instanceof Request ? input.clone() : input
        const response = await fetch(attemptInput, init)
        if (response.status !== 429) {
          // 该账号又能用了：清掉上一次的限流记账，面板随之恢复。
          clearRateLimited(entry.id)
          testDeps.noteQuotaAccount?.(WORKBUDDY_PROVIDER_ID, entry.id)
          return response
        }
        // ⚠️ 必须在换号之前记账：换到下个账号后上层只看到 200，429 会丢失。
        // body 只能读一次，用 clone 读文案、原响应继续向下传。
        try {
          const said = await response.clone().text()
          noteRateLimited(entry.id, parseResetAt(said))
        } catch { /* 取不到文案就不记 */ }
        lastResponse = response
        // 已耗尽：换下一个账号。body 不可重放时不再尝试（避免发出空请求）。
        if (index < ordered.length - 1 && !replayable(init?.body)) break
      }
      // 全部 429：如实返回最后一次响应，由上层按限流处理。
      if (lastResponse) return lastResponse
      throw new Error('WorkBuddy 请求失败')
    }
  }

  function refreshRouting() {
    const run = routingJob.then(async () => {
      const llm = serviceOf(ctx, 'llm')
      if (disposed || typeof llm?.registerAdapter !== 'function') return
      const accountId = catalogAccount
      const active = accountId ? await modelSettings.list(catalog) : []
      const models = active.filter(row => row.enabled)
      const signature = JSON.stringify([accountId, models])
      if (disposed || signature === adapterSignature) return
      if (models.length || currentAdapter) {
        const { createWorkBuddyAdapter } = await (testDeps.loadLlmAdapter?.() ?? import('./workbuddy-llm.js'))
        if (disposed) return
        const built = createWorkBuddyAdapter({ catalog: models, getFetch: () => getInferenceFetch(accountId),
          providerId: WORKBUDDY_PROVIDER_ID, endpoint: site.endpoint, sessionHeader: _internal.SESSION, get: name => serviceOf(ctx, name) })
        currentAdapter = built.adapter
        if (!releaseAdapter) {
          const delegate = new Proxy(built.adapter, { get(_target, key) {
            const value = Reflect.get(currentAdapter, key)
            return typeof value === 'function' ? value.bind(currentAdapter) : value
          } })
          releaseAdapter = llm.registerAdapter(built.providerIds, delegate)
        }
      }
      adapterSignature = signature
      llm.emitAdaptersUpdated?.()
    })
    routingJob = run.catch(() => logger?.warn?.('[unified-router] WorkBuddy 模型目录发布失败。'))
    return routingJob
  }

  // authorize 只取浏览器方式：methods 里还有 desktop 与 api key，渠道决策不接。
  const browserMethod = pluginObject => {
    const methods = pluginObject?.auth?.methods
    if (!Array.isArray(methods)) return null
    return methods.find(method => method?.type === 'oauth' && typeof method.authorize === 'function' && typeof method.label === 'string' && /browser/i.test(method.label))
      ?? methods.find(method => method?.type === 'oauth' && typeof method.authorize === 'function')
  }

  const raceAbort = (promise, signal) => {
    if (!signal) return promise
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        const fail = () => reject(signal.reason instanceof Error ? signal.reason : new Error('请求已取消'))
        if (signal.aborted) return fail()
        signal.addEventListener('abort', fail, { once: true })
      }),
    ])
  }

  // 按 accountId 定位账号：多账号下没有「当前账号」，缺 id 与 id 不存在都按
  // 「账号已变化」处理（客户端提示刷新后重试）。
  const resolveAccount = (payload, entries) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    const entry = accountId ? entries.find(row => row.id === accountId) : undefined
    if (!entry) throw new Error(ACCOUNT_CHANGED)
    return entry
  }

  // ---- 快照 ---------------------------------------------------------------
  const readAccount = async (entry, signal) => {
    const base = {
      id: entry.id, name: entry.name, uid: entry.uid,
      // 账号开关（缺省启用）：客户端据此渲染开关，选号/轮换按同一判据过滤。
      enabled: entry.enabled !== false,
      signedIn: false, plan: '', windows: [], signIn: 'kept', updatedAt: Date.now(), error: '',
    }
    const { auth, corrupt } = await readAccountAuth(entry)
    if (!auth) return { ...base, error: corrupt ? 'credential_error' : 'not_configured' }
    // 索引里的展示名可能为空（老索引/手改过）：回退到凭据里的 accountId。
    const named = { ...base, name: entry.name || text(auth.accountId, 80) }
    let result
    try {
      const pluginObject = await pluginFor(entry.id)
      if (typeof pluginObject?.auth?.usage !== 'function') throw new Error('usage hook missing')
      result = await raceAbort(Promise.resolve(pluginObject.auth.usage(getAuthFor(entry))), signal)
    } catch (error) {
      if (signal?.aborted) throw error
      return { ...named, signedIn: true, error: 'upstream_error' }
    }
    signal?.throwIfAborted()
    const row = object(result)
    if (row.error !== undefined || !Array.isArray(row.windows)) {
      // usage 把「登录已失效」与「读失败」都放在 error 字段；原文不透出。
      const expired = row.signIn === 'expired' || /not signed in/i.test(String(row.error))
      return { ...named, signedIn: !expired, error: expired ? 'auth_expired' : 'auth_error' }
    }
    return {
      ...named,
      signedIn: true,
      plan: text(row.plan, 120),
      windows: row.windows.slice(0, 32).map(publicWindow).filter(Boolean),
      signIn: row.signIn === 'renewed' ? 'renewed' : 'kept',
      updatedAt: Date.now(),
      error: '',
    }
  }

  // 快照逐账号读额度（Promise.all）：单个账号失败只污染自己那一行，
  // 不影响其他账号的读数。
  /**
   * 给撞过 429 的账号追加一条「已满」窗口。
   *
   * 只表达**被拒信号**，不估算已用 token：vendor 的精确窗口依赖 Magpie 的
   * usage.jsonl（DSH 不写那里），故这里用 `estimate: true` 明确标记为估算，
   * 并在重置时刻过去后自动失效。
   */
  const withRateLimitWindow = row => {
    const until = finite(readLimits()[row.id])
    if (until === undefined || until <= Date.now()) return row
    return {
      ...row,
      windows: [...(Array.isArray(row.windows) ? row.windows : []), {
        name: '免费额度（token 窗口）',
        used: 100,
        limit: 100,
        balance: 0,
        unit: '',
        display: '已满 · 待重置',
        resetsAt: new Date(until).toISOString(),
        estimate: true,
        aside: false,
      }],
    }
  }

  const snapshot = async signal => {
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const entries = await accounts()
    signal?.throwIfAborted()
    const rows = (await Promise.all(entries.map(entry => readAccount(entry, signal).catch(error => {
      if (signal?.aborted) throw error
      return { id: entry.id, name: entry.name, uid: entry.uid, signedIn: false, plan: '', windows: [], signIn: 'kept', updatedAt: Date.now(), error: 'upstream_error' }
    }))))
      // 撞过 429 的账号追加一条「已满」窗口：上游的免费模型 token 窗口不看 credits，
    // 面板上那三个 credits 窗口无法回答「这个号还能不能继续用」。
      .map(row => withRateLimitWindow(row))
    signal?.throwIfAborted()
    return { accounts: rows, loginUrl: pendingLoginUrl }
  }

  // ---- 登录（新增账号） ---------------------------------------------------
  const login = async (payload, signal) => {
    assertProvider(payload)
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    // 登录串行：两次浏览器登录共用 WorkBuddy 的 state 轮询会互相顶掉。
    const task = async () => {
      signal?.throwIfAborted()
      const pluginObject = await pluginFor('')
      const method = testDeps.authorize ? { authorize: testDeps.authorize } : browserMethod(pluginObject)
      if (typeof method?.authorize !== 'function') throw new Error('登录方式不可用')
      const flow = await method.authorize()
      signal?.throwIfAborted()
      const loginUrl = assertLoginUrl(object(flow).url)
      pendingLoginUrl = loginUrl
      // 让前端在阻塞等待期间能从快照取到地址；事件只是提示，快照才是取地址的面。
      try { emit?.('unified-router.workbuddy.login-url', { loginUrl }) } catch {}
      try {
        const done = await raceAbort(Promise.resolve(flow.callback()), signal)
        signal?.throwIfAborted()
        if (object(done).type !== 'success' || typeof done.access !== 'string' || !done.access) {
          // 登录失败原因（上游原文）不透出；用户侧统一报通用错误。
          throw new Error('登录未完成')
        }
        const auth = sanitizeAuth({ ...done, type: 'oauth' })
        if (!auth) throw new Error('登录未完成')
        const entries = await accounts()
        if (entries.length >= WORKBUDDY_MAX_ACCOUNTS) throw new Error('账号数量已达上限')
        const entry = {
          id: newAccountId(entries),
          credentialRef: newCredentialRef(entries),
          name: text(auth.accountId, 80),
          uid: text(auth.uid, 120),
          createdAt: Date.now(),
        }
        // 先写凭据再写索引（索引是账号存在性的唯一来源）；索引写失败时回滚凭据。
        await writeCredential(entry.credentialRef, JSON.stringify(auth))
        try {
          await writeIndex([...entries, entry])
        } catch (error) {
          try { await clearCredential(entry.credentialRef) } catch {}
          throw error
        }
        signal?.throwIfAborted()
        return { id: entry.id, signedIn: true, accountId: text(auth.accountId, 160), uid: text(auth.uid, 160) }
      } finally {
        pendingLoginUrl = null
      }
    }
    const run = loginQueue.then(task, task)
    loginQueue = run.then(() => {}, () => {})
    return run
  }

  // ---- 按账号操作 ---------------------------------------------------------
  const logout = async (payload, signal) => {
    assertProvider(payload)
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const entries = await accounts()
    const entry = resolveAccount(payload, entries)
    // 先提交索引（账号存在性的唯一来源）再清凭据：索引写失败时令牌还在，
    // 账号仍可用；反过来先清凭据则会把账号留在无法恢复的「未登录」状态。
    await writeIndex(entries.filter(row => row.id !== entry.id))
    await clearCredential(entry.credentialRef)
    signal?.throwIfAborted()
    return { signedIn: false }
  }

  /**
   * 账号开关：启用 / 停用某个 WorkBuddy 账号。
   *
   * 停用只改索引条目的 `enabled`，**不动凭据**——重新启用后无需再次登录。
   * 选号与 429 轮换都按同一判据过滤（`enabled !== false`），所以停用账号
   * 既不会被选中，也不会成为轮换目标。
   */
  const setAccountEnabled = async (payload, signal) => {
    assertProvider(payload)
    if (typeof payload.enabled !== 'boolean') throw new Error('账号开关无效')
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const entries = await accounts()
    const entry = resolveAccount(payload, entries)
    await writeIndex(entries.map(row => row.id === entry.id
      ? { ...row, enabled: payload.enabled }
      : row))
    signal?.throwIfAborted()
    // 目录账号可能被停用：重算一次路由，避免继续把请求派给已停用账号。
    await refreshRouting()
    return { id: entry.id, enabled: payload.enabled }
  }

  const checkin = async (payload, signal, statusOnly = false) => {
    assertProvider(payload)
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const entry = resolveAccount(payload, await accounts())
    const { auth, corrupt } = await readAccountAuth(entry)
    if (!auth) return { outcome: 'failed', credit: null, streak: null, error: corrupt ? 'credential_error' : 'not_configured' }
    let result
    try {
      const pluginObject = await pluginFor(entry.id)
      if (typeof pluginObject?.auth?.checkin !== 'function') throw new Error('checkin hook missing')
      result = await raceAbort(Promise.resolve(pluginObject.auth.checkin(getAuthFor(entry), { waits: [], ...(statusOnly ? { statusOnly: true } : {}) })), signal)
    } catch (error) {
      if (signal?.aborted) throw error
      // 上游约定：拿到 WorkBuddy 答复的失败以 {outcome} 返回，发不出请求的才抛。
      // 抛出的（离线、超时）同样收成固定码。
      return { outcome: 'failed', credit: null, streak: null, error: 'checkin_error' }
    }
    signal?.throwIfAborted()
    return { ...publicCheckin(result), error: '', ...(result?.unsubmitted === true ? { unsubmitted: true } : {}) }
  }

  // 目录：指定账号优先，否则用第一个已登录（凭据可解析）的账号；
  // 都没有时把 null 交给 hook（返回站点内置清单，不发请求）。
  const collectModels = async (payload, signal) => {
    assertProvider(payload)
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const targeted = typeof payload?.accountId === 'string' && !!payload.accountId
    const active = targeted ? null : await firstReadyAccount()
    const target = targeted ? resolveAccount(payload, await accounts()) : active?.entry
    const auth = targeted ? (await readAccountAuth(target)).auth : active?.auth
    signal?.throwIfAborted()
    let listed = null
    let fromAccount = false
    try {
      const pluginObject = await pluginFor(target ? target.id : '')
      if (typeof pluginObject?.provider?.models === 'function') {
        const config = {}
        if (typeof pluginObject.config === 'function') await pluginObject.config(config)
        const provider = object(object(config.provider)[WORKBUDDY_PROVIDER_ID])
        const result = await raceAbort(Promise.resolve(pluginObject.provider.models(provider, { auth: auth ?? null })), signal)
        // hook 返回 {id: entry} 映射；configModels 兜底条目自身不带 id，用键补上。
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          listed = Object.entries(result).map(([id, row]) => ({ id, ...object(row) }))
          fromAccount = !!auth && result !== provider.models
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error
      listed = null
    }
    if (listed === null) {
      // 兜底：站点自带清单（configModels），结构与 hook 返回一致（OpenCode 条目映射）。
      const fallback = _internal?.configModels ? object(_internal.configModels(object(_internal.SITES)[WORKBUDDY_PROVIDER_ID])) : {}
      listed = Object.entries(fallback).map(([id, row]) => ({ id, ...object(row) }))
    }
    const rows = listed.map(publicModel).filter(Boolean).slice(0, 256)
    fromAccount &&= rows.length > 0
    if (targeted) return { models: await modelSettings.list(rows), source: fromAccount ? 'remote' : 'fallback' }
    signal?.throwIfAborted()
    const activeId = active?.entry.id ?? null
    if (!fromAccount && activeId && (activeId !== catalogAccount || !catalog.length)) {
      const cached = readCatalogCache(rawConfig.catalogFile, activeId)
      if (cached) {
        catalog = cached
        catalogAccount = activeId
        catalogSource = 'cached'
      }
    }
    if (activeId !== catalogAccount || fromAccount || !catalog.length) {
      catalog = rows
      catalogSource = fromAccount ? 'remote' : 'fallback'
    } else if (catalogSource === 'remote') {
      catalogSource = 'cached'
    }
    catalogAccount = activeId
    if (fromAccount && activeId && rows.length) await saveCatalogCache(rawConfig.catalogFile, rows, activeId).catch(() => {})
    await refreshRouting()
    return { models: await modelSettings.list(catalog), source: catalogSource }
  }

  const models = (payload, signal) => {
    if (payload.accountId) return collectModels(payload, signal)
    if (!catalogJob) catalogJob = collectModels(payload, lifetime.signal).finally(() => { catalogJob = null })
    return raceAbort(catalogJob, signal)
  }

  const call = async (method, payload = {}, signal) => {
    if (!WORKBUDDY_METHODS.has(method)) throw new Error('不支持此操作')
    if (disposed) throw new Error('请求已结束')
    if (method === 'workbuddy.snapshot') return snapshot(signal)
    assertProvider(payload)
    if (method === 'workbuddy.login') return login(payload, signal)
    if (method === 'workbuddy.logout') return logout(payload, signal)
    if (method === 'workbuddy.checkin') return checkin(payload, signal)
    if (method === 'workbuddy.setAccountEnabled') return setAccountEnabled(payload, signal)
    if (method === 'workbuddy.models') return models(payload, signal)
    if (WORKBUDDY_MODEL_WRITES.includes(method)) {
      if (!catalog.length) await models(payload, signal)
      const rows = await modelSettings.change(method, payload, () => catalog, signal)
      await refreshRouting()
      return { models: rows, source: catalogSource }
    }
    throw new Error('不支持此操作')
  }

  return {
    call,
    getLoginUrl: () => pendingLoginUrl,
    async verifyCheckin(accountId, signal) {
      const result = await checkin({ provider: WORKBUDDY_PROVIDER_ID, accountId }, signal, true)
      return { kind: result.outcome === 'done' ? 'already-claimed' : result.outcome, credit: result.credit }
    },
    async listCheckinAccounts(signal) {
      signal?.throwIfAborted()
      const entries = await accounts()
      const available = await Promise.all(entries.map(async entry => {
        const { auth } = await readAccountAuth(entry)
        return auth ? { id: entry.id, name: entry.name } : null
      }))
      signal?.throwIfAborted()
      return available.filter(Boolean)
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.abort()
      pendingLoginUrl = null
      pluginCache.clear()
      releaseAdapter?.()
      releaseAdapter = null
    },
  }
}
