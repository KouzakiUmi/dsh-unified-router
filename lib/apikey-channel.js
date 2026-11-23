// API Key 渠道管理器（Agnes / 云知声共用，契约见 docs/APIKEY-CHANNELS.md）。
// 本模块只持有生命周期与编排：Key 存取、目录拉取与缓存、适配器发布、
// 状态持久化与快照；渠道差异全部在 spec（lib/apikey-providers.js）里，
// 模型设置与推理适配器分别委托 apikey-models.js / apikey-llm.js。
//
// 安全边界与工作伙伴渠道一致：Key 原文、上游响应正文与错误消息绝不进入
// 返回值、错误文案或日志；外部可见的只有存在性与白名单投影。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readCatalogCache, saveCatalogCache } from './catalog-cache.js'
import { readableModelName } from './model-catalog.js'
import { readApiKeyQuota } from './apikey-quota.js'

export const APIKEY_METHODS = Object.freeze(new Set([
  'apikey.snapshot',
  'apikey.setKey',
  'apikey.setEnabled',
  'apikey.setModelEnabled',
  'apikey.setModelParams',
  'apikey.resetModels',
  'apikey.setToolsEnabled',
  'apikey.setConsoleSession',
  'apikey.consoleLogin',
  'apikey.clearConsoleSession',
]))

const MODEL_WRITE_METHODS = new Set(['apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels'])

const MAX_API_KEY = 4096
const MAX_CATALOG_PAGES = 20
const MAX_CATALOG_BODY = 2 * 1024 * 1024
const MAX_BALANCE_BODY = 256 * 1024
const CATALOG_TIMEOUT_MS = 10_000
const BALANCE_TIMEOUT_MS = 5_000
const CATALOG_REUSE_MS = 60_000

function serviceOf(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {}
  try { return ctx?.[name] } catch { return undefined }
}

export function createApiKeyManager(ctx, spec, deps = {}) {
  const credentials = () => serviceOf(ctx, 'credentials') ?? null
  const logger = serviceOf(ctx, 'logger') ?? ctx?.logger
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const stateFile = deps.stateFile
  const catalogFile = deps.catalogFile
  const modelSettingsFile = deps.modelSettingsFile
  let disposed = false
  let rateLimit = null

  // ---- 状态文件（{enabled, toolsEnabled}） --------------------------------
  // 开关默认 false；文件损坏/缺失都按默认处理，但已存在且可解析时以文件为准。
  const readState = () => {
    if (!stateFile) return { enabled: false, toolsEnabled: false }
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
      return {
        enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : false,
        toolsEnabled: typeof saved?.toolsEnabled === 'boolean' ? saved.toolsEnabled : false,
      }
    } catch { return { enabled: false, toolsEnabled: false } }
  }
  let { enabled, toolsEnabled } = readState()

  const writeState = async () => {
    if (!stateFile) throw new Error('渠道状态存储不可用')
    const temporary = stateFile + '.' + createHash('sha256').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 16) + '.tmp'
    try {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify({ enabled, toolsEnabled }), { mode: 0o600 })
      await rename(temporary, stateFile)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  // ---- 凭据服务封装（照 workbuddy.js 的 credentialRaw/writeCredential） ----
  const readKey = async () => {
    const service = credentials()
    if (!service || typeof service.resolve !== 'function') return null
    try {
      const raw = (await service.resolve(spec.credentialRef))?.value
      return typeof raw === 'string' && raw ? raw : null
    } catch {
      // 凭据服务读失败等同「读不到」，按未配置 Key 处理。
      return null
    }
  }

  const writeKey = async value => {
    const service = credentials()
    if (!service || typeof service.set !== 'function') throw new Error('凭据服务不可用')
    await service.set(spec.credentialRef, value)
  }

  // ---- 控制台会话（独立凭据，额度读取用；原文不进返回值/日志） ------------
  const readConsoleSession = async () => {
    if (!spec.consoleCredentialRef) return null
    const service = credentials()
    if (!service || typeof service.resolve !== 'function') return null
    try {
      const raw = (await service.resolve(spec.consoleCredentialRef))?.value
      return typeof raw === 'string' && raw.trim() ? raw.trim() : null
    } catch { return null }
  }
  const writeConsoleSession = async value => {
    const service = credentials()
    if (!service || typeof service.set !== 'function') throw new Error('凭据服务不可用')
    await service.set(spec.consoleCredentialRef, value)
  }
  const unsetConsoleSession = async () => {
    const service = credentials()
    if (!service) return
    if (typeof service.unset === 'function') await service.unset(spec.consoleCredentialRef).catch(() => {})
    else if (typeof service.delete === 'function') await service.delete(spec.consoleCredentialRef).catch(() => {})
    else if (typeof service.set === 'function') await service.set(spec.consoleCredentialRef, '').catch(() => {})
  }

  // ---- 多模态工具注册（spec.tools 声明的渠道才有） ------------------------
  // 条件：toolsEnabled && hasKey。注册串行化（toolsJob），dispose 释放。
  let releaseTools = null
  let toolsJob = Promise.resolve()
  const refreshTools = () => {
    const run = toolsJob.then(async () => {
      if (disposed || !spec.tools) return
      const tools = serviceOf(ctx, 'tools')
      const key = await readKey()
      const want = toolsEnabled && !!key && typeof tools?.register === 'function'
      if (want && releaseTools) return
      if (!want) {
        releaseTools?.()
        releaseTools = null
        return
      }
      try {
        const [module, toolsModule] = await Promise.all([
          deps.loadToolsModule ? deps.loadToolsModule() : import(spec.tools.module),
          deps.loadToolsRuntime ? deps.loadToolsRuntime() : import('@deepseek-ai/dsh-tools'),
        ])
        if (disposed || !toolsEnabled || !(await readKey())) return
        const outputDir = stateFile ? join(dirname(stateFile), spec.tools.outputDirName ?? `${spec.id}-tools-output`) : undefined
        const unregister = await module.registerTools({
          tools, attachments: serviceOf(ctx, 'attachments'), resolveKey: readKey, fetchImpl, outputDir, defineTool: toolsModule.defineTool,
        })
        if (disposed) unregister()
        else releaseTools = unregister
      } catch (error) {
        releaseTools?.()
        releaseTools = null
        logger?.warn?.(`[unified-router] ${spec.id} 能力工具注册失败。`)
        throw error
      }
    })
    toolsJob = run.catch(() => {})
    return run
  }

  // ---- 串行写队列：状态/模型写操作按序提交，避免并发写交错 ----------------
  let stateQueue = Promise.resolve()
  const queue = task => {
    const run = stateQueue.then(task, task)
    stateQueue = run.then(() => {}, () => {})
    return run
  }

  // ---- 目录 ---------------------------------------------------------------
  // catalogMemo 按 Key 的 sha256 前 12 位分作用域：换 Key 后旧 scope 的
  // 内存复用与磁盘缓存都自然读不到。同一 Key 的远端结果 60 秒内复用，
  // 并发请求合并为一个在途任务（catalogJob 不记入 memo，失败可立即重试）。
  let catalogRows = []
  let catalogSource = 'fallback'
  let catalogError = false
  let catalogMemo = null // { scope, at }；仅远端成功的轮次记入
  let catalogJob = null  // { scope, promise }

  const keyScope = key => createHash('sha256').update(key).digest('hex').slice(0, 12)

  const fetchJson = async (request, { timeoutMs, maxBytes, signal, redirect } = {}) => {
    const deadline = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    const response = await fetchImpl(request.url, { headers: request.headers, signal: combined, ...(redirect ? { redirect } : {}) })
    if (!response.ok) throw Object.assign(new Error('upstream'), { status: response.status })
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('upstream')
    return JSON.parse(new TextDecoder().decode(bytes))
  }

  const fetchCatalogRemote = async key => {
    const merged = []
    const seen = new Set()
    let cursor
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const request = spec.catalog.request(key, cursor)
      const json = await fetchJson(request, { timeoutMs: CATALOG_TIMEOUT_MS, maxBytes: MAX_CATALOG_BODY })
      for (const raw of spec.catalog.parse(json) ?? []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || raw.id.length > 256 || seen.has(raw.id)) continue
        seen.add(raw.id)
        merged.push({ ...raw, name: typeof raw.name === 'string' && raw.name ? raw.name : readableModelName(raw.id) })
      }
      cursor = spec.catalog.next?.(json)
      if (cursor === undefined || cursor === null) break
    }
    return merged
  }

  const loadCatalog = async key => {
    if (!key) {
      catalogRows = Array.isArray(spec.fallback) ? spec.fallback : []
      catalogSource = 'fallback'
      catalogError = false
      return catalogRows
    }
    const scope = keyScope(key)
    if (catalogMemo && catalogMemo.scope === scope && Date.now() - catalogMemo.at < CATALOG_REUSE_MS) {
      // 复用上一轮的目录与来源；远端失败过的轮次保持 catalogError。
      return catalogRows
    }
    if (catalogJob && catalogJob.scope === scope) return catalogJob.promise
    const promise = (async () => {
      let remote = null
      try {
        remote = await fetchCatalogRemote(key)
      } catch {}
      if (remote) {
        catalogRows = remote
        catalogSource = 'remote'
        catalogError = false
        catalogMemo = { scope, at: Date.now() }
        if (remote.length) await saveCatalogCache(catalogFile, remote, scope).catch(() => {})
        return remote
      }
      const cached = readCatalogCache(catalogFile, scope)
      if (cached?.length) {
        catalogRows = spec.catalog.restore ? cached.map(spec.catalog.restore) : cached
        catalogSource = 'cached'
      } else {
        catalogRows = Array.isArray(spec.fallback) ? spec.fallback : []
        catalogSource = 'fallback'
      }
      catalogError = true
      // 失败轮不记入复用窗口：下一次读仍重试远端（仅在途请求合并）。
      return catalogRows
    })()
    catalogJob = { scope, promise }
    try {
      return await promise
    } finally {
      if (catalogJob?.promise === promise) catalogJob = null
    }
  }

  // 模型设置：测试经 deps.modelSettings 注入；默认实现走 apikey-models.js，
  // 惰性加载（文件由并行的渠道规格任务提供，首次使用时才解析）。
  const settingsReady = deps.modelSettings !== undefined
    ? Promise.resolve(deps.modelSettings)
    : import('./apikey-models.js').then(module => module.createApiKeyModelSettings(modelSettingsFile, spec.id,
      { defaultMaxOutput: deps.defaultMaxOutput }))
  // 默认模块可能尚未就绪：加载失败的拒绝只在使用处抛出，不制造未处理 rejection。
  settingsReady.catch(() => {})
  const settingsOf = () => settingsReady

  const describeRows = async rows => {
    try {
      const listed = await (await settingsOf())?.list(rows)
      if (Array.isArray(listed)) return listed
    } catch {}
    return rows.map(row => ({ ...row, enabled: true }))
  }

  // ---- 适配器发布（refreshRouting 的等价物，模式照 workbuddy.js） ---------
  // 首次注册时建一个 Proxy 作为稳定句柄交给 llm.registerAdapter；之后只换
  // currentAdapter，条件不再满足时释放注册。发布串行化（routingJob），
  // 用签名（scope + enabled + 启用行）去重。
  let releaseAdapter = null
  let currentAdapter = null
  let adapterSignature = ''
  let routingJob = Promise.resolve()

  const refreshRouting = () => {
    const run = routingJob.then(async () => {
      const llm = serviceOf(ctx, 'llm')
      if (disposed || typeof llm?.registerAdapter !== 'function') return
      const key = await readKey()
      const scope = key ? keyScope(key) : ''
      const rows = await describeRows(catalogRows)
      const active = key && enabled ? rows.filter(row => row.enabled === true) : []
      const signature = JSON.stringify([scope, enabled, active])
      if (signature === adapterSignature) return
      try {
        if (active.length) {
          const factory = deps.loadLlmAdapter
            ? await deps.loadLlmAdapter()
            : (await import('./apikey-llm.js')).createApiKeyAdapter
          const createApiKeyAdapter = factory?.createApiKeyAdapter ?? factory
          if (typeof createApiKeyAdapter !== 'function') throw new Error('adapter factory missing')
          if (disposed) return
          const built = await createApiKeyAdapter({
            spec,
            rows: active,
            resolveKey: readKey,
            get: name => serviceOf(ctx, name),
            providerId: spec.id,
            onRateLimit: async hit => {
              if (disposed || key !== await readKey() || disposed || hit.until <= Date.now()) return
              if (rateLimit?.scope === scope && rateLimit.value.until >= hit.until) return
              rateLimit = { scope, value: hit }
              await deps.onRateLimit?.(hit)
            },
          })
          currentAdapter = built.adapter
          if (!releaseAdapter) {
            const delegate = new Proxy(built.adapter, { get(_target, prop) {
              const value = Reflect.get(currentAdapter, prop)
              return typeof value === 'function' ? value.bind(currentAdapter) : value
            } })
            releaseAdapter = llm.registerAdapter(built.providerIds, delegate)
          }
        } else {
          releaseAdapter?.()
          releaseAdapter = null
          currentAdapter = null
        }
        adapterSignature = signature
        llm.emitAdaptersUpdated?.()
      } catch (error) {
        logger?.warn?.(`[unified-router] ${spec.id} 模型目录发布失败。`)
        throw error
      }
    })
    routingJob = run.catch(() => {})
    return run
  }

  // ---- 余额 ---------------------------------------------------------------
  const readBalance = async key => {
    if (!spec.balance || !key) return null
    try {
      const requests = spec.balance.requests(key)
      if (!Array.isArray(requests) || !requests.length) return null
      const jsons = await Promise.all(requests.map(request =>
        fetchJson(request, { timeoutMs: BALANCE_TIMEOUT_MS, maxBytes: MAX_BALANCE_BODY })))
      const parsed = spec.balance.parse(jsons)
      if (parsed === null || parsed === undefined) return null
      return { ...parsed, updatedAt: Date.now() }
    } catch {
      return { error: true }
    }
  }

  // ---- 快照 ---------------------------------------------------------------
  const snapshot = async signal => {
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const key = await readKey()
    const rows = await loadCatalog(key)
    if (enabled && key) await refreshRouting().catch(() => {})
    if (spec.tools) await refreshTools().catch(() => {})
    const models = await describeRows(rows)
    const consoleSession = await readConsoleSession()
    const [balance, quota] = await Promise.all([
      readBalance(key),
      key ? readApiKeyQuota(spec.id, (request, signal) => fetchJson(request, {
        signal, timeoutMs: BALANCE_TIMEOUT_MS, maxBytes: MAX_BALANCE_BODY, redirect: 'error',
      }), signal, deps.env, consoleSession) : null,
    ])
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    return {
      hasKey: !!key,
      enabled,
      registered: releaseAdapter !== null,
      catalogSource,
      catalogError,
      updatedAt: Date.now(),
      models,
      balance,
      quota,
      rateLimit: key && rateLimit?.scope === keyScope(key) && rateLimit.value.until > Date.now() ? rateLimit.value : null,
      ...(spec.tools ? { toolsSupported: true, toolsEnabled, toolsRegistered: releaseTools !== null } : {}),
      ...(spec.consoleCredentialRef ? { hasConsoleSession: !!consoleSession, consoleLoginUrl: activeConsoleLoginUrl || null } : {}),
    }
  }

  // ---- 写操作 -------------------------------------------------------------
  const setKey = async (payload, signal) => {
    const apiKey = payload.apiKey
    if (typeof apiKey !== 'string') throw new Error('API Key 无效')
    // 粘贴常带首尾空白/换行，trim 后仍含内部空白（含全角空格）的 Key 必然鉴权失败，
    // 保存前就拒绝，避免把坏 Key 存进凭据后推理一直 401/403。
    const trimmed = apiKey.trim()
    if (!trimmed || trimmed.length > MAX_API_KEY || /\s/.test(trimmed)) throw new Error('API Key 无效')
    signal?.throwIfAborted()
    return queue(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const previous = await readKey()
      await writeKey(trimmed)
      if (previous !== trimmed) {
        rateLimit = null
        // 换 Key：目录缓存按新 scope 隔离，清掉内存复用后重新拉取并发布。
        catalogMemo = null
        catalogJob = null
      }
      await loadCatalog(trimmed)
      await refreshRouting()
      if (spec.tools) await refreshTools().catch(() => {})
      signal?.throwIfAborted()
      return { hasApiKey: (await readKey()) !== null }
    })
  }

  const setEnabled = async (payload, signal) => {
    if (typeof payload.enabled !== 'boolean') throw new Error('渠道开关无效')
    const value = payload.enabled
    signal?.throwIfAborted()
    return queue(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const previous = enabled
      if (value !== enabled) {
        enabled = value
        await writeState()
      }
      try {
        // 启用前尽量让目录就绪：注册条件要求至少一个启用行。
        if (value && !catalogRows.length) await loadCatalog(await readKey())
        await refreshRouting()
      } catch (error) {
        enabled = previous
        await writeState().catch(() => {})
        await refreshRouting().catch(() => {})
        throw new Error('模型提供方未能启用')
      }
      signal?.throwIfAborted()
      return { enabled: value, providerRegistered: releaseAdapter !== null }
    })
  }

  // 模型写：先经 modelSettings.change 落盘（apikey.xxx 方法名原样透传），
  // 再重新发布适配器；发布失败时回放逆操作把设置写回原状（参照 sensenova.js）。
  const changeModels = async (method, payload, signal) => {
    const undo = async rows => {
      const settings = await settingsOf()
      if (method === 'apikey.resetModels') {
        // resetModels 同时清了开关与参数覆盖，逆操作要把两类都写回。
        for (const row of rows) {
          if (row.enabled === false) await settings.change('apikey.setModelEnabled', { ...payload, modelId: row.id, enabled: false }, () => catalogRows, signal)
          if (row.params && Object.keys(row.params).length) {
            await settings.change('apikey.setModelParams', { ...payload, modelId: row.id, params: row.params }, () => catalogRows, signal)
          }
        }
        return
      }
      const before = rows.find(row => row.id === payload.modelId)
      if (!before) return
      if (method === 'apikey.setModelEnabled') {
        await settings.change('apikey.setModelEnabled', { ...payload, enabled: before.enabled }, () => catalogRows, signal)
      } else {
        await settings.change('apikey.setModelParams', { ...payload, params: before.params ?? {} }, () => catalogRows, signal)
      }
    }
    return queue(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      await loadCatalog(await readKey())
      const beforeRows = await describeRows(catalogRows)
      const afterRows = await (await settingsOf()).change(method, payload, () => catalogRows, signal)
      if (!Array.isArray(afterRows)) throw new Error('模型设置更新失败')
      try {
        await refreshRouting()
      } catch (error) {
        await undo(beforeRows).catch(undoError => {
          logger?.warn?.(`[unified-router] ${spec.id} 模型设置回滚失败。`)
        })
        await refreshRouting().catch(() => {})
        throw new Error('模型设置更新失败')
      }
      if (method === 'apikey.resetModels') {
        return { enabledModelIds: afterRows.filter(row => row.enabled === true).map(row => row.id) }
      }
      const row = afterRows.find(item => item.id === payload.modelId)
      if (!row) throw new Error('模型设置更新失败')
      if (method === 'apikey.setModelEnabled') return { modelId: row.id, enabled: row.enabled === true }
      const { id: modelId, name, enabled: _enabled, ...rest } = row
      return { modelId, ...rest }
    })
  }

  // ---- 控制台会话写操作与浏览器登录 ---------------------------------------
  let activeConsoleLogin = null
  let activeConsoleLoginUrl = ''

  // 会话有效性验证：GET verifyUrl，errorCode '0' 且 result 非空即有效。
  const verifyConsoleSession = async (cookie, signal) => {
    const headers = { cookie }
    const xsrf = cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1]
    if (xsrf) headers['x-xsrf-token'] = decodeURIComponent(xsrf)
    const json = await fetchJson({ url: spec.consoleLogin.verifyUrl, headers }, {
      signal, timeoutMs: BALANCE_TIMEOUT_MS, maxBytes: MAX_BALANCE_BODY, redirect: 'error',
    })
    return String(json?.errorCode ?? json?.code) === '0' && json?.result != null
  }

  const setConsoleSession = async (payload, signal) => {
    if (!spec.consoleCredentialRef) throw new Error('不支持此渠道')
    const cookie = typeof payload.cookie === 'string' ? payload.cookie.trim() : ''
    if (!cookie || cookie.length > 8192 || /[\r\n]/.test(cookie)) throw new Error('控制台 Cookie 无效')
    signal?.throwIfAborted()
    return queue(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      if (!(await verifyConsoleSession(cookie, signal).catch(() => false))) throw new Error('控制台会话无效或已过期')
      await writeConsoleSession(cookie)
      signal?.throwIfAborted()
      return { hasConsoleSession: true }
    })
  }

  const clearConsoleSession = async (_payload, signal) => {
    if (!spec.consoleCredentialRef) throw new Error('不支持此渠道')
    signal?.throwIfAborted()
    return queue(async () => {
      if (disposed) throw new Error('请求已结束')
      await unsetConsoleSession()
      return { hasConsoleSession: false }
    })
  }

  // 浏览器登录：独立临时 Profile 打开控制台登录页，CDP 收割 Cookie，
  // 验证有效后写凭据。模式照 managed-channel 的 managed.login（单飞 + onUrl）。
  const consoleLogin = async (_payload, signal) => {
    if (!spec.consoleLogin) throw new Error('不支持此渠道')
    if (activeConsoleLogin) throw new Error('已有登录正在进行')
    const controller = new AbortController()
    activeConsoleLogin = controller
    const loginSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    let pendingConsoleCookie = null
    try {
      const { launchIsolatedBrowserCookieLogin } = deps.browserLogin
        ? { launchIsolatedBrowserCookieLogin: deps.browserLogin }
        : await import('./browser-login.js')
      const domain = spec.consoleLogin.cookieDomain
      const harvested = await launchIsolatedBrowserCookieLogin({
        url: spec.consoleLogin.url,
        cookieUrls: spec.consoleLogin.cookieUrls,
        signal: loginSignal,
        fetchImpl,
        onUrl(url) { activeConsoleLoginUrl = url },
        async matchCookies(cookies) {
          const picked = new Map()
          for (const c of cookies) {
            const d = String(c?.domain ?? '').toLowerCase().replace(/^\./, '')
            if (d !== domain && !d.endsWith('.' + domain)) continue
            if (!c?.name || typeof c.value !== 'string' || !c.value) continue
            picked.set(c.name, c.value)
          }
          if (!picked.size) return null
          const cookie = [...picked].map(([name, value]) => `${name}=${value}`).join('; ')
          if (!(await verifyConsoleSession(cookie, loginSignal).catch(() => false))) return null
          // 登录成功瞬间服务端可能换发 JSESSIONID（session fixation 防护），浏览器
          // cookie jar 更新有延迟：首次 verify 通过的可能是换发前短暂仍有效的旧 ID。
          // 记录候选并延迟复验——下一轮收割（1.5s 后）拿到同一会话且仍有效才接受，
          // 确保存的是登录完成后的稳定认证态会话，而非换发前的旧 ID。
          if (pendingConsoleCookie && pendingConsoleCookie.cookie === cookie
            && Date.now() - pendingConsoleCookie.at >= 1500) {
            return cookie
          }
          pendingConsoleCookie = { cookie, at: Date.now() }
          return null
        },
      })
      loginSignal.throwIfAborted()
      if (!harvested) return { signedIn: false }
      await writeConsoleSession(harvested)
      return { signedIn: true, hasConsoleSession: true }
    } finally {
      activeConsoleLoginUrl = ''
      activeConsoleLogin = null
    }
  }

  const setToolsEnabled = async (payload, signal) => {
    if (!spec.tools) throw new Error('不支持此渠道')
    if (typeof payload.enabled !== 'boolean') throw new Error('工具开关无效')
    const value = payload.enabled
    signal?.throwIfAborted()
    return queue(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      if (value && !(await readKey())) throw new Error('请先配置 API Key')
      const previous = toolsEnabled
      toolsEnabled = value
      try {
        await writeState()
        await refreshTools()
      } catch (error) {
        toolsEnabled = previous
        await writeState().catch(() => {})
        await refreshTools().catch(() => {})
        throw new Error(value ? '能力工具未能启用' : '能力工具未能关闭')
      }
      signal?.throwIfAborted()
      return { toolsEnabled, toolsRegistered: releaseTools !== null }
    })
  }

  const call = async (method, payload = {}, signal) => {
    if (!APIKEY_METHODS.has(method)) throw new Error('不支持此操作')
    if (disposed) throw new Error('请求已结束')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.provider !== spec.id) {
      throw new Error('不支持此渠道')
    }
    signal?.throwIfAborted()
    if (method === 'apikey.snapshot') return snapshot(signal)
    if (method === 'apikey.setKey') return setKey(payload, signal)
    if (method === 'apikey.setEnabled') return setEnabled(payload, signal)
    if (method === 'apikey.setToolsEnabled') return setToolsEnabled(payload, signal)
    if (method === 'apikey.setConsoleSession') return setConsoleSession(payload, signal)
    if (method === 'apikey.clearConsoleSession') return clearConsoleSession(payload, signal)
    if (method === 'apikey.consoleLogin') return consoleLogin(payload, signal)
    if (MODEL_WRITE_METHODS.has(method)) return changeModels(method, payload, signal)
    throw new Error('不支持此操作')
  }

  return {
    call,
    // 与 call('apikey.snapshot') 等价：内部补齐 provider 走同一入口。
    collectSnapshot: signal => call('apikey.snapshot', { provider: spec.id }, signal),
    invalidate() {
      catalogMemo = null
      catalogJob = null
    },
    dispose() {
      if (disposed) return
      disposed = true
      try { activeConsoleLogin?.abort() } catch {}
      try { releaseTools?.() } catch {}
      releaseTools = null
      try { releaseAdapter?.() } catch {}
      releaseAdapter = null
      currentAdapter = null
    },
  }
}
