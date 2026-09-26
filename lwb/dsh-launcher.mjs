import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LWB_RUNTIME } from './dsh-bundle/runtime-config.mjs'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_DIR = join(ROOT_DIR, 'vendor', 'deepseek-harness')
const PROFILE_SOURCE_DIR = join(ROOT_DIR, 'lwb', 'profile')
const BUNDLE_DIR = join(ROOT_DIR, 'lwb', 'dsh-bundle')
const LLM_DIR = join(DSH_DIR, 'packages', 'llm', 'llm')
const CORDIS_DIR = join(DSH_DIR, 'vendor', 'cordis')
const TYPERT_PROTOCOL_DIR = join(DSH_DIR, 'packages', 'typert', 'protocol')
const PACK_SDK_DIR = join(ROOT_DIR, 'lwb', 'pack-sdk')
const DSH_HOME = LWB_RUNTIME.dshHome
const PROFILE_DIR = LWB_RUNTIME.profileHome
const PROFILE_NODE_MODULES = join(PROFILE_DIR, 'node_modules')
const BUNDLE_NODE_MODULES = join(BUNDLE_DIR, 'node_modules')
const BUILT_CLI_ENTRY = join(DSH_DIR, 'apps', 'cli', 'lib', 'bin.js')
const SOURCE_CLI_ENTRY = join(DSH_DIR, 'apps', 'cli', 'src', 'bin.ts')
const TSX_LOADER = join(DSH_DIR, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')

async function ensureSymlink(linkPath, target) {
  await mkdir(dirname(linkPath), { recursive: true })
  if (existsSync(linkPath)) {
    const stats = await lstat(linkPath)
    if (!stats.isSymbolicLink()) throw new Error(`LWB profile path is not a symlink: ${linkPath}`)
    if (resolve(dirname(linkPath), await readlink(linkPath)) === resolve(target)) return
    await unlink(linkPath)
  }
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

async function syncProfile() {
  if (!existsSync(DSH_DIR)) throw new Error(`Missing vendored DSH checkout: ${DSH_DIR}`)
  if (!existsSync(BUILT_CLI_ENTRY) && (!existsSync(SOURCE_CLI_ENTRY) || !existsSync(TSX_LOADER))) {
    throw new Error('Vendored DSH dependencies are not built/installed; run corepack pnpm install and pnpm run build in vendor/deepseek-harness')
  }

  await mkdir(PROFILE_DIR, { recursive: true })
  await mkdir(PROFILE_NODE_MODULES, { recursive: true })
  const sourceProfile = JSON.parse(await readFile(join(PROFILE_SOURCE_DIR, 'package.json'), 'utf8'))
  const bundles = sourceProfile?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error('LWB Profile source must declare dsh.profile.bundles')
  await writeFile(join(PROFILE_DIR, 'package.json'), `${JSON.stringify(sourceProfile, null, 2)}\n`)
  await writeFile(join(PROFILE_DIR, 'cordis.patch.yml'), await readFile(join(PROFILE_SOURCE_DIR, 'cordis.patch.yml')))
  const profileSettingsSource = join(PROFILE_SOURCE_DIR, 'settings.yaml')
  const profileSettingsTarget = join(PROFILE_DIR, 'settings.yaml')
  if (!existsSync(profileSettingsTarget) && existsSync(profileSettingsSource)) {
    await writeFile(profileSettingsTarget, await readFile(profileSettingsSource), { flag: 'wx' })
  }
  const settingsTarget = join(DSH_HOME, 'settings.yaml')
  const settingsSource = join(PROFILE_SOURCE_DIR, 'settings.yaml')
  if (!existsSync(settingsTarget) && existsSync(settingsSource)) {
    await writeFile(settingsTarget, await readFile(settingsSource), { flag: 'wx' })
  }

  await ensureSymlink(join(PROFILE_NODE_MODULES, '@scitiger-ai', 'lwb-dsh-bundle'), BUNDLE_DIR)
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@deepseek-ai', 'schemastery'), join(DSH_DIR, 'vendor', 'schemastery'))
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@deepseek-ai', 'dsh-settings'), join(DSH_DIR, 'packages', 'settings', 'settings'))
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@deepseek-ai', 'dsh-llm'), LLM_DIR)
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@deepseek-ai', 'cordis'), CORDIS_DIR)
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@deepseek-ai', 'dsh-typert-protocol'), TYPERT_PROTOCOL_DIR)
  await ensureSymlink(join(BUNDLE_NODE_MODULES, '@scitiger-ai', 'lwb-pack-sdk'), PACK_SDK_DIR)
}

await syncProfile()

const cliArgs = existsSync(BUILT_CLI_ENTRY)
  ? [BUILT_CLI_ENTRY, '--profile', LWB_RUNTIME.profileId, ...process.argv.slice(2)]
  : ['--import', TSX_LOADER, SOURCE_CLI_ENTRY, '--profile', LWB_RUNTIME.profileId, ...process.argv.slice(2)]
const child = spawn(process.execPath, cliArgs, {
  cwd: ROOT_DIR,
  env: { ...process.env, DSH_HOME },
  stdio: 'inherit',
})

const forwardSignal = (signal) => child.kill(signal)
process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
