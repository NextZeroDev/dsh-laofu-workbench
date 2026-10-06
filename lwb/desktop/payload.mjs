/**
 * Copy the product source a Desktop build ships into a payload directory.
 *
 * Capability packs come from the resolved edition one at a time, so a directory
 * that is merely present under `lwb/packs/` can never reach a product build.
 * Dependencies, pack test trees and repository metadata are excluded everywhere.
 * A pack checkout's build bookkeeping (`.build`), preview output (`.preview`)
 * and CI workflows (`.github`) are excluded too: the release runner archives
 * tracked pack sources without them, so a local build that shipped them would
 * produce a different payload, and a different build id, for the same revision.
 * `onFile` receives a location-independent key for every file that ships, which
 * keeps a build id reproducible when a private pack is checked out elsewhere.
 */
import { cp, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Product directories that always ship, with the pack set beside them. */
export const PRODUCT_PATHS = ['dsh-bundle', 'pack-sdk', 'profile-setup.mjs']
const EXCLUDED = new Set(['node_modules', 'test', '.git', '.build', '.preview', '.github'])

/**
 * @param {object} options
 * @param {string} options.projectRoot Repository root that owns `lwb/`.
 * @param {{ packs: ReadonlyArray<{ id: string, source: string }> }} options.edition Resolved edition.
 * @param {string} options.payload Destination directory for the product source.
 * @param {(key: string, source: string) => Promise<void> | void} [options.onFile] Called once per shipped file.
 */
export async function assembleProductPayload({ projectRoot, edition, payload, onFile = () => {} }) {
  const excluded = (root, source) => relative(root, source).split(sep).some(part => EXCLUDED.has(part))
  const copy = async (root, destination, keyOf) => {
    await cp(root, destination, {
      recursive: true,
      filter: async (source) => {
        if (excluded(root, source)) return false
        if ((await stat(source)).isFile()) await onFile(keyOf(source), source)
        return true
      },
    })
  }
  const lwb = join(projectRoot, 'lwb')
  for (const path of PRODUCT_PATHS) {
    await copy(join(lwb, path), join(payload, 'lwb', path), source => relative(projectRoot, source))
  }
  for (const pack of edition.packs) {
    await copy(pack.source, join(payload, 'lwb', 'packs', pack.id), source => join('packs', pack.id, relative(pack.source, source)))
  }
}