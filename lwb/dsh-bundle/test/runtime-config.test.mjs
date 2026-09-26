import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join, resolve } from 'node:path'

const modulePath = resolve('lwb/dsh-bundle/runtime-config.mjs')

function readRuntime(environment = {}) {
  const env = { ...process.env }
  for (const name of ['DSH_HOME', 'ELECTRON_RUN_AS_NODE', 'LWB_DSH_HOME', 'LWB_PACK_REGISTRY', 'LWB_PRODUCT_HOME', 'LWB_PROFILE_ID', 'LWB_PACKS_DIR', 'LWB_PACK_RUNTIME_DIR']) delete env[name]
  Object.assign(env, environment)
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { LWB_RUNTIME } from ${JSON.stringify(modulePath)}
    process.stdout.write(JSON.stringify(LWB_RUNTIME))
  `], { env, encoding: 'utf8' }))
}

test('runtime config preserves the Web defaults', () => {
  const runtime = readRuntime()
  assert.equal(runtime.profileId, 'lwb')
  assert.equal(runtime.productHome, resolve('lwb/local'))
  assert.equal(runtime.registryPath, resolve('lwb/local/packs.json'))
  assert.equal(runtime.sourcePacksDir, resolve('lwb/packs'))
})

test('runtime config selects the Desktop profile and user product home', () => {
  const dshHome = '/tmp/lwb-desktop-runtime-config'
  const runtime = readRuntime({ DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(runtime.profileId, 'desktop')
  assert.equal(runtime.profileHome, join(dshHome, 'profiles', 'desktop'))
  assert.equal(runtime.productHome, join(dshHome, 'lwb'))
  assert.equal(runtime.registryPath, join(dshHome, 'lwb', 'packs.json'))
  assert.equal(runtime.packRuntimeDir, join(dshHome, 'lwb', 'pack-runtime'))
})

test('explicit product paths take precedence over transport defaults', () => {
  const runtime = readRuntime({
    DSH_HOME: '/tmp/lwb-desktop-runtime-config',
    ELECTRON_RUN_AS_NODE: '1',
    LWB_PROFILE_ID: 'preview',
    LWB_PRODUCT_HOME: '/tmp/lwb-shared-product',
    LWB_PACK_REGISTRY: '/tmp/lwb-shared-product/registry.json',
    LWB_PACKS_DIR: '/tmp/lwb-pack-sources',
    LWB_PACK_RUNTIME_DIR: '/tmp/lwb-runtime-copies',
  })
  assert.equal(runtime.profileId, 'preview')
  assert.equal(runtime.profileHome, '/tmp/lwb-desktop-runtime-config/profiles/preview')
  assert.equal(runtime.productHome, '/tmp/lwb-shared-product')
  assert.equal(runtime.registryPath, '/tmp/lwb-shared-product/registry.json')
  assert.equal(runtime.sourcePacksDir, '/tmp/lwb-pack-sources')
  assert.equal(runtime.packRuntimeDir, '/tmp/lwb-runtime-copies')
})
