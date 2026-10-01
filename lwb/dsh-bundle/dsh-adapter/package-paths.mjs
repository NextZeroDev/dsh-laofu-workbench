import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { LWB_RUNTIME } from '../runtime-config.mjs'

/** Dependency lookup for an installed runtime or an official pnpm checkout. */
export function dshPackageDirectory(name, runtime = LWB_RUNTIME.dshRuntimeDir) {
  for (const modules of [join(runtime, 'node_modules'), join(runtime, 'node_modules', '.pnpm', 'node_modules')]) {
    const directory = join(modules, ...name.split('/'))
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return realpathSync(directory)
  }
  throw new Error(`DSH dependency ${name} is unavailable in ${runtime}; run npm run setup.`)
}
