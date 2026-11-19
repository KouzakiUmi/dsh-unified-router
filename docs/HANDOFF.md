# 交接文档 · dsh-unified-router

> 面向接手的会话/代理。记录截至 2026-11-17 的架构、决策、进度与剩余工作。
> 项目约定以 [AGENTS.md](../AGENTS.md) 为准（本文不重复其全部细节，只记交接必需的事实与教训）。

> 版本说明：下文出现的 0.4.0–0.9.x 是 0.3.0 公开发布之前的内部迭代编号，已合并为 0.3.0 发布；当前版本以 `package.json` 为准。

## 1. 项目现状一句话

多 provider 模型插件：六个 CN 渠道卡片（Loomy / Raccoon / Qoder 中国版 / TRAE / 商汤 Token Plan / WorkBuddy），统一设置页管理账号、额度、模型显示与参数。Devin 已拆出为独立插件 `dsh-devin-provider`。

## 2. 本会话的架构演进与教训（重要，避免重蹈覆辙）

1. **模块化**：client 从 1744 行单文件拆为 `src/client/` 模块，`scripts/build.mjs` 拼接为 `lib/client.js`（浏览器 ModuleLoader 只吃单文件工厂；模块间无 import、共享作用域、按 `clientModules` 顺序表拼接）。
2. **Devin 移除**：用户已有独立插件承接，本插件不再含 Devin 任何代码。
3. **小浣熊三次修订（教训密集区）**：
   - v1 错误：拆成**两张卡片 + 两个账号池**，用户手动选卡片登录 → 用户纠正：一张卡片，按账号套餐自动映射。
   - v2 错误：单池 + plan 映射对了，但模型目录**按生效倍率 0×/>0× 把同一份目录劈成两半** → 用户纠正：**免费账号与付费账号的模型池完全独立**，两侧各用本侧账号凭据拉上游目录，上游返回什么就显示什么，倍率只是展示信息不是归属判据。
   - v3（raccoon-fetch 工作包）：去掉倍率过滤 + 修复「设置页从不真拉上游目录」的系统性缺陷（见下）。
   - **账号层定论**：一个 `raccoon` 池 + `plan` 字段（登录后 `fetchPlan` 探测 entitlement_info 打标 free/pro/unknown）；选号按 plan 排除对侧账号；**不要按套餐分池**（套餐会变，分池造成永久错配）。
4. **目录拉取的系统性缺陷（所有 channel-pack 渠道）**：适配器 `listAllModels()` 同步只读缓存，缓存空就用硬编码兜底表，从不触发拉取；拉取只发生在对话选择器调 `listModels()` 时且成功后永久缓存。修复：适配器加 `refreshRemoteModels()`（清缓存、突破 RemoteCatalogGate 失败冷却）+ `model.refresh` RPC + 设置页「刷新目录」按钮与来源标识（远端/离线兜底）+ 进模型分区自动后台补拉一次。
5. **UI 参考对象（用户两次纠正后定论）**：
   - ❌ volcengine/devin-provider：单 provider 插件，布局不适用。
   - ❌ dsh-subusage：额度插件，不注册模型路由，不是 provider 插件。
   - ✅ **dsh-kxyai-provider**（`D:\Software Projects\dsh-kxyai-provider\client.js`）：注册路由的多 provider 插件。UI 重做以它的组件体系为范本：`ModelCard`（名+code id+开关 → 能力标签 → 状态行+「配置参数」展开 → 档位 select/输出上限 NumberField/思考说明）、`FieldFeedback`（逐字段 正在保存…/保存失败+重试/已保存）、`TextField/NumberField`（本地草稿、失焦/回车提交一次、Esc 取消）、`SectionCard`、`Feature`、`UsageDetails` + `agoText/untilText` 相对时间。
   - 用户评价现状 UI「很烂」，重做是硬需求，不是可选优化。

## 3. 已完成并验证

- 六渠道功能全链路（后端接线、RPC 白名单、投影、客户端、测试）。
- WorkBuddy 多账号：索引 ref `UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS` + 每账号 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6HEX大写>`，每账号一个插件实例（续期回写不串号、不复活已删账号），上限 8。
- **magpie 凭据迁移已执行**（`scripts/migrate-from-magpie.mjs`，dry-run 默认、`--apply` 写入、自动备份、幂等）：loomy×4、qodercn×2、raccoon×4（含 plan：6947/4202→pro，2717/9974→free；4202 保持停用）、trae×4、workbuddy×4（CN）、sensenova API Key 覆盖 + 控制台 email/password 写入。迁移脚本第一版曾丢 YAML `version: 1` 尾行致热重载拒绝，已修复（保留 refs 段后的顶层行）。
- 发布历史：0.3.0（六渠道+WB 单账号）→ 0.4.0（raccoon 双卡片，已废弃的设计）→ 0.5.0（WB 多账号+迁移）→ 0.6.0（raccoon 单卡片+plan 映射）→ 0.7.0（raccoon 独立模型池+设置页真拉取）→ 0.8.0（横向渠道栏+渠道级缓存；已安装并 unlag_refresh 生效，fiberPhase active）→ 0.9.1（Qoder 官方 CLI 目录 + 选择器倍率徽标 + Raccoon 逐模型思考档位 + 三渠道兜底表重采；已安装并 unlag_refresh 生效）→ 0.9.2（UI 重做 + 去防御性文案；已安装并 unlag_refresh 生效）→ 0.9.3（清掉无效硬编码的真正来源：黑名单复活 + 自动剪枝）→ 0.9.4（数据自己更新：记住渠道 + 静默刷新）→ 0.9.5（删掉策展层 + 模型 id 必须可见）→ 0.9.6（首屏空账号的真因：后端就绪竞态）→ 0.9.7（状态落盘 localStorage + 首屏读全部渠道）→ **0.9.8（沉淀设计与交互规范 + 卡片式渠道选择器 + 名字去冗余 + 恢复推荐=同族最新）**。
- 测试基线：0.7.0 为 125/125 全绿；**横向栏+渠道缓存后为 131/131 全绿**（主会话复跑核实，含 6 条新缓存测试）。

## 4. 进行中与剩余工作

### 已完成：raccoon-fetch 工作包（0.7.0，已发布并生效）
- 小浣熊两侧模型池彻底独立：`mountRaccoon` 删除 `splitRemote`，两侧各用本侧账号凭据拉上游完整目录，无倍率过滤；账号层单池+plan 不变。
- 四适配器（loomy/raccoon/trae/qoder）新增 `refreshRemoteModels()`；`RemoteCatalogGate.run(fn,{force:true})` 突破失败冷却（自动路径不带 force）；qoder 因 WASM 签名未实现恒返回 fallback（方法存在以区分「无远端目录」与「插件坏了」）。
- `model.refresh` RPC（白名单/投影/家族分派）+ 客户端「刷新目录」按钮、来源标识（远端/离线兜底/未知）、进模型分区自动后台补拉一次（每渠道一次，silent 不置 busy）。
- **验收（主会话复核）**：`npm test` 125/125 全绿；vendor 改动在约定范围（新增方法+gate force）；`src/backend.ts` 无倍率过滤残留。
- **发布**：0.7.0 tgz（sha256 已生成）→ 桌面 CLI update → `unlag_refresh` → `fiberPhase: active`，日志无错误。
- 子代理报告的未覆盖项：真实上游拉取未验证（全桩）；shared 模式 model.refresh 转发未联机验证；视觉未实机。

### 已完成：横向渠道栏 + 渠道级缓存（0.8.0，已发布并生效）
用户三点具体要求：① provider 按钮横向排布；② 账号信息点进去看；③ 有缓存，不要每次点进去都「没有信息，正在拉取」。
- 渠道选择器从 76px 大卡片网格改为紧凑横向 tab 栏（flex + overflow-x，窄屏横向滚动不再竖排），去掉 ✓ 角标，保留状态点与「N 账号 · N 模型」副行；点击进入工作区（默认账号分区）交互不变。
- 渠道级缓存：切回已读渠道立即恢复该渠道自己的上次公开数据（后台静默刷新，RPC 不减），缓存命中不显示「正在读取渠道状态…」；sessionStorage 持久化（key `eac-unified-router-cache-v1`，只白名单投影、无凭据），重进设置页也恢复，statuses 一并恢复。设计事实见 AGENTS.md「设置页设计」。
- 实现派 SWE 子代理：首次 devin/swe-2-flash（免费 max）8 分钟**零产出**（结束消息为截断分析片段，源文件未改）——SWE-2 系列对 ~2500 行上下文的有界实现不可靠；换缺省档 magpie-workbuddy/workbuddy/deepseek-v4.1-flash（max）成功。
- 验收（主会话复跑）：npm test 131/131 全绿（既有 125 + 新增 6），node --check lib/client.js 通过；既有断言逐条未改（抽查 L79/L84/L524/L801 等）。
- 未覆盖：真实浏览器渲染（桌面亮/暗、窄屏横向滚动观感）未验证，只有静态 CSS 断言；sessionStorage 桩非真实宿主（配额满/隐私模式降级只有代码路径）；宿主重挂载首帧闪烁未验证；多标签页并发写 last-write-wins 无锁。
- **发布**：0.8.0 tgz（2.54MB，sha256 `9a04b5bfc4ab1d7a9377e1af80083ae3b209d3225b0b2a9448b9daa67d882a90`）→ 桌面 CLI update（exit 0，pnpm `-0.7.0 +0.8.0`，lockfile 过供应链策略）→ `unlag_refresh` → `fiberPhase: active`；安装目录 `~/.dsh/profiles/desktop/node_modules/dsh-unified-router` 的 package.json 为 0.8.0、lib/client.js 哈希与构建产物一致（`11d9e604…`），日志无 credentials-local reload failed。桌面壳已升级（CLI 0.2.2-rc.3，原 0.2.1-rc.4）。
- **打包修复**：旧 tgz 曾被卷进发布物（npm pack 无 .npmignore 时用 .gitignore，而旧 .gitignore 只排除 *.tar.gz 不排 *.tgz）——0.7.0 达 39.6MB 且逐版递增。已在 .gitignore 补 `*.tgz` / `*.tgz.sha256`，0.8.0 降到 2.54MB。

### 已完成并生效：0.9.1（Qoder CLI 目录 + 倍率徽标 + Raccoon 思考档位 + 兜底表重采）

- **Qoder 中国版目录借本机官方 CLI 真拉**（`vendor/channel-pack/src/qoder-cli.ts`）：目录端点需专有 WASM 签名，改 spawn `qoderclicn --list-models`（回退 IDE 附带 worker runtime），解析文本表并以 CLI 的 key 为准、能力属性与策展表合并（新 id 用 `contextWindow:0` 哨兵）。opt-in：只有手动「刷新目录」才 spawn，回落提示先 `qoderclicn login`。见 [QODER-CLI.md](QODER-CLI.md)。
- **模型选择器倍率徽标**：用 DSH 0.2.2+ 核心原生 `LlmModelInfo.badge`（`model-rate-badge.ts`），四渠道 `listModels()` 挂当前生效倍率（免费→success、计费→neutral、促销→info、未知→不挂）。
- **Raccoon 逐模型思考档位**：解析上游 `params.raccoon_thinking`，托管模型发**顶层** `raccoon_thinking_level`（实测 `extra_body` 形态回 400），老模型继续 `extra_body.thinking`；两套方言互斥。上游 `default_level` 为 `off` 时默认档取最低思考档。
- **「CoT 泄漏到 assistant」根因已定位并修**：会话记录 18 处正文泄漏规划全是「思考实际关闭」所致（插件从未发 level），发对 level 后规划回到 `reasoning_content`。探针表见 [CATALOG-AUDIT.md](CATALOG-AUDIT.md) §13。
- **兜底表重采**：Loomy 10→7、TRAE 32→20（以 solo_agent 为基准、ctx 不拍平）、WorkBuddy 15→16（按 live config join 能力）、Raccoon 两侧各 7 条（订阅 id 补 `-p`）。
- 打包：`dsh-unified-router-0.9.1.tgz`（2.58MB，sha256 `39d2b6d862bb46d346ef4b717836fc165ad93bc2d06240dc061875606cbe0705`）→ 桌面 CLI update（exit 0，pnpm `-0.8.0 +0.9.1`，lockfile 过供应链策略）→ `unlag_refresh` → 安装目录 package.json 为 0.9.1，`lib/client.js`（`b9ddcd97…`）/ `lib/backend.js`（`27a89ea1…`）哈希与本地构建一致，日志无 credentials-local reload failed（同期 `dsh-kiro` 的 token 过期警告与本插件无关）。
- 验收：`npm test` **139/139** 全绿（新增 `test/raccoon-thinking.test.mjs`、`test/qoder-cli.test.mjs`、`test/model-rate-badge.test.mjs`）；`node --check` 三份产物通过。
- 未覆盖：真实浏览器观感（未安装）；Qoder CLI 需用户一次性 `qoderclicn login`；Raccoon 各 `level_N` 的服务端 token 预算语义未核实（上游不映射）。

### 已完成并生效：0.9.2（UI 重做 + 去防御性文案）

用户两条要求：① 插件里的 GPT 式叠甲文案全去掉；② 界面重做（"太丑了，完全没有设计和 UX 优化"），并且**先渲染出来自己看**再判好坏。

- **渲染检查链路（新增，后续改 UI 都该用）**：`.cache/preview/index.html` 用本地 bootstrap 复刻 DSH 的 `window.__ModuleLoader__`，把 `lib/client.js` 挂到真 React 18 UMD + fixture RPC 上；Chrome headless `--screenshot` 出图，`read_image` 肉眼核对。参数 `panel=/provider=/theme=/w=/expand=/debug=`（`w` 模拟窄容器，因为 Chrome headless 窗口最小约 500px；`debug=1` 会把关键容器宽度打进 DOM）。React UMD 与截图都放工作区 `.cache` / `%TEMP%`，不入交付物。
- **文案清理**：删掉全部 `.eac-section-description` 段落与「请勿视为…」「不代表 0」「以上游为准」「请先在 X 中 Y」「如果另一个插件…请先关闭它」这类句式，改为徽标 + 一行指标；故障态收敛成短语（「额度读取失败」「用量未完整读取 · 显示上次结果」「未配置 API Key · 目录不可用」）。保留「未知 / 由上游决定」这类事实标注（它们影响判断）。
- **视觉重做**：字号/间距/圆角全部走 `styles.js` 里的 `--eac-s*` / `--eac-fs-*` / `--eac-r*` 令牌（4/8 网格）；工作区去掉外层大卡片，改为「页头 → 渠道 tab → 分区 tab → 扁平内容」；账号从卡片改列表行（余额用 tabular 大数字右对齐）；模型从三列卡片墙改**单列紧凑行**（开关 / 名称+ID / 默认参数 / 参数），备选理由只在 stale 行显示；选中渠道 tab 用强调色边框 + 淡底 + 强调色文字；空态只留一个主 CTA。
- **窄屏（≤640px 容器）**：账号行折成两行（余额移到名称下方缩进）、模型行默认参数换第二行并隐藏模型 id、表格类容器单列；用 grid-template-areas 重排而不是靠 flex-wrap 猜。
- 打包与安装：`dsh-unified-router-0.9.2.tgz`（2.58MB，sha256 `efb0533a05444a370c6248e5dd52af647c66f54a53bc14ec5c8332b6ae931179`）→ 桌面 CLI update（exit 0，pnpm `-0.9.1 +0.9.2`）→ `unlag_refresh` → 安装目录 package.json 0.9.2、`lib/client.js` 哈希与本机构建一致（`ffe75a90…`）、日志无 credentials-local reload failed。
- 验收：`npm test` **139/139** 全绿（改了 5 处断言：兜底提示句被徽标取代、WorkBuddy 分区标题与 tab 同名改按标题节点断言、无剪贴板提示文案、站点内置目录文案、空态 CTA 去重）；`node --check lib/client.js`、`lib/backend.js` 通过。已肉眼核对：亮色账号/模型/渠道、暗色账号/模型/渠道、窄容器账号/模型、WorkBuddy 空态。
- 未覆盖：真机宿主内渲染（字体与 `--dsw-*` 变量实际取值可能与本预览有差异）；动画与 hover 的实机手感；商汤「额度」分区只看了空数据态。

### 已完成并生效：0.9.3（清掉「无效硬编码」的真正来源）

用户报障「Loomy 里怎么还有不存在的 qwen3.8-max」，并指出同类问题之前提过、仍是老样子。

- **再次真拉 Loomy 目录**：10 条（7 chat + 3 image），**上游从来没有 `qwen3.8-max`**；兜底表 7 条与 chat 目录逐条一致。⇒ 原先审计里把它算作「上游有、兜底无」属错误归因，已在 [CATALOG-AUDIT.md](CATALOG-AUDIT.md) §14 更正。
- **根因不是兜底表，是黑名单复活**：`state.json` 的 `disabledModels.loomy` 残留旧表时代的 `qwen-3.8-max: true`，而 `model.list` 有一条「把黑名单里存在、目录里没有的 id 补成裸 id 行」的保底逻辑 → 幽灵模型行。
- **修法**：① 删掉这条补回逻辑（目录只认 `listAllModels()`；「已失效」仍走 dead 表 + `model.clearDead`）；② 目录来自远端真拉时 `model.list` 调新增的 `pool.pruneDisabledModels()` 剪掉已不存在的黑名单键并落盘，兜底目录不剪；③ 四个适配器新增 `isRemoteCatalog()` 供上面判断。
- **顺带修**：`D:/Software Projects/unified-router-build`（esbuild 工具目录）的 `node_modules` 在安装 0.9.2 期间消失，`npm run build` 直接报「找不到 esbuild」；重新 `npm install` 恢复。
- 验收：`npm test` **142/142** 全绿（新增 `test/model-blacklist-hygiene.test.mjs` 3 条）；安装 0.9.3 后 `lib/backend.js` 哈希与构建一致，bundle 里只剩 dead 表那条合法补回路径。
- 仍未覆盖：TRAE / WorkBuddy 表的 live 复核来自当天重采（未再独立真拉一次）；Qoder CN 目录需 WASM 签名或官方 CLI 登录，无从只读核验。

### 已完成并生效：0.9.4（数据自己更新：不再靠点击驱动）

用户报障「依然是点进去设置、点进去账号才会刷新额度账号信息。这个设计到底是怎么来的？太蠢了」。

- **先测量再改**：给渲染预览 harness 加上 RPC 序列记录（`&debug=1` 的 `rpc` 字段），一次 dump 就看清了真实调用顺序 —— 打开设置页只读**第一个渠道**（硬编码 `initial('loomy')`）的 `account.list` + `credits.balances`，其它渠道只有 `provider.status`；没有定时刷新，所以数字停在上次打开那一刻。
- **三处修复**：① `store.load(rememberedProvider())`（挂载时显式读记住的渠道，切渠道时写 `sessionStorage`），不再永远从 Loomy 起；② 新增 `store.refreshLight()`：只打 `provider.status` + 当前渠道 `credits.balances`，不置 busy / 不写 notice / 不重读账号与模型列表，写操作或整页读取在途时跳过，自己持有 `lightController` 并在 `dispose()` 里 abort；③ `settings.js` 每 60s 调一次，并在 `visibilitychange` / `focus` 时立刻补一次（`document.hidden` 时跳过）。
- **验证方式（可复用）**：用 `python -m http.server` 起本地静态服务（`file://` 下 sessionStorage 不可用，且客户端跑在独立作用域里），再用 Chrome headless `--dump-dom` 读 `rpc` 序列：无 `last` 时首个渠道读取仍是 loomy，带 `last=raccoon` 时直接是 raccoon；`focus=1` 时序列里恰好追加 `provider.status` + `credits.balances:raccoon` 两条。
- 验收：`npm test` **144/144** 全绿（新增 2 条：记住渠道的首次读取落在该渠道；`refreshLight` 只打两条 RPC 且不置 busy/notice）。安装 0.9.4 后 `lib/client.js` 哈希与构建一致，产物里含 `last-provider` 键与 `refreshLight`。
- 未覆盖：商汤（自己的 `plan` 轮询）与 WorkBuddy（快照型）不走 `refreshLight`，它们的自动刷新节奏没有改动；60s 间隔是拍的默认值，没有按真实上游限流调过。

### 已完成并生效：0.9.5（删掉策展层 + 模型 id 必须可见）

用户三条：① 一堆模型名没写（如 `qmodel` 这类代号）；② 小浣熊免费/付费的模型 **id 不显示**，看不出对错；③ 很多「推荐项」是瞎写的。

- **id 可见性（真缺陷）**：0.9.2 的窄屏规则把 `.eac-model-id` 直接 `display:none`，而宿主设置面板正好落在窄容器区间 —— 于是小浣熊免费/订阅两侧**同名不同 id**（订阅侧多 `-p`）根本分不出来。改成窄屏把 id 放到名字下一行，任何宽度都不隐藏。
- **策展层整体删除**（用户选「全删：不要推荐、不要备选、不要理由」）：`loomy`(mimo-v2.5)、`raccoon`(两侧 GLM-5-3)、`qoder`(dmodel/gmodel/kmodel) 的 `stale`/`staleReason` 全部移除；`ModelsPanel` 从「常用 + 可折叠备选」两套列表改成**单一列表**（顺序即上游顺序、默认全部启用），删掉 `stalePage/staleOpen` 视图状态与对应 CSS；`MODEL-CURATION.md` 重写成「目录来源与展示原则」，不再有任何推荐/备选判断。
- **内部代号兜底名**：`core.js` 的 `MODEL_ALIASES` 补 `qmodel_38max`/`qmodel_latest`/`qfmodel`/`dmodel`/`dfmodel`/`gmodel`/`gfmodel`/`kmodel`/`kmodel_latest`/`mmodel` → 人话名，任何只拿到 id 的路径也不会显示代号。
- **两个自己踩的坑（已加护栏）**：
  - `styles.js` 是**模板字面量**，我在 CSS 注释里写了反引号、把字符串提前闭合，构建产物里 `-p` 变成 JS 表达式 → 浏览器里 `ReferenceError: p is not defined`，整个设置页白屏。`node --check` 检查不出来（拼接后仍是合法 JS）。已加测试：CLIENT_STYLES 模板体内不得出现反引号。
  - 预览 harness 自己也踩了同一个坑（python 注入 JS 时把 `
` 写成真换行），已把 loader 改成不含转义的形式。
- **预览链路补强**：harness 增加 `factory-error` / `boot-error` / `runtime-error` 三个可见错误块与 RPC 序列记录（`&debug=1` 的 `rpc` 字段），这次就是靠它一眼看出「页面白屏 = factory 抛错」。
- 打包与安装：`dsh-unified-router-0.9.5.tgz`（sha256 `e3d37cc1a6b27e2621d9e9013aa7e9f77670a659028936a075bb309a122b52ed`）→ 桌面 CLI update（exit 0，pnpm `-0.9.4 +0.9.5`）→ `unlag_refresh` → 安装目录 0.9.5、`lib/client.js`(`fb8ba49d…`)/`lib/backend.js`(`63bf3752…`) 哈希与本机构建一致，产物里 `eac-stale` 计数为 0（折叠分组确实删干净了）。
- 验收：`npm test` **146/146** 全绿（重写 4 条模型列表用例为扁平列表语义、2 条后端期望改为「无策展标记、全部默认启用」、新增 2 条护栏用例）；亮/暗/窄屏渲染逐一核对。
- 未覆盖：Qoder 的 `MODEL_ALIASES` 只覆盖已知代号，CLI 若出现新代号仍会短暂显示原 id（CLI 正常会给展示名）；TRAE/WorkBuddy 表未再独立真拉复核。

### 已完成并生效：0.9.6（首屏空账号的真因：后端就绪竞态）

用户第 N 次报障：「点开就是未识别、无账号，每次都要手动刷新」。

- **真因（这次有代码证据，不是猜）**：`lib/web-host.js` 的独立后端是 `import('./backend.js')` + `mountBackend()` **异步**挂载，而设置页通常先挂载完成。旧 `dispatch` 在 `channelRpc === null` 时**立刻**抛 `渠道后端未就绪`：
  ```js
  if (!channelRpc) throw new Error('渠道后端未就绪')
  ```
  于是首屏那批 `provider.status` / `account.list` 全失败 → 界面显示未知状态 + 空账号；等用户点「刷新」时后端早已 ready，所以看起来像「必须手动刷新」。**每次重启/重载插件都会重现**，这也解释了为什么前几次只改客户端没用。
- **修法（三层）**：
  1. 宿主机：`dispatch` 在渠道后端没就绪时 `await Promise.race([ready, timeout(15s)])` 再转发；后端启动失败也 `markReady()`（否则请求白等到超时）。共用模式同样 markReady。
  2. 客户端：首屏读取失败按 300/800/1800ms 退避自动重试（只在「没有任何可展示数据」时重试，避免干扰「写操作后保留旧列表」的语义）。
  3. 客户端：结果**自相矛盾**也重试 ——`account.list` 返回 0 个账号，但同一轮 `provider.status` 报了 >0 个启用账号，说明读到了中间态。
- 顺手：空态从「还没有账号」拆成三态（正在读取 / 读取失败+重试按钮 / 确实无账号），并把窄容器下的渠道 tab 从横向滚动改成两列网格（380px 宽时原来只能看到 3 个渠道，用户截过图）。
- 验收：`npm test` **147/147** 全绿（新增 1 条：`dispatch` 必须 await 就绪信号，「未就绪」只能在超时后抛）。
- **打包与安装**：`dsh-unified-router-0.9.6.tgz`（sha256 `264ffbc8…`）→ 桌面 CLI update（exit 0，`-0.9.5 +0.9.6`）→ `unlag_refresh`；安装目录 0.9.6，`lib/web-host.js`(`3373ac64…`)/`lib/client.js`(`a54d9ae6…`)/`lib/backend.js`(`63bf3752…`) 哈希与本机构建一致，产物里含 `BACKEND_READY_TIMEOUT_MS` 与 `loadFailed`。
- 未覆盖：这条竞态无法在离线单测里真跑一遍（要真宿主异步挂载），回归用例是源码级断言 + 客户端重试路径的单测；若装后仍复现，下一步应在 `dispatch` 里加临时日志抓实际时序。

### 已完成待发布：0.9.7（状态落盘 + 首屏读全部渠道）

用户追问：「账号状态是不存档的吗？」「状态不应该是启动 DSH 就读取吗？为什么需要人工点进去才刷新？」

- **真相**：`pack` 渠道（loomy/raccoon/qoder/trae）的卡片计数走 `provider.status`（一次读全部渠道），一直是首屏就有的；但**商汤与 WorkBuddy 是快照型**，它们的账号数/套餐只存在于 `plan.snapshot` / `workbuddy.snapshot`，而这两个 RPC **以前只有点进那个渠道才发** → 那两张 tab 在点进去之前永远显示「未添加账号 / 状态未读取」。这就是反复出现的「点进去才刷新」。
- **修法**：
  1. `store.prefetchCards()`：设置页挂载时并发读 `plan.snapshot` + `workbuddy.snapshot` + `workbuddy.models`，静默合并进卡片状态（不置 busy、不动当前渠道的账号/模型）。
  2. **卡片级状态持久化**：缓存从 `sessionStorage` 换成 `localStorage`（跨重启存活），payload 升到 v2，除 channels/statuses 外还存商汤 plan 与 WorkBuddy 快照的**白名单投影**（无登录地址、无凭据）；`sanitizeCardSnapshots` 负责读回收编。「上次查看的渠道」也换 localStorage。
  3. 静默刷新（60s / 回前台）顺手补一次 prefetch（只在缺数据时发请求）。
- **验证**：预览 harness 的 RPC 序列（`&debug=1`）确认首屏就是 `provider.status` + `workbuddy.snapshot` + `workbuddy.models` + `plan.snapshot`，不再需要点渠道。
- 验收：`npm test` **148/148** 全绿（新增 1 条：卡片快照跨重启恢复、且不落登录地址与凭据）。
- 未覆盖：宿主侧没有在插件 mount 时预热账号池（现在靠设置页挂载时读）；如果用户从不打开设置页，宿主不会主动刷新状态。

### 已完成待发布：0.9.8（把反馈沉淀成规范 + 一批具体修正）

用户批评「不要我说什么就改什么，东一榔头西一棒子，整理成工程规范」。→ 新建
[docs/DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)：信息架构（六个渠道同一骨架 +
现行差异审计表）、数据加载（首屏/重试/落盘/静默刷新）、目录与命名（只认上游、
默认全启用、恢复推荐=同族最新、id 必显、倍率只走 badge）、文案、视觉、加渠道检查清单。
每条规则都标了「由来 + 回归用例」。AGENTS.md 顶部改为指向这份规范。

同时落地本轮具体修正：
- 渠道选择器：横向滚动条 → **自动换行的小卡片网格**（`repeat(auto-fill,minmax(150px,1fr))`），任何宽度都不藏渠道、不出滚动条。
- 名字去重：raccoon / qoder / trae / loomy 的展示名**不再拼「· x倍率 / · 免费」**——倍率由核心原生 badge 显示（用户截图「完全冗余」）。
- 「恢复推荐」重新定义为**同族最新**：`kimi-k3`(trae) / `minimax-m3`(trae) / `kmodel`(qoder) / `kimi-k3-1`+`glm-5.2`(workbuddy) 标为旧版、默认关闭、行上显示「旧版」；理由只写「同目录已有 X」这种事实。
- 修 trae 适配器的默认值缺陷：`isModelDisabled` 的旧版默认规则以前**只在用户手动关过东西时才生效**，现在无条件套用（否则旧版仍会进选择器）。
- 验收：`npm test` **148/148** 全绿。

### 剩余：模型卡片/参数编辑器按 kxyai 组件体系进一步细化（可选）
以 kxyai 组件体系重写模型卡片、参数编辑器（逐字段保存反馈）、账号行、额度展示；provider 切换保留（本会话的横向栏 + 缓存不得破坏）。model.refresh/source 状态已就绪可用。完成后同样走发布流程（升到当时的下一版号，含本会话改动）。
验收必须包含：桌面亮/暗、窄屏容器的实际渲染检查（不只静态 CSS 断言）；既有 DOM 测试钩子与无障碍属性保留。

### 目录审计（2026-11-17，只读，未改代码）
用户要求核查硬编码模型目录与上游是否对得上。子代理用各渠道现存 token 真拉上游目录比对（零副作用、未触发续期/登录、凭据脱敏），完整报告见 [CATALOG-AUDIT.md](CATALOG-AUDIT.md)。关键结论：
- **明显过时**：TRAE 32 条兜底仅 9 条仍有效（23 条下架/隐藏/非 chat，另缺 28 个新模型）；Raccoon 订阅面 4/4 兜底 id 与上游不符（上游订阅账号 id 恒带 `-p` 后缀，且缺 `sn-kimi-k3-1-pro-p` 等 4 个真实模型）；WorkBuddy 15 条中 8 条下架、缺 9 条在用；Loomy 10 条中 4 条下架（均标 stale）、缺 `deepseek-v4-flash-1017`。
- **快照漂移**：Loomy mimo-v2.5 ctx、WorkBuddy auto ctx（168k→256k）、TRAE 全表 ctx 拍平 200k（上游 116k–272k + 1M Max 档）、Raccoon GLM-5-3-Flash 促销文案过期（上游已恢复 0.2）。
- **无法核验**：Qoder CN（WASM 签名未实现，目录恒等于硬编码 11 条）；Raccoon `-p` id 实际可调用性（需计费推理，超出只读范围）。
- **代码发现**：vendor/sensenova-token-plan/raccoon-models.js 的 6 条 `RACCOON_FALLBACK_MODELS` 是死代码（本插件 raccoon 走 channel-pack，全仓零引用）；`RACCOON_IMAGE_CAPABILITY_OVERRIDES` 的 deepseek 键无 `-1017` 后缀 → 永不命中（当前上游 tags 含 vision 故无影响）。
- **过程瑕疵**：子代理脱敏脚本曾把 .credentials.yaml refs 行前 120 字符（token 前缀片段，非完整凭据）打进其工具日志；报告与交付不含凭据值。已提醒用户不外传该日志、可选轮换。
- 修复（重采兜底表 / -p id 决策 / 覆盖键修正）属 vendor 改动，**未做**，待用户授权另立任务。

### 未覆盖（如实记录）
- 真实上游联调：entitlement_info 解析、真实扫码登录、WorkBuddy 真实余额/签到、目录真拉取，全部只有桩验证，待用户实机。
- 七→六卡片后的宽屏排布观感未实机确认。
- 早前一次勘察脚本失误曾把部分既有令牌原文打进会话输出（sensenova 旧 key 已被迁移覆盖；其余为会自然过期的 JWT）。已提醒用户可撤销旧 key。

## 5. 部署与发布流程（已验证可用）

```powershell
# 桌面 CLI（DSH NEXT，无 shim；入口已核验）
# ⚠️ DSH NEXT.exe 是 GUI 子系统：PowerShell `&` 调用不等待、不设 $LASTEXITCODE；
# Start-Process -ArgumentList 不会自动给含空格路径加引号，须手动内嵌引号（0.8.0 安装实测）。
$exe = 'C:/Program Files/DSH NEXT/DSH NEXT.exe'
$cli = 'C:/Program Files/DSH NEXT/resources/app.asar/lib/desktop-cli.js'
$spec = 'dsh-unified-router@file:D:/Software Projects/dsh-unified-router/dsh-unified-router-<ver>.tgz'
$prev = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'   # 仅命令进程内设置，结束恢复
  $p = Start-Process -FilePath $exe -ArgumentList "--expose-internals `"$cli`" plugin --profile desktop update `"$spec`"" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "插件更新失败：$($p.ExitCode)" }
} finally {
  if ($null -eq $prev) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $prev }
}
```
- 重载用会话工具 `unlag_refresh`（用户明确指定；不是 CLI、不是 plugin_manager）。
- 生效核验：`plugin_manager list_plugins` 找 `include:dsh-unified-router` 的 `fiberPhase: active` + 安装目录 package.json 版本 + 日志无 credentials-local reload failed。
- 凭据服务是文件-backed + chokidar 热重载：原子写 `~/.dsh/.credentials.yaml` 即被运行中宿主采纳；**必须保留 `version: 1` 尾行与 records/refs 结构**。
- 构建工具在同级 `../unified-router-build`（esbuild）；`npm test` 先构建后测试。lib/backend.js 曾被瞬时文件锁占用致构建失败，重试即恢复。

## 6. 关键文件地图

| 区域 | 文件 |
|---|---|
| 宿主入口/RPC | `lib/web-host.js`（投影+门禁）、`lib/rpc.js`（白名单）、`lib/sensenova.js`、`lib/workbuddy.js`（多账号管理器） |
| 后端源码 | `src/backend.ts`（mountRaccoon 按 plan 选号/独立目录、traeCatalogFields、图片偏好包装） |
| 客户端源码 | `src/client/{core,store,styles,ui,panels-core,settings}.js` + `src/client/providers/*.js`（注册表 index.js） |
| vendor | `vendor/channel-pack/src/`（raccoon/trae/loomy/qoder 适配器与 RPC；改动仅限约定范围）、`vendor/sensenova-token-plan/`、`vendor/workbuddy/`（MIT，驱动公开 hooks） |
| 迁移 | `scripts/migrate-from-magpie.mjs`；备份在 `~/.dsh/.credentials.yaml.bak-migrate-*` 与 `~/.dsh/channel-pack/state.json.bak-migrate-*` |
| 测试 | `test/*.test.mjs`（backend/host/web-client/model-selection-ui/plan-models-ui/sensenova-*/workbuddy） |
| UI 范本 | `D:\Software Projects\dsh-kxyai-provider\client.js`（1513-1690 行组件区） |

## 7. 协作约定（本会话确立）

- 实现派 SWE 子代理（用户明确要求「不要什么都自己干」）；派单前 `list_subagent_models` 取目录、显式 provider+model；免费路由失败换缺省档（workbuddy/deepseek-v4.1-flash 已多次验证可用）。
- 免费路由 SWE-2 Flash 只适合上下文小、产物可直接验证的小任务；本会话 ~2500 行上下文的有界实现零产出（8 分钟、结束消息截断），换缺省档成功——此规模任务直接走缺省档。
- 主会话负责：架构决策、派单契约、验收（复跑测试+审查关键改动）、发布安装、文档。
- 子代理交付报告里的「未覆盖项」必须如实转述给用户，不夸大。
- 凭据操作全程脱敏（只报存在性/长度/打码标识）；迁移/写入前备份。
