// Independent SenseNova Token Plan controller for Unified Router.
// The protocol/state primitives are kept under vendor/sensenova-token-plan with
// their MIT license and notices. This module owns only the plugin's lifecycle and
// the public, secret-free snapshot contract.
import { existsSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { normalizePlanParams, validatePlanParams } from "./sensenova-params.js"
import { join } from 'node:path'
import { a as buildDescriptors, t as DEFAULT_REASONING_EFFORT, p as identifyVisionModel } from '../vendor/sensenova-token-plan/llm-models.js'
import { modelRecommendationExclusions, readableModelName } from './model-catalog.js'
import {
  catalogSignature,
  fetchModelCatalog,
  clearCoalescedFetch,
  createApiKeyStore,
  createFileCatalogStore,
  createFileProviderStore,
  createProviderPublisher,
  profileSegment,
  resolveSettings,
  seedPublisherFromCatalog,
  syncSignaturesAfterPublish,
} from '../vendor/sensenova-token-plan/index.js'

export const PLAN_PROVIDER_ID = 'sensenova-token-plan'
export const PLAN_METHODS = Object.freeze(new Set(['plan.snapshot', 'plan.setKey', 'plan.setEnabled', 'plan.setModelEnabled', 'plan.setModelParams', 'plan.resetModels']))

const HIDE_ALL = '__hide_all__'
const MAX_TOKENS_OVERRIDE = 10_000_000

// 数据命名空间随项目改名（dsh-eac-router → dsh-unified-router）。旧目录只搬迁一次：
// 新目录不存在而旧目录存在时整体改名，避免读路径与写路径落在两个目录上。
const STATE_DIR_NAME = 'dsh-unified-router-sensenova'
const LEGACY_STATE_DIR_NAME = 'dsh-eac-router-sensenova'
const CREDENTIAL_SCOPE = 'dsh-unified-router-sensenova'
const SETTINGS_NS = 'dsh-unified-router'

const MAX_API_KEY = 4096

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

// Managers in one process targeting the same profile share the commit queue.
// Network reads stay outside it so a slow poll cannot stall an edit.
const stateQueues = new Map()
const catalogRevisions = new Map()
const credentialRevisions = new Map()
function catalogRevision(dir) { return catalogRevisions.get(dir) ?? 0 }
function advanceCatalogRevision(dir) { catalogRevisions.set(dir, catalogRevision(dir) + 1) }
function credentialRevision(dir) { return credentialRevisions.get(dir) ?? 0 }
function advanceCredentialRevision(dir) { credentialRevisions.set(dir, credentialRevision(dir) + 1) }

function serializeState(dir, task) {
  const before = stateQueues.get(dir) ?? Promise.resolve()
  const result = before.then(task, task)
  const settled = result.then(() => {}, () => {})
  stateQueues.set(dir, settled)
  void settled.then(() => { if (stateQueues.get(dir) === settled) stateQueues.delete(dir) })
  return result
}
function modelEnabled(id, ids) {
  return ids.length === 0 || ids.includes(id)
}
// 迁移：旧命名空间的目录存在而新目录不存在时整体改名，保证读写落在同一目录。
// 改名失败（占用、权限、跨设备）不能静默丢弃旧状态：回退到继续使用旧目录，
// 让本进程读到的是真实数据，并留下可查的告警。
//
// 只有「新路径确实是个目录」才算迁移已完成。新路径被同名文件占住时 existsSync
// 同样为 true，但那不是可用的状态目录——这种情形要与 rename 失败一样退回旧目录。
//
// ⚠️ 不能先探测目标再改名：两个进程并发启动时，「看一眼目标不存在 → 决定改名」
// 之间另一进程可能已经搬完，先前得出的结论就过期了（此时旧目录已不存在，若还返回
// 旧目录，后续读写会在旧路径上重建一份，与新目录分裂）。所以这里直接改名，再按
// 结果与错误码分类，每个结论都在使用前重新核实。
const isDirectory = value => { try { return statSync(value).isDirectory() } catch { return false } }
// rename 可注入：Windows 下几乎无法用文件系统状态稳定制造 rename 失败
// （目标为文件时会被覆盖成功，目标为「非空目录」时 isDirectory 已为 true 而走
// 「已就绪」分支），失败分支的实际行为因而通过注入验证。导出供测试直接覆盖各分支。
export function adoptStateDir(dir, legacyDir, logger, rename = renameSync) {
  const warn = logger?.warn ?? logger?.info
  const note = logger?.info ?? logger?.warn
  if (isDirectory(dir)) return dir
  if (!isDirectory(legacyDir)) {
    if (existsSync(legacyDir)) warn?.('[unified-router] 旧状态路径不是目录，本次使用新的状态目录。')
    return dir
  }
  try {
    rename(legacyDir, dir)
    note?.('[unified-router] 已把旧的渠道状态目录迁移到新的命名空间。')
    return dir
  } catch (error) {
    // 另一进程可能刚完成了同一次搬迁：目标已是目录就沿用它，绝不回到旧目录。
    if (isDirectory(dir)) return dir
    if (existsSync(dir)) {
      warn?.('[unified-router] 新的状态目录路径已被其他文件占用，本次继续使用旧目录。')
      return isDirectory(legacyDir) ? legacyDir : dir
    }
    warn?.(`[unified-router] 旧的渠道状态目录无法迁移（${error?.code || 'rename failed'}），本次继续使用旧目录。`)
    return isDirectory(legacyDir) ? legacyDir : dir
  }
}
function isValidModelId(id) {
  return typeof id === 'string' && id !== '' && id.length <= 256 && id.trim() === id && id !== HIDE_ALL && !['__proto__', 'prototype', 'constructor'].includes(id)
}
function validateModelId(id) {
  if (!isValidModelId(id)) throw new Error('模型无效')
  return id
}
const validCatalogEntries = entries => Array.isArray(entries) ? entries.filter(entry => isValidModelId(entry?.id)) : []
function fencedCatalogStore(store) {
  return {
    ...store,
    list: async () => validCatalogEntries(await store.list()),
    replace: (entries, ...rest) => store.replace(validCatalogEntries(entries), ...rest),
  }
}
function fencedPublisher(publisher) {
  return { ...publisher, publish: (entries, ...rest) => publisher.publish(validCatalogEntries(entries), ...rest) }
}

function serviceOf(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {}
  try { return ctx?.[name] } catch { return undefined }
}

function assertProvider(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.provider !== PLAN_PROVIDER_ID) {
    throw new Error('不支持此渠道')
  }
}



function assertApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '' || apiKey.length > MAX_API_KEY) throw new Error('API Key 无效')
  return apiKey
}

export function createSenseNovaManager(ctx, rawConfig = {}, testDeps = {}) {
  const input = object(rawConfig)
  const resolved = resolveSettings({
    ...input,
    // Unified Router owns this switch. The user must explicitly enable the
    // provider from the plugin page; no background refresh or draw/search side
    // effect is armed.
    registerProvider: input.registerProvider === true,
    providerRefreshMinutes: 0,
    drawEnabled: false,
    webSearchEnabled: false,
  })
  const settings = resolved.settings
  const configurationError = resolved.configError !== null
  const credentials = () => serviceOf(ctx, 'credentials') ?? null
  const logger = serviceOf(ctx, 'logger') ?? ctx?.logger
  const profile = profileSegment(ctx)
  // The upstream plugin may still run while the user transitions. Never read
  // or change its provider switch, model catalog, account grant or API key.
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateRoot = profile ? join(home, 'state', profile) : join(home, 'state')
  const stateDir = adoptStateDir(join(stateRoot, STATE_DIR_NAME), join(stateRoot, LEGACY_STATE_DIR_NAME), logger, testDeps.rename)
  const credentialKey = (scope, id) => `${scope === 'dsh-connect-sensenova-token-plan' ? CREDENTIAL_SCOPE : scope}/${id}`
  const cache = new Map()
  const inflight = new Map()
  const apiKeyStore = createApiKeyStore({ credentials })
  const catalogStore = fencedCatalogStore(createFileCatalogStore({ dir: stateDir, logger, ttlMs: 0 }))
  const providerStore = createFileProviderStore({ dir: stateDir, logger, ttlMs: 0 })
  const queueState = task => serializeState(stateDir, task)
  // A null preference explicitly clears even an operator config override.
  const configuredMaxTokens = Object.fromEntries(Object.entries(settings.maxTokensOverrides).filter(([id, value]) => isValidModelId(id) && Number.isSafeInteger(value) && value > 0 && value <= MAX_TOKENS_OVERRIDE))
  const applyOverrides = preferences => {
    const effective = Object.assign(Object.create(null), configuredMaxTokens)
    for (const [id, value] of Object.entries(preferences)) {
      if (value === null) delete effective[id]
      else effective[id] = value
    }
    settings.maxTokensOverrides = effective
  }
  const reloadOverrides = async () => {
    const preferences = await catalogStore.listEacMaxTokensOverrides()
    applyOverrides(preferences)
    settings.modelParams = await catalogStore.listEacModelParams()
    return preferences
  }
  const publisher = fencedPublisher(createProviderPublisher({
    settings,
    panelSwitch: () => providerStore.enabled().catch(() => null),
    loadAdapterModule: testDeps.loadAdapterModule ?? (() => import('../vendor/sensenova-token-plan/llm-adapter.js')),
    getLlm: service => serviceOf(ctx, service),
    resolveApiKey: async () => (await apiKeyStore.resolve()).value,
    emit: typeof ctx?.emit === 'function' ? ctx.emit.bind(ctx) : undefined,
    logger,
    settingsNs: SETTINGS_NS,
  }))
  let disposed = false
  let snapshotInFlight = null
  let seenCredentialRevision = credentialRevision(stateDir)
  let seedPromise = Promise.resolve()
  let publishDirty = false

  const effectiveEnabledIds = (entries, saved) => {
    if (saved.length) return saved
    const exclusions = modelRecommendationExclusions(buildDescriptors(entries), PLAN_PROVIDER_ID)
    return exclusions.size ? entries.filter(entry => !exclusions.has(entry.id)).map(entry => entry.id) : []
  }

  // Seeding reads only local catalog/switch state. It never probes SenseNova;
  // this makes a restart restore an explicitly enabled provider without turning
  // plugin activation itself into a network health check.
  seedPromise = queueState(async () => {
    await reloadOverrides()
    await seedPublisherFromCatalog(
      publisher,
      () => catalogStore.list(),
      async () => effectiveEnabledIds(await catalogStore.list(), await catalogStore.listEnabledIds()),
      async () => [],
    )
  }).catch(() => {})

  const publishCurrent = async () => {
    const [entries, enabledIds] = await Promise.all([catalogStore.list(), catalogStore.listEnabledIds()])
    const result = await publisher.publish(entries, effectiveEnabledIds(entries, enabledIds), [])
    publishDirty = result?.ok !== true
    if (!publishDirty) syncSignaturesAfterPublish(publisher.state)
    return result
  }

  function describeModel(descriptor, enabledIds, base, vision) {
    const maxTokensOverride = settings.maxTokensOverrides[descriptor.id] ?? null
    return {
      id: descriptor.id, name: readableModelName(descriptor.id, text(descriptor.name)), enabled: modelEnabled(descriptor.id, enabledIds),
      vision: descriptor.input.includes('image'), contextWindow: finite(descriptor.contextWindow),
      maxOutputLength: finite(descriptor.maxTokens), maxTokensOverride,
      thinkingLevels: Object.keys(descriptor.thinkingLevelMap).filter(level => descriptor.thinkingLevelMap[level] !== null),
      defaultEffort: DEFAULT_REASONING_EFFORT,
      defaultContextWindow: finite(base?.contextWindow), defaultMaxOutputLength: finite(base?.maxTokens),
      defaultVision: vision.source ? vision.vision : null,
      params: { ...settings.modelParams[descriptor.id], maxTokens: maxTokensOverride },
      compat: descriptor.compat,
    }
  }

  const descriptors = entries => buildDescriptors(entries, {
    maxTokensOverrides: settings.maxTokensOverrides, modelParams: settings.modelParams,
  })

  function describeModels(entries, enabledIds) {
    const base = new Map(buildDescriptors(entries).map(model => [model.id, model]))
    const vision = new Map(entries.map(entry => [entry.id, identifyVisionModel(entry)]))
    const models = descriptors(entries)
    const visible = effectiveEnabledIds(entries, enabledIds)
    return models.map(model => describeModel(model, visible, base.get(model.id), vision.get(model.id)))
  }

  const snapshot = async signal => {
    signal?.throwIfAborted()
    if (disposed) throw new Error('请求已结束')
    const generation = credentialRevision(stateDir)
    if (snapshotInFlight === null || snapshotInFlight.generation !== generation) {
      const slot = { generation, promise: null }
      slot.promise = (async () => {
        await seedPromise
        await queueState(() => {})
        const credentialGeneration = credentialRevision(stateDir)
        if (credentialGeneration !== seenCredentialRevision) {
          clearCoalescedFetch(cache, inflight)
          seenCredentialRevision = credentialGeneration
        }
        const catalogGeneration = catalogRevision(stateDir)
        const key = await apiKeyStore.resolve()
        const remote = key.value ? await fetchModelCatalog(settings, Math.min(60, settings.cacheSeconds) * 1000,
          cache, inflight, key.value).then(validCatalogEntries).catch(() => null) : null
        return queueState(async () => {
          if (disposed || credentialGeneration !== credentialRevision(stateDir) ||
              catalogGeneration !== catalogRevision(stateDir)) throw new Error('模型目录已更新')
          await reloadOverrides()
          const enabledIds = await catalogStore.listEnabledIds()
          const saved = await catalogStore.list()
          const entries = remote ?? saved
          if (remote && catalogSignature(saved, []) !== catalogSignature(entries, [])) {
            if (!await catalogStore.replace(entries, enabledIds, undefined)) throw new Error('模型目录保存失败')
            advanceCatalogRevision(stateDir)
          }
          if (publishDirty || publisher.state.signature !== catalogSignature(entries, effectiveEnabledIds(entries, enabledIds))) {
            const published = await publishCurrent()
            if (published?.ok !== true) throw new Error('模型提供方更新失败')
          }
          return {
            hasApiKey: !!key.value,
            registerProvider: (await providerStore.enabled()) ?? settings.registerProvider,
            providerRegistered: publisher.state.registered === true,
            catalogAvailable: remote !== null,
            catalogError: configurationError || !!key.value && remote === null,
            pollSeconds: settings.pollSeconds,
            updatedAt: Date.now(),
            models: describeModels(entries, enabledIds),
            enabledModelIds: enabledIds,
          }
        })
      })().finally(() => { if (snapshotInFlight === slot) snapshotInFlight = null })
      snapshotInFlight = slot
    }
    const value = await snapshotInFlight.promise
    signal?.throwIfAborted()
    return value
  }

  const saveKey = async (payload, signal) => {
    assertProvider(payload)
    const apiKey = assertApiKey(payload.apiKey)
    signal?.throwIfAborted()
    await seedPromise
    signal?.throwIfAborted()
    advanceCredentialRevision(stateDir)
    return queueState(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const currentKey = (await apiKeyStore.resolve()).value
      if (currentKey !== apiKey) {
        // A roster is scoped to the credential which fetched it. Evict only
        // entries while preserving allow-list, quota and model overrides.
        // If the key save later fails, an empty catalog is safer than offering
        // the previous key's models to an unrelated account.
        if (!await catalogStore.replace([], undefined, undefined)) throw new Error('模型目录未能隔离')
        advanceCatalogRevision(stateDir)
        await reloadOverrides()
        const cleared = await publishCurrent()
        if (cleared?.ok !== true) throw new Error('模型目录隔离失败')
      }
      try {
        await apiKeyStore.save(apiKey)
      } finally {
        advanceCredentialRevision(stateDir)
        clearCoalescedFetch(cache, inflight)
      }
      await reloadOverrides()
      const result = await publishCurrent()
      signal?.throwIfAborted()
      if (result?.ok === false && (await providerStore.enabled().catch(() => false)) === true) throw new Error('模型提供方未能注册')
      const state = await apiKeyStore.state()
      return { hasApiKey: state.hasApiKey === true }
    })
  }

  const setEnabled = async (payload, signal) => {
    assertProvider(payload)
    if (typeof payload.enabled !== 'boolean') throw new Error('渠道开关无效')
    signal?.throwIfAborted()
    const enabled = payload.enabled
    await seedPromise
    return queueState(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      await reloadOverrides()
      const previous = await providerStore.enabled()
      const wasEnabled = previous ?? settings.registerProvider
      if (enabled && wasEnabled && publisher.state.registered) return { enabled: true, providerRegistered: true }
      await providerStore.save(enabled)
      const result = await publishCurrent()
      if (enabled && result?.ok !== true) {
        await providerStore.save(wasEnabled === true).catch(() => {})
        await publishCurrent().catch(() => {})
        throw new Error('商汤模型提供方未能启用')
      }
      signal?.throwIfAborted()
      return { enabled, providerRegistered: publisher.state.registered === true }
    })
  }

  const requireCatalogModel = async modelId => {
    const entries = await catalogStore.list()
    // Reject synthetic IDs, image-generation-only entries and removed models.
    if (!entries.some(row => row?.id === modelId && !(Array.isArray(row.output_modalities) && row.output_modalities.includes('image')))) throw new Error('模型已变动，请刷新')
    return entries
  }

  const setModelEnabled = async (payload, signal) => {
    assertProvider(payload)
    const id = validateModelId(payload.modelId)
    if (typeof payload.enabled !== 'boolean') throw new Error('模型开关无效')
    signal?.throwIfAborted()
    await seedPromise
    return queueState(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const entries = await requireCatalogModel(id)
      const previous = await catalogStore.listEnabledIds()
      const current = effectiveEnabledIds(entries, previous)
      if (modelEnabled(id, current) === payload.enabled && !payload.enabled) return { modelId: id, enabled: false }
      const baseline = current.length ? current : entries.map(row => row.id)
      const next = [...new Set(baseline.filter(value => value !== HIDE_ALL && value !== id))]
      if (payload.enabled) next.push(id)
      if (!next.length) next.push(HIDE_ALL)
      signal?.throwIfAborted()
      await reloadOverrides()
      if (!await catalogStore.setEacEnabledIds(next)) throw new Error('模型设置未能保存')
      const result = await publishCurrent()
      if (result?.ok !== true) {
        if (await catalogStore.setEacEnabledIds(previous)) await publishCurrent().catch(() => {})
        throw new Error('模型设置更新失败，请刷新确认')
      }
      signal?.throwIfAborted()
      return { modelId: id, enabled: payload.enabled }
    })
  }

  const setModelParams = async (payload, signal) => {
    assertProvider(payload)
    const id = validateModelId(payload.modelId)
    const patch = validatePlanParams(payload.params)
    signal?.throwIfAborted()
    await seedPromise
    return queueState(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const entries = await requireCatalogModel(id)
      const [previousMax, previous] = await Promise.all([
        catalogStore.listEacMaxTokensOverrides(), catalogStore.listEacModelParams(),
      ])
      const base = buildDescriptors(entries.filter(row => row.id === id))[0]
      if (patch.reasoningEffort != null && !base?.thinkingLevelMap?.[patch.reasoningEffort]) throw new Error('该模型不支持此思考档位')
      const { maxTokens, ...rest } = patch
      const next = { ...previous, [id]: normalizePlanParams({ ...previous[id], ...rest }) }
      const nextMax = Object.hasOwn(patch, 'maxTokens') ? { ...previousMax, [id]: maxTokens } : previousMax
      if (!await catalogStore.setEacModelSettings(next, nextMax)) throw new Error('模型参数保存失败')
      applyOverrides(nextMax)
      settings.modelParams = next
      const result = await publishCurrent()
      if (result?.ok !== true) {
        if (await catalogStore.setEacModelSettings(previous, previousMax)) {
          applyOverrides(previousMax)
          settings.modelParams = previous
          await publishCurrent().catch(() => {})
        }
        throw new Error('模型参数更新失败')
      }
      signal?.throwIfAborted()
      const { id: modelId, name, enabled, ...model } = describeModels(entries, []).find(model => model.id === id)
      return { modelId, ...model }
    })
  }

  const resetModels = async signal => {
    await seedPromise
    return queueState(async () => {
      signal?.throwIfAborted()
      if (disposed) throw new Error('请求已结束')
      const entries = await catalogStore.list()
      const models = buildDescriptors(entries)
      if (!models.length) throw new Error('请先刷新模型目录')
      const exclusions = modelRecommendationExclusions(models, PLAN_PROVIDER_ID)
      const enabledModelIds = models.filter(model => !exclusions.has(model.id)).map(model => model.id)
      const previous = await catalogStore.listEnabledIds()
      if (!await catalogStore.setEacEnabledIds([])) throw new Error('模型设置未能保存')
      if ((await publishCurrent())?.ok !== true) {
        if (await catalogStore.setEacEnabledIds(previous)) await publishCurrent().catch(() => {})
        throw new Error('模型设置更新失败')
      }
      return { enabledModelIds }
    })
  }

  const call = async (method, payload = {}, signal) => {
    if (!PLAN_METHODS.has(method)) throw new Error('不支持此操作')
    if (disposed) throw new Error('请求已结束')
    assertProvider(payload)
    if (method === 'plan.snapshot') return snapshot(signal)
    if (method === 'plan.setKey') return saveKey(payload, signal)
    if (method === 'plan.setEnabled') return setEnabled(payload, signal)
    if (method === 'plan.setModelEnabled') return setModelEnabled(payload, signal)
    if (method === 'plan.setModelParams') return setModelParams(payload, signal)
    if (method === 'plan.resetModels') return resetModels(signal)
    throw new Error('不支持此操作')
  }

  return {
    call,
    collectSnapshot: snapshot,
    invalidateCatalog() {
      advanceCredentialRevision(stateDir)
      clearCoalescedFetch(cache, inflight)
    },
    dispose() {
      if (disposed) return
      disposed = true
      publisher.dispose()
      try { publisher.release() } catch {}
    },
  }
}
