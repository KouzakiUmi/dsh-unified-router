# 自管多账号渠道契约与实测边界

> 覆盖 AStudio、豆包工作（DoubaoWork）、Coze 桌面端与 CodeArts（华为云码道），共用 `lib/managed-channel.js` / `lib/managed-models.js` / `lib/managed-llm.js` 与 `src/client/providers/managed.js`。

## 1. 四层模块化结构

| 层 | 文件 | 职责 |
|---|---|---|
| 渠道规格 | `lib/managed-providers/*.js` + `index.js` | 认证（本机导入/浏览器/粘贴凭据）、目录、额度、签到、奖励/任务与推理传输 |
| 管理器 | `lib/managed-channel.js` | 多账号索引（上限 8）、独立凭据隔离、软失败保护、目录缓存、适配器注册 |
| 模型设置 | `lib/managed-models.js` | 模型开关、参数与合法 `compat` 字段落盘（原子写 + 串行队列） |
| 推理适配器 | `lib/managed-llm.js` | 统一装配 `openai-completions` / `openai-responses` / `anthropic-messages` 及自定义流式协议 |

客户端新增同类渠道只需在 `src/client/providers/<id>.js` 调用 `managedChannel({ id, title, authMethods, checkin, claimRewards, completeTasks })` 并登记注册表与 `scripts/build.mjs`。

## 2. 四个渠道的实测事实与边界

| 渠道 | 登录方式 | 模型目录与推理 | 额度与自动化 | 已知限制 |
|---|---|---|---|---|
| **AStudio** (`astudio`) | 本机导入（读取 `astron-session.json` / `config.toml`）、微信扫码 SSO、粘贴 JWT/JSON | 目录 `GET .../api/v1/model-manager/models`（自动补位 `xdeepseek-flash-in`）；推理走 `POST .../model-gateway/v1/responses`（`store:false`，关闭思考发 `reasoning.effort:"none"`） | 余额 `points/balance` + `membership/me`；每日签到（先查北京时间 `points/details` GRANT 流水零写判重，无则 `init-app` + 关闭 `DAILY_REWARD_DIALOG`）；`claimRewards` 领取新人弹窗 | 仅粘贴 `modelBearerToken` 时无网页会话 Cookie，不查询积分与签到 |
| **豆包工作** (`doubaowork`) | 扫码登录（`/passport/web/get_qrcode/` + `check_qrconnect/`）、粘贴 Cookie（含 `sessionid` / `sessionid_ss`） | `/chat` SSR `modeSelectData`（双路径兼容 `mode.model_list` 与 `menuConfV2.model_list`）+ 兜底并集；推理走 `POST /chat/completion` 自定义 SSE 补丁流（block 10000 正文 / 10040 思考） | `subscription/quota/summary/` + `overview/` + 只读 `ug/campaign/v3/detail/`；展示待完成、进行中、待领取和已领取的任务计数；完成与领取在豆包工作中操作 | 纯 HTTP 不支持图片上传（`/alice/resource/prepare_upload` 需远端 `a_bogus`）；纯 HTTP 签到触发 `710010702` 且消耗当日额度，只做只读展示；桌面端运行中 Cookies 文件独占锁 |
| **Coze** (`coze`) | 在 Coze 桌面端发起登录，可选择火山账号；完成后本机导入（读取 `~/.coze/desktop/runtime.json` 的 `cztei_` PAT 及 `~/.coze/agents/*/config.json` 的 `modelToken`，自动同步桌面端 9 分钟续期）、粘贴 PAT/modelToken | 目录 `POST /api/coze_claw/resource/get_model_list`（16 条实测模型，含真实倍率与能力标签）；配对 `coze-bridge` 取得 `modelToken` 后直连 `https://llm-gateway.coze.cn/v1/chat/completions` | 余额 `GET /api/marketplace/trade/credit/balance`（25:1 归一化积分）；`claimRewards` 领取 `/api/achievement/claim` 成就奖励 | 上游目录不下发上下文与输出上限，留空不编造；未配对 `coze-bridge` 取得 `modelToken` 时仅提供目录与额度查询；无独立签到端点 |
| **CodeArts** (`codearts`) | 本机导入（Windows 同用户 DPAPI + AES-256-GCM 解密 `%APPDATA%\codearts\secretStorage`）、浏览器 OAuth（PKCE S256 + ES256 DPoP，`127.0.0.1:>=10000/oauth/callback`）、粘贴 JSON 凭据 | `GET /v1/model/builtin` + 免费权益 `opengw.../gateway/config`（`SDK-HMAC-SHA256` 签名）；推理走 `/api/v1/chat/completions`（输出上限夹取 32000、合并相邻同角色消息、免费模型带 `maas_type:benefit`） | `snap-manager/v1/statistics/plugin` + 免费日池 `user/tokens/balance`；每日签到（`events/trigger user.login` + `ops/delivery?channel=DESKTOP` + `claim` + `confirm`）；`claimRewards` 领取可领活动福利 | `refresh_token` 为一次性轮换，与本机桌面端共用同一会话刷新会导致对端需要重新登录 |

## 3. 自动化开关与 Host/Client 解耦

- 宿主持久化 `<stateDir>/automation.json`（`lib/automation-settings.js`），管理全局与分渠道的 `autoCheckin`（默认开）、`autoClaimRewards`（默认开）、`autoCompleteTasks`（默认关）。
- `lib/daily-checkin.js` 与 `lib/auto-tasks.js` 实时读取有效开关；设置页渠道分区按渠道实际支持的能力渲染可交互开关与立即执行入口。
- 客户端状态机拆分为 `src/client/store/{pending,cache,sync,index}.js`：Host 统一负责采集/缓存/调度，Client 经增量游标消费快照，写操作按域使用局部非阻塞 `pending` 锁。
