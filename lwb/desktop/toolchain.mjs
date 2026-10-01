import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Use the pnpm dependency owned by Desktop, including on Windows without a shell. */
export function desktopPnpmInvocation(appRoot, args) {
  const require = createRequire(join(appRoot, 'package.json'))
  let entry
  try {
    entry = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
  } catch (cause) {
    throw new Error('LWB Desktop requires the upstream Desktop dependencies; run npm run setup first.', { cause })
  }
  if (!existsSync(entry)) throw new Error(`LWB Desktop pnpm entry is missing: ${entry}`)
  return { command: process.execPath, args: [entry, ...args] }
}
