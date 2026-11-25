# 架构复盘：模块化到位了吗？

> 复盘日期 2026-11-18。对象：`src/client` + `lib/web-host.js` + `vendor/channel-pack` 的接线。
> 结论先说：**表面模块化了（每个渠道一个文件），但 UI 组合层没有归一化** —— 新增渠道仍然要
> 自己拼一遍 JSX，所以每加一个渠道就多一套交互，最终长成"想到什么堆什么"。

## 1. 原始目标 vs 现状

目标：**模块化接入各平台，靠规范化 UI 复用资源，新增平台只写数据与动作。**

现状测量（`src/client`）：

| 文件 | 行数 | 说明 |
|---|---|---|
| `store.js` | 883 | 状态机 + 请求生命周期 + 缓存 + 轮询，**职责过载**（已超复杂度红线 350 行） |
| `core.js` | 395 | wire 归一化 + 缓存编解码 + 别名表，**混合了三种职责** |
| `panels-core.js` | 363 | 四个面板 + 模型行 + 家族卡专用面板 |
| `styles.js` | 274 | 设计令牌 + 全部组件样式（尚可，但没有组件边界） |
| `ui.js` | 205 | 原语函数 + React 叶子组件（表单/参数编辑器）**混放** |
| `settings.js` | 164 | 根组件（还塞了渠道记忆、静默刷新定时器） |
| `providers/sensenova.js` | 133 | **自带整套面板**（额度/模型/连接），自己拼 `h(` 66 次 |
| `providers/workbuddy.js` | 157 | **自带整套面板**（用量/模型），自己拼 `h(` 52 次 |
| 其余 provider | 8–48 | 纯元数据（这才是模块化该有的样子） |

关键数字：`eac-section-head` 在三个文件里各拼一遍（5 / 1 / 2 次）、`role:'switch'` 在
`panels-core` 与 `sensenova` 各写一次、`eac-tag` 共 23 处调用。**没有一个"账号行/模型行"共享原语**。

## 2. 三个结构性缺陷

1. **两套面板系统并存**：`renderPackPanel`（通用分派）与 provider 自带的 `renderPanel`（商汤、WorkBuddy）。
   后者不是"扩展点"，而是**另写一套 UI**：卡片网格、自己的表单、自己的空态。
   ⇒ 每接一个快照型渠道，就复制一遍界面。
2. **渲染与数据耦合在 provider 模块里**：`sensenova.js` / `workbuddy.js` 同时承担
   「渠道元数据 + 状态推导 + 面板渲染 + 表单提交」。规范要求新增平台只写数据与动作，现在做不到。
3. **`store.js` 成了上帝对象**：读、写、缓存、轮询、重试、预取、可见性、家族门控全在一个闭包里，
   任何一处行为改动都要碰它（883 行，且没有子模块边界）。

## 3. 目标结构（下一步重构的依据）

```
src/client/
  kit/                     ← 设计系统（唯一允许拼 JSX 的地方）
    layout.js              Section / SectionHeader / Toolbar / EmptyState / ListBox
    row.js                 Row（账号行/用量行统一模型：主体 / 指标 / 开关 / 展开）
    model-row.js           ModelRow（开关 / 名称+id / 默认参数 / 旧版徽标 / 参数入口）
    controls.js            Switch / Tag / StatusChip / Button / Link / Field / Input
    params.js              参数编辑器（上下文/输出/思考/图片）
  panels/                  ← 通用面板（组合 kit，不认识具体渠道）
    accounts.js            accounts / usage 两种形态由 view-model 决定
    models.js              pack 与家族卡共用，靠 view-model 描述两侧
    channel.js             运行状态 + 渠道开关（含家族双开关）
  providers/               ← 只允许声明数据与动作（禁止 JSX）
    raccoon.js / qodercn.js / trae.js
    sensenova.js / workbuddy.js   ← 提供 view-model：账号行数据、额度块、连接表单描述
  store/
    index.js               对外 API（getSnapshot/subscribe/动作）
    read.js                读取与重试
    cache.js               明细缓存 + 卡片快照
    poll.js                静默刷新 / 可见性
```

**provider 契约（view-model）**：每个渠道模块导出
`{ id, title, caps, panels, status(state), accountRows(state), usageBlocks(state), modelSource(state), connectionForms(state), actions }`，
**不含 `h(...)`**。面板由 `panels/*` 统一渲染，交互（开关位置、展开位置、按钮位置）因此在所有渠道一致。

## 4. 迁移顺序（每步都能独立验收）

1. **抽 kit**：把现有 `.eac-*` 结构抽成 `kit/*` 组件，`panels-core.js` 改为调用它们（行为不变，只搬家）。
   验收：`npm test` 全绿 + 渲染核对 3 屏。
2. **统一 WorkBuddy 用量**：从卡片网格改为 `Row` 列表行 + 展开区（窗口/签到/退出进展开区）。
   验收：WorkBuddy 面板用例改写 + 渲染核对。
3. **统一商汤**：额度池 = `usageBlocks`，连接 = `connectionForms` 描述式渲染。
4. **拆 store**：按 read/cache/poll 拆子模块，`index.js` 仍是唯一对外 API。
5. **回归检查器**：把设计规范 §6 落成测试（分区齐全 / 账号列表行 / 模型列表行 / id 可见 / 名字不含倍率 / 默认启用 / 首屏预热 / 缓存白名单）。

第 2、3 步是用户可见收益（"操作逻辑割裂"），第 1 步是它们的前提，第 4 步降低后续改动成本，第 5 步防回归。
