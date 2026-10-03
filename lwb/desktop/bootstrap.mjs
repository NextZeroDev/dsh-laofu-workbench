/** Product entry point; official files stay intact, with an in-memory entry policy. */
import { app } from 'electron'
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installLwbEntryPolicy } from './lwb-entry-policy.mjs'
import { migrateRuntimePackRegistry } from './registry-migration.mjs'

const payload = join(process.resourcesPath, 'lwb-product')
const build = JSON.parse(await readFile(join(payload, 'build.json'), 'utf8'))
const configuredProductHome = process.env.LWB_PRODUCT_HOME
const defaultProductHome = join(app.getPath('appData'), build.productHome || 'LaofuWorkbench')
if (!configuredProductHome && defaultProductHome.endsWith('LaofuWorkbench')) {
  const legacyProductHome = join(app.getPath('appData'), 'LaofuWorkbenchCommercial')
  if (!await stat(defaultProductHome).catch(error => { if (error.code !== 'ENOENT') throw error })
    && await stat(legacyProductHome).catch(error => { if (error.code !== 'ENOENT') throw error })) {
    await rename(legacyProductHome, defaultProductHome)
  }
}
const productHome = configuredProductHome || defaultProductHome
const runtime = join(productHome, 'runtime', build.id)
// The writable copy owns peer links and dynamic pack code. Business data is
// outside it; replacing a product build never rewrites a pack workspace.
if (!await stat(join(runtime, 'build.json')).catch(error => { if (error.code !== 'ENOENT') throw error })) {
  const temporary = `${runtime}.${process.pid}.tmp`
  await mkdir(join(productHome, 'runtime'), { recursive: true })
  try {
    await cp(payload, temporary, { recursive: true })
    await rename(temporary, runtime)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
await migrateRuntimePackRegistry(join(productHome, 'packs.json'), { productHome, currentRuntime: runtime })
Object.assign(process.env, {
  LWB_PRODUCT_HOME: productHome,
  LWB_DSH_HOME: join(productHome, 'dsh-home'),
  DSH_HOME: join(productHome, 'dsh-home'),
  LWB_PROFILE_ID: 'desktop',
  LWB_PROFILE_DIR: join(productHome, 'dsh-home', 'profiles', 'desktop'),
  LWB_DSH_RUNTIME_DIR: join(app.getAppPath(), 'dsh'),
  LWB_PACKS_DIR: join(runtime, 'lwb', 'packs'),
  LWB_PACK_RUNTIME_DIR: join(runtime, 'lwb', 'packs'),
  DSH_DESKTOP_USER_DATA_DIR: join(productHome, 'electron-user-data'),
})
app.setName(build.productName || 'Laofu Workbench')
app.setPath('userData', join(productHome, 'electron-user-data'))
const { prepareLwbProfile } = await import(pathToFileURL(join(runtime, 'lwb', 'profile-setup.mjs')))
await prepareLwbProfile()
installLwbEntryPolicy(new URL('./lib/main.js', import.meta.url))
await import('./lib/main.js')
