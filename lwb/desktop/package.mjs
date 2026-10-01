/** Package LWB around the unmodified official shell and verified runtime. */
import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { LWB_RUNTIME } from '../dsh-bundle/runtime-config.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'

assertUpstream()
const { values } = parseArgs({ options: { dir: { type: 'boolean' }, check: { type: 'boolean' } } })
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Official Desktop packaging supports macOS and Windows build hosts.')
const execFileAsync = promisify(execFile)
// A capability pack ships only when this repository owns its manifest. A pack
// cloned or copied into lwb/packs/ is a local installation, not product source;
// packaging it would ship unversioned third-party code inside the app. The
// registry is the supported way to install an external or private pack.
const packsDir = join(LWB_RUNTIME.projectRoot, 'lwb', 'packs')
const ownedPacks = new Set(
  (await execFileAsync('git', ['ls-files', 'lwb/packs/*/lwb-pack.json'], { cwd: LWB_RUNTIME.projectRoot }))
    .stdout.split('\n').filter(Boolean).map(line => line.split('/')[2]),
)
for (const entry of await readdir(packsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  if (!ownedPacks.has(entry.name)) {
    throw new Error(`lwb/packs/${entry.name} is not owned by this repository; remove it, or register it as an external pack with "npm run pack:install -- <directory>".`)
  }
}
const appRoot = join(DSH_ROOT, 'apps/desktop')
const { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } = await import(pathToFileURL(join(appRoot, 'scripts/desktop-package-environment.mjs')))
const env = loadDesktopPackageEnvironment(process.platform)
// Never distribute an LWB app which an official DSH update can replace.
if (!env.DSH_DESKTOP_APP_ID || env.DSH_DESKTOP_APP_ID.startsWith('com.deepseek.')) throw new Error('Configure an LWB-owned DSH_DESKTOP_APP_ID in the official local packaging environment.')
if (env.DSH_DESKTOP_AUTO_UPDATE_ENV !== 'test' || !env.DOWNLOAD_TEST_ORIGIN) throw new Error('LWB packaging requires its own test update origin; official production feeds are not allowed.')
for (const key of ['DOWNLOAD_TEST_ORIGIN', 'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN']) {
  if (env[key] && /(^|\.)deepseek\.com$/u.test(new URL(env[key]).hostname)) throw new Error(`LWB requires a product-owned ${key}`)
}
const arch = process.platform === 'win32' ? 'x64' : process.arch
Object.assign(env, { DSH_DESKTOP_TARGET_PLATFORM: process.platform, DSH_DESKTOP_TARGET_ARCH: arch })
validateDesktopPackageEnvironment(env, { platform: process.platform, arch })
if (values.check) { console.log('LWB packaging environment passed.'); process.exit(0) }
const run = (command, args, cwd, environment = env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging step failed (${code})`)))
})
const pnpm = async (args) => { const invocation = desktopPnpmInvocation(appRoot, args); await run(invocation.command, invocation.args, appRoot) }
// Upstream owns release packing, runtime preparation, dependency and native checks.
await pnpm(['run', 'prepare:package'])
await mkdir(join(LWB_RUNTIME.projectRoot, '.tooling'), { recursive: true })
const stage = await mkdtemp(join(LWB_RUNTIME.projectRoot, '.tooling/lwb-package-'))
const payload = join(stage, 'product')
await mkdir(payload)
const digest = createHash('sha256').update(UPSTREAM.commit)
for (const path of ['dsh-bundle', 'pack-sdk', 'packs', 'profile-setup.mjs']) {
  await cp(join(LWB_RUNTIME.projectRoot, 'lwb', path), join(payload, 'lwb', path), {
    recursive: true,
    filter: async source => {
      const parts = relative(join(LWB_RUNTIME.projectRoot, 'lwb'), source).split(sep)
      if (parts.includes('node_modules') || parts.includes('test') || parts.includes('.git')) return false
      const { stat } = await import('node:fs/promises')
      if ((await stat(source)).isFile()) digest.update(relative(LWB_RUNTIME.projectRoot, source)).update(await readFile(source))
      return true
    },
  })
}
for (const path of ['package.json', 'package-lock.json']) await cp(join(LWB_RUNTIME.projectRoot, path), join(payload, path))
// Install only the product's declared production dependencies; never package
// checkout node_modules, credentials, local state, or upstream source backups.
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], payload)
digest.update(await readFile(join(payload, 'package-lock.json')))
await writeFile(join(payload, 'build.json'), JSON.stringify({ id: digest.digest('hex').slice(0, 24), upstream: UPSTREAM }))
const config = join(stage, 'electron-builder.config.mjs')
await writeFile(config, `export default await (await import(${JSON.stringify(new URL('./package-config.mjs', import.meta.url).href)})).createLwbPackageConfig(${JSON.stringify(payload)})\n`)
await pnpm(['exec', 'electron-builder', '--config', config, '--publish', 'never', ...(values.dir ? ['--dir'] : [])])
assertUpstream()
console.log('LWB Desktop package created through the official builder; no artifacts were published.')
