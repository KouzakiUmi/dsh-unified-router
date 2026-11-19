import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const SNAPSHOT_INTERVAL_MS = 60_000
const fileWrites = new Map()
const owners = new Map()

/**
 * Resources define their collection and public projection. Reads return the
 * last committed value while independent collectors run on the host.
 */
export function createSettingsSnapshots(file, resources, { logger, interval = SNAPSHOT_INTERVAL_MS } = {}) {
  const entries = new Map()
  const jobs = new Map()
  const dirty = new Set()
  const lifetime = new AbortController()
  const instance = randomUUID()
  let revision = 0
  const publish = (key, value) => { entries.set(key, value); revision++ }
  let scheduled = false
  owners.set(file, instance)
  const ready = (async () => {
    try {
      await fileWrites.get(file)
      const saved = JSON.parse(await readFile(file, 'utf8'))
      if (saved.version !== 1) return
      for (const [key, resource] of resources) {
        const row = saved.entries?.[key]
        if (Number.isFinite(row?.at) && row?.value && typeof row.value === 'object') {
          try {
            entries.set(key, { at: row.at, value: resource.restore(row.value), stale: row.stale === true })
          } catch { /* Discard the damaged resource. */ }
        }
      }
    } catch { /* First run or unreadable snapshot. Collectors rebuild it. */ }
  })()

  function persist() {
    if (scheduled) return
    scheduled = true
    const write = (fileWrites.get(file) ?? Promise.resolve()).then(async () => {
      scheduled = false
      if (owners.get(file) !== instance) return
      const temporary = file + '.' + randomUUID() + '.tmp'
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        await writeFile(temporary, JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }), { mode: 0o600 })
        await rename(temporary, file)
      } catch {
        await unlink(temporary).catch(() => {})
        logger?.warn?.('[unified-router] 设置快照写入失败')
      }
    }).finally(() => {
      if (fileWrites.get(file) === write) fileWrites.delete(file)
      if (owners.get(file) === instance && lifetime.signal.aborted && !scheduled) owners.delete(file)
    })
    fileWrites.set(file, write)
  }

  function collect(key) {
    if (lifetime.signal.aborted) return Promise.resolve()
    if (jobs.has(key)) return jobs.get(key)
    const resource = resources.get(key)
    if (!resource) return Promise.resolve()
    const task = ready.then(async () => {
      do {
        dirty.delete(key)
        const previous = entries.get(key)
        const signal = lifetime.signal
        try {
          signal.throwIfAborted()
          const current = await resource.collect(signal)
          signal.throwIfAborted()
          if (!dirty.has(key)) {
            const next = resource.merge?.(current, previous) ?? { value: current, at: Date.now(), stale: false }
            publish(key, next)
            persist()
          }
        } catch {
          if (!lifetime.signal.aborted && !dirty.has(key) && !previous?.stale) {
            publish(key, { ...(previous ?? { at: null, value: null }), stale: true })
            if (previous?.value) persist()
          }
        }
      } while (dirty.has(key) && !lifetime.signal.aborted)
    }).finally(() => jobs.delete(key))
    jobs.set(key, task)
    return task
  }

  const refresh = keys => Promise.all([...keys].map(collect))
  const timer = setInterval(() => { void refresh(resources.keys()) }, interval)
  timer.unref?.()
  return {
    refresh,
    async read(key) { await ready; return entries.get(key) ?? null },
    async readAll(cursor) {
      await ready
      const current = instance + ':' + revision
      return { cursor: current, entries: cursor === current ? null : Object.fromEntries(entries) }
    },
    async changed(key, patch) {
      await ready
      if (lifetime.signal.aborted || !resources.has(key)) return
      if (jobs.has(key)) dirty.add(key)
      const old = entries.get(key)
      if (old?.value && patch) {
        publish(key, { ...old, value: resources.get(key).restore(patch(old.value)) })
        persist()
      }
      void collect(key)
    },
    dispose() {
      clearInterval(timer)
      lifetime.abort()
      if (!fileWrites.has(file) && owners.get(file) === instance) owners.delete(file)
    },
  }
}
