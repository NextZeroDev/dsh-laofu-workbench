import { join, resolve } from 'node:path'

export const DESKTOP_BASE_BUNDLES = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
])

export const LWB_PLATFORM_BUNDLE = '@scitiger-ai/lwb-dsh-bundle'

/**
 * Build the profile metadata consumed by the official DSH Desktop Host.
 * Scene capability packs deliberately do not appear here: they remain owned
 * by LWB's in-process registry and loader.
 */
export function desktopProfileManifest({ platformBundle = LWB_PLATFORM_BUNDLE } = {}) {
  if (typeof platformBundle !== 'string' || platformBundle.trim() === '') {
    throw new Error('LWB Desktop platform bundle must be a package name.')
  }
  return Object.freeze({
    name: 'lwb-desktop-profile',
    private: true,
    version: '0.0.0',
    dependencies: { [platformBundle]: 'workspace:*' },
    dsh: { profile: { bundles: [...DESKTOP_BASE_BUNDLES, platformBundle] } },
  })
}

/** Validate the fixed bundle boundary before a Desktop project is started. */
export function assertDesktopProfileManifest(value, platformBundle = LWB_PLATFORM_BUNDLE) {
  const bundles = value?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length !== DESKTOP_BASE_BUNDLES.length + 1
    || bundles[0] !== DESKTOP_BASE_BUNDLES[0]
    || bundles[1] !== DESKTOP_BASE_BUNDLES[1]
    || bundles[2] !== platformBundle) {
    throw new Error('LWB Desktop profile must load DSH Base, DSH Web App and LWB Bundle in that order.')
  }
  if (value?.dependencies?.[platformBundle] === undefined) {
    throw new Error(`LWB Desktop profile must declare ${platformBundle} as a dependency.`)
  }
  return true
}

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
  if (environment.LWB_PRODUCT_HOME === undefined && environment.DSH_HOME !== undefined) {
    environment.LWB_PRODUCT_HOME = join(environment.DSH_HOME, 'lwb')
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
    dshRuntimeDir: join(runtime.projectRoot, 'vendor', 'deepseek-harness'),
  })
}
