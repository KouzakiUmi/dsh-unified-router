/**
 * Qoder CN：借本机**官方 CLI** 拉模型目录（P0）。
 *
 * ## 为什么走官方 CLI，而不是自己拉
 *
 * Qoder 的目录端点要求 `Authorization: Bearer COSY.<载荷>.<签名>`，签名算法与密钥
 * 在 Qoder 专有 Rust WASM（`qoder_auth_wasm`）里，JS 侧无可移植算法 —— 重实现等于
 * 提取密钥/绕过授权，不做。本机已装的官方 CLI 本体（IDE 附带的 worker runtime
 * 单文件）自带签名与登录态，`--list-models` 直接吐出当前账号的模型表。插件只
 * **spawn 官方 CLI、解析它的输出**，零签名、零重实现、不读不写凭据。
 *
 * ## 已确证的 CLI 事实（2026-11-17 探针实跑）
 *
 * - 本体：`QODER_CLI_RUNTIME`（见下），**必须用 node 执行**（无 shebang、非 exe），
 *   版本 1.1.86-hotfix.5.2。PATH 若有独立 `qoderclicn` 优先用它。
 * - 未登录：输出 `Not logged in. Run \`qoderclicn login\` to authenticate.`，exit 1。
 *   本机 IDE 走宿主注入的短期 job_token，CLI 自己不持有持久登录态 —— 故**必须用户
 *   一次性手动 `login`**（浏览器/设备码），插件不代跑。
 * - 登录后输出**纯文本表**：首行 `MODEL`，每行 `显示名` 或 `显示名 (key)`；
 *   `--output-format` 对它无效。有括号后缀时 **key 才是目录 id**（`qmodel_38max`
 *   这种），无后缀时显示名当 id。
 *
 * ## 降级与 opt-in
 *
 * 任一失败（CLI 不存在/spawn 错/超时/未登录/空表/解析 0 条）→ 回落产品兜底表，
 * `source:'fallback'`，绝不抛到调用方、绝不泄英文堆栈。CLI **只在用户手动点
 * 「刷新目录」时** spawn（客户端 autoRefreshCatalog 对 qodercn 跳过 silent 补拉），
 * 作为第三方驱动官方组件的显式同意（ToS 谨慎）。
 *
 * @module dsh-unified-router/qoder-cli
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { QoderFallbackModel } from './qoder-product.js'

/** 官方 CLI 本体（IDE 附带 worker runtime，用 node 执行）。路径含空格，spawn 用数组参数。 */
export const QODER_CLI_RUNTIME =
  'C:\\Program Files\\Qoder CN\\resources\\app.asar.unpacked\\node_modules\\@qoder-ai\\qoder-cn-agent-sdk\\dist\\_worker\\qoder-worker-runtime.obf.mjs'

/** CLI 冷启动可能数秒；首跑做 auth prepare。超时即回落，不卡住刷新。 */
export const QODER_CLI_TIMEOUT_MS = 25_000

/** 一次 CLI 调用的结果。`spawnError` 区分「进程没起起来」（ENOENT/超时）与「起来了但退出非 0」。 */
export interface QoderCliResult {
  stdout: string
  stderr: string
  code: number
  spawnError?: string
}

/**
 * 解析 `--list-models` 的纯文本表为 `{id, name}`。
 *
 * 跳过首行 `MODEL`、空行、以及 `Warning: no models available…` / `Not logged in…`
 * 这类非模型行。每行 `显示名 (key)` 时 **key 是目录 id**；无后缀时显示名当 id。
 * 按 id 去重。解析不出任何模型返回空数组（调用方据此回落，不把解析 bug 当「目录为空」）。
 *
 * ⚠️ `keyed` 记录这一行**是否真的带 key**。这是「能不能调用」的唯一判据：
 * `--list-models` 对部分条目只回显示名（`Qwen4-Max` / `GLM-5.4` / `Step-5-Preview`），
 * 拿显示名当 `model` 发请求时服务端回落到默认模型 —— 实测自称 `Qwen3.5`，
 * 且**一帧 `reasoning_content` 都不返回**（用户报障「Qoder 思考设置无效」）。
 */
export interface QoderCliModelRow { id: string; name: string; keyed: boolean }

/**
 * 无 key 也仍然可用的**路由名**：`Auto` / `Fast` 是服务端路由档，本身就是 id。
 * 其余没有 key 的条目一律视为「只有显示名、调不通」。
 */
const QODER_ROUTE_KEYS: ReadonlySet<string> = new Set(['auto', 'fast'])

export function parseQoderCliModels(stdout: string): QoderCliModelRow[] {
  const out: QoderCliModelRow[] = []
  const seen = new Set<string>()
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line === 'MODEL') continue
    if (/^Warning: no models available/i.test(line) || /^Not logged in/i.test(line)) continue
    const match = /^(.+?)(?: \(([^()]+)\))?$/.exec(line)
    if (!match) continue
    const name = match[1].trim()
    const keyed = match[2] !== undefined
    const id = (match[2] ?? name).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, keyed })
  }
  return out
}

/**
 * 把 CLI 的 id 集合与产品策展表合并：**id 以 CLI 为准，属性以策展表为准**。
 *
 * - CLI id 命中策展表 → 用策展表条目（保留 contextWindow/efforts/priceFactor/promotion
 *   等全部能力与倍率属性）。
 * - CLI 有、策展表无的新 id → 最小条目 `{id, name, contextWindow: 0}`。`0` 是「未知窗口」
 *   哨兵（宿主投影按 `> 0` 过滤，故不会编造一个假窗口）；**不编造** efforts/倍率，
 *   `qoderRate` 对缺 priceFactor 返回未知 → 名字不带倍率、不挂徽标。
 * - 策展表有、CLI 无的 id → 视为上游已下架，**不并入**（目录以 CLI 为准）。
 * - **没有 key 的条目**（`keyed === false` 且不是 `auto`/`fast` 这类路由名）→
 *   **不并入**：显示名不是 model key，拿它发请求只会回落默认模型。
 */
export function mergeQoderCatalog(
  cli: readonly { id: string; name: string }[],
  fallback: readonly QoderFallbackModel[],
  /** 是否要求条目必须带 key（`auto`/`fast` 这类路由名豁免）。 */
  requireKey = true,
): QoderFallbackModel[] {
  const byId = new Map(fallback.map(model => [model.id, model]))
  const byName = new Map(fallback.map(model => [model.name.toLowerCase(), model]))
  const out: QoderFallbackModel[] = []
  const seen = new Set<string>()
  for (const row of cli) {
    const known = byId.get(row.id) ?? (row.id === row.name ? byName.get(row.name.toLowerCase()) : undefined)
    const id = known?.id ?? row.id
    if (!id || seen.has(id)) continue
    // ⚠️ 显示名不是 model key：CLI 对部分条目只回名字，拿它当 `model` 发请求
    // 会回落默认模型、思考永不生效。`auto` / `fast` 是路由名，无 key 也照用。
    if (requireKey && row.keyed === false && !QODER_ROUTE_KEYS.has(id)) continue
    seen.add(id)
    out.push(known ? { ...known, name: row.name } : { id, name: row.name, contextWindow: 0 })
  }
  return out
}

export function readQoderCatalog(file: string, fallback: readonly QoderFallbackModel[]) {
  try {
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(rows)) return null
    const catalog = mergeQoderCatalog(rows.filter(row => typeof row?.id === 'string' && row.id.length <= 256
      && typeof row.name === 'string' && row.name.length <= 160).slice(0, 512), fallback)
    return catalog.length ? catalog : null
  } catch { return null }
}

export async function saveQoderCatalog(file: string, catalog: readonly QoderFallbackModel[]) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(temporary, JSON.stringify(catalog.map(({ id, name }) => ({ id, name }))), { mode: 0o600 })
    await rename(temporary, file)
  } finally { await unlink(temporary).catch(() => {}) }
}

/**
 * 一次「拉目录」的完整决策（注入 `runCli` 便于单测，绝不真跑 CLI）。
 *
 * 成功且解析出模型 → `{catalog: 合并结果, count, source:'remote'}`；
 * 任一失败 → `{catalog: null, count: 兜底条数, source:'fallback'}`。
 * 适配器把 `catalog` 存进 `cliCatalog`，`listAllModels`/`listModels` 据此切换目录来源。
 */
export type QoderCatalogIssue = 'login-required' | 'cli-missing' | 'timeout' | 'cli-failed' | 'empty' | 'no-model-key'

export async function refreshQoderCatalog(
  runCli: () => Promise<QoderCliResult>,
  fallback: readonly QoderFallbackModel[],
): Promise<{ catalog: QoderFallbackModel[] | null; count: number; source: 'remote' | 'fallback'; issue?: QoderCatalogIssue }> {
  const fail = (issue: QoderCatalogIssue) => ({ catalog: null, count: fallback.length, source: 'fallback' as const, issue })
  try {
    const result = await runCli()
    const text = `${result.stdout}\n${result.stderr}`
    if (result.spawnError === 'ENOENT') return fail('cli-missing')
    if (result.spawnError === 'timeout') return fail('timeout')
    if (/Not logged in|No qodercli login found/i.test(text)) return fail('login-required')
    if (result.code !== 0) return fail('cli-failed')
    const cli = parseQoderCliModels(result.stdout)
    if (cli.length === 0) return fail('empty')
    const catalog = mergeQoderCatalog(cli, fallback)
    // CLI 列出但**没有可用调用 key** 的条目（只有显示名）已被滤掉：全部滤光
    // 说明这批条目都调不通，如实回落兜底而不是给出一个空目录。
    if (catalog.length === 0) return fail('no-model-key')
    return { catalog, count: catalog.length, source: 'remote' }
  } catch {
    return fail('cli-failed')
  }
}

/** spawn 一个 CLI 进程，捕获 stdout/stderr/exitCode；超时 kill；spawn 错记 spawnError。 */
function spawnCli(file: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<QoderCliResult> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args as string[], { windowsHide: true, env })
    } catch {
      resolve({ stdout: '', stderr: '', code: 1, spawnError: 'spawn-failed' })
      return
    }
    const finish = (code: number, spawnError?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code, spawnError })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      finish(1, 'timeout')
    }, QODER_CLI_TIMEOUT_MS)
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.on('error', err => finish(1, String((err as NodeJS.ErrnoException)?.code ?? 'error')))
    child.on('close', code => finish(typeof code === 'number' ? code : 1))
  })
}

/**
 * 默认 CLI 运行器：先试 PATH 的独立 `qoderclicn`，ENOENT 再回退 IDE 附带 runtime
 * （`process.execPath` + [runtime, '--list-models']）。两者都失败时返回 spawnError，
 * 由 {@link refreshQoderCatalog} 回落兜底。
 */
export async function defaultRunQoderCli(): Promise<QoderCliResult> {
  const first = await spawnCli('qoderclicn', ['--list-models'])
  if (first.spawnError === 'ENOENT' && existsSync(QODER_CLI_RUNTIME)) {
    const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : undefined
    return spawnCli(process.execPath, [QODER_CLI_RUNTIME, '--list-models'], env)
  }
  return first
}
