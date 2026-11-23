# 自管多账号渠道契约与实测边界

> 覆盖 AStudio 与 CodeArts（华为云码道），共用 `lib/managed-channel.js` / `lib/managed-models.js` / `lib/managed-llm.js` 与 `src/client/providers/managed.js`。

## 1. 四层模块化结构

| 层 | 文件 | 职责 |
|---|---|---|
| 渠道规格 | `lib/managed-providers/*.js` + `index.js` | 认证（本机导入/浏览器/粘贴凭据）、目录、额度、签到、奖励/任务与推理传输 |
| 管理器 | `lib/managed-channel.js` | 多账号索引（上限 8）、独立凭据隔离、软失败保护、目录缓存、适配器注册 |
| 模型设置 | `lib/managed-models.js` | 模型开关、参数与合法 `compat` 字段落盘（原子写 + 串行队列） |
| 推理适配器 | `lib/managed-llm.js` | 统一装配 `openai-completions` / `openai-responses` / `anthropic-messages` |

客户端新增同类渠道只需在 `src/client/providers/<id>.js` 调用 `managedChannel({ id, title, authMethods, checkin, claimRewards, completeTasks })` 并登记注册表与 `scripts/build.mjs`。

## 2. 渠道的实测事实与边界

| 渠道 | 登录方式 | 模型目录与推理 | 额度与自动化 | 已知限制 |
|---|---|---|---|---|
| **AStudio** (`astudio`) | 本机导入（读取 `astron-session.json` / `config.toml`）、微信扫码 SSO、粘贴 JWT/JSON | 目录 `GET .../api/v1/model-manager/models`（自动补位 `xdeepseek-flash-in`）；推理走 `POST .../model-gateway/v1/responses`（`store:false`，关闭思考发 `reasoning.effort:"none"`） | 余额 `points/balance` + `membership/me`；每日签到（先查北京时间 `points/details` GRANT 流水零写判重，无则 `init-app` + 关闭 `DAILY_REWARD_DIALOG`）；`claimRewards` 领取新人弹窗 | 仅粘贴 `modelBearerToken` 时无网页会话 Cookie，不查询积分与签到 |
| **CodeArts** (`codearts`) | 本机导入（Windows 同用户 DPAPI + AES-256-GCM 解密 `%APPDATA%\codearts\secretStorage`，兼容 JSON 字符串形态的 DPoP JWK；导入与推理按账号单飞自动刷新）、浏览器 OAuth（PKCE 128-hex + ES256 DPoP，`127.0.0.1:>=10000/oauth/callback`，同时兼容 `code` 与 `secret` ticket 回调）、粘贴 JSON 凭据 | `GET /v1/model/builtin` + 免费权益 `opengw.../gateway/config`（`SDK-HMAC-SHA256` 签名）；推理走 `/api/v2/chat/completions`（输出上限按 v2 `RANGE_VALIDATOR` 夹取 `65536`、合并相邻同角色消息、免费模型带 `maas_type:benefit`，遇 `APIG.0602` 令牌过期自动刷新重签重试一次） | `snap-manager/v1/statistics/plugin` + 免费日池 `user/tokens/balance`；每日签到（`events/trigger user.login` + `ops/delivery?channel=DESKTOP` + `claim` + `confirm`）；`claimRewards` 领取可领活动福利 | `refresh_token` 为一次性轮换，与本机桌面端共用同一会话刷新会导致对端需要重新登录；本机导入账号在刷新失败或缺失 DPoP 密钥时回退重读本机 `secretStorage` 自愈 |

### 推理响应兼容

- CodeArts 推理使用 `/api/v2/chat/completions`。`openpangu-2.0-flash` 在旧 v1 路径出现无正文的结束帧；同账号的 v2 请求返回标准 OpenAI 正文和用量帧。旧版累计 `text`、顶层 `delta.content` 和完整 `choices[].message` 仍转为增量，去除重复快照；已返回工具调用时将 `stop`、`other` 或仅有 `[DONE]` 的收尾归一为 `tool_calls`。裸断流不补成功终止，业务错误返回固定摘要。
- CodeArts 可调思考档来自 `/v1/model/thinking-variants`，不从模型名或 `think_level` 推断。盘古 2.0 Flash 和 2.1 Pro 未提供档位，GLM-5.3 Flash 与 DeepSeek-V4.1-Flash-1017 提供 `low/high/max`。推理传入所选 `reasoning_effort`。
- CodeArts 推理和心跳使用同一个 `user-session-id`，同一账号、同一会话的并行流共用心跳；最后一条流完成或取消后发 `idle`。释放使用独立超时，不受已取消的回复流信号影响。

## 3. 自动化开关与 Host/Client 解耦

- 宿主持久化 `<stateDir>/automation.json`（`lib/automation-settings.js`），管理全局与分渠道的 `autoCheckin`（默认开）、`autoClaimRewards`（默认开）、`autoCompleteTasks`（默认关）。
- `lib/daily-checkin.js` 与 `lib/auto-tasks.js` 实时读取有效开关；设置页渠道分区按渠道实际支持的能力渲染可交互开关与立即执行入口。
- 客户端状态机拆分为 `src/client/store/{pending,cache,sync,index}.js`：Host 统一负责采集/缓存/调度，Client 经增量游标消费快照，写操作按域使用局部非阻塞 `pending` 锁。
