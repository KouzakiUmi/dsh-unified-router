<div align="center">

# Unified Router

**八个国内渠道的模型、账号与额度，收在同一个设置页里。**

[![license](https://img.shields.io/badge/license-MIT-64748b)](#来源与许可证)
[![DSH Core](https://img.shields.io/badge/DSH_Core-0.2.x-64748b)](#兼容性)
[![node](https://img.shields.io/badge/node-%3E%3D22.19-64748b)](#兼容性)

[快速开始](#快速开始) · [支持清单](#支持清单) · [安装](#安装) · [配置](#配置) · [文档](#文档)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/KouzakiUmi/dsh-unified-router/main/assets/preview/overview-dark.png">
  <img src="https://raw.githubusercontent.com/KouzakiUmi/dsh-unified-router/main/assets/preview/overview-light.png" width="560" alt="Unified Router 设置页：八个渠道卡片与 Agnes 的模型目录">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/KouzakiUmi/dsh-unified-router/main/assets/preview/channel-dark.png">
  <img src="https://raw.githubusercontent.com/KouzakiUmi/dsh-unified-router/main/assets/preview/channel-light.png" width="560" alt="Agnes 渠道分区：模型提供方开关、API Key 与账户用量">
</picture>

<sub>真实组件 · 虚构数据 · 离线渲染，由 <code>scripts/render-preview.mjs</code> 生成</sub>

</div>

> **0.4.0**：在 Loomy、Raccoon、Qoder 中国版、TRAE、商汤 Token Plan、WorkBuddy 六个渠道之外，新增 **Agnes** 与 **云知声**两个 API Key 渠道。两者共用同一套 Key 管理、模型目录与模型参数设置，与账号池渠道共用同一套设置页骨架。

## 快速开始

```console
dsh plugin --profile <profile> add <路径>
```

`<profile>` 是目标 Profile，请替换为实际值。**Desktop 使用桌面壳自带的 DSH Desktop CLI**，不要从独立公共 CLI 管理保留的 `desktop` Profile。

1. **重载插件**：让 Host 与 Client 一起生效。只刷新页面不保证宿主侧代码已升级。
2. **打开设置页**：进入 **设置 → 能力 → Unified Router**，在渠道卡片网格里选择要配置的渠道。
3. **账号池渠道**（Loomy、Raccoon、Qoder 中国版、TRAE）：点「添加账号」准备授权地址，再点「打开登录页面」链接，在浏览器完成授权后回到设置页点「检查登录」，列表自动刷新，不需要再手动刷新。[凭据怎么拿](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/credentials.md)
4. **API Key 渠道**（商汤 Token Plan、Agnes、云知声）：进入该渠道的「渠道」分区，在 API Key 输入框填入 Key 并保存。Agnes 与云知声在保存 Key 时，若模型提供方仍是关闭状态，插件会顺手把它启用。
5. **核对结果**：打开「模型」分区查看上游目录与模型开关，打开「账号与额度」查看套餐、剩余额度与更新时间。

## 功能

- **统一设置页与统一骨架**：八个渠道共用同一套分区。账号池渠道与自管账号渠道用「模型」「账号与额度」「渠道」，API Key 渠道用「模型」「渠道」；所有渠道的账号行、模型行与设置行使用同一套渲染器，操作入口在每个渠道都在同一个位置。
- **账号池渠道的多账号轮换与每日签到**：Loomy、Raccoon、Qoder 中国版、TRAE 各自使用账号池，多账号按顺序轮换，提供方开关、额度与模型目录分渠道管理。Loomy、Qoder 中国版、TRAE、WorkBuddy 支持每日签到，自动签到与手动签到共用同一份记录。
- **API Key 渠道的 Key 管理、模型目录、思考档位与参数**：Agnes 与云知声共用一套实现，设置页填 Key、开关模型、调整上下文与最大输出等参数，并按上游支持的档位配置思考深度。
- **模型启停与「恢复推荐」**：模型目录只认上游，本地开关只做显隐标记。模型分区提供「刷新目录」「恢复推荐」，「恢复推荐」清除本地开关覆盖，按[设计规范 §3](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/DESIGN-STANDARDS.md#3-模型目录与命名)重置推荐列表。
- **首屏恢复与后台静默刷新**：打开设置页先恢复上次查看的渠道与最近一次结果，页面可见时每 5 秒读取一次宿主快照，页头「刷新」触发后台采集，界面随下一次快照读取更新。
- **凭据与上游原文不进界面**：账号与额度快照走公开字段投影，凭据只以引用名保存，上游响应原文不回显；退出或移除账号需二次确认。

## 支持清单

| 渠道 | 类型 | 登录或鉴权方式 | 额度或用量 | 签到 | 模型目录来源 |
|---|---|---|---|---|---|
| Loomy | 账号池 | 浏览器授权登录（本机 HTTP 扫码 / 短信页） | 账号积分与额度包 | 有 | 上游 `GET /api/v1/models`（`loomyad.xunfei.cn`） |
| Raccoon（小浣熊） | 账号池 | 浏览器授权登录（登录后按套餐分流） | 账号积分与额度包 | 无（每日积分由上游发放） | 上游 `GET /api/web/llm/v2/model_catalog`，免费面与订阅面各用本侧账号凭据 |
| Qoder 中国版 | 账号池 | 浏览器授权登录（HTTPS 授权页）；拉目录需本机官方 CLI 登录 | 账号积分 | 有（每日 10:00 UTC+8 进入新周期） | 官方 CLI `qoderclicn --list-models`；CLI 不可用时回落策展表 |
| TRAE | 账号池 | 浏览器 OAuth 登录（本机回调） | 积分与余额 | 有 | 上游 `POST /api/ide/v1/batch_get_detail_param`（`solo_agent` 通道） |
| 商汤 Token Plan | API Key | 渠道页填 API Key | 额度池、5 小时 / 7 天窗口、赠送额度 | 无 | 上游 `GET /v1/models`（`token.sensenova.cn`） |
| WorkBuddy | 自管账号 | 官方浏览器授权（主机轮询授权结果，最长约 5 分钟） | 套餐与积分窗口（Credits / Extra credits） | 有 | 上游 `GET /v3/config` 的 `agents[cli].models` |
| Agnes | API Key | 渠道页填 API Key | 读取 New API 账单接口（`hard_limit_usd` / `total_usage`），实测返回无限额度 | 无 | 上游 `GET /v1/models` |
| 云知声 | API Key | 渠道页填 API Key | 官方文档没有公开余额接口，设置页不显示用量 | 无 | 上游 `GET /anthropic/v1/models`（Anthropic 兼容模型列表） |

只做 CN 版：WorkBuddy AI、Trae Global、Qoder 国际版不接入。各渠道的目录来源、思考档位方言、模型参数与限制见 [提供商清单](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/providers.md)。

## 安装

**目录直装**（把目录长期保留在 `$DSH_HOME/dsh-go/plugins/` 下）：

```sh
dsh plugin --profile <profile> add <路径>
```

**GitHub Release 压缩包**：在仓库 [Releases](https://github.com/KouzakiUmi/dsh-unified-router/releases) 页下载资产 `dsh-unified-router.tgz`（配套 `dsh-unified-router.tgz.sha256`），用下载后的本地路径安装：

```sh
dsh plugin --profile <profile> add <解压后的路径>
```

新装后会被引擎加载。若替换了已加载的宿主代码，应在插件详情里重新载入该插件；客户端界面需重新打开设置页或刷新网页。无需重新构建 APK，无需替代 Web 服务器。

**卸载**：

```sh
dsh plugin --profile <profile> remove dsh-unified-router
```

卸载只移除插件，原账号数据保留。**Desktop 请使用桌面壳自带的 DSH Desktop CLI**。

### 后端模式

后端模式在安装配置中选择。

- **`shared`（共用）**：复用已运行的 Our Free Model 账号池。Web API 只操作本插件接入的 channel-pack 渠道，不重复启动适配器，不另开账号数据库。共用模式下账号池的签到由原 Channel Pack 后端调度，Unified Router 调度 WorkBuddy。
- **`standalone`（独立）**：本包独立后端注册 `loomy`、`raccoon`、`raccoon-pro`、`qodercn`、`trae` 五个 channel-pack 提供方，商汤 Token Plan 由内置控制器管理，WorkBuddy 的用量面板与模型服务由独立控制器管理。先停用原 Our Free Model，再在安装补丁的 `backend` 中选 `standalone`；检测到原账号池仍在时会拒绝启动，避免两个实例覆盖同一状态。

## 配置

**设置页路径**：**设置 → 能力 → Unified Router**。渠道选择器是自动换行的小卡片网格，打开设置页会进入上次查看的渠道。

**各渠道怎么配**：每个渠道的凭据获取位置、设置页填写位置与凭据引用名见 [凭据获取指引](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/credentials.md)；各渠道的目录、档位、参数与额度语义见 [提供商清单](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/providers.md)。

**自动签到开关**：宿主配置项 `autoCheckin: false` 关闭 Unified Router 的自动签到，手动签到仍使用同一份记录。独立模式下，自动签到包含 Loomy、Qoder 中国版、TRAE 和 WorkBuddy；账号行显示「已签到」「签到失败」「签到待确认」等实际状态。

**状态与凭据的存放**：

- 凭据经宿主 `credentials` 服务存取，引用名为 `UNIFIED_ROUTER_*`（如 `UNIFIED_ROUTER_AGNES_API_KEY`、`UNIFIED_ROUTER_UNISOUND_API_KEY`、`UNIFIED_ROUTER_SENSENOVA_API_KEY`、`UNIFIED_ROUTER_WORKBUDDY_ACCOUNTS`）。Key 不进入任何返回值、日志与错误文案。
- 最近一次的账号、额度与状态投影以公开字段原子写入 profile 状态目录的 `dsh-unified-router/settings.json`，部分失败时保留对应账号上一次成功的额度与更新时间。
- 商汤渠道的状态目录与凭据命名空间为 `dsh-unified-router-sensenova`。
- 浏览器 `localStorage` 用于跨次渲染与记忆上次查看的渠道。

## 兼容性

| 项 | 要求 |
|---|---|
| Node.js | `>=22.19.0` |
| DSH Core（`engines.dsh`） | `>=0.2.1-rc.2 <0.3.0-0` |
| `@deepseek-ai/cordis` | `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.2.2-0 \|\| >=0.2.2-0 <0.3.0-0` |
| `@deepseek-ai/dsh-credentials` | `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.2.2-0 \|\| >=0.2.2-0 <0.3.0-0` |
| `@deepseek-ai/dsh-llm` | `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.2.2-0 \|\| >=0.2.2-0 <0.3.0-0` |
| `@deepseek-ai/dsh-llm-pi-ai` | `>=0.1.5 <0.3` |
| `@deepseek-ai/schemastery` | `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.2.2-0 \|\| >=0.2.2-0 <0.3.0-0` |
| `@earendil-works/pi-ai` | `>=0.85.0 <2.0.0` |

`package.json` 的 `dsh` 字段声明：`manifestVersion` 为 1，带 `cordis.patch.yml` 的 bundle 补丁；客户端平台为 `web`，注入 `@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-settings` 与 `@deepseek-ai/dsh-client-ui-slots`。插件通过 `settings.section` 挂载设置页，不新增聊天、侧栏或原生设置胶囊入口。

## 文档

| 文档 | 内容 |
|---|---|
| [设计规范](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/DESIGN-STANDARDS.md) | 设置页信息架构、数据加载、模型目录与命名、文案与视觉的完整规则 |
| [API Key 渠道契约](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/APIKEY-CHANNELS.md) | Agnes 与云知声的接口契约、实测与官方文档事实、管理器与 RPC 投影 |
| [提供商清单](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/providers.md) | 各渠道的目录来源、思考档位方言、模型参数、额度 / 用量与限制 |
| [凭据获取指引](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/credentials.md) | 各渠道凭据的获取位置、设置页填写位置与引用名 |
| [架构](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/architecture.md) | 模块分层、RPC 与数据流 |
| [开发说明](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/development.md) | 构建、测试与验证约定 |
| [发布说明](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/publish.md) | 打包与发布流程 |
| [更新记录](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/changelog.md) | 版本变更记录 |
| [目录审计](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/CATALOG-AUDIT.md) | 硬编码目录与上游真实目录的逐条核对记录 |
| [Qoder CLI 接入](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/docs/QODER-CLI.md) | Qoder 中国版借官方 CLI 拉目录的方案、降级链与风险 |

## 来源与许可证

MIT，见 [`package.json`](package.json) 的 `license` 字段。

上游：[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)，版本 2.8.0，提交 `999e9f784ea3ea7a11cae383b142697b1ff2c42f`。渠道原始作者 Jet（iJetLi），MIT。根许可证及 `vendor/channel-pack/LICENSE`、`vendor/channel-pack/NOTICE.md` 均保留。WorkBuddy 用量原语来自 `@magpie-community/opencode-workbuddy-auth` 0.2.35（MIT，见 `vendor/workbuddy/NOTICE.md`）。SenseNova Token Plan 的认证、用量与 Pi-AI 适配器来自 [eghrhegpe/dsh-connect-sensenova-token-plan](https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan) 0.8.5（MIT）。完整第三方组件、版本与许可证清单见 [NOTICE.md](https://github.com/KouzakiUmi/dsh-unified-router/blob/main/NOTICE.md)。

本地变更：从上游入口提取 Loomy、Raccoon、Qoder 中国版的认证服务与适配器；加入 TRAE 接线（channel-pack 现成实现的浏览器 OAuth + 每日签到 + 余额）、独立商汤 Token Plan 控制器、WorkBuddy 用量控制器、受鉴权的 `/api/unified-router` 服务、公开字段投影与独立 Web 设置客户端；新增 Agnes 与云知声两个 API Key 渠道，共用一套 Key 管理、目录与参数实现。

## 从旧版本迁移

项目由 `dsh-eac-router` 改名为 `dsh-unified-router`：包名与插件 id、RPC 服务名与 `/api/unified-router` 路由、设置命名空间 `dsh-unified-router`、商汤状态目录与凭据命名空间、凭据引用 `UNIFIED_ROUTER_*` 全部同步更新。

**旧名称与旧目录会被读取并迁移**：

- 改名前的凭据引用（`EAC_SENSENOVA_*`）、商汤凭据命名空间（`dsh-eac-router-sensenova` 及其更早的 `-legacy`）与旧状态目录保留回退读取。
- 旧单账号引用 `UNIFIED_ROUTER_WORKBUDDY_AUTH` 在账号索引缺失或为空时，被采纳为第一个账号，随后清除。
- 旧状态目录在新目录不存在时整体搬迁一次；搬迁失败时本次运行继续读写旧目录，下一轮启动再尝试搬迁。

**新值只写入新名字**。旧名字下只发生两类写动作，都用于让旧数据退出而不是复活：登录令牌 / 密码 / Key 被采纳到新命名空间后删除旧记录；退出登录、忘记 Key、重设密码时连旧名残留一并清除。

宿主 profile 里指向旧包名或旧路径的安装条目需要在安装侧同步更新，否则插件不会被加载。Devin 已拆分为独立插件 `dsh-devin-provider`，本插件不再读写其凭据。界面样式变量（`--eac-*`）与 DOM 测试钩子沿用既有命名，未随改名调整。
