import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Callers save parsed model metadata, never credentials or raw API responses.
export function readCatalogCache(file, scope = '') {
  if (!file) return undefined
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (saved.version !== 1 || saved.scope !== scope || !Array.isArray(saved.models)
      || !saved.models.length || saved.models.length > 512
      || saved.models.some(model => typeof model?.id !== 'string' || !model.id || model.id.length > 256
        || typeof model.name !== 'string' || !model.name || model.name.length > 512)) return undefined
    return saved.models
  } catch { return undefined }
}

export async function saveCatalogCache(file, models, scope = '') {
  if (!file || !models.length || models.length > 512) return
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(temp, JSON.stringify({ version: 1, scope, models }), { mode: 0o600 })
    await rename(temp, file)
  } finally {
    await unlink(temp).catch(() => {})
  }
}
