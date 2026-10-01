/**
 * Resolve the capability-pack set and product identity of a Desktop edition.
 *
 * An edition is a build input, never a property of the working tree. The pack
 * list decides which capability packs a product build ships, so a private pack
 * reaches a build only when that build names it, not by being present on disk.
 * A pack without a `source` must be repository-owned under `lwb/packs/`; a pack
 * with a `source` is an absolute directory supplied by the caller, given as a
 * path with `${VARIABLE}` references so a release pins the checkout it uses.
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { inspectLwbPack } from '../dsh-bundle/pack-manager.mjs'

export const EDITION_SCHEMA_VERSION = 1
export const EDITION_MANIFEST_PATH = ['lwb', 'desktop', 'editions.json']

const EDITION_NAME = /^[a-z][a-z0-9-]*$/u
const PACK_ID = /^[a-z][a-z0-9-]{1,62}$/u
const PROTOCOL_SCHEME = /^[a-z][a-z0-9+.-]*$/u
const VARIABLE = /\$\{([A-Z_][A-Z0-9_]*)\}/gu

/** Raised for a malformed edition manifest or an edition that cannot resolve. */
export class LwbEditionError extends Error {}

function text(value, label, maxLength = 128) {
  if (typeof value !== 'string') throw new LwbEditionError(`${label} must be text`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) throw new LwbEditionError(`${label} must contain 1-${maxLength} characters`)
  return trimmed
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LwbEditionError(`${label} must be an object`)
  return value
}

function expandVariables(source, label, env) {
  return source.replace(VARIABLE, (_match, name) => {
    const value = env[name]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new LwbEditionError(`${label} needs the environment variable ${name}`)
    }
    return value
  })
}

/** Read and validate the edition manifest without resolving any pack directory. */
export async function loadEditionManifest(projectRoot) {
  const path = join(projectRoot, ...EDITION_MANIFEST_PATH)
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new LwbEditionError(`Edition manifest is missing: ${path}`)
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new LwbEditionError(`Edition manifest is not valid JSON: ${path}`)
  }
  const manifest = object(parsed, 'Edition manifest')
  if (manifest.schemaVersion !== EDITION_SCHEMA_VERSION) {
    throw new LwbEditionError(`Edition manifest schemaVersion must be ${EDITION_SCHEMA_VERSION}`)
  }
  const editions = object(manifest.editions, 'Edition manifest editions')
  const names = Object.keys(editions).sort()
  if (names.length === 0) throw new LwbEditionError('Edition manifest declares no editions')
  for (const name of names) {
    if (!EDITION_NAME.test(name)) throw new LwbEditionError(`Edition name is invalid: ${JSON.stringify(name)}`)
    const label = `Edition ${name}`
    const edition = object(editions[name], label)
    text(edition.productName, `${label} productName`)
    const artifactName = text(edition.artifactName, `${label} artifactName`)
    if (!artifactName.includes('${version}')) throw new LwbEditionError(`${label} artifactName must contain \${version}`)
    text(edition.productHome, `${label} productHome`, 64)
    if (!PROTOCOL_SCHEME.test(text(edition.protocolScheme, `${label} protocolScheme`, 32))) {
      throw new LwbEditionError(`${label} protocolScheme is invalid`)
    }
    if (!Array.isArray(edition.packs) || edition.packs.length === 0) {
      throw new LwbEditionError(`${label} must declare at least one capability pack`)
    }
    const ids = new Set()
    edition.packs.forEach((candidate, index) => {
      const entryLabel = `${label} packs[${index}]`
      const entry = object(candidate, entryLabel)
      const id = text(entry.id, `${entryLabel}.id`, 63)
      if (!PACK_ID.test(id)) throw new LwbEditionError(`${entryLabel}.id is invalid: ${JSON.stringify(id)}`)
      if (ids.has(id)) throw new LwbEditionError(`${label} declares capability pack ${id} twice`)
      ids.add(id)
      if (entry.source !== undefined) text(entry.source, `${entryLabel}.source`, 512)
    })
  }
  // An explicit default is required: silently picking the first edition would
  // let an alphabetical accident decide what a release ships.
  const fallback = text(manifest.default, 'Edition manifest default', 64)
  if (!names.includes(fallback)) {
    throw new LwbEditionError(`Edition manifest default ${JSON.stringify(fallback)} is not a declared edition`)
  }
  return Object.freeze({
    schemaVersion: EDITION_SCHEMA_VERSION,
    default: fallback,
    names: Object.freeze(names),
    editions: Object.freeze(editions),
  })
}

/**
 * Resolve one declared edition into the packs a build may package.
 *
 * Every pack is inspected with the same rules the host applies when it loads a
 * pack, so a pack that would fail at runtime cannot enter a product build.
 */
export async function resolveEdition(manifest, name, { projectRoot, ownedPacks, env = process.env } = {}) {
  if (typeof projectRoot !== 'string' || projectRoot === '') throw new LwbEditionError('resolveEdition needs a projectRoot')
  if (!manifest?.names?.includes(name)) {
    throw new LwbEditionError(`Unknown edition ${JSON.stringify(name)}; declared editions: ${(manifest?.names ?? []).join(', ')}`)
  }
  const edition = object(manifest.editions[name], `Edition ${name}`)
  const packs = []
  for (const entry of edition.packs) {
    const label = `Edition ${name} pack ${entry.id}`
    let source
    if (entry.source === undefined) {
      if (ownedPacks !== undefined && !ownedPacks.has(entry.id)) {
        throw new LwbEditionError(`${label} declares no source and ${entry.id} is not owned by this repository`)
      }
      source = join(projectRoot, 'lwb', 'packs', entry.id)
    } else {
      const expanded = expandVariables(entry.source, label, env)
      if (!isAbsolute(expanded)) throw new LwbEditionError(`${label} source must be absolute after expansion, got ${JSON.stringify(expanded)}`)
      source = resolve(expanded)
    }
    const inspected = await inspectLwbPack(source).catch((error) => {
      throw new LwbEditionError(`${label} cannot be packaged: ${error instanceof Error ? error.message : String(error)}`)
    })
    if (inspected.manifest.id !== entry.id) {
      throw new LwbEditionError(`${label} resolves to capability pack ${inspected.manifest.id} at ${inspected.source}`)
    }
    packs.push(Object.freeze({
      id: entry.id,
      packageName: inspected.manifest.packageName,
      version: inspected.manifest.version,
      source: inspected.source,
    }))
  }
  return Object.freeze({
    name,
    productName: text(edition.productName, `Edition ${name} productName`),
    artifactName: text(edition.artifactName, `Edition ${name} artifactName`),
    productHome: text(edition.productHome, `Edition ${name} productHome`, 64),
    protocolScheme: text(edition.protocolScheme, `Edition ${name} protocolScheme`, 32),
    packs: Object.freeze(packs),
  })
}