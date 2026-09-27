import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_ROOT } from '../upstream.mjs'

/** Extend the official builder configuration without modifying its source. */
export async function createLwbPackageConfig(payload) {
  const { createElectronBuilderConfig } = await import(pathToFileURL(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs')))
  const config = createElectronBuilderConfig()
  config.productName = 'Laofu Workbench'
  config.artifactName = 'laofu-workbench-${version}-${os}-${arch}.${ext}'
  config.protocols = [{ name: 'Laofu Workbench', schemes: ['lwb'] }]
  config.extraMetadata = { ...config.extraMetadata, main: 'lwb-bootstrap.mjs' }
  config.files.push({ from: fileURLToPath(new URL('./bootstrap.mjs', import.meta.url)), to: 'lwb-bootstrap.mjs' })
  config.files.push({ from: fileURLToPath(new URL('./entry-policy.mjs', import.meta.url)), to: 'lwb-entry-policy.mjs' })
  config.extraResources.push({ from: payload, to: 'lwb-product' })
  return config
}
