import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { LWB_RUNTIME } from './dsh-bundle/runtime-config.mjs'
import { assertUpstream, DSH_ROOT } from './upstream.mjs'
import { prepareLwbProfile } from './profile-setup.mjs'
import { prepareEmbeddedSidebarBundle } from './dsh-bundle/embedded-sidebar-build.mjs'

await prepareEmbeddedSidebarBundle()
assertUpstream()
await prepareLwbProfile()
const ROOT_DIR = LWB_RUNTIME.projectRoot
const cliArgs = [join(DSH_ROOT, 'apps', 'cli', 'lib', 'bin.js'), '--profile', LWB_RUNTIME.profileId, ...process.argv.slice(2)]
const child = spawn(process.execPath, cliArgs, {
  cwd: ROOT_DIR,
  env: { ...process.env, DSH_HOME: LWB_RUNTIME.dshHome, LWB_DSH_HOME: LWB_RUNTIME.dshHome },
  stdio: 'inherit',
})

const forwardSignal = (signal) => child.kill(signal)
process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
