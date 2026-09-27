/** Product entry point; official files stay intact, with an in-memory entry policy. */
import { app } from 'electron'
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installLwbEntryPolicy } from './lwb-entry-policy.mjs'

const payload = join(process.resourcesPath, 'lwb-product')
const build = JSON.parse(await readFile(join(payload, 'build.json'), 'utf8'))
const productHome = process.env.LWB_PRODUCT_HOME || join(app.getPath('appData'), 'LaofuWorkbench')
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
Object.assign(process.env, {
  LWB_PRODUCT_HOME: productHome,
  LWB_DSH_HOME: join(productHome, 'dsh-home'),
  DSH_HOME: join(productHome, 'dsh-home'),
  LWB_PROFILE_ID: 'desktop',
  LWB_PROFILE_DIR: join(productHome, 'dsh-home', 'profiles', 'desktop'),
  LWB_DSH_RUNTIME_DIR: join(app.getAppPath(), 'dsh'),
  LWB_PACKS_DIR: join(runtime, 'lwb', 'packs'),
  DSH_DESKTOP_USER_DATA_DIR: join(productHome, 'electron-user-data'),
})
app.setName('Laofu Workbench')
app.setPath('userData', join(productHome, 'electron-user-data'))
const { prepareLwbProfile } = await import(pathToFileURL(join(runtime, 'lwb', 'profile-setup.mjs')))
await prepareLwbProfile()
installLwbEntryPolicy(new URL('./lib/main.js', import.meta.url))
await import('./lib/main.js')
