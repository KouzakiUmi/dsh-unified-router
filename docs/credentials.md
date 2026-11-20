# 凭据获取指引

这份文档只解决一类问题：**界面显示「待配置 Key」/「待连接」，或者填了却不生效。**

每个渠道给三条路：**去哪里获得凭据**、**在设置页哪里填**、**凭据存在哪（引用名）**。账号池渠道与 API Key 渠道的凭据形态不同，先分清再填。

设置页入口：**设置 → 能力 → Unified Router**。

---

## 先分清两类凭据

| | 账号池 / 自管账号 | API Key |
|---|---|---|
| 用什么 | 浏览器授权后的登录态，插件生成授权地址 | 你在上游平台申请的 Key |
| 怎么拿 | 点「添加账号」→ 点「打开登录页面」→ 浏览器完成授权 | 到平台控制台创建后复制 |
| 谁存 | DSH 凭据服务（按账号一个引用名） | DSH 凭据服务（一个渠道一个引用名） |
| 涉及渠道 | Loomy、Raccoon、Qoder 中国版、TRAE、WorkBuddy | 商汤 Token Plan、Agnes、云知声 |

账号池渠道的登录地址由插件在设置页生成，页面不填写或显示系统密钥。**登录地址按授权流程临时读取**，凭据与上游响应原文均通过投影过滤，不进入账号或额度快照。

## 凭据存在哪

- 所有渠道的凭据都经宿主 `credentials` 服务存取，**只保存引用名，不保存值**；Key 不进入任何返回值、日志与错误文案。
- 账号与额度、状态的最近一次结果以公开字段投影写入 profile 状态目录的 `dsh-unified-router/settings.json`，不含凭据值。
- 商汤渠道的状态目录与凭据命名空间为 `dsh-unified-router-sensenova`。

---

## 一、商汤 Token Plan

**去哪里获得凭据**：商汤开放平台的 Token Plan 控制台创建 API Key。目录刷新与模型调用都使用这把 Key（`GET /v1/models`，Bearer 鉴权）。

**在设置页哪里填**：设置 → 能力 → Unified Router → **商汤 Token Plan** 卡片 → 「渠道」分区 → **模型 API Key** 输入框 → 保存。模型提供方开关在同分区，与 Key 分开保存。

**凭据存在哪**：引用名 `UNIFIED_ROUTER_SENSENOVA_API_KEY`。改名前的 `EAC_SENSENOVA_API_KEY` 仅作回退读取，新值只写入 `UNIFIED_ROUTER_SENSENOVA_API_KEY`。

## 二、Agnes

**去哪里获得凭据**：国内站 [api.agnes-ai.cn](https://api.agnes-ai.cn) 申请 API Key。站点是 New API 分支，OpenAI 兼容端点 `POST /v1/chat/completions`，Bearer 鉴权。

**在设置页哪里填**：设置 → 能力 → Unified Router → **Agnes** 卡片 → 「渠道」分区 → **API Key** 输入框 → 保存。保存后点「刷新目录」拉取上游模型列表。

**凭据存在哪**：引用名 `UNIFIED_ROUTER_AGNES_API_KEY`。

**用量从哪来**：设置页「账户用量」读取该站点的 New API 账单接口（`/v1/dashboard/billing/subscription` 与 `/v1/dashboard/billing/usage`）。站点的账户信息接口（`/api/user/self`、`/api/usage/token`）被 Cloudflare 挡（403），不使用，用量从账单接口读取。

## 三、云知声

**去哪里获得凭据**：[maas.unisound.com](https://maas-api.unisound.com) → **按量计费 → API Key 管理**，在该页面查看或创建 API Key。调用端点是 OpenAI 兼容的 `POST /v1/chat/completions`，Bearer 鉴权。

**在设置页哪里填**：设置 → 能力 → Unified Router → **云知声** 卡片 → 「渠道」分区 → **API Key** 输入框 → 保存。保存后点「刷新目录」拉取模型列表。

**凭据存在哪**：引用名 `UNIFIED_ROUTER_UNISOUND_API_KEY`。

**用量**：云知声没有公开余额接口，设置页不显示用量。「渠道」分区只显示 API Key 与模型提供方开关。

## 四、账号池渠道（Loomy、Raccoon、Qoder 中国版、TRAE）

这四个渠道都走 channel-pack 的账号池机制：每个渠道各自一个账号池，登录进入该渠道的池，凭据按账号保存，多账号按顺序轮换。

**去哪里获得凭据**：不需要先准备 Key。点卡片「账号与额度」分区的「添加账号」，插件会生成授权地址，在浏览器完成授权即可。

- **Loomy**：本机 HTTP 扫码 / 短信页，应在同一手机或主机的浏览器打开。
- **Raccoon（小浣熊）**：登录后插件探测套餐并写入账号的套餐标记，免费面与订阅面各自使用本侧账号的凭据拉目录。
- **Qoder 中国版**：HTTPS 授权页。
- **TRAE**：浏览器 OAuth，本机回调，无需粘贴。

**在设置页哪里填**：设置 → 能力 → Unified Router → 对应卡片 → 「账号与额度」→ **添加账号** → **打开登录页面** → 浏览器完成授权 → 点 **检查登录**，列表自动刷新。账号行的「刷新凭据」用于续期，「移除账号」需二次确认。

**凭据存在哪**：DSH 凭据服务，引用名按账号生成，形状为 `{渠道前缀}_ACCOUNT_{6 位十六进制}`：

| 渠道 | 凭据引用名前缀 |
|---|---|
| Loomy | `LOOMY_ACCOUNT_` |
| Raccoon / Raccoon 订阅版 | `RACCOON_ACCOUNT_` / `RACCOONPRO_ACCOUNT_` |
| Qoder 中国版 | `QODERCN_ACCOUNT_` |
| TRAE | `TRAE_ACCOUNT_` |

凭据续期由插件在设置页触发，续期只回写该账号自己的引用名，不串号。

## 五、WorkBuddy（自管多账号，不走账号池）

**去哪里获得凭据**：不需要先准备 Key。点「添加账号」后，主机向 WorkBuddy 申请登录页地址并持续轮询授权结果（最长约 5 分钟），登录地址显示在面板上，在浏览器完成官方授权后自动继续。

**在设置页哪里填**：设置 → 能力 → Unified Router → **WorkBuddy** 卡片 → 「账号与额度」→ **添加账号**。每个账号一行，签到与退出登录都按账号操作。

**凭据存在哪**：

- 账号索引：引用名 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS`，存账号列表（每项含 id、凭据引用名、名称、uid 与创建时间）。
- 每个账号的凭据：引用名 `UNIFIED_ROUTER_WORKBUDDY_ACCOUNT_<6 位大写十六进制>`，一个账号一个引用名。
- 账号上限 8 个。旧单账号引用 `UNIFIED_ROUTER_WORKBUDDY_AUTH` 在索引缺失或为空时被采纳为第一个账号，随后清除。

登录得到的令牌经 DSH 凭据服务保存，临期自动续期并只回写触发续期的那个账号。「退出登录」删除该账号的凭据与索引条目，其他账号不受影响。

## 常见现象对照

| 界面提示 / 现象 | 处理 |
|---|---|
| 「待配置 Key」 | 该渠道还没有 Key。按上面对应小节到上游平台申请，再在「渠道」分区填入并保存。 |
| 「待连接」 | 账号池渠道还没有登录账号。点「添加账号」，用浏览器完成授权后点「检查登录」。 |
| 填了 Key，模型仍是兜底目录 | 「模型」分区点「刷新目录」重新拉取上游目录；目录来源在分组标题旁标注。 |
| Qoder 中国版目录停在兜底 | 本机官方 CLI 尚未登录或未安装。在终端运行一次 `qoderclicn login`，再在「模型」分区点「刷新目录」。 |
| 凭据过期标记 | 账号池渠道的账号行显示「凭据过期」。点该行的「刷新凭据」续期。 |
| 删除某家凭据 | API Key 渠道重新填写并保存即覆盖原值；账号池渠道用账号行的「移除账号」，WorkBuddy 用账号行的「退出登录」（均需二次确认）。卸载插件不自动删除已保存的凭据。 |
