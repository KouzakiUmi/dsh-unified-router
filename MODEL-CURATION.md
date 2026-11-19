# 模型目录：来源与展示原则

> 本文件记录渠道目录来源。显示名、排序和「恢复推荐」规则见[设计规范 §3](docs/DESIGN-STANDARDS.md#3-模型目录与命名)。

## 目录来源

| 渠道 | 目录来源 | 兜底 |
|---|---|---|
| Loomy | `GET https://loomyad.xunfei.cn/api/v1/models`（Bearer + token） | 7 条实测快照（chat 类） |
| Raccoon 免费 / 订阅 | `GET https://xiaohuanxiong.com/api/web/llm/v2/model_catalog`，**各用本侧账号凭据** | 各 7 条实测快照（订阅 id 带 `-p`） |
| Qoder 中国版 | 官方 CLI `qoderclicn --list-models`（目录端点要专有 WASM 签名） | 14 条实测快照 |
| TRAE | `batch_get_detail_param`（`solo_agent` 通道） | 20 条实测快照 |
| 商汤 Token Plan | `GET https://token.sensenova.cn/v1/models` | 无表（纯上游） |
| WorkBuddy | `agents[cli].models` + `cfg.models` 详情 join | 16 条实测快照 |

## 账号池开关存储

模型启停写入 `state.json` 的 `disabledModels`。缺键使用默认值，`true` 关闭，`false` 显式启用。远端目录成功刷新时，`pool.pruneDisabledModels` 清理已下架模型的开关。

## 2026-11-19 核对

- **Qoder 中国版**使用官方 Credits 参考系数。Qwen4 Max 0.40×、Step 5 Preview 0.30×、Qwen 3.8 Flash 和 MiniMax M3.1 Flash 均 0.10×。官方公告另列正式版 Qwen4 Max 的限时 0.08×，截止时间待公布。CLI 实测返回 14 个名称，未提供倍率。Qwen4 Max Preview 已由正式版接替，官方当前参考表没有列其倍率。[模型选择器](https://docs.qoder.cn/qoder/model-selector) · [Qwen4 Max 上线公告](https://docs.qoder.cn/events/qwen4-max-limited-time-offer)
- **TRAE**使用账号目录下发的生效倍率。个人版官方活动页提供 Seed、DeepSeek 和 GLM 部分型号的基准倍率。DeepSeek V4.1 Flash 的忙时基准为 0.12×，V4 Pro 为 0.72×。账号目录缺少倍率时用已核实的基准值。企业版的 Token 单价仅用于企业产品核对。[个人版折扣与消耗速度](https://docs.trae.cn/ide_limited-time-discount-for-builtin-models) · [企业版计费项](https://docs.trae.cn/enterprise_billing-items?lang=zh)
- **DeepSeek V4 Pro**与较新的 Flash 对比单独核查。DeepSeek 发布资料记录 V4.1 Flash 在智能体测试中的改进，Arena 的 Agent 榜单收录了 1017，Reflection 的同表测试覆盖 DeepSWE 与 Terminal-Bench。推荐结果再用各渠道当时的倍率筛选，例如 WorkBuddy 的 0.51× 对 0.11×，以及 Qoder CN 的 0.50× 对 0.10×。[DeepSeek V4.1 Flash](https://deepseek.com/news/deepseek-v4-1-flash/) · [Agent Arena](https://arena.ai/leaderboard/agent) · [Reflection 技术报告](https://reflection.ai/documents/beam-model-tech-report)
- **其它替代关系**核对渠道上下文、图片能力和订阅实测倍率。GLM 与 MiMo 的编码表现参考 Arena 的 Coding 数据和 Reflection 的 DeepSWE/Terminal-Bench 同表结果。旧版只按明确的型号后继标记。AA 用于交叉核对编码和智能体结果。[Coding Arena](https://arena.ai/leaderboard/chat/text/coding) · [AA v5 评测方法](https://artificialanalysis.ai/es/articles/artificial-analysis-intelligence-index-v5)

## 相关文档

- 兜底表与上游的逐条差异、真拉记录：[docs/CATALOG-AUDIT.md](docs/CATALOG-AUDIT.md)
- Qoder CLI 接入细节：[docs/QODER-CLI.md](docs/QODER-CLI.md)
