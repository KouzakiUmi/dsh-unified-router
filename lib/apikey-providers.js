// API Key 渠道（Agnes / 云知声）的规格对象：端点、目录解析、兜底表、
// 思考方言与余额解析。形状契约见 docs/APIKEY-CHANNELS.md §2「渠道规格」，
// 渠道事实（哪些是实测、哪些来自官方文档）见同文件 §1。这里不写文档外
// 的能力假设：未确认的上下文/输出记 0，未确认的能力一律 false / []。

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
const UNISOUND_THINKING = {
  'u2-flash': { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  u2: { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  'u2-med': { efforts: UNISOUND_EFFORTS, defaultEffort: 'high' },
  'u2-radimed': { efforts: [], defaultEffort: undefined },
}

const unisoundRow = (id, name, context, output) => {
  const thinking = UNISOUND_THINKING[id] ?? { efforts: [], defaultEffort: undefined }
  return {
    id,
    name,
    context,
    output,
    attachment: UNISOUND_IMAGE_MODELS.has(id),
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
    restore: row => ({ ...row, attachment: UNISOUND_IMAGE_MODELS.has(row.id) }),
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
}

export const APIKEY_PROVIDERS = Object.freeze({ agnes, unisound })
export const APIKEY_PROVIDER_IDS = Object.freeze(Object.keys(APIKEY_PROVIDERS))

export function apikeyProvider(id) {
  return Object.hasOwn(APIKEY_PROVIDERS, id) ? APIKEY_PROVIDERS[id] : undefined
}
