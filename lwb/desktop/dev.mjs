/** Launch the official Electron Desktop shell with the LWB composition mounted. */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertDesktopProfileManifest } from './profile.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'

const PRODUCT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DSH_ROOT = join(PRODUCT_ROOT, 'vendor', 'deepseek-harness')
const APP_ROOT = join(DSH_ROOT, 'apps', 'desktop')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')
const PROJECT_DIR = join(DEVELOPMENT_ROOT, 'project')
const LWB_BUNDLE = join(PRODUCT_ROOT, 'lwb', 'dsh-bundle')

function run(command, args, cwd, environment = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`LWB Desktop command failed: ${args.join(' ')} (${String(code ?? signal)})`))
    })
  })
}

function removePath(path) {
  if (!existsSync(path)) return
  const stats = lstatSync(path)
  if (!stats.isSymbolicLink()) throw new Error(`LWB Desktop refuses to replace a non-link: ${path}`)
  unlinkSync(path)
}

function ensureLink(path, target) {
  mkdirSync(dirname(path), { recursive: true })
  removePath(path)
  symlinkSync(resolve(target), path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Add the product bundle to the disposable Desktop profile generated upstream. */
function mountLwbBundle() {
  const manifestPath = join(PROJECT_DIR, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error('LWB Desktop development profile has no bundle list')
  const nextBundles = bundles.filter((name) => name !== '@scitiger-ai/lwb-dsh-bundle')
  nextBundles.push('@scitiger-ai/lwb-dsh-bundle')
  const nextManifest = {
    ...manifest,
    dependencies: { ...manifest.dependencies, '@scitiger-ai/lwb-dsh-bundle': '0.1.0' },
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: nextBundles } },
  }
  assertDesktopProfileManifest(nextManifest)
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)
  ensureLink(join(PROJECT_DIR, 'node_modules', '@scitiger-ai', 'lwb-dsh-bundle'), LWB_BUNDLE)
}

async function prepareProject() {
  const { prepareDevelopmentProject } = await import(pathToFileURL(
    join(APP_ROOT, 'scripts', 'development-project.ts'),
  ))
  const { DESKTOP_HOST_PROTOCOL_VERSION } = await import(pathToFileURL(
    join(APP_ROOT, 'src', 'host-protocol.ts'),
  ))
  const release = {
    schemaVersion: 1,
    version: JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
    pnpmVersion: JSON.parse(readFileSync(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'utf8')).version,
  }
  prepareDevelopmentProject({
    projectDir: PROJECT_DIR,
    cliDir: join(DSH_ROOT, 'apps', 'cli'),
    hostDir: join(DSH_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(DSH_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
  })
  mountLwbBundle()
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build')
  await run(process.execPath, [join(PRODUCT_ROOT, 'lwb', 'desktop', 'patch-upstream.mjs')], PRODUCT_ROOT)
  if (!skipBuild) {
    for (const args of [['run', 'build'], ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'build']]) {
      const invocation = desktopPnpmInvocation(APP_ROOT, args)
      await run(invocation.command, invocation.args, DSH_ROOT)
    }
  }
  await prepareProject()

  const require = createRequire(pathToFileURL(join(APP_ROOT, 'package.json')))
  const electron = require('electron')
  if (typeof electron !== 'string') throw new Error('LWB Desktop could not resolve the Electron executable')
  const home = resolve(process.env.DSH_HOME || join(DEVELOPMENT_ROOT, 'home'))
  const environment = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_DSH_DIR: DSH_ROOT,
    DSH_DESKTOP_NODE_BINARY: process.execPath,
    DSH_DESKTOP_HOST_INSPECT_PORT: process.env.DSH_DESKTOP_HOST_INSPECT_PORT || '9230',
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS || '1',
    DSH_DESKTOP_EXPOSE_PLUGIN_MANAGER: '0',
    DSH_DESKTOP_KEEP_BACKEND_ON_WINDOW_CLOSE: '1',
    LWB_PROFILE_ID: 'desktop',
    LWB_PRODUCT_HOME: process.env.LWB_PRODUCT_HOME || join(home, 'lwb'),
    LWB_PACKS_DIR: process.env.LWB_PACKS_DIR || join(PRODUCT_ROOT, 'lwb', 'packs'),
    LWB_DSH_RUNTIME_DIR: DSH_ROOT,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  await run(electron, [`--user-data-dir=${join(DEVELOPMENT_ROOT, 'electron-user-data')}`, APP_ROOT], APP_ROOT, environment)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
