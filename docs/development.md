# 开发与验证说明

> 面向贡献者：环境、命令、测试清单与新增渠道的改动点。界面与交互规则见 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md)，渠道契约见 [APIKEY-CHANNELS.md](APIKEY-CHANNELS.md)，整体分层见 [architecture.md](architecture.md)。

## 环境要求

- **Node.js 22.19+**（`package.json` `engines.node` 为 `>=22.19.0`），构建与测试均使用该版本。
- **构建工具目录**：构建需要 `esbuild 0.25.12` 与 `undici 8.11.2`（`package.json` `devDependencies`）。`scripts/build.mjs` 按以下顺序解析 esbuild 所在目录，命中即用：

  1. 环境变量 `UNIFIED_ROUTER_BUILD_TOOLS`
  2. 环境变量 `EAC_BUILD_TOOLS`（改名前的变量名，保留兼容）
  3. 仓库同级目录 `../unified-router-build`
  4. 仓库同级目录 `../eac-router-build`（改名前的目录名，保留兼容）
  5. 仓库根目录

  解析方式是 `require.resolve('esbuild', { paths: [目录] })`。**只有 `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND` 算未命中**；候选目录里 esbuild 的包损坏一类解析错误会立即抛出，不会静默改用另一个目录。全部未命中时报错并提示可用 `UNIFIED_ROUTER_BUILD_TOOLS` 指定工具目录。
- **宿主依赖不本地安装**：`@deepseek-ai/*` 等 peer 依赖由 DSH 宿主注入或从所在 profile 的 `node_modules` 解析，安装依赖时使用 `--legacy-peer-deps`。构建时 `@deepseek-ai/*` 与 `node:*` 保持外部引用，不打进产物。
- **宿主解析路径**：esbuild 的 `nodePaths` 为 `/opt/dsh/node_modules`，与宿主解析链一致。

## 常用命令

```console
npm run build       # node scripts/build.mjs：构建后端、复制 WASM、拼接客户端
npm test            # 先 node scripts/build.mjs，再跑全部测试
npm run test:run    # 只跑测试，不构建
```

`npm test` 已经包含构建，保证产物不落后于源码。修改客户端或后端源码后运行 `npm test`，并额外执行语法检查：

```console
node --check lib/client.js
node --check lib/backend.js
node --check lib/web-host.js
```

安装、重新载入宿主插件、部署与重启不属于本地源码修改的默认步骤。

## 目录与测试清单

`npm run test:run` 覆盖下列 18 个测试文件，全部离线运行，不访问真实上游、不使用真实账号。

| 文件 | 覆盖内容 |
|---|---|
| `test/backend.test.mjs` | 模型推荐排除规则（发版批次与同渠道性能倍率）、独立后端渠道精选列表与启停恢复及持久化、Raccoon 两侧模型池独立（各用本侧凭据拉上游、不按倍率过滤）、`model.refresh` 跨重启保存与刷新失败保留 |
| `test/host.test.mjs` | 安装清单只有 Web 设置客户端、`account.list` 投影白名单与 `plan` 枚举、共享主机 RPC 信封、跨渠道与跨账号拒绝、账号设置只允许昵称与启停、上游错误不外泄、HTTP 接口拒绝错误方法/格式/超大请求、登录地址校验、后端就绪等待、Qoder 额度语义、取消不触发上游、模型参数与目录刷新穿过全部白名单层、商汤 Plan 白名单与跨 Origin 拒绝、WorkBuddy 投影与跨 Origin 拒绝、每分钟后台采集与删除竞态、快照重启恢复、自动签到记录、跨日定时任务、独立/共用模式签到渠道、只读预检、写操作后快照更新 |
| `test/web-client.test.mjs` | 客户端只注册 `settings.section`、样式模板无反引号、内部代号兜底名、亮暗主题、账号紧凑列表、状态灯、八张渠道卡片与 Raccoon 单卡片、写后重读、在途余额不被写操作中止、登录失败与登录地址不可用提示、登录卡片复制链接、展示字段保留、切换取消旧请求、删除确认 nonce、登录显式点击、奖励优先级、网络失败文案、写后刷新取消、后台重读失败保留、手动刷新不被覆盖、领取后刷新、商汤 Key 不进浏览器快照、切换渠道保留、商汤请求取消、WorkBuddy 多账号与软失败、WorkBuddy 签到退出、Raccoon 家族卡与界面、目录真拉与两侧各自刷新、渠道缓存恢复、打开读上次渠道、静默刷新、首屏无缓存提示、`sessionStorage` / `localStorage` 持久化 |
| `test/model-selection-ui.test.mjs` | 模型开关与「恢复推荐」、启用优先在分页之前、搜索与清空、单一列表分页、保存不收起编辑器、保存失败保留原配置、默认参数展示、未公布默认值不冒充已确认参数 |
| `test/sensenova-manager.test.mjs` | 缺失窗口数值保持未知、模型消耗未知与真实零区分、独立管理器安全空快照、API Key 只写凭据服务、不读取或更改参考插件、启用时无注册服务则回滚、改名前引用名回退读取、状态目录搬迁与并发搬迁 |
| `test/sensenova-models.test.mjs` | 空白名单全开、哨兵与再启用、旧白名单保留、输出上限覆盖、真实 publisher 构建描述符、非法与超长 ID、未知目录版本拒写、额度未知保留上次受限、写操作来源与授权保护、目录与参数跨重启 |
| `test/plan-models-ui.test.mjs` | 商汤默认打开模型与渠道分区、展示名与别名、逐模型 RPC、在途轮询不覆盖刚保存的设置、首次失败重试、后台不轮询、取消与定时器清理、隐藏页面取消、写操作延迟时切换渠道 |
| `test/workbuddy.test.mjs` | 模型开关与实际调用参数、空索引快照、旧单账号采纳与清除、索引损坏按空账号处理、浏览器登录、登录地址非法作废、账号上限、双账号快照聚合、续期不串号、不复活已删账号、按账号签到、点名校验、按账号退出、目录账号选择、取消、`dispose`、输入形状校验、凭据不外泄、上游 5xx 只提交一次 |
| `test/model-rate-badge.test.mjs` | 倍率徽标四态（免费/计费/促销/未知）、四渠道选择器与设置页共享同一徽标且模型 ID 稳定 |
| `test/qoder-cli.test.mjs` | CLI 文本表解析（key 才是目录 id）、目录合并策略、刷新成功与回落、目录跨进程读取、机械可读化 |
| `test/raccoon-thinking.test.mjs` | 思考档位解析、档位去重与展示名、托管档位只发顶层字段而老模型只发 `extra_body.thinking` |
| `test/model-blacklist-hygiene.test.mjs` | 黑名单 id 不复活幽灵模型、远端目录成功后剪枝并落盘、刷新失败不剪枝 |
| `test/apikey-providers.test.mjs` | 渠道注册表、spec 静态字段、Agnes 目录请求/解析/思考/用量/兜底、云知声目录请求/解析/思考/分页/兜底 |
| `test/apikey-llm.test.mjs` | pi-ai 描述符映射、请求默认值、fetch 地址校验与思考字段合并、适配器装配与拦截流端到端、providerId 覆盖 |
| `test/apikey-models.test.mjs` | 写方法名、默认值推导、开关落盘与读回、参数校验、`resetModels`、目录校验、并发写串行化、推荐排除按渠道隔离、空路径、取消信号 |
| `test/apikey-channel.test.mjs` | 无 Key 回落兜底、`setKey` 与非法 Key、远端失败回落缓存与兜底、分页、目录复用与在途合并、启用触发注册与关闭释放、注册失败回滚开关、换 Key 隔离、模型写后重新发布、写失败回滚、余额、Key 不外泄、provider 校验、`dispose`、`collectSnapshot` 等价、已中止 signal |
| `test/apikey-host.test.mjs` | 方法白名单与渠道 id 一致、未知 provider 与非法 payload 拒绝、跨 Origin 写拒绝、直通本渠道管理器不经账号池归属检查、快照投影与内部字段名、写方法投影、余额三种形状、模型列表过滤、已投影形状幂等、设置快照采集与写后更新、`dispose` |
| `test/apikey-client.test.mjs` | 快照按渠道 id 收编、两个渠道互不覆盖、保存 Key 自动启用提供方、模型开关与参数就地更新、apikey 方法只认注册渠道、设置页分区呈现、用量行、重进设置页从缓存恢复 |

`test/kernel.mjs` 是宿主契约桩（`Service`、`LlmAdapter`、`LlmError`、`credentialRef` 等），供后端挂载测试替换 `@deepseek-ai/*` 使用，本身不是测试文件。

## 新增一个账号池渠道

先读 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md) §6 检查清单与 §7 Provider 设置接口，再按下列登记点改动（顺序即依赖顺序）：

1. **客户端 provider 模块**：在 `src/client/providers/` 新增 `<id>.js`，导出 `id`、`title` 等元数据，账号池渠道声明 `pack: true` 并给出模型分组，视图由 `providers/pack.js` 提供默认实现。
2. **客户端注册表**：在 `src/client/providers/index.js` 的 `registeredProviders` 里登记，顺序即卡片顺序。
3. **构建顺序表**：在 `scripts/build.mjs` 的 `clientModules` 里登记新模块，依赖在前。
4. **RPC 白名单**：在 `lib/rpc.js` 的 `PROVIDERS` 里登记渠道，按需把新方法加入白名单集合。
5. **快照资源**：在 `lib/settings-providers.js` 的 `settingsResources` 里登记 `account.list` 与 `credits.balances` 资源（需要采集额度时）。
6. **公开投影**：在 `lib/web-host.js` 的 `publicResult` 里为新方法补字段白名单。
7. **后端挂载**：在 `src/backend/providers/` 新增挂载模块，并在 `src/backend.ts` 的 `mountBackend` 里装配、注册适配器与维护定时器。
8. **上游适配器**：复用 `vendor/channel-pack/src/` 的账号池与渠道实现；改动仅限约定范围。
9. **回归用例**：按设计规范 §6 补测试，覆盖分区齐全、账号列表行、模型列表行、首屏预热与缓存白名单。

## 新增一个 API Key 渠道

对照 [APIKEY-CHANNELS.md](APIKEY-CHANNELS.md) 与 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md) §6/§7。Agnes 与云知声共用管理器、模型设置、推理适配器三层，新增渠道的改动集中在规格与登记点：

1. **渠道规格**：在 `lib/apikey-providers.js` 新增 spec 对象并登记进 `APIKEY_PROVIDERS`，提供端点、`chatPath`、`baseUrl`、`credentialRef`、`catalog.request/parse/next`、`fallback`、`effortBody`、`balance`。上游事实需有实测或官方文档依据，未确认的上下文/输出记 0，未确认的能力不声明。
2. **RPC 白名单**：把新渠道 id 加入 `lib/rpc.js` 的 `APIKEY_PROVIDER_IDS`；`APIKEY_METHODS` 对全部 API Key 渠道通用，通常无需改动。
3. **宿主装配**：`lib/web-host.js` 按 `APIKEY_PROVIDER_IDS` 自动建懒装配包装器，并按 `payload.provider` 路由；新增 `publicResult` 投影分支时复用 `publicApiKeySnapshot`。
4. **管理器、模型设置、推理适配器**：`lib/apikey-channel.js`、`lib/apikey-models.js`、`lib/apikey-llm.js` 是共用层，渠道差异全部收敛在 spec 里，一般无需改动。
5. **客户端视图**：用 `src/client/providers/apikey.js` 的 `apiKeyChannel({ id, title, host })` 生成视图，新增 `<id>.js` 只声明 id、标题与端点；在 `src/client/providers/index.js` 登记，并在 `scripts/build.mjs` 的 `clientModules` 里登记。
6. **快照资源**：在 `lib/settings-providers.js` 的 `settingsResources` 里为新渠道注册 `apikey.snapshot`。
7. **回归用例**：在 `test/apikey-providers.test.mjs`、`test/apikey-channel.test.mjs`、`test/apikey-host.test.mjs`、`test/apikey-client.test.mjs` 补该渠道的用例。

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
- 测试中不安装依赖、不使用真实账号、不触发真实登录与签到。
