import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { adaptUnsignedBuilder, adaptUnsignedPreparation } from './unsigned-policy.mjs'

const root = process.env.LWB_DESKTOP_UNSIGNED_DSH_ROOT
const enabled = process.env.LWB_DESKTOP_UNSIGNED === '1' && root
const builder = enabled && pathToFileURL(join(root, 'apps/desktop/scripts/electron-builder-config.mjs')).href
const preparation = enabled && pathToFileURL(join(root, 'apps/desktop/scripts/prepare-dsh.ts')).href

export function load(url, context, nextLoad) {
  const loaded = nextLoad(url, context)
  const clean = new URL(url)
  clean.search = ''
  if (!enabled || (clean.href !== builder && clean.href !== preparation)) return loaded
  const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
  return { ...loaded, source: clean.href === builder ? adaptUnsignedBuilder(source) : adaptUnsignedPreparation(source) }
}
