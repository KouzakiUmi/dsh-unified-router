// 共享渲染层**不得按渠道名分支** —— 这条纪律的可执行形式。
//
// 为什么需要：渠道名判断散在共享层里时，加一个渠道就要在 N 个共享文件里加分支，
// 而且漏加不报错（界面只是显示成通用形态）。
//
// 三种写法都要抓，漏一种就形同虚设：
// 1. 字面量：`id === 'agnes'`、`case 'unisound':`
// 2. **常量别名**：`id === WORKBUDDY_ID`（上一版只抓字面量，这一类全躲过去了 ——
//    实测有 20+ 处，比字面量还多）
// 3. 反向写法：`'agnes' === id`
//
// 例外（**按 kind 分派是允许的**）：某个 kind 只注册了一个渠道时，用它的 id 分派
// 等价于按 `spec.kind` 分派 —— 那是规格表的一等概念，不是渠道特例。这类常量由
// 用例自动识别（见 `kindRepresentative`），不需要手维护白名单。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL_SPECS } from '../lib/channel-specs.js'

const CLIENT_ROOT = fileURLToPath(new URL('../src/client/', import.meta.url))
const LIB_ROOT = fileURLToPath(new URL('../lib/', import.meta.url))

/** 渠道 id 全部来自规格表 —— 加渠道时这条用例自动覆盖新名字。 */
const CHANNEL_IDS = CHANNEL_SPECS.map(spec => spec.id)

/**
 * **已知待收敛**的渠道名分派（本次重写之前就存在的债务，显式登记以便逐步清零）。
 *
 * 按「文件 → 渠道标识」登记而不是行号：收敛一处就删一个条目，代码移动不会让登记失效。
 * 渠道标识用渠道 id，或用 `const X = '<渠道 id>'` 里的常量名（两者等价，便于阅读）。
 * 新代码**不得**往这里加东西 —— 它只是给存量一个可见的去处，不是许可。
 * 收敛方向与进度见 [docs/CHANNEL-ARCHITECTURE.md](../docs/CHANNEL-ARCHITECTURE.md#共享层不再认识渠道名)。
 */
const KNOWN_DEBT = Object.freeze({
  // 已清空：共享层不再有任何渠道名分派。新增分派会直接让这条用例变红。
})

function walk(dir, out = [], { skipProviders = false } = {}) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (skipProviders && name === 'providers') continue
      walk(path, out, { skipProviders })
    } else if (name.endsWith('.js')) out.push(path)
  }
  return out
}

/** 共享层文件 = `src/client/**` 去掉 `providers/`。 */
function sharedFiles() {
  return walk(CLIENT_ROOT, [], { skipProviders: true })
    .map(path => relative(CLIENT_ROOT, path).split('\\').join('/'))
}

/**
 * 值为渠道 id 的标识符（`const WORKBUDDY_ID = 'workbuddy'` 这类）。
 *
 * 扫 `src/client/` 与 `lib/` 两处：常量可能定义在任一侧，客户端拼接后共用同一作用域。
 */
function channelAliases() {
  const aliases = new Map()
  const sources = [...walk(CLIENT_ROOT), ...walk(LIB_ROOT)]
  for (const path of sources) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`]+)['"`]/g)) {
      if (CHANNEL_IDS.includes(match[2])) aliases.set(match[1], match[2])
    }
  }
  return aliases
}

 /**
  * 该渠道是不是它所属 kind 的**唯一已注册渠道**。
  *
  * 是 → 通过该渠道的**常量**分派等价于按 `spec.kind` 分派，属规格表的一等概念，
  * 不算渠道特例（如 `WORKBUDDY_ID`、`PLAN_PROVIDER_ID`）。
  *
  * 两个限定都很重要：
  * - 未注册的渠道（如 `astudio`）不代表 kind —— 否则它自己就能豁免自己。
  * - **字面量** `'codearts'` 不豁免，哪怕 kind 唯一：它把名字写死了，以后同 kind
  *   加第二个渠道时这些分支不会跟着适配，仍是债务。
  */
 function kindRepresentative(id) {
   const spec = CHANNEL_SPECS.find(item => item.id === id)
   if (!spec || spec.registered === false) return false
   const sameKind = CHANNEL_SPECS.filter(item => item.kind === spec.kind && item.registered !== false)
   return sameKind.length === 1
 }

/** 该行是不是注释（注释里提到渠道名是用来解释历史的，不算分派）。 */
const isComment = line => /^\s*(\*|\/\/|\/\*)/.test(line)

/** 规格表里的 kind 名。与部分渠道 id 同名（`workbuddy` / `plan` 不是，但 `workbuddy` 是）。 */
const KIND_NAMES = new Set(CHANNEL_SPECS.map(spec => spec.kind))

/**
 * 是不是「按 kind 分派」。`kind === 'workbuddy'` 里那个字符串是 **kind**，不是渠道 id
 * —— `workbuddy` 恰好两者同名，只能靠左侧操作数区分。按 kind 分派是规格表的一等概念，
 * 不算渠道特例。
 */
const isKindDispatch = (line, id) => KIND_NAMES.has(id)
  && new RegExp(`\\bkind\\s*(===|!==|==|!=)\\s*['"\`]${id}['"\`]`, 'i').test(line)

/**
 * 一行里出现的「渠道标识」，返回登记用的 key（渠道 id 或常量名）。
 *
 * 只抓「按渠道标识比较/分派」这几种形态；渠道名字符串出现在文案里不算。
 */
function dispatchIds(line, aliases) {
  const found = new Set()
  const identifiers = [...CHANNEL_IDS, ...aliases.keys()]
  for (const name of identifiers) {
    if (isKindDispatch(line, name)) continue
    const literal = name.startsWith("'") || CHANNEL_IDS.includes(name)
    const token = CHANNEL_IDS.includes(name) ? `['"\`]${name}['"\`]` : `\\b${name}\\b`
    const patterns = [
      new RegExp(`(===|!==|==|!=)\\s*${token}`),
      new RegExp(`${token}\\s*(===|!==|==|!=)`),
      new RegExp(`case\\s+${token}`),
    ]
    if (patterns.some(pattern => pattern.test(line))) {
      // 只有**常量**才可能按 kind 分派，且要求该 kind 只有这一个已注册渠道。
      if (aliases.has(name) && kindRepresentative(aliases.get(name))) continue
      found.add(name)
    }
  }
  return [...found]
}

test('共享渲染层不得新增渠道名分派（存量债务已在 KNOWN_DEBT 登记，只能减不能增）', () => {
  const files = sharedFiles()
  assert.ok(files.length > 0, '没有扫到任何共享层文件，路径解析有问题')
  const aliases = channelAliases()
  const found = new Map()
  for (const rel of files) {
    const source = readFileSync(join(CLIENT_ROOT, rel), 'utf8')
    source.split('\n').forEach((line, index) => {
      if (isComment(line)) return
      for (const name of dispatchIds(line, aliases)) {
        const key = `${rel}:${name}`
        if (!found.has(key)) found.set(key, [])
        found.get(key).push(index + 1)
      }
    })
  }
  const unexpected = [...found.entries()].filter(([key]) => {
    const [file, name] = key.split(':')
    return !(KNOWN_DEBT[file] ?? []).includes(name)
  })
  const detail = unexpected.map(([key, lines]) => `${key} (行 ${lines.join(', ')})`).join('\n')
  assert.deepEqual(unexpected.map(([key]) => key), [],
    `共享层出现未登记的渠道名分派，请改成渠道视图上的能力声明：\n${detail}`)
})

test('存量债务清单只能收缩：登记项在代码里已不存在就应删掉该条目', () => {
  const aliases = channelAliases()
  const found = new Set()
  for (const rel of sharedFiles()) {
    const source = readFileSync(join(CLIENT_ROOT, rel), 'utf8')
    source.split('\n').forEach(line => {
      if (isComment(line)) return
      for (const name of dispatchIds(line, aliases)) found.add(`${rel}:${name}`)
    })
  }
  const stale = Object.entries(KNOWN_DEBT).flatMap(([file, names]) => names
    .filter(name => !found.has(`${file}:${name}`))
    .map(name => `${file}:${name}`))
  assert.deepEqual(stale, [], `以下债务已收敛，请从 KNOWN_DEBT 删除（清单要能忠实反映现状）：\n${stale.join('\n')}`)
})

test('反向校验：用例认得三种分派写法，也放行按 kind 分派的常量', () => {
  const aliases = new Map([
    ['WORKBUDDY_ID', 'workbuddy'],
    ['PLAN_PROVIDER_ID', 'sensenova-token-plan'],
    // raccoon 所属的 pack kind 还有 qodercn / trae，不是唯一代表 —— 用它测「该报的常量要报」
    ['RACCOON_ID', 'raccoon'],
  ])
  // 字面量
  assert.deepEqual(dispatchIds("if (id === 'agnes') return []", aliases), ['agnes'])
  // 反向写法
  assert.deepEqual(dispatchIds("provider !== 'codearts' ? window.resetsAt : ''", aliases), ['codearts'])
  // case
  assert.deepEqual(dispatchIds("case 'unisound':", aliases), ['unisound'])
  // 常量别名 —— 上一版漏掉的就是这一类；同 kind 有多个渠道时必须报出来
  assert.deepEqual(dispatchIds('if (provider === RACCOON_ID) return []', aliases), ['RACCOON_ID'])
  // 按 kind 分派的常量放行：该 kind 只有这一个已注册渠道
  assert.deepEqual(dispatchIds('if (provider === WORKBUDDY_ID) return []', aliases), [])
  assert.deepEqual(dispatchIds('if (state.provider !== PLAN_PROVIDER_ID) return', aliases), [])
  // 渠道名出现在文案里不算分派
  assert.deepEqual(dispatchIds("h('span', null, '云知声')", aliases), [])
})
