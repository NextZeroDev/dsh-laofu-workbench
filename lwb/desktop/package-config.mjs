import { join } from 'node:path'
import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_ROOT } from '../upstream.mjs'

/**
 * Extend the official builder configuration without modifying its source.
 *
 * The identity is the resolved edition, so each edition produces its own
 * product name, artifact name and URL scheme instead of overwriting the other.
 */
export async function createLwbPackageConfig(payload, identity) {
  if (!identity?.productName || !identity?.artifactName || !identity?.protocolScheme) {
    throw new Error('createLwbPackageConfig needs a resolved edition identity.')
  }
  const { createElectronBuilderConfig } = await import(pathToFileURL(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs')))
  if (identity.unsigned && process.env.LWB_DESKTOP_UNSIGNED !== '1') throw new Error('Unsigned package config requires the test-build loader')
  const config = createElectronBuilderConfig()
  if (identity.unsigned) {
    config.directories.output = identity.output
    config.extraMetadata.version = identity.version
  }
  config.productName = identity.productName
  config.artifactName = identity.artifactName
  config.protocols = [{ name: identity.productName, schemes: [identity.protocolScheme] }]
  if (identity.portable) applyLwbPortableTargets(config)
  config.extraMetadata = { ...config.extraMetadata, main: 'lwb-bootstrap.mjs' }
  const entry = join(payload, '..', 'desktop-entry')
  await mkdir(entry, { recursive: true })
  await cp(fileURLToPath(new URL('./bootstrap.mjs', import.meta.url)), join(entry, 'lwb-bootstrap.mjs'))
  await cp(fileURLToPath(new URL('./entry-policy.mjs', import.meta.url)), join(entry, 'lwb-entry-policy.mjs'))
  config.files.push({ from: entry, to: '.', filter: ['lwb-bootstrap.mjs', 'lwb-entry-policy.mjs'] })
  config.extraResources.push({ from: payload, to: 'lwb-product' })
  return config
}

export function applyLwbPortableTargets(config) {
  config.mac = { ...config.mac, target: ['zip'] }
  config.win = { ...config.win, target: ['portable'] }
  return config
}
