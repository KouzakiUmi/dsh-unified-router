import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizePlanParamMap, validatePlanParams } from './sensenova-params.js'
import { defaultModelEffort, defaultModelOutputTokens, modelRecommendationExclusions } from './model-catalog.js'

export const WORKBUDDY_MODEL_WRITES = ['workbuddy.setModelEnabled', 'workbuddy.setModelParams', 'workbuddy.resetModels']

export function createWorkBuddyModelSettings(file) {
  let pending = file ? readFile(file, 'utf8').then(JSON.parse).catch(() => ({})) : Promise.resolve({})
  let current = { disabled: {}, params: {} }
  pending = pending.then(saved => {
    current = {
      disabled: Object.fromEntries(Object.entries(saved?.disabled ?? {}).filter(([, disabled]) => typeof disabled === 'boolean')),
      params: normalizePlanParamMap(saved?.params),
    }
  })

  const defaults = model => ({
    defaultContextWindow: model.context > 0 ? model.context : 128_000,
    defaultMaxOutputLength: defaultModelOutputTokens(model.output, model.context),
    defaultVision: model.attachment,
    defaultEffort: defaultModelEffort(model.efforts, model.defaultEffort),
  })
  const describe = catalog => {
    const exclusions = modelRecommendationExclusions(catalog, 'workbuddy')
    return catalog.map(model => {
      const defaultsForModel = defaults(model)
      const params = current.params[model.id] ?? {}
      return {
        ...model, ...defaultsForModel, params,
        enabled: !(current.disabled[model.id] ?? exclusions.has(model.id)),
        contextWindow: params.contextWindow ?? defaultsForModel.defaultContextWindow,
        maxOutputLength: params.maxTokens ?? defaultsForModel.defaultMaxOutputLength,
        vision: (params.supportsImage ?? defaultsForModel.defaultVision) === true,
        effectiveEffort: params.reasoningEffort ?? defaultsForModel.defaultEffort,
      }
    })
  }

  const write = async next => {
    if (!file) throw new Error('模型设置存储不可用')
    const temporary = file + '.' + randomUUID() + '.tmp'
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, file)
    } finally { await unlink(temporary).catch(() => {}) }
    current = next
  }
  return {
    async list(catalog) { await pending; return describe(catalog) },
    change(method, payload, getCatalog, signal) {
      const task = pending.then(async () => {
        signal?.throwIfAborted()
        const catalog = getCatalog()
        if (!catalog.length) throw new Error('请先刷新模型目录')
        if (method === 'workbuddy.resetModels') {
          await write({ ...current, disabled: {} })
          return describe(catalog)
        }
        const model = catalog.find(row => row.id === payload.modelId)
        if (!model) throw new Error('模型已变动，请刷新')
        if (method === 'workbuddy.setModelEnabled') {
          if (typeof payload.enabled !== 'boolean') throw new Error('模型开关无效')
          await write({ ...current, disabled: { ...current.disabled, [model.id]: !payload.enabled } })
        } else {
          const patch = validatePlanParams(payload.params)
          if (Object.hasOwn(patch, 'compat') || patch.reasoningEffort != null && !model.efforts.includes(patch.reasoningEffort)) throw new Error('模型参数无效')
          await write({ ...current, params: { ...current.params, [model.id]: { ...current.params[model.id], ...patch } } })
        }
        return describe(catalog)
      })
      pending = task.catch(() => {})
      return task
    },
  }
}
