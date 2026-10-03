import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyLwbPortableTargets, applyLwbProductResources } from './package-config.mjs'
import { join } from 'node:path'

test('product resources explicitly include installed production dependencies', () => {
  const config = applyLwbProductResources({ extraResources: [] }, '/product')
  assert.ok(config.extraResources.some(resource => resource.from === join('/product', 'node_modules') && resource.to === 'lwb-product/node_modules' && resource.filter.includes('**/*')))
})

test('the packaged Desktop entry includes runtime registry migration', async () => {
  const source = await readFile(new URL('./package-config.mjs', import.meta.url), 'utf8')
  assert.match(source, /registry-migration\.mjs/u)
})

test('portable targets emit a macOS app zip and a Windows portable executable', () => {
  const config = applyLwbPortableTargets({
    mac: { target: ['dmg', 'zip'], hardenedRuntime: true },
    win: { target: ['nsis'], forceCodeSigning: false },
  })
  assert.deepEqual(config.mac, { target: ['zip'], hardenedRuntime: true })
  assert.deepEqual(config.win, { target: ['portable'], forceCodeSigning: false })
})
