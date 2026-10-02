import { chmod, mkdir, readFile, lstat, readlink, stat, symlink, unlink, writeFile } from 'node:fs/promises'
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
}
