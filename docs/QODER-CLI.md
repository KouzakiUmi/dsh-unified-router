# Qoder CN：官方 CLI 取目录可行性与集成方案

2026-11-19 本机官方 CLI 的 `--list-models` 返回 14 条，已按实际名单更新内置目录。已知展示名继续对应原调用 ID。本次新增的 Qwen4 Max、Qwen4 Max Preview 和 Step 5 Preview 只有展示名，CLI 富字段接口要求独立登录，当前保留展示名与已确认的元数据。成功刷新会保存目录，下一次启动和刷新失败时沿用上次成功结果。

> 2026-11-17 只读勘察（qoder-feasibility 子代理）。方向由用户拍板：**直接用官方 CLI 登录/拉取，不重实现签名、不造轮子**。
> 全程未运行 CLI、未发请求、未碰凭据原文；探针 P1–P5 已设计待放行。

## 结论速览

- **本机无独立 Qoder CLI**（PATH/npm 全局/`~/.qoder-cn/bin` 均无 `qoderclicn`）。唯一官方 CLI 本体是 IDE 附带的 worker runtime 单文件：
  `C:\Program Files\Qoder CN\resources\app.asar.unpacked\node_modules\@qoder-ai\qoder-cn-agent-sdk\dist\_worker\qoder-worker-runtime.obf.mjs`（35MB，v1.1.86-hotfix.5.2，`runtime-info.json` productName=qoderclicn）。**必须用 node 执行**（无 shebang、非 exe）。
- **有拉目录命令**：顶层 `--list-models`（`List available models for the current user`）。输出是**纯文本表**（首行 `MODEL`，每行 `显示名` 或 `显示名 (key)`），`--output-format` 对它无效。
- **富目录走 `--sdk`**：hideHelp 的 private stdio JSON-RPC 守护进程，`daemon.get_models({fetchStrategy:'live'|'cache'|'auto'})` 返回完整字段（priceFactor/originalPriceFactor/maxInputTokens/maxOutputTokens/efforts/defaultEffort/isVl/isReasoning/supportsDisabled/availableContextWindows/defaultContextWindow/tags…）。无文档、随版本变。
- **不能复用 IDE 登录态**：本机 `~/.qoder-cn/state.json` = `{lastLoginMethod:"job_token"}`——IDE 每次把短期 job token 现场喂给守护进程，CLI 自己不持有凭据（`.auth/` 只有 machine_id + 空锁）。CLI 持久登录是另一套存储（`qoderclicn-login` / PAT），不读 IDE 的 `auth.v1.dat`。**必须用户做一次官方 `login`**（浏览器/设备码），此后 `--list-models`/`--sdk` 免登录复用。

## 集成方案（推荐排序）

### P0 — `--list-models` 文本 → 与策展表合并（首选）
```
node "<runtime>.obf.mjs" --list-models
```
（若用户另装官方 CLI，PATH 命中 `qoderclicn` 时优先用它。）超时 20–30s。
- 解析：跳过首行 `MODEL`；正则 `^(?<name>.+?)(?: \((?<key>[^()]+)\))?$`；**有括号后缀时 key 才是目录 id**（qmodel_38max/dfmodel 等），无后缀时显示名当 id；排除 `Warning: no models available…`。
- 接法：`QoderAdapter.refreshRemoteModels()`（qoder-adapter.ts:647）改为 spawn → id 集合以 CLI 为准、属性以 `QODER_CN_FALLBACK_MODELS` 策展表为准；表外新 id 用最小元数据 `{id,name}`（不编造 ctx/efforts，沿用「未知模型不编造 context」口径）。`listAllModels/listModels` 读合并结果。
- 降级链（全静默、不泄上游原文）：CLI 不存在/spawn 失败→fallback；exit 1 且 stderr 含 `Not logged in`/`No qodercli login found`→fallback + 设置页可操作提示「请在终端运行一次官方 CLI 登录」；超时/空表/解析 0 条→fallback。与现有 modelSource 三态对齐。

### P1 — `--sdk` + `daemon.get_models`（富 JSON，P0 跑通后再做）
收益：倍率/档位/ctx 全有，可替换手工策展表。成本：自写 ~百行 stdio JSON-RPC 客户端（initialize 握手 + get_models + shutdown，WIRE_PROTOCOL_VERSION 1.5.0）。风险：private protocol 无兼容承诺。

### P2 — `fetchStrategy:"cache"` 零网络读缓存（兜底思路）
不校验登录，只读 `~/.qoder-cn/.models` 缓存；但仍需 --sdk 协议，且 job_token 场景缓存身份是否有值未验证。

## 明确不做
不重实现 COSY 签名；不解密 catalog-v7；不读 auth.v1.dat / Windows 凭据库内容；不让插件代跑 login（交互式 TTY + 凭据写入）。

## 风险
- **账号/ToS**：复用本机已装官方组件读自己账号，相对干净（不提取密钥/不绕授权），但批量/非 IDE 调用仍可能触及条款。**建议默认关闭、设置页显式开启 + README 风险声明**（对齐 dsh-connect-workbuddy 口吻）。
- **稳定性**：依赖 app.asar.unpacked 内 35MB 混淆单文件，路径含空格、随 IDE 升级替换；flag/文本格式可能变 → 失败即回落 + 日志记 runtime 版本。
- **凭据机器绑定**：换机/换用户需重登。
- **并发**：`.auth/.credential-transaction` 锁，与 IDE 并发可能撞「Another Qoder CLI process is updating your saved login」→ 刷新串行单飞。
- **宿主沙箱**：插件后端能否 spawn node 执行该目录脚本，落地前需核宿主约定（未查）。

## 待放行探针（未执行）
| # | 命令 | 预期 | 副作用 |
|---|---|---|---|
| P1 | `cmdkey /list` 过滤 qoder | 若已有 qoderclicn-login 目标→无需重登 | 只读，仅暴露目标名 |
| P2 | `node "<runtime>" --version` | 版本串 exit 0 | 可能写 logs/刷新 umid-cache/**可能联网**（installTelemetry） |
| P3 | `node "<runtime>" --help` | 列 --list-models/--sdk/login | 同 P2 |
| P4 | `node "<runtime>" --list-models` | 预期 stderr `Not logged in…` exit 1（本机 job_token） | 同 P2 + 可能出网刷新；不改凭据 |
| P5 | 用户手动 `login` 后重跑 P4 | `MODEL\n…` 表 exit 0 | 写 CLI 登录态（需用户放行） |

## 未覆盖
CLI 探针全未跑；Windows 凭据库是否已有 qoderclicn-login 未验；--list-models 是否联网未确证；--sdk 逐帧格式未还原；官方独立安装包命令面未核；宿主 spawn 策略未查。
