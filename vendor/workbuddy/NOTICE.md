# vendor/workbuddy — WorkBuddy 登录与用量原语

来源：`@magpie-community/opencode-workbuddy-auth` 0.2.35（MIT，见 package.json）。
仅取**中国版**（`SITES.workbuddy`，copilot.tencent.com）；国际版 `workbuddy-ai` 不接入。

- `index.mjs`：原样保留，不做任何修改（上游 bundle，纯 node 内置依赖）。
- 接入方式是**驱动插件公开 hooks**：`await WorkBuddyAuthPlugin({ client, magpie })` 得到
  OpenCode 1.x 插件对象，`auth.usage` / `auth.checkin` / `auth.methods[]` 的浏览器
  `authorize()` / `provider.models` / `auth.refresh` 是稳定公开面；`_internal` 仅作
  模型目录兜底。上游内部函数（meter/sign/current 等）未从 `_internal` 暴露，不依赖。
- 接入层在 `lib/workbuddy.js`（凭据、登录、余额、签到）与 `src/client/` 客户端
  provider 模块；WorkBuddy 的模型服务（OpenAI 兼容 /v2 与 anthropic-messages）由
  `lib/workbuddy-llm.js` 提供适配器，随账号登录与模型启停注册。

## 许可

MIT（上游 package.json `license` 字段）。上游仓库：
https://github.com/magpie-community/plugins（opencode-workbuddy-auth 包）。
