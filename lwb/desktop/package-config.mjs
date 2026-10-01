import { join } from 'node:path'
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
  const config = createElectronBuilderConfig()
  config.productName = identity.productName
  config.artifactName = identity.artifactName
  config.protocols = [{ name: identity.productName, schemes: [identity.protocolScheme] }]
  config.extraMetadata = { ...config.extraMetadata, main: 'lwb-bootstrap.mjs' }
  config.files.push({ from: fileURLToPath(new URL('./bootstrap.mjs', import.meta.url)), to: 'lwb-bootstrap.mjs' })
  config.files.push({ from: fileURLToPath(new URL('./entry-policy.mjs', import.meta.url)), to: 'lwb-entry-policy.mjs' })
  config.extraResources.push({ from: payload, to: 'lwb-product' })
  return config
}
