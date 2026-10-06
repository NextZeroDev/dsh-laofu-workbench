import { chmod, mkdir, readFile, lstat, readlink, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LWB_RUNTIME } from './dsh-bundle/runtime-config.mjs'
import { dshPackageDirectory } from './dsh-bundle/dsh-adapter/package-paths.mjs'

export const PRODUCT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@scitiger-ai/lwb-dsh-bundle']

// DSH credential references are POSIX identifiers. Older LWB builds used
// hyphens, so migrate only those two known keys before DSH reads the file.
export async function migrateLwbCredentialReferences(dshHome = LWB_RUNTIME.dshHome) {
  const filename = join(dshHome, '.credentials.yaml')
  const original = await readFile(filename, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (original === undefined) return false
  const migrated = original
    .replace(/(^|\n)([ \t]*)lwb-ats-session(?=\s*:)/gu, '$1$2lwb_ats_session')
    .replace(/(^|\n)([ \t]*)lwb-ats-service(?=\s*:)/gu, '$1$2lwb_ats_service')
  if (migrated === original) return false
  const permissions = (await stat(filename)).mode & 0o777
  await writeFile(filename, migrated, { mode: permissions })
  await chmod(filename, permissions)
  return true
}

// The LWB route stopped hiding real models behind 快速/均衡/极致 tiers, so a selection
// saved against a retired tier id can no longer resolve. Two plain-text places keep
// such a selection: the profile patch layer's `agent-default-model`, and the pack
// task-model store. Both are rewritten in place and stay idempotent.
export const LWB_RETIRED_TIER_MODELS = Object.freeze({
  'lwb-fast': 'qwen3.8-flash',
  'lwb-balanced': 'deepseek-v4.1-flash',
  'lwb-ultimate': 'deepseek-v4.1-flash',
})

const AGENT_DEFAULT_MODEL_ENTRY = /^-\s+(?:id:\s*agent-default-model|name:\s*['"]?@deepseek-ai\/dsh-agent-default-model['"]?)\s*$/u

function mappedRetiredTier(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return Object.prototype.hasOwnProperty.call(LWB_RETIRED_TIER_MODELS, id) ? LWB_RETIRED_TIER_MODELS[id] : undefined
}

/**
 * Rewrite the default model of an `agent-default-model` patch entry.
 *
 * Only an entry that names the `lwb` route is touched, so an unrelated provider's
 * value is never rewritten even if it happens to look like a retired tier id.
 * @param text - Current patch-layer YAML.
 * @returns Rewritten YAML, or undefined when no entry matched.
 */
export function rewriteAgentDefaultModelPatch(text) {
  if (typeof text !== 'string' || text === '') return undefined
  const blocks = []
  for (const line of text.split('\n')) {
    if (/^-\s/u.test(line) || blocks.length === 0) blocks.push([line])
    else blocks[blocks.length - 1].push(line)
  }
  let changed = false
  for (const block of blocks) {
    if (!AGENT_DEFAULT_MODEL_ENTRY.test(block[0])) continue
    if (!block.some(line => /^\s+provider:\s*['"]?lwb['"]?\s*$/u.test(line))) continue
    for (let index = 0; index < block.length; index += 1) {
      const match = /^(\s+model:\s*)(['"]?)([^\s'"]+)\2\s*$/u.exec(block[index])
      if (match === null) continue
      const mapped = mappedRetiredTier(match[3])
      if (mapped === undefined) continue
      block[index] = `${match[1]}${match[2]}${mapped}${match[2]}`
      changed = true
    }
  }
  return changed ? blocks.flat().join('\n') : undefined
}

/** Rewrite the profile patch layer's default model selection. */
export async function migrateLwbAgentDefaultModel(profileHome = LWB_RUNTIME.profileHome) {
  const filename = join(profileHome, 'cordis.patch.yml')
  const original = await readFile(filename, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (original === undefined) return false
  const migrated = rewriteAgentDefaultModelPatch(original)
  if (migrated === undefined) return false
  const permissions = (await stat(filename)).mode & 0o777
  await writeFile(filename, migrated, { mode: permissions })
  await chmod(filename, permissions)
  return true
}

/** Rewrite the scene-task model selection, which the pack settings store owns. */
export async function migrateLwbTaskModelSelection(productHome = LWB_RUNTIME.productHome) {
  const filename = join(productHome, 'settings', 'task-model.json')
  const original = await readFile(filename, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (original === undefined) return false
  let stored
  try { stored = JSON.parse(original) } catch { return false }
  if (stored === null || typeof stored !== 'object' || stored.provider !== 'lwb') return false
  const mapped = mappedRetiredTier(stored.model)
  if (mapped === undefined) return false
  const permissions = (await stat(filename)).mode & 0o777
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`
  // Match the pack settings store's own format: two-space JSON, trailing newline, 0600.
  await writeFile(temporary, `${JSON.stringify({ ...stored, model: mapped }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, filename)
  await chmod(filename, permissions)
  return true
}

/**
 * Retire the LWB tier ids from every selection persisted in plain text.
 *
 * Historical conversation logs record the chosen model too, but they are concatenated
 * zstd frames and Node's zlib decodes only the first frame, so rewriting them needs a
 * frame-aware decoder this product does not ship. Those conversations ask for a
 * one-time model reselection rather than risking a corrupt log rewrite.
 * @param options - Profile and product roots; defaults to the resolved runtime.
 * @returns Names of the settings that changed.
 */
export async function migrateLwbModelSelection(options = {}) {
  const applied = []
  if (await migrateLwbAgentDefaultModel(options.profileHome ?? LWB_RUNTIME.profileHome)) applied.push('agent-default-model')
  if (await migrateLwbTaskModelSelection(options.productHome ?? LWB_RUNTIME.productHome)) applied.push('task-model')
  return applied
}

export async function ensureLink(link, target) {
  await mkdir(dirname(link), { recursive: true })
  const stat = await lstat(link).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (stat) {
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace installed package: ${link}`)
    if (resolve(dirname(link), await readlink(link)) === resolve(target)) return
    await unlink(link)
  }
  await symlink(resolve(target), link, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Product packages own their peer links; upstream files are never modified. */
export async function linkProductPeers(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    const target = name === '@scitiger-ai/lwb-pack-sdk'
      ? join(LWB_RUNTIME.projectRoot, 'lwb', 'pack-sdk')
      : name.startsWith('@deepseek-ai/') || name === '@earendil-works/pi-ai' ? dshPackageDirectory(name) : undefined
    if (target) await ensureLink(join(directory, 'node_modules', ...name.split('/')), target)
  }
}

/** Compose LWB through the public Profile API used by both official carriers. */
export async function prepareLwbProfile(profileDir = LWB_RUNTIME.profileHome) {
  await migrateLwbCredentialReferences()
  // Must run before DSH reads the profile, so a retired tier id never reaches the
  // model registry. Only meaningful once the ATS catalog advertises the real models.
  await migrateLwbModelSelection({ profileHome: profileDir })
  const { initProfile } = await import(pathToFileURL(join(dshPackageDirectory('@deepseek-ai/dsh-app-boot'), 'lib', 'index.js')))
  initProfile(profileDir, PRODUCT_BUNDLES)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (JSON.stringify(manifest.dsh?.profile?.bundles) !== JSON.stringify(PRODUCT_BUNDLES)) {
    throw new Error(`This is not an LWB profile: ${profileDir}. Choose a separate LWB_PRODUCT_HOME.`)
  }
  const bundle = join(LWB_RUNTIME.projectRoot, 'lwb', 'dsh-bundle')
  await linkProductPeers(join(LWB_RUNTIME.projectRoot, 'lwb', 'pack-sdk'))
  await linkProductPeers(bundle)
  await ensureLink(join(profileDir, 'node_modules', '@scitiger-ai', 'lwb-pack-sdk'), join(LWB_RUNTIME.projectRoot, 'lwb', 'pack-sdk'))
  await ensureLink(join(profileDir, 'node_modules', '@scitiger-ai', 'lwb-dsh-bundle'), bundle)
  // Reconcile persisted links before the host caches its Profile resolution,
  // including packs that were unloaded before the product was upgraded.
  const { prepareLwbPackRuntimeLinks } = await import('./dsh-bundle/pack-runtime-links.mjs')
  await prepareLwbPackRuntimeLinks(profileDir)
}
