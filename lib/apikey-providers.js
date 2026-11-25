// API Key 渠道（Agnes / 云知声 / 百度千帆 Token Plan / 阿里云百炼 Token Plan）的规格对象：
// 端点、目录解析、兜底表、思考方言与余额/控制台额度解析。形状契约见 docs/APIKEY-CHANNELS.md §2「渠道规格」，
// 渠道事实（哪些是实测、哪些来自官方文档）见同文件 §1。这里不写文档外
// 的能力假设：未确认的上下文/输出记 0，未确认的能力一律 false / []。

import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  apiQuotaAmount as amount, apiQuotaClampedAmount as clampedAmount,
  apiQuotaGift as giftOf, apiQuotaWindow as windowOf,
} from './apikey-quota-projection.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// 目录行 id 校验：非空字符串且 ≤256 字符（与快照投影的 id 上限一致）。
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 256

/* ------------------------------ Agnes ------------------------------ */

// 实测（agnes-3.0-flash）：reasoning_effort 取 none/low/medium/high，
// 默认不思考。档位对所有聊天文本模型统一声明，包括目录里的新 id ——
// 该字段逐请求生效，新模型规格未知只影响 context/output/attachment。
const AGNES_EFFORTS = ['off', 'low', 'medium', 'high']

// 官方文档给出的文本模型规格（docs/APIKEY-CHANNELS.md §1）。
// agnes-2.5-pro-theta 实测在目录里存在但文档未给规格：仍给可读名，但
// context/output 与表外新 id 同样记 0，且不假设图片输入，不编值。
const AGNES_SPECS = {
  'agnes-2.5-flash': { name: 'Agnes 2.5 Flash', context: 524_288, output: 65_536, attachment: true, free: true },
  'agnes-3.0-flash': { name: 'Agnes 3.0 Flash', context: 524_288, output: 65_536, attachment: true, free: true },
  'agnes-3.0-pro': { name: 'Agnes 3.0 Pro', context: 1_048_576, output: 65_536, attachment: true, paidOnly: true },
  'agnes-2.5-pro': { name: 'Agnes 2.5 Pro', context: 1_048_576, output: 65_536, attachment: true, paidOnly: true },
  'agnes-2.5-pro-alpha': { name: 'Agnes 2.5 Pro Alpha', context: 1_048_576, output: 65_536, attachment: true, paidOnly: true },
  'agnes-2.5-pro-beta': { name: 'Agnes 2.5 Pro Beta', context: 1_048_576, output: 65_536, attachment: true, paidOnly: true },
  'agnes-2.5-pro-theta': { name: 'Agnes 2.5 Pro Theta', context: 0, output: 0, attachment: false, paidOnly: true },
}

const agnesRow = id => {
  const known = AGNES_SPECS[id]
  return {
    id,
    name: known?.name ?? id,
    context: known?.context ?? 0,
    output: known?.output ?? 0,
    attachment: known?.attachment ?? false,
    reasoning: true,
    efforts: [...AGNES_EFFORTS],
    defaultEffort: 'off',
    ...(known?.free ? { free: true } : {}),
    ...(known?.paidOnly ? { paidOnly: true } : {}),
  }
}

const agnes = {
  id: 'agnes',
  title: 'Agnes',
  endpoint: 'https://api.agnes-ai.cn',
  chatPath: '/v1/chat/completions',
  baseUrl: 'https://api.agnes-ai.cn/v1',
  credentialRef: 'UNIFIED_ROUTER_AGNES_API_KEY',
  tools: { module: './image-tools.js' },
  catalog: {
    request(key) {
      return { url: 'https://api.agnes-ai.cn/v1/models', headers: { authorization: 'Bearer ' + key } }
    },
    parse(json) {
      if (!object(json) || !Array.isArray(json.data)) return []
      const rows = []
      const seen = new Set()
      for (const entry of json.data) {
        if (!object(entry) || !validId(entry.id) || seen.has(entry.id)) continue
        // 同一目录混入图片/视频生成模型以及无聊天端点的内部决策模型（如 agnes-sys1-1.0，supported_endpoint_types 为 []）。
        if (entry.id.startsWith('agnes-image') || entry.id.startsWith('agnes-video')) continue
        if (Array.isArray(entry.supported_endpoint_types) && entry.supported_endpoint_types.length === 0) continue
        seen.add(entry.id)
        rows.push(agnesRow(entry.id))
      }
      return rows
    },
    next() { return undefined },
  },
  // 拉不到上游目录时的兜底：只放确认存在的文本模型 id（实测目录 + 官方文档）。
  fallback: [
    'agnes-2.5-flash',
    'agnes-3.0-flash',
    'agnes-3.0-pro',
    'agnes-2.5-pro',
    'agnes-2.5-pro-beta',
    'agnes-2.5-pro-alpha',
    'agnes-2.5-pro-theta',
  ].map(agnesRow),
  // 实测：thinking:{type:'disabled'} 关不掉思考，禁用；关思考发 'none'。
  effortBody(effort) {
    if (effort === 'off') return { reasoning_effort: 'none' }
    if (AGNES_EFFORTS.includes(effort)) return { reasoning_effort: effort }
    return undefined
  },
  // 站点是 New API 分支：subscription.hard_limit_usd 是美元额度，
  // usage.total_usage 按 OpenAI 账单口径是美分（实测值 0，口径为推定）。
  balance: {
    requests(key) {
      const headers = { authorization: 'Bearer ' + key }
      return [
        { url: 'https://api.agnes-ai.cn/v1/dashboard/billing/subscription', headers },
        { url: 'https://api.agnes-ai.cn/v1/dashboard/billing/usage', headers },
      ]
    },
    parse(jsons) {
      const [sub, usage] = Array.isArray(jsons) ? jsons : []
      const limit = sub?.hard_limit_usd
      const total = usage?.total_usage
      if (!Number.isFinite(limit) || !Number.isFinite(total)) return null
      const unlimited = limit >= 10_000_000
      return { used: total / 100, limit: unlimited ? null : limit, unlimited, unit: 'USD' }
    },
  },
  /**
   * **控制台额度配方**（与 `catalog.request/parse` 同构）。
   *
   * 为什么写在规格里：控制台额度的取数与解析每家都不一样（Bearer vs Cookie、
   * 成功码在 `code` 还是 `errorCode`、窗口字段各一套）。上一版把两家写成共享层
   * 里的一串 `provider === 'agnes' ? … : …`，第三个渠道接进来就只能继续嵌套三元。
   * 现在共享执行器（`lib/apikey-quota.js`）只负责取凭据、并发请求、归一化状态，
   * **加一个 API Key 渠道时不需要动执行器**。
   *
   * 命中 `consoleUrl` 的渠道才会显示「控制台额度」行。
   */
  consoleQuota: {
    consoleUrl: 'https://platform.agnes-ai.cn/subscribe/subscription',
    baseUrl: 'https://platform-backend.agnes-ai.cn/api',
    // 控制台会话是独立的 Bearer Token（不是 API Key 本身）。
    credentialEnv: 'UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN',
    headers: session => ({
      authorization: `Bearer ${String(session).replace(/^Bearer\s+/i, '')}`,
      'x-user-language': 'zh-CN',
    }),
    paths: ['/user/agentplan/credits', '/cn/user/subscription', '/user/balance'],
    // 站点是 New API 分支：成功码写在 `code`，数据在 `data`。
    pick: json => (String(json?.code) === '200' ? json.data : null),
    read([credits, legacy, cash]) {
      const windows = [
        windowOf('monthly-credits', null, credits?.plan_quota_credits, credits?.plan_balance_credits),
        windowOf('window-credits', credits?.window_used_credits, credits?.window_limit_credits),
        windowOf('pack-credits', null, null, credits?.pack_balance_credits),
        windowOf('window-requests', legacy?.usage?.text_generation?.windowed?.used, legacy?.usage?.text_generation?.windowed?.limit),
        windowOf('weekly-requests', legacy?.usage?.text_generation?.weekly?.used, legacy?.usage?.text_generation?.weekly?.limit),
      ].filter(Boolean)
      const minor = /^cny$/i.test(cash?.currency ?? '') ? amount(cash.available_total_minor ?? cash.total_minor) : null
      return { windows, gifts: [], balance: minor === null ? null : minor / 100 }
    },
    expiredCodes: ['401', '403', '521', '1000103'],
  },
  /** 限流信号识别：`scanOnOk` 决定是否连 2xx 响应也扫（有的上游用 200 回限流体）。 */
  rateLimit: { scanOnOk: false, codes: {} },
}

/* ---------------------------- 云知声 MaaS ---------------------------- */

// u2 系列：官方文档确认的思考档位 reasoning_effort none…xhigh，默认 high。
// u2-radimed 默认关闭且不支持开启。其余模型（含 doubao/kimi/qwen/hy/mimo
// 等第三方模型）没有确认的能力不声明。
const UNISOUND_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
// 可直接附图聊天的模型（官方模型页「输入模态」声明，2026-11-23 核对）：
// u2-flash 与 u2-med 均为「文本、图片」（u2-med 产品页关键信息表原话），
// u2-radimed 为影像与文本混合输入。u2 只声明文本输入，不挂图片。
const UNISOUND_IMAGE_MODELS = new Set(['u2-flash', 'u2-med', 'u2-radimed'])
/**
 * 云知声转售的第三方模型里**已知支持图片**的那些。
 *
 * 证据来源：云知声的 Anthropic 兼容目录（`/anthropic/v1/models`）**不下发任何能力
 * 字段**（2026-11-23 用真实付费 Key 拉 30 条实测，只有 `max_input` / `context_window`
 * / `max_output`），官方「文本生成」文档也只列 u2 系列。故对第三方模型，按**同 id
 * 模型在其它渠道上游目录里的明确声明**判定（WorkBuddy `supports_images`、Raccoon
 * `vision` 标签、TRAE `multimodal`、Agnes 目录），大小写归一并逐个核对过。
 *
 * 局限：这是跨渠道证据，不是云知声自身的声明；未列出的模型保守判「不支持」。
 * 误判可在该模型的参数里手动开关图片（`supportsImage`），不会静默失败——真发图
 * 时上游会明确报错。
 */
const UNISOUND_IMAGE_MODELS_CROSS_CHANNEL = new Set([
  // pi-ai 内置目录（`@earendil-works/pi-ai` 的 providers/data，2026-11-23 逐 provider 全票核对）
  // 判为支持图片的：
  'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.6-flash',
  // `qwen3.6-35b-a3b`：pi-ai 无此条目，按阿里云百炼官方模型页 ——「原生视觉语言模型」，
  // 输入模态 Image / Text / Video（https://www.alibabacloud.com/help/zh/model-studio/qwen3-6-35b-a3b）。
  'qwen3.6-35b-a3b',
  'kimi-k3', 'kimi-k2.5', 'kimi-k2.6',
  'deepseek-v4.1-flash',
  'minimax-m3',
  'mimo-v2.6-pro', 'mimo-v2.6-flash',
  // `glm-5.3-flash`：pi-ai 16 个 provider 里 15 个判支持，只有 radius 一家判纯文本 —
  // 按多数保留（与同系列的 `glm-5.3` 不同：那个是 7/7 全票纯文本）。
  'glm-5.3-flash',
  // 无 pi-ai 条目（转售独有 id），但 WorkBuddy 上游目录声明 `supports_images: true`。
  'doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo',
])
/**
 * ⚠️ 以下模型**不**在图片集合里，pi-ai 全部 provider 都判纯文本，别凭"看起来是多模态"
 * 加回来：`glm-5.2` / `glm-5.3` / `glm-5.1` / `glm-5`、`deepseek-v4-pro` /
 * `deepseek-v4-flash-0731`、`qwen3.7-max`、`minimax-m2.5`、`hy3` / `hy4-preview`。
 * WorkBuddy 对 `glm-5.2` / `glm-5.3` / `deepseek-v4-pro` 声明 `supports_images: true`，
 * 那是它自己渠道的口径；云知声转售按原厂能力（pi-ai 的 zai / deepseek 等官方路由）判定。
 */
/** 该模型能否直接附图：先查官方文档确认的 u2 系列，再查跨渠道证据。 */
const unisoundSupportsImage = id => {
  const bare = String(id ?? '').trim().toLowerCase()
  return UNISOUND_IMAGE_MODELS.has(bare) || UNISOUND_IMAGE_MODELS_CROSS_CHANNEL.has(bare)
}
const UNISOUND_THINKING = {
  'u2-flash': { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  u2: { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  'u2-med': { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  'u2-radimed': { efforts: [], defaultEffort: undefined },
}

// U Plan 订阅档位对应的 5 小时积分上限：上游没下发 `window5hLimit` 时才用它回落。
const UNISOUND_WINDOW5H_BY_PLAN = Object.freeze({
  'U-FREE': 500,
  'U-STANDARD': 2000,
  'U-PLUS': 12000,
})

/**
 * 把上游「剩余 X 天 X 小时 / X 小时 X 分钟」这类**分段字段**折成毫秒。
 *
 * 上游不直接给 epoch，而是拆成 `weeklyResetInDays` + `weeklyResetInHours` 这类
 * 兄弟字段，并额外给「不足一小时」的哨兵布尔值。任一段超出合法范围就整条作废
 *（返回 null），不猜。
 */
function unisoundResetInMs(data, weekly) {
  const prefix = weekly ? 'weeklyResetIn' : 'window5hResetIn'
  const major = data?.[prefix + (weekly ? 'Days' : 'Hours')]
  const minor = data?.[prefix + (weekly ? 'Hours' : 'Minutes')]
  const unit = weekly ? 3600000 : 60000
  if (data?.[prefix + (weekly ? 'LessThanOneHour' : 'LessThanOneMinute')] === true) return unit
  const valid = (value, max) => Number.isInteger(value) && value >= 0 && value <= max
  if (major == null && minor == null || major != null && !valid(major, weekly ? 7 : 5) || minor != null && !valid(minor, weekly ? 23 : 59)) return null
  const count = (major ?? 0) * (weekly ? 24 : 60) + (minor ?? 0)
  return count <= (weekly ? 168 : 300) ? Math.max(count, 1) * unit : null
}

const unisoundRow = (id, name, context, output) => {
  const thinking = UNISOUND_THINKING[id] ?? { efforts: [], defaultEffort: undefined }
  return {
    id,
    name,
    context,
    output,
    attachment: unisoundSupportsImage(id),
    reasoning: thinking.efforts.length > 0,
    efforts: [...thinking.efforts],
    defaultEffort: thinking.defaultEffort,
  }
}

const unisound = {
  id: 'unisound',
  title: '云知声',
  endpoint: 'https://maas-api.unisound.com',
  chatPath: '/v1/chat/completions',
  baseUrl: 'https://maas-api.unisound.com/v1',
  credentialRef: 'UNIFIED_ROUTER_UNISOUND_API_KEY',
  // 控制台会话（Cookie）独立凭据：设置页浏览器登录收割 / 粘贴导入，额度读取用。
  consoleCredentialRef: 'UNIFIED_ROUTER_UNISOUND_CONSOLE',
  // 控制台登录页与 Cookie 域：launchIsolatedBrowserCookieLogin 用。
  // 直达 /login 登录页（而非 /admin/subscript SPA shell）：未登录时 SPA 会先下发
  // 匿名 JSESSIONID 再前端跳转，收割易抓到登录换发前的旧会话；直达登录页让
  // 登录成功后的认证态 JSESSIONID 成为浏览器里该域的唯一会话。
  consoleLogin: {
    url: 'https://maas.unisound.com/login',
    cookieUrls: ['https://maas.unisound.com'],
    // 会话有效判据：/manager/account/info 返回 errorCode '0' 且 result 非空。
    verifyUrl: 'https://maas.unisound.com/manager/account/info',
    cookieDomain: 'maas.unisound.com',
  },
  // 多模态能力工具（官方 SkillHub 六个模型 Skill 的 Host 移植，lib/unisound-tools.js）。
  tools: { module: './unisound-tools.js', outputDirName: 'unisound-tools-output' },
  catalog: {
    restore: row => ({ ...row, attachment: unisoundSupportsImage(row.id) }),
    // 目录走 Anthropic 兼容端点：x-api-key 或 Bearer 皆可，两个都带上。
    request(key, cursor) {
      let url = 'https://maas-api.unisound.com/anthropic/v1/models?limit=1000'
      if (cursor) url += '&after_id=' + encodeURIComponent(cursor)
      return { url, headers: { 'x-api-key': key, authorization: 'Bearer ' + key } }
    },
    parse(json) {
      if (!object(json) || !Array.isArray(json.data)) return []
      const rows = []
      const seen = new Set()
      for (const entry of json.data) {
        if (!object(entry) || !validId(entry.id) || seen.has(entry.id)) continue
        seen.add(entry.id)
        const name = typeof entry.display_name === 'string' && entry.display_name ? entry.display_name : entry.id
        const context = Number.isInteger(entry.context_window) && entry.context_window > 0 ? entry.context_window : 0
        const output = Number.isInteger(entry.max_output) && entry.max_output > 0 ? entry.max_output : 0
        rows.push(unisoundRow(entry.id, name, context, output))
      }
      return rows
    },
    next(json) {
      return object(json) && json.has_more === true && typeof json.last_id === 'string' && json.last_id.length > 0
        ? json.last_id
        : undefined
    },
  },
  // 兜底只放上游目录确认存在的 u2 系列，规格取 **2026-11-23 真实 Key 拉取的
  // `/anthropic/v1/models` 真值**（不是第三方转述）：
  // u2-flash 1,048,576 / 262,144；u2 160,000 / 64,000；u2-med 262,144；
  // u2-radimed 40,960。u2-med 与 u2-radimed 的 `max_output` 上游就是 `null`
  //（不公开）→ 记 0，输出预算走通用推导，不编造官方值。
  fallback: [
    unisoundRow('u2-flash', 'u2-flash', 1_048_576, 262_144),
    unisoundRow('u2', 'u2', 160_000, 64_000),
    unisoundRow('u2-med', 'u2-med', 262_144, 0),
    unisoundRow('u2-radimed', 'u2-radimed', 40_960, 0),
  ],
  effortBody(effort, row) {
    if (!Array.isArray(row?.efforts) || !row.efforts.includes(effort)) return undefined
    return { reasoning_effort: effort === 'off' ? 'none' : effort }
  },
  balance: null, // 官方文档没有公开余额接口
  consoleQuota: {
    consoleUrl: 'https://maas.unisound.com/admin/subscript',
    baseUrl: 'https://maas.unisound.com/manager',
    // 控制台会话是 Cookie（浏览器登录收割或粘贴），不是 API Key 本身。
    credentialEnv: 'UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE',
    headers(session) {
      const headers = { cookie: session }
      // 控制台前端对写请求带 X-XSRF-TOKEN（取自 XSRF-TOKEN Cookie）；只读 GET 也照带，
      // 与浏览器行为一致，避免网关对缺失该头的会话请求另眼相待。
      const xsrf = String(session).match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1]
      if (xsrf) headers['x-xsrf-token'] = decodeURIComponent(xsrf)
      return headers
    },
    paths: ['/u-plan/subscription/current'],
    // 成功码写在 `errorCode`，数据在 `result`（与 Agnes 的 code/data 相反）。
    pick: json => (String(json?.errorCode ?? json?.code) === '0' ? json.result : null),
    read([credits]) {
      const weeklyLimit = amount(credits?.weeklyPointsTotal)
      const weeklyRemain = clampedAmount(credits?.weeklyPointsRemain)
      const raw5hLimit = amount(credits?.window5hLimit)
      const raw5hRemain = clampedAmount(credits?.window5hRemain)
      // 上游没给 5 小时上限时按套餐档位回落，再不行按周额度的 1/5 估算。
      const plan5hLimit = UNISOUND_WINDOW5H_BY_PLAN[String(credits?.planCode ?? '').trim().toUpperCase()]
        ?? (weeklyLimit !== null && weeklyLimit > 0 ? Math.round(weeklyLimit / 5) : null)
      const window5hLimit = raw5hLimit ?? plan5hLimit
      const window5hRemain = raw5hRemain ?? (raw5hLimit === null ? plan5hLimit : null)
      const windows = [
        windowOf('window-points', null, window5hLimit, window5hRemain, unisoundResetInMs(credits, false)),
        windowOf('weekly-points', credits?.weeklyPointsUsed, weeklyLimit, weeklyRemain, unisoundResetInMs(credits, true)),
      ].filter(Boolean)
      const gifts = Array.isArray(credits?.giftQuotas)
        ? credits.giftQuotas
          .map(item => giftOf(item?.modelId, item?.usedAmount, item?.totalAmount, item?.remainAmount, item?.unit ?? item?.displayUnit))
          .filter(Boolean)
        : []
      return { windows, gifts, balance: null }
    },
    expiredCodes: ['401', '403', '521', '1000103'],
    // 会话失效还有中文错误串判据（上游对失效会话回 errorCode '1' + errorMsg「用户未登录或session超时」）。
    expiredPattern: /未登录|session.{0,5}超时/i,
  },
  // 上游用 2xx + 业务码表达限流（`100501` = RPM，`100502` = TPM），所以连 2xx 也要扫。
  rateLimit: { scanOnOk: true, codes: { '100501': 'rpm', '100502': 'tpm' } },
}

/* --------------------- 百度千帆 Token Plan 个人版 --------------------- */

// 官方文档：
// - 模型范围与专属错误码：https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6（2026-11-11）
// - 模型上下文与最大输出：https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43（2026-11-11）
// - 深度思考参数（thinking / reasoning_effort）：https://cloud.baidu.com/doc/qianfan-docs/s/Wm95lyynv（2026-11-11）
const QIANFAN_EFFORT_DEEPSEEK = ['off', 'high', 'max']
const QIANFAN_EFFORT_ERNIE_LIGHT = ['off', 'low', 'high', 'max']
const QIANFAN_EFFORT_TOGGLE = ['off', 'high']
const QIANFAN_EFFORT_ALWAYS_ON = ['high']

const QIANFAN_SPECS = {
  'ernie-5.5-flash-preview': {
    name: 'ERNIE 5.5 Flash Preview', context: 1_000_000, output: 1_000_000, attachment: false,
    efforts: QIANFAN_EFFORT_ALWAYS_ON, defaultEffort: 'high', mode: 'thinking',
  },
  'ernie-light-dt-1.0': {
    name: 'ERNIE Light DT 1.0', context: 1_000_000, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_ERNIE_LIGHT, defaultEffort: 'max', mode: 'effort',
  },
  'deepseek-v4.1-flash-1017': {
    name: 'DeepSeek V4.1 Flash 1017', context: 1_048_576, output: 393_216, attachment: true,
    efforts: QIANFAN_EFFORT_DEEPSEEK, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4.1-flash': {
    name: 'DeepSeek V4.1 Flash', context: 1_048_576, output: 393_216, attachment: true,
    efforts: QIANFAN_EFFORT_DEEPSEEK, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro', context: 1_000_000, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_DEEPSEEK, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-pro-0813': {
    name: 'DeepSeek V4 Pro 0813', context: 1_000_000, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_DEEPSEEK, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-flash-0731': {
    name: 'DeepSeek V4 Flash 0731', context: 1_000_000, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_DEEPSEEK, defaultEffort: 'high', mode: 'effort',
  },
  'glm-5.3': {
    name: 'GLM 5.3', context: 1_048_576, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_ALWAYS_ON, defaultEffort: 'high', mode: 'thinking',
  },
  'glm-5.3-flash': {
    name: 'GLM 5.3 Flash', context: 1_048_576, output: 131_072, attachment: true,
    efforts: QIANFAN_EFFORT_ALWAYS_ON, defaultEffort: 'high', mode: 'thinking',
  },
  'glm-5.2': {
    name: 'GLM 5.2', context: 1_048_576, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'thinking',
  },
  'glm-5.1': {
    name: 'GLM 5.1', context: 198_000, output: 131_072, attachment: false,
    efforts: QIANFAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'thinking',
  },
  'qianfan-code-latest': {
    name: 'Qianfan Code Latest', context: 0, output: 0, attachment: false,
    efforts: QIANFAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'thinking',
  },
}

const qianfanRow = id => {
  const known = QIANFAN_SPECS[id]
  const efforts = known?.efforts ?? []
  return {
    id,
    name: known?.name ?? id,
    context: known?.context ?? 0,
    output: known?.output ?? 0,
    attachment: known?.attachment ?? false,
    reasoning: efforts.length > 0,
    efforts: [...efforts],
    defaultEffort: known?.defaultEffort,
  }
}

/** 解析千帆控制台返回的过期时间（支持 ISO 或 UTC+8 本地时间串 `YYYY-MM-DD HH:mm:ss`）。 */
function parseCstTimeMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw > 1e12 ? raw : raw * 1000
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text)
    ? text.replace(/\s+/, 'T') + '+08:00'
    : text
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

const QIANFAN_CONSOLE_HEADERS = session => ({
  cookie: session,
  accept: 'application/json',
  'x-requested-with': 'XMLHttpRequest',
})

const qianfan = {
  id: 'qianfan',
  title: '千帆 Token Plan',
  endpoint: 'https://qianfan.baidubce.com',
  chatPath: '/v2/tokenplan/personal/chat/completions',
  baseUrl: 'https://qianfan.baidubce.com/v2/tokenplan/personal',
  credentialRef: 'UNIFIED_ROUTER_QIANFAN_API_KEY',
  consoleCredentialRef: 'UNIFIED_ROUTER_QIANFAN_CONSOLE',
  consoleLogin: {
    url: 'https://console.bce.baidu.com/qianfan/resource/token-plan',
    cookieUrls: ['https://console.bce.baidu.com', 'https://bce.baidu.com', 'https://baidu.com'],
    cookieDomains: ['console.bce.baidu.com', 'bce.baidu.com', 'baidu.com'],
    async verify(cookie, fetchJson, signal) {
      const json = await fetchJson({
        url: 'https://console.bce.baidu.com/api/qianfan/charge/tokenPlanPersonal/resource',
        headers: QIANFAN_CONSOLE_HEADERS(cookie),
      }, signal)
      return json?.success === true && Array.isArray(json?.result?.items)
    },
  },
  catalog: {
    fallbackOnEmpty: true,
    request(key) {
      return {
        url: 'https://qianfan.baidubce.com/v2/tokenplan/personal/models',
        headers: { authorization: 'Bearer ' + key },
      }
    },
    parse(json) {
      if (!object(json) || !Array.isArray(json.data)) return []
      const rows = []
      const seen = new Set()
      for (const entry of json.data) {
        if (!object(entry) || !validId(entry.id) || seen.has(entry.id)) continue
        // 实测（2026-11-26）：目录含专用 OCR 模型（unlimited-ocr-2），走 chat/completions 回 400。
        if (entry.id.toLowerCase().includes('-ocr')) continue
        seen.add(entry.id)
        rows.push(qianfanRow(entry.id))
      }
      return rows
    },
    next() { return undefined },
  },
  fallback: Object.keys(QIANFAN_SPECS).map(qianfanRow),
  effortBody(effort, row) {
    if (!Array.isArray(row?.efforts) || !row.efforts.includes(effort)) return undefined
    if (effort === 'off') return { thinking: { type: 'disabled' } }
    const mode = QIANFAN_SPECS[row.id]?.mode ?? 'thinking'
    return mode === 'effort'
      ? { thinking: { type: 'enabled' }, reasoning_effort: effort }
      : { thinking: { type: 'enabled' } }
  },
  balance: null, // 官方 OpenAPI 无余额接口，额度走控制台会话
  consoleQuota: {
    consoleUrl: 'https://console.bce.baidu.com/qianfan/resource/token-plan',
    baseUrl: 'https://console.bce.baidu.com/api/qianfan',
    credentialEnv: 'UNIFIED_ROUTER_QIANFAN_CONSOLE',
    headers: QIANFAN_CONSOLE_HEADERS,
    paths: ['/charge/tokenPlanPersonal/resource'],
    pick: json => (json?.success === true && Array.isArray(json?.result?.items) ? json.result.items : null),
    read([items]) {
      if (!Array.isArray(items) || !items.length) return { windows: [], gifts: [], balance: null }
      const now = Date.now()
      // 跳过已释放或已过期的历史订单；不读取响应中的 apiKey 字段。
      const active = items.find(item => {
        if (!object(item)) return false
        if (String(item.resourceStatus ?? '').toLowerCase() === 'released') return false
        const expiresMs = parseCstTimeMs(item.expiresAt)
        return expiresMs === null || expiresMs > now
      })
      if (!active) return { windows: [], gifts: [], balance: null }
      const expiresMs = parseCstTimeMs(active.expiresAt)
      const resetInMs = expiresMs !== null && expiresMs > now ? Math.round(expiresMs - now) : undefined
      const isCredit = String(active.billingMode ?? '').toLowerCase() === 'credit'
        || active.totalCredits !== undefined || active.usedCredits !== undefined
      const win = isCredit
        ? windowOf('monthly-credits', active.usedCredits, active.totalCredits, null, resetInMs)
        : windowOf('monthly-tokens', active.usedTokens, active.totalTokens, null, resetInMs)
      return { windows: win ? [win] : [], gifts: [], balance: null }
    },
    expiredCodes: ['401', '403'],
    expiredPattern: /未登录|登录|not.?log|unauth|session/i,
  },
  rateLimit: {
    scanOnOk: false,
    codes: {
      token_plan_person_rate_limit_exceeded: 'rpm',
      rate_limit_exceeded: 'rpm',
    },
    exhaustedCodes: ['token_quota_exceeded', 'quota_exceeded'],
  },
}

/* --------------------- 阿里云百炼 Token Plan --------------------- */

// 官方文档：
// - 个人版支持模型：https://help.aliyun.com/zh/model-studio/token-plan-personal-overview（2026-11-16）
// - OpenAI 兼容思考参数（enable_thinking / reasoning_effort）：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
// - 常见报错与限流码：https://help.aliyun.com/zh/model-studio/token-plan-faq（2026-11-21）
const BAILIAN_EFFORT_LEVELS = ['off', 'low', 'high', 'xhigh']
const BAILIAN_EFFORT_TOGGLE = ['off', 'high']
const BAILIAN_EFFORT_ALWAYS_ON = ['high']
// 实测（2026-11-26）：图像/语音/视频及决策模型（decision-model-preview）在文本 chat/completions 下均报 400。
const BAILIAN_NON_CHAT_PREFIXES = ['qwen-image', 'qwen-audio', 'wan', 'happyhorse', 'decision-model']

const BAILIAN_SPECS = {
  'qwen4-max': {
    name: 'Qwen4 Max', context: 1_000_000, output: 262_144, attachment: true,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  'qwen3.8-max': {
    name: 'Qwen3.8 Max', context: 1_000_000, output: 131_072, attachment: true,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'xhigh', mode: 'effort',
  },
  'qwen3.8-flash': {
    name: 'Qwen3.8 Flash', context: 1_000_000, output: 131_072, attachment: true,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'xhigh', mode: 'effort',
  },
  'qwen3.7-max': {
    name: 'Qwen3.7 Max', context: 0, output: 0, attachment: false,
    efforts: BAILIAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'toggle',
  },
  'qwen3.7-plus': {
    name: 'Qwen3.7 Plus', context: 1_000_000, output: 131_072, attachment: true,
    efforts: BAILIAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'toggle',
  },
  'qwen3.6-flash': {
    name: 'Qwen3.6 Flash', context: 1_000_000, output: 65_536, attachment: true,
    efforts: BAILIAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'toggle',
  },
  'deepseek-v4.1-flash': {
    name: 'DeepSeek V4.1 Flash', context: 1_048_576, output: 393_216, attachment: true,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4.1-flash-1017': {
    name: 'DeepSeek V4.1 Flash 1017', context: 1_048_576, output: 393_216, attachment: true,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro', context: 1_048_576, output: 393_216, attachment: false,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-pro-0813': {
    name: 'DeepSeek V4 Pro 0813', context: 1_048_576, output: 393_216, attachment: false,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  'deepseek-v4-flash-0731': {
    name: 'DeepSeek V4 Flash 0731', context: 1_048_576, output: 393_216, attachment: false,
    efforts: BAILIAN_EFFORT_LEVELS, defaultEffort: 'high', mode: 'effort',
  },
  // 实测（2026-11-26）：百炼 glm-5.3 发 enable_thinking:false 回 HTTP 400（restricted to True），仅支持开启。
  'glm-5.3': {
    name: 'GLM 5.3', context: 1_048_576, output: 131_072, attachment: false,
    efforts: BAILIAN_EFFORT_ALWAYS_ON, defaultEffort: 'high', mode: 'toggle',
  },
  'glm-5.2': {
    name: 'GLM 5.2', context: 1_048_576, output: 131_072, attachment: false,
    efforts: BAILIAN_EFFORT_TOGGLE, defaultEffort: 'high', mode: 'toggle',
  },
  auto: {
    name: 'Auto（智能路由）', context: 0, output: 0, attachment: false,
    efforts: [], defaultEffort: undefined, mode: 'none',
  },
}

const bailianRow = id => {
  const known = BAILIAN_SPECS[id]
  const efforts = known?.efforts ?? []
  return {
    id,
    name: known?.name ?? id,
    context: known?.context ?? 0,
    output: known?.output ?? 0,
    attachment: known?.attachment ?? false,
    reasoning: efforts.length > 0,
    efforts: [...efforts],
    defaultEffort: known?.defaultEffort,
  }
}

const BAILIAN_USAGE_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage'
const BAILIAN_CONSOLE_PAGE = 'https://bailian.console.aliyun.com/cn-beijing?tab=plan'
const BAILIAN_GATEWAY_URL = `https://bailian-cs.console.aliyun.com/data/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=${encodeURIComponent(BAILIAN_USAGE_API)}`
const BAILIAN_CLI_TOKEN_URL = 'https://modelstudio.cn-beijing.aliyuncs.com/modelstudio/cli/generateAccessToken'
const BAILIAN_CLI_GATEWAY_URL = `https://bailian-cs.console.aliyun.com/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=${encodeURIComponent(BAILIAN_USAGE_API)}`
const bailianCliTokenCache = new Map()

/**
 * 解析阿里云 AccessKey 凭据（支持 `AccessKeyId:AccessKeySecret` 或 JSON 对象）。
 * 与 Cookie 区分：Cookie 一定含 `=` 且不以 `LTAI` 开头，或经显式 JSON 指定。
 */
export function parseAliyunAccessKey(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text)
      const id = String(parsed?.accessKeyId ?? parsed?.AccessKeyId ?? '').trim()
      const secret = String(parsed?.accessKeySecret ?? parsed?.AccessKeySecret ?? '').trim()
      if (id && secret && !/\s/.test(id) && !/\s/.test(secret)) return { id, secret }
    } catch { return null }
    return null
  }
  const colon = text.indexOf(':')
  if (colon <= 0 || text.includes(';')) return null
  const id = text.slice(0, colon).trim()
  const secret = text.slice(colon + 1).trim()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !secret || /\s/.test(secret) || secret.length > 256) return null
  return { id, secret }
}

/** 阿里云 OpenAPI V3 签名（ACS3-HMAC-SHA256），零外部依赖。 */
export function signAliyunAcs3({ accessKeyId, accessKeySecret, method = 'POST', url, action, version, body = '', now = new Date(), nonce = randomUUID() }) {
  const parsed = new URL(url)
  const payloadHash = createHash('sha256').update(body, 'utf8').digest('hex')
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const canonicalHeaders = {
    host: parsed.host,
    'x-acs-action': action,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': version,
  }
  const signedNames = Object.keys(canonicalHeaders).sort()
  const headerLines = signedNames.map(name => `${name}:${canonicalHeaders[name]}\n`).join('')
  const signedHeaders = signedNames.join(';')
  const queryPairs = [...parsed.searchParams.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const canonicalRequest = [method.toUpperCase(), parsed.pathname || '/', queryPairs, headerLines, signedHeaders, payloadHash].join('\n')
  const hashedCanonical = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  const stringToSign = `ACS3-HMAC-SHA256\n${hashedCanonical}`
  const signature = createHmac('sha256', accessKeySecret).update(stringToSign, 'utf8').digest('hex')
  return {
    ...canonicalHeaders,
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
  }
}

async function mintBailianCliToken(ak, fetchJson, signal, { force = false } = {}) {
  const cacheKey = createHash('sha256').update(`${ak.id}:${ak.secret}`).digest('hex').slice(0, 16)
  const cached = !force ? bailianCliTokenCache.get(cacheKey) : null
  if (cached && cached.expiresAt > Date.now()) return cached.token
  const body = '{}'
  const headers = signAliyunAcs3({
    accessKeyId: ak.id,
    accessKeySecret: ak.secret,
    method: 'POST',
    url: BAILIAN_CLI_TOKEN_URL,
    action: 'GenerateCLIAccessToken',
    version: '2026-02-10',
    body,
  })
  const json = await fetchJson({ url: BAILIAN_CLI_TOKEN_URL, method: 'POST', headers, body }, signal)
  const token = json?.cliAccessToken ?? json?.data?.cliAccessToken ?? json?.Data?.cliAccessToken
  if (typeof token !== 'string' || !token.trim()) {
    const err = new Error('bailian_ak_invalid')
    err.expired = true
    throw err
  }
  // 官方 token 有效期约 20 分钟；本地缓存 15 分钟，遇到 NotLogined 强制重签一次。
  bailianCliTokenCache.set(cacheKey, { token: token.trim(), expiresAt: Date.now() + 15 * 60_000 })
  return token.trim()
}

async function fetchBailianCliGateway(ak, fetchJson, signal) {
  const invoke = async force => {
    const cliToken = await mintBailianCliToken(ak, fetchJson, signal, { force })
    const params = JSON.stringify({
      Api: BAILIAN_USAGE_API,
      V: '1.0',
      Data: {},
    })
    const body = new URLSearchParams({
      product: 'sfm_bailian',
      action: 'BroadScopeAspnGateway',
      region: 'cn-beijing',
      params,
    }).toString()
    return fetchJson({
      url: BAILIAN_CLI_GATEWAY_URL,
      method: 'POST',
      headers: {
        authorization: `Bearer ${cliToken}`,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        accept: 'application/json',
      },
      body,
    }, signal)
  }
  let json = await invoke(false)
  const isExpired = res => {
    const code = String(res?.code ?? '')
    const errCode = String(res?.data?.errorCode ?? res?.errorCode ?? '')
    return code === '401' || code === '403' || /NotLogined|Unauth|Login/i.test(errCode)
  }
  if (isExpired(json)) json = await invoke(true)
  return { expired: isExpired(json), json }
}

function bailianPercentWindow(id, rawPct, rawResetMs, now) {
  const pct = amount(rawPct)
  if (pct === null) return null
  const clamped = Math.min(1, Math.max(0, pct))
  const used = Math.round(clamped * 1000) / 10
  const remaining = Math.max(0, Math.round((1 - clamped) * 1000) / 10)
  const resetMs = parseCstTimeMs(rawResetMs)
  const resetInMs = resetMs !== null && resetMs > now ? Math.round(resetMs - now) : undefined
  return windowOf(id, used, 100, remaining, resetInMs)
}

/**
 * 读取百炼 Token Plan 个人版用量，支持两种凭据形态：
 * 1) 阿里云 AccessKey（`AccessKeyId:AccessKeySecret` / JSON）：走官方 `bl` CLI 同款
 *    ACS3-HMAC-SHA256 `GenerateCLIAccessToken` → `POST /cli/api.json`（全平台免浏览器、长期有效）；
 * 2) 控制台浏览器 Cookie：GET 控制台页提取 `SEC_TOKEN` → `POST /data/api.json`。
 * ⚠️ Cookie 模式 `cornerstoneParam` 绝不可硬编码某账号的 `switchAgent`。
 */
async function fetchBailianConsoleGateway(session, fetchJson, signal) {
  const ak = parseAliyunAccessKey(session)
  if (ak) return fetchBailianCliGateway(ak, fetchJson, signal)
  const html = await fetchJson({
    url: BAILIAN_CONSOLE_PAGE,
    headers: { cookie: session, accept: 'text/html,application/xhtml+xml' },
    responseType: 'text',
    maxBytes: 1_048_576,
  }, signal)
  const secToken = typeof html === 'string' ? /\bSEC_TOKEN\s*:\s*"([^"]+)"/.exec(html)?.[1] : null
  if (!secToken) return { expired: true, json: null }
  const params = JSON.stringify({
    Api: BAILIAN_USAGE_API,
    V: '1.0',
    Data: {
      cornerstoneParam: {
        feURL: `${BAILIAN_CONSOLE_PAGE}#/efm/subscription/token-plan/personal`,
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        domain: 'bailian.console.aliyun.com',
        consoleSite: 'BAILIAN_ALIYUN',
        userNickName: '',
        userPrincipalName: '',
      },
    },
  })
  const body = new URLSearchParams({
    product: 'sfm_bailian',
    action: 'BroadScopeAspnGateway',
    region: 'cn-beijing',
    sec_token: secToken,
    params,
  }).toString()
  const json = await fetchJson({
    url: BAILIAN_GATEWAY_URL,
    method: 'POST',
    headers: {
      cookie: session,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json',
      origin: 'https://bailian.console.aliyun.com',
      referer: BAILIAN_CONSOLE_PAGE,
    },
    body,
  }, signal)
  const code = String(json?.code ?? '')
  const errCode = String(json?.data?.errorCode ?? '')
  if (code === '401' || code === '403' || /NotLogined|Unauth|Login/i.test(errCode)) {
    return { expired: true, json }
  }
  return { expired: false, json }
}

const bailian = {
  id: 'bailian',
  title: '阿里云百炼',
  endpoint: 'https://token-plan.cn-beijing.maas.aliyuncs.com',
  chatPath: '/compatible-mode/v1/chat/completions',
  baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  credentialRef: 'UNIFIED_ROUTER_BAILIAN_API_KEY',
  consoleCredentialRef: 'UNIFIED_ROUTER_BAILIAN_CONSOLE',
  consoleLogin: {
    url: BAILIAN_CONSOLE_PAGE,
    cookieUrls: ['https://bailian.console.aliyun.com', 'https://bailian-cs.console.aliyun.com', 'https://aliyun.com'],
    cookieDomains: ['bailian.console.aliyun.com', 'bailian-cs.console.aliyun.com', 'console.aliyun.com', 'aliyun.com'],
    async verify(cookie, fetchJson, signal) {
      const { expired, json } = await fetchBailianConsoleGateway(cookie, fetchJson, signal)
      if (expired) return false
      return json?.successResponse === true || json?.data?.DataV2?.data?.success === true
    },
  },
  catalog: {
    fallbackOnEmpty: true,
    request(key) {
      return {
        url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models',
        headers: { authorization: 'Bearer ' + key },
      }
    },
    parse(json) {
      if (!object(json) || !Array.isArray(json.data)) return []
      const rows = []
      const seen = new Set()
      for (const entry of json.data) {
        if (!object(entry) || !validId(entry.id) || seen.has(entry.id)) continue
        const lower = entry.id.toLowerCase()
        // 图像/视频/语音模型在 Token Plan 文本 Base URL 下无法调用，过滤出聊天列表。
        if (BAILIAN_NON_CHAT_PREFIXES.some(prefix => lower.startsWith(prefix))) continue
        seen.add(entry.id)
        rows.push(bailianRow(entry.id))
      }
      return rows
    },
    next() { return undefined },
  },
  fallback: Object.keys(BAILIAN_SPECS).map(bailianRow),
  effortBody(effort, row) {
    if (!Array.isArray(row?.efforts) || !row.efforts.includes(effort)) return undefined
    if (effort === 'off') return { enable_thinking: false }
    const mode = BAILIAN_SPECS[row.id]?.mode ?? 'toggle'
    return mode === 'effort'
      ? { enable_thinking: true, reasoning_effort: effort }
      : { enable_thinking: true }
  },
  balance: null, // Token Plan 专属 Key 只授权推理，额度走控制台会话
  consoleQuota: {
    consoleUrl: BAILIAN_CONSOLE_PAGE,
    baseUrl: 'https://bailian-cs.console.aliyun.com',
    credentialEnv: 'UNIFIED_ROUTER_BAILIAN_CONSOLE',
    async fetch(session, fetchJson, signal) {
      const { expired, json } = await fetchBailianConsoleGateway(session, fetchJson, signal)
      if (expired) return { expired: true }
      const usage = json?.data?.DataV2?.data?.data ?? json?.data?.data
      if (!object(usage)) return { windows: [], gifts: [], balance: null }
      const now = Date.now()
      const windows = [
        bailianPercentWindow('window-percent', usage.per5HourPercentage, usage.per5HourResetTime, now),
        bailianPercentWindow('weekly-percent', usage.per1WeekPercentage, usage.per1WeekResetTime, now),
        bailianPercentWindow('monthly-percent', usage.per1MonthPercentage, usage.per1MonthResetTime, now),
      ].filter(Boolean)
      return { windows, gifts: [], balance: null }
    },
  },
  rateLimit: {
    scanOnOk: false,
    codes: {
      rate_limit_exceeded: 'rpm',
      Throttling: 'rpm',
      'Throttling.RateQuota': 'rpm',
      'Throttling.ServiceOverloaded': 'rpm',
      'Throttling.AllocationQuota': 'tpm',
      'Throttling.ResourceExhausted': 'tpm',
      // 百炼把每分钟 Token 限流也标成 `insufficient_quota`（429 实测样本见
      // throttlePattern），按 TPM 限流处理；真正的额度用尽由 exhaustedPattern
      // 与 exhaustedCodes 拦住。
      insufficient_quota: 'tpm',
    },
    // 429 实测原文：`Allocated quota exceeded, please increase your quota limit.
    // For details, see: …/error-code#token-limit` —— message 与锚点都指向
    // **每分钟 Token 限流**，不是账户额度耗尽。
    throttlePattern: /token-limit|allocated[\s_-]+quota[\s_-]+exceeded|increase[\s_-]+your[\s_-]+quota[\s_-]+limit|quota[\s_-]+per[\s_-]+minute|\brate[\s_-]+limit|too[\s_-]+many[\s_-]+requests/i,
    exhaustedCodes: ['AllocationQuota.FreeTierOnly'],
    exhaustedPattern: /free[\s_-]+tier|free[\s_-]+quota|欠费|arrears|balance[\s_-]+(?:exhausted|depleted)|out[\s_-]+of[\s_-]+(?:credits?|budget)/i,
  },
}

/* --------------------- 阶跃星辰 Step Plan（国内） --------------------- */

// 官方文档：
// - 推理模型接入与支持模型：https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api（2026-11-04）
// - 控制台额度：Connect-JSON `POST /api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`
const STEPFUN_EFFORTS = ['low', 'medium', 'high']
const STEPFUN_NON_CHAT_PREFIXES = ['stepaudio', 'step-tts', 'step-asr', 'step-1x', 'step-video']

const STEPFUN_SPECS = {
  'step-5-preview': {
    name: 'Step 5 Preview', context: 1_048_576, output: 65_536, attachment: true,
    efforts: STEPFUN_EFFORTS, defaultEffort: 'medium',
  },
  'step-3.7-flash': {
    name: 'Step 3.7 Flash', context: 262_144, output: 0, attachment: true,
    efforts: STEPFUN_EFFORTS, defaultEffort: 'medium',
  },
  'step-3.5-flash-2603': {
    name: 'Step 3.5 Flash 2603', context: 262_144, output: 0, attachment: false,
    efforts: STEPFUN_EFFORTS, defaultEffort: 'medium',
  },
  'step-3.5-flash': {
    name: 'Step 3.5 Flash', context: 262_144, output: 0, attachment: false,
    efforts: STEPFUN_EFFORTS, defaultEffort: 'medium',
  },
  'step-router-v1': {
    name: 'Step Router V1', context: 0, output: 0, attachment: false,
    efforts: [], defaultEffort: undefined,
  },
}

const stepfunRow = id => {
  const known = STEPFUN_SPECS[id]
  const efforts = known?.efforts ?? []
  return {
    id,
    name: known?.name ?? id,
    context: known?.context ?? 0,
    output: known?.output ?? 0,
    attachment: known?.attachment ?? false,
    reasoning: efforts.length > 0,
    efforts: [...efforts],
    defaultEffort: known?.defaultEffort,
  }
}

const STEPFUN_CONSOLE_URL = 'https://platform.stepfun.com/step-plan'
const STEPFUN_RATE_LIMIT_URL = 'https://platform.stepfun.com/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit'

function stepfunConsoleHeaders(session) {
  const raw = String(session ?? '').trim()
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    origin: 'https://platform.stepfun.com',
    referer: STEPFUN_CONSOLE_URL,
  }
  // 兼容两种粘贴格式：完整 Cookie 头（含 Oasis-Token=...）或裸 Oasis-Token 值。
  if (raw.includes('=')) {
    headers.cookie = raw
    const oasisToken = raw.match(/(?:^|;\s*)Oasis-Token=([^;]+)/i)?.[1]
    const oasisWebid = raw.match(/(?:^|;\s*)Oasis-Webid=([^;]+)/i)?.[1]
    if (oasisToken) headers['oasis-token'] = decodeURIComponent(oasisToken)
    if (oasisWebid) headers['oasis-webid'] = decodeURIComponent(oasisWebid)
  } else if (raw) {
    headers['oasis-token'] = raw
    headers.cookie = `Oasis-Token=${raw}`
  }
  return headers
}

/**
 * 解析 Step Plan 剩余比例窗口（上游 `*_left_rate` 为 0..1 剩余比例，与百炼相反）。
 * 上游约定：无该窗口时返回 `leftRate === 0` 且 `resetTime === 0`（除非有显式 buckets），
 * 不得将「无窗口」误显示为「0% 已耗尽」。
 */
function stepfunLeftWindow(id, rawLeft, rawReset, now, { allowZeroReset = false } = {}) {
  const left = amount(rawLeft)
  if (left === null) return null
  const resetNum = amount(rawReset)
  const hasReset = resetNum !== null && resetNum > 0
  if (left === 0 && !hasReset && !allowZeroReset) return null
  const clamped = Math.min(1, Math.max(0, left))
  const remaining = Math.round(clamped * 1000) / 10
  const used = Math.max(0, Math.round((1 - clamped) * 1000) / 10)
  const resetMs = hasReset ? (resetNum > 1e12 ? resetNum : resetNum * 1000) : null
  const resetInMs = resetMs !== null && resetMs > now ? Math.round(resetMs - now) : undefined
  return windowOf(id, used, 100, remaining, resetInMs)
}

function parseStepfunRateLimitResponse(json, now = Date.now()) {
  if (!object(json)) return { windows: [], gifts: [], balance: null }
  const credit = object(json.plan_credit_rate_limit) ? json.plan_credit_rate_limit : null
  const hasBuckets = Array.isArray(credit?.credit_buckets) && credit.credit_buckets.length > 0
  const windows = [
    stepfunLeftWindow('window-percent', json.five_hour_usage_left_rate, json.five_hour_usage_reset_time, now),
    stepfunLeftWindow('weekly-percent', json.weekly_usage_left_rate, json.weekly_usage_reset_time, now),
    credit ? stepfunLeftWindow('monthly-percent', credit.subscription_credit_left_rate, credit.subscription_credit_reset_time, now, { allowZeroReset: hasBuckets }) : null,
  ].filter(Boolean)
  return { windows, gifts: [], balance: null }
}

const stepfun = {
  id: 'stepfun',
  title: 'Step Plan',
  endpoint: 'https://api.stepfun.com',
  chatPath: '/step_plan/v1/chat/completions',
  baseUrl: 'https://api.stepfun.com/step_plan/v1',
  credentialRef: 'UNIFIED_ROUTER_STEPFUN_API_KEY',
  consoleCredentialRef: 'UNIFIED_ROUTER_STEPFUN_CONSOLE',
  consoleLogin: {
    // 直达 platform.stepfun.com/step-plan（未登录自动跳 account.stepfun.com，完成后回跳
    // 才会刷新平台域的 Oasis-Token Cookie；不能直达账号中心页）。
    url: STEPFUN_CONSOLE_URL,
    cookieUrls: ['https://platform.stepfun.com', 'https://stepfun.com'],
    cookieDomains: ['platform.stepfun.com', 'stepfun.com'],
    async verify(cookie, fetchJson, signal) {
      const json = await fetchJson({
        url: STEPFUN_RATE_LIMIT_URL,
        method: 'POST',
        headers: stepfunConsoleHeaders(cookie),
        body: '{}',
      }, signal)
      if (!object(json) || json.code === 'unauthenticated') return false
      return 'five_hour_usage_left_rate' in json || 'weekly_usage_left_rate' in json || object(json.plan_credit_rate_limit)
    },
  },
  catalog: {
    fallbackOnEmpty: true,
    request(key) {
      return {
        url: 'https://api.stepfun.com/step_plan/v1/models',
        headers: { authorization: 'Bearer ' + key },
      }
    },
    parse(json) {
      if (!object(json) || !Array.isArray(json.data)) return []
      const rows = []
      const seen = new Set()
      for (const entry of json.data) {
        if (!object(entry) || !validId(entry.id) || seen.has(entry.id)) continue
        const lower = entry.id.toLowerCase()
        if (STEPFUN_NON_CHAT_PREFIXES.some(prefix => lower.startsWith(prefix))) continue
        seen.add(entry.id)
        rows.push(stepfunRow(entry.id))
      }
      return rows
    },
    next() { return undefined },
  },
  fallback: Object.keys(STEPFUN_SPECS).map(stepfunRow),
  effortBody(effort, row) {
    if (!Array.isArray(row?.efforts) || !row.efforts.includes(effort)) return undefined
    return { reasoning_effort: effort }
  },
  balance: null, // Step Plan 专属额度走控制台会话
  consoleQuota: {
    consoleUrl: STEPFUN_CONSOLE_URL,
    baseUrl: 'https://platform.stepfun.com',
    credentialEnv: 'UNIFIED_ROUTER_STEPFUN_CONSOLE',
    async fetch(session, fetchJson, signal) {
      const json = await fetchJson({
        url: STEPFUN_RATE_LIMIT_URL,
        method: 'POST',
        headers: stepfunConsoleHeaders(session),
        body: '{}',
      }, signal)
      if (!object(json)) return { windows: [], gifts: [], balance: null }
      if (json.code === 'unauthenticated' || json.code === 'permission_denied') return { expired: true }
      return parseStepfunRateLimitResponse(json)
    },
  },
  rateLimit: {
    scanOnOk: false,
    codes: { rate_limit_exceeded: 'rpm' },
    exhaustedCodes: ['insufficient_quota', 'quota_exceeded'],
  },
}

export const APIKEY_PROVIDERS = Object.freeze({ agnes, unisound, qianfan, bailian, stepfun })
export const APIKEY_PROVIDER_IDS = Object.freeze(Object.keys(APIKEY_PROVIDERS))

export function apikeyProvider(id) {
  return Object.hasOwn(APIKEY_PROVIDERS, id) ? APIKEY_PROVIDERS[id] : undefined
}
