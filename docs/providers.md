# 提供商清单

本文件展开 [README 的支持清单](../README.md#支持清单)：逐渠道写清**模型目录来源、思考档位方言、模型参数、额度 / 用量与限制**。

事实源是同仓库的代码与设计文档，不是文档维护者的记忆：

| 内容 | 事实源 |
|---|---|
| 渠道类型、登录方式、签到与目录来源 | [`src/client/providers/`](../src/client/providers/) 的 provider 模块与 [`lib/rpc.js`](../lib/rpc.js) 的 `PROVIDERS` |
| 模型目录来源与兜底表 | [MODEL-CURATION.md](../MODEL-CURATION.md) 与 [docs/CATALOG-AUDIT.md](CATALOG-AUDIT.md) |
| Agnes / 云知声的端点、目录、思考与用量 | [docs/APIKEY-CHANNELS.md](APIKEY-CHANNELS.md) 第 1 节，以及 `lib/apikey-providers.js` |
| 界面规则与参数入口 | [docs/DESIGN-STANDARDS.md](DESIGN-STANDARDS.md) |

目录来源在「模型」分区的分组标题旁标注为**远端目录 / 上次目录 / 内置目录 / 来源未知**。硬编码兜底表只在拉不到上游目录（未登录、网络失败）时使用，不是上游目录的替代真相。

---

## Loomy

- **模型目录来源**：上游 `GET https://loomyad.xunfei.cn/api/v1/models`（Bearer + token）；离线兜底为 7 条实测快照（chat 类，与 2026-11-18 真拉的 chat 目录逐条一致）。
- **思考档位**：上游下发 `default_reasoning_effort=low`，插件的默认档取 `high`（设计决定）。模型卡片与「默认」按钮显示实际默认参数，未知默认值显示「上游决定」。
- **模型参数**：经模型行共同的「参数」入口调整上下文、输出量、思考与图片设置；保存后保留当前编辑位置。
- **额度 / 用量**：账号积分与额度包，账号行显示剩余额度与更新时间。倍率徽标由选择器原生渲染，来源是上游名称里拆出的倍率。
- **签到与奖励**：支持每日签到；另有新手任务登录奖励，在账号行的「管理」区域领取。
- **限制**：Loomy 专有「锁定永久积分」开关（仅使用有时效的积分）。只接 CN 版。

## Raccoon（小浣熊）

- **模型目录来源**：上游 `GET https://xiaohuanxiong.com/api/web/llm/v2/model_catalog`，**免费面与订阅面各用本侧账号的凭据**拉取；离线兜底两侧各 7 条（订阅面 id 一律带 `-p`）。
- **思考档位（两套方言，按模型分流）**：
  - 上游目录带托管档位的模型（`params.raccoon_thinking` 的 `managed`）：档位原样发在**请求体顶层** `raccoon_thinking_level`，取值 `level_1`…`level_5` / `off`，**不再发** `extra_body.thinking`，两套方言互斥。
  - 没有托管档位的老模型：走旧方言 `extra_body.thinking:{type:'enabled'|'disabled'}`（开 / 关两态）。
  - 上游 `default_level` 为 `off` 的模型，插件默认档取**最低思考档**；`off` 仍保留为可选项。
- **模型参数**：上下文、输出量、思考档位与图片设置；免费与订阅两个目录分别提供刷新、启停与参数设置。
- **额度 / 用量**：账号积分；倍率徽标取自上游的 `billing_effective_multiplier` / `billing_status`（免费、计费、促销、未知各按实际状态挂标）。
- **签到与奖励**：有登录奖励（onboarding），也支持**每日签到**，没有永久积分锁定。上游没有专门的签到端点：当日积分由服务端在收到**带桌面端头**的 `GET /api/web/office/v3/setting_info` 时发放，插件据此触发一次并按 `points/v1/bills` 的当日新增账单回报本次得到多少积分。签到是**账号级**事项，由 `raccoon` 侧调度（`raccoon-pro` 是同一账号的订阅面视图，不重复签到）。
- **限制**：**一张卡片 + 一个账号池 + 两个相互独立的模型提供方**（`raccoon` = 免费面、`raccoon-pro` = 订阅面）。账号只有一个池，登录后按套餐标记分流；两侧模型池完全独立，不做倍率过滤——上游对该账号返回什么模型就展示什么模型。免费面只使用非订阅账号，订阅面只使用订阅账号。

## Qoder 中国版

- **模型目录来源**：**官方 CLI** `qoderclicn --list-models`（目录端点需专有 WASM 签名，插件不重实现）。解析纯文本表，**括号里的 key 才是目录 id**；id 以 CLI 为准，能力与倍率属性与策展表合并，表外新 id 的上下文记 0、不编造。CLI 不可用时回落 14 条实测快照。详见 [docs/QODER-CLI.md](QODER-CLI.md)。
- **思考档位**：采用已确认的 CN 目录与官方档位。内部代号（`qmodel_38max`、`qfmodel` 等）使用已知别名显示，请求 ID 原样保留。
- **模型参数**：上下文参考档位为 200K / 400K / 1M。
- **额度 / 用量**：账号积分；签到后进入新的积分周期（每日 10:00 UTC+8）。
- **签到与奖励**：支持每日签到。
- **限制**：目录拉取是 **opt-in**——自动补拉对 Qoder 中国版跳过，只有手动点「刷新目录」才调用 CLI。未登录 / CLI 不存在 / 超时 / 返回空表时静默回落内置目录，界面提示先运行一次 `qoderclicn login`。本机 IDE 走 job_token，CLI 无持久登录态，需要用户做一次官方登录。只接 CN 版。

## TRAE

- **模型目录来源**：上游 `POST /api/ide/v1/batch_get_detail_param`（`solo_agent` 通道）；离线兜底为 20 条实测快照（2026-11-18 以 `solo_agent` 通道真拉重建）。
- **思考档位**：模型行的「参数」入口按上游声明显示可用思考档位与默认值。
- **模型参数**：上下文、输出量、思考与图片设置经共同「参数」入口调整；模型目录默认全部启用，没有「其他模型」分组。
- **额度 / 用量**：积分与余额；倍率徽标取自上游的 credits 倍率。
- **签到与奖励**：支持每日签到（一键「全部领取」）。
- **限制**：认证用 ExchangeToken（轮换 refreshToken），对话用 Cloud-IDE-JWT 鉴权，SSE 为自定义格式。只接 CN 版（Trae Global 不接入）。

## 商汤 Token Plan

- **模型目录来源**：上游 `GET https://token.sensenova.cn/v1/models`，Bearer 鉴权（API Key）。**没有硬编码模型目录**，目录纯上游。
- **思考档位**：每个模型带可用档位列表与默认档位；模型卡片显示默认值，会话中显式选择的档位优先。
- **模型参数**：上下文、最大输出、默认思考档位与图片输入；**协议兼容性**可逐模型覆盖输出字段、推理字段、工具消息与流式用量等参数。最大输出的覆盖上限为 10,000,000。
- **额度 / 用量**：额度池监控、5 小时 / 7 天窗口、赠送额度、模型消耗与模型提供方开关，在「账号与额度」与「渠道」分区查看。
- **签到与奖励**：使用 API Key 管理模型与调用参数，没有每日签到。
- **限制**：目录每次刷新都请求 API 的 `/v1/models`；换 Key 保存时，旧 Key 拉到的目录会被清空隔离，避免把不相关账号的模型展示出来。

## WorkBuddy

- **模型目录来源**：优先读已登录账号的实时清单（上游 `GET https://copilot.tencent.com/v3/config` 的 `agents[cli].models`），拉取失败回退站点内置清单（16 条实测快照）。
- **思考档位**：模型行的「参数」入口按上游声明显示可用思考档位与默认值。
- **模型参数**：逐模型启停；启用的模型注册为推理适配器，可在对话模型选择器中选用。参数经共同「参数」入口调整。
- **额度 / 用量**：套餐与积分窗口（Credits / Extra credits 等），余额读取走 WorkBuddy 计费接口，展示套餐名与各积分窗口的剩余 / 总额 / 重置时间，未读到的显示「未知」。
- **签到与奖励**：支持每日签到（中国版计量接口），签到结果以 WorkBuddy 返回为准。
- **限制**：**自管多账号渠道**，不走账号池，账号上限 8 个；签到与退出登录都按账号操作。登录走官方浏览器授权，主机轮询授权结果（最长约 5 分钟）。模型目录只读展示，免费模型标注「免费」。用量 / 登录接口是其客户端使用的接口，非公开 Web API。只接 CN 版（WorkBuddy AI 不接入）。

## Agnes

以下事实区分**实测**与**官方文档**，来源为 [docs/APIKEY-CHANNELS.md](APIKEY-CHANNELS.md) 第 1 节与 `lib/apikey-providers.js`。

- **端点**：`https://api.agnes-ai.cn`，OpenAI 兼容 `POST /v1/chat/completions`，Bearer 鉴权（官方文档 + 实测）。
- **模型目录来源**：`GET /v1/models` → `{data:[{id, supported_endpoint_types}]}`，**只有 id，没有上下文与能力字段**（实测 2026-11-19）。离线兜底为 6 条确认存在的文本模型 id。同一目录里混有 `agnes-image-*`、`agnes-video-*` 非聊天模型，聊天适配器按 id 前缀过滤（实测目录）。
- **思考档位**：默认不思考。`reasoning_effort` 取 `none` / `low` / `medium` / `high`，`none` 保持关闭，`low` 起开启思考并返回 `reasoning_content`（实测，agnes-3.0-flash）。`thinking:{type:"disabled"}` 实测**关不掉**思考，不使用。
- **模型参数**：规格取官方文档——`agnes-2.5-flash`、`agnes-3.0-flash` 为 512K 上下文 / 65536 输出，文本 + 图片 URL；`agnes-2.5-pro`、`agnes-2.5-pro-alpha`、`agnes-2.5-pro-beta` 为 1M 上下文 / 65536 输出，文本 + 图片 URL，推理。`agnes-2.5-pro-theta` 目录里存在但规格文档未给出，上下文与输出按未知（0）处理，不假设图片输入；表外新 id 同样记 0，不编造。
- **额度 / 用量**：站点是 New API 分支，读取 `GET /v1/dashboard/billing/subscription`（`hard_limit_usd`）与 `GET /v1/dashboard/billing/usage`（`total_usage`，OpenAI 账单口径，美分），实测返回 200。`hard_limit_usd` 达到 10,000,000 时界面标为「无限额度」。`total_usage` 的单位按 OpenAI 账单口径推定，实测值为 0。
- **限制**：`/api/user/self`、`/api/usage/token` 被 Cloudflare 挡（403），不使用（实测）。账户信息接口不可用，用量只从上述账单接口读取。无 Key 时目录显示兜底表，模型提供方开关不可用。

## 云知声

以下事实区分**实测**与**官方文档**，来源为 [docs/APIKEY-CHANNELS.md](APIKEY-CHANNELS.md) 第 1 节与 `lib/apikey-providers.js`。

- **端点**：OpenAI 兼容 `https://maas-api.unisound.com/v1`（`POST /v1/chat/completions`），Bearer 鉴权（官方文档）。
- **模型目录来源**：`GET /anthropic/v1/models`（`x-api-key` 或 Bearer 皆可），返回 `{data:[{id, display_name, context_window, max_output}], has_more, last_id}`，支持 `limit` / `after_id` 分页（官方文档，**未用真实 Key 实测**）。离线兜底为 4 条官方文档确认存在的 u2 系列。
- **模型**：Unisound 自家 `u2-flash`、`u2`、`u2-med`、`u2-radimed`；另有 DeepSeek、豆包、混元、MiMo、Kimi、GLM、MiniMax、Qwen 等第三方模型，同一把 Key 调用（官方文档）。
- **思考档位**：`u2`、`u2-flash`、`u2-med` 的 `reasoning_effort` 取 `none` / `minimal` / `low` / `medium` / `high` / `xhigh`，默认 `high`，`max` 映射为 `xhigh`；`u2-flash` 产品页另写 `none` / `low` / `high` / `max` 四档。`u2-radimed` 默认关闭且不支持开启。其余模型（含第三方模型）未获确认，不挂思考档位（官方文档）。
- **模型参数**：优先使用目录返回的 `context_window` 与 `max_output`；目录缺字段时用**真实 Key 拉取的目录真值**（2026-11-23 核对，`GET /anthropic/v1/models` 返 30 条）：`u2-flash` 1,048,576 / 262,144、`u2` 160,000 / 64,000、`u2-med` 262,144、`u2-radimed` 40,960。`u2-med` 与 `u2-radimed` 的上游 `max_output` 就是 `null`（**不公开**）→ 记 0，输出预算走通用推导，不编造官方值。离线兜底表用同组真值。
- **附图**：`u2-flash`、`u2-med`、`u2-radimed` 可直接附图聊天（`u2-med` 官方产品页「输入模态：文本、图片」；`u2` 只声明文本输入）。
- **额度 / 用量**：**官方文档没有公开余额接口，设置页不显示用量**。「渠道」分区只显示 API Key 与模型提供方开关。
- **限制**：目录的分页由 `after_id` 游标驱动。无 Key 时目录显示兜底表，模型提供方开关不可用。
