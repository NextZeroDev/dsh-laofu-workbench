import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLwbPortableTargets } from './package-config.mjs'

test('portable targets emit a macOS app zip and a Windows portable executable', () => {
  const config = applyLwbPortableTargets({
    mac: { target: ['dmg', 'zip'], hardenedRuntime: true },
    win: { target: ['nsis'], forceCodeSigning: false },
  })
  assert.deepEqual(config.mac, { target: ['zip'], hardenedRuntime: true })
  assert.deepEqual(config.win, { target: ['portable'], forceCodeSigning: false })
})
