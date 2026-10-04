import assert from 'node:assert/strict'
import test from 'node:test'
import { activeMatchCount } from '../confirmation.mjs'

test('ongoing match count excludes paused, completed and cancelled history', () => {
  const matches = ['running', 'running', 'pausing', 'paused', 'finished', 'cancelled'].map(status => ({ status }))
  assert.equal(activeMatchCount(matches), 3)
  matches[0].status = 'paused'
  matches[1].status = 'finished'
  matches[2].status = 'cancelled'
  assert.equal(activeMatchCount(matches), 0)
  assert.equal(activeMatchCount([]), 0)
})
