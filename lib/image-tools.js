import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const MODELS = ['agnes-image-2.5-flash', 'agnes-image-2.1-flash']
const SIZES = ['1K', '2K', '3K', '4K']
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']
const MAX_INPUT = 20 * 1024 * 1024
const MAX_RESPONSE = 40 * 1024 * 1024
const TIMEOUT = 360_000
const ENDPOINT = 'https://api.agnes-ai.cn/v1/images/generations'
const HANDLE = /^sha256:[a-f0-9]{64}$/
/** 宿主存储后的 mediaType → 文件名扩展名（宿主会转码，不能沿用上游判定的扩展名）。 */
const EXTENSION_BY_MEDIA_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(PNG)) return ['image/png', 'png']
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg']
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', 'webp']
  return null
}

// 宿主 saveImage 只在「无元数据、8-bit sRGB、未超限」时逐字节直通，否则按
// 有无 alpha 重编码成 JPEG/WebP（编码阶梯不产出 PNG）。上游生图 PNG 普遍带
// tEXt/iTXt/eXIf/iCCP 等附加块（含 AIGC 标识），会被判成带元数据而转码。
// 这里只保留解码必需块、丢掉其余附加块，让宿主直通保留 PNG —— 单份保存，
// 像素不变（实测：去块前后 raw 像素逐字节一致）。超出宿主尺寸/字节上限时
// 仍由宿主规范化，结果以宿主返回的 mediaType 为准。
const PNG_KEEP_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'])
function stripPngMetadata(bytes) {
  const parts = [bytes.subarray(0, 8)]
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > bytes.length) break
    // 未知 critical 块（首字母大写）按 PNG 规范应让解码器拒绝；这里不擅自丢弃，
    // 原样交回上游字节由宿主规范化，避免产出看似合法实则缺关键信息的 PNG。
    const first = type.charCodeAt(0)
    if (!PNG_KEEP_CHUNKS.has(type) && first >= 65 && first <= 90) return bytes
    if (PNG_KEEP_CHUNKS.has(type)) parts.push(bytes.subarray(offset, end))
    offset = end
    if (type === 'IEND') break
  }
  return Buffer.concat(parts)
}

function sessionReferences(session, ids) {
  if (!ids.length) return []
  const found = new Map()
  const wanted = new Set(ids)
  const messages = session?.deriveMessages?.() ?? []
  for (let i = messages.length - 1; i >= 0 && found.size < wanted.size; i--) {
    const content = messages[i]?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const ref = part?.type === 'image' && part.attachment
      if (wanted.has(ref?.attachmentId) && !found.has(ref.attachmentId)) found.set(ref.attachmentId, ref)
    }
  }
  if (found.size !== wanted.size) throw new Error('找不到参考图，请把图片附到当前对话后再试。')
  return ids.map(id => found.get(id))
}


/**
 * 本轮用户消息里附带的图片 id（按出现顺序，最多 `limit` 张）。
 *
 * 只取**最后一条 user 消息**：读图工具要回答「用户刚发的这张图是什么」，
 * 翻历史会把上文的无关图片当成目标。
 */
function latestUserImageIds(session, limit) {
  const messages = session?.deriveMessages?.() ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue
    const content = messages[i]?.content
    if (!Array.isArray(content)) return []
    const ids = []
    for (const part of content) {
      const id = part?.type === 'image' ? part.attachment?.attachmentId : undefined
      if (typeof id === 'string' && HANDLE.test(id) && !ids.includes(id)) ids.push(id)
      if (ids.length >= limit) break
    }
    return ids
  }
  return []
}

/** 读图工具：把图片的 sha256 句柄交给模型，供生成/编辑工具填进 `references`。 */
export const IMAGE_READ_TOOL_NAME = 'image_read'

async function readReference(attachments, ref, remaining, signal) {
  try {
    signal.throwIfAborted()
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || ref.bytes > remaining) throw new Error()
    const { data } = await attachments.readImage(ref, signal)
    if (!(data instanceof Uint8Array) || data.byteLength !== ref.bytes) throw new Error()
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const type = imageType(bytes)
    if (!type) throw new Error()
    return { uri: `data:${type[0]};base64,${bytes.toString('base64')}`, size: bytes.length }
  } catch {
    signal.throwIfAborted()
    throw new Error('参考图无法读取：请使用 PNG、JPEG 或 WebP 对话附件，合计不超过 20 MiB。')
  }
}

async function parseResponse(response, signal, provider) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`${provider} 图片请求失败（HTTP ${response.status}）。`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${provider} 未返回图片数据。`)
  const chunks = []
  let total = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE) throw new Error(`${provider} 图片响应超过 40 MiB。`)
      chunks.push(value)
    }
  } catch (error) {
    signal.throwIfAborted()
    if (total > MAX_RESPONSE) throw error
    throw new Error(`读取 ${provider} 图片响应失败。`)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  let json
  try { json = JSON.parse(Buffer.concat(chunks, total).toString('utf8')) }
  catch { throw new Error(`${provider} 未返回有效的图片响应。`) }
  // 两种响应形状：OpenAI 风格 `data[0].b64_json`，与 DashScope 风格
  // `output.choices[0].message.content[].image`（`response_format:'b64_json'` 时是
  // `data:image/png;base64,…` 形式的 Data URL）。两者都还原成裸 Base64。
  const openAiBase64 = json?.data?.[0]?.b64_json
  const dashscope = Array.isArray(json?.output?.choices?.[0]?.message?.content)
    ? json.output.choices[0].message.content.find(part => typeof part?.image === 'string')?.image
    : undefined
  const raw = typeof openAiBase64 === 'string' ? openAiBase64 : dashscope
  const base64 = typeof raw === 'string' && raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
  if (typeof base64 !== 'string' || !base64.length || base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64)) {
    throw new Error(`${provider} 未返回 Base64 图片。`)
  }
  const bytes = Buffer.from(base64, 'base64')
  const type = imageType(bytes)
  if (!type) throw new Error(`${provider} 返回了无法识别的图片格式。`)
  return { bytes, type }
}

/**
 * 把一次结果包成 image 内容块。
 *
 * ⚠️ **只挑附件字段**：结果对象可能带 `size` 之类额外字段，整块塞进 `attachment`
 * 会让附件引用多出非法键。可选字段（`name`）缺席时不能写成 `undefined`
 *（typert 逐值校验，`x: undefined` 会让整条作废）。
 */
function imageBlock(image) {
  if (!image?.attachmentId) return []
  const attachment = {
    attachmentId: image.attachmentId,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(typeof image.name === 'string' && image.name.length > 0 ? { name: image.name } : {}),
    ...(image.originalDimensions ? { originalDimensions: image.originalDimensions } : {}),
  }
  return [{ type: 'image', attachment }]
}

function choice(values, value, label) {
  if (value === undefined) return values[0]
  if (!values.includes(value)) throw new Error(`${label}无效。`)
  return value
}

function validate(args, spec) {
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt || prompt.length > 8_000) throw new Error('请输入 1 至 8,000 字符的图片描述。')
  const model = choice(spec.models, args.model, '图像模型')
  const size = choice(spec.sizes, args.size, '分辨率')
  const ratio = choice(spec.ratios, args.ratio, '宽高比')
  const refs = args.references ?? []
  if (!Array.isArray(refs) || refs.length > 4 || refs.some(id => typeof id !== 'string' || !HANDLE.test(id))) {
    throw new Error('请选择最多 4 张对话图片附件作为参考。')
  }
  return { model, size, ratio, prompt, refs }
}

async function generate(args, signal, session, { attachments, resolveKey, fetchImpl, spec }) {
  signal.throwIfAborted()
  const { refs, ...params } = validate(args, spec)
  const key = await resolveKey()
  if (!key) throw new Error(`请先在 ${spec.title} 渠道保存 API Key。`)
  const images = []
  let remaining = MAX_INPUT
  for (const ref of sessionReferences(session, refs)) {
    const input = await readReference(attachments, ref, remaining, signal)
    images.push(input.uri)
    remaining -= input.size
  }
  signal.throwIfAborted()
  const { url, body } = spec.request(params, images)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal, redirect: 'error', body: JSON.stringify(body),
    })
  } catch {
    signal.throwIfAborted()
    throw new Error(`无法连接 ${spec.title} 图片接口。`)
  }
  const { bytes, type: [mediaType, extension] } = await parseResponse(response, signal, spec.title)
  signal.throwIfAborted()
  // 工具规定输出 PNG 时就保存 PNG：先去掉附加元数据块让宿主直通，**只存一份**，
  // 不再另存 saveFile 原图。宿主返回的 mediaType 才是落盘的真实格式，文件名扩展名
  // 按它算（避免「.png 后缀装 JPEG 字节」）。
  const data = mediaType === 'image/png' ? stripPngMetadata(bytes) : bytes
  let saved
  try { saved = await attachments.saveImage({ data, mediaType, name: `${spec.id}-image.${extension}` }) }
  catch { throw new Error('图片已生成，但写入对话附件失败。') }
  signal.throwIfAborted()
  const { attachmentId, mediaType: storedType, bytes: storedBytes, width, height, originalDimensions } = saved
  const storedExtension = EXTENSION_BY_MEDIA_TYPE[storedType] ?? extension
  const storedName = `${spec.id}-image.${storedExtension}`
  return { model: params.model, operation: images.length ? 'edit' : 'generate',
    image: { attachmentId, mediaType: storedType, bytes: storedBytes, width, height, name: storedName,
      ...(originalDimensions ? { originalDimensions: { width: originalDimensions.width, height: originalDimensions.height } } : {}) } }
}

const agnes = {
  title: 'Agnes', id: 'agnes', models: MODELS, sizes: SIZES, ratios: RATIOS,
  request: (params, images) => ({ url: ENDPOINT, body: { ...params, ...(images.length ? { extra_body: { image: images, response_format: 'b64_json' } } : { return_base64: true }) } }),
}

/**
 * 阿里云百炼 Token Plan 的图像生成（DashScope 同步协议）。
 *
 * ⚠️ 三个实测出来的要点：
 * - 端点是 `/api/v1/services/aigc/multimodal-generation/generation`，
 *   **不是** OpenAI 兼容的 `/compatible-mode/v1/images/generations`（那条在
 *   Token Plan 域名下回 400 "url error"），也不是 `text2image/image-synthesis`。
 * - 图生图把参考图作为 `content` 数组里的 `{image}` **放在 `{text}` 之前**；
 *   顺序反了或只传 1×1 的占位图都会回 400 InvalidParameter。
 * - `response_format:'b64_json'` 只对 `qwen-image-3.0` 系列有效（wan 系列只回
 *   URL），所以这里只接 qwen-image-3.0-pro，省掉一次下载往返。
 */
const bailian = {
  title: '阿里云百炼', id: 'bailian',
  models: ['qwen-image-3.0-pro'],
  // 输出像素面积 512*512 至 2048*2048：1K/2K 两档安全，3K/4K 会超。
  sizes: ['1K', '2K'],
  ratios: RATIOS,
  request({ model, prompt, size, ratio }, images) {
    const [w, h] = ratio.split(':').map(Number)
    const edge = Number(size[0]) * 1024
    const factor = edge / Math.max(w, h)
    const dimensions = [w, h].map(side => Math.max(512, Math.round(side * factor / 64) * 64)).join('*')
    return {
      url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      body: {
        model,
        input: { messages: [{ role: 'user', content: [...images.map(image => ({ image })), { text: prompt }] }] },
        parameters: { size: dimensions, n: 1, response_format: 'b64_json' },
      },
    }
  },
}

const senseNova = {
  title: '商汤 Token Plan', id: 'sensenova', models: ['sensenova-u1.5-lite'], sizes: SIZES,
  ratios: RATIOS.filter(ratio => ratio !== '21:9'),
  request({ ratio, size, ...params }, images) {
    const [w, h] = ratio.split(':').map(Number)
    const edge = Number(size[0]) * 1024
    const factor = edge / Math.max(w, h)
    const dimensions = [w, h].map(side => Math.round(side * factor / 32) * 32).join('x')
    return { url: `https://token.sensenova.cn/v1/images/${images.length ? 'edits' : 'generations'}`,
      body: { ...params, size: dimensions, n: 1, watermark: true, prompt_extend: false, response_format: 'b64_json',
        ...(images.length ? { images: images.map(image_url => ({ image_url })) } : { output_format: 'png' }) } }
  },
}

export function registerSenseNovaTools(options) { return registerTools({ ...options, spec: senseNova }) }

/** 阿里云百炼 Token Plan 的图像生成/编辑工具。 */
export function registerBailianTools(options) { return registerTools({ ...options, spec: bailian }) }

export function registerTools({ tools, attachments, resolveKey, fetchImpl = globalThis.fetch, defineTool, spec = agnes }) {
  if (typeof attachments?.saveImage !== 'function' || typeof attachments?.readImage !== 'function') {
    throw new Error('宿主图片附件服务未就绪。')
  }
  const lifetime = new AbortController()
  const title = args => `${spec.title} ${args?.references?.length ? '编辑图片' : '生成图片'}`
  const unregister = tools.register(defineTool({
    name: `${spec.id}_image_generate`,
    description: `用 ${spec.title} 生成或编辑一张图片，返回可预览和再次用作参考的对话附件。`
      + '要基于用户发的图改图（图生图）时，**先调 image_read 读那张图拿到 sha256 句柄**，'
      + '再把句柄填进 references —— 你无法直接看到对话里图片的句柄，不要凭猜测填。'
      + '纯文字描述、没有参考图时省略 references 即文生图。',
    parameters: {
      prompt: { type: 'string', required: true, description: '描述要生成的画面。编辑时按参考图顺序说明要修改和保留的内容。' },
      references: { type: 'array', items: { type: 'string' }, description: '改图必填：先用 image_read 读出图片的 sha256 句柄，再按顺序填这里（主图放第一张，最多 4 张）。省略即纯文生图。' },
      model: { type: 'string', enum: spec.models, description: `图像模型，默认 ${spec.models[0]}。` },
      size: { type: 'string', enum: spec.sizes, description: '分辨率档位，默认 1K。' },
      ratio: { type: 'string', enum: spec.ratios, description: '输出宽高比，默认 1:1。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        model: { type: 'string', required: true }, operation: { type: 'string', enum: ['generate', 'edit'], required: true },
        image: { type: 'object', additionalProperties: false, required: true, properties: {
          attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'number', required: true },
          width: { type: 'number', required: true }, height: { type: 'number', required: true }, name: { type: 'string' },
          originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', required: true }, height: { type: 'number', required: true } } },
        } },
      } },
      render: (_args, value) => [{ type: 'text', text: `${value.operation === 'edit' ? '已编辑' : '已生成'} 1 张图片。附件 ID：${value.image.attachmentId}` }, ...imageBlock(value.image)],
      presentationMeta: (_args, value) => ({ image: value.image }),
    },
    presentCall: args => ({ card: 'generic', title: title(args), kind: 'other' }),
    presentResult: (args, result) => result.isError ? undefined : ({ card: 'generic', title: title(args), content: imageBlock(result.meta?.image) }),
    timeoutMs: TIMEOUT + 15_000,
    execute(args, { signal, agent }) {
      return generate(args, AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(TIMEOUT)]), agent?.session, { attachments, resolveKey, fetchImpl, spec })
    },
  }))
  return () => { lifetime.abort(); unregister() }
}

/**
 * 注册**读图工具**（`image_read`）：返回图片本体 + 它的 `sha256:` 句柄。
 *
 * 为什么需要专用工具：模型看不到对话里图片的附件句柄，要求它直接把
 * `sha256:…` 填进生成工具的 `references` 必然失败（用户报障「调用一直失败，
 * 模型不知道如何注入 sha256 让工具读取原图」）。读图工具把句柄显式印在结果
 * 文本里，模型复制即可。设计参照 `dsh-codex-connect` 的 `view_image`。
 *
 * 三种来源：`path`（本地图片）→ `attachments.saveImage` 入库；
 * `attachmentId`（会话里已有）；省略则用用户这条消息附带的图片。
 */
export function registerImageReadTool({ tools, attachments, defineTool, limits }) {
  const maxBytes = Number(limits?.maxImageBytes) > 0 ? limits.maxImageBytes : MAX_INPUT
  const unregister = tools.register(defineTool({
    name: IMAGE_READ_TOOL_NAME,
    description: '读取一张图片并把它的 sha256 句柄交给你。用户发来的图、本地图片都能读；'
      + '句柄可直接填进图像生成/编辑工具的 references 用来改图。省略参数时读用户这条消息附带的图片。',
    // ⚠️ 参数用**扁平字段表**（键即字段名），不是 JSON Schema 的 `properties` 嵌套 ——
    // 本插件的 defineTool 走扁平格式，嵌套写法会在注册期抛
    // `Cannot read properties of undefined (reading 'render')`。
    parameters: {
      attachmentId: { type: 'string', description: '会话里已有图片的 sha256 句柄（形如 sha256:…）。' },
      path: { type: 'string', description: '本地图片的绝对路径。' },
    },
    async execute(args, { signal, agent }) {
      signal.throwIfAborted()
      const session = agent?.session
      const path = typeof args?.path === 'string' ? args.path.trim() : ''
      const explicit = typeof args?.attachmentId === 'string' ? args.attachmentId.trim() : ''
      let ref
      if (path) {
        const data = await readFile(path).catch(() => undefined)
        if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new Error('读不到这个路径的图片。')
        if (data.byteLength > maxBytes) throw new Error('图片超过宿主允许的上限。')
        if (imageType(data) === null) throw new Error('这个文件不是 PNG / JPEG / WebP 图片。')
        // ⚠️ 契约是 `saveImage({data, mediaType, name})`，直接传 Buffer 会失败
        //（生图路径一直是对的，这里曾写错）。
        ref = await attachments.saveImage({ data, mediaType: imageType(data)[0], name: basename(path) })
      } else {
        const id = explicit || latestUserImageIds(session, 1)[0]
        if (!id) throw new Error('没有可读的图片：请先附图，或给出图片的 sha256 句柄。')
        if (!HANDLE.test(id)) throw new Error('图片句柄格式不对，应为 sha256:…。')
        const found = sessionReferences(session, [id])[0]
        if (!found) throw new Error('这张图不在当前对话里，请重新附上。')
        ref = found
      }
      signal.throwIfAborted()
      const size = Number(ref.width) > 0 && Number(ref.height) > 0 ? `${ref.width}×${ref.height}` : '尺寸未知'
      // ⚠️ 返回**业务值**（与生成类工具一致），content 由 render 生成 —— 直接返回
      // `{content, meta}` 与这套 defineTool 的约定不符。
      // ⚠️ 宿主对工具输出做 lossless-JSON 快照：值为 undefined 的属性会让整条结果
      // 作废。name 是可选字段（无名附件缺席），必须条件展开，不能无条件写。
      return {
        attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes,
        width: ref.width, height: ref.height,
        ...(typeof ref.name === 'string' && ref.name ? { name: ref.name } : {}),
        size,
      }
    },
    // ⚠️ `render` / `presentationMeta` 必须挂在 **`output`** 下：`defineTool` 读的是
    // `options.output.render`，放顶层会让 `output` 为 undefined 并在注册期抛
    // `Cannot read properties of undefined (reading 'render')`。
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true },
        bytes: { type: 'number', required: true }, width: { type: 'number', required: true },
        height: { type: 'number', required: true }, name: { type: 'string' }, size: { type: 'string' },
      } },
      // 句柄必须写进文本：模型要把这一串原样填进生成工具的 references。
      render: (_args, value) => [
        { type: 'text', text: `图片句柄 ${value.attachmentId}
${value.size}，${Math.round((value.bytes ?? 0) / 1024)} KB。`
          + '改图/生图时把这个句柄填进 references（主图放第一张）。' },
        ...imageBlock(value),
      ],
      presentationMeta: (_args, value) => ({ image: value }),
    },
    presentResult: (_args, result) => result.isError ? undefined : ({ card: 'generic', title: '读取图片', content: imageBlock(result.meta?.image) }),
    timeoutMs: 60_000,
  }))
  return () => unregister()
}
