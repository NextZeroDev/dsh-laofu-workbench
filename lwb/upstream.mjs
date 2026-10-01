import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LWB_RUNTIME } from './dsh-bundle/runtime-config.mjs'

export const UPSTREAM = Object.freeze(JSON.parse(readFileSync(new URL('./UPSTREAM.lock.json', import.meta.url), 'utf8')))
export const DSH_ROOT = LWB_RUNTIME.dshRuntimeDir

/** Reject mixed releases and source patches before starting or changing product state. */
export function assertUpstream(root = DSH_ROOT, lock = UPSTREAM) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const head = git('rev-parse', 'HEAD')
  if (head !== lock.commit) throw new Error(`DSH checkout ${head} does not match ${lock.tag} (${lock.commit}). Run npm run setup.`)
  const dirty = git('status', '--porcelain', '--untracked-files=normal')
  if (dirty) throw new Error(`Official DSH source must be unmodified. Preserve local changes before setup:\n${dirty}`)
  const version = lock.tag.replace(/^dsh-v/u, '')
  for (const path of ['package.json', 'apps/desktop/package.json', 'apps/cli/package.json', 'apps/desktop-host/package.json']) {
    if (JSON.parse(readFileSync(join(root, path), 'utf8')).version !== version) {
      throw new Error(`DSH release mismatch: ${path}; expected ${version}`)
    }
  }
  for (const path of ['dsh-bundle', 'pack-sdk', 'packs/spoken-video']) {
    const manifest = JSON.parse(readFileSync(new URL(`./${path}/package.json`, import.meta.url), 'utf8'))
    for (const [name, required] of Object.entries(manifest.peerDependencies ?? {})) {
      if (name.startsWith('@deepseek-ai/dsh-') && required !== version) throw new Error(`LWB adapter ${path} requires ${name}@${required}, lock requires ${version}`)
    }
  }
  return { commit: head, version }
}
