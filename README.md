# Unified Router · Web 设置插件

从 Our Free Model 2.8.0 提取 **Loomy、Raccoon、Qoder 中国版** 的账号渠道，并独立加入 **TRAE**、**SenseNova Token Plan** 与 **WorkBuddy**（腾讯 CodeBuddy 中国版，用量），提供与 Subusage 一样的 `settings.section` 设置入口。Raccoon（商汤小浣熊）是**一张卡片**：账号只有一个池，登录后按套餐自动分流到**免费/订阅两个模型提供方**；两侧的模型池完全独立——各用自己的账号凭据去上游拉目录，上游给这个账号什么模型就展示什么模型（不按倍率过滤）。只做 CN 版（WorkBuddy AI、Trae Global、Qoder 国际版不接）；Devin 已拆分为独立插件 `dsh-devin-provider`。没有输入框胶囊，不修改 dsh-go App 或 SDK。

入口：**设置 → 能力 → Unified Router**。DSH 网页端在设置分区中显示；dsh-go 通过现有 Web 设置页/岛屿打开。支持账号备注、启停、优先级、删除二次确认、浏览器登录、积分查询与领取、模型搜索与显示开关、失效模型恢复、Loomy 永久积分锁定；另提供商汤 Token Plan 的控制台登录、独立 API Key、额度池监控、5 小时/7 天窗口、赠送额度、模型消耗和模型提供方开关，以及 WorkBuddy 的浏览器登录、积分余额、每日签到与模型目录。

## 设置界面

- 六个渠道使用同一套「账号与额度」「模型」「渠道」分区。打开设置时恢复上次查看的渠道。
- 账号行优先显示套餐、剩余额度与更新时间。「管理」展开额度明细、奖励和维护。退出或移除账号需二次确认。
- 渠道状态和账号、额度快照由宿主每分钟更新并按 profile 持久化。页头「刷新」触发后台采集，界面读取现有快照并静默更新。
- Raccoon 使用一个账号池，模型仍分免费与订阅两个目录。两个目录各用本侧凭据采集，并分别提供刷新、启停和模型参数设置。
- Qoder 中国版的手动目录刷新使用官方 CLI。其余支持远端目录的账号池渠道进入模型分区时可后台补拉目录。
- 颜色继承宿主主题。窄屏渠道网格保留两列，账号与模型行自动换行。

## 模型列表与参数

- 默认进入模型目录，查看上游型号及本地启停状态。「恢复推荐」关闭有明确后继的旧版和有可比替代的低性价比型号。规则见 [设计规范](docs/DESIGN-STANDARDS.md#3-模型目录与命名)。
- 可按模型名称或 ID 搜索。模型启停、保存参数后保留当前编辑位置。手动启用、上下文和图片偏好可持久保存。
- 模型卡片及「默认」按钮显示实际默认参数，自定义值单独标注；未知默认值显示「上游决定」，不把能力上限当成默认值。
- Qoder 中国版采用已确认的 CN 目录与官方档位，不混入国际版模型。上下文参考档位为 200K / 400K / 1M。

## 后端模式

- `shared`：复用已运行的 Our Free Model 账号池。Web API 只允许操作上述 channel-pack 渠道，不重复启动适配器，不另开账号数据库。
- `standalone`（本机安装配置）：本包独立后端注册 `loomy`、`raccoon`、`raccoon-pro`、`qodercn`、`trae` 五个 channel-pack 提供方，并由内置的商汤 Token Plan 控制器管理商汤渠道；WorkBuddy 用量面板与模型服务由独立控制器管理（已登录且启用模型时注册推理适配器）。先停用原 Our Free Model，再在安装补丁的 `backend` 中选 `standalone`；检测到原账号池仍在时会拒绝启动，避免两个实例覆盖同一状态。沿用主机凭据服务和已有 channel-pack 账号，不删除其它渠道历史记录。

后端模式在安装配置中选择。每日自动签到默认开启，支持 Loomy、Qoder 中国版、TRAE 和 WorkBuddy。账号行显示当轮签到结果，自动和手动签到共用持久记录。共用模式的账号池签到由原 Channel Pack 管理。设置 `autoCheckin: false` 可关闭 Unified Router 的自动签到。

## 登录与积分

点击「添加账号」准备授权地址，再点真正的「打开登录页面」链接。完成后点「检查登录」，成功后列表自动刷新，无需再手动刷新。Qoder 中国版为 HTTPS 授权页；Loomy、Raccoon 为主机本机 HTTP 扫码/短信页，应在同一手机或主机的浏览器打开。可复制链接，页面不填写或显示系统密钥。

宿主启动后会定期刷新账号与额度，签到和任务奖励完成后会更新相应快照。Raccoon 的登录奖励、Loomy 的新手任务在对应账号的「管理」区域领取。重测限流会发送一次最小模型请求。

## 商汤 Token Plan

商汤使用 Token Plan API Key。「模型」显示 API 目录、启停、上下文、最大输出、默认思考档位和图片输入。「协议兼容性」可逐模型覆盖输出字段、推理字段、工具消息和流式用量等参数。会话显式选择的思考档位优先。

在「渠道」保存 API Key 并启用提供方。原有 API Key、模型显示偏好和最大输出上限继续使用已有存储。目录刷新请求 API 的 `/v1/models`。

## TRAE（字节 TRAE IDE）

TRAE 走 channel-pack 现成实现：认证用 ExchangeToken（轮换 refreshToken），对话用 Cloud-IDE-JWT 鉴权，SSE 为自定义格式。登录是 TRAE 账号浏览器授权（本机回调，无需粘贴），凭据静默续期；支持每日签到领取（「全部领取」）与余额查询。模型目录默认全部启用（兜底表 28 条，无「其他模型」分组）。

## WorkBuddy（腾讯 CodeBuddy）

WorkBuddy 分区读取并展示用量：套餐、积分余额窗口（Credits/Extra credits 等）、每日签到；模型目录支持逐模型启停，启用的模型注册为推理适配器。凭据、余额窗口、签到结果均按白名单投影，上游响应原文不回显。

- **多账号**（最多 8 个）：每个账号一行，显示套餐和剩余额度，展开可查看窗口、签到或退出；顶部「添加账号」可继续添加，签到/退出只作用于该账号。账号索引存 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS`（`[{id, credentialRef, name, uid, createdAt}]`），每账号凭据单独存 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6HEX大写>`；旧单账号引用 `UNIFIED_ROUTER_WORKBUDDY_AUTH` 会在首次读取时被采纳为第一个账号并清除。
- **登录走 WorkBuddy 官方浏览器授权**：点「添加账号」后，主机向 WorkBuddy 申请登录页地址并持续轮询授权结果（最长约 5 分钟）；登录地址会显示在面板，点「打开登录页」在浏览器完成授权后这里自动继续。
- 登录得到的令牌经 DSH 凭据服务加密保存，临期自动续期并只回写触发续期的那个账号；「退出登录」删除该账号的凭据与索引条目，其他账号不受影响。
- **余额读取**走 WorkBuddy 计费接口，展示套餐名与各积分窗口（剩余/总额/重置时间，未读到的显示「未知」）；软失败保留上次窗口并标记过期。
- **每日签到**领取当日积分（中国版计量接口；签到结果以 WorkBuddy 返回为准）。
- **模型目录**优先读已登录账号的实时清单，失败回退站点内置清单；只读展示（免费模型标「免费」）。
- WorkBuddy 的用量/登录接口为其客户端使用的接口，非公开 Web API，腾讯随时可能变更或限制；失败一律显示固定中文提示，不回显上游响应正文。

内置协议组件位于 `vendor/workbuddy/`（上游 `@magpie-community/opencode-workbuddy-auth` 0.2.35，MIT），接入层驱动插件的公开 hooks（usage/checkin/浏览器授权/模型目录），不依赖其内部函数。

## 安装与更新

把目录长期保留在 `$DSH_HOME/dsh-go/plugins/` 下，执行：

```sh
dsh plugin --profile web add /path/to/dsh-unified-router
```

新装后会被引擎加载。若替换已加载的宿主代码，应在插件详情里重新载入该插件；客户端界面需重新打开设置页或刷新网页。无需重新构建 APK，无需替代 Web 服务器。卸载用 `dsh plugin --profile web remove dsh-unified-router`，原账号数据保留。

## 来源与许可证

上游：[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)，版本 2.8.0，提交 `999e9f784ea3ea7a11cae383b142697b1ff2c42f`。渠道原始作者 Jet（iJetLi），MIT。根许可证及 `vendor/channel-pack/LICENSE`、`vendor/channel-pack/NOTICE.md` 均保留。WorkBuddy 用量原语来自 `@magpie-community/opencode-workbuddy-auth` 0.2.35（MIT，见 `vendor/workbuddy/NOTICE.md`）。

本地变更：从上游入口提取三个认证服务和适配器；管理模块加入进程内调用、渠道白名单与无网页挂载模式；新增 TRAE 接线（channel-pack 现成实现的浏览器 OAuth + 每日签到 + 余额）、独立商汤 Token Plan 控制器（内置 MIT 协议组件）、WorkBuddy 用量控制器（内置 MIT 协议组件，驱动 `@magpie-community/opencode-workbuddy-auth` 的公开 hooks）、受鉴权的 `/api/unified-router`、公开字段投影与独立 Web 设置客户端（provider 注册表驱动、无核心渠道白名单）；移除 Devin（拆分为独立插件 `dsh-devin-provider`）。入口装配参考已安装的 dsh-subusage 0.21.1。`test/kernel.mjs` 来自上游离线测试工具。

## 改名说明

项目由 `dsh-eac-router` 改名为 `dsh-unified-router`：包名与插件 id、RPC 服务名与 `/api/unified-router` 路由、设置命名空间 `dsh-unified-router`、商汤状态目录与凭据命名空间 `dsh-unified-router-sensenova`、凭据引用 `UNIFIED_ROUTER_*` 全部同步更新。

兼容处理：改名前的凭据引用（`EAC_SENSENOVA_*`）、商汤凭据命名空间（`dsh-eac-router-sensenova` 及其更早的 `-legacy`）和旧状态目录都保留回退读取，新值一律只写入新名字。旧名字下只发生两类写动作，都用于让旧数据退出：一是登录令牌/密码/Key 被采纳到新命名空间后删除旧记录（vendor 迁移约定，各执行一次），二是退出登录、忘记 Key、重设密码时连旧名残留一并清除——否则「退出」之后旧令牌会立刻复活。旧状态目录在新目录不存在时整体搬迁一次；搬迁失败（目标路径被占用、权限不足、跨设备等）时本次继续读写旧目录并留下告警，不会静默丢弃旧状态——这是「新值只写新名字」的唯一例外，下一轮启动会再尝试搬迁。Devin 的旧凭据引用（`EAC_DEVIN_API_KEY`、`UNIFIED_ROUTER_DEVIN_API_KEY`）已随 Devin 移除，不再读写；需要 Devin 时安装独立插件 `dsh-devin-provider`。宿主 profile 里指向旧包名或旧路径的安装条目需要在安装侧同步更新，否则插件不会被加载。

界面样式变量（`--eac-*`）与 DOM 测试钩子沿用既有命名，未随本次改名调整。

## 构建与验证

Node 22.19+；构建需 esbuild 0.25.12、undici 8.11.2，核心包由 DSH 提供。`scripts/build.mjs` 使用 `UNIFIED_ROUTER_BUILD_TOOLS`（兼容旧名 `EAC_BUILD_TOOLS`）指定的工具目录，默认同级 `unified-router-build`；从 `/opt/dsh/node_modules` 解析宿主依赖。产物 `lib/backend.js` 与 Qoder WASM 已提供，安装无需构建。

接入新渠道时复用共用账号、模型和渠道视图，按 provider 模块注册数据与动作。后台快照和前端接口详见 [设计规范](docs/DESIGN-STANDARDS.md#7-provider-设置接口)。

客户端源码位于 `src/client/`，独立后端渠道位于 `src/backend/providers/`。运行 `npm test` 会重新生成 `lib/client.js` 与 `lib/backend.js` 并执行测试。

```sh
node scripts/build.mjs
node --check lib/client.js
npm test
```

测试覆盖 channel-pack 渠道（含 TRAE）注册与限制、模型分组/分页/启停及参数持久化、连续编辑和保存失败、账号与积分操作、取消请求、商汤模型设置与发布、额度窗口和未知状态、WorkBuddy 多账号（登录新增、旧单账号采纳、逐账号快照/签到/退出、续期按账号回写、索引损坏容错）与模型目录、敏感字段投影、来源防护与失败回滚。测试使用临时目录、虚构账号和离线网络桩，不调用真实上游、不读写真实凭据。真实账号授权和厂商服务可用性仍需用户登录后确认。
