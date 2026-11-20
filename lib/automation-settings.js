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
]))

const BOOL_FIELDS = ['autoCheckin', 'autoClaimRewards', 'autoCompleteTasks', 'cotLoopGuard']

function sanitizeProviderOverride(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const field of BOOL_FIELDS) {
    if (typeof raw[field] === 'boolean') out[field] = raw[field]
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
        providers: Object.fromEntries(Object.entries(state.providers).map(([id, entry]) => [id, { ...entry }])),
      }
      if (patch.provider !== undefined) {
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
        if (!touched) throw new Error('自动化设置无效')
        if (Object.keys(entry).length) next.providers[patch.provider] = entry
        else delete next.providers[patch.provider]
      } else {
        let touched = false
        for (const field of BOOL_FIELDS) {
          if (patch[field] === undefined) continue
          touched = true
          if (typeof patch[field] !== 'boolean') throw new Error('自动化开关无效')
          next[field] = patch[field]
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
  }
}
