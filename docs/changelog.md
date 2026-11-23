# 更新记录

> 按版本倒序排列。0.3.0 是首个公开版本，此前 0.4.0–0.9.x 的内部迭代编号已合并进 0.3.0，不再逐版本罗列。

## 0.6.1（2026-11-23）

- 修复云知声 `u2-med` 无法直接附图聊天；该模型的图片能力此前被漏在声明列表之外。
- 修复云知声转售第三方模型的图片能力判定：`qwen3.8-max/3.8-flash`、`qwen3.7-plus`、`qwen3.6-plus/3.6-flash`、`qwen3.6-35b-a3b`、`kimi-k3/k2.5/k2.6`、`deepseek-v4.1-flash`、`minimax-m3`、`mimo-v2.6-pro/flash`、`glm-5.3-flash`、`doubao-seed-2.1-pro/turbo` 恢复附图；`glm-5` 系列、`deepseek-v4-pro/v4-flash-0731`、`qwen3.7-max`、`minimax-m2.5`、`hy3/hy4-preview` 按原厂能力标为纯文本。
- 修复小浣熊 `sn-glm-5-3` 的图片能力与离线兜底表不一致（同一模型在一处启用、一处禁用）。
- 修复 AStudio `DeepSeek-V4.1-Flash` 补漏条目缺少附图能力。
- 修复「默认输出上限」在账号池与商汤套餐渠道也显示，导致设置后不生效。
- 修复小浣熊凭据续期回退到另一账号时，出站模型标识未重新按新账号套餐计算。

## 0.6.0（2026-11-23）

- 小浣熊新增「统一免费与订阅模型」开关（渠道分区，默认关闭）。开启后免费与订阅模型合并为一组：同名模型只出现一次，优先使用免费账号，免费额度用尽自动改用订阅账号，额度药丸显示全部账号。关闭时恢复两组独立模型。
- 新增「智能选号模式」全局设置，四档：手动顺序、免费额度优先、临期额度优先、缓存优先（同一模型沿用当前账号，用尽或受限才切换）。原来的「优先使用赠送与临期额度」开关自动对应临期额度优先。
- 每个渠道新增「默认输出上限」设置（默认 / 64K / 128K / 256K），只在上游没有给出输出规格时生效；上游给出真实规格时按上游值显示。
- 修复云知声 `u2-med` 无法直接附图聊天。`u2-med`、`u2`、`u2-radimed` 的上下文与输出规格改用上游目录实测值。
- 输入栏额度药丸改为逐窗口余量条：收起态只显示最紧张窗口的一个数字，窗口明细与临时/永久分项移到悬浮提示。

## 0.5.16（2026-11-22）

- 新增输入栏上下文档位控件和渠道额度药丸。额度浮层显示套餐、用量、最紧张窗口和可用的重置时间，跟随当前模型切换。
- 对可追踪的多账号路由，额度浮层置顶当前或最近调用的账号，其他账号默认折叠。
- 新增「优先使用赠送与临期额度」全局开关（默认关闭）。支持的多账号渠道优先选择有每日、免费赠送或 7 天内到期余额的账号。
- 修复 CodeArts 切换模型时的会话释放和思考档位，CodeArts 推理使用 v2 接口；Loomy 仅提供低、中、高三档。
- 云知声新增语音和 OCR 工具、控制台额度接入；`u2-flash` 和 `u2-radimed` 支持直接附图聊天。图片抽取使用当前 U2 OCR 接口，修复旧请求返回 404。
- 优化模型目录、推荐和倍率徽标，统一解析思考档位和有效输出预算，并保留模型开关与手动参数设置。
- 输出快捷档最高提供 `512K`，上下文 `1M` 档位和已有自定义参数保持不变。
- 新增 Agnes 和商汤 Token Plan 的图像生成与编辑工具。可从当前对话引用图片，生成结果以对话附件返回。
- 移除 Coze（扣子）渠道的模型、账号设置和自动化任务。已有凭据和对话历史保留；原来选用 Coze 的对话可切换到其他模型继续。
- 移除豆包工作渠道。旧接口会创建豆包远端工作会话；原来选用该渠道的 DSH 对话可切换到其他模型继续，已有历史保留。

## 0.5.3（2026-11-20）

- 修复 Agnes、云知声重启后的注册恢复，以及自管渠道账号状态与详情文案不一致。
- CodeArts 使用系统默认浏览器登录；Coze 从官方桌面端登录后导入，支持在官方登录页选择火山账号。
- CodeArts 签到区分已领取、未查到记录、读取失败与领取待确认。
- 豆包工作补齐额度解析与任务状态展示；完成与领取在豆包工作中操作。
- 补齐新渠道旧版模型标记，以及 Agnes、云知声的控制台额度和限速倒计时。

## 0.5.2（2026-11-20）

### 真机联调问题修复与体验改进

- **修复 Coze 模型加载报错（`invalid reasoning metadata`）**：[managed-llm.js](<../lib/managed-llm.js>) 仅在模型声明了有效 `efforts` 时设置 `reasoning: true` 与 `thinkingLevelMap`，不再为无思考档位的 Coze 模型输出全 `null` 档位表。
- **修复自动任务与签到异常**：
  - **CodeArts 签到**：修正 `/v1/ops/delivery` 响应解析路径（`data.items`）并同时兼容 `channel=IDE`（`USER_LOGIN`）与 `channel=DESKTOP`（`daily_claim`），解决先前一直报 `inactive` 的问题。
  - **Coze 成就领奖**：`/api/achievement/*` 仅对带 Web Cookie 的浏览器登录账号调用，纯桌面 PAT 账号跳过该接口不再误报失败。
  - **豆包工作目录去重**：兜底表更新为真实 `model_item_key`，联网成功时直接返回上游目录，不再混拼重复条目。
- **模型目录中间态缓存与后台自动刷新**：自管多账号渠道启动即同步加载磁盘缓存 `*-catalog.json` 秒显并在后台静默刷新；账号池模型目录（`model.list`）纳入宿主快照持久化，宿主启动 8 秒后与每 30 分钟自动后台刷新远端目录，不再需要每次手动点击刷新。
- **参数设置按官方规格表单驱动档位快捷键**（见 [MODEL-SPECS.md](MODEL-SPECS.md) 与 `lib/model-catalog.js`）：
  - 上下文精选最多 4 档（`200K / 400K / 500K / 1M`，256K 模型自动以 `256K` 为顶档），`1_000_000` 与 `1_048_576` 均显示 `1M` 并按模型真实上限绑定；
  - 输出从 `64K` 起按官方输出上限与渠道协议硬上限精选 1–4 档：Kimi K3.1 Pro/K3/K2.8 支持 `64K / 128K / 256K / 1M`（`1_048_576`）、MiniMax M3.1 Flash 支持 `64K / 128K / 256K / 512K`（`524_288`）、DeepSeek V4.1/OpenPangu 2.1 支持 `64K / 128K / 256K / 384K`（`393_216`）、Doubao Seed 2.1/Qwen 4 Max 支持 `64K / 128K / 256K`、GLM 5.3/Qwen 3.8/MiMo 2.6 支持 `64K / 128K`、Hy4/Step 5/Agnes 支持 `64K`；CodeArts `/api/v1` 自动收口至协议硬上限 `32K`。

## 0.5.1（2026-11-20）

### 修复与补齐浏览器 OAuth / 独立窗口登录

- **通用浏览器登录与隔离收割器**（`lib/browser-login.js`）：新增独立临时 Profile Chrome/Edge 启动与 CDP Cookie 收割能力（零第三方依赖），支持多账号隔离登录；找不到 Chromium 时自动回退系统默认浏览器。
- **四个新渠道全部打通浏览器登录**：
  - **Coze**：新增 `browser` 登录（打开 `coze.cn` 登录后自动收割 Passport Cookie 并经 `impersonate_coze_user` 签发 10 分钟 PAT，到期自动用 Cookie 后台续签，不再依赖桌面端运行），`parseCredential` 同时支持粘贴 Cookie。
  - **豆包工作**：改用独立浏览器打开 `doubao.com/chat` 登录后自动收割完整会话 Cookie，修复先前扫码接口直接报错无法打开登录页的问题。
  - **AStudio**：改用独立浏览器打开 `agent.xfyun.cn/studio-credits`（支持手机验证码 / 微信扫码 / 密码登录），自动换取 3 年期 `modelBearerToken` JWT。
  - **CodeArts**：OAuth 授权地址生成后自动弹出隔离浏览器完成 PKCE + DPoP 回调。
- **登录后界面立即刷新**：修复写操作后重读被 Host 快照短路或被 `state.busy` 丢弃的问题；登录、导入、删号与启停后直接拉取实时状态并同步乐观补丁，无需关闭设置页重新进入。

## 0.5.0（2026-11-20）

### 模块化底座升级与四个自管多账号新渠道

- **自管多账号四层框架**：新增 `lib/managed-channel.js`、`lib/managed-models.js`、`lib/managed-llm.js` 与 `lib/managed-providers/`，客户端配套 `src/client/providers/managed.js`，支持多账号索引与独立凭据隔离、每账号固定随机 `deviceId`、三类接入方式（导入本机桌面端登录态、浏览器登录、粘贴凭据）、多账号故障切换与 429 限流标记，以及 `compat` 模型参数覆盖。
- **新增四个 CN 渠道**：**AStudio**（讯飞 Astron Studio，OpenAI Responses 协议 + 每日登录积分与弹窗领取）、**豆包工作**（SSR 实时目录 + 自定义 SSE 补丁流与工具调用解析 + 只读签到与显式任务领取）、**Coze 桌面端**（自动同步桌面端 PAT 续期 + 16 条实时倍率目录 + 成就领奖 + `coze-bridge` `modelToken` 推理）、**CodeArts**（华为云码道，本机 DPAPI 导入 + PKCE/DPoP 浏览器 OAuth + `SDK-HMAC-SHA256` 签名 + 每日签到与福利领取）。详情见 [MANAGED-CHANNELS.md](MANAGED-CHANNELS.md)。

### Host/Client 解耦、操作体验与自动化升级

- **客户端状态机拆分**：将原 `src/client/store.js` 拆分为 `src/client/store/{pending,cache,sync,index}.js`；Host 快照协议建立后切渠道直接消费内存快照，不再重置游标或重拉整页。
- **局部非阻塞状态锁**：按操作域（`models:*` / `account:*` / `channel:*` / `login:*` / `automation`）隔离进行中状态，不同操作域互不锁死。
- **动态自动化开关与统一任务调度**：新增 `lib/automation-settings.js` 与 `lib/auto-tasks.js`，持久化全局与分渠道的「自动每日签到」「自动领取奖励」「自动执行完成任务（默认关闭）」「思考循环保护（默认开启）」，设置页渠道分区支持实时开关与立即执行。

### 统一思维链循环保护与 TRAE 修复

- **接入统一思维链死循环保护**：集成 `lib/cot-loop-guard/`（周期 + 子句池三态滞回检测与有界自动续跑），在宿主 `llm/stream` 统一覆盖全部 provider，并移除原 `vendor/channel-pack/src/sse.ts` 内分散的旧行去重守卫，避免双重判定。
- **TRAE 思考等级与 `code=1005` 修复**：客户端版本对齐 `0.1.69` / `20260917`，兜底表补齐实测思考档位（`light` / `high` / `extra_high`）与视觉能力、中文档位标签与 `maxTokens`；遇到 `code=1005` 时先在同账号降级关闭 Max 模式并尝试备用 `function` 通道，再执行账号轮换并给出清晰提示。
- **WorkBuddy 每账号独立 `machineId`**：避免多账号上报共用本机硬件指纹。

## 0.4.0（2026-11-20）

### 新增 Agnes 与云知声两个 API Key 渠道

两个渠道共用同一套实现，差异只落在渠道规格对象里：

- **四层结构**：渠道规格（`lib/apikey-providers.js`）、管理器（`lib/apikey-channel.js`）、模型设置（`lib/apikey-models.js`）、推理适配器（`lib/apikey-llm.js`）。RPC 统一为 `apikey.*`，渠道 id 放在 `payload.provider`。
- **设置页分区**：每个渠道使用「模型」与「渠道」两个分区，模型分区承载目录、开关与参数，渠道分区承载提供方开关、API Key 与用量。
- **保存 Key 自动启用**：保存 API Key 后若提供方仍处于关闭状态，自动调用启用，用户填 Key 即视为要使用该渠道。
- **目录与额度**：有 Key 时拉取上游目录并缓存，拉取失败回落缓存、再回落兜底表；Agnes 读取 New API 账单接口的用量，云知声无公开余额接口，不显示用量。

### 公开发布清理

- **包元数据与 `files` 白名单**：整理 `package.json` 的包名、描述、关键字、`exports`、`files` 与 `dsh` 清单，发布内容与仓库结构对齐。
- **`NOTICE.md`**：补全内置第三方组件的来源、版本、许可证与本仓库路径，区分构建期内联与宿主注入的依赖。
- **CI 与发布工作流**：`ci.yml` 增加打包与产物校验，`release.yml` 增加标签校验、校验和与 npm OIDC 发布，两者共用同一段打包校验脚本。
- **第三方源码注释脱敏**：清理内置第三方源码中与公开发布无关的注释内容。

### 文档补全

- 新增 [architecture.md](architecture.md)、[development.md](development.md)、[publish.md](publish.md) 与本更新记录。
- 渠道接口契约整理为 [APIKEY-CHANNELS.md](APIKEY-CHANNELS.md)，界面与交互规则整理为 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)。

## 0.3.0（2026-11-20）

首个公开版本，合并此前全部内部迭代。

### 渠道与统一设置页

- **六个渠道**：Loomy、Raccoon、Qoder 中国版、TRAE、商汤 Token Plan、WorkBuddy（腾讯 CodeBuddy 中国版）。只接入 CN 版，WorkBuddy AI、Trae Global、Qoder 国际版不接。
- **统一设置页骨架**：通过 `settings.section` 注册，渠道选择器是自动换行的小卡片网格；账号、模型、渠道分区由 `panels-core.js` 与 `kit/` 统一渲染，各渠道只提供数据与动作。
- **渠道级缓存与后台静默刷新**：切回已读渠道立即恢复该渠道上次读到的公开数据，后台按节奏静默刷新；首屏恢复浏览器缓存并读取宿主快照，页面聚焦与重新可见时补读。

### Raccoon 家族

- **单池双模型面**：一张卡片、一个 `raccoon` 账号池，拆成免费面 `raccoon` 与订阅面 `raccoon-pro` 两个模型 provider；两侧各用本侧账号凭据拉上游目录，不做倍率过滤。
- **逐模型思考档位**：按上游下发的 `params.raccoon_thinking` 分流——有托管档位的模型把档位发在请求体顶层，老模型继续走 `extra_body.thinking`，两套方言互斥。

### 目录与展示

- **Qoder 中国版目录借本机官方 CLI 真拉**：目录端点需要专有 WASM 签名，改为 spawn 官方 CLI `--list-models`，以 CLI 的 key 作为目录 id，能力属性与策展表合并。
- **模型倍率徽标**：用核心原生 `LlmModelInfo.badge` 在模型选择器与设置页显示当前生效倍率，`name` 不再拼倍率。
- **黑名单卫生**：模型目录只认上游的全量目录，黑名单只做显隐标记；远端真拉成功后剪掉目录里已不存在的黑名单键并落盘，避免把下架模型的残留开关记录复活成幽灵模型行。

### 命名与兼容

- **插件改名为 `dsh-unified-router`**：包名、插件 id、RPC 服务名与命名空间统一为 `unified-router`，路由为 `/api/unified-router`，凭据引用统一为 `UNIFIED_ROUTER_*`。
- **旧名读取回退**：改名前的引用名与状态目录保留回退读取，新值只写入新名字；旧名称下只允许「清除」类写动作，状态目录搬迁失败时本次运行继续读写旧目录并在下次启动重试。
