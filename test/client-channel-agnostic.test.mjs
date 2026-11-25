// 共享渲染层**不得按渠道名分支** —— 这条纪律的可执行形式。
//
// 为什么需要：渠道名判断散在共享层里时，加一个渠道就要在 N 个共享文件里加分支，
// 而且漏加不报错（界面只是显示成通用形态）。本次重写把 apikey 渠道的
// `id === 'agnes'` 换成了渠道视图上的能力声明（`freeTier` / `preferCreditsWindows`），
// 这条用例负责守住结果：共享层以后一旦又冒出 `=== '某个渠道'`，它会先红。
//
// 范围：`src/client/` 下**除 `providers/` 之外**的所有文件都是共享层。
// `providers/` 是渠道自己的视图与注册表，天生知道渠道名（`id: 'agnes'` 是声明，不是分派）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL_SPECS } from '../lib/channel-specs.js'

// 用 fileURLToPath 而不是 URL.pathname：后者是 URL 编码形式，工作区路径带空格时会拼出
// `D:\Software%20Projects\...`，scandir 直接 ENOENT。
const CLIENT_ROOT = fileURLToPath(new URL('../src/client/', import.meta.url))

/** 渠道 id 全部来自规格表 —— 加渠道时这条用例自动覆盖新名字。 */
const CHANNEL_IDS = CHANNEL_SPECS.map(spec => spec.id)

/**
 * **已知待收敛**的渠道名分派（本次重写之前就存在的债务，显式登记以便逐步清零）。
 *
 * 按「文件 → 渠道 id」登记而不是行号：收敛一处就删一个条目，代码移动不会让登记失效。
 * 新代码**不得**往这里加东西 —— 它只是给存量一个可见的去处，不是许可。
 * 收敛方向与进度见 [docs/CHANNEL-ARCHITECTURE.md](../docs/CHANNEL-ARCHITECTURE.md#共享层不再认识渠道名)。
 */
const KNOWN_DEBT = Object.freeze({
  'core.js': ['qodercn', 'codearts', 'raccoon', 'raccoon-pro'],
  'store/index.js': ['qodercn'],
  'store/quota.js': ['raccoon', 'raccoon-pro', 'codearts', 'workbuddy', 'astudio'],
})

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith('.js')) out.push(path)
  }
  return out
}

/** 共享层文件 = `src/client/**` 去掉 `providers/`。 */
function sharedFiles() {
  return walk(CLIENT_ROOT)
    .map(path => relative(CLIENT_ROOT, path).split('\\').join('/'))
    .filter(rel => !rel.startsWith('providers/'))
}

/** 该行是不是注释（注释里提到渠道名是用来解释历史的，不算分派）。 */
const isComment = line => /^\s*(\*|\/\/|\/\*)/.test(line)

/** 一行里是否出现「按渠道名比较/分派」。渠道名字符串本身（如文案）不算。 */
function dispatchIds(line) {
  return CHANNEL_IDS.filter(id => [
    new RegExp(`(===|!==|==|!=)\\s*['"\`]${id}['"\`]`),
    new RegExp(`['"\`]${id}['"\`]\\s*(===|!==|==|!=)`),
    new RegExp(`case\\s+['"\`]${id}['"\`]`),
  ].some(pattern => pattern.test(line)))
}

test('共享渲染层不得新增渠道名分派（存量债务已在 KNOWN_DEBT 登记，只能减不能增）', () => {
  const files = sharedFiles()
  assert.ok(files.length > 0, '没有扫到任何共享层文件，路径解析有问题')
  const found = new Map()
  for (const rel of files) {
    const source = readFileSync(join(CLIENT_ROOT, rel), 'utf8')
    source.split('\n').forEach((line, index) => {
      if (isComment(line)) return
      for (const id of dispatchIds(line)) {
        const key = `${rel}:${id}`
        if (!found.has(key)) found.set(key, [])
        found.get(key).push(index + 1)
      }
    })
  }
  const unexpected = [...found.entries()].filter(([key]) => {
    const [file, id] = key.split(':')
    return !(KNOWN_DEBT[file] ?? []).includes(id)
  })
  const detail = unexpected.map(([key, lines]) => `${key} (行 ${lines.join(', ')})`).join('\n')
  assert.deepEqual(unexpected.map(([key]) => key), [],
    `共享层出现未登记的渠道名分派，请改成渠道视图上的能力声明：\n${detail}`)
})

test('存量债务清单只能收缩：登记项在代码里已不存在就应删掉该条目', () => {
  const found = new Map()
  for (const rel of sharedFiles()) {
    const source = readFileSync(join(CLIENT_ROOT, rel), 'utf8')
    source.split('\n').forEach(line => {
      if (isComment(line)) return
      for (const id of dispatchIds(line)) found.set(`${rel}:${id}`, true)
    })
  }
  const stale = Object.entries(KNOWN_DEBT).flatMap(([file, ids]) => ids
    .filter(id => !found.has(`${file}:${id}`))
    .map(id => `${file}:${id}`))
  assert.deepEqual(stale, [], `以下债务已收敛，请从 KNOWN_DEBT 删除（清单要能忠实反映现状）：\n${stale.join('\n')}`)
})

test('反向校验：用例真的认得渠道名分派（防止正则失配导致永远通过）', () => {
  assert.deepEqual(dispatchIds("if (id === 'agnes') return []"), ['agnes'])
  assert.deepEqual(dispatchIds("provider !== 'codearts' ? window.resetsAt : ''"), ['codearts'])
  assert.deepEqual(dispatchIds("case 'unisound':"), ['unisound'])
  // 渠道名出现在文案里不算分派，不能被误报
  assert.deepEqual(dispatchIds("h('span', null, '云知声')"), [])
})
