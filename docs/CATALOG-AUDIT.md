# 硬编码模型目录 vs 上游真实目录 —— 审计报告

> **Loomy 已于 2026-11-25 随渠道一并移除**：本文里 Loomy 的章节、样本与结论保留为历史记录，不再是当前渠道清单的一部分。

> 审计时间：2026-11-17 上午（Asia/Hong_Kong）。性质：**只读**（未改源码/配置/凭据，未触发登录/续期）。
> 方法：用各渠道已登录账号的**现存 token** 真拉上游目录端点，逐条比对生效兜底表。凭据全程脱敏，报告不含任何 token/key 原文。
> 上游端点：raccoon `GET /api/web/llm/v2/model_catalog`、loomy `GET /api/v1/models`、sensenova `GET /v1/models`、workbuddy `GET /v3/config`、trae `POST /api/ide/v1/batch_get_detail_param`（该渠道目录端点本身是 POST 只读查询）。qoder 因 WASM 签名未实现无法真拉。
> 样本：raccoon 4 账号（2 free / 2 pro）、loomy 4、trae 4、workbuddy 4、sensenova API Key 1。结论限于本次采样账号。

## 1. Raccoon 免费面（`raccoon`）

- 兜底表 `RACCOON_FREE_FALLBACK_MODELS` **2 条**（`vendor/channel-pack/src/raccoon-product.ts`）；上游 **7 条**（2 个免费账号一致；chat 分类 10 条中 3 条 `visible:false` 内部模型）。已核验 HTTP 200 / code=0。
- **兜底有上游无**：无（2 条 id 逐字命中，ctx=256000 / maxOut=63999 一致）。
- **上游有兜底无**（5 条）：`sn-qwen4-max`（0.5，原价 0.75，discount）、`sn-glm-5-3`（0.75）、`sn-kimi-k3`（1）、`sn-glm-5-3-flash`（0.2）、`sn-deepseek-v4-1-flash-1017`（0.25）。免费面兜底只留 2 条是**有意的离线最小集**，不是缺陷，但离线时少 5 个可选。
- **倍率/展示**：兜底名写「· 免费」，上游实际 `limited_free`（原价 0.5 → 生效 0），兜底缺原价。倍率只是展示信息，不是归属判据。

## 2. Raccoon 订阅面（`raccoon-pro`）⚠️ 最严重的 id  mismatch

- 兜底表 `RACCOON_PRO_FALLBACK_MODELS` **4 条**；上游 **8 条**（2 个 pro 账号一致）。已核验。
- **兜底有上游无 —— 4/4 全部不匹配**：上游对**订阅账号**下发的 id 恒带 `-p` 后缀（真实 `model_name`，插件按 `model_name` 原样取 id，见 `raccoon-auth.ts` `parseRaccoonModelCatalog`/`normalizeRemoteModel`）：

  | 兜底 id | 上游订阅面实际 id |
  |---|---|
  | `sn-glm-5-3` | `sn-glm-5-3-p` |
  | `sn-kimi-k3` | `sn-kimi-k3-p` |
  | `sn-glm-5-3-flash` | `sn-glm-5-3-flash-p` |
  | `sn-deepseek-v4-1-flash-1017` | `sn-deepseek-v4-1-flash-1017-p` |

- **上游有兜底无**（8 条）：`sn-sensenova-6-8-flash-p`、`sn-sensenova-6-8-flash-lite-p`（限免，原价 0.5）、`sn-qwen4-max-p`（限免，原价 0.75）、`sn-glm-5-3-p`、`sn-kimi-k3-p`、**`sn-kimi-k3-1-pro-p`（Kimi K3.1 Pro，x1，兜底完全没有）**、`sn-glm-5-3-flash-p`、`sn-deepseek-v4-1-flash-1017-p`。
- **倍率漂移**：兜底名写 `GLM-5-3-Flash · x0.2→x0.1`，上游现 `billing_status=normal`、生效 0.2 → **促销已结束**，兜底仍展示 0.1 折后价。
- **id 语义（用户 2026-11-17 确认）**：`-p` 后缀 = **订阅专属模型**。故兜底表的无后缀 id（`sn-glm-5-3` 等）是免费面 id，订阅面兜底用它们是**确定的缺陷**（不再是「未核验」）：离线兜底命中时订阅面会给出免费面 id，与订阅账号上游目录不符。联机路径恒用上游目录（-p id），不受影响。修复方向：订阅面兜底表 id 改为 `-p` 版本（并补 `sn-kimi-k3-1-pro-p` 等真实订阅模型）。

## 3. Loomy

- 兜底表 `LOOMY_FALLBACK_MODELS` **10 条**（2026-09-26 快照）；上游 chat 6～7 条/账号，4 账号合并 7 条（`type=image` 3 条被过滤）。已核验 4/4。
- **兜底有上游无 —— 4 条**（表里均已标 stale）：`deepseek-v4-flash-0731`（被 `deepseek-v4-flash-1017` 取代）、`MiniMax-M3`、`Kimi-k2.6`、`qwen-3.8-max`。
- **上游有兜底无 —— 1 条**：`deepseek-v4-flash-1017`（显示名 "DeepSeek V4.1 Flash 1017"，x2.0），与 `DeepSeek-V4.1-Flash` 并存为两个 id。
- **参数漂移**：`mimo-v2.5` ctx 1048576 → **1024000**；`auto` 上游无 `context_length`（兜底多报）；其余一致。`maxTokens:393216` 仅兜底有（上游不下发）。
- **账号间差异**：2 个账号上游没有 `auto`（只 6 条 chat），兜底固定含 auto。
- 档位：上游 `default_reasoning_effort=low`，插件有意改 high（设计决定，非漂移）。

## 4. TRAE ⚠️ 最陈旧的一张表

- 兜底表 `TRAE_FALLBACK_MODELS` **32 条**；上游 22 通道 603 条原始 → 去重 113 id → 经插件四道过滤（通道白名单、`usage==='chat_completion'`、`config_switch`、`is_invisible_to_user`）后 **37 条有效**。已核验 4 账号一致。
- **32 条里只有 9 条仍在上游有效目录**。**兜底有上游有效目录无 —— 23 条**：
  - 彻底删除：`explore_sub_agent_v13`。
  - 上游仍在但全标 `is_invisible_to_user=true`（`qwen-3.7-plus` 例外：可见副本只在非白名单通道 builder/chat）：`DeepSeek-V4-Flash-Official`、`seed-code-pro-0430`、`glm-5.2`、`glm-5-turbo`、`kimi-k2.7-code`、`qwen-3.7-plus`、`sagitta`、`aquila`。
  - 兜底 isHidden / usage 不符被插件过滤（联机永远不可见，只可能出现在离线兜底）：`browser_use_subagent`、`explore_sub_agent_v2`、`summary`（usage=summary）、11 个 `custom_model_*`（usage=custom_model）。
- **上游有兜底无 —— 28 条**：`DeepSeek-V4-Pro-Official`、`Doubao-Seed-Code`、`Doubao-Seed-Evolving`、`code-review-judge`、`deepseek-V3`、`deepseek-V3.1`、`deepseek-v4.1-flash`、`doubao-2.0-mini`、`glm-4.7`、`glm-5.1`、`glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5v-turbo`、`kimi-k2.5`、`kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`mimo-v2.6-flash`、`mimo-v2.6-pro`、`minimax-m2.7`、`minimax-m3.1-flash`、`multimodal_image_kimi-k2.5`、`qwen-3.5`、`qwen-3.6-plus`、`qwen3.8-flash`、`qwen3.8-max`、`qwen4-max`、`step-5-preview`。
- **参数漂移**：兜底把 32 条全写成 ctx=200000；上游按通道实为 116000/184000/200000/256000/232768/272000/96000/34096，另有 Max 模式 1M 档（兜底未表达）。交集 9 条中 `Doubao-Seed-2.1-Pro`/`-Turbo`（256k/116k/232768）、`Doubao-Seed-2.0-Code`（184k）不符，`minimax-m3` 部分不符，其余 5 条一致。
- 倍率：上游 `display_contact_config` 携倍率/活动，兜底无价格字段（信息缺失）。
- 后续宿主公开快照复核：`code-review-judge` 和 `multimodal_image_kimi-k2.5` 随公开对话条目返回，辨别须使用真实调用 ID，不能依赖显示名或上游隐藏标志。旧对话模型仍保留在设置目录，确认同目录有后继时不默认启用。

## 5. WorkBuddy

- 内置 `CN_MODELS` **15 条**（`vendor/workbuddy/index.mjs`）；上游 `GET https://copilot.tencent.com/v3/config` → `cfg.agents[cli].models` **16 条**（4 账号一致；`cfg.models` 明细 60 条，插件只投影 cli agent 的 16 条）。已核验 4/4。
- **内置有上游无 —— 8 条**：`hy4-preview-f`、`hy3`、`hy3-x`、`glm-5.1`、`glm-5v-turbo`、`minimax-m3`、`kimi-k2.7`、`kimi-k2.6`。
- **上游有内置无 —— 9 条**：`hy4std`（x0.29）、`hy4flash`（x0.03）、`hy4flash-free`（x0.00）、`space-bunny`（x0.08）、`minimax-m3.1-flash`（x0.08）、`kimi-k3.1-pro`（x0.97）、`kimi-k2.8-preview`（x0.77）、`step-5-preview`（x0.33）、`mimo-v2.6-pro`（x0.13）。
- **参数漂移**：`auto` ctx 168000 → **256000**、out 缺 → 32000；`kimi-k3-1` out 缺 → 32000；其余一致。
- 倍率：内置不含倍率；上游 credits x0.00～x1.62（含限免/夜间促销）。倍率非归属判据。

## 6. SenseNova Token Plan

- **无硬编码模型目录**（已核实）：`lib/sensenova.js` 只从 `llm-models.js` 取 `buildDescriptors`，目录走上游 `GET https://token.sensenova.cn/v1/models`（Bearer API Key）。`llm-models.js` 只有 `FALLBACK_CONTEXT_WINDOW=128e3` 等默认参数。
- 上游实测 HTTP 200，**8 条**：`deepseek-v4-flash`、`deepseek-flash`、`glm-5.2`、`glm-5.3`、`kimi-k3`、`sensenova-6.8-flash`、`sensenova-6.8-flash-lite`、`sensenova-u1.5-lite`（output=image）。无差异可比。

## 7. Qoder 中国版 —— 无法核验

- 硬编码表 `QODER_CN_FALLBACK_MODELS` **11 条**：`auto`、`fast`、`qmodel_38max`、`qfmodel`、`dmodel`、`dfmodel`、`gmodel`、`gfmodel`、`kmodel_latest`、`kmodel`、`mmodel`。
- **目录永远等于这张表**：`QoderAdapter.refreshRemoteModels()` 无条件返回 `{count, source:'fallback'}`，`listModels()` 只读 `product.fallbackModels`（WASM 加密签名未实现）。本审计未尝试绕过。
- 表内 isFree/priceFactor/促销窗口（qmodel_38max 错峰 4 折 22:00–08:00、qfmodel priceFactor 0 + 原价 0.1）与 dmodel/gmodel/kmodel 的 stale 标记全是编译期快照，**无法核验**。

## 8. 死代码与覆盖键失效

- **`vendor/sensenova-token-plan/raccoon-models.js` 的 `RACCOON_FALLBACK_MODELS`（6 条）对本插件是不可达的 vendor 残留**。引用链：raccoon-models.js ← index.js ← lib/sensenova.js（只取 sensenova 导出，不取 raccoon 半）。全仓 grep（lib/src/scripts/test，排除构建产物）：`fetchRaccoonCatalog`/`buildRaccoonDescriptors`/`RACCOON_FALLBACK_MODELS` 零引用；本插件 raccoon 走 channel-pack（backend.ts import raccoon-adapter.ts + raccoon-product.ts）。两张表差异：死代码 6 条混免费+付费、deepseek 用无后缀 `sn-deepseek-v4-1-flash`、maxOut 65536、sn-glm-5-3 vision=false；生效表 2+4 切分、deepseek 用 `-1017`、maxOut 100000、supportsImage=true。
- **`RACCOON_IMAGE_CAPABILITY_OVERRIDES` 覆盖键永不命中（潜在失效，当前无影响）**：键是 `sn-deepseek-v4-1-flash`（无日期后缀）与 `sn-glm-5-3-flash`（raccoon-product.ts），上游现用 `sn-deepseek-v4-1-flash-1017` / `-1017-p` → deepseek 覆盖键不命中；sn-glm-5-3-flash 免费面仍命中、订阅面（-p）不命中。今天无影响（上游 tags 已含 vision）；一旦上游把 vision 从 tags 撤掉，这条兜底失效。

## 9. 总结

**A. 明显过时（离线会给出上游不存在/不可用的模型）**
1. TRAE：32 条中 23 条不在有效目录，另缺 28 个上游新模型 → 建议整表重采。
2. Raccoon 订阅面：4/4 id 与上游命名不一致（-p 后缀），缺 4 个真实模型（含 sn-kimi-k3-1-pro-p）。
3. WorkBuddy：15 条中 8 条下架，缺 9 条在用模型。
4. Loomy：10 条中 4 条下架（均标 stale），缺 deepseek-v4-flash-1017。

**B. 快照漂移（归属仍对，参数/价格过期）**
- Loomy mimo-v2.5 ctx、auto 多报 ctx；WorkBuddy auto ctx；TRAE 全表 ctx 拍平 200k；Raccoon GLM-5-3-Flash 促销文案过期、免费两条缺原价。

**C. 无法核验**
- Qoder CN（WASM 未实现，恒兜底）；Raccoon -p id 实际可调用性（需计费推理，超出只读范围）。

**D. 无硬编码目录**：SenseNova Token Plan（纯上游，8 条）。

## 10. 未覆盖项

- 未验证任何模型能否真正推理（未发 chat/completion，避免计费与副作用）。
- 未审计范围外 product（lobsterai/cline/zcode/opencode/minimax/gemini，未接入）。
- src/client/ 无模型清单副本（grep 未命中模型 id 字面量，只有 provider 元数据与 MODEL_ALIASES 展示别名）。
- 未核验 Loomy 客户端对 spark-x 的 262144 本地覆盖、TRAE Max 模式实际可用性。
- Raccoon 每侧仅 2 账号样本，结论限于当前套餐下这两个账号一致。

## 11. 过程瑕疵披露

读取凭据文件做结构核验时，一段脱敏脚本曾把 `.credentials.yaml` 的 `refs:` 行**前 120 字符**输出到子代理工具日志（含 token 前缀片段，非完整凭据）。本报告与交付消息不含任何凭据值。建议不外传那次工具日志；如有顾虑可重新登录轮换相关凭据（属独立操作，需另行授权）。

## 12. 增补（2026-11-18 真拉）：Raccoon 官方更新逐模型思考深度

主会话用现存凭据真拉 pro/free 两侧 `model_catalog`（HTTP 200），确证两点：

**A. 上游目录已带逐模型思考配置 `params.raccoon_thinking`**（插件 `normalizeRemoteModel` 完全不解析、`raccoonReasoningInfo()` 仍硬编码两档，依据是旧实测「reasoning_effort 无效」——已经过时）：
```
params.raccoon_thinking = { managed:true, supported:true, can_disable:bool,
  display_levels:[{value:"level_1",label:"Minimal"} … {value:"level_5",label:"Max"}],
  default_level:"level_1"|"off" }
```
逐模型档位（free 无 -p / pro 带 -p 同形）：sensenova-6-8-flash 五档 Minimal/Low/Medium/High/Max、can_disable=false、默认 level_1；sensenova-6-8-flash-lite 四档（缺 Medium）、can_disable=true、默认 off；qwen4-max / glm-5-3 / kimi-k3-1-pro / glm-5-3-flash / deepseek-v4-1-flash-1017 多为三档 Minimal/Medium/Max；glm-5-3/kimi-k3-1-pro/glm-5-3-flash can_disable=false 默认 level_1，qwen4-max/deepseek-v4-1-flash-1017 can_disable=true 默认 off。ctx/maxTokens：sensenova 系 256000/63999，其余 1000000/100000。

**B. free/pro 账号上游各见 7 个可见 chat 模型**（不是兜底表的 2/4）：sensenova-6-8-flash、sensenova-6-8-flash-lite、qwen4-max、glm-5-3、kimi-k3-1-pro、glm-5-3-flash、deepseek-v4-1-flash-1017（pro 各带 -p）。兜底表「免费 2 / 订阅 4」是离线最小集且订阅 id 缺 -p，均过时。

**缺口**：目录只给展示档位 display_levels，**请求侧如何发 level 未知**（旧 extra_body.thinking.type 仅 enabled/disabled）。需查官方客户端请求构造或计费探针确证 wire 格式后才能接住逐模型档位（用户已选「查官方请求格式再实现」，raccoon-thinking-wire 子代理进行中）。
## 13. 增补（2026-11-18 实测）：思考档位 wire 格式 + CoT 泄漏根因 + 兜底表重采

### A. 请求字段：**顶层** `raccoon_thinking_level`（三层对照实测）

模型 `sn-qwen4-max-p`（pro 目录生效倍率 0，**本次探针不产生扣费**），判据为响应通道与 `reasoning_tokens`：

| 请求 | 结果 |
|---|---|
| 不发音思参数 | `delta.content` 有值、**无** `reasoning_content`，`reasoning_tokens=0` |
| 顶层 `raccoon_thinking_level:"level_3"` | ✅ `reasoning_content` 独立成通道，`reasoning_tokens=6` |
| `extra_body:{"raccoon_thinking_level":"level_3"}` | ❌ `HTTP 400 param raccoon_thinking_level invalid` |

官方客户端同口径（静态勘察）：box-agent 给 OpenAI SDK 传 `extra_body={'raccoon_thinking_level': level}`，SDK 把它**平铺进顶层 body**；托管路径上**跳过**旧的 `thinking.type` / `reasoning_effort`（两者互斥）。取值原样透传 `level_1`…`level_5` / `off`，客户端不做 token 映射。

### B. 「CoT 泄漏到 assistant」的根因 = 思考实际处于关闭态

会话记录（2026-11-17~18，`sn-qwen4-max-p`）里有 **18 处**正文泄漏规划：`assistant` 消息**只有 `text` 块、没有 `reasoning` 块**，内容形如「Let me add the new design facts to AGENTS.md: 1. …」后接工具调用。

机制：该模型目录 `default_level: "off"`，而插件从未发过 `raccoon_thinking_level`（旧实现只发 `extra_body.thinking`，托管模型不认），于是每次请求都落在**思考关闭**档 —— 这类推理模型没有隐藏草稿区，规划就写进正文。探针 A 行（关闭态）复现：`reasoning_content` 完全为空、`reasoning_tokens=0`。

⇒ 探针的 `level_3` 让规划进入 `reasoning_content`（B 行）。上游默认关闭或偏低时，插件优先选择托管中档（`level_3`），`off` 仍可手动选择。

### C. 兜底表重采（2026-11-18 实测，两侧各 7 条）

免费面（无 `-p`）：`sn-sensenova-6-8-flash`(0×/0.5× 限免至11-30) · `sn-sensenova-6-8-flash-lite`(同) · `sn-qwen4-max`(0.5×/0.75× 折扣至11-22) · `sn-glm-5-3`(0.75×) · `sn-kimi-k3-1-pro`(1×) · `sn-glm-5-3-flash`(0.2×) · `sn-deepseek-v4-1-flash-1017`(0.25×)。

订阅面：同上 7 条但 **id 一律带 `-p`**；其中 `sn-qwen4-max-p` 为限免（0×，活动至11-22）、`sn-sensenova-*-p` 限免至11-30。

与旧表的差异：旧表「免费 2 / 订阅 4」是把同一份目录按倍率切开的历史产物，且订阅 id 缺 `-p`（发出去会走另一条模型线）。§8 记录的「`RACCOON_IMAGE_CAPABILITY_OVERRIDES` 覆盖键永不命中」已修：比对前先剥掉 `-p` 后缀，并补入 `-1017` 形态。

### D. 仍未覆盖

- 各 `level_N` 的服务端 token 预算语义（上游不映射，只能按档位名理解）。
- `off` 档在真实 agentic 长任务上的正文泄漏概率（本次只做了小样本复现，未做大样本统计）。

## 14. 更正与收尾（2026-11-18 二次真拉）：`qwen3.8-max` 从未在 Loomy 上游存在

用户报障「Loomy 里怎么还有不存在的 qwen3.8-max」。**当天再次真拉** `GET https://loomyad.xunfei.cn/api/v1/models`（token + Bearer，现有凭据，只读），返回 **10 条**：

| id | modality | ctx |
|---|---|---|
| spark-x2.6 | chat | 1048576 |
| DeepSeek-V4.1-Flash | chat | 1048576 |
| deepseek-v4-flash-1017 | chat | 1048576 |
| GLM-5.3-Flash | chat | 1048576 |
| qwen3.8-flash | chat | 1000000 |
| Hy-Image-3.5-preview | image | 100000 |
| doubao-seedream-5-lite | image | 128000 |
| qwen-image-3.0-pro | image | null |
| mimo-v2.5 | chat | 1024000 |
| auto | chat | null |

⇒ **本文 §… 的「上游有兜底无」里把 `qwen3.8-max` 算作 Loomy 上游模型是错误归因**（那一批清单混入了其它渠道的样本）；Loomy 上游从未下发该 id。当前兜底表 7 条与上游 chat 目录**逐条一致**（另有 3 条 image 模型不属本插件的 chat 目录）。

### 真正的根因：不是兜底表，是黑名单复活

- `~/.dsh/channel-pack/state.json` 的 `disabledModels.loomy` 里有历史残留 `{"qwen-3.8-max": true}`（旧兜底表时代的开关记录）。
- `model.list` 旧实现有一条「保底」逻辑：把「黑名单里有、当前目录里没有」的 id 用裸 id 补成一行（`catalog.push({ id, name: id })`）。
- ⇒ 一个**上游已不存在、兜底表里也没有**的 id，仅凭历史状态就被复活成设置页里的一行模型。

### 修法（内部迭代 0.9.3，已并入 0.3.0）

1. 删掉黑名单补回逻辑：目录只认适配器的 `listAllModels()`（不套黑名单的全量目录），黑名单只用于标记 `disabled`；「已失效」仍走独立 dead 表路径（`dead: true` + `model.clearDead`），那是用户恢复入口。
2. 目录来自**远端真拉**时（适配器 `isRemoteCatalog()`），`model.list` 调 `pool.pruneDisabledModels()` 把目录里已不存在的黑名单键删掉并落盘；兜底目录不剪（精选子集 ≠ 上游全量，剪了会误删表外模型偏好）。
3. 回归用例 `test/model-blacklist-hygiene.test.mjs`（3 条）：过期 id 不进列表 / 远端目录后剪枝且保留真实模型的偏好 / 退回兜底时不剪。

### 各渠道硬编码表当前状态（同日核对）

| 渠道 | 兜底表 | 与上游的核对结论 |
|---|---|---|
| Loomy | 7 条 | ✅ 与真拉 chat 目录逐条一致 |
| Raccoon | 免费 7 / 订阅 7 | ✅ 与真拉目录一致（订阅 id 带 `-p`） |
| TRAE | 20 条 | 2026-11-18 以 `solo_agent` 真拉重建（含上游仍在列的 `minimax-m3`） |
| WorkBuddy | 16 条 | 2026-11-18 按 live `agents[cli].models` + `cfg.models` join 重建 |
| Qoder CN | 12 条 | ⚠️ 目录端点需专有 WASM 签名，无法只读核验；优先走官方 CLI，表仅作 CLI 不可用时的策展目录 |
| 商汤 Token Plan | 无模型表 | 纯上游 `GET /v1/models` |

> 兜底表只在「拉不到上游」（未登录 / 网络失败）时兜底；它存在的意义是不让离线状态把渠道整个隐藏。**它不得成为上游目录的替代真相** —— 上面那个补回逻辑就是越界后的产物。
