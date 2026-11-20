// 离线视觉验收：执行 lib/client.js 里的真实设置页组件，数据全部虚构，输出静态 HTML，
// 再用本机 Chrome 无头截图。用于核对亮色、暗色与窄屏，以及生成 README 预览图；
// 不连接 DSH、不读取凭据。
//
// 用法：node scripts/render-preview.mjs <light|dark> <宽度> <渠道 id> <分区 models|accounts|advanced> <输出名>
// 例：  node scripts/render-preview.mjs dark 560 agnes models agnes-models-dark
// 产物：assets/preview/<输出名>.png（环境变量 PREVIEW_KEEP_HTML=1 时同时保留 .html）
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [theme = 'light', widthArg = '560', providerId = 'loomy', panelId = 'models', outName = 'preview'] = process.argv.slice(2)
const width = Number(widthArg) || 560
const tick = () => new Promise(resolveTick => setImmediate(resolveTick))

// ---- React 桩：根组件有状态，子组件（kit 之外的函数组件）无状态求值 ----
function reactStub() {
  const hooks = []; let cursor = 0; const scheduled = []; let stateless = false
  return {
    Fragment: 'fragment',
    begin() { cursor = 0; stateless = false }, flush() { for (const run of scheduled.splice(0)) run() },
    freeze() { stateless = true },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      if (stateless) return [typeof initial === 'function' ? initial() : initial, () => {}]
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value }]
    },
    useRef(initial) { if (stateless) return { current: initial }; const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index] },
    useEffect(run, deps) {
      if (stateless) return
      const index = cursor++, old = hooks[index]
      if (!old || deps.some((value, i) => value !== old.deps[i])) scheduled.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: run() } })
    },
  }
}

// ---- 虚构数据 ----
const NOW = Date.now()
const model = (id, name, extra = {}) => ({ id, name, enabled: true, vision: false, contextWindow: 524288, maxOutputLength: 65536,
  thinkingLevels: ['off', 'low', 'medium', 'high'], defaultEffort: 'off', defaultVision: false, defaultContextWindow: 524288,
  defaultMaxOutputLength: 65536, params: {}, ...extra })
const apikeys = {
  agnes: { provider: 'agnes', hasApiKey: true, registerProvider: true, providerRegistered: true, catalogSource: 'remote', catalogError: false,
    updatedAt: NOW, balance: { used: 0, limit: null, unlimited: true, unit: 'USD', updatedAt: NOW },
    models: [model('agnes-3.0-flash', 'Agnes 3.0 Flash', { vision: true, defaultVision: true }),
      model('agnes-2.5-flash', 'Agnes 2.5 Flash', { vision: true, defaultVision: true }),
      model('agnes-2.5-pro', 'Agnes 2.5 Pro', { vision: true, defaultVision: true, contextWindow: 1048576, defaultContextWindow: 1048576 }),
      model('agnes-2.5-pro-beta', 'Agnes 2.5 Pro Beta', { enabled: false, vision: true, defaultVision: true, contextWindow: 1048576, defaultContextWindow: 1048576 })] },
  unisound: { provider: 'unisound', hasApiKey: true, registerProvider: true, providerRegistered: true, catalogSource: 'remote', catalogError: false,
    updatedAt: NOW, balance: null,
    models: [model('u2-flash', 'U2-Flash', { contextWindow: 1048576, defaultContextWindow: 1048576, maxOutputLength: 131072, defaultMaxOutputLength: 131072,
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' }),
      model('u2', 'U2', { contextWindow: 0, defaultContextWindow: 0, maxOutputLength: 0, defaultMaxOutputLength: 0, thinkingLevels: ['off', 'low', 'high'], defaultEffort: 'high' }),
      model('kimi-k3', 'Kimi K3', { thinkingLevels: [] })] },
}
const packModels = provider => [['m1', 'Alpha 2'], ['m2', 'Alpha 2 Flash'], ['m3', 'Beta 4 Pro'], ['m4', 'Beta 4 Mini']]
  .map(([id, name], index) => ({ id: `${provider}-${id}`, name, disabled: index === 3, dead: false, isFree: index === 1,
    contextWindow: 262144, maxTokens: 32768, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', supportsImage: index < 2,
    ...(index === 1 ? { rateBadge: { text: { zh: '免费' }, tone: 'success' } } : { rateBadge: { text: { zh: 'x1.00' }, tone: 'neutral', multiplier: 1 } }) }))
const planSnapshot = { hasApiKey: true, registerProvider: true, providerRegistered: true, catalogAvailable: true, updatedAt: NOW,
  models: [model('sensenova-6-8-flash', 'SenseNova 6.8 Flash', { contextWindow: 262144, defaultContextWindow: 262144 }), model('sensenova-6-8-flash-lite', 'SenseNova 6.8 Flash Lite', { contextWindow: 262144, defaultContextWindow: 262144 })] }
const buddyAccount = { id: 'workbuddy-1a2b3c4d', name: '示例账号', uid: 'u-demo', signedIn: true, plan: '专业版', signIn: 'kept', updatedAt: NOW,
  windows: [{ name: '周期额度', used: 38, amount: 380, limit: 1000, balance: null, display: '', unit: '积分', resetsAt: '', span: null, runsOutAt: '', runsOut: null }], error: '' }
const statuses = { statuses: Object.fromEntries(['loomy', 'raccoon', 'raccoon-pro', 'qodercn', 'trae'].map(id => [id,
  { closed: false, accounts: { enabled: 2, total: 2 }, models: { total: 4 } }])) }
const hostEntries = () => {
  const entry = value => ({ at: NOW, stale: false, value })
  return { 'provider.status': entry(statuses), 'sensenova-token-plan/plan.snapshot': entry(planSnapshot),
    'workbuddy/workbuddy.snapshot': entry({ accounts: [buddyAccount], loginUrl: '' }), 'workbuddy/workbuddy.models': entry({ models: [], source: 'fallback' }),
    'agnes/apikey.snapshot': entry(apikeys.agnes), 'unisound/apikey.snapshot': entry(apikeys.unisound) }
}
const host = async (method, payload) => {
  const p = payload.provider
  const ok = value => ({ ok: true, value })
  if (method === 'apikey.snapshot') return ok(apikeys[p])
  if (method === 'provider.status') return ok(statuses)
  if (method === 'account.list') return ok({ accounts: [
    { id: `${p}-a`, provider: p, nickname: '主力账号', enabled: true, plan: 'pro' },
    { id: `${p}-b`, provider: p, nickname: '备用账号', enabled: true, plan: 'free' }] })
  if (method === 'model.list') return ok({ source: 'remote', models: packModels(p) })
  if (method === 'model.params') return ok({ provider: p, params: {} })
  if (method === 'credits.balances') return ok({ accounts: [
    { accountId: `${p}-a`, nickname: '主力账号', updatedAt: NOW, balance: { total: 12840, packages: [{ name: '每日赠送', remaining: 3600, unit: '积分', expiresAt: NOW + 6 * 3_600_000 }, { name: '永久积分', remaining: 9240, unit: '积分' }] } },
    { accountId: `${p}-b`, nickname: '备用账号', updatedAt: NOW, balance: { total: 460, packages: [] } }] })
  if (method === 'plan.snapshot') return ok(planSnapshot)
  if (method === 'workbuddy.snapshot') return ok({ accounts: [buddyAccount], loginUrl: '' })
  if (method === 'workbuddy.models') return ok({ models: [], source: 'fallback' })
  if (method === 'settings.snapshot') return ok({ cursor: 'preview', entries: hostEntries() })
  return ok({})
}

// ---- 载入真实客户端 ----
let css = ''
const react = reactStub()
const document = {
  head: { append(element) { css += element.textContent ?? '' } },
  createElement: () => ({ dataset: {}, remove() {} }),
  visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {},
}
const storage = new Map([['eac-unified-router-last-provider', providerId]])
let module
vm.runInNewContext(readFileSync(join(root, 'lib/client.js'), 'utf8'), {
  URL, AbortController, navigator: {}, document,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, String(value)) }, removeItem() {} },
  window: { __ModuleLoader__: { load(spec) { module = spec.factory(() => react) } } },
}, { filename: 'client.js' })
let Settings
module.apply({ slots: { inject(_slot, run) { run() }, register(_spec, view) { Settings = view } },
  connection: { rpc: { call: (_p, _s, request) => host(request.method, request.payload) } } })
const ctx = { connection: { rpc: { call: (_p, _s, request) => host(request.method, request.payload) } } }
const render = () => { react.begin(); const tree = Settings({ ctx }); react.flush(); return tree }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
render(); for (let i = 0; i < 6; i++) await tick()
for (let i = 0; i < 3; i++) { render(); await tick() }
const click = predicate => { const node = nodes(render()).find(predicate); if (!node?.props.onClick) throw new Error('找不到可点击元素'); node.props.onClick() }
click(node => node.props['aria-label'] === '切换到 ' + titleOf(providerId))
for (let i = 0; i < 6; i++) { await tick(); render() }
if (panelId !== 'models') { click(node => node.props.id === 'eac-tab-' + panelId); render() }
for (let i = 0; i < 3; i++) { await tick(); render() }
function titleOf(id) {
  return { loomy: 'Loomy', raccoon: 'Raccoon', qodercn: 'Qoder 中国版', trae: 'TRAE', 'sensenova-token-plan': '商汤 Token Plan',
    workbuddy: 'WorkBuddy', agnes: 'Agnes', unisound: '云知声' }[id] ?? id
}

// ---- 序列化 ----
const VOID = new Set(['input', 'img', 'br', 'hr'])
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function attributes(props) {
  return Object.entries(props).flatMap(([key, value]) => {
    if (key === 'key' || key === 'ref' || key === 'children' || key.startsWith('on') || typeof value === 'function') return []
    const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key
    if (value === undefined || value === null) return []
    if (typeof value === 'boolean') return name.startsWith('aria-') ? [`${name}="${value}"`] : value ? [name] : []
    if (key === 'style' && typeof value === 'object') return [`style="${escapeHtml(Object.entries(value).map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join(';'))}"`]
    return [`${name}="${escapeHtml(value)}"`]
  }).join(' ')
}
function html(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(html).join('')
  if (typeof node.type === 'function') return html(node.type({ ...node.props, children: node.children }))
  if (node.type === 'fragment') return node.children.map(html).join('')
  const open = `<${node.type}${attributes(node.props) ? ' ' + attributes(node.props) : ''}>`
  return VOID.has(node.type) ? open : `${open}${node.children.map(html).join('')}</${node.type}>`
}
react.freeze()
const body = html(render())
const dark = theme === 'dark'
const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;background:${dark ? '#14161a' : '#eef0f3'};font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.frame{box-sizing:border-box;width:${width}px;padding:16px;background:${dark ? '#191b20' : '#fff'};color:${dark ? '#f2f4f7' : '#182230'}}
${css}</style></head><body><div class="frame" data-theme="${theme}">${body}</div></body></html>`
const outDir = join(root, 'assets', 'preview')
mkdirSync(outDir, { recursive: true })
const htmlFile = join(outDir, outName + '.html'), pngFile = join(outDir, outName + '.png')
writeFileSync(htmlFile, page)
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
if (!chrome) { console.log('未找到 Chrome/Edge，只生成了 HTML：' + htmlFile); process.exit(0) }
const height = Number(process.env.PREVIEW_HEIGHT) || 900
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${pngFile}`, `--window-size=${width},${height}`,
  '--force-device-scale-factor=2', `file:///${htmlFile.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 60_000 })
if (process.env.PREVIEW_KEEP_HTML !== '1') rmSync(htmlFile, { force: true })
console.log('已生成 ' + pngFile)
