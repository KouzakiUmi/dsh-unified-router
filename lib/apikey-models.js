import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { modelTokenBudget, normalizePlanParamMap, validateModelBudgetPatch, validatePlanParams } from './sensenova-params.js'
import { channelOutputBudget, defaultModelEffort, defaultModelOutputTokens, effectiveModelEffort, modelRecommendationExclusions, officialModelSpec } from './model-catalog.js'

export const APIKEY_MODEL_WRITES = ['apikey.setModelEnabled', 'apikey.setModelParams', 'apikey.resetModels']

// API Key 渠道（Agnes / 云知声）共用的模型开关与参数存储：形状与
// workbuddy-models.js 一致（{disabled, params} 落盘、原子写、串行队列），
// 目录行见 docs/APIKEY-CHANNELS.md §2；差异只在方法名前缀、providerId 注入
// 与 describe 额外返回 reasoning 标记。
export function createApiKeyModelSettings(file, providerId, options = {}) {
  // 渠道默认输出上限（设置页可调）：**只在上游与官方规格都没有输出值时生效**。
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
    const output = model.output > 0 ? model.output
      : (spec?.maxOutput > 0 ? spec.maxOutput
      : (channelOutputBudget(defaultMaxOutput(providerId), context) ?? defaultModelOutputTokens(model.output, context)))
    return {
      defaultContextWindow: context,
      defaultMaxOutputLength: output,
      defaultVision: model.attachment,
      defaultEffort: defaultModelEffort(model.efforts, model.defaultEffort),
    }
  }
  const describe = catalog => {
    const exclusions = modelRecommendationExclusions(catalog, providerId)
    return catalog.map(model => {
      const defaultsForModel = defaults(model)
      const params = current.params[model.id] ?? {}
      return {
        ...model, ...defaultsForModel, params,
        enabled: !(current.disabled[model.id] ?? exclusions.has(model.id)),
        ...modelTokenBudget(params, defaultsForModel),
        vision: (params.supportsImage ?? defaultsForModel.defaultVision) === true,
        effectiveEffort: effectiveModelEffort(model.efforts, params.reasoningEffort, defaultsForModel.defaultEffort),
        reasoning: model.efforts.length > 0,
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
        if (method === 'apikey.resetModels') {
          await write({ ...current, disabled: {} })
          return describe(catalog)
        }
        const model = catalog.find(row => row.id === payload.modelId)
        if (!model) throw new Error('模型已变动，请刷新')
        if (method === 'apikey.setModelEnabled') {
          if (typeof payload.enabled !== 'boolean') throw new Error('模型开关无效')
          await write({ ...current, disabled: { ...current.disabled, [model.id]: !payload.enabled } })
        } else {
          const patch = validatePlanParams(payload.params)
          if (Object.hasOwn(patch, 'compat') || patch.reasoningEffort != null && !model.efforts.includes(patch.reasoningEffort)) throw new Error('模型参数无效')
          validateModelBudgetPatch(current.params[model.id], patch, defaults(model))
          await write({ ...current, params: { ...current.params, [model.id]: { ...current.params[model.id], ...patch } } })
        }
        return describe(catalog)
      })
      pending = task.catch(() => {})
      return task
    },
  }
}
