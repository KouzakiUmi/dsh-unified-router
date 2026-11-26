# 图像能力

聊天模型的图片输入与独立的生成、编辑模型分开登记。聊天模型开关不会把图片生成模型注册进聊天目录。

## 读取图片拿句柄（`image_read`）

任何渠道都可用的通用工具。**模型看不到对话里图片的附件句柄**（`sha256:…`），而生成/编辑工具的
`references` 要的正是这些句柄 —— 所以需要一个显式的读图工具把句柄印在结果里：

- 省略参数：读用户**这条消息**附带的图片（只取最后一条 user 消息，不翻历史）；
- `path`：读本地 PNG / JPEG / WebP，经宿主附件服务入库后返回新句柄；
- `attachmentId`：读会话里已有的那张。

结果同时返回图片本体和一行 `图片句柄 sha256:…`，模型把它原样填进
`agnes_image_generate` / `sensenova_image_generate` / `bailian_image_generate` 的 `references` 即可改图。
设计参照 `dsh-codex-connect` 的 `view_image`。返回值只写有值的字段：`name` 是可选字段，无名附件
缺席时不写该键（宿主对工具输出做 lossless-JSON 快照，任一 `undefined` 值会让整条结果作废）。

## 会话中的图片呈现

四个图片工具（`agnes_image_generate` / `sensenova_image_generate` / `bailian_image_generate` / `image_read`）
的结果走宿主的 keyed `tool.call.toolview` 槽（按**工具名**分发，不按渠道判断），共用同一个图片卡片
（`src/client/image-tool-view.js`）。呈现参照 `dsh-grok-kit` 的 `MediaCardFrame` 与 `dsh-codex-connect`
的 `ResponsiveCard`：

- **统一外框**：标题 + 状态徽标（进行中 / 已完成 / 失败）+ 规格行（`宽×高 · 格式 · 体积`）。
- **三态正文**：进行中显示提示词 + 进度条 + 「停止等待」；失败显示错误文本 + 「重试」；
  结果媒体优先——有界画廊，缩略图点击开原生 `dialog` 灯箱。
- **灯箱**：1×–4× 缩放（步进 0.5）、放大后拖拽平移、重置、下载、关闭；显示存储尺寸与原始尺寸。
- **操作行**：每张图「下载图片」「复制图片」，外加「复制提示词」「再生成一张」。
- **详情折叠**：提示词全文、图片信息（文件名 / 规格 / `sha256:` 句柄）、结果文本。

图片 URL 由宿主 owner 的 `loadImage(ref)` 提供（Gateway 授权、会话作用域缓存），插件不自行 fetch
附件地址、不生成 Blob、不 revoke 共享 URL。「停止等待 / 重试 / 再生成」经 `sessions.binding(sessionId)`
的 `session.cancel()` / `session.prompt([{type:'text',…}], 'queue')` 发起（注册时经 `ctx.inject(['sessions'])`
注入；服务缺席时这些按钮自动隐藏）。再生成把原提示词与参考图句柄作为跟随文本交回模型再次调用工具。

`ImageToolView` 本体不持有 Hook，交互状态封装在各按钮子组件里（离线 React 桩按调用顺序共享 Hook 槽，
顶层用 Hook 会污染随后单独渲染的预览组件）；静态内容由本体直接渲染，`ImageToolDetails` 是普通函数直接求值。

内置 `read_image` 已独占 `tool.call.images` 子槽，所以这里没有复用那个槽。

## PNG 格式保真（单份保存）

工具规定输出 PNG 时就保存 PNG，**只存一份**（单份 `saveImage`，不另存原图副本）。宿主 `saveImage`
只在「无元数据、8-bit sRGB、未超规范化限」时逐字节直通，否则按有无 alpha 重编码成 JPEG/WebP
（编码阶梯不产出 PNG）。上游生图 PNG 普遍带 `tEXt`/`iTXt`/`eXIf`/`iCCP` 等附加块（含 AIGC 标识），
会被判成带元数据而转码。`lib/image-tools.js` 的 `stripPngMetadata` 只保留解码必需块
（`IHDR`/`PLTE`/`IDAT`/`IEND`/`tRNS`）、丢掉其余附加块，让宿主直通保留 PNG——像素逐字节不变
（已用宿主同款 sharp 0.35.5 对真实上游 PNG 实证：去块前后 raw 像素一致，`carriesMetadata` 由真转假）。
遇到保留集之外的**未知 critical 块**（首字母大写）不擅自丢弃，原样交回上游字节由宿主处理。

文件名扩展名按**宿主返回的 `mediaType`** 算（避免「.png 后缀装 JPEG 字节」）。宿主有两层限额：
**准入硬限**（50MiB / 64MP / 65535px）超限直接拒收；**规范化限**（4MiB / 2048²≈4.19MP / 8192px）
超限缩放或重编码成 JPEG/WebP。工具包络（响应≤40MiB、Agnes≤4K）落在准入限内，超规范化限时
结果以宿主返回的真实类型为准，依旧单份。

## 在对话中生成或编辑

| 渠道 | 工具 | 启用方式 | 已验证能力 |
|---|---|---|---|
| Agnes | `agnes_image_generate` | 保存 API Key，在「渠道」开启「图像生成与编辑」 | [Agnes Image 2.5 Flash](https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash) 的文生图和图生图各返回一张 1024×1024 PNG；可选的 2.1 Flash 仍在上游模型目录中 |
| 阿里云百炼 Token Plan | `bailian_image_generate` | 保存百炼 API Key（`sk-sp-` 开头），在「渠道」开启「图像生成与编辑」 | [qwen-image-3.0-pro](https://www.alibabacloud.com/help/zh/model-studio/qwen-image-generation-and-editing-api-reference) 的文生图与图生图（1–3 张参考图）。实测走 DashScope 同步协议 `POST /api/v1/services/aigc/multimodal-generation/generation`；OpenAI 兼容的 `/compatible-mode/v1/images/generations` 在 Token Plan 域名下回 `400 url error`，图生图把参考图放在 `content` 首位 |
| 商汤 Token Plan | `sensenova_image_generate` | 保存 Token Plan API Key，并开启商汤模型提供方 | [SenseNova U1.5 Lite](https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741) 的生成和编辑接口各返回一张 1024×1024 Base64 图片 |

三款工具均可选分辨率和宽高比，无参考图时文生图；有参考图时接受当前对话中最多 4 个图片附件，主图放第一张。工具不直接读取本地任意路径或远程链接。图片继续作为参考时，使用结果卡片中的附件；宿主缩放图片时记录原始尺寸。
## 其他渠道的图片能力

| 渠道 | 图片输入与生成状态 |
|---|---|
| 小浣熊（免费与订阅）、Qoder 中国版、TRAE、CodeArts | 目录或策展表包含图片输入模型；现有路由没有独立的生图接口。Qoder CLI 只返回模型 ID 和名称，图片字段来自本地策展。 |
| WorkBuddy | 目录包含图片输入模型；其独立生图/改图接口未接入本工具，未重测当前账号与费用。 |
| 云知声 | `u2-flash` 和 `u2-radimed` 已实测附图对话；OCR 是图片理解和抽取，不生成图片。 |
| AStudio | 当前目录没有标记支持图片输入的模型；未接入独立生图接口。 |

图片输入声明按当前渠道目录记录，未逐个执行线上图片推理。Agnes、商汤与百炼的生图、编辑测试与聊天看图能力分开计数。
