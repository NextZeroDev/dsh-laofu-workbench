import test from 'node:test'
import assert from 'node:assert/strict'
import { turnRecords, turnUsage } from '../turn-records.mjs'

test('usage includes cached input once and does not add reasoning to output', () => {
  assert.deepEqual(turnUsage({ inputTokens: 932, cacheReadTokens: 2048, outputTokens: 12418, reasoningTokens: 12000, totalTokens: 15398 }), { input: 2980, cacheRead: 2048, output: 12418, total: 15398 })
  assert.deepEqual(turnUsage({ inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 15 }), { input: 35, cacheRead: 20, output: 15, total: 50 })
  assert.deepEqual(turnUsage({ totalTokens: 100 }), { input: null, cacheRead: 0, output: null, total: 100 })
  assert.equal(turnUsage(null), null)
})

test('legacy, failed and live decisions retain the correct Session and move number', () => {
  const match = { events: [
    { type: 'request', turnId: 'a', player: 0 },
    { type: 'response', turnId: 'a', sessionId: 'old', usage: { totalTokens: 10 } },
    { type: 'move', turnId: 'a', moveNumber: 1 },
    { type: 'request', turnId: 'b', player: 1, sessionId: 'failed' },
    { type: 'error', turnId: 'b', error: 'timeout', response: { usage: { totalTokens: 20 } } },
    { type: 'request', turnId: 'c', player: 1, sessionId: 'live', moveNumber: 2 },
  ] }
  const turns = turnRecords(match)
  assert.deepEqual(turns.map(turn => [turn.moveNumber, turn.sessionId]), [[1, 'old'], [2, 'failed'], [2, 'live']])
  assert.equal(turns[1].response.usage.totalTokens, 20)
  assert.equal(turns[1].error, 'timeout')
  assert.equal(turns[2].response, undefined)
})
