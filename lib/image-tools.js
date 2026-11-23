const MODELS = ['agnes-image-2.5-flash', 'agnes-image-2.1-flash']
const SIZES = ['1K', '2K', '3K', '4K']
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']
const MAX_INPUT = 20 * 1024 * 1024
const MAX_RESPONSE = 40 * 1024 * 1024
const TIMEOUT = 360_000
const ENDPOINT = 'https://api.agnes-ai.cn/v1/images/generations'
const HANDLE = /^sha256:[a-f0-9]{64}$/
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(PNG)) return ['image/png', 'png']
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg']
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', 'webp']
  return null
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
  const base64 = json?.data?.[0]?.b64_json
  if (typeof base64 !== 'string' || !base64.length || base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64)) {
    throw new Error(`${provider} 未返回 Base64 图片。`)
  }
  const bytes = Buffer.from(base64, 'base64')
  const type = imageType(bytes)
  if (!type) throw new Error(`${provider} 返回了无法识别的图片格式。`)
  return { bytes, type }
}

function imageBlock(image) {
  return image?.attachmentId ? [{ type: 'image', attachment: image }] : []
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
  const name = `${spec.id}-image.${extension}`
  let saved
  try { saved = await attachments.saveImage({ data: bytes, mediaType, name }) }
  catch { throw new Error('图片已生成，但写入对话附件失败。') }
  signal.throwIfAborted()
  const { attachmentId, mediaType: storedType, bytes: storedBytes, width, height, originalDimensions } = saved
  return { model: params.model, operation: images.length ? 'edit' : 'generate', image: { attachmentId, mediaType: storedType, bytes: storedBytes, width, height, name,
    ...(originalDimensions ? { originalDimensions: { width: originalDimensions.width, height: originalDimensions.height } } : {}) } }
}

const agnes = {
  title: 'Agnes', id: 'agnes', models: MODELS, sizes: SIZES, ratios: RATIOS,
  request: (params, images) => ({ url: ENDPOINT, body: { ...params, ...(images.length ? { extra_body: { image: images, response_format: 'b64_json' } } : { return_base64: true }) } }),
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

export function registerTools({ tools, attachments, resolveKey, fetchImpl = globalThis.fetch, defineTool, spec = agnes }) {
  if (typeof attachments?.saveImage !== 'function' || typeof attachments?.readImage !== 'function') {
    throw new Error('宿主图片附件服务未就绪。')
  }
  const lifetime = new AbortController()
  const title = args => `${spec.title} ${args?.references?.length ? '编辑图片' : '生成图片'}`
  const unregister = tools.register(defineTool({
    name: `${spec.id}_image_generate`,
    description: `用 ${spec.title} 生成或编辑一张图片，返回可预览和再次用作参考的对话附件。`,
    parameters: {
      prompt: { type: 'string', required: true, description: '描述要生成的画面。编辑时按参考图顺序说明要修改和保留的内容。' },
      references: { type: 'array', items: { type: 'string' }, description: '最多 4 张当前对话图片的 attachmentId，按顺序提供，主图放第一张；省略则文生图。' },
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
