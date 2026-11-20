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
  'agnes-2.5-flash': { name: 'Agnes 2.5 Flash', context: 524_288, output: 65_536, attachment: true },
  'agnes-3.0-flash': { name: 'Agnes 3.0 Flash', context: 524_288, output: 65_536, attachment: true },
  'agnes-2.5-pro': { name: 'Agnes 2.5 Pro', context: 1_048_576, output: 65_536, attachment: true },
  'agnes-2.5-pro-alpha': { name: 'Agnes 2.5 Pro Alpha', context: 1_048_576, output: 65_536, attachment: true },
  'agnes-2.5-pro-beta': { name: 'Agnes 2.5 Pro Beta', context: 1_048_576, output: 65_536, attachment: true },
  'agnes-2.5-pro-theta': { name: 'Agnes 2.5 Pro Theta', context: 0, output: 0, attachment: false },
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
  }
}

const agnes = {
  id: 'agnes',
  title: 'Agnes',
  endpoint: 'https://api.agnes-ai.cn',
  chatPath: '/v1/chat/completions',
  baseUrl: 'https://api.agnes-ai.cn/v1',
  credentialRef: 'UNIFIED_ROUTER_AGNES_API_KEY',
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
        // 同一目录混入图片/视频生成模型（实测），聊天适配器按 id 前缀过滤。
        if (entry.id.startsWith('agnes-image') || entry.id.startsWith('agnes-video')) continue
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
// 等第三方模型）不确认就不声明：efforts 空、reasoning false、attachment false。
const UNISOUND_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
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
    attachment: false,
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
  catalog: {
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
  // 兜底只放官方文档确认存在的 u2 系列。u2-flash 官方产品页标注
  // 上下文 1M / 最大输出 128K；其余三个无公开规格，记 0。
  fallback: [
    unisoundRow('u2-flash', 'u2-flash', 1_048_576, 131_072),
    unisoundRow('u2', 'u2', 0, 0),
    unisoundRow('u2-med', 'u2-med', 0, 0),
    unisoundRow('u2-radimed', 'u2-radimed', 0, 0),
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
