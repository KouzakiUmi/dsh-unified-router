# 更新记录

> 按版本倒序排列。0.3.0 是首个公开版本，此前 0.4.0–0.9.x 的内部迭代编号已合并进 0.3.0，不再逐版本罗列。

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
