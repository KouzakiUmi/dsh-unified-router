# API Key 渠道（Agnes / 云知声 / 千帆 Token Plan / 阿里云百炼 / Step Plan）

本文是 API Key 类渠道的接口契约：宿主侧管理器、模型设置、推理适配器、渠道规格与 RPC 投影。
五家 API Key 渠道共用同一套实现，差异只在 `lib/apikey-providers.js` 的规格对象里。

## 1. 渠道事实（实测与官方文档）

### Agnes（国内站）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | `https://api.agnes-ai.cn`，OpenAI 兼容 `POST /v1/chat/completions`，Bearer 鉴权 | 官方文档 + 实测 |
| 目录 | `GET /v1/models` → `{data:[{id, supported_endpoint_types}]}`，只有 id，没有上下文与能力字段 | 实测 2026-11-19 |
| 文本模型 | `agnes-3.0-flash`、`agnes-2.5-flash`：512K 上下文 / 65536 输出，文本+图片 URL，**免费账号可用**（标「免费」） | 官方文档 |
| | `agnes-3.0-pro`、`agnes-2.5-pro`、`agnes-2.5-pro-alpha`、`agnes-2.5-pro-beta`：1M 上下文 / 65536 输出，文本+图片 URL，推理，**需付费余额或 Agent Plan 订阅**（标「需付费」） | 官方文档 |
| | `agnes-2.5-pro-theta`：目录里存在，规格文档未给出 → 上下文与输出按未知（0），属付费 Pro 系列（标「需付费」）；全部 `2.5` 老一代已移出默认推荐 | 实测目录 + 官方文档 |
| 非聊天模型 | `agnes-image-*`、`agnes-video-*` 以及 `supported_endpoint_types: []` 的内部决策模型（如 `agnes-sys1-1.0`）出现在同一目录，聊天适配器必须过滤掉 | 实测目录 |
| 图像生成与编辑 | `agnes_image_generate` 默认 Agnes Image 2.5 Flash；在「Agnes → 渠道 → 图像生成与编辑」启用，与聊天模型开关独立 | [官方接口](https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash)，文生图和图生图均实测通过 |
| 思考 | 默认不思考；`reasoning_effort: "none"` 保持关闭；`low` 起开启思考并返回 `reasoning_content`。`thinking:{type:"disabled"}` 实测**关不掉**思考，不使用 | 实测（agnes-3.0-flash） |
| 用量 | 站点是 New API 分支：`GET /v1/dashboard/billing/subscription`（`hard_limit_usd`）与 `GET /v1/dashboard/billing/usage`（`total_usage`）；套餐窗口、积分包和余额由国内站控制台接口读取。账单或控制台额度读取为 0 时识别为「免费用户」 | 兼容账单已实测；控制台解析基于前端协议与离线样例 |
| 不可用 | `/api/user/self`、`/api/usage/token` 被 Cloudflare 挡（403），不使用 | 实测 |

图像工具复用 Agnes API Key。无参考图时文生图，有参考图时按顺序发送最多 4 张当前对话可见图片，主图放第一张。结果在对话中预览，也可用于下一次编辑。支持 `1K` 至 `4K` 和八种宽高比；宿主附件服务缩放时记录原尺寸。生图模型不进入聊天模型选择器。

### 云知声 MaaS

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | OpenAI 兼容 `https://maas-api.unisound.com/v1`（`POST /v1/chat/completions`），Bearer 鉴权 | 官方文档 |
| 目录 | `GET /anthropic/v1/models`（`x-api-key` 或 Bearer），返回 `{data:[{id, display_name, type, created_at, max_input, context_window, max_output}], has_more, last_id}`，支持 `limit`/`after_id` 分页 | 官方文档 + 2026-11-23 真实 Key 实测（HTTP 200，付费 API Key 返 30 条、`has_more:false`） |
| 目录范围 | **U Plan 订阅与付费 API 的目录范围不同**：U Plan Key 只列 u2 系列（3–4 条），付费 API Key 列全部 30 条（含第三方模型）。这是套餐差异，不是缺陷，代码不做补齐或过滤 | 2026-11-23 实测对照 |
| 模型 | Unisound：`u2-flash`、`u2`、`u2-med`、`u2-radimed`；另有 DeepSeek、豆包、混元、MiMo、Kimi、GLM、MiniMax、Qwen 等第三方模型，同一 Key 调用 | 官方文档 |
| 对话附图 | **u2 系列按官方文档**：`u2-flash`、`u2-med`、`u2-radimed` 接受文本和图片（`u2-med` 见产品页「输入模态：文本、图片」；`u2` 只声明文本输入）。**转售的第三方模型**：云知声目录不下发任何能力字段，官方「文本生成」文档也只列 u2 系列，故按 **pi-ai 内置目录**（`@earendil-works/pi-ai` 的 `dist/providers/data/*.json`，1204 个模型，逐 provider 全票）判定，大小写归一后核对。判为**支持**：`qwen3.8-max/3.8-flash`、`qwen3.7-plus`、`qwen3.6-plus/3.6-flash`、`kimi-k3/k2.5/k2.6`、`deepseek-v4.1-flash`、`minimax-m3`、`mimo-v2.6-pro/flash`、`glm-5.3-flash`（pi-ai 16 个 provider 里 15 个判支持）；pi-ai 无条目时按官方文档：`qwen3.6-35b-a3b`（[阿里云百炼](https://www.alibabacloud.com/help/zh/model-studio/qwen3-6-35b-a3b)「原生视觉语言模型、输入模态 Image/Text/Video」）、`doubao-seed-2.1-pro/turbo`（WorkBuddy 上游声明）。判为**纯文本**：`glm-5/5.1/5.2/5.3`、`deepseek-v4-pro/v4-flash-0731`、`qwen3.7-max`、`minimax-m2.5`、`hy3/hy4-preview`（pi-ai 全部 provider 均判纯文本，**即使 WorkBuddy 对 `glm-5.2/5.3`、`deepseek-v4-pro` 声明 `supports_images` 也不改云知声口径**——转售按原厂能力）。未获证据的可手动开 `supportsImage`。走宿主附件服务内联为 Base64 `image_url`，不依赖 OCR 工具 | [U2-Med](https://maas.unisound.com/models/insure-med) · [模型广场](https://maas.unisound.com/model-hub/u2-med) · [文本生成文档](https://maas.unisound.com/docs/guide/text/text-generation) · [Qwen3.6-35B-A3B](https://www.alibabacloud.com/help/zh/model-studio/qwen3-6-35b-a3b) · 2026-11-23 付费 Key 拉 30 条实测 + pi-ai 逐 provider 核对 |
| 模型参数 | 优先使用目录返回的 `context_window` 与 `max_output`；目录缺字段时用**真实 Key 拉取的目录真值**（2026-11-23 核对）：`u2-flash` 1,048,576 / 262,144、`u2` 160,000 / 64,000、`u2-med` 262,144、`u2-radimed` 40,960。`u2-med` 与 `u2-radimed` 的上游 `max_output` 就是 `null`（**不公开**）→ 记 0，输出预算走通用推导，不编造官方值。离线兜底表用同组真值 | 真实 Key 拉取 `GET /anthropic/v1/models`（30 条，`has_more:false`） |
| 思考 | `u2`、`u2-flash`、`u2-med`：`reasoning_effort` 取 `none/minimal/low/medium/high/xhigh`，默认 `high`，`max` 映射为 `xhigh`（`off` 出站发 `none`）；`u2-flash` 产品页另写 `none/low/high/max` 四档。`u2-radimed` 默认关闭且不支持开启。第三方模型未获确认，不挂思考档位 | 官方文档 |
| 默认输出上限 | 每个渠道可在「渠道」分区单独设定（`automation.json` 的 `providers[id].defaultMaxOutput`，分档 默认 / 64K / 128K / 256K）。**只在上游没给输出规格时生效**：目录 `max_output` 缺失或为 `null` 的模型（如 `u2-med` / `u2-radimed`）用它，上游有值仍用上游值；结果始终受「输出 < 上下文」约束 | `test/apikey-providers.test.mjs` 分渠道默认输出上限用例 |
| u2 系列元数据（权威快照） | 2026-11-23 付费 API Key 真拉，`context_window` / `max_output` / `display_name` 原样记录：`u2-flash` 1,048,576 / 262,144 / "U2 Flash"；`u2` 160,000 / 64,000 / "U2"；`u2-med` 262,144 / **null** / "U2 Med"；`u2-radimed` 40,960 / **null** / "U2-RadiMed"。**这两条 `null` 是上游不公开，不是解析失败**：记 0 后输出预算按 `min(上下文, 32K)` 推导，不用第三方转述值覆盖 | 真拉响应逐条核对（30 条全量无损解析） |
| 余额 | 推理 API Key 无公开余额接口（官方 API 参考 24 页无 billing/usage/quota 页，第三方 pi-provider-unisound 同结论）；控制台会话可读取 U Plan 的 5 小时与每周积分、赠送额度，按量计费余额走 `/manager/bd/users/remain?model=<id>` | [U Plan 订阅概要](https://maas.unisound.com/docs/token-plan/overview)、控制台前端 bundle 逐条核验（2026-11-20） |
| 多模态能力 | 官方 U2 SkillHub 六个模型 Skill（u2-asr-pro / u2-tts-pro / u2-tts-clone-pro / u1-ocr-parser-pro / u1-ocr-extract-pro / u1-ocr-med-pro）已移植为 Host 工具，见 §1.2 | skill.unisound.com 公开包脚本（2026-11-20 下载核验） |

### 1.2 云知声多模态能力工具（`lib/unisound-tools.js`）

官方 SkillHub 的六个模型 Skill 移植为 DSH Host 工具，设置页云知声「渠道」分区有独立开关（`toolsEnabled`，与模型提供方开关互不影响），需要已配置 API Key 才能注册。

| 工具 | 能力 | 上游端点（`https://maas-api.unisound.com`） |
|---|---|---|
| `unisound_transcribe` | U2-ASR 语音转写（本地文件/公网 URL，多语种/方言、说话人分离、热词） | 上传 `/v1/files/upload`（purpose `a2t_async_input`）→ `POST /v1/audio/asr/tasks` → `GET /v1/audio/asr/tasks/{id}` 轮询 |
| `unisound_list_voices` | 查询系统/已克隆音色 | `POST /v1/audio/voices/query` |
| `unisound_synthesize` | U2-TTS 语音合成（≤5 万字；克隆音色 ≤2 万字），音频落盘返回路径 | `POST /v1/audio/speech/tasks` → `GET /v1/audio/speech/tasks?task_id=` 轮询 → `GET /v1/files/retrieve_content?file_id=` 下载 |
| `unisound_clone_voice` | 声音克隆（参考音频 WAV → 自定义 voice_id） | 上传 purpose `voice_clone`/`prompt_audio` → `POST /v1/audio/voices/clone` |
| `unisound_parse_document` | U2-OCR 文档解析（JPG/PNG/PDF → Markdown） | 上传 purpose `ocr_async_input` → `POST /v1/files/parser/tasks` → `GET /v1/files/parser/tasks/{id}` 轮询 → 下载 `md_file_url` |
| `unisound_extract_image` | 图片信息抽取与分类（general/medical × classify/extract） | [POST /v1/ocr/image/extract](https://maas.unisound.com/docs/api/ocr-extract)：multipart `model=u2-ocr/u2-ocr-med`、`type=image`、`file`（Base64 Data URL）、`prompt`；图片 ≤10 MB |

设计取舍：
- **凭据不落盘**：调用时经 `resolveKey()` 从宿主 credentials 服务取 `UNIFIED_ROUTER_UNISOUND_API_KEY`，不写官方 Skill 的 `.env.local` / `api-keys.json`；Key 不进入返回值与错误文案。
- **医疗分类候选 prompt** 从官方包提取到 `lib/unisound-tools-prompts/medical-classify.txt`（随 `lib` 打包）。[U Plan 订阅概要](https://maas.unisound.com/docs/token-plan/overview) 列明套餐包含 `u2-ocr-med` 赠送额度。
- **输出有界**：转写/Markdown 超过 60K 字符时截断并落盘到状态目录 `unisound-tools-output/`，返回文件路径；音频下载到调用方指定路径或状态目录。
- **注册契约**：`ctx.tools.register(defineTool(...))`（`@deepseek-ai/dsh-tools`，动态 import，optional peer；旧核心无 tools 服务时开关报「未能启用」但不影响推理）。注册串行化，dispose 释放全部工具。
- 业务码 `base_resp.status_code` 非 0 即失败，错误文案只带业务码与截断后的 `status_msg`。

### 1.3 控制台会话自动获取（云知声）

额度读取的控制台 Cookie 不再要求手工配环境变量，设置页云知声「渠道」分区提供「控制台会话」行：
- **浏览器登录**（`apikey.consoleLogin`）：复用 `lib/browser-login.js` 的 `launchIsolatedBrowserCookieLogin`，独立临时 Profile **直达 `https://maas.unisound.com/login` 登录页**（而非 `/admin/subscript` SPA shell——未登录时 SPA 先下发匿名 JSESSIONID 再前端跳转，收割易抓到登录换发前的旧会话），用户扫码/验证码登录后经 CDP 收割 `maas.unisound.com` 域 Cookie，用 `GET /manager/account/info`（`errorCode '0'` 且 `result` 非空）验证。**两轮稳定复验**：首次 verify 通过只记候选，≥1.5s 后下一轮收割拿到同一会话且仍有效才接受——防登录成功瞬间服务端换发 JSESSIONID（session fixation 防护）时存到换发前短暂仍有效的旧 ID。验证通过后写入凭据引用 `UNIFIED_ROUTER_UNISOUND_CONSOLE`。登录地址经快照 `consoleLoginUrl` 透出供界面展示。
- **粘贴 Cookie**（`apikey.setConsoleSession`）：同样先验证再存；**清除**（`apikey.clearConsoleSession`）删除凭据。
- 额度读取（`readApiKeyQuota`）**凭据会话优先于环境变量** `UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE`；只读 GET 也随 Cookie 带 `X-XSRF-TOKEN` 头（取自 `XSRF-TOKEN` Cookie，与浏览器行为一致）。实测 `/manager/u-plan/subscription/current` 返回的 `weeklyPointsTotal` / `weeklyPointsRemain` / `weeklyPointsUsed` 为十进制字符串（未激活 5 小时窗口时省略 `window5hLimit` / `window5hRemain`），且超出窗口时偶发负剩余字符串；读数层在未开启 5 小时窗口时按套餐档位（`U-FREE`: 500 / `U-STANDARD`: 2000 / `U-PLUS`: 12000 或 `weeklyPointsTotal / 5`）补齐完整 5 小时积分窗口，并将负剩余归零。返回另附带 `giftQuotas[]`（`modelId` / `remainAmount` / `totalAmount` / `usedAmount` / `unit`），`apiQuotaAmount` 兼容纯非负十进制字符串，`projectApiKeyQuota` 同步白名单投影 `gifts`。
- 同一接口可返回 `window5hResetIn*` 和 `weeklyResetIn*` 倒计时；额度药丸和设置页以最近采集时间为基准展示约多久后重置。未给出倒计时的窗口只显示余量，不使用套餐结束时间代替重置时间。
- 控制台会话只发往 `maas.unisound.com`，读取禁止重定向；Cookie 原文不进任何返回值、日志与错误文案。

### 百度千帆 Token Plan 个人版（`qianfan`）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | OpenAI 兼容 `https://qianfan.baidubce.com/v2/tokenplan/personal`（`POST /v2/tokenplan/personal/chat/completions`），专属 API Key Bearer 鉴权 | [快速开始](https://cloud.baidu.com/doc/qianfan/s/kmracfgi2)（2026-11-11） |
| 目录 | `GET /v2/tokenplan/personal/models`（2026-11-26 真实 Key 实测 HTTP 200 返回 12 条，仅 `id`/`object`/`owned_by`），过滤 `*-ocr*` 非聊天模型（实测 `unlimited-ocr-2` 走 chat/completions 回 400），空表回落官方兜底清单 | 2026-11-26 真实 Key 实测 + [个人版文档](https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6) |
| 模型 | `ernie-5.5-flash-preview`、`ernie-light-dt-1.0`、`deepseek-v4.1-flash-1017`、`deepseek-v4.1-flash`、`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek-v4-flash-0731`、`glm-5.3`、`glm-5.3-flash`、`glm-5.2`、`glm-5.1` 及控制台路由别名 `qianfan-code-latest` | [Token Plan 个人版](https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6) · [模型列表](https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43) |
| 思考 | `thinking: { type: 'enabled' \| 'disabled' }`；DeepSeek V4 系列与 `ernie-light-dt-1.0` 另支持 `reasoning_effort`；`ernie-5.5-flash-preview` / `glm-5.3` / `glm-5.3-flash` 仅支持开启不支持关闭 | [深度思考文档](https://cloud.baidu.com/doc/qianfan-docs/s/Wm95lyynv)（2026-11-11） |
| 控制台额度 | 专属 API Key 无公开余额端点；浏览器登录 `https://console.bce.baidu.com/qianfan/resource/token-plan`（或粘贴 Cookie，存 `UNIFIED_ROUTER_QIANFAN_CONSOLE`）调 `GET /api/qianfan/charge/tokenPlanPersonal/resource`，跳过 `Released`/过期条目，按 `billingMode` 投影为 `monthly-credits`（积分制）或 `monthly-tokens`（Token 制），忽略响应中的 `apiKey` 字段 | 控制台前端协议（参考 `yetone/magpie#5860` / `@8f3f7a4`） |
| 限流/耗尽 | `429 token_plan_person_rate_limit_exceeded` 记 RPM 限速；`429 token_quota_exceeded` / `quota_exceeded` 为月度额度耗尽不记短时限速 | [个人版专属错误码](https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6) |

### 阿里云百炼 Token Plan（`bailian`）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | OpenAI 兼容 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（`POST /compatible-mode/v1/chat/completions`），`sk-sp-` 专属 API Key Bearer 鉴权 | [Cursor 接入指南](https://help.aliyun.com/zh/model-studio/cursor) · [Token Plan FAQ](https://help.aliyun.com/zh/model-studio/token-plan-faq)（2026-11-21） |
| 目录 | `GET /compatible-mode/v1/models`（2026-11-26 真实 Key 实测 HTTP 200 返回 22 条，仅 `id`/`object`/`created`/`owned_by`），过滤 `qwen-image*`/`qwen-audio*`/`wan*`/`happyhorse*`/`decision-model*` 等非聊天模型（保留 14 个聊天模型），空表回落官方兜底清单 | 2026-11-26 真实 Key 实测 + [个人版订阅与权益](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview) |
| 模型 | `qwen4-max`、`qwen3.8-max`、`qwen3.8-flash`、`qwen3.7-max`、`qwen3.7-plus`、`qwen3.6-flash`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek-v4-flash-0731`、`glm-5.3`、`glm-5.2`、`auto`（`qwen4-max-preview` 已随预览期结束下线，`decision-model-preview` 在 chat 端点报 400 已过滤） | 2026-11-26 真实 Key 实测 + [个人版订阅与权益](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview) |
| 思考 | `enable_thinking: true \| false`；Qwen4/Qwen3.8/DeepSeek V4 系列同时支持 `reasoning_effort`（`low`/`high`/`xhigh`，实测 `off`/`high`/`xhigh` 均正常）；**`glm-5.3` 实测发 `enable_thinking: false` 回 HTTP 400（`restricted to True`），仅提供开启档**；`auto` 不下发思考参数 | 2026-11-26 真实 Key 逐模型实测 + [OpenAI 兼容 Chat 文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| 控制台额度 | 专属 `sk-sp-` Key 只授权推理；浏览器登录 `https://bailian.console.aliyun.com/cn-beijing?tab=plan`（或粘贴 Cookie，存 `UNIFIED_ROUTER_BAILIAN_CONSOLE`），两步取数：① GET 控制台页提取 `SEC_TOKEN`；② POST `BroadScopeAspnGateway` 调 `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage`（**严禁硬编码 `switchAgent`**），按 `per5HourPercentage` / `per1WeekPercentage` / `per1MonthPercentage` 投影为百分比窗口（`window-percent` / `weekly-percent` / `monthly-percent`） | 控制台网关实测协议（参考 `can1357/oh-my-pi#12260`） |
| 限流/耗尽 | `429 Requests rate limit exceeded` / `Throttling*` 记限速；`429 insufficient_quota` 为套餐额度耗尽不记短时限速 | [Token Plan FAQ](https://help.aliyun.com/zh/model-studio/token-plan-faq) |

### 阶跃星辰 Step Plan（`stepfun`）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | OpenAI 兼容 `https://api.stepfun.com/step_plan/v1`（`POST /step_plan/v1/chat/completions`），Step Plan API Key Bearer 鉴权 | [推理模型接入](https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api)（2026-11-04） |
| 目录 | `GET /step_plan/v1/models`（实测无 Key 返回 401，端点存在），过滤 `stepaudio*`/`step-tts*`/`step-asr*`/`step-1x*`/`step-video*`，空表回落官方兜底清单 | 2026-11-26 端点探针 + 官方文档 |
| 模型 | `step-5-preview`（1M / 65536，多模态）、`step-3.7-flash`（256K，多模态）、`step-3.5-flash-2603`（256K）、`step-3.5-flash`（256K）、`step-router-v1` | [推理模型接入](https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api) |
| 思考 | OpenAI 协议三档 `reasoning_effort: 'low' \| 'medium' \| 'high'`（默认 `medium`，无 `off` 档）；`step-router-v1` 不下发 | [推理模型接入](https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api) |
| 控制台额度 | 浏览器登录直达 `https://platform.stepfun.com/step-plan`（未登录自动跳账号中心并在回跳后刷新平台域 `Oasis-Token`）或粘贴 Cookie / 裸 `Oasis-Token`（存 `UNIFIED_ROUTER_STEPFUN_CONSOLE`），调 Connect-JSON `POST /api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`，按 `*_left_rate`（剩余比例，0+0 视为无窗口）投影为 `window-percent` / `weekly-percent` / `monthly-percent` | 控制台协议（参考 `yetone/magpie` `stepfun_plan.go` 与 `dsh-musage-card`） |

### 控制台额度与限速提醒

- 控制台会话来源：设置页浏览器登录/粘贴（存凭据引用，见 §1.3），或宿主启动环境变量 `UNIFIED_ROUTER_AGNES_CONSOLE_TOKEN`（Agnes）/ `UNIFIED_ROUTER_UNISOUND_CONSOLE_COOKIE`（云知声，作回退）。推理仍使用原 API Key。
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
export const APIKEY_PROVIDERS    // { agnes, unisound, qianfan, bailian, stepfun }，Object.freeze
export const APIKEY_PROVIDER_IDS // ['agnes', 'unisound', 'qianfan', 'bailian', 'stepfun']
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
  // 可选：没有这一段就不读控制台、也不显示「控制台额度」行。
  consoleQuota: {
    consoleUrl: 'https://…',                    // UI「打开控制台」链接，经快照透出给客户端
    baseUrl: 'https://…',                       // 控制台 API 基址（与 endpoint 不同域）
    credentialEnv: 'UNIFIED_ROUTER_…_CONSOLE',  // 宿主凭据里没有会话时的环境变量回退
    headers(session) { return { … } },          // 鉴权头：Bearer Token 或 Cookie（+ XSRF）
    paths: ['/usage'],                          // 并发 GET；失败的响应以 null 交给 read
    pick(json) { return data | null },          // 成功判据 + 取数据体（各家成功码字段不同）
    read(jsons) { return { windows, gifts, balance } }, // 归一化成额度窗口
    expiredCodes: ['401', '403'],               // 命中即判「会话已过期」
    expiredPattern: /未登录|session.{0,5}超时/i, // 可选：中文错误串判据
  },
  rateLimit: {                                  // 可选；缺省则只认 429 且不限流类型
    scanOnOk: false,                            // true = 2xx 也读 body（上游用 200 回限流体）
    codes: { '100501': 'rpm', '100502': 'tpm' }, // 业务码 → 限流类型
  },
}
```

**共享层不得按渠道名分支。** 控制台额度的取数与解析全部写在规格里（与 `catalog.request/parse` 同构），
`lib/apikey-quota.js` 只是执行器：取凭据 → 并发请求 → 归一化状态，**不含任何渠道名判断**。
`rateLimit.codes` 同理。这条纪律由 `test/apikey-new-channel.test.mjs` 守住 —— 它用一个虚构渠道
（`fixture-key`，地址都是 `example` 域）走通额度读取、限流识别与管理器全链路；哪天新渠道必须改
`lib/` 里的共享文件才能接入，那条用例会先红。

控制台页面地址也只存在规格一处：`consoleQuota.consoleUrl` 经渠道快照的 `consoleQuotaUrl` 字段透出给客户端，
客户端不再维护「渠道 id → URL」的映射表（那张表是第二份真源，加渠道时必漏）。

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
| `apikey.setToolsEnabled` | `{provider, enabled}` | `{toolsEnabled, toolsRegistered}`（仅 `spec.tools` 渠道） |
| `apikey.setConsoleSession` | `{provider, cookie}` | `{hasConsoleSession}`（仅 `spec.consoleCredentialRef` 渠道；先验证再存） |
| `apikey.clearConsoleSession` | `{provider}` | `{hasConsoleSession:false}` |
| `apikey.consoleLogin` | `{provider}` | `{signedIn, hasConsoleSession?}`（浏览器登录收割 Cookie，单飞） |

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
  // 仅 spec.tools 渠道：
  toolsSupported, toolsEnabled, toolsRegistered,
  // 仅 spec.consoleCredentialRef 渠道：
  hasConsoleSession, consoleLoginUrl,
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
| `lib/apikey-providers.js` | 渠道规格：端点、目录解析、兜底表、思考方言、余额解析、**控制台额度配方**、限流码、控制台登录与工具声明 |
| `lib/apikey-llm.js` | 推理适配器：把启用的目录行装配成 pi-ai 适配器，限制请求地址，合并思考字段 |
| `lib/apikey-models.js` | 模型开关与参数的落盘存储（每渠道一个文件） |
| `lib/apikey-channel.js` | 管理器：Key、目录、注册、快照、写操作、工具开关、控制台会话 |
| `lib/unisound-tools.js` | 云知声多模态能力工具（六个官方 Skill 的 Host 移植）+ `unisound-tools-prompts/` 资产 |
| `lib/apikey-quota.js` | 控制台额度与限流识别的**通用执行器**（按规格配方取数；凭据会话优先于 env；不含渠道名判断） |
| `lib/browser-login.js` | 独立临时 Profile 浏览器登录 + CDP Cookie 收割（云知声控制台会话复用） |
| `lib/rpc.js`、`lib/web-host.js`、`lib/settings-providers.js` | 方法白名单、管理器装配、公开投影、设置快照资源 |
| `src/client/providers/apikey.js` 及 `agnes.js` / `unisound.js` / `qianfan.js` / `bailian.js` / `stepfun.js` | 设置页视图 |
