import assert from 'node:assert/strict'
import { test } from 'node:test'
import { desktopRuntimeEnvironment } from './profile.mjs'

test('Desktop runtime environment separates profile activation from shared product data', () => {
  assert.deepEqual(desktopRuntimeEnvironment({
    dshHome: '/tmp/dsh-home',
    packsDir: '/Applications/Laofu Workbench.app/Contents/Resources/packs',
    dshRuntimeDir: '/Applications/Laofu Workbench.app/Contents/Resources/dsh',
  }), {
    LWB_PROFILE_ID: 'desktop',
    DSH_HOME: '/tmp/dsh-home',
    LWB_DSH_HOME: '/tmp/dsh-home',
    LWB_PACKS_DIR: '/Applications/Laofu Workbench.app/Contents/Resources/packs',
    LWB_DSH_RUNTIME_DIR: '/Applications/Laofu Workbench.app/Contents/Resources/dsh',
  })
})
