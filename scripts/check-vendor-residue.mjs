// 静态核验（收紧版）：找出「已从定义处删除、当前仓库也没有任何其他定义、却仍被引用」的名字。
//
// 收紧三条，去掉跨文件重名噪声：
//   1. 只统计**模块级**声明（行首无缩进，或带 `export`）；
//   2. 排除解构声明（`const { a, b } = ...` 里的元素名本来就是局部名）；
//   3. 名字若在当前仓库**任何**文件里仍有模块级定义，就不算「已删除」。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SRC_DIRS = ['vendor/channel-pack/src', 'lib', 'src']
const FILE_MATCH = /\.(ts|js)$/
// 故意保留的名字：
// - `loomy`：退役渠道名单与清理脚本的字符串（不是代码引用）；
// - 其余 8 个是常见属性名/参数名，正则按词边界匹配时会命中 `.available` 这类属性访问。
const ALLOWED = new Set(['loomy', 'available', 'describe', 'history', 'inject', 'memory', 'refreshing', 'slot', 'stats', 'zcode'])

const listFiles = () => {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (FILE_MATCH.test(entry.name)) out.push(full.replace(/\\/g, '/'))
    }
  }
  for (const dir of SRC_DIRS) if (fs.existsSync(dir)) walk(dir)
  return out
}

/** 模块级声明名（行首无缩进，或带 export 前缀）。 */
function moduleLevelNames(text) {
  const names = new Set()
  const patterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/gm,
  ]
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) names.add(match[1])
  return names
}

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

const files = listFiles()
const current = new Map()
for (const file of files) current.set(file, fs.readFileSync(file, 'utf8'))
const currentStripped = new Map([...current].map(([file, text]) => [file, stripComments(text)]))
const allCurrentNames = new Set()
for (const text of currentStripped.values()) for (const name of moduleLevelNames(text)) allCurrentNames.add(name)

const headText = file => {
  try { return execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}

// 1) 仍存在但改动过的文件：模块级声明做差
const removed = new Map()
for (const file of files) {
  const head = headText(file)
  if (head === null) continue
  const after = moduleLevelNames(current.get(file))
  for (const name of moduleLevelNames(head)) {
    if (after.has(name)) continue
    if (!removed.has(name)) removed.set(name, new Set())
    removed.get(name).add(file)
  }
}
// 2) 整份删除的文件：它的模块级声明全算
for (const line of execFileSync('git', ['diff', '--name-only', '--diff-filter=D', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')) {
  const file = line.trim().replace(/\\/g, '/')
  if (!FILE_MATCH.test(file)) continue
  const head = headText(file)
  if (head === null) continue
  for (const name of moduleLevelNames(head)) {
    if (!removed.has(name)) removed.set(name, new Set())
    removed.get(name).add(file)
  }
}

const report = []
for (const [name, from] of removed) {
  if (ALLOWED.has(name)) continue
  if (allCurrentNames.has(name)) continue // 当前仓库仍有定义 → 不是「已删除」
  if (name.length <= 3) continue
  const pattern = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`)
  const hits = [...currentStripped].filter(([, text]) => pattern.test(text)).map(([file]) => file)
  if (hits.length > 0) report.push({ name, from: [...from], hits })
}

console.log(`扫描 ${files.length} 个文件；模块级被删声明 ${removed.size} 个；当前仍有定义 ${allCurrentNames.size} 个`)
if (report.length === 0) console.log('✅ 没有「已删除、当前无定义、却仍被引用」的标识符')
else {
  console.log(`⚠ 发现 ${report.length} 个：`)
  for (const row of report.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${row.name}  ← 原定义于 ${row.from.join(', ')}`)
    console.log(`     仍被引用: ${row.hits.join(', ')}`)
  }
  process.exitCode = 1
}