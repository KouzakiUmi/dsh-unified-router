# API Key 渠道（Agnes / 云知声）

本文是 API Key 类渠道的接口契约：宿主侧管理器、模型设置、推理适配器、渠道规格与 RPC 投影。
Agnes 与云知声共用同一套实现，差异只在 `lib/apikey-providers.js` 的规格对象里。

## 1. 渠道事实（实测与官方文档）

### Agnes（国内站）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | `https://api.agnes-ai.cn`，OpenAI 兼容 `POST /v1/chat/completions`，Bearer 鉴权 | 官方文档 + 实测 |
| 目录 | `GET /v1/models` → `{data:[{id, supported_endpoint_types}]}`，只有 id，没有上下文与能力字段 | 实测 2026-11-19 |
| 文本模型 | `agnes-2.5-flash`、`agnes-3.0-flash`：512K 上下文 / 65536 输出，文本+图片 URL | 官方文档 |
| | `agnes-2.5-pro`、`agnes-2.5-pro-alpha`、`agnes-2.5-pro-beta`：1M 上下文 / 65536 输出，文本+图片 URL，推理 | 官方文档 |
| | `agnes-2.5-pro-theta`：目录里存在，规格文档未给出 → 上下文与输出按未知（0） | 实测目录 |
| 非聊天模型 | `agnes-image-*`、`agnes-video-*` 出现在同一目录，聊天适配器必须过滤掉 | 实测目录 |
| 思考 | 默认不思考；`reasoning_effort: "none"` 保持关闭；`low` 起开启思考并返回 `reasoning_content`。`thinking:{type:"disabled"}` 实测**关不掉**思考，不使用 | 实测（agnes-3.0-flash） |
| 用量 | 兼容账单接口返回的巨大名义上限与零用量组合按无数据处理；套餐窗口、积分包和余额由国内站控制台接口读取 | 兼容账单已实测；控制台解析基于前端协议与离线样例 |
| 不可用 | `/api/user/self`、`/api/usage/token` 被 Cloudflare 挡（403），不使用 | 实测 |

### 云知声 MaaS

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | OpenAI 兼容 `https://maas-api.unisound.com/v1`（`POST /v1/chat/completions`），Bearer 鉴权 | 官方文档 |
| 目录 | `GET /anthropic/v1/models`（`x-api-key` 或 Bearer），返回 `{data:[{id, display_name, context_window, max_output}], has_more, last_id}`，支持 `limit`/`after_id` 分页 | 官方文档，未用真实 Key 实测 |
| 模型 | Unisound：`u2-flash`、`u2`、`u2-med`、`u2-radimed`；另有 DeepSeek、豆包、混元、MiMo、Kimi、GLM、MiniMax、Qwen 等第三方模型，同一 Key 调用 | 官方文档 |
| 思考 | `u2`、`u2-flash`：`reasoning_effort` 取 `none/minimal/low/medium/high/xhigh`，默认 `high`，`max` 映射为 `xhigh`；`u2-flash` 产品页另写 `none/low/high/max` 四档。`u2-radimed` 默认关闭且不支持开启 | 官方文档 |
| 余额 | 推理 API Key 无公开余额接口；控制台会话可读取 U Plan 的 5 小时与每周积分 | [U Plan 订阅概要](https://maas.unisound.com/docs/token-plan/overview)、控制台前端协议与离线样例 |

### 控制台额度与限速提醒

- 在宿主启动环境中配置 `UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN`（Agnes 国内站控制台 Bearer 会话）或 `UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE`（云知声控制台 Cookie）。推理仍使用原 API Key；控制台会话只发往对应固定域名，读取请求禁止重定向。
- 设置页「渠道」展示读取到的控制台额度。会话缺失或失效时显示对应状态及控制台入口；额度状态不改变推理注册或模型开关。
- 推理命中 HTTP 429 后显示限速倒计时，优先用 `Retry-After`，缺失时估算 60 秒。云知声 JSON 业务码 `100501` / `100502` 分别显示 RPM / TPM，已识别的余额或套餐耗尽不生成倒计时。提醒不自动重试，也不拦截请求。

## 2. 数据结构

### 目录行（后端内部，`row`）

```js
{
  id: 'agnes-3.0-flash',   // 上游模型 id，≤256 字符
  name: 'Agnes 3.0 Flash', // 展示名
  context: 524288,         // 上下文窗口，0 = 未知
  output: 65536,           // 最大输出，0 = 未知
  attachment: true,        // 是否接受图片输入
  reasoning: true,         // 是否有思考能力
  efforts: ['off', 'low', 'medium', 'high'], // 取值 ⊆ PLAN_EFFORTS（lib/sensenova-params.js）；[] = 没有思考档位
  defaultEffort: 'off',    // 可省略
}
```

### 渠道规格（`lib/apikey-providers.js`）

```js
export const APIKEY_PROVIDERS   // { agnes: spec, unisound: spec }，Object.freeze
export const APIKEY_PROVIDER_IDS // ['agnes', 'unisound']
export function apikeyProvider(id) // 未知 id 返回 undefined

spec = {
  id: 'agnes',
  title: 'Agnes',
  endpoint: 'https://api.agnes-ai.cn',         // origin，不带路径
  chatPath: '/v1/chat/completions',
  baseUrl: 'https://api.agnes-ai.cn/v1',       // 交给 pi-ai 的 baseUrl
  credentialRef: 'UNIFIED_ROUTER_AGNES_API_KEY',
  catalog: {
    request(key) { return { url, headers } },  // 单页请求；云知声分页由 pages 控制
    parse(json) { return row[] },              // 过滤非聊天模型，坏形状返回 []
  },
  fallback: row[],                             // 拉不到上游目录时的兜底（只放确认存在的 id）
  effortBody(effort, row) { return object | undefined }, // 合并进请求体的思考字段；effort 可为 'off'
  balance: null | {
    requests(key) { return [{ url, headers }] },
    parse(jsons) { return { used, limit, unlimited, unit } | null },
  },
}
```

云知声目录有分页：`catalog.request(key, cursor?)` 接受可选的 `after_id` 游标，`catalog.next(json)` 返回下一页游标或 `undefined`。Agnes 的 `next` 恒返回 `undefined`。

### 管理器（`lib/apikey-channel.js`）

```js
createApiKeyManager(ctx, spec, deps = {}) -> { call(method, payload, signal), collectSnapshot(signal), invalidate(), dispose() }
// deps: { stateFile, catalogFile, modelSettingsFile,
//         fetch,                 // 测试注入，默认 globalThis.fetch
//         modelSettings,         // 测试注入，默认 createApiKeyModelSettings(modelSettingsFile, spec.id)
//         loadLlmAdapter }       // 测试注入，默认 () => import('./apikey-llm.js')
```

| 方法 | payload | 返回 |
|---|---|---|
| `apikey.snapshot` | `{provider}` | 见下方快照 |
| `apikey.setKey` | `{provider, apiKey}` | `{hasApiKey}` |
| `apikey.setEnabled` | `{provider, enabled}` | `{enabled, providerRegistered}` |
| `apikey.setModelEnabled` | `{provider, modelId, enabled}` | `{modelId, enabled}` |
| `apikey.setModelParams` | `{provider, modelId, params}` | `{modelId, ...模型字段}` |
| `apikey.resetModels` | `{provider}` | `{enabledModelIds}` |

`payload.provider !== spec.id` 一律抛 `不支持此渠道`。

管理器内部快照：

```js
{
  hasKey, enabled, registered,
  catalogSource: 'remote' | 'cached' | 'fallback',
  catalogError,   // 有 Key 但本次没拉到远端目录
  updatedAt,
  models: [ { ...row, enabled, contextWindow, maxOutputLength, vision, effectiveEffort, params,
              defaultContextWindow, defaultMaxOutputLength, defaultVision, defaultEffort } ],
  balance: null | { used, limit, unlimited, unit, updatedAt } | { error: true },
}
```

行为约定：

- Key 经宿主 `credentials` 服务存取，引用名为 `spec.credentialRef`；Key 不进入任何返回值、日志与错误文案；长度 ≤4096，保存前 `trim()`。
- 无 Key 时目录显示 `spec.fallback`（`catalogSource: 'fallback'`），模型可见但提供方不注册。
- 有 Key 时拉上游目录并缓存（`lib/catalog-cache.js`，scope 用 Key 的 sha256 前 12 位，换 Key 后旧缓存不可读）；拉取失败回落缓存，再回落 `spec.fallback`。目录 60 秒内复用。
- 注册条件：`enabled && hasKey && 至少一个启用的模型`。注册方式照 `lib/workbuddy.js` 的 `refreshRouting`（`llm.registerAdapter` + 代理 + `emitAdaptersUpdated`）；条件不再满足时释放。
- 余额读取 5 秒超时，失败只给 `{error: true}`，不影响目录与注册。

### RPC 投影（`lib/web-host.js` 的 `publicResult`）

`apikey.snapshot`：

```js
{ provider, hasApiKey, registerProvider, providerRegistered, catalogSource, catalogError, updatedAt,
  models: [ { id, name, enabled, ...publicPlanModel({ ...m, thinkingLevels: m.efforts }) } ],
  balance: null | { used, limit, unlimited, unit, updatedAt } | { error: true } }
```

模型字段与商汤渠道的 `plan.snapshot` 同形（`publicPlanModel`），客户端可复用同一套模型编辑器。

## 3. 文件归属

| 文件 | 职责 |
|---|---|
| `lib/apikey-providers.js` | 渠道规格：端点、目录解析、兜底表、思考方言、余额解析 |
| `lib/apikey-llm.js` | 推理适配器：把启用的目录行装配成 pi-ai 适配器，限制请求地址，合并思考字段 |
| `lib/apikey-models.js` | 模型开关与参数的落盘存储（每渠道一个文件） |
| `lib/apikey-channel.js` | 管理器：Key、目录、注册、快照、写操作 |
| `lib/rpc.js`、`lib/web-host.js`、`lib/settings-providers.js` | 方法白名单、管理器装配、公开投影、设置快照资源 |
| `src/client/providers/apikey.js`、`agnes.js`、`unisound.js` | 设置页视图 |
