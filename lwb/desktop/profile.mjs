import { resolve } from 'node:path'

/**
 * Environment passed to the Desktop Host process. Product data is shared by
 * Web and Desktop through an explicit user-data root; package activation stays
 * in the Desktop-owned `desktop` profile.
 */
export function desktopRuntimeEnvironment({ dshHome, productHome, packsDir, dshRuntimeDir, registryPath, packStateDir, profileDir, packRuntimeDir } = {}) {
  const environment = {
    LWB_PROFILE_ID: 'desktop',
    ...(dshHome === undefined ? {} : { DSH_HOME: resolve(dshHome), LWB_DSH_HOME: resolve(dshHome) }),
    ...(productHome === undefined ? {} : { LWB_PRODUCT_HOME: resolve(productHome) }),
    ...(packsDir === undefined ? {} : { LWB_PACKS_DIR: resolve(packsDir) }),
    ...(dshRuntimeDir === undefined ? {} : { LWB_DSH_RUNTIME_DIR: resolve(dshRuntimeDir) }),
    ...(registryPath === undefined ? {} : { LWB_PACK_REGISTRY: resolve(registryPath) }),
    ...(packStateDir === undefined ? {} : { LWB_PACK_STATE_DIR: resolve(packStateDir) }),
    ...(profileDir === undefined ? {} : { LWB_PROFILE_DIR: resolve(profileDir) }),
    ...(packRuntimeDir === undefined ? {} : { LWB_PACK_RUNTIME_DIR: resolve(packRuntimeDir) }),
  }
  return Object.freeze(environment)
}

/** The checkout Desktop reuses the Web data, with a disposable activation profile. */
export function desktopDevelopmentEnvironment(runtime, projectDir) {
  return desktopRuntimeEnvironment({
    dshHome: runtime.dshHome,
    productHome: runtime.productHome,
    registryPath: runtime.registryPath,
    packStateDir: runtime.packStateDir,
    profileDir: projectDir,
    packsDir: runtime.sourcePacksDir,
    // Checkout sources retain workspace dependencies (including Remotion).
    packRuntimeDir: runtime.packRuntimeDir || runtime.sourcePacksDir,
    dshRuntimeDir: runtime.dshRuntimeDir,
  })
}
