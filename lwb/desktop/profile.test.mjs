import assert from 'node:assert/strict'
import { test } from 'node:test'
import { desktopProfileManifest, assertDesktopProfileManifest, desktopRuntimeEnvironment } from './profile.mjs'

test('Desktop profile keeps LWB as the platform bundle and leaves scene packs dynamic', () => {
  const manifest = desktopProfileManifest()
  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@scitiger-ai/lwb-dsh-bundle',
  ])
  assert.deepEqual(Object.keys(manifest.dependencies), ['@scitiger-ai/lwb-dsh-bundle'])
  assertDesktopProfileManifest(manifest)
})

test('Desktop profile validation rejects a static scene capability pack', () => {
  assert.throws(() => assertDesktopProfileManifest({
    dependencies: { '@scitiger-ai/lwb-dsh-bundle': 'workspace:*' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@scitiger-ai/lwb-dsh-bundle', '@scitiger-ai/lwb-spoken-video'] } },
  }), /in that order/u)
})

test('Desktop runtime environment separates profile activation from shared product data', () => {
  assert.deepEqual(desktopRuntimeEnvironment({
    dshHome: '/tmp/dsh-home',
    packsDir: '/Applications/Laofu Workbench.app/Contents/Resources/packs',
    dshRuntimeDir: '/Applications/Laofu Workbench.app/Contents/Resources/dsh',
  }), {
    LWB_PROFILE_ID: 'desktop',
    DSH_HOME: '/tmp/dsh-home',
    LWB_DSH_HOME: '/tmp/dsh-home',
    LWB_PRODUCT_HOME: '/tmp/dsh-home/lwb',
    LWB_PACKS_DIR: '/Applications/Laofu Workbench.app/Contents/Resources/packs',
    LWB_DSH_RUNTIME_DIR: '/Applications/Laofu Workbench.app/Contents/Resources/dsh',
  })
})
