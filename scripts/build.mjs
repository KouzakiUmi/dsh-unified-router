import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
// 构建工具目录：显式变量优先（新名 → 旧名），其次搜新默认目录，最后回退改名前的
// 同级 eac-router-build —— 既有构建环境只留旧目录、只设旧变量时仍然可用。
//
// 只有「确实没装 esbuild」才算未命中；显式目录里 package 损坏一类的解析错误必须
// 立刻抛出，否则会静默改用另一个目录里的 esbuild，掩盖真正的安装问题。
const toolsCandidates = [
  process.env.UNIFIED_ROUTER_BUILD_TOOLS,
  process.env.EAC_BUILD_TOOLS,
  path.join(root, '../unified-router-build'),
  path.join(root, '../eac-router-build'),
  root,
].filter(Boolean)
const resolved = toolsCandidates.find(dir => {
  try {
    require.resolve('esbuild', { paths: [dir] })
    return true
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND') return false
    throw new Error(`在候选目录 ${dir} 解析 esbuild 失败（${error?.code || error?.message}）：${error?.message ?? error}`)
  }
})
if (!resolved) throw new Error(`找不到 esbuild，已尝试：${toolsCandidates.join('、')}。可用 UNIFIED_ROUTER_BUILD_TOOLS 指定工具目录。`)
const { build } = require(require.resolve('esbuild', { paths: [resolved] }))
await build({ entryPoints: [path.join(root, 'src/backend.ts')], outfile: path.join(root, 'lib/backend.js'), bundle: true, format: 'esm', platform: 'node', target: 'node22', external: ['@deepseek-ai/*', 'node:*'], nodePaths: ['/opt/dsh/node_modules'], legalComments: 'inline', banner: { js: "// Generated from src/backend.ts and vendored MIT channel sources.\nimport { createRequire as __unifiedRouterRequire } from 'node:module'; const require = __unifiedRouterRequire(import.meta.url);" } })
fs.copyFileSync(path.join(root, 'vendor/channel-pack/qoder-auth-wasm.wasm'), path.join(root, 'lib/qoder-auth-wasm.wasm'))

// ===== 客户端：src/client/*.js 顺序拼接为单文件 lib/client.js =====
//
// 与 provider 系列插件（dsh-devin-provider / dsh-volcengine-provider）同机制：
// 浏览器端 ModuleLoader 只吃一个工厂文件，源码按依赖顺序拼接、去掉行首
// `export ` 前缀后共享同一工厂作用域。顺序即依赖顺序（core 最先，settings 最后），
// 模块内部不写 `import`——跨模块标识符直接引用拼接后的同名绑定。
const clientModules = [
  '../../lib/sensenova-params.js', // 商汤参数与 compat 白名单
  '../../lib/model-catalog.js',
  '../../lib/channel-contract.js',   // 渠道 wire 契约（账号行 / 模型行的唯一字段源）
  '../../lib/channel-specs.js',      // 渠道规格表（客户端方法集由 clientMethodSets() 派生）
  '../../lib/apikey-quota-projection.js',
  'core.js',                 // 共享常量、输入校验、wire 归一化
  'store/pending.js',        // 局部非阻塞状态锁
  'store/cache.js',          // 首屏轻量恢复缓存
  'store/sync.js',           // Host 快照增量同步
  'store/index.js',          // createRouterStore：RPC 校验与请求生命周期
  'styles.js',               // CLIENT_STYLES 与样式安装
  'ui.js',                   // UI 原语、格式化与表单组件
  'kit/index.js',            // 共用设置原语
  'panels-core.js',          // 账号、模型、渠道视图
  'providers/pack.js',       // 账号池渠道的共用视图适配器
  'providers/managed.js',    // 自管多账号渠道的共用视图工厂
  'providers/raccoon.js',    // Raccoon provider 模块
  'providers/raccoon-pro.js', // Raccoon 订阅版 provider 模块
  'providers/qodercn.js',    // Qoder 中国版 provider 模块
  'providers/trae.js',       // TRAE provider 模块
  'providers/sensenova.js',
  'providers/workbuddy.js',
  'providers/apikey.js',     // API Key 渠道的共用视图工厂
  'providers/agnes.js',
  'providers/unisound.js',
  'providers/qianfan.js',    // 百度千帆 Token Plan 个人版
  'providers/bailian.js',    // 阿里云百炼 Token Plan
  'providers/astudio.js',    // AStudio（科大讯飞 Astron Studio）
  'providers/codearts.js',   // CodeArts（华为云码道）
  'providers/index.js',      // 渠道注册表（顺序即卡片顺序）
  'context-pill.js',         // 会话输入栏上下文窗口药丸（conversation.input.right）
  'store/quota.js',           // 输入栏额度快照订阅与投影
  'quota-pill.js',            // 当前渠道的额度药丸
  'settings.js',             // Settings 根组件与 settings.section 注册
]
const stripExports = source => source.replace(/^export /gm, '')
const clientBody = clientModules.map(name => {
  const source = fs.readFileSync(path.join(root, 'src/client', name), 'utf8')
  // 拼接机制依赖「行首 export 只出现在顶层声明处」；模块内容（模板字符串、
  // 注释）里出现行首 export 说明源码写法越界——剥离后语法自检兜不住语义，
  // 必须在构建期报出来。
  const stripped = stripExports(source)
  const count = (source.match(/^export /gm) || []).length
  if (count !== (source.match(/^export (?:const|function|class)/gm) || []).length) {
    throw new Error(`src/client/${name}：行首 export 前缀 ${count} 处不是顶层 const/function/class 声明，请检查源码写法`)
  }
  return `// ── src/client/${name} ──\n${stripped.trimEnd()}\n`
}).join('\n')
// 模块导出给测试与宿主直接使用：缺失的标识符会在加载时 ReferenceError。
const factoryReturn = "  return { name: 'dsh-unified-router', inject: ['slots', 'connection'], apply, createRouterStore, safeLoginUrl, filterModels, claimMessage }\n"
const clientBundle = `// Unified Router 设置页。通过 DSH 设置插槽显示，也可由 dsh-go 的 Web 设置岛承载。
// React useEffect cleanup follows react.dev/learn/synchronizing-with-effects.
// 本文件由 scripts/build.mjs 从 src/client/*.js 拼接生成，不要直接编辑。
window.__ModuleLoader__.load({
  id: 'dsh-unified-router',
  factory: require => {
    const React = require('react')
    const h = React.createElement
${clientBody}${factoryReturn}  },
})
`
// 构建期语法自检：拼接顺序或剥离错误立刻暴露，不等到测试或加载。
new vm.Script(clientBundle, { filename: 'lib/client.js' })
fs.writeFileSync(path.join(root, 'lib/client.js'), clientBundle)
console.log('Unified Router 后端已构建。')
console.log(`客户端已拼接：${clientModules.length} 个模块 → lib/client.js。`)
