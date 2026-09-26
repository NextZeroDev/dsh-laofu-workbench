/** Launch the unmodified official Desktop with an ordinary LWB profile. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { LWB_RUNTIME } from '../dsh-bundle/runtime-config.mjs'
import { assertUpstream, DSH_ROOT } from '../upstream.mjs'
import { prepareLwbProfile } from '../profile-setup.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'
import { desktopDevelopmentEnvironment } from './profile.mjs'

assertUpstream()
const appRoot = join(DSH_ROOT, 'apps', 'desktop')
const profile = join(LWB_RUNTIME.dshHome, 'profiles', 'desktop')
await prepareLwbProfile(profile)
const environment = {
  ...process.env,
  ...desktopDevelopmentEnvironment(LWB_RUNTIME, profile),
  DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS || '0',
  DSH_DESKTOP_USER_DATA_DIR: join(LWB_RUNTIME.productHome, 'electron-user-data'),
}
// The official launcher prepares its runtime project and bundled interpreters.
// DSH_DESKTOP_DSH_DIR is its runtime project, not the repository root.
delete environment.DSH_DESKTOP_DSH_DIR
delete environment.ELECTRON_RUN_AS_NODE
const invocation = desktopPnpmInvocation(appRoot, ['run', process.argv.includes('--skip-build') ? 'start' : 'dev'])
const child = spawn(invocation.command, invocation.args, { cwd: appRoot, env: environment, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('exit', (code) => { process.exitCode = code ?? 1 })
