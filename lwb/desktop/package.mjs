/** Package the product through the official DSH Desktop release pipeline. */

import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DSH = join(ROOT, 'vendor', 'deepseek-harness')
const PNPM = join(DSH, 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')

function run(command, args, cwd, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`LWB Desktop package failed: ${args.join(' ')} (${String(code ?? signal)})`))
    })
  })
}

const environment = {
  ...process.env,
  DSH_DESKTOP_EXTRA_PROFILE_BUNDLES: JSON.stringify(['@scitiger-ai/lwb-dsh-bundle']),
  DSH_DESKTOP_EXTRA_PROFILE_DEPENDENCIES: JSON.stringify({
    '@scitiger-ai/lwb-dsh-bundle': '0.1.0',
    '@scitiger-ai/lwb-pack-sdk': '0.1.0',
  }),
  LWB_DESKTOP_BUNDLE_DIR: join(ROOT, 'lwb', 'dsh-bundle'),
  LWB_DESKTOP_PACK_SDK_DIR: join(ROOT, 'lwb', 'pack-sdk'),
}

await run(process.execPath, [join(ROOT, 'lwb', 'desktop', 'patch-upstream.mjs')], ROOT, environment)
const forwarded = process.argv.slice(2)
await run(PNPM, [
  '--filter', '@deepseek-ai/dsh-desktop', 'run', 'package',
  ...(forwarded.length === 0 ? [] : ['--', ...forwarded]),
], DSH, environment)
