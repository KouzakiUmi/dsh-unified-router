# NOTICE

本插件包含下列第三方组件与参考实现。许可证原文位于各组件的 `LICENSE` 文件或对应上游发行物；本仓库根 `LICENSE` 为项目整体的 MIT 许可证。

| 组件 | 来源 | 版本 / 提交 | 许可证 | 本仓库路径 |
| --- | --- | --- | --- | --- |
| 免费渠道包（channel-pack，含 Qoder 加密推理 WASM `lib/qoder-auth-wasm.wasm`） | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)（Jet / iJetLi 的 MIT 渠道实现再构建） | 上游 2.8.0，提交 `999e9f784ea3ea7a11cae383b142697b1ff2c42f`；本插件吸收的渠道提交 `345f0a07b22713c0ae189ca7d8b97ec4f64626c6` | MIT（`vendor/channel-pack/LICENSE`） | `vendor/channel-pack/`（发布包内仅 `LICENSE` 与 `NOTICE.md`）；编译产物 `lib/backend.js` |
| SenseNova Token Plan 认证 / 用量 / Pi-AI 适配器 | [eghrhegpe/dsh-connect-sensenova-token-plan](https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan) | 0.8.5 | MIT（`vendor/sensenova-token-plan/LICENSE`） | `vendor/sensenova-token-plan/` |
| WorkBuddy 登录与用量原语 | [`@magpie-community/opencode-workbuddy-auth`](https://github.com/magpie-community/plugins) | 0.2.35 | MIT（上游 package.json `license` 字段，见 `vendor/workbuddy/NOTICE.md`） | `vendor/workbuddy/` |
| Qoder 中国版加密推理 WASM | 上游 Qoder 运行时随渠道包带入 | 与 channel-pack 同一上游提交 | 见 `vendor/channel-pack/NOTICE.md` | `lib/qoder-auth-wasm.wasm`（构建时自 `vendor/channel-pack/` 复制） |
| 思维链死循环保护（`dsh-cot-loop-guard`） | 本地仓库 `dsh-cot-loop-guard`（周期 + 子句池三态滞回检测与有界续跑） | 2026 | MIT | `lib/cot-loop-guard/` |
| 上下文分段控件 | [KouzakiUmi/dsh-opendesign-corouter](https://github.com/KouzakiUmi/dsh-opendesign-corouter)，其输入栏样式源于 `dsh-kxyai-provider` | CoRouter 0.3.4 / KXY 0.6.3 | MIT（Copyright (c) 2026 KouzakiUmi；Copyright (c) 2026 dsh-kxyai-provider contributors；许可正文见 `LICENSE`） | `src/client/context-pill.js`、`src/client/styles.js` |

## 构建期捆绑进 `lib/backend.js` 的组件

`lib/backend.js` 由 `src/backend.ts` 与渠道源码经 esbuild 打包；下列组件代码被内联进该产物（`@deepseek-ai/*` 与 `node:*` 保持外部引用，不内联）：

| 组件 | 来源 | 版本 | 许可证 |
| --- | --- | --- | --- |
| undici（含其内嵌的 ws / llhttp 代码，WS 部分保留 Einar Otto Stangvik 的 MIT 署名注释） | [nodejs/undici](https://github.com/nodejs/undici) | 8.11.2 | MIT |

## 宿主提供的依赖（运行时不随包分发）

以下依赖按 Cordis 插件约定由 DSH 宿主注入或按 Node 解析规则从所在 profile 的 `node_modules` 取，声明于 `package.json` `peerDependencies`，许可证以各自上游发行物为准：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-llm-pi-ai`、`@deepseek-ai/schemastery`、`@earendil-works/pi-ai`。
