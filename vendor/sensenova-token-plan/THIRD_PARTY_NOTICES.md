# SenseNova Token Plan 第三方声明

`vendor/sensenova-token-plan/` 包含从 `dsh-connect-sensenova-token-plan` 0.8.5 带入并适配的 JavaScript 构建产物。原项目作者为 eghrhegpe，采用 MIT License；原许可证全文见本目录的 [LICENSE](./LICENSE)。

来源：<https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan>

本项目保留了原组件的认证、Token Plan 用量解析、缓存、额度窗口和 Pi-AI 适配器代码，并作了以下本地适配：

- 导出 Unified Router 控制器需要的认证、凭据、目录、provider publisher 和快照工厂；
- 为 configurable provider 增加可注入的 `settingsNs`，使模型设置归属 `dsh-unified-router`；
- 将凭据引用和历史迁移路径改为 Unified Router 专用命名空间，避免与原插件交换或覆盖敏感状态；改名前的引用名（`EAC_*`、`dsh-eac-router-sensenova*`）只作迁移期回退读取，被采纳到新命名空间后删除旧记录，登出或忘记 Key 时连旧记录一并清除——除这两类清除动作外不向旧名字写入；
- 额度窗口及模型消耗的缺失或无效数值保留为未知，避免误判耗尽并错误下线模型；
- 不使用原参考插件的 HTTP 路由、Raccoon、出图、联网搜索或面板生命周期；
- Unified Router 通过 `lib/sensenova.js` 对错误、额度未知状态和敏感字段做额外公开投影。

原组件的 Token Plan 登录与用量协议参考了 `sensenova-usage-dashboard`，其接口语义和来源说明保留在上游项目文档中。本目录不包含该 Python 项目的代码。

运行时使用 DSH Host 提供的 `@deepseek-ai/dsh-llm-pi-ai`、`@earendil-works/pi-ai` 等 peer 依赖；它们不复制到本目录，许可证以 DSH/各自上游发行物为准。