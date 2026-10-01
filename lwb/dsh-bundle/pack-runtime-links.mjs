import { cp, lstat, mkdir, readFile, readlink, rm, symlink, unlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LWB_RUNTIME, lwbProfilePath } from './runtime-config.mjs'
import { dshPackageDirectory } from './dsh-adapter/package-paths.mjs'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROFILE_NODE_MODULES = join(lwbProfilePath(), 'node_modules')

function packagePath(nodeModules, packageName) {
  const segments = packageName.split('/')
  return packageName.startsWith('@') ? join(nodeModules, segments[0], segments[1]) : join(nodeModules, packageName)
}

export async function ensureLwbRuntimeSymlink(linkPath, target) {
  await mkdir(dirname(linkPath), { recursive: true })
  const stats = await lstat(linkPath).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (stats) {
    if (!stats.isSymbolicLink()) throw new Error(`LWB profile path is not a symlink: ${linkPath}`)
    if (resolve(dirname(linkPath), await readlink(linkPath)) === resolve(target)) return
    await unlink(linkPath)
  }
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

function runtimePackPath(pack) {
  const root = LWB_RUNTIME.packRuntimeDir
  if (root === undefined) return undefined
  const id = pack?.manifest?.id
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/u.test(id)) {
    throw new Error('Cannot materialize an LWB pack with an invalid id.')
  }
  return join(root, id)
}

/**
 * Copy a capability pack into the writable product area when its source is
 * shipped inside an immutable Desktop application resource tree. The copy is
 * intentionally code-only; durable pack data remains in the pack workspace.
 */
async function preparePackSource(pack) {
  const target = runtimePackPath(pack)
  if (target === undefined || resolve(target) === resolve(pack.source)) return pack.source
  await mkdir(dirname(target), { recursive: true })
  await rm(target, { recursive: true, force: true })
  await cp(pack.source, target, {
    recursive: true,
    dereference: false,
    filter: (source) => !source.endsWith(`${sep}node_modules`) && !source.includes(`${sep}node_modules${sep}`),
  })
  return target
}

/** Make a locally registered package resolvable by the active DSH Profile. */
export async function linkLwbPackForRuntime(pack) {
  if (!pack?.source || !pack?.manifest?.packageName) throw new Error('Cannot link an invalid LWB pack for runtime use.')
  const source = await preparePackSource(pack)
  await mkdir(PROFILE_NODE_MODULES, { recursive: true })
  await ensureLwbRuntimeSymlink(packagePath(PROFILE_NODE_MODULES, pack.manifest.packageName), source)

  const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const declared = Object.assign({}, packageJson.dependencies, packageJson.peerDependencies)
  const packageNodeModules = join(source, 'node_modules')
  for (const name of Object.keys(declared)) {
    const target = name === '@scitiger-ai/lwb-pack-sdk'
      ? join(ROOT_DIR, 'lwb', 'pack-sdk')
      : name.startsWith('@deepseek-ai/') ? dshPackageDirectory(name) : undefined
    if (target) await ensureLwbRuntimeSymlink(packagePath(packageNodeModules, name), target)
  }
}
