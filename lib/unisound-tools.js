// 云知声多模态能力工具（官方 U2 SkillHub 六个模型 Skill 的 Host 移植）。
// 契约来源：skill.unisound.com 公开包 u2-asr-pro / u2-tts-pro / u2-tts-clone-pro /
// u1-ocr-parser-pro / u1-ocr-extract-pro / u1-ocr-med-pro 的脚本（2026-11-20 下载），
// 端点统一走 maas-api.unisound.com；同步 OCR 抽取使用当前 U2 接口的表单契约。
//
// 与官方 Skill 的差异（有意）：
// - 凭据不落盘：调用时经 resolveKey() 从宿主 credentials 服务取 UNIFIED_ROUTER_UNISOUND_API_KEY，
//   不写 .env.local / api-keys.json，Key 不进入返回值与错误文案。
// - 医疗分类候选 prompt 从官方包原样提取（references/medical-classify-prompt.txt）。
// - 输出有界：转写/Markdown 全文超过上限时截断并落盘到 outputDir，返回文件路径。
//
// 注册契约：ctx.tools.register(defineTool(...))（@deepseek-ai/dsh-tools，动态 import，
// 与 apikey-llm.js 的 peer 载入方式一致）。dispose 释放全部注册。
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://maas-api.unisound.com'
const UPLOAD_URL = `${BASE}/v1/files/upload`
const ASR_TASK_URL = `${BASE}/v1/audio/asr/tasks`
const SPEECH_TASK_URL = `${BASE}/v1/audio/speech/tasks`
const VOICE_QUERY_URL = `${BASE}/v1/audio/voices/query`
const VOICE_CLONE_URL = `${BASE}/v1/audio/voices/clone`
const PARSER_TASK_URL = `${BASE}/v1/files/parser/tasks`
const EXTRACT_URL = `${BASE}/v1/ocr/image/extract`
const DOWNLOAD_URL = `${BASE}/v1/files/retrieve_content`

const MAX_INPUT_BYTES = 1024 * 1024 * 1024 // 官方音频上限 1GB
const MAX_EXTRACT_IMAGE_BYTES = 10 * 1024 * 1024
const EXTRACT_IMAGE_TYPES = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.bmp', 'image/bmp']])
const MAX_TEXT_RESULT = 60_000             // 转写/Markdown 直接返回的上限
const MAX_JSON_RESULT = 200_000
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 10 * 60_000
const HTTP_TIMEOUT_MS = 120_000

const AUDIO_FORMATS = new Set(['mp3', 'opus', 'wav', 'amr', 'm4a', 'ogg'])
const ASR_LANGUAGES = ['zh-CN', 'en-US', 'ar-SA', 'de-DE', 'es-MX', 'fr-FR', 'id-ID', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU', 'tr-TR', 'vi-VN', 'th-TH', 'it-IT']

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// 上游业务错误：base_resp.status_code 非 0 即失败。错误文案只带业务码与
// 截断后的 status_msg（上游该字段是短枚举文案，不含凭据）。
function ensureApiSuccess(json, operation) {
  if (!object(json)) throw new Error(`${operation}：上游响应形状异常`)
  const base = object(json.base_resp) ? json.base_resp : {}
  const code = base.status_code
  if (code === undefined || code === null || code === 0) return json
  const msg = typeof base.status_msg === 'string' ? base.status_msg.slice(0, 200) : ''
  throw new Error(`${operation}失败（业务码 ${code}${msg ? `：${msg}` : ''}）`)
}

function taskIdOf(json) {
  const id = json?.task_id ?? json?.task?.task_id ?? json?.data?.task_id ?? json?.id
  if (id === undefined || id === null || String(id) === '') throw new Error('上游未返回 task_id')
  return String(id)
}

function fileIdOf(json) {
  const id = json?.file_id ?? json?.file?.file_id
  if (id === undefined || id === null || String(id) === '') throw new Error('上游未返回 file_id')
  return String(id)
}

function statusOf(json) {
  const raw = json?.status ?? json?.task?.status ?? json?.data?.status
  return typeof raw === 'string' ? raw.toLowerCase() : ''
}
const SUCCESS = new Set(['success', 'succeeded', 'completed', 'done', 'finished'])
const FAILURE = new Set(['failed', 'error', 'cancelled', 'canceled'])

function sleep(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error('已取消'))
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolvePromise() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(new Error('已取消')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// 有界结果：超长文本落盘（outputDir 由装配层给到状态目录），返回路径 + 截断预览。
async function boundedText(text, { outputDir, name, signal }) {
  if (typeof text !== 'string') return { text: '', truncated: false }
  if (text.length <= MAX_TEXT_RESULT) return { text, truncated: false }
  if (outputDir) {
    await mkdir(outputDir, { recursive: true })
    const file = join(outputDir, `${name}-${Date.now()}.txt`)
    await writeFile(file, text, 'utf8')
    signal?.throwIfAborted()
    return { text: text.slice(0, MAX_TEXT_RESULT), truncated: true, file }
  }
  return { text: text.slice(0, MAX_TEXT_RESULT), truncated: true }
}

function createClient({ resolveKey, fetchImpl = globalThis.fetch, outputDir }) {
  const headers = async extra => {
    const key = await resolveKey()
    if (!key) throw new Error('云知声 API Key 未配置，请先在设置页保存 Key')
    return { authorization: `Bearer ${key}`, ...extra }
  }
  const json = async (url, { method = 'GET', body, form, signal, timeoutMs = HTTP_TIMEOUT_MS, operation = '请求' } = {}) => {
    const deadline = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    const init = { method, signal: combined, headers: await headers(form ? {} : { 'content-type': 'application/json' }) }
    if (form) init.body = form
    else if (body !== undefined) init.body = JSON.stringify(body)
    const response = await fetchImpl(url, init)
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`云知声${operation}失败（HTTP ${response.status}）`)
    }
    return response.json()
  }
  const upload = async (filePath, purpose, signal) => {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('输入文件不存在')
    if (info.size > MAX_INPUT_BYTES) throw new Error('输入文件超过 1GB 上限')
    const bytes = await readFile(filePath)
    const form = new FormData()
    form.set('purpose', purpose)
    // 非 ASCII 文件名按官方脚本口径换成 upload.<ext>，避免上游 multipart 解析问题。
    const name = /^[\x20-\x7e]+$/.test(basename(filePath)) ? basename(filePath) : `upload${extname(filePath)}`
    form.set('file', new Blob([bytes]), name)
    return ensureApiSuccess(await json(UPLOAD_URL, { method: 'POST', form, signal }), '文件上传')
  }
  const poll = async (getTask, taskId, signal) => {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let last = null
    for (;;) {
      signal?.throwIfAborted()
      last = ensureApiSuccess(await getTask(taskId, signal), '查询任务')
      const status = statusOf(last)
      if (SUCCESS.has(status)) return last
      if (FAILURE.has(status)) throw new Error(`任务失败（状态 ${status}）`)
      if (Date.now() >= deadline) throw new Error(`任务轮询超时，task_id=${taskId}，可稍后用同 id 查询`)
      await sleep(POLL_INTERVAL_MS, signal)
    }
  }
  return { json, upload, poll, outputDir }
}

/* ------------------------------ 工作流 ------------------------------ */

async function transcribe(client, args, signal) {
  const hasFile = typeof args.file_path === 'string' && args.file_path
  const hasUrl = typeof args.file_url === 'string' && args.file_url
  if (!!hasFile === !!hasUrl) throw new Error('file_path 与 file_url 必须二选一')
  let format = args.format
  if (!format) {
    const source = hasFile ? args.file_path : new URL(args.file_url).pathname
    format = extname(source).toLowerCase().replace(/^\./, '')
  }
  if (!AUDIO_FORMATS.has(format)) throw new Error(`不支持的音频格式 ${format}（支持 ${[...AUDIO_FORMATS].join('/')}）`)
  let fileId
  if (hasFile) fileId = fileIdOf(await client.upload(resolve(args.file_path), 'a2t_async_input', signal))
  const payload = {
    model: 'u2-asr', format, sample_rate: args.sample_rate ?? 16000,
    enable_auto_lang: args.enable_auto_lang === true, enable_itn: args.enable_itn !== false,
    channel: args.channel ?? 1, enable_speaker: args.enable_speaker === true, word_info: args.word_info === true,
    ...(fileId !== undefined ? { file_id: Number(fileId) } : { file_url: args.file_url }),
    ...(args.language ? { language: args.language } : {}),
    ...(args.enable_speaker === true && args.speaker_num ? { speaker_num: args.speaker_num } : {}),
    ...(args.context ? { context: String(args.context).slice(0, 500) } : {}),
    ...(Array.isArray(args.hotwords) && args.hotwords.length ? { hotwords: args.hotwords.slice(0, 200).map(w => String(w).slice(0, 5)) } : {}),
  }
  const created = ensureApiSuccess(await client.json(ASR_TASK_URL, { method: 'POST', body: payload, signal }), '创建转写任务')
  const taskId = taskIdOf(created)
  const final = await client.poll((id, s) => client.json(`${ASR_TASK_URL}/${encodeURIComponent(id)}`, { signal: s }), taskId, signal)
  const results = Array.isArray(final.results) ? final.results : []
  const text = results.map(item => String(item?.text ?? '').trim()).filter(Boolean).join(' ')
  const bounded = await boundedText(text, { outputDir: client.outputDir, name: 'asr', signal })
  return {
    task_id: taskId, status: statusOf(final), duration: final.duration ?? null,
    result_count: results.length, ...bounded,
    ...(args.word_info === true || args.enable_speaker === true ? { details: JSON.stringify(results).slice(0, MAX_JSON_RESULT) } : {}),
  }
}

async function listVoices(client, args, signal) {
  const queried = ensureApiSuccess(await client.json(VOICE_QUERY_URL, { method: 'POST', body: { voice_type: 'all' }, signal }), '查询音色')
  const pick = list => (Array.isArray(list) ? list : []).map(v => ({
    voice_id: String(v?.voice_id ?? ''), name: String(v?.name ?? v?.voice_name ?? ''),
    ...(v?.language ? { language: String(v.language) } : {}), ...(v?.gender ? { gender: String(v.gender) } : {}),
  })).filter(v => v.voice_id)
  return { system_voice: pick(queried.system_voice), voice_cloning: pick(queried.voice_cloning) }
}

async function synthesize(client, args, signal) {
  if (typeof args.text !== 'string' || !args.text.trim()) throw new Error('text 不能为空')
  if (typeof args.voice_id !== 'string' || !args.voice_id) throw new Error('voice_id 不能为空（可先用 unisound_list_voices 查询）')
  const queried = ensureApiSuccess(await client.json(VOICE_QUERY_URL, { method: 'POST', body: { voice_type: 'all' }, signal }), '查询音色')
  const system = (queried.system_voice ?? []).find(v => v?.voice_id === args.voice_id)
  const cloned = (queried.voice_cloning ?? []).find(v => v?.voice_id === args.voice_id)
  if (!system && !cloned) throw new Error(`voice_id ${args.voice_id} 不在可用音色中，先查询音色再选择`)
  const model = system ? 'u2-tts' : 'u2-tts-clone'
  const limit = model === 'u2-tts' ? 50_000 : 20_000
  if (args.text.length > limit) throw new Error(`文本超过 ${model} 的 ${limit} 字上限`)
  const payload = {
    model, text: args.text,
    voice_setting: {
      voice_id: args.voice_id, speed: args.speed ?? 50, volume: args.volume ?? 50,
      pitch: args.pitch ?? 50, bright: 50, language: args.language ?? 'zh',
      ...(args.emotion ? { emotion: args.emotion } : {}),
    },
    audio_setting: { audio_sample_rate: args.sample_rate ?? 32000, format: args.format ?? 'mp3', channel: 1 },
  }
  const created = ensureApiSuccess(await client.json(SPEECH_TASK_URL, { method: 'POST', body: payload, signal }), '创建语音合成任务')
  const taskId = taskIdOf(created)
  const final = await client.poll((id, s) => client.json(`${SPEECH_TASK_URL}?task_id=${encodeURIComponent(id)}`, { signal: s }), taskId, signal)
  const fileId = String(final.file_id ?? created.file_id ?? '')
  if (!fileId) throw new Error('合成完成但上游未返回 file_id')
  // 下载音频落盘：调用方给 output_path 则用之，否则放状态目录。
  const target = args.output_path ? resolve(args.output_path)
    : join(client.outputDir ?? '.', `tts-${taskId}.${args.format ?? 'mp3'}`)
  const deadline = AbortSignal.timeout(HTTP_TIMEOUT_MS)
  const response = await (client.fetchImpl ?? globalThis.fetch)(`${DOWNLOAD_URL}?file_id=${encodeURIComponent(fileId)}`, {
    headers: await client.authHeaders(), signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  })
  if (!response.ok) throw new Error(`下载音频失败（HTTP ${response.status}）`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, bytes)
  return { task_id: taskId, status: statusOf(final), voice_id: args.voice_id, model,
    usage_characters: created.usage_characters ?? null, file: target, bytes: bytes.byteLength }
}

async function cloneVoice(client, args, signal) {
  if (typeof args.voice_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(args.voice_id)) throw new Error('voice_id 需为 1–64 位字母/数字/下划线/连字符')
  if (!!args.prompt_audio_path !== !!args.prompt_text) throw new Error('prompt_audio_path 与 prompt_text 必须成对提供')
  const cloneFileId = fileIdOf(await client.upload(resolve(args.audio_path), 'voice_clone', signal))
  let promptFileId
  if (args.prompt_audio_path) promptFileId = fileIdOf(await client.upload(resolve(args.prompt_audio_path), 'prompt_audio', signal))
  const payload = {
    file_id: Number(cloneFileId), voice_id: args.voice_id, model: 'u2-tts-clone',
    ...(args.text ? { text: args.text } : {}),
    ...(promptFileId !== undefined ? { clone_prompt: { prompt_audio: Number(promptFileId), prompt_text: args.prompt_text } } : {}),
  }
  const cloned = ensureApiSuccess(await client.json(VOICE_CLONE_URL, { method: 'POST', body: payload, signal }), '声音克隆')
  return { voice_id: args.voice_id, demo_audio_present: cloned.demo_audio !== undefined && cloned.demo_audio !== null,
    input_sensitive: cloned.input_sensitive ?? null }
}

async function parseDocument(client, args, signal) {
  const fileId = fileIdOf(await client.upload(resolve(args.file_path), 'ocr_async_input', signal))
  const payload = { file_id: fileId, model: 'u2-ocr',
    ...(args.start_page ? { start_page_id: args.start_page } : {}),
    ...(args.end_page ? { end_page_id: args.end_page } : {}) }
  const created = ensureApiSuccess(await client.json(PARSER_TASK_URL, { method: 'POST', body: payload, signal }), '创建文档解析任务')
  const taskId = taskIdOf(created)
  const final = await client.poll((id, s) => client.json(`${PARSER_TASK_URL}/${encodeURIComponent(id)}`, { signal: s }), taskId, signal)
  let markdown = ''
  if (typeof final.md_file_url === 'string' && final.md_file_url) {
    const response = await (client.fetchImpl ?? globalThis.fetch)(final.md_file_url, { signal })
    if (response.ok) markdown = await response.text()
  }
  const bounded = await boundedText(markdown, { outputDir: client.outputDir, name: 'ocr', signal })
  return { task_id: taskId, status: statusOf(final), num_pages: final.data_info?.num_pages ?? null, ...bounded }
}

let medicalClassifyPrompt = null
async function loadMedicalClassifyPrompt() {
  if (medicalClassifyPrompt === null) {
    medicalClassifyPrompt = await readFile(fileURLToPath(new URL('./unisound-tools-prompts/medical-classify.txt', import.meta.url)), 'utf8')
  }
  return medicalClassifyPrompt
}

async function extractImage(client, args, signal) {
  const taskType = args.task_type ?? 'general_classify'
  const medical = taskType.startsWith('medical_')
  const model = medical ? 'u2-ocr-med' : 'u2-ocr'
  let prompt
  if (taskType === 'general_classify') {
    prompt = '你是一名专业的文档/卡证识别专家。根据传入图片的外观及内容判断这是什么文档，即文档的类别，直接给出分类结果。'
  } else if (taskType === 'medical_classify') {
    prompt = await loadMedicalClassifyPrompt()
  } else {
    if (typeof args.schema !== 'string' || !args.schema.trim()) throw new Error('抽取任务需要 schema（JSON 字符串）')
    let normalized
    try { normalized = JSON.stringify(JSON.parse(args.schema)) } catch { throw new Error('schema 必须是合法 JSON') }
    prompt = `请提取图片中信息，schema如下：${normalized}`
  }
  const imagePath = resolve(args.image_path)
  const mime = EXTRACT_IMAGE_TYPES.get(extname(imagePath).toLowerCase())
  if (!mime) throw new Error('图片格式须为 JPG、JPEG、PNG 或 BMP')
  const info = await stat(imagePath)
  if (!info.isFile() || !info.size) throw new Error('图片文件为空或无效')
  if (info.size > MAX_EXTRACT_IMAGE_BYTES) throw new Error('图片超过 10 MB 上限')
  const bytes = await readFile(imagePath, { signal })
  if (bytes.length > MAX_EXTRACT_IMAGE_BYTES) throw new Error('图片超过 10 MB 上限')
  const form = new FormData()
  form.set('model', model)
  form.set('type', 'image')
  form.set('file', `data:${mime};base64,${bytes.toString('base64')}`)
  form.set('prompt', prompt)
  const extracted = ensureApiSuccess(await client.json(EXTRACT_URL, { method: 'POST', form, signal, operation: '图片信息抽取' }), '图片信息抽取')
  const content = typeof extracted.content === 'string' ? extracted.content : JSON.stringify(extracted.content ?? extracted.data ?? null)
  return { task_type: taskType, model, content: content.slice(0, MAX_JSON_RESULT) }
}

/* ------------------------------ 工具定义 ------------------------------ */

const textOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
}

export function unisoundToolSpecs() {
  return [
    {
      name: 'unisound_transcribe',
      description: '云知声 U2-ASR 语音转写：本地音频文件或公网音频 URL → 带标点文本。支持多语种/方言、说话人分离、热词。异步任务自动轮询到完成；超长转写落盘并返回文件路径。',
      parameters: {
        file_path: { type: 'string', description: '本地音频文件路径（与 file_url 二选一）。格式 mp3/opus/wav/amr/m4a/ogg，1 秒–5 小时，≤1GB' },
        file_url: { type: 'string', description: '公网 HTTP(S) 音频 URL（与 file_path 二选一）' },
        format: { type: 'string', enum: [...AUDIO_FORMATS], description: '音频格式；缺省从文件扩展名推断' },
        language: { type: 'string', enum: ASR_LANGUAGES, description: '指定语种；缺省中文' },
        enable_auto_lang: { type: 'boolean', description: '自动语种识别' },
        enable_speaker: { type: 'boolean', description: '说话人分离' },
        speaker_num: { type: 'integer', description: '说话人数量（须开启 enable_speaker）' },
        word_info: { type: 'boolean', description: '返回词级时间戳' },
        context: { type: 'string', description: '场景上下文（≤500 字），提升专有名词识别' },
        hotwords: { type: 'array', items: { type: 'string' }, description: '热词（≤200 个，每个 ≤5 字）' },
        sample_rate: { type: 'integer', description: '采样率，默认 16000' },
      },
      run: transcribe,
    },
    {
      name: 'unisound_list_voices',
      description: '查询云知声可用音色：系统音色与已克隆音色（voice_id 供 unisound_synthesize 使用）。',
      parameters: {},
      run: listVoices,
    },
    {
      name: 'unisound_synthesize',
      description: '云知声 U2-TTS 语音合成：文本 → 音频文件（u2-tts ≤5 万字；克隆音色 ≤2 万字）。voice_id 先用 unisound_list_voices 查询。音频落盘到 output_path 或状态目录，返回文件路径。',
      parameters: {
        text: { type: 'string', required: true, description: '待合成文本' },
        voice_id: { type: 'string', required: true, description: '音色 ID（系统或已克隆）' },
        output_path: { type: 'string', description: '音频保存路径；缺省存插件状态目录' },
        format: { type: 'string', enum: ['mp3', 'wav', 'pcm', 'opus'], description: '输出格式，默认 mp3' },
        speed: { type: 'integer', description: '语速 0–100，默认 50' },
        volume: { type: 'integer', description: '音量 0–100，默认 50' },
        pitch: { type: 'integer', description: '语调 0–100，默认 50' },
        emotion: { type: 'string', description: '情感（如 happy/sad/neutral，按音色支持）' },
        language: { type: 'string', description: '语言，默认 zh' },
        sample_rate: { type: 'integer', description: '采样率，默认 32000' },
      },
      run: synthesize,
    },
    {
      name: 'unisound_clone_voice',
      description: '云知声声音克隆：上传参考音频（WAV）创建自定义 voice_id，之后可在 unisound_synthesize 使用。可选风格音频+对应文本增强克隆效果。',
      parameters: {
        audio_path: { type: 'string', required: true, description: '待克隆参考音频（WAV，5–15 秒人声）' },
        voice_id: { type: 'string', required: true, description: '自定义音色 ID（1–64 位字母/数字/下划线/连字符）' },
        prompt_audio_path: { type: 'string', description: '风格音频（与 prompt_text 成对）' },
        prompt_text: { type: 'string', description: '风格音频对应文本（与 prompt_audio_path 成对）' },
        text: { type: 'string', description: '试听文本（可选）' },
      },
      run: cloneVoice,
    },
    {
      name: 'unisound_parse_document',
      description: '云知声 U2-OCR 文档解析：JPG/PNG/PDF → Markdown（版式还原、表格、手写）。异步任务自动轮询；超长 Markdown 落盘并返回文件路径。',
      parameters: {
        file_path: { type: 'string', required: true, description: '本地文档路径（jpg/png/pdf/txt）' },
        start_page: { type: 'integer', description: '起始页码（可选）' },
        end_page: { type: 'integer', description: '结束页码（可选）' },
      },
      run: parseDocument,
    },
    {
      name: 'unisound_extract_image',
      description: '云知声图片信息抽取与分类：general_classify 通用文档分类；general_extract 按 JSON schema 结构化抽取；medical_classify / medical_extract 使用 U2-OCR-Med。',
      parameters: {
        image_path: { type: 'string', required: true, description: '本地图片路径（JPG/JPEG/PNG/BMP，≤10 MB）' },
        task_type: { type: 'string', enum: ['general_classify', 'general_extract', 'medical_classify', 'medical_extract'], description: '任务类型，默认 general_classify' },
        schema: { type: 'string', description: '抽取任务的 JSON schema 字符串（*_extract 必填）' },
      },
      run: extractImage,
    },
  ]
}

// 注册全部工具；返回 dispose。tools 服务缺失（旧核心）时抛错由装配层兜底。
export async function registerUnisoundTools({ tools, resolveKey, fetchImpl, outputDir, defineTool }) {
  const client = createClient({ resolveKey, fetchImpl, outputDir })
  client.fetchImpl = fetchImpl ?? globalThis.fetch
  client.authHeaders = async () => {
    const key = await resolveKey()
    if (!key) throw new Error('云知声 API Key 未配置，请先在设置页保存 Key')
    return { authorization: `Bearer ${key}` }
  }
  const disposers = []
  try {
    for (const spec of unisoundToolSpecs()) {
      const definition = defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        timeoutMs: POLL_TIMEOUT_MS + HTTP_TIMEOUT_MS,
        execute: (args, exec) => spec.run(client, args, exec.signal),
      })
      disposers.push(tools.register(definition))
    }
  } catch (error) {
    for (const dispose of disposers) { try { dispose() } catch {} }
    throw error
  }
  return () => { for (const dispose of disposers) { try { dispose() } catch {} } }
}

export { registerUnisoundTools as registerTools }
