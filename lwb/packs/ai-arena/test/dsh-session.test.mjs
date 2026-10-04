import assert from 'node:assert/strict'
import test from 'node:test'
import { executeSessionTurn, latestTurn, pageEvents, readLatest } from '../dsh-session.mjs'

const replyEvent = (seq, text = '{"action":{"row":8,"col":8},"speech":"落子"}') => ({
  seq,
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})

test('pageEvents accepts DSH history records and nested page wrappers', () => {
  const event = replyEvent(7)
  assert.deepEqual(pageEvents({ value: { records: [{ type: 'event', event }] } }), [event])
  assert.deepEqual(pageEvents({ page: { records: [{ record: { event } }] } }), [event])
})

test('readLatest retries until the completed assistant event is queryable', async () => {
  const events = [
    { seq: 8, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    replyEvent(7),
  ]
  let reads = 0
  const session = {
    page: async () => ({ records: reads++ < 2 ? [] : events.map(event => ({ type: 'event', event })) }),
  }
  const result = await readLatest(session, 0, { attempts: 4, retryDelayMs: 1 })
  assert.equal(reads, 3)
  assert.equal(result.text, '{"action":{"row":8,"col":8},"speech":"落子"}')
  assert.equal(result.sessionSeq, 8)
})

test('readLatest uses the DSH follow snapshot cursor for page reads', async () => {
  const events = [
    { seq: 8, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    replyEvent(7),
  ]
  let throughSeq
  const session = {
    follow: async function* () {
      yield { type: 'snapshot', cursor: 8, records: [] }
    },
    page: async request => {
      throughSeq = request.throughSeq
      return { records: events.map(event => ({ type: 'event', event })) }
    },
  }
  const result = await readLatest(session, 0, { attempts: 1 })
  assert.equal(throughSeq, 8)
  assert.equal(result.sessionSeq, 8)
})

test('executeSessionTurn establishes its boundary from the follow snapshot', async () => {
  const oldEvents = [replyEvent(7, 'old'), { seq: 8, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const currentEvents = [replyEvent(10, 'current'), { seq: 11, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  let pageCalls = []
  let follows = 0
  const session = {
    follow: async function* (_, signal) {
      follows += 1
      yield { type: 'snapshot', cursor: follows === 1 ? 8 : 11, records: (follows === 1 ? oldEvents : currentEvents).map(event => ({ type: 'event', event })) }
      if (follows === 1) return
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    },
    followup: async () => {},
    whenIdle: async () => {},
    page: async request => {
      pageCalls.push(request)
      return { records: currentEvents.map(event => ({ type: 'event', event })) }
    },
  }
  const result = await executeSessionTurn(session, '落子', { attempts: 1 })
  assert.equal(pageCalls.at(-1).throughSeq, 11)
  assert.equal(result.text, 'current')
})

test('latestTurn ignores events at or before the session boundary', () => {
  const old = replyEvent(4, 'old')
  const current = replyEvent(6, 'current')
  const result = latestTurn([old, current, { seq: 7, type: 'turn/end', data: { reason: { kind: 'completed' } } }], 5)
  assert.equal(result.text, 'current')
  assert.equal(result.sessionSeq, 7)
})


test('history sorting and merging preserves streamed usage when the page only has turn/end', async () => {
  const assistant = { ...replyEvent(7), data: { ...replyEvent(7).data, usage: { totalTokens: 23 } } }
  const end = { seq: 8, type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }
  const result = await readLatest({ page: async () => ({ records: [end] }) }, 0, { attempts: 1, fallbackEvents: [assistant] })
  assert.equal(result.usage.totalTokens, 23)
  assert.equal(result.finish.kind, 'length')
  assert.equal(latestTurn([replyEvent(10, 'new'), replyEvent(7, 'old')]).text, 'new')
})

test('failed submission closes its observer and does not consume old responses', async () => {
  let observersClosed = 0
  const session = {
    follow: async function* (_, signal) {
      try {
        yield { cursor: 8, records: [replyEvent(7, 'old')] }
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      } finally { observersClosed += 1 }
    },
    page: async () => ({ records: [replyEvent(7, 'old')] }),
    followup: async () => { throw new Error('submission rejected') },
  }
  await assert.rejects(executeSessionTurn(session, 'prompt'), error => error.message === 'submission rejected' && !error.result)
  assert.equal(observersClosed, 3)
})


test('assistant persistence before turn/end does not turn a truncated reply into a successful move', async () => {
  let reads = 0
  const session = { page: async () => ({ records: ++reads === 1 ? [replyEvent(7)] : [replyEvent(7), { seq: 8, type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }] }) }
  const result = await readLatest(session, 0, { attempts: 2, retryDelayMs: 1 })
  assert.equal(reads, 2)
  assert.equal(result.finish.kind, 'length')
})
