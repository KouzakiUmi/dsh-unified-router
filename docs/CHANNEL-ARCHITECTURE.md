# 渠道接入架构：声明式规格 + 统一契约 + 持久化中间层

> 本文是**渠道接线层**的唯一规则来源。渠道实现（认证、目录、选号）分别见
> [providers.md](providers.md)、[MANAGED-CHANNELS.md](MANAGED-CHANNELS.md)、[APIKEY-CHANNELS.md](APIKEY-CHANNELS.md)。
> 界面规则见 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)。
>
> 范式参考：`dsh-subusage`（统一 wire 契约、声明式 recipe、条目暂存层、拉取与显示分离、
> 两端方法清单对齐）。本文只写**已经落地**的结构；尚未做的目标集中在 §5，不混进主干描述。

## 0. 为什么重构

2026-11-25 体检结论：**渠道「实现」是模块化的，「接入」不是**。

| 症状 | 证据 |
|---|---|
| 接线层集中分派 | `vendor/.../channel-pack-rpc.ts` 4246 行 / 54 个 `case`；加渠道必须改这个文件 |
| 位置形参 API | `registerChannelPackRpc` 12 个位置形参，源码自认「错位复发 6 次」 |
| 单渠道能力泄漏 | Loomy 路由检测散布 6 个共享模块（~150 行在 `core.js`）；`permanentLock` 写进 `AccountPool` 状态模型 |
| 写后更新 if 链 | `updateSettingsSnapshots()` 按 method 逐个手工分支 |
| 两端清单各写一遍 | 宿主 `lib/rpc.js` 的方法集与客户端 `core.js` 再抄一遍 |
| 清单分散 | 渠道 id 出现在多处集中清单，同步靠人记 |

根因：首个提交（三渠道）就是「一渠道一段」，之后 11 次提交全是加渠道。
`docs/ARCHITECTURE-REVIEW.md`（2026-11-18）只覆盖了客户端 UI 组合层。

## 1. 三条规则

1. **清单只有一份**：渠道、方法、能力位、退役状态都写在 `lib/channel-specs.js`（纯数据，
   宿主与客户端同一份），其它文件一律派生，不手写第二份。
2. **行形状只有一份**：账号行 / 模型行的字段、上限、白名单只写在 `lib/channel-contract.js`，
   宿主投影与客户端收编共用同一实现。
3. **读拉分离**：客户端首屏只读宿主持久化快照（零上游请求）；上游拉取只由显式刷新、
   写后失效与宿主定时采集驱动。

## 2. 实际分层

```
lib/
  channel-specs.js      ← 渠道清单 + 方法集（纯数据/纯函数，客户端拼进 lib/client.js）
  channel-contract.js   ← 账号行 / 模型行的唯一 wire 形状 + wireJson 深度净化
  rpc.js                ← 从规格派生 PROVIDERS / 方法集 / ALL_PROVIDER_IDS + guardedRpc 门禁
  settings-snapshots.js ← 持久化中间层（分钟级采集、原子写、游标增量、stale 标记）
  settings-providers.js ← 资源声明 + 写后失效 + 公开状态投影
  retired-channels.js   ← 退役渠道的磁盘清扫（独立模式启动时跑一次）
  web-host.js           ← DSH 装配 + publicResult 出口（过 wireJson）
src/backend/
  pack-bridge.ts        ← vendor channel-pack 位置形参的唯一映射点
  providers/*.ts        ← raccoon / qodercn / trae 的后端挂载
src/client/
  core.js               ← 方法集由 clientMethodSets() 派生；wire 收编走 channel-contract
  store/index.js        ← 首屏只读快照（snapshotReads）
  providers/*.js        ← 只声明元数据与视图描述（不含渠道 if 分支）
```

### 2.1 规格表（`lib/channel-specs.js`）

渠道规格字段（实际、全部可选字段都按需出现）：

| 字段 | 含义 |
|---|---|
| `id` / `title` | provider id 与标题 |
| `kind` | `pack` / `managed` / `apikey` / `plan` / `workbuddy`，决定共用哪组方法 |
| `card` | 是否作为设置页卡片；`false` 表示只是某张卡的模型面 |
| `registered` | `false` = 停用：RPC 白名单、快照、签到、客户端卡片都不装配 |
| `claim` | 是否参与签到/领取调度（同一账号池只允许一个代表 id） |
| `accountPool` | 是否有独立账号池（`false` = 复用家族池） |
| `packSlot` | 账号池渠道在 vendor `registerChannelPackRpc` 里的形参名（合法值见 `lib/pack-slots.js`；加载期校验） |
| `family` | 同一卡片下的多个模型面 |
| `capabilities` | 能力声明（`accounts` / `models` / `quota` / `checkin` / `onboarding` / 月卡标签 / 统一模型…） |
| `methods.extra` | 该渠道专属方法（如 `raccoon.checkin`），归属由声明它的渠道决定 |

同文件导出的其它事实源：

- `KIND_METHODS`：每个 `kind` 的 `read` / `write` 方法集 —— **单渠道专属端点不放这里**，
  否则同类别新增渠道会被迫声明自己不需要的端点。
- `GLOBAL_METHODS`：与渠道无关的全局方法（`settings.*` / `automation.*`）。
- `HOST_INTERNAL_METHODS`：只给宿主的端点（签到/奖励的只读核实、`raccoon.checkin`），
  客户端白名单因此比宿主窄一档。
- `clientMethodSets()`：客户端各分类集合，`core.js` 直接调用。
- `RETIRED_CHANNEL_IDS`：退役渠道，交给 `retired-channels.js` 清扫。
- `allChannelMethods()` / `methodsOfKind()` / `readMethodsOf()` / `writeMethodsOf()` / `channelSpec()`。
- `INVALIDATE_RULES` / `invalidationRule()`：**写后失效**规则（方法 → 要重采集的资源）。
  写成表而不是 `if (method.startsWith(...))`，是为了让「新增写方法却忘了刷新界面」变成
  可被用例发现的缺口，而不是静默不刷新。

### 2.2 行契约（`lib/channel-contract.js`）

```js
accountWire(raw)      // 宿主的公开 wire 形状：白名单字段、缺席不写属性
accountView(wire, id) // 客户端视图形状：补 UI 缺省值（昵称兜底、过期限流过滤）
modelWire(raw)        // 同上（能力字段缺席即未知；倍率不合法则整条不出现）
modelView(wire, id)   // 同上（产出 `provider:modelId` 组合键）
viewRate / wireRate   // 倍率徽标白名单（免费 / xN），未知形态不挂标
wireJson(value)       // 深度净化：丢弃 undefined / NaN / ±Infinity，-0 归零
```

规则：
- **wire 层字段缺席就不写属性**。宿主 typert 逐值校验返回值，嵌套的 `undefined` 会让
  整条 RPC 作废；`...(cond ? { x: f() } : {})` 在 `f()` 返回 `undefined` 时会写出该键，
  这是最容易踩的写法。
- **出口统一过 `wireJson()`**：`publicResult()` 内层只做逐 method 白名单挑选，出门净化。
- 客户端**不得**按渠道 id 分支；差异只能来自契约字段与行数据。

## 3. 持久化中间层与只读快照

**宿主侧**（`settings-snapshots.js` + `settings-providers.js`）：
按分钟采集每个资源（`<provider>/<method>` 键），原子写 `settings.json`，保留 `at` 与
`stale`；写操作后由 `updateSettingsSnapshots()` 先打乐观补丁再触发重采。

**客户端侧**（`store/index.js` 的 `snapshotReads`）：
`provider.status` / `account.list` / `model.list` / `model.params` / `credits.balances`
与快照型渠道（商汤 / WorkBuddy / API Key / 自管）的方法一律带 `snapshot: true` 读快照，
**不打上游**。仅当宿主从未采集过（`snapshot.at === null`）才回落实时读取，并按渠道去重地
发一次 `settings.refresh` 请宿主补采。读取水位记**数据新鲜度**（快照的 `at`）而不是读取
时刻 —— 记成 now 会把宿主下一轮采集判成陈旧而丢掉。显式刷新（`live: true`）与写后重读
仍走实时路径。

**共用模式**下 RPC 经 `sharedTransport` 转发给原 channel-pack 插件，它不认 `snapshot: true`，
返回值里就没有 `snapshot.at`。客户端把这种返回当**实时数据**直接用：不回退重读、不反过来请
宿主补采、也不判读取失败（回归 `test/web-client.test.mjs` 的共用模式用例）。

## 4. 接入 / 移除一个渠道

**接入**：`channel-specs.js` 加规格 → `src/backend/providers/` 加挂载（或复用现有类别）→
`src/client/providers/` 加视图声明 + 登记 `scripts/build.mjs` 的 `clientModules` →
`settings-providers.js` 加资源声明 → 若引入新方法，更新 `KIND_METHODS` 并跑
`test/channel-method-parity.test.mjs`。

**移除**：删实现 + 从 `CHANNEL_SPECS` 删规格 + **往 `RETIRED_CHANNEL_IDS` 追加一行**
（独立模式启动时会清扫它的账号、黑名单、目录缓存与账本目录）。

## 5. 验收状态与仍未做

| 期 | 内容 | 状态 |
|---|---|---|
| P1 | 规格表 + 契约层 | ✅ `channel-specs.js`（清单 + `clientMethodSets()`）+ `channel-contract.js`（行形状 + `wireJson`） |
| P2 | RPC 门禁规格驱动 | ✅ `guardedRpc` 按「方法类别 + `methods.extra` 归属」判定 |
| P3 | 客户端只读快照 | ✅ 见 §3；回归 `test/web-client.test.mjs` 的两条快照用例 |
| P4 | 移除 Loomy | ✅ 实现/RPC/UI/数据清理；回归 `test/retired-channels.test.mjs` + `test/cleanup-loomy.test.mjs` |
| P5 | 位置形参收敛单点 | ✅ `src/backend/pack-bridge.ts`（实测拦下一次错位事故） |
| P6 | 文档与账本 | ✅ AGENTS.md / README / docs 同步 |

**第三轮补充（2026-11-25 同日）**：

| 项 | 结果 |
|---|---|
| 客户端方法集 | ✅ 改为 `clientMethodSets()` 派生，白名单按 `HOST_INTERNAL_METHODS` 收窄；回归 `test/channel-method-parity.test.mjs` |
| 行形状出口 | ✅ `modelWire` 不再产出 `rate: undefined`；`publicResult()` 出口接上 `wireJson()` 深度净化；回归 `test/channel-contract.test.mjs` |
| 写后失效 | ✅ 规则表 `INVALIDATE_RULES` 驱动（账号 / 模型 / 额度 / 登录 / 领取五类），`updateSettingsSnapshots` 只保留乐观补丁；回归断言「每个写方法都有失效归属」 |
| 账号池挂载 | ✅ 注册表 `src/backend/providers/pack-registry.ts` 从规格表派生；缺实现 / 缺 `packSlot` / 形参位重复 / 多登记实现一律在**加载期**抛错；形参顺序抽到 `lib/pack-slots.js` 供用例共用 |

**第二轮：vendor 整体裁剪（2026-11-25，用户决策「全部重写，不管上游」）**

原计划的「不裁剪、避免与上游分叉」被明确推翻 —— 本插件就是重写，vendor 只是原材料。
执行口径：用 esbuild `metafile` 的输入清单判定**可达性**（进入产物 = 可达），删掉不可达文件，
再把两个中心分派文件（`channel-pack-rpc.ts` / `account-probe.ts`）里对应渠道的分支、位置形参、
`REF_PREFIX_TO_PROVIDER` 条目与专属子系统（captcha 载体、opencode 身份槽）一并拆除。

| 项 | 结果 |
|---|---|
| 删除的国际渠道 | `lobsterai` / `cline` / `zcode` / `minimax` / `gemini` / `opencode` |
| vendor 源文件 | 137 → **59** 个 `.ts` |
| `lib/backend.js` | 2.08 MB → **0.65 MB**（−69%） |
| vendor 位置形参 | 9 → **4**：`qoder` / `qoderCn` / `trae` / `raccoon` |
| 凭据前缀表 | 12 → **5** 条（qoder / qodercn / trae / raccoon / raccoon-pro） |
| 连带移除 | `captcha-*`（载体与供给槽）、`opencode-*` 身份槽、`cline.quota` / `cline.requestLog` 两个端点、`isAutoCheckinExcluded` 的渠道判定 |

**这次裁剪踩到的两个真坑**（都写进了回归/纪律）：

1. **位置形参与 `VENDOR_SLOT_ORDER` 必须同步**。删完 `minimax` 形参却忘了收缩 slot 表，
   `modelAdapters` 就被顶到 `zcode` 的位置上 —— `test/backend.test.mjs` 当场报
   「native-only must not mount HTTP RPC」。这正是 `pack-bridge` 存在的意义。
2. **删分支会连带删掉同文件里的装配块**。删 Cline 时把紧随其后的 `usageBadge` 装配一起删了，
   而 `usage.badge` 端点仍在调 `usageBadge.read(...)` —— esbuild 不报错（当作全局）、
   414 条用例也不覆盖该端点，只有静态核验 / 人工复核才发现。教训：**删完一个渠道后，要 grep 它前后
   定义的每个局部符号是否仍被引用**（`enrichAccountIdentity`、`buildZcodeBalance`、
   `carrierCaptchaConfig`、`captchaDemand` 都要这样核一遍）。

3. **靠人工 grep 不够，已固化成脚本**。`npm run check:residue`（`scripts/check-vendor-residue.mjs`）
   把 git HEAD 与当前源码的模块级声明做差，找出「已删除、当前无定义、仍被引用」的名字。
   它后来又抓出两处同类残留：`account-probe.ts` 的 `ProbeCredential` 联合里仍列着 4 个已删凭据类型
   （**类型无效但 esbuild 完全不报**），以及 `queue-rotation.ts` 里调用已删 `pickSlot` 的身份槽死分支
   （运行时 ReferenceError）。**以后任何裁剪都先跑它。**
**仍未做（纯组织性，不影响产物与功能）**：`vendor/channel-pack/src/channel-pack-rpc.ts` 仍是单文件，
约 2600 行、42 个 `case`。按渠道/子域拆成 `rpc/<domain>.ts` 需要在每个 handler 之间传一份 deps 闭包
（ctx / pool / config / 家族判定 / 各 auth 实例），属于可做、但收益仅是**可读性**的重构。
本文档的口径是「先保证行为与产物正确，再谈文件切分」，因此排在裁剪与静态核验之后。

## 6. 明确不做

- 不搬 vendor 里的渠道实现（认证/适配器由 vendored MIT 源码提供）。
- 不改 vendored 的函数签名（避免与上游分叉失控）；缺陷用防腐层隔离。
- 不做发布、不动已安装插件（属于安装/部署步骤，另行确认）。