import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUNDLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)))
const PROJECT_ROOT = resolve(BUNDLE_DIR, '..', '..')

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function profileId() {
  const explicit = text(process.env.LWB_PROFILE_ID)
  if (explicit) return explicit
  // The official Desktop Host launches dsh through Electron's Node carrier.
  // Keep the web launcher on its historical `lwb` profile unless the Desktop
  // shell explicitly selects another product profile.
  return process.env.ELECTRON_RUN_AS_NODE === '1' ? 'desktop' : 'lwb'
}

// One product data root, independent of carrier, profile and installed DSH version.
const productHome = resolve(text(process.env.LWB_PRODUCT_HOME) || join(PROJECT_ROOT, 'lwb', 'local', 'current'))
const dshHome = resolve(text(process.env.LWB_DSH_HOME) || text(process.env.DSH_HOME) || join(productHome, 'dsh-home'))

export const LWB_RUNTIME = Object.freeze({
  projectRoot: PROJECT_ROOT,
  dshRuntimeDir: resolve(text(process.env.LWB_DSH_RUNTIME_DIR) || join(PROJECT_ROOT, 'vendor', 'deepseek-harness')),
  dshHome,
  profileId: profileId(),
  profileHome: resolve(text(process.env.LWB_PROFILE_DIR) || join(dshHome, 'profiles', profileId())),
  packStateDir: resolve(text(process.env.LWB_PACK_STATE_DIR) || join(productHome, 'pack-state')),
  productHome,
  registryPath: resolve(text(process.env.LWB_PACK_REGISTRY) || join(productHome, 'packs.json')),
  sourcePacksDir: resolve(text(process.env.LWB_PACKS_DIR) || join(PROJECT_ROOT, 'lwb', 'packs')),
  atsBaseUrl: normalizeAtsUrl(process.env.LWB_ATS_URL),
  packRuntimeDir: text(process.env.LWB_PACK_RUNTIME_DIR) ? resolve(process.env.LWB_PACK_RUNTIME_DIR) : undefined,
})

function normalizeAtsUrl(value) {
  const candidate = text(value)
  if (!candidate) return undefined
  try { return new URL(candidate).href.replace(/\/$/u, '') } catch { return undefined }
}

export function lwbProfilePath(...segments) {
  return join(LWB_RUNTIME.profileHome, ...segments)
}

export function lwbProductPath(...segments) {
  return join(LWB_RUNTIME.productHome, ...segments)
}
