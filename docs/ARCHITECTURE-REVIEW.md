# 架构复盘：从「每个渠道一套面板」到统一渲染

> 首次复盘 2026-11-18，2026-11-27 复核。对象：`src/client` + `lib/web-host.js` + `vendor/channel-pack` 的接线。
> 本文档记录当时发现的结构性缺陷与最终落地的结构，供后续改动对照。渠道接入规则见 [CHANNEL-ARCHITECTURE.md](CHANNEL-ARCHITECTURE.md)。

## 1. 当时的问题

目标是**模块化接入各平台**：新增渠道只写数据与动作。但首版实现是「一渠道一段」，UI 组合层没有归一化——每加一个渠道就复制一套交互：

| 症状 | 后果 |
|---|---|
| 两套面板系统并存：通用分派之外，快照型 provider 又自带整套面板 | 每接一个快照型渠道就复制一遍界面 |
| 渲染与数据耦合在 provider 模块里（元数据、状态推导、面板、表单提交混在一起） | 加渠道必须懂渲染，改交互要逐渠道排查 |
| 状态机/请求生命周期/缓存/轮询全部塞在一个 `store.js` 里（883 行） | 任何行为改动都碰上帝对象 |
| 账号行、模型行没有共享原语 | 交互与视觉不一致，回归靠逐渠道手测 |

## 2. 落地后的结构

| 目标 | 现状 |
|---|---|
| 组件层统一 | `src/client/kit/` 是唯一允许拼 JSX 的组件层；`panels-core.js` 渲染账号/模型/渠道三种分区 |
| provider 只声明数据与动作 | `providers/*.js` 只导出元数据、能力声明（`caps`）与视图描述；`providers/pack.js`、`managed.js`、`apikey.js` 提供默认实现 |
| store 拆分 | `src/client/store/{pending,cache,sync,index}.js` 按域拆分，`index.js` 是唯一对外 API |
| 渲染一致性 | 所有渠道共用列表行、开关、展开区与空态；渠道差异只通过 `caps` 与行数据表达 |
| 渠道接入收敛 | `lib/channel-specs.js` 是渠道/方法/能力位的唯一事实源；宿主与客户端两端派生 |
| 防退化 | `test/client-channel-agnostic.test.mjs` 禁止共享层按渠道名分支；`test/channel-method-parity.test.mjs` 锁两端方法集一致性 |

```
src/client/
  kit/                     ← 设计系统（唯一允许拼 JSX 的地方）
    layout.js              Section / SectionHeader / Toolbar / EmptyState / ListBox
    row.js                 Row（账号行 / 用量行统一模型：主体 / 指标 / 开关 / 展开）
    model-row.js           ModelRow（开关 / 名称+id / 默认参数 / 旧版徽标 / 参数入口）
    controls.js            Switch / Tag / StatusChip / Button / Link / Field / Input
    params.js              参数编辑器（上下文 / 输出 / 思考 / 图片）
  panels-core.js           ← 通用面板（组合 kit，不认识具体渠道）
  providers/               ← 只声明数据与动作
    pack.js / managed.js / apikey.js / workbuddy.js   ← 各形态默认视图
    <channel>.js                                        ← 元数据 + 能力声明
  store/                   ← index / sync / cache / pending
```

**provider 契约（view-model）**：每个渠道模块只导出元数据、能力声明与视图函数（`statusFrom` / `accounts` / `models` / `channel`，可选 `snapshot` / `createActions`），不含 `h(...)`。面板由 `panels-core.js` 统一渲染，交互位置因此在所有渠道一致。

## 3. 复核结论

- 首版复盘列出的三个结构性缺陷（两套面板、渲染耦合、store 上帝对象）已全部由 `kit/` + `panels-core.js` + `store/` 拆分解决。
- 「渲染核对亮/暗/窄三种」与「文案/布局规则」已固化进 [DESIGN-STANDARDS.md](DESIGN-STANDARDS.md) §5–§6。
- 后续防退化靠三层守护：`test/client-channel-agnostic.test.mjs`（共享层零渠道分支）、`test/channel-method-parity.test.mjs`（两端清单一致）、`test/web-client.test.mjs`（分区与交互断言）。
