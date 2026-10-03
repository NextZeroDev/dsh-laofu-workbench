import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function runtimePackRecord(record, productHome, currentRuntime) {
  if (!record || typeof record !== 'object' || typeof record.source !== 'string' || !isAbsolute(record.source)) return null
  if (typeof record.id !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/u.test(record.id)) return null
  const relativeSource = relative(resolve(productHome, 'runtime'), resolve(record.source)).split(sep)
  if (relativeSource.length !== 4 || relativeSource[1] !== 'lwb' || relativeSource[2] !== 'packs' || relativeSource[3] !== record.id) return null
  const target = join(resolve(currentRuntime), 'lwb', 'packs', record.id)
  return { ...record, source: target, target }
}

/** Point registered built-in packs at the current product runtime after an upgrade. */
export async function migrateRuntimePackRegistry(registryPath, { productHome, currentRuntime } = {}) {
  if (typeof registryPath !== 'string' || typeof productHome !== 'string' || typeof currentRuntime !== 'string') return false
  let source
  try { source = await readFile(registryPath, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  let registry
  try { registry = JSON.parse(source) } catch { return false }
  if (registry?.schemaVersion !== 2 || !Array.isArray(registry.packs)) return false

  let changed = false
  const packs = []
  for (const record of registry.packs) {
    const candidate = runtimePackRecord(record, productHome, currentRuntime)
    if (!candidate || candidate.source === record.source) {
      packs.push(record)
      continue
    }
    try { await access(candidate.target) } catch {
      packs.push(record)
      continue
    }
    changed = true
    packs.push(candidate)
  }
  if (!changed) return false

  const next = `${registryPath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(registryPath), { recursive: true })
  await writeFile(next, `${JSON.stringify({ ...registry, packs }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(next, registryPath)
  return true
}
