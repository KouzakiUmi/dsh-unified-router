# 更新记录

> 按版本倒序排列。0.3.0 是首个公开版本，此前 0.4.0–0.9.x 的内部迭代编号已合并进 0.3.0，不再逐版本罗列。

## 0.8.5（2026-11-28）

- **全局设置**：在渠道卡片下方集中管理额度上报、智能选号和四项自动化默认值。额度上报不再放在小浣熊的渠道页。
- **设置保存**：额度上报开关重启后保留；保存后立即读取设置时显示新值。
- **渠道自动化**：自动签到、自动领取奖励、自动完成任务和思考循环保护统一使用「跟随全局 / 单独开启 / 单独关闭」。跟随时显示实际开关状态，修改全局默认值不会覆盖渠道的独立选择；手动领取、执行和查询仍可使用。

## 0.8.4（2026-11-28）

- **CodeArts**：模型列表和选择器显示目录返回的积分倍率；同一模型有不同计费档时显示区间。额度缺失时保持未知，明确的 0 照常显示。
- **小浣熊**：统一模式下，订阅独有模型直接走订阅账号；两侧共有的模型仍优先使用免费账号。统一与独立模式分别缓存目录。
- **AStudio / CodeArts**：手动模式按账号列表顺序选号；较晚返回的旧目录不覆盖较新的刷新结果。
- **WorkBuddy / 订阅用量**：修正已用百分比；超过接收上限时标记部分数据；确认渠道已无账号后撤回旧卡，读取失败时保留上次结果。
- **自动任务**：确认奖励或任务到账后立即通知设置页刷新状态。

## 0.8.3（2026-11-27）

- **额度推送按渠道拆源**：`source` 改为 `unified-router-<provider>`，每个渠道一张卡、卡标题是渠道名，条目才是账号名（此前所有渠道挤在一张卡里，接收端只看到一串账号名、无法识别 provider）。
- **新增全局开关 `quotaIngest`（默认关闭）**：设置页「向 subusage 推送额度：关 / 开」，开启后立即推一次；默认关闭，避免一次往接收端塞入多张卡。
- **推送频率与药丸/快照刷新对齐**：由 5 分钟改为 60 秒（宿主采集周期 `SNAPSHOT_INTERVAL_MS`）。
- 没有条目的卡不再产出（接收端 `parseIngestPayload` 会拒收空载荷，推过去只是白写日志）。
- 回归 `test/quota-ingest.test.mjs`（15 条，含拆源与开关口径）。

## 0.8.2（2026-11-27）

- **向 subusage 推送额度（ingest 被动接入）**：新增 `lib/quota-ingest.js`，宿主启动 20 秒后与每 5 分钟把**已采集的公开快照**翻译成 QuotaEntry 元素，经 `ctx.get('subUsage').ingest()` 推给 dsh-subusage（契约见该仓库 `docs/ingest-handoff.md`）。覆盖账号池（`credits.balances`）、商汤（`plan.snapshot` 的 `quota.pools`，带 5h/7d 周期与绝对 `resetAt`）、自管多账号（`managed.snapshot`）、WorkBuddy（额度窗口）与 API Key 渠道（`apikey.snapshot` 的 `quota` / `balance`）。**只消费快照、不发任何上游请求**；服务缺席静默跳过，推送被拒记一条 warn。
- **推送口径按独立复核收紧**：`receivedAt` 取保留项里**最旧**的数据时间（新快照不能把旧额度洗成 fresh）；`resetsAt` 由数据时间 + 相对值或上游绝对时间推出，不随推送时刻后移；控制台余额 0 优先且不借 API 的 USD/CNY 单位；`quota` 非 ready 仍报 API 余额；窗口带 `pool` / `poolLabel` / `poolScope:'independent'`，同渠道多账号不再合并；原始百分比 ≥100 才写 `status:'rate-limited'`（展示值夹到 ≤99.9，取整不造假限流）；id 用稳定短哈希、自由文本过秘密闸门、超 60KB 逐步丢尾并标 `partial`。
- **额度增长确认覆盖账号池**：宿主额度读取原先只认数字 `balance`，账号池的 `balance.total` 与 WorkBuddy 的窗口都不认，导致这些渠道永远拿不到基线。现在支持账号池总额；WorkBuddy 因窗口混着试用积分 / Token / 百分比、且有 429 合成的 0 余额，**保持未知**（否则合成额度消失会被误判成签到到账并永久确认）。
- **TRAE 缓存命中量夹取**：命中量不可能超过 `prompt_tokens`，上游异常时夹到 prompt，`inputTokens = prompt - cached`，可信 0 照常下发、未知才省略字段。
- 回归 `test/quota-ingest.test.mjs`（14 条）+ `test/trae-cache.test.mjs` + `test/web-client.test.mjs`。

## 0.8.1（2026-11-27）

- **TRAE 缓存命中率统计修复**：上游自 2026-10-27 起不再下发缓存命中计数——同前缀连发多次，`cache_read_input_tokens` 恒 0、`metadata.prompt_cache_pool_record` 恒 `null`，但账单显示同前缀第二次仍便宜约 3 倍（缓存真实生效、只是不上报）。适配器原先只认 3 个字段名、取不到就按 0 计，于是命中率恒为 0%。现在：① 候选字段扩到 6 个读取 / 4 个写入（Anthropic、OpenAI、DeepSeek 与 camelCase 命名）；② 解析 `metadata` 的缓存池声明，0 只在上游明确挂了缓存池时采信，否则按未知省略字段，不替上游编造 0%；③ 解析逻辑抽成纯函数 `vendor/channel-pack/src/trae-cache.ts`。设置页 TRAE 模型分区同步显示一行状态「缓存命中率：上游未上报（按 0 计）」。回归 `test/trae-cache.test.mjs` + `test/web-client.test.mjs`。
- **签到/领取的「待确认」可以用额度增长确认**：AStudio 与 CodeArts 的签到长期停在「签到待确认」——上游只读核实给不出入账证据（AStudio 只认今日积分流水里的 `GRANT + 每日/登录`，CodeArts 活动状态停在 `CLAIMED`），而账本铁律是 pending 只能由上游证据解除，于是永久卡住。现在提交前把该账号额度写成主记录基线，只读核实时若当前额度高于基线（增量在 `(0, 1_000_000]` 内）即按已到账确认，落 `.confirmed` 观察票据：签到显示「已签到 +N」，奖励/任务显示「奖励已领 +N」/「任务已完成 +N」。上游核实给不出 done 证据时兜底（待确认 / 无 `verify` 通道 / 查询失败）；额度没变、无基线、读不到额度、增量异常时保持原状态。主记录与「pending 绝不重放」铁律不变。回归 `test/balance-confirm.test.mjs`。
- **思维链守卫的事件广播默认关闭**：`unified-router/cot-loop-guard` 事件只供外部监控项目订阅，需显式配置 `cotLoopGuard.emitEvents: true` 才对外发；守卫本身的切断与续跑不受影响。回归 `test/cot-loop-guard.test.mjs`。
- **移除未使用的 `undici` 开发依赖**：源码没有任何引用，移除后消除 5 条 Dependabot 安全告警（4 high + 1 medium）。

## 0.8.0（2026-11-27）
- **TRAE 付费专用模型标注**：`qwen4-max`（Qwen4）、`glm-5.4`（GLM-5.4）、`kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed`（K3.1 系列）只有付费订阅账号可调用，免费账号调用会被上游拒绝。这四个 id 挂「订阅限定」info 徽标（独立于倍率/免费徽标）。由于远端目录不下发订阅标志、`glm-5.4` 又不在离线兜底表里，新增 `TRAE_SUBSCRIPTION_ONLY_MODELS` id 集合在 `listAllModels()` 里统一标注。`Doubao-Seed-Evolving` 已开放普通账号，不再挂标。回归 `test/model-rate-badge.test.mjs`。
- **账号订阅类型（`planLabel`）在设置页与额度药丸可见**：TRAE 从只读端点 `POST /trae/api/v2/pay/ide_user_pay_status` 读取 `user_pay_identity_str`（`Free` / `Pro` / `Pro+` / `Ultra` / `Express`），`account.list` 时为启用账号附加 `planLabel`（按 uid 缓存 60 秒、并发去重、失败或凭据不可解析静默跳过，绝不影响账号列表）。新增 wire 契约字段 `planLabel`，设置页账号行（pack 卡）与额度药丸的账号行/详情都优先显示订阅类型；Raccoon 继续用 `plan` 枚举映射（体验版/订阅/未知），WorkBuddy 与自管渠道展示上游 `plan` 文案，Qoder 上游不下发订阅身份、不显示不编造。回归 `test/backend.test.mjs`、`test/quota-pill.test.mjs`、`test/web-client.test.mjs`、`test/channel-contract.test.mjs`。

## 0.7.0（2026-11-25）

- **移除 Loomy 渠道**。上游把全部账号标记为受限，请求一律被静默降级到 `spark-x2.6-low`（响应体仍谎报模型名，只有积分账本能看出），1:1 复制官方客户端请求同样被降级。本次删除：vendor 的 12 个 `loomy-*` 实现文件、后端挂载模块、`lib/loomy-route.js`（上游路由检测整条能力，含 4 个 RPC）、客户端卡片模块与 Loomy 专属 UI（路由概览 callout、永久积分锁定开关、完成新手任务按钮）、`automation.json` 的 `loomyPlainBody` 字段、短信登录 RPC（`login.sendSms`/`login.submitSms`）。用户磁盘上的 Loomy 账号、路由状态与目录缓存已一并清理（清理前备份在 `<dsh home>/backups/loomy-removal-*`）。清理可用 `node scripts/cleanup-loomy.mjs` 重复执行（幂等、先备份）；**须在插件重新加载之后运行** —— 旧版插件进程仍在内存里持有这些数据，清理后它会写回。
- **写后失效改成规则表**：`lib/channel-specs.js` 新增 `INVALIDATE_RULES`（渠道开关 / 模型参数 / 目录 / 账号变更 / 登录成功 / 领取签到五类），`updateSettingsSnapshots()` 不再按 `method.startsWith` 写分支，只保留乐观补丁。配套回归断言「每个写方法都有失效归属」，挡住「写了但界面不刷新」这类静默缺口。
- **账号池渠道按注册表装配**：新增 `src/backend/providers/pack-registry.ts`，从规格表派生挂载表；`packSlot` 字段与 `lib/pack-slots.js` 让 vendor 形参名可校验。四种不一致（缺实现 / 缺形参位 / 形参位重复 / 多登记实现）改为**加载期抛错**，`mountBackend` 不再手写渠道名与 slots 字面量。
- **静态核验脚本 `npm run check:residue`**：把 git HEAD 与当前源码的模块级声明做差，找出「已删除、当前无定义、仍被引用」的标识符。它抓出并修掉了三处真实残留：`usageBadge` 装配块被我误删（`usage.badge` 端点会 ReferenceError）、`account-probe.ts` 的 `ProbeCredential` 联合仍列着 4 个已删凭据类型（类型无效但能构建）、`queue-rotation.ts` 里调用已删 `pickSlot` 的身份槽死分支（同样是运行时 ReferenceError）。顺带清掉两处不会报错的死引用：`BADGE_PLAN_SELECTORS` 的 `zcode` 条目、`queue-rotation` 的 `zcode_jwt` 令牌字段分支。
- **vendor 整体裁剪**（用户决策「全部重写，不管上游」，推翻上一版的「不裁剪」）：删除 `lobsterai` / `cline` / `zcode` / `minimax` / `gemini` / `opencode` 六个国际渠道的实现与全部接线（含 `account-probe` 探测分支、`cline.quota` / `cline.requestLog` 两个端点、captcha 载体与供给槽、opencode 身份槽）。vendor 源文件 137 → 59，`lib/backend.js` **2.08 MB → 0.65 MB（−69%）**，vendor 位置形参 9 → 4，凭据前缀表 12 → 5。裁剪口径是 esbuild `metafile` 的可达性判定，不是手推 import 图。
- （已作废）不裁剪 vendor 的 6 个未注册国际渠道：用 esbuild `metafile` 量出它们在 2.17 MB 的 `lib/backend.js` 里共占 ≈310 KB（14.3%）。它们在两种部署里都是死代码，但移除要改 vendored 签名与数百行分支、与上游彻底分叉。14% 包体换真实回归风险不划算，故保留，理由与重估条件见 [渠道接入架构 §5](docs/CHANNEL-ARCHITECTURE.md)。
- **客户端方法集不再手写**：`src/client/core.js` 的六张方法表改为由 `lib/channel-specs.js` 的 `clientMethodSets()` 派生（`channel-specs` 因此也拼进客户端产物）。客户端白名单按 `HOST_INTERNAL_METHODS` 收窄一档：`credits.status` / `onboarding.status` 是签到与奖励的只读核实端点，`raccoon.checkin` 是宿主每日签到调度专用 —— 三者都没有界面入口。新增 `test/channel-method-parity.test.mjs` 锁死「客户端声明的每个方法宿主都接受」「宿主只比客户端多这张内部表」「各分类集合与规格表逐项一致」「专属方法唯一归属」「退役渠道不得同时在规格表里」。
- **契约层硬化**：修掉 `modelWire` 的一个 wire 违规 —— 倍率形状像但文案不合法时，旧写法 `...(source.rate ? { rate: wireRate(source.rate) } : {})` 会产出 `{ rate: undefined }`（字段在、值为 undefined，正是 typert 会让整条作废的情形）。改为先算成值再决定是否展开。另外把此前只写不用的 `wireJson()` 真正接到 `publicResult()` 出口做深度净化兜底，并清掉 `CARD_SPECS` / `ACCOUNT_POOL_SPECS` 两个死导出。回归 `test/channel-contract.test.mjs`。
- **客户端首屏只读宿主持久化快照**： /  /  /  /  与快照型渠道的方法一律带  读宿主落盘的那份，**不再为打开设置页打上游**。宿主尚未采集（AT ÃüÁîÒÑÆúÓá£Çë¸ÄÓÃ schtasks.exe¡£

ÎÞЧµÄÃüÁ

AT ÃüÁÅÅÔÚÌض¨ÈÕÆںÍʱ¼äÔËÐÐÃüÁîºͳÌÐ
ҪʹÓÃ AT ÃüÁ¼ƻ®·þÎñ±ØÐëÒÑÔÚÔËÐÐÖС£
                                                           
AT [\computername] [ [id] [/DELETE] | /DELETE [/YES]]                    
AT [\computername] time [/INTERACTIVE]
    [ /EVERY:date[,...] | /NEXT:date[,...]] "command"

\computername       ָ¶¨Զ³̼ÆËã»ú¡£Èç¹ûʡÂÔÕâ¸ö²ÎÊý£¬
                     »á¼ƻ®Ôڱ¾µؼÆËã»úÉÏÔËÐÐÃüÁ
id                   ָ¶¨¸øÒѼƻ®ÃüÁîµÄʶ±ðºš£
/delete              ɾ³ýĳ¸öÒѼƻ®µÄÃüÁÈç¹ûʡÂÔ id£¬
                     ¼ÆËã»úÉÏËùÓÐÒѼƻ®µÄÃüÁ»ᱻɾ³ý¡£
/yes                 ²»ÐèҪ½øһ²½ȷÈÏʱ£¬¸úɾ³ýËùÓÐ×÷ҵ
                     µÄÃüÁîһÆðʹÓá£
time                 ָ¶¨ÔËÐÐÃüÁîµÄʱ¼䡣
/interactive         ÔÊÐí×÷ҵÔÚÔËÐÐʱ£¬Ó뵱ʱµÇ¼µÄÓû§
                     ×ÀÃæ½øÐн»»¥¡£
/every:date[,...]    ָ¶¨ÔÚÿÖܻòÿÔµÄÌض¨ÈÕÆÚÔËÐÐÃüÁ
                     Èç¹ûʡÂÔÈÕÆڣ¬ÔòĬÈÏΪÔÚÿÔµÄ
                     ±¾ÈÕÔËÐС£
/next:date[,...]     ָ¶¨ÔÚÏÂһ¸öָ¶¨ÈÕÆÚ(È磬ÏÂÖÜËÄ)ÔË
                     ÐÐÃüÁÈç¹ûʡÂÔÈÕÆڣ¬ÔòĬÈÏΪÔÚÿ
                     Ôµı¾ÈÕÔËÐС£
"command"            ׼±¸ÔËÐеÄ Windows NT ÃüÁî»òÅú´¦Àí
                     ³ÌÐ，全新安装 / 刚加渠道）时才回落实时读取，并按渠道去重地请宿主补采一次（同渠道的账号 / 目录 / 参数各问一遍只补采一次； 不单独补采）。读取水位改记**数据新鲜度**（快照的 ）而非读取时刻 —— 记成 now 会把宿主下一轮采集判成陈旧而丢掉，界面白白停滞一轮。回归  的两条快照用例。
- **客户端首屏只读宿主持久化快照**：`provider.status` / `account.list` / `model.list` / `model.params` / `credits.balances` 与快照型渠道的方法一律带 `snapshot: true` 读宿主落盘的那份，**不再为打开设置页打上游**。宿主尚未采集（`at === null`，全新安装 / 刚加渠道）时才回落实时读取，并按渠道去重地请宿主补采一次（同渠道的账号 / 目录 / 参数各问一遍只补采一次；`provider.status` 不单独补采）。读取水位改记**数据新鲜度**（快照的 `at`）而非读取时刻 —— 记成 now 会把宿主下一轮采集判成陈旧而丢掉，界面白白停滞一轮。回归 `test/web-client.test.mjs` 的两条快照用例。
- **账号行/模型行的 wire 形状收敛为单一实现**（`lib/channel-contract.js`）：`accountWire/accountView/modelWire/modelView` 被宿主 `publicResult` 与客户端 `core.js` 共用，删除客户端重复的 `modelRateFrom`。wire 层缺席不写属性、view 层补 UI 缺省值；倍率徽标认 `rate`/`rateBadge` 两种来源。
- **退役渠道的磁盘清扫**（ +  的 ）：独立模式启动时走  的公开 API 清掉退役渠道的账号与模型黑名单，并删除它自己的目录缓存与账本目录；幂等、绝不抛错、绝不阻塞启动。**共用模式不做**（那时  状态归原插件，删它的账号等于破坏别人的数据）。此前「删渠道」只删了代码，孤儿账号会永久躺在  里。回归 。
- **手动清扫脚本** （幂等、先备份、支持 ）：清账号 / 快照资源 / 路由状态 / 目录缓存 / 账本目录，并提示凭据文件里残留的  引用（**不擅自改凭据**）。仅在  未被覆盖时才动  的历史文件，避免演练误删真实数据。回归 。
- **退役渠道的磁盘清扫**（`lib/retired-channels.js` + `channel-specs.js` 的 `RETIRED_CHANNEL_IDS`）：独立模式启动时走 `AccountPool` 的公开 API 清掉退役渠道的账号与模型黑名单，并删除它自己的目录缓存与账本目录；幂等、绝不抛错、绝不阻塞启动。**共用模式不做**（那时 `channel-pack` 状态归原插件，删它的账号等于破坏别人的数据）。此前「删渠道」只删了代码，孤儿账号会永久躺在 `state.json` 里。回归 `test/retired-channels.test.mjs`。
- **手动清扫脚本** `scripts/cleanup-loomy.mjs`（幂等、先备份、支持 `--dry-run`）：清账号 / 快照资源 / 路由状态 / 目录缓存 / 账本目录，并提示凭据文件里残留的 `LOOMY_ACCOUNT_*` 引用（**不擅自改凭据**）。仅在 `DSH_HOME` 未被覆盖时才动 `~/.config/magpie` 的历史文件，避免演练误删真实数据。回归 `test/cleanup-loomy.test.mjs`。
- **渠道清单收敛为单一事实源**（`lib/channel-specs.js`，纯数据，宿主与客户端共用）：`lib/rpc.js` 的 `PROVIDERS`、各方法集、`ALL_PROVIDER_IDS` 全部由它派生；RPC 门禁改为按「方法类别 + 规格声明的专属方法」判定，删除按渠道写死的 if 链。新增/移除渠道不再需要改中心分派文件。架构与分期见 [渠道接入架构](docs/CHANNEL-ARCHITECTURE.md)。
- **vendor 位置形参收敛**：新增 `src/backend/pack-bridge.ts`，`registerChannelPackRpc` 的 12 个位置形参只在这一处出现（具名 `slots` 对象 → 按 `VENDOR_SLOT_ORDER` 展开）。Loomy 移除时 vendor 签名同步删掉它的形参位，桥接表随之从 10 位降为 9 位；实测一次「桥接表多传一位」会让 `nativeOnly` 丢失并错误装配 HTTP RPC，回归因此加在 `test/backend.test.mjs` 的装配用例里。
- **删除永久积分锁定机制**（唯一支持者 Loomy 已移除）：vendor 的 `permanent-lock-store.ts`、`AccountPool.permanentLocked/setPermanentLocked`、`state.json` 的 `loomyPermanentLocked` 镜像字段、备份载荷的 `permanentLocks` 字段与 `credits.permanentLock` RPC 一并删除。
- **删除 vendor 未使用的上游装配入口** `vendor/channel-pack/src/index.ts`（它装配本插件不接的国际渠道，从未进入构建）。
- **测试改写为渠道无关样本**：Loomy 的 3 个专测文件随实现删除；其余 12 个测试文件里「拿 Loomy 当样本渠道」的用例全部换成 Raccoon / Qoder 中国版 / TRAE，被跳过的「独立后端渠道的精选列表、启停恢复与持久化」装配用例恢复运行（改为在 qodercn/raccoon/trae 上验证选号、目录、黑名单与参数持久化）。全量 `npm test` 通过。

## 0.6.5（2026-11-24）

- 小浣熊「统一免费与订阅模型」开关打开后，界面不再区分免费/订阅：账号行去掉套餐标签，开关说明改为「合并为一个模型面 · 额度用尽自动切换账号」。合并的意义就是一个模型面，再挂套餐标签会让人以为还要按套餐挑账号。
- 修复测试载体：`loomy-route` 的后端装配用例随 Loomy 停用标记跳过，其余 4 项纯逻辑回归保留。

## 0.6.4（2026-11-24）

- WorkBuddy 补「被限流」信号：撞到 429 时按上游文案里的 `reset at <时间>` 记账（每账号一条，原子写 `workbuddy-limits.json`），额度面板多出一条「免费额度（token 窗口）· 已满 · 待重置」窗口，重置时刻过后自动失效；成功调用会清除该记账。
  - 记账发生在**换号之前**：换号成功后上层只看到 200，429 信号会丢失。
  - 该窗口标记 `estimate: true`，明确表示这是基于被拒信号的估算，不是精确 token 统计。
  - 为什么不做精确统计：vendor 的免费 token 窗口只读 Magpie 的 `usage.jsonl`，DSH 的调用不写那里，纯 DSH 环境下该窗口始终无数据。

## 0.6.3（2026-11-24）

- WorkBuddy 补齐两项账号能力：
  - **账号开关**：新增 `workbuddy.setAccountEnabled`，停用单个账号后它不再参与选号与 429 轮换（凭据保留，重新启用即恢复）；设置页账号行新增开关与「已停用」标记。
  - **429 自动换号**：推理请求在主账号额度用尽（上游回 429）时，按索引顺序自动切到下一个**已启用**账号，并跳过停用账号；只对 429 换号，请求体不可重放时不重试。修正了此前推理固定绑定「目录来源账号」导致单号耗尽即整个 provider 429 的问题。

## 0.6.2（2026-11-24）

- 小浣熊新增「自动每日签到」（渠道分区，默认跟随全局开关）。上游没有专门的签到端点：当日积分由服务端在收到带桌面端头的 `GET /api/web/office/v3/setting_info` 时发放，插件据此触发一次，再用 `points/v1/bills` 的当日新增账单回报本次得到多少积分（读不到账单时报「今日已签到」，不编造金额）。签到按账号调度，`raccoon-pro` 不重复签到。
- Loomy 请求按客户端形态发送（指纹头 + 形态字段），**仅为避免 429、保证能正常回复**。实测说明：上游对受限账号一律把请求落到 `spark-x2.6-low`（响应体仍谎报 `DeepSeek-V4.1-Flash`，只有积分账本能看出来），1:1 复制官方客户端请求同样被降级——**换 body 形态救不回账号级限制**。因此「简化请求体」开关**不再提供界面入口**（能力代码保留）。
- **AStudio 停用**：上游无法回报正确积分——积分用尽后仍显示满值，用户据此以为还有额度却调不动，几乎无法正常使用。渠道从 `MANAGED_PROVIDERS` 移除、客户端卡片隐藏；`lib/managed-providers/astudio.js` 实现完整保留，恢复时登记回注册表即可。
- **Loomy 停用**：全部账号被上游标记受限，请求一律落到 `spark-x2.6-low`（响应体仍谎报 `DeepSeek-V4.1-Flash`，只有积分账本能看出来），1:1 复制官方客户端请求同样被降级。停用方式为**不注册模型适配器**（`LOOMY_CHANNEL_ENABLED = false`），渠道内因此没有可用模型，模型选择器也不再出现 Loomy；认证、目录、余额选择器、路由检测、签到等实现完整保留。卡片暂时保留以维持既有回归覆盖，并沿用路由检测摘要显示「已被上游限制」。

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
