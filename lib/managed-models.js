// 自管多账号渠道共用的模型开关与参数持久化（{disabled, params} 原子写 + 串行队列）。
// 与 apikey-models.js / workbuddy-models.js 同构，按 providerId 隔离推荐排除规则。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { modelTokenBudget, normalizePlanParamMap, validateModelBudgetPatch, validatePlanParams } from './sensenova-params.js'
import { channelOutputBudget, channelOutputHardCap, defaultModelEffort, defaultModelOutputTokens, effectiveModelEffort, modelRecommendationExclusions, officialModelSpec } from './model-catalog.js'

export const MANAGED_MODEL_WRITES = Object.freeze([
  'managed.setModelEnabled',
  'managed.setModelParams',
  'managed.resetModels',
])

export function createManagedModelSettings(file, providerId, options = {}) {
  const hardCap = channelOutputHardCap(providerId)
  // 渠道默认输出上限（设置页可调）：只在上游与官方规格都没给输出值时生效。
  const defaultMaxOutput = typeof options.defaultMaxOutput === 'function' ? options.defaultMaxOutput : () => undefined
  let pending = file ? readFile(file, 'utf8').then(JSON.parse).catch(() => ({})) : Promise.resolve({})
  let current = { disabled: {}, params: {} }
  pending = pending.then(saved => {
    current = {
      disabled: Object.fromEntries(Object.entries(saved?.disabled ?? {}).filter(([, disabled]) => typeof disabled === 'boolean')),
      params: normalizePlanParamMap(saved?.params),
    }
  })

  const defaults = model => {
    const spec = officialModelSpec(model.id, providerId)
    const context = model.context > 0 ? model.context : (spec?.context > 0 ? spec.context : 128_000)
    const rawOutput = model.output > 0 ? model.output
      : (spec?.maxOutput > 0 ? spec.maxOutput
      : (channelOutputBudget(defaultMaxOutput(providerId), context) ?? defaultModelOutputTokens(model.output, context)))
    const output = hardCap !== null ? Math.min(hardCap, rawOutput) : rawOutput
    return {
      defaultContextWindow: context,
      defaultMaxOutputLength: output,
      defaultVision: typeof model.attachment === 'boolean' ? model.attachment : null,
      defaultEffort: defaultModelEffort(model.efforts ?? [], model.defaultEffort),
    }
  }

  const describe = catalog => {
    const exclusions = modelRecommendationExclusions(catalog, providerId)
    return catalog.map(model => {
      const defaultsForModel = defaults(model)
      const params = current.params[model.id] ?? {}
      const efforts = Array.isArray(model.efforts) ? model.efforts : []
      return {
        ...model,
        ...defaultsForModel,
        efforts,
        params,
        enabled: !(current.disabled[model.id] ?? exclusions.has(model.id)),
        ...modelTokenBudget(params, defaultsForModel, hardCap),
        vision: (params.supportsImage ?? defaultsForModel.defaultVision) === true,
        effectiveEffort: effectiveModelEffort(efforts, params.reasoningEffort, defaultsForModel.defaultEffort),
        reasoning: efforts.length > 0 || model.reasoning === true,
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
        if (method === 'managed.resetModels') {
          await write({ ...current, disabled: {} })
          return describe(catalog)
        }
        const model = catalog.find(row => row.id === payload.modelId)
        if (!model) throw new Error('模型已变动，请刷新')
        if (method === 'managed.setModelEnabled') {
          if (typeof payload.enabled !== 'boolean') throw new Error('模型开关无效')
          await write({ ...current, disabled: { ...current.disabled, [model.id]: !payload.enabled } })
        } else {
          const patch = validatePlanParams(payload.params)
          const efforts = Array.isArray(model.efforts) ? model.efforts : []
          if (patch.reasoningEffort != null && !efforts.includes(patch.reasoningEffort)) {
            throw new Error('模型参数无效')
          }
          const prev = current.params[model.id] ?? {}
          validateModelBudgetPatch(prev, patch, defaults(model), hardCap)
          const merged = { ...prev, ...patch }
          if (patch.compat === null) delete merged.compat
          else if (patch.compat && typeof patch.compat === 'object') merged.compat = { ...(prev.compat ?? {}), ...patch.compat }
          await write({ ...current, params: { ...current.params, [model.id]: merged } })
        }
        return describe(catalog)
      })
      pending = task.catch(() => {})
      return task
    },
  }
}
