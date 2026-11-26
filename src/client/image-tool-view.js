// 会话图片工具卡片。keyed 槽按工具名分派（不是按当前模型/渠道）。
// 呈现参照 dsh-grok-kit 的 MediaCardFrame 与 dsh-codex-connect 的 ResponsiveCard：
// 统一外框（标题 + 状态徽标 + 规格行），三态正文（进行中 / 失败 / 结果），
// 结果媒体优先（有界画廊 + 缩放灯箱 + 下载/复制/再生成），长文本折进详情。
// 图片 URL 一律走 owner 传入的宿主 loadImage（Gateway 授权、会话级缓存），
// 本视图不自行 fetch 附件地址、也不 revoke 共享 object URL。
//
// ⚠️ ImageToolView 本体**不持有 Hook**：交互状态都封装在子组件里（以元素形式
// 渲染）。离线 React 桩按调用顺序共享 Hook 槽，顶层若用 Hook 会污染随后单独
// 渲染的 ImageToolPreview。静态内容（状态徽标/规格/画廊/错误文本/详情）由本体
// 直接渲染，交互按钮各自独立。
const IMAGE_TOOL_SLOT = 'tool.call.toolview'
const IMAGE_TOOLS = {
  agnes_image_generate: { title: 'Agnes 图片', kind: 'generate' },
  sensenova_image_generate: { title: '商汤 Token Plan 图片', kind: 'generate' },
  bailian_image_generate: { title: '阿里云百炼图片', kind: 'generate' },
  image_read: { title: '读取图片', kind: 'read' },
}
const IMAGE_TOOL_EXTENSIONS = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
])
const IMAGE_MIN_ZOOM = 1
const IMAGE_MAX_ZOOM = 4
const IMAGE_ZOOM_STEP = 0.5

function imageToolMeasure(value) { return Number.isSafeInteger(value) && value > 0 }

function imageToolRefs(content) {
  const refs = new Map()
  if (!Array.isArray(content)) return []
  for (const part of content) {
    const ref = part?.type === 'image' ? part.attachment : undefined
    if (typeof ref?.attachmentId !== 'string' || !ref.attachmentId || !IMAGE_TOOL_EXTENSIONS.has(ref.mediaType)) continue
    if (![ref.bytes, ref.width, ref.height].every(imageToolMeasure) || refs.has(ref.attachmentId)) continue
    refs.set(ref.attachmentId, ref)
  }
  return [...refs.values()]
}

function imageToolFilename(ref) {
  const extension = IMAGE_TOOL_EXTENSIONS.get(ref.mediaType)
  const name = typeof ref.name === 'string' ? ref.name.split(/[/\\]/).at(-1).trim() : ''
  const stem = name.replace(/\.[a-z0-9]+$/i, '') || '图片'
  return `${stem}.${extension}`
}

function imageToolFormat(mediaType) {
  return mediaType === 'image/jpeg' ? 'JPEG' : String(mediaType).slice(6).toUpperCase()
}

function imageToolBytes(bytes) {
  if (!imageToolMeasure(bytes)) return ''
  if (bytes < 1e3) return `${bytes} B`
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(bytes < 1e4 ? 1 : 0)} KB`
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`
}

function imageToolSpec(ref) {
  return `${ref.width}×${ref.height} · ${imageToolFormat(ref.mediaType)} · ${imageToolBytes(ref.bytes)}`
}

// 调用参数：优先用宿主惰性读取器 block.args（preparing/start/result 三态通用），
// 回退到 argsRaw / call.argsRaw 的 JSON。读取器缺席或字段缺失时返回空值，不抛错。
function imageToolArgs(block) {
  const args = block?.args
  const readText = key => {
    if (args && typeof args.text === 'function') {
      const value = args.text(key)
      if (typeof value === 'string') return value
    }
    return undefined
  }
  let parsed
  const raw = typeof block?.argsRaw === 'string' ? block.argsRaw
    : typeof block?.call?.argsRaw === 'string' ? block.call.argsRaw : ''
  if (raw) { try { parsed = JSON.parse(raw) } catch { parsed = undefined } }
  const prompt = readText('prompt') ?? (typeof parsed?.prompt === 'string' ? parsed.prompt : '')
  let references = args && typeof args.value === 'function' ? args.value('references') : undefined
  if (!Array.isArray(references)) references = Array.isArray(parsed?.references) ? parsed.references : []
  references = references.filter(id => typeof id === 'string' && id)
  return { prompt: prompt.trim(), references }
}

function imageToolText(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text.trim()).filter(Boolean).join('\n')
}

// 再生成/重试的跟随提示词：把原提示词与参考图句柄交回模型，由模型再次调用工具。
function imageToolFollowUp(toolName, args) {
  const head = args.references.length ? '按这些参考图再编辑一张图片' : '再生成一张图片'
  const refs = args.references.length ? `\n参考图句柄：${args.references.join('、')}` : ''
  return `${head}，使用 ${toolName}，提示词：\n${args.prompt}${refs}`
}

function imageToolDownload(src, name) {
  return h('a', { className: 'eac-button', href: src, download: name }, '下载图片')
}

function imageToolTriggerDownload(src, name) {
  const anchor = document.createElement('a')
  anchor.href = src
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.append(anchor)
  try { anchor.click() } finally { anchor.remove() }
}

// 会话动作按钮（停止等待 / 重试 / 再生成）。sessions 与 sessionId 齐备才渲染；
// 自带 pending/failed 反馈。取消走 session.cancel，跟随走 session.prompt(…, 'queue')。
function ImageToolSessionButton({ sessionId, sessions, mode, content, label, busyLabel, primary }) {
  const [state, setState] = React.useState('idle')
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const enabled = typeof sessionId === 'string' && sessionId !== '' && sessions && typeof sessions.binding === 'function'
  if (!enabled) return null
  const onClick = () => {
    if (state === 'pending') return
    const session = sessions.binding(sessionId)?.session
    if (!session) { setState('failed'); return }
    setState('pending')
    Promise.resolve()
      .then(() => mode === 'cancel' ? session.cancel() : session.prompt([{ type: 'text', text: content }], 'queue'))
      .then(result => { if (alive.current) setState(result?.ok === true ? 'idle' : 'failed') })
      .catch(() => { if (alive.current) setState('failed') })
  }
  return h('button', {
    type: 'button', className: primary ? 'eac-button eac-image-primary' : 'eac-button',
    disabled: state === 'pending', 'aria-busy': state === 'pending', onClick,
  }, state === 'pending' ? busyLabel : state === 'failed' ? '操作失败' : label)
}

// 操作行下载：src 尚未加载，点击时经宿主 loadImage 取 URL 再触发浏览器下载。
function ImageToolDownloadButton({ attachment, loadImage }) {
  const [state, setState] = React.useState('idle')
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const download = () => {
    if (state === 'pending') return
    setState('pending')
    Promise.resolve().then(() => loadImage(attachment))
      .then(src => { imageToolTriggerDownload(src, imageToolFilename(attachment)); if (alive.current) setState('idle') })
      .catch(() => { if (alive.current) setState('failed') })
  }
  const label = state === 'pending' ? '下载中…' : state === 'failed' ? '下载失败' : '下载图片'
  return h('button', { type: 'button', className: 'eac-button', disabled: state === 'pending', 'aria-busy': state === 'pending', onClick: download }, label)
}

function ImageToolCopyImage({ attachment, loadImage }) {
  const [state, setState] = React.useState('idle')
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  React.useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => { if (alive.current) setState('idle') }, 2000)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { setState('failed'); return }
    setState('pending')
    Promise.resolve().then(() => loadImage(attachment))
      .then(src => fetch(src)).then(response => response.blob())
      .then(blob => navigator.clipboard.write([new ClipboardItem({ [blob.type || attachment.mediaType]: blob })]))
      .then(() => { if (alive.current) setState('copied') })
      .catch(() => { if (alive.current) setState('failed') })
  }
  const label = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : state === 'pending' ? '复制中…' : '复制图片'
  return h('button', { type: 'button', className: 'eac-button', disabled: state === 'pending', 'aria-busy': state === 'pending', onClick: copy }, label)
}

function ImageToolCopyPrompt({ prompt }) {
  const [state, setState] = React.useState('idle')
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  React.useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => { if (alive.current) setState('idle') }, 2000)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    if (!navigator.clipboard?.writeText) { setState('failed'); return }
    setState('pending')
    Promise.resolve().then(() => navigator.clipboard.writeText(prompt))
      .then(() => { if (alive.current) setState('copied') })
      .catch(() => { if (alive.current) setState('failed') })
  }
  const label = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制提示词'
  return h('button', { type: 'button', className: 'eac-button', onClick: copy }, label)
}

// 单张图片：缩略图 + 原生 <dialog> 灯箱（缩放 / 平移 / 下载 / 关闭）。
function ImageToolPreview({ attachment, loadImage }) {
  const [attempt, setAttempt] = React.useState(0)
  const [state, setState] = React.useState(null)
  const [zoom, setZoom] = React.useState(IMAGE_MIN_ZOOM)
  const [dragging, setDragging] = React.useState(false)
  const dialog = React.useRef(null)
  const viewport = React.useRef(null)
  const drag = React.useRef(null)
  const id = attachment.attachmentId
  React.useEffect(() => {
    let active = true
    Promise.resolve().then(() => loadImage(attachment)).then(src => {
      if (typeof src !== 'string' || (!src.startsWith('blob:') && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src))) {
        throw new Error('Invalid session image URL')
      }
      if (active) setState({ id, loadImage, attempt, src })
    }).catch(() => { if (active) setState({ id, loadImage, attempt, failed: true }) })
    return () => { active = false }
  }, [id, loadImage, attempt])
  React.useEffect(() => {
    if (zoom === IMAGE_MIN_ZOOM && viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 }
  }, [zoom])

  const current = state?.id === id && state.loadImage === loadImage && state.attempt === attempt ? state : null
  const { src, failed } = current ?? {}
  const name = imageToolFilename(attachment)
  const size = `${attachment.width} × ${attachment.height} px`
  const original = attachment.originalDimensions
  const hasOriginalSize = imageToolMeasure(original?.width) && imageToolMeasure(original?.height)
    && (original.width !== attachment.width || original.height !== attachment.height)
  const openLightbox = () => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }
  const closeLightbox = () => { if (dialog.current?.open) dialog.current.close() }
  const zoomBy = delta => setZoom(value => Math.min(IMAGE_MAX_ZOOM, Math.max(IMAGE_MIN_ZOOM, value + delta)))

  const beginDrag = event => {
    if (zoom === IMAGE_MIN_ZOOM || event.button !== 0 || !viewport.current) return
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      scrollLeft: viewport.current.scrollLeft, scrollTop: viewport.current.scrollTop }
    viewport.current.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }
  const moveDrag = event => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId || !viewport.current) return
    viewport.current.scrollLeft = start.scrollLeft - (event.clientX - start.clientX)
    viewport.current.scrollTop = start.scrollTop - (event.clientY - start.clientY)
    event.preventDefault()
  }
  const endDrag = event => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (viewport.current?.hasPointerCapture?.(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const preview = failed
    ? h('div', { className: 'eac-image-placeholder' }, h('span', { role: 'status' }, '图片加载失败'),
      h('button', { type: 'button', className: 'eac-button', onClick: () => setAttempt(value => value + 1) }, '重试'))
    : src
      ? h('button', { type: 'button', className: 'eac-image-thumb', 'aria-label': `查看大图：${name}`, 'aria-haspopup': 'dialog', onClick: openLightbox },
        h('img', { src, alt: name, decoding: 'async', onError: () => setState({ id, loadImage, attempt, failed: true }) }))
      : h('div', { className: 'eac-image-placeholder', role: 'status' }, '正在加载图片…')

  const lightbox = src ? h('dialog', {
    className: 'eac-image-dialog', ref: dialog, 'aria-label': `图片预览：${name}`,
    onClick: event => { if (event.target === event.currentTarget) closeLightbox() },
    onClose: () => { setZoom(IMAGE_MIN_ZOOM); setDragging(false) },
  },
  h('div', { className: 'eac-image-dialog-content' },
    h('div', { className: 'eac-image-dialog-bar' },
      h('div', { className: 'eac-image-zoom' },
        h('button', { type: 'button', className: 'eac-button', 'aria-label': '缩小', disabled: zoom === IMAGE_MIN_ZOOM, onClick: () => zoomBy(-IMAGE_ZOOM_STEP) }, '−'),
        h('span', null, `${Math.round(zoom * 100)}%`),
        h('button', { type: 'button', className: 'eac-button', 'aria-label': '放大', disabled: zoom === IMAGE_MAX_ZOOM, onClick: () => zoomBy(IMAGE_ZOOM_STEP) }, '+'),
        h('button', { type: 'button', className: 'eac-button', disabled: zoom === IMAGE_MIN_ZOOM, onClick: () => setZoom(IMAGE_MIN_ZOOM) }, '重置')),
      h('span', { className: 'eac-image-dialog-size' }, hasOriginalSize ? `${size}（原尺寸 ${original.width} × ${original.height} px）` : size),
      imageToolDownload(src, name),
      h('button', { type: 'button', className: 'eac-button', onClick: closeLightbox }, '关闭')),
    h('div', {
      className: 'eac-image-viewport', ref: viewport,
      style: { cursor: zoom === IMAGE_MIN_ZOOM ? 'zoom-in' : dragging ? 'grabbing' : 'grab' },
      onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag,
      onClick: () => { if (zoom === IMAGE_MIN_ZOOM) zoomBy(IMAGE_ZOOM_STEP) },
    },
    h('div', { style: { width: `${zoom * 100}%`, height: `${zoom * 100}%` } },
      h('img', { src, alt: name, draggable: false }))))) : null

  return h('figure', { className: 'eac-image-figure' }, preview, lightbox)
}

function ImageToolDetails({ args, images, resultText }) {
  const hasPrompt = args.prompt !== ''
  const hasInfo = images.length > 0
  const hasText = resultText !== ''
  if (!hasPrompt && !hasInfo && !hasText) return null
  return h('details', { className: 'eac-image-details' },
    h('summary', null, '详细信息'),
    h('div', { className: 'eac-image-details-body' },
      hasPrompt ? h('section', { className: 'eac-image-section' },
        h('strong', null, '提示词'), h('pre', { className: 'eac-image-prompt' }, args.prompt)) : null,
      hasInfo ? h('section', { className: 'eac-image-section' },
        h('strong', null, '图片信息'),
        images.map(ref => h('div', { key: ref.attachmentId, className: 'eac-image-info' },
          h('span', null, `${imageToolFilename(ref)} · ${imageToolSpec(ref)}`),
          h('span', { className: 'eac-image-handle' }, ref.attachmentId)))) : null,
      hasText ? h('section', { className: 'eac-image-section' },
        h('strong', null, '结果文本'), h('pre', { className: 'eac-image-prompt' }, resultText)) : null))
}

function ImageToolView(props) {
  const owner = props.owner ?? props
  const { phase, block, loadImage, toolName, sessionId } = owner
  const sessions = props.sessions
  const title = props.imageToolTitle
  const kind = props.imageToolKind ?? 'generate'
  const settled = phase === 'result' || (phase === undefined && block?.kind === 'tool-result')
  const failed = settled && block?.isError === true
  const images = settled && !failed ? imageToolRefs(block?.content) : []
  const args = imageToolArgs(block)
  const resultText = settled ? imageToolText(block?.content) : ''
  const isGenerate = kind === 'generate'
  const status = !settled
    ? { label: isGenerate ? '生成中…' : '读取中…', tone: 'busy' }
    : failed ? { label: '失败', tone: 'error' } : { label: '已完成', tone: 'success' }
  const specLine = images.map(imageToolSpec).join('  ·  ')
  const sessionProps = { sessionId, sessions }
  const followUp = imageToolFollowUp(toolName, args)

  let body
  if (!settled) {
    body = h('div', { className: 'eac-image-pending' },
      args.prompt ? h('pre', { className: 'eac-image-prompt' }, args.prompt)
        : h('span', { className: 'eac-image-muted', role: 'status' }, '正在接收参数…'),
      h('progress', { className: 'eac-image-progress', 'aria-label': status.label }),
      phase === 'start' ? h(ImageToolSessionButton, { ...sessionProps, mode: 'cancel', label: '停止等待', busyLabel: '停止中…' }) : null)
  } else if (failed) {
    body = h('div', { className: 'eac-image-error' },
      h('p', { role: 'alert' }, resultText || '图片工具调用失败。'),
      isGenerate && args.prompt ? h(ImageToolSessionButton, { ...sessionProps, mode: 'prompt', content: followUp, label: '重试', busyLabel: '发送中…' }) : null)
  } else if (images.length > 0) {
    body = h('div', { className: 'eac-image-done' },
      h('div', { className: 'eac-image-gallery' }, images.map(ref =>
        h(ImageToolPreview, { key: ref.attachmentId, attachment: ref, loadImage }))),
      h('div', { className: 'eac-image-actions' },
        images.flatMap(ref => [
          h(ImageToolDownloadButton, { key: `dl:${ref.attachmentId}`, attachment: ref, loadImage }),
          h(ImageToolCopyImage, { key: `copy:${ref.attachmentId}`, attachment: ref, loadImage }),
        ]),
        args.prompt ? h(ImageToolCopyPrompt, { prompt: args.prompt }) : null,
        isGenerate && args.prompt ? h(ImageToolSessionButton, { ...sessionProps, mode: 'prompt', content: followUp, label: '再生成一张', busyLabel: '发送中…', primary: true }) : null),
      ImageToolDetails({ args, images, resultText }))
  } else {
    body = h('p', { role: 'status' }, resultText || '没有可预览的图片。')
  }

  return h('section', { className: 'eac-image-result', 'aria-label': title },
    h('header', { className: 'eac-image-head' },
      h('strong', { className: 'eac-image-title' }, title),
      h('span', { className: 'eac-image-status', 'data-tone': status.tone, role: 'status' }, status.label)),
    specLine ? h('div', { className: 'eac-image-spec' }, specLine) : null,
    body)
}

export function registerImageToolViews(ctx) {
  const register = (scope, sessions) => {
    scope.slots.inject(IMAGE_TOOL_SLOT, function* () {
      for (const [key, meta] of Object.entries(IMAGE_TOOLS)) {
        yield scope.slots.register({
          name: IMAGE_TOOL_SLOT, key,
          inject: () => ({ imageToolTitle: meta.title, imageToolKind: meta.kind, sessions }),
        }, ImageToolView)
      }
    })
  }
  // 会话动作依赖 sessions 服务；经子 fiber 注入，注册随其卸载。无 inject 的
  // 测试上下文直接挂载（sessions 缺席时卡片自动隐藏停止/再生成动作）。
  if (typeof ctx.inject === 'function') ctx.inject(['sessions'], scope => register(scope, scope.sessions))
  else register(ctx, undefined)
}