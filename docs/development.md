# 开发与验证说明

> 面向贡献者：环境、命令、测试清单与新增渠道的改动点。界面与交互规则见 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)，渠道接入见 [CHANNEL-ARCHITECTURE.md](CHANNEL-ARCHITECTURE.md)，整体分层见 [architecture.md](architecture.md)。

## 环境要求

- **Node.js 22.19+**（`package.json` `engines.node` 为 `>=22.19.0`），构建与测试均使用该版本。
- **构建工具目录**：构建需要 `esbuild 0.25.12` 与 `undici 8.11.2`（`package.json` `devDependencies`）。`scripts/build.mjs` 按以下顺序解析 esbuild 所在目录，命中即用：

  1. 环境变量 `UNIFIED_ROUTER_BUILD_TOOLS`
  2. 仓库同级目录 `../unified-router-build`
  3. 仓库根目录

  解析方式是 `require.resolve('esbuild', { paths: [目录] })`。**只有 `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND` 算未命中**；候选目录里 esbuild 的包损坏一类解析错误会立即抛出，不会静默改用另一个目录。全部未命中时报错并提示可用 `UNIFIED_ROUTER_BUILD_TOOLS` 指定工具目录。
- **宿主依赖不本地安装**：`@deepseek-ai/*` 等 peer 依赖由 DSH 宿主注入或从所在 profile 的 `node_modules` 解析，安装依赖时使用 `--legacy-peer-deps`。构建时 `@deepseek-ai/*` 与 `node:*` 保持外部引用，不打进产物。
- **宿主解析路径**：esbuild 的 `nodePaths` 为 `/opt/dsh/node_modules`，与宿主解析链一致。

## 常用命令

```console
npm run build       # node scripts/build.mjs：构建后端、复制 WASM、拼接客户端
npm test            # 先 node scripts/build.mjs，再跑全部测试
npm run test:run    # 只跑测试，不构建
npm run check:residue  # 静态核验：已删除的模块声明不得仍被引用
```

`npm test` 已经包含构建，保证产物不落后于源码。修改客户端或后端源码后运行 `npm test`，并额外执行语法检查：

```console
node --check lib/client.js
node --check lib/backend.js
node --check lib/web-host.js
```

安装、重新载入宿主插件、部署与重启不属于本地源码修改的默认步骤。

## 目录与测试清单

`npm run test:run` 覆盖 35 个测试文件，全部离线运行，不访问真实上游、不使用真实账号。按域分组：

| 域 | 文件 | 覆盖内容 |
|---|---|---|
| 后端装配 | `backend.test.mjs` | 模型推荐排除规则、独立后端渠道精选列表与启停恢复、Raccoon 两侧模型池独立、`model.refresh` 跨重启持久化、TRAE 订阅类型附带 |
| 宿主 RPC | `host.test.mjs` | 安装清单、`account.list` 投影白名单、`plan`/`planLabel` 字段、共享主机 RPC 信封、跨渠道与跨账号拒绝、上游错误不外泄、HTTP 入口校验、后端就绪等待、取消不触发上游、商汤/WorkBuddy 投影、每分钟后台采集与删除竞态、快照重启恢复、自动签到与跨日任务、写操作后快照更新 |
| 渠道清单 | `channel-method-parity.test.mjs` | 客户端方法集从规格派生、宿主/客户端白名单差恰好等于 `HOST_INTERNAL_METHODS`、每个写方法都有失效归属 |
| 契约层 | `channel-contract.test.mjs` | `accountWire/accountView/modelWire/modelView` 的缺席不写属性、脏值不冒充合法值、`wireJson` 深度净化、`publicResult` 出口净化 |
| 客户端 | `web-client.test.mjs` | 客户端只注册 `settings.section`、样式模板无反引号、亮暗主题、账号与模型列表、十二张渠道卡片、写后重读、登录与失败提示、快照首屏读取、`sessionStorage` / `localStorage` 持久化 |
| 界面 | `model-selection-ui.test.mjs`、`context-pill.test.mjs`、`plan-models-ui.test.mjs`、`automation-and-ux.test.mjs` | 模型开关与恢复推荐、分页与搜索、上下文药丸与智能选号、自动化开关与文案 |
| 药丸 | `quota-pill.test.mjs` | 额度药丸的账号分流、订阅类型显示、窗口/百分比/积分包渲染、宿主快照轮询与失败保留 |
| 选号 | `quota-priority.test.mjs` | 手动/免费优先/临期优先/缓存优先四种模式的不变式 |
| 商汤 | `sensenova-manager.test.mjs`、`sensenova-models.test.mjs` | 独立管理器安全空快照、凭据只写引用、状态目录搬迁与并发、模型白名单与非法 ID、目录与参数跨重启 |
| WorkBuddy | `workbuddy.test.mjs` | 多账号索引、浏览器登录、续期不串号、按账号签到/退出、目录选择、凭据不外泄 |
| 自管渠道 | `managed-channels.test.mjs` | AStudio / CodeArts 的多账号框架、登录、导入、目录、额度与推理装配 |
| 倍率徽标 | `model-rate-badge.test.mjs`、`model-rate-badge-paths.test.mjs` | 倍率徽标四态、订阅限定徽标、四渠道选择器与设置页共享同一徽标、路径归一 |
| Qoder | `qoder-cli.test.mjs` | CLI 文本表解析（key 才是目录 id）、目录合并、刷新成功与回落 |
| Raccoon | `raccoon-thinking.test.mjs`、`raccoon-checkin.test.mjs`、`raccoon-unified.test.mjs` | 思考档位两套方言、签到触发与派发、统一免费/订阅模型开关 |
| 思考默认 | `thinking-defaults.test.mjs` | 思考默认档位发布与解析 |
| 目录卫生 | `model-blacklist-hygiene.test.mjs` | 黑名单 id 不复活幽灵模型、远端目录成功后剪枝并落盘、刷新失败不剪枝 |
| API Key 渠道 | `apikey-providers.test.mjs`、`apikey-new-channel.test.mjs`、`apikey-llm.test.mjs`、`apikey-models.test.mjs`、`apikey-channel.test.mjs`、`apikey-host.test.mjs`、`apikey-client.test.mjs` | 五家渠道的规格、目录/思考/用量/兜底、`fixture-key` 虚构渠道全链路（共享层零改动守护）、适配器装配、模型设置、管理器、投影、客户端视图 |
| 工具 | `unisound-tools.test.mjs`、`agnes-image-tool.test.mjs` | 云知声多模态工具、Agnes 生图工具的端到端装配 |
| 退役清理 | `retired-channels.test.mjs`、`cleanup-loomy.test.mjs` | 退役渠道磁盘清扫幂等性与手动脚本 |
| 循环保护 | `cot-loop-guard.test.mjs` | 统一思考链死循环保护的状态机、事件广播与配置开关 |
| 目录审计辅助 | `test/kernel.mjs` | 宿主契约桩（`Service`、`LlmAdapter`、`LlmError`、`credentialRef` 等），供后端挂载测试替换 `@deepseek-ai/*` 使用，本身不是测试文件 |

## 新增一个账号池渠道

账号池渠道复用 vendor 的 channel-pack 实现，改动点集中在登记与挂载：

1. **渠道规格**：在 `lib/channel-specs.js` 的 `CHANNEL_SPECS` 加一条，声明 `id`、`title`、`kind: 'pack'`、`accountPool: true`、`packSlot`、`capabilities`、`claim`。
2. **vendor 适配器与挂载**：在 `vendor/channel-pack/src/` 提供渠道适配器与认证；在 `src/backend/providers/` 写挂载模块；在 `lib/pack-slots.js` 与 `src/backend/pack-bridge.ts` 登记 vendor 形参位；在 `src/backend/providers/pack-registry.ts` 的 `MOUNTS` 登记映射。
3. **客户端视图**：在 `src/client/providers/` 新增 `<id>.js`（账号池渠道声明 `pack: true`），登记进 `src/client/providers/index.js` 与 `scripts/build.mjs` 的 `clientModules`。
4. **快照资源**：`lib/settings-providers.js` 的 pack 方法集已声明 `account.list`、`credits.balances` 等资源，无需重复；新增专属方法时同步 `KIND_METHODS` / `methods.extra`。
5. **回归**：跑 `npm test` 与 `npm run check:residue`；`test/channel-method-parity.test.mjs` 会校验两端方法集与写后失效。

## 新增一个 API Key 渠道

对照 [APIKEY-CHANNELS.md](APIKEY-CHANNELS.md) 与 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)。六家现有渠道共用管理器、模型设置、推理适配器，新增渠道的改动集中在规格与登记点，**共享层零改动**：

1. **渠道规格**：在 `lib/apikey-providers.js` 新增 spec 对象并加进 `APIKEY_PROVIDERS`，提供端点、`chatPath`、`baseUrl`、`credentialRef`、`catalog.request/parse`、`fallback`、`effortBody`、`balance`、可选 `consoleQuota` / `rateLimit` / `tools`。上游事实需有实测或官方文档依据；未确认的上下文/输出记 0，未确认的能力不声明。
2. **渠道清单**：在 `lib/channel-specs.js` 加规格（`kind: 'apikey'`）。
3. **客户端视图**：用 `src/client/providers/apikey.js` 的 `apiKeyChannel({ id, title, host, caps })` 生成视图；新增 `<id>.js` 只声明 id、标题与能力；登记 `src/client/providers/index.js` 与 `scripts/build.mjs` 的 `clientModules`。
4. **快照资源**：`lib/settings-providers.js` 为新渠道注册 `apikey.snapshot`。
5. **回归**：`test/apikey-new-channel.test.mjs` 用虚构渠道（`fixture-key`）走通额度读取、限流识别与管理器全链路——新渠道若要改 `lib/` 里的共享文件才能接入，那条用例会先红。另补 `test/apikey-providers.test.mjs`、`apikey-channel.test.mjs`、`apikey-host.test.mjs`、`apikey-client.test.mjs` 的该渠道用例。

## 新增一个自管多账号渠道

对照 [MANAGED-CHANNELS.md](MANAGED-CHANNELS.md)：

1. **渠道规格**：在 `lib/managed-providers/<id>.js` 声明认证方式（本机导入/浏览器/粘贴凭据）、目录、额度、签到、奖励/任务与推理传输；登记进 `lib/managed-providers/index.js`。
2. **渠道清单与客户端**：`lib/channel-specs.js` 加规格（`kind: 'managed'`）；客户端用 `managedChannel(config)` 声明视图，登记注册表与构建顺序表。
3. **回归**：覆盖登录、导入、目录、额度、按账号签到/退出与凭据不外泄。

## 构建产物

`npm run build` 生成下列产物，**均随仓库提交**：

| 产物 | 生成方式 |
|---|---|
| `lib/backend.js` | esbuild 打包 `src/backend.ts` 与内置的 vendored MIT 渠道源码，`format: esm`、`platform: node`、`target: node22`；`@deepseek-ai/*` 与 `node:*` 保持外部引用，`undici` 被内联进产物 |
| `lib/client.js` | `src/client/**/*.js` 按 `clientModules` 顺序拼接、剥掉行首 `export ` 前缀，再做构建期语法自检 |
| `lib/qoder-auth-wasm.wasm` | 构建时从 `vendor/channel-pack/` 复制 |

`lib/web-host.js`、`lib/rpc.js`、`lib/sensenova.js` 是手维护宿主模块，**不进构建**，直接由仓库提交。产物落后于源码时 `npm test` 会先构建再测试。

## 离线测试约定

- **桩网络**：测试不访问真实上游。需要网络的用例注入桩 `fetch`（覆盖 `globalThis.fetch`，或在 `lib/apikey-channel.js` 的 `deps.fetch`、`lib/web-host.js` 的 `testDeps` 里注入），桩可计数并抛错，用于断言「未发起真实请求」与失败回落路径。
- **临时目录**：状态、快照与模型设置写在 `fs.mkdtempSync(path.join(os.tmpdir(), 'unified-router-test-'))` 之类的临时目录，用例结束清理；通过 `DSH_HOME` 等环境变量把状态目录指向临时目录。
- **虚构账号**：账号、模型与凭据一律用虚构 id（如 `<provider>-a`、`<provider>-m0`），凭据值用固定占位串，断言其不出现在任何返回值与错误文案里。
- **宿主契约桩**：`test/kernel.mjs` 提供 `@deepseek-ai/*` 的最小实现，后端挂载测试用 `registerHooks` 把该模块替换进解析链。
- **React 桩**：`test/web-client.test.mjs` 用自建 React 桩加载 `lib/client.js`，模拟 `useState` / `useEffect` 与 RPC 夹具，断言渲染树与调用序列。
- **测试中不安装依赖、不使用真实账号、不触发真实登录与签到。**
