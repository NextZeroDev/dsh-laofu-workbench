/** Reuse official release packing and runtime smoke checks without release signing. */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPnpmInvocation } from './toolchain.mjs'

if (process.env.LWB_DESKTOP_UNSIGNED !== '1') throw new Error('Unsigned preparation requires the explicit LWB test-build mode')
const root = process.env.LWB_DESKTOP_UNSIGNED_DSH_ROOT
// pnpm exec preserves npm's parent entry; upstream expects its own pnpm entry.
process.env.npm_execpath = desktopPnpmInvocation(join(root, 'apps/desktop'), []).args[0]
const { packageTarget } = await import(pathToFileURL(join(root, 'apps/desktop/scripts/package-target.ts')))
const platform = process.env.DSH_DESKTOP_TARGET_PLATFORM
const arch = process.env.DSH_DESKTOP_TARGET_ARCH
const target = { name: `${platform === 'darwin' ? 'mac' : 'win'}-${arch}`, platform, arch }
await packageTarget({ target, unsigned: true, prepareOnly: true, directory: false }, process.env, undefined)
