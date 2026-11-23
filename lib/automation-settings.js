// 自动化配置持久化：统一管理全局与分渠道的「自动签到」「自动领取奖励」「自动执行完成任务」开关。
// 落盘为 <stateDir>/automation.json（原子写 + 串行队列，权限 0700/0600）。
// 分渠道字段为布尔时覆盖全局；缺省或显式设为 null 时继承全局设置。
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const AUTOMATION_METHODS = Object.freeze(new Set([
  'automation.status',
  'automation.setConfig',
  'automation.run',
  'automation.query',
]))

const BOOL_FIELDS = ['autoCheckin', 'autoClaimRewards', 'autoCompleteTasks', 'cotLoopGuard']
const GLOBAL_BOOL_FIELDS = [...BOOL_FIELDS, 'preferExpiringQuota', 'raccoonUnifiedModels']
// 分渠道的默认输出上限（token）：**只在上游没给输出规格时生效**
// （目录 `max_output` 缺失或为 null，如云知声 u2-med / u2-radimed）。
// 上游有值就用上游值，这个设置只补缺，不覆盖真实规格。
const PROVIDER_NUMBER_FIELDS = ['defaultMaxOutput']
export const DEFAULT_MAX_OUTPUT_LIMIT = 10_000_000
const validMaxOutput = value => Number.isSafeInteger(value) && value > 0 && value <= DEFAULT_MAX_OUTPUT_LIMIT
// 智能选号模式（全局单选）。'expiring' 与旧布尔 preferExpiringQuota 双向兼容：
// 旧文件只有布尔时读入映射；新写入同时落两字段，旧版本读文件也一致。
export const ROUTING_MODES = Object.freeze(['manual', 'free', 'expiring', 'sticky'])
const routingModeOf = (saved, fallback) => ROUTING_MODES.includes(saved) ? saved
  : saved === true ? 'expiring' : fallback

function sanitizeProviderOverride(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const field of BOOL_FIELDS) {
    if (typeof raw[field] === 'boolean') out[field] = raw[field]
  }
  for (const field of PROVIDER_NUMBER_FIELDS) {
    if (validMaxOutput(raw[field])) out[field] = raw[field]
  }
  return out
}

function readInitialConfig(file, defaults) {
  const base = {
    version: 1,
    autoCheckin: defaults.autoCheckin !== false,
    autoClaimRewards: defaults.autoClaimRewards !== false,
    autoCompleteTasks: defaults.autoCompleteTasks === true,
    cotLoopGuard: defaults.cotLoopGuard !== false,
    preferExpiringQuota: defaults.preferExpiringQuota === true,
    raccoonUnifiedModels: defaults.raccoonUnifiedModels === true,
    routingMode: routingModeOf(defaults.routingMode, defaults.preferExpiringQuota === true ? 'expiring' : 'manual'),
    providers: {},
  }
  if (!file) return base
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base
    const providers = {}
    if (saved.providers && typeof saved.providers === 'object' && !Array.isArray(saved.providers)) {
      for (const [id, entry] of Object.entries(saved.providers)) {
        if (typeof id !== 'string' || !id || id.length > 64 || ['__proto__', 'prototype', 'constructor'].includes(id)) continue
        const clean = sanitizeProviderOverride(entry)
        if (Object.keys(clean).length) providers[id] = clean
      }
    }
    return {
      version: 1,
      autoCheckin: typeof saved.autoCheckin === 'boolean' ? saved.autoCheckin : base.autoCheckin,
      autoClaimRewards: typeof saved.autoClaimRewards === 'boolean' ? saved.autoClaimRewards : base.autoClaimRewards,
      autoCompleteTasks: typeof saved.autoCompleteTasks === 'boolean' ? saved.autoCompleteTasks : base.autoCompleteTasks,
      cotLoopGuard: typeof saved.cotLoopGuard === 'boolean' ? saved.cotLoopGuard : base.cotLoopGuard,
      // 优先读 routingMode；旧文件只有布尔 preferExpiringQuota 时迁移映射，
      // 旧字段随后由模式派生，保证新旧读者一致。
      routingMode: routingModeOf(saved.routingMode, saved.preferExpiringQuota === true ? 'expiring' : 'manual'),
      preferExpiringQuota: routingModeOf(saved.routingMode, saved.preferExpiringQuota === true ? 'expiring' : 'manual') === 'expiring',
      raccoonUnifiedModels: typeof saved.raccoonUnifiedModels === 'boolean' ? saved.raccoonUnifiedModels : base.raccoonUnifiedModels,
      providers,
    }
  } catch {
    return base
  }
}

export function publicAutomationConfig(value, allowedProviders = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const allow = allowedProviders ? new Set(allowedProviders) : null
  const providers = {}
  if (source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)) {
    for (const [id, entry] of Object.entries(source.providers)) {
      if (typeof id !== 'string' || !id || id.length > 64) continue
      if (allow && !allow.has(id)) continue
      const clean = sanitizeProviderOverride(entry)
      if (Object.keys(clean).length) providers[id] = clean
    }
  }
  return {
    autoCheckin: source.autoCheckin !== false,
    autoClaimRewards: source.autoClaimRewards !== false,
    autoCompleteTasks: source.autoCompleteTasks === true,
    cotLoopGuard: source.cotLoopGuard !== false,
    routingMode: routingModeOf(source.routingMode, source.preferExpiringQuota === true ? 'expiring' : 'manual'),
    preferExpiringQuota: routingModeOf(source.routingMode, source.preferExpiringQuota === true ? 'expiring' : 'manual') === 'expiring',
    raccoonUnifiedModels: source.raccoonUnifiedModels === true,
    providers,
  }
}

export function createAutomationSettings({ file, defaults = {}, allowedProviders = () => [], onChange } = {}) {
  let state = readInitialConfig(file, defaults)
  let queue = Promise.resolve()

  async function persist(next) {
    if (!file) return
    const temporary = file + '.' + randomUUID() + '.tmp'
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, file)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  function effective(field, provider) {
    if (!BOOL_FIELDS.includes(field)) return false
    if (typeof provider === 'string' && Object.hasOwn(state.providers, provider)) {
      const override = state.providers[provider]?.[field]
      if (typeof override === 'boolean') return override
    }
    return state[field] === true
  }

  function snapshot() {
    const allowed = typeof allowedProviders === 'function' ? allowedProviders() : allowedProviders
    return publicAutomationConfig(state, allowed?.length ? allowed : null)
  }

  function update(patch = {}) {
    const task = queue.then(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('自动化设置无效')
      }
      const allowed = new Set(typeof allowedProviders === 'function' ? allowedProviders() : allowedProviders)
      const next = {
        version: 1,
        autoCheckin: state.autoCheckin,
        autoClaimRewards: state.autoClaimRewards,
        autoCompleteTasks: state.autoCompleteTasks,
        cotLoopGuard: state.cotLoopGuard,
        preferExpiringQuota: state.preferExpiringQuota,
        raccoonUnifiedModels: state.raccoonUnifiedModels,
        routingMode: state.routingMode,
        providers: Object.fromEntries(Object.entries(state.providers).map(([id, entry]) => [id, { ...entry }])),
      }
      if (patch.provider !== undefined) {
        if (patch.preferExpiringQuota !== undefined) throw new Error('额度优先是全局设置')
        if (patch.routingMode !== undefined) throw new Error('选号模式是全局设置')
        if (typeof patch.provider !== 'string' || !patch.provider || (allowed.size && !allowed.has(patch.provider))) {
          throw new Error('不支持此渠道')
        }
        const entry = { ...(next.providers[patch.provider] ?? {}) }
        let touched = false
        for (const field of BOOL_FIELDS) {
          if (patch[field] === undefined) continue
          touched = true
          if (patch[field] === null) delete entry[field]
          else if (typeof patch[field] === 'boolean') entry[field] = patch[field]
          else throw new Error('自动化开关无效')
        }
        // 默认输出上限：null 清除（回到上游规格/通用推导），正整数写入。
        for (const field of PROVIDER_NUMBER_FIELDS) {
          if (patch[field] === undefined) continue
          touched = true
          if (patch[field] === null) delete entry[field]
          else if (validMaxOutput(patch[field])) entry[field] = patch[field]
          else throw new Error('输出上限无效')
        }
        if (!touched) throw new Error('自动化设置无效')
        if (Object.keys(entry).length) next.providers[patch.provider] = entry
        else delete next.providers[patch.provider]
      } else {
        let touched = false
        if (patch.routingMode !== undefined) {
          if (!ROUTING_MODES.includes(patch.routingMode)) throw new Error('选号模式无效')
          next.routingMode = patch.routingMode
          next.preferExpiringQuota = patch.routingMode === 'expiring'
          touched = true
        }
        for (const field of GLOBAL_BOOL_FIELDS) {
          if (patch[field] === undefined) continue
          touched = true
          if (typeof patch[field] !== 'boolean') throw new Error('自动化开关无效')
          next[field] = patch[field]
          // 旧布尔开关与 routingMode 双向同步：开启 = 临期优先；
          // 关闭只把「临期优先」降回手动，不推翻 free / sticky 等其它模式。
          if (field === 'preferExpiringQuota') {
            if (patch[field] === true) next.routingMode = 'expiring'
            else if (next.routingMode === 'expiring') next.routingMode = 'manual'
          }
        }
        if (!touched) throw new Error('自动化设置无效')
      }
      await persist(next)
      state = next
      const out = snapshot()
      await onChange?.(out, patch)
      return out
    })
    queue = task.catch(() => {})
    return task
  }

  return {
    snapshot,
    update,
    isAutoCheckinEnabled: provider => effective('autoCheckin', provider),
    isAutoClaimRewardsEnabled: provider => effective('autoClaimRewards', provider),
    isAutoCompleteTasksEnabled: provider => effective('autoCompleteTasks', provider),
    isCotLoopGuardEnabled: provider => effective('cotLoopGuard', provider),
    isQuotaPriorityEnabled: () => state.preferExpiringQuota === true,
    routingMode: () => state.routingMode,
    /**
     * 某渠道的默认输出上限（token）：**仅在上游缺输出规格时使用**。
     * 未设置返回 undefined（调用方回落到上游规格与通用推导）。
     */
    defaultMaxOutputFor: provider => {
      if (typeof provider !== 'string' || !provider) return undefined
      const value = state.providers?.[provider]?.defaultMaxOutput
      return validMaxOutput(value) ? value : undefined
    },
    isRaccoonUnifiedModels: () => state.raccoonUnifiedModels === true,
  }
}
