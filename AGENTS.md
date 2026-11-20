# Unified Router 项目约定

> **界面/交互/数据加载/文案/目录命名的规则，以 [docs/DESIGN-STANDARDS.md](docs/DESIGN-STANDARDS.md) 为唯一来源。**
> 那份文件按「规则 + 由来 + 回归用例」组织，加渠道或改界面前先读它，**不要按单点口头反馈逐条改**。
> 本文只保留工程实现约定（模块布局、RPC、账号池、构建与发布流程）。

## 项目目的与验收

- 通过 `settings.section` 提供十二个 CN 渠道卡片的统一设置页，管理账号、额度、模型显示、模型参数与自动化任务：Loomy、**Raccoon**（小浣熊，一张卡片管一个账号池 + 免费/订阅两个模型 provider）、Qoder 中国版、TRAE、商汤 Token Plan、WorkBuddy（腾讯 CodeBuddy 中国版）、Agnes、云知声、**AStudio**、**豆包工作**、**Coze**、**CodeArts**。只做 CN 版（WorkBuddy AI、Trae Global、Qoder 国际版不接）。
- **Raccoon 家族：一张卡片 + 一个账号池 + 两个相互独立的模型 provider**（`raccoon` = 免费面、`raccoon-pro` = 订阅面）。**免费账号与付费账号的模型池完全独立**：两侧各自用**本侧账号的凭据**去上游拉目录（`RaccoonAuth.fetchModelsWithCredential`），上游对该账号返回什么模型就展示什么模型，**不做任何倍率过滤** —— `billing_effective_multiplier` 只是展示信息，不是归属判据（把同一份目录按 0× / >0× 劈成两半是上一版的缺陷：免费账号能看到的计费模型会被整条删掉）。离线兜底表仍各自保留、只在拉不到上游目录时兜底，且**按 2026-11-18 真拉结果重采为两侧各 7 条**（免费面 `sn-sensenova-6-8-flash` / `-flash-lite` / `sn-qwen4-max` / `sn-glm-5-3` / `sn-kimi-k3-1-pro` / `sn-glm-5-3-flash` / `sn-deepseek-v4-1-flash-1017`；订阅面同样 7 条但 **id 一律带 `-p`** —— 旧表缺 `-p` 会把请求发到另一条模型线）。兜底条目同时带实测倍率与思考档位，离线时倍率徽标与思考档位照实呈现（不编造、不冒充免费）。**账号只有一个池**（`raccoon`）：登录一律进这个池，登录成功后由 `RaccoonAuth.fetchPlan` 探测套餐并写 `ProviderAccountEntry.plan`（`free` / `pro` / `unknown`；探测失败标 `unknown`、不阻塞登录）。选号在 `src/backend.ts` 的 `mountRaccoon` 里按 plan 圈候选：免费侧只取 `plan !== 'pro'`（free/unknown/缺省都算免费侧，宁可用免费模型也不误扣付费额度），订阅侧只取 `plan === 'pro'`；实现上是把对侧账号放进 `getAvailableAccount` 的 `excludeAccountIds`（选号核心不改）。目录同样按 plan 取号：`raccoonSideCredential(side)` 取本侧账号，无本侧账号则返回空、适配器回退兜底表。`raccoon-pro` 的适配器拿到的是「按 plan 门控」的池视图（只覆盖 `hasLoggedInAccount`），否则订阅面在对话模型选择器里会因「池为空」被整组隐藏。vendor 侧 RPC 仍按**家族**分派（`raccoonFamily` / `isRaccoonFamily` / `requireRaccoonFamily`），订阅版实例经 `ChannelPackRpcConfig.raccoonPro` 注入，**不新增位置形参**。两者都有登录奖励（onboarding），都没有每日签到与 permanentLock。⚠️ 不要把账号按套餐分池：套餐会变，分池会让「登录时的选择」永久错配（上一版的实际缺陷）。
- 保留渠道白名单、账号删除二次确认、登录地址校验、请求取消和公开字段投影；界面与测试中不得暴露凭据或上游原始错误。
- 设置页应层级清晰、操作入口明确，在宿主导入的语义主题下自动适配亮色与暗色，并在窄屏中保持内容完整可用。
- 模型搜索、分页、连续参数编辑、保存失败后的编辑位置与内容保持属于既有验收行为。模型列表保持统一，「恢复推荐」按设计规范 §3 更新本地开关。

## 实现结构

- 客户端源码位于 `src/client/`，provider 模块提供视图数据、能力与动作。设置页的账号、模型、渠道分区统一在 `panels-core.js` 和 `kit/` 中渲染。`lib/client.js` 由 `scripts/build.mjs` 拼接生成。
- `src/client/providers/index.js` 决定卡片顺序、模型分组和账号池渠道的轮询范围。账号池渠道复用 `providers/pack.js`。自管渠道实现共同视图接口。新增渠道时登记客户端模块、宿主 RPC 白名单与快照资源。独立推理渠道由 `src/backend/providers/` 挂载并注册适配器。接入契约见 [设计规范 §7](docs/DESIGN-STANDARDS.md#7-provider-设置接口)。
- 客户端模块不写 `import`：拼接后共享同一工厂作用域（与 provider 系列插件同机制），跨模块标识符直接按名引用，新模块必须登记进 `scripts/build.mjs` 的 `clientModules` 顺序表（依赖在前）。工作区分区是**普通函数直接调用**（不是 `h(Panel, props)` 元素）：离线测试的 React 桩不展开函数组件，分区必须即时求值成元素树；分区自身不持有 Hook，状态与动作由 `Settings` 注入。
- `createRouterStore` 拆分为 `src/client/store/{pending,cache,sync,index}.js`：Host 统一负责后台采集、目录缓存、持久化与自动化调度，Client 经 `settings.snapshot(cursor)` 增量消费快照，写操作采用局部非阻塞 `pending` 锁，避免不同操作域互相锁死。宿主通信仍走 `/api` 的 `unified-router` 服务。
- **自管多账号渠道四层框架**（AStudio、豆包工作、Coze、CodeArts 共用，契约见 [docs/MANAGED-CHANNELS.md](docs/MANAGED-CHANNELS.md)）：`lib/managed-providers/` 放渠道规格与注册表，`lib/managed-channel.js` 负责多账号索引/凭据隔离/三类接入（本机导入、浏览器登录、粘贴凭据）/目录与适配器同步，`lib/managed-models.js` 持久化开关、参数与合法 `compat` 覆盖，`lib/managed-llm.js` 装配 `openai-completions` / `openai-responses` / `anthropic-messages` 及自定义流式适配器；客户端由 `src/client/providers/managed.js` 生成统一视图。新增同类渠道只需登记后端规格和前端 9 行声明，不修改中心路由/投影分支。
- **自动化配置与任务调度**（`lib/automation-settings.js`、`lib/daily-checkin.js`、`lib/auto-tasks.js`）：`<stateDir>/automation.json` 持久化全局与分渠道的 `autoCheckin`、`autoClaimRewards`、`autoCompleteTasks`（主动执行任务默认关闭）与 `cotLoopGuard`（思考循环保护，默认开启），通过 `automation.*` RPC 与 `automation/automation.status` 快照资源暴露给设置页渠道分区动态开关。
- **统一思维链死循环保护**（`lib/cot-loop-guard/{watch,stream,resume,index}.js`）：取代原 `vendor/channel-pack/src/sse.ts` 的适配器内行去重守卫（`isReasoningLoopGuardEnabled()` 恒返回 `false` 避免双重判定），在 `lib/web-host.js` 通过 `ctx.on('llm/stream', ..., { global: true })` 统一覆盖全部 provider（无跳过表，仅跳过 `compaction` / `session-title`），提供周期 + 子句池三态滞回切断与有界自动续跑，并受 `automation.json` 中的 `cotLoopGuard` 开关动态控制。
- **TRAE 模型参数与思考等级**：客户端版本号对齐 `0.1.69` / `20260917`（`vendor/channel-pack/src/trae-product.ts`），兜底模型表包含实测 `reasoningConfig`（`light`/`high`/`extra_high`）与 `multimodal`，`TraeAdapter` 的 `reasoningFor` / `inputModalitiesFor` / `listAllModels` 回退兜底并补齐 `maxTokens` 与中文档位标签（`EFFORT_LABELS` 补齐 `light` / `extra_high`），请求侧兼容映射规范档位名。
- **WorkBuddy 是自管多账号渠道**（不走 channel-pack 账号池）：索引凭据 ref `UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS` 存 `[{id, credentialRef, name, uid, createdAt}]`（`id` = `workbuddy-<8hex>`），每账号凭据 ref 为 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6HEX大写>`（形状与 `sanitizeAuth` 白名单一致），上限 8 个。上游 hooks 都接收 `getAuth` 形参，因此**每账号一个 `WorkBuddyAuthPlugin` 实例**，实例的 `client.auth.set` 只回写本账号的引用（续期不得串号，也不得复活已删除账号）；`workbuddy.snapshot` 返回 `{accounts:[...], loginUrl}`，`workbuddy.logout/checkin` 必须带 `accountId`，`workbuddy.models` 的 `accountId` 可选（缺省用第一个已登录账号）。旧单账号 ref `UNIFIED_ROUTER_WORKBUDDY_AUTH` 在索引缺失/为空时采纳为第一个账号并随后清除；索引损坏按空账号处理且**不覆盖**原值。`lib/rpc.js` 对 workbuddy 方法豁免 `account.list` 归属检查（它的账号不在账号池里）。
- **Agnes 与云知声是 API Key 渠道，共用一套实现**（契约与实测事实见 [docs/APIKEY-CHANNELS.md](docs/APIKEY-CHANNELS.md)）：`lib/apikey-providers.js` 放渠道规格（端点、目录解析、兜底表、思考方言、用量解析），`lib/apikey-channel.js` 是管理器（Key、目录、注册、快照、写操作），`lib/apikey-models.js` 存模型开关与参数，`lib/apikey-llm.js` 装配推理适配器。RPC 统一为 `apikey.*`，渠道 id 在 `payload.provider`；客户端由 `providers/apikey.js` 的 `apiKeyChannel(config)` 生成视图，`agnes.js` / `unisound.js` 只声明 id、标题与端点。设计取舍：① 快照按渠道 id 存进 `state.apikeys` 映射，宿主快照的 `apply` 要把前一个渠道的写入传给后一个（store 里用累积 patch）；② 保存 Key 后提供方仍关闭则自动启用（用户填 Key 就是要用它）；③ 没有 Key 时目录显示兜底表、提供方开关不可用，避免「启用却注册失败」；④ Agnes 的 `thinking:{type:'disabled'}` 实测关不掉思考，关闭用 `reasoning_effort:'none'`；⑤ 云知声没有公开余额接口，不显示用量，Agnes 的用量取自 New API 账单接口；⑥ 云知声目录走 Anthropic 兼容的模型列表（带 context_window / max_output），Agnes 目录只有 id，规格取官方文档、表外模型记 0 不编造；⑦ 推理适配器的 pi-ai 与 vendor 核心用动态 import 载入，与宿主解析链一致。
- 插件 id、RPC 服务名与命名空间已于本次改名统一为 unified-router：包名/插件 id `dsh-unified-router`、路由 `/api/unified-router`、设置命名空间 `dsh-unified-router`、商汤状态目录与凭据命名空间 `dsh-unified-router-sensenova`、凭据引用 `UNIFIED_ROUTER_*`、后端内部服务与标记 `unifiedRouterPool` / `__unifiedRouterImagePatched`。改名前的引用名与目录保留回退读取（见 `lib/sensenova.js`、`vendor/sensenova-token-plan/index.js`），但**新值只许写入新名字**；旧名称下允许的写动作只有「清除」（采纳后删除旧记录、登出/忘记 Key 时连带清理），因为这些动作让旧数据退出而不是复活。唯一例外是状态目录搬迁失败：此时本次运行继续读写旧目录（见 `adoptStateDir`），以便不丢状态，并在下次启动重试搬迁。`--eac-*` 样式变量与 DOM 测试钩子沿用旧命名，属界面契约，不受改名影响。
- `lib/web-host.js` 负责 RPC 接口和公开字段投影；`src/backend.ts` 是独立后端源码，`scripts/build.mjs` 构建后端与复制 WASM，并把 `src/client/**/*.js` 拼接为 `lib/client.js`（含构建期语法自检）。`lib/rpc.js`、`lib/sensenova.js`、`lib/web-host.js` 仍为手维护宿主模块，不进构建。
- TRAE 走 channel-pack 现成实现（`vendor/channel-pack/src/trae-*.ts`，浏览器 OAuth 本机回调 + 每日签到 + 余额），接线照抄 `vendor/channel-pack/src/index.ts` 的 TRAE 段（`modelId` 必须透传 `getAvailableAccount`，refresh 必须刷解析凭据所用账号）。
- **Qoder CN 目录借本机官方 CLI 真拉**（`vendor/channel-pack/src/qoder-cli.ts`）：Qoder 目录端点需专有 WASM 签名（`qoder_auth_wasm`），不重实现；改 spawn 官方 CLI `--list-models`（PATH `qoderclicn` 优先，回退 IDE 附带 `…\Qoder CN\resources\app.asar.unpacked\…\qoder-worker-runtime.obf.mjs`，node 执行），解析纯文本表（`显示名 (key)`，**key 才是目录 id**），id 以 CLI 为准、能力/倍率属性与 `QODER_CN_FALLBACK_MODELS` 策展表合并（新 id 用 `contextWindow:0` 哨兵不编造）。未登录/不存在/超时/空表静默回落 `source:'fallback'`。**opt-in**：`store.autoRefreshCatalog` 对 qodercn 跳过 silent 补拉，只有手动「刷新目录」才 spawn；回落时提示先 `qoderclicn login`（本机 IDE 走 job_token，CLI 无持久登录态，须用户一次性官方登录）。详见 [docs/QODER-CLI.md](docs/QODER-CLI.md)。
- **模型选择器倍率徽标用核心原生 `LlmModelInfo.badge`**（`vendor/channel-pack/src/model-rate-badge.ts`）：DSH 0.2.2+ 的 `dsh-client-ui-model-selection` 原生把 `badge:{text:LocalizedText(en必填),tone}` 渲染成模型名旁彩色 Tag（下拉行在名后、收起态在名前）。四渠道 `listModels()` 挂当前生效倍率徽标（免费→success「免费」、计费→neutral `xN.NN`、促销→info、未知→不挂不谎报免费）；本地声明接口 + spread 写入（peer 低版本无此字段不报错）。**name 里不再拼倍率**（改名见设计规范 §3：倍率只走 badge，避免同一信息出现两次）。raccoon 用 `billing_effective_multiplier`/`billing_status`，loomy 用 `splitLoomyRate(name)`，trae 用 `creditsRate`，qoder 用 `priceFactor`+promotion。
- **Raccoon 思考档位是两套方言，按模型分流**（`vendor/channel-pack/src/raccoon-product.ts`）：上游 2026-11 起在目录里逐模型下发 `params.raccoon_thinking`（`managed` / `can_disable` / `display_levels: level_1..level_5` / `default_level`）。有托管档位的模型把档位原样发在**请求体顶层** `raccoon_thinking_level`（实测：顶层有效；放进 `extra_body` 回 `HTTP 400 param raccoon_thinking_level invalid`；官方客户端经 OpenAI SDK 的 `extra_body` 平铺合并成顶层字段，同一结论），**且不再发** `extra_body.thinking` —— 两套方言互斥。没有托管档位的老模型继续走旧方言 `extra_body.thinking:{type:'enabled'|'disabled'}`（开 / 关两态）。⚠️ 上游 `default_level` 为 `off` 时本插件的默认档取**最低思考档**：实测会话记录里 18 处正文泄漏规划（`assistant` 只有 `text` 块、无 `reasoning` 块）全是「思考实际关闭」造成的 —— 关掉思考后这类推理模型把规划写进正文，用户看到的就是 CoT 泄漏；发对 level 后规划回到 `reasoning_content`。`off` 仍保留为可选项。证据与探针表见 [docs/CATALOG-AUDIT.md](docs/CATALOG-AUDIT.md) §13。
- **模型目录只认上游，黑名单只是本地的显隐标记**（2026-11-18 修真实缺陷）：`model.list` **不得**把「黑名单里有、目录里没有」的 id 补成裸 id 行 —— 旧实现这么做（本意是「关掉的模型还能被找回来」），结果把 `state.json` 里**模型下架后残留的开关记录复活成幽灵模型行**（用户报障「Loomy 里怎么还有不存在的 qwen3.8-max」）。现在的规则：目录以适配器的 `listAllModels()`（不套黑名单的全量目录）为唯一来源，黑名单只用于标记 `disabled`；「已失效」有独立 dead 表路径（`dead: true` + `model.clearDead`），那才是用户恢复入口。配套卫生：目录来自**远端真拉**时（适配器的 `isRemoteCatalog()`），`model.list` 会调 `pool.pruneDisabledModels()` 清掉目录里已不存在的黑名单键并落盘；兜底目录不剪（它只是精选子集，剪了会误删表外模型的偏好）。回归用例 `test/model-blacklist-hygiene.test.mjs`。
- **硬编码兜底表的定位**：它只服务「拉不到上游」的情形（未登录 / 网络失败），因此**只放确实存在的 id**，且必须是最近一次真拉的结果（重采口径见 [docs/CATALOG-AUDIT.md](docs/CATALOG-AUDIT.md) 与 [MODEL-CURATION.md](MODEL-CURATION.md)）。上游下架某个 id 时，兜底表与 `disabledModels` 两侧都要能自愈：前者靠重采，后者靠上面的自动剪枝。Qoder CN 是唯一例外 —— 目录端点要专有 WASM 签名，优先用官方 CLI（`qoder-cli.ts`），CLI 也不可用时才回落到策展表。
- **小浣熊 ACP 不用于目录/登录**（勘察结论）：官方 `box-agent-acp.exe` 是 Zed ACP（stdio JSON-RPC），但无 catalog/authenticate 方法，模型 id 还是信息更少的内部别名 `raccoon-*`；raccoon 目录/账号维持 HTTP `model_catalog` + Bearer。ACP 仅未来「复用本地 agent 执行能力」才考虑。硬编码兜底表与上游的差异审计见 [docs/CATALOG-AUDIT.md](docs/CATALOG-AUDIT.md)。
- 不新增聊天、侧栏或原生设置胶囊入口，不改变后端 RPC 契约来适配纯视觉需求。

## 设置页设计（细节见设计规范）

界面/交互/文案/数据加载/目录命名的**全部规则**在 [docs/DESIGN-STANDARDS.md](docs/DESIGN-STANDARDS.md)。
这里只留实现层的事实，避免两套规则打架：

- 设置分区统一渲染。provider 通过 `accounts`、`models`、`channel` 提供数据和动作。纯 API 渠道声明模型与渠道分区。
- 宿主侧 `settings-snapshots.js` 按分钟采集并原子保存账号、额度和状态投影。资源声明和写后更新由 `settings-providers.js` 管理。设置页读取宿主快照，浏览器 `localStorage` 用于跨次渲染及记忆上次渠道。
- 登录地址按授权流程临时读取。凭据和上游响应原文均通过投影过滤，进入账号或额度快照的字段由白名单限定。
- 首屏恢复浏览器缓存并读取宿主快照，可见时每 5 秒读一次。页面聚焦和恢复可见时补读。
- 渠道选择器是**自动换行的小卡片网格**（不是横向滚动条）；条目、数字、间距一律用 `styles.js` 的 `--eac-*` 令牌。
- 保留现有 DOM 测试钩子与无障碍属性（标签页、开关、展开状态、搜索、分页）。

## 验证与维护

- 修改客户端（`src/client/`）后运行 `npm test`（已含 `node scripts/build.mjs`，保证产物不落后于源码）并执行 `node --check lib/client.js`；测试覆盖前端状态、界面交互、宿主投影与后端持久化。
- 视觉改动应检查桌面亮色、桌面暗色及窄屏容器，不只依赖静态 CSS 断言。
- 后端源码或客户端源码变更都通过 `npm run build` 生成产物并核对 `lib/backend.js` / `lib/client.js`；测试链路先构建后测试。
- 安装、重新载入宿主插件、部署与重启不属于本地源码修改的默认步骤。
