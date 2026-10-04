import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArenaStore } from '../store.mjs'
import { ArenaHost, parseDecision, tokenCount } from '../host.mjs'
import { ArenaGames } from '../games.mjs'
import { decisionPrompt } from '../decision-prompt.mjs'

const reply = (row, col, speech = '我先占住这个位置。') => ({ text: JSON.stringify({ action: { row, col }, speech }), reasoning: '', usage: { inputTokens: 10, outputTokens: 10 }, finish: { kind: 'stop' }, config: {} })
async function setup(t, complete, models = [{ id: 'black', name: 'Black' }, { id: 'white', name: 'White' }], hostOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arena-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init(), signal = new AbortController(), jobs = [], stops = [], sessions = new Map(), sessionEvents = []
  let sequence = 0
  const makeSession = options => {
    const events = []
    const sessionOptions = { ...options }
    let pending = null, activeController = null, progressWaiters = []
    const emitProgress = update => {
      session.progress = update
      const waiters = progressWaiters.splice(0)
      for (const resolve of waiters) resolve({ type: 'assistant-stream', frame: { chunk: { type: update.phase === 'reasoning' ? 'reasoning-delta' : 'text-delta', text: 'x'.repeat(update.bytesReceived || 1) } } })
    }
    const session = {
      updateOptions: next => Object.assign(sessionOptions, next),
      id: `session-${sessions.size + 1}`,
      followup: async prompt => {
        session.started = true
        activeController = new AbortController()
        pending = Promise.resolve().then(() => complete({ ...sessionOptions, prompt }, activeController.signal, emitProgress))
      },
      whenIdle: async () => {
        const response = await pending
        events.push({ seq: ++sequence, type: 'user/message', data: { message: { content: [{ type: 'text', text: 'turn' }] } } })
        events.push({ seq: ++sequence, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: response.text }], usage: response.usage }, usage: response.usage } })
        events.push({ seq: ++sequence, type: 'turn/end', data: { reason: { kind: response.finish?.kind === 'length' ? 'max-tokens' : 'completed' } } })
        sessionEvents.push(...events.slice(-3))
      },
      page: async request => ({ records: events.filter(event => event.seq <= request.throughSeq).map(event => ({ type: 'event', event })), hasMore: false }),
      follow: async function* (_, signal) {
        const cursor = events.at(-1)?.seq ?? -1
        yield { type: 'snapshot', cursor, records: events.map(event => ({ type: 'event', event })) }
        while (!signal.aborted) {
          const frame = await new Promise(resolve => {
            const onAbort = () => resolve(null)
            signal.addEventListener('abort', onAbort, { once: true })
            progressWaiters.push(value => { signal.removeEventListener('abort', onAbort); resolve(value) })
          })
          if (frame) yield frame
        }
      },
      cancel: () => activeController?.abort(new Error('session cancelled')),
      dispose: async () => {},
    }
    sessions.set(session.id, session)
    return session
  }
  const scope = { signal: signal.signal, onStop: fn => stops.push(fn), background: job => jobs.push(job), models: { list: async () => [{ id: 'test', name: 'Test', models }] }, sessions: { create: async options => makeSession(options), resume: async (id, options) => { const existing = sessions.get(id); if (existing) { existing.updateOptions(options); return existing; } const session = makeSession(options); session.id = id; sessions.delete([...sessions.keys()].at(-1)); sessions.set(id, session); return session } } }
  const host = new ArenaHost({ store, games: new ArenaGames(), scope, turnDelayMs: 0, ...hostOptions })
  const start = config => host.start({ players: [{ provider: 'test', model: 'black' }, { provider: 'test', model: 'white' }], ...config })
  const settle = async () => { while (jobs.length) await jobs.shift() }
  return { root, store, scope, host, start, settle, sessions, sessionEvents, setResponder: value => { complete = value }, stop: () => { signal.abort(); stops.forEach(fn => fn()) } }
}
test('complete match persists inputs, output, speech and deterministic winner without opponent speech', async t => {
  const points = [[8, 4], [1, 1], [8, 5], [1, 2], [8, 6], [1, 3], [8, 7], [1, 4], [8, 8]], requests = []
  const env = await setup(t, async request => { requests.push(request); return reply(...points[requests.length - 1], '观众台词') })
  const started = await env.start(); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.config.maxTokens, 32768)
  assert.equal(match.config.timeoutSeconds, 300)
  assert.equal(match.config.pace, 'native')
  assert.ok(requests.every(request => request.generationMode === undefined && request.reasoningEffort === undefined))
  assert.equal(match.result.kind, 'win'); assert.equal(match.result.winner, 0)
  assert.equal(match.calls, 9); assert.equal(match.tokens, 180)
  assert.equal(match.config.contextMode, 'current-position')
  const records = match.events.filter(event => event.type === 'request')
  assert.equal(new Set(records.map(event => event.sessionId)).size, 2)
  assert.equal(env.sessions.size, 2)
  assert.equal(env.host.sessions.size, 0)
  for (const event of records) {
    assert.equal(event.contextMode, 'current-position')
    assert.equal(match.events.find(response => response.type === 'response' && response.turnId === event.turnId).sessionId, event.sessionId)
  }
  assert.ok(requests.every(request => request.tools === 'none' && request.system && !request.prompt.includes('"moves"')))
  assert.equal(match.events.filter(event => event.type === 'move').length, 9)
  assert.equal(match.events.filter(event => event.type === 'request').length, 9)
  assert.ok(requests.every(request => !request.prompt.includes('观众台词')))
})
test('uses the shared model ceiling and rejects a request above the selected models', async t => {
  const env = await setup(t, async request => { assert.equal(request.maxTokens, 8192); return reply(8, 8) }, [{ id: 'black', name: 'Black', maxOutputTokens: 16384 }, { id: 'white', name: 'White', maxOutputTokens: 8192 }])
  await assert.rejects(env.start({ maxTokens: 16385 }), /每步输出上限必须是 128—8192/u)
  const started = await env.start({ maxMoves: 1, maxTokens: 8192 }); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.config.maxTokensLimit, 8192)
  assert.equal(match.config.maxTokens, 8192)
})
test('explicit high-capacity routes allow the documented model ceiling', async t => {
  const env = await setup(t, async request => { assert.equal(request.maxTokens, 393216); return reply(8, 8) }, [{ id: 'black', name: 'Black', maxOutputTokens: 393216 }, { id: 'white', name: 'White', maxOutputTokens: 393216 }])
  await assert.rejects(env.start({ maxTokens: 393217 }), /每步输出上限必须是 128—393216/u)
  const started = await env.start({ maxMoves: 1, maxTokens: 393216 }); await env.settle()
  assert.equal((await env.store.get(started.id)).config.maxTokensLimit, 393216)
})
test('invalid moves are not committed; repair is charged and repeats exceeding policy forfeit', async t => {
  const env = await setup(t, async () => reply(0, 100))
  const start = await env.start(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.calls, 2); assert.equal(match.state.moves.length, 0)
  assert.equal(match.result.kind, 'forfeit'); assert.equal(match.result.winner, 1)
  assert.equal(match.events.filter(event => event.type === 'invalid').length, 2)
})
test('provider errors pause without declaring defeat; explicit resume continues', async t => {
  let fails = true
  const env = await setup(t, async () => { if (fails) throw new Error('Provider unavailable'); return reply(8, 8) })
  const start = await env.start({ maxMoves: 1 }); await env.settle()
  assert.equal((await env.store.get(start.id)).status, 'paused')
  assert.equal((await env.store.get(start.id)).result, null)
  fails = false; await env.host.control({ id: start.id, action: 'resume' }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.state.moves.length, 1); assert.equal(match.result.kind, 'limit'); assert.equal(match.calls, 2)
})
test('pause waits for accepted current action and cancellation prevents late action', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const env = await setup(t, async () => { await pending; return reply(8, 8) })
  const start = await env.start()
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'pause' }); release(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'paused'); assert.equal(match.state.moves.length, 1)
  const other = await env.start(); await env.host.control({ id: other.id, action: 'cancel' }); await env.settle()
  assert.equal((await env.store.get(other.id)).status, 'cancelled')
})
test('restart preserves received pending response and commits it without another model call', async t => {
  const env = await setup(t, async () => { throw new Error('must not call model') })
  const match = await env.store.create({ game: env.host.games.list()[0], players: [{ name: 'B' }, { name: 'W' }], config: { maxMoves: 1, maxCalls: 1, tokenBudget: 1000 }, state: env.host.games.get('gomoku').create() })
  await env.store.update(match.id, value => { value.pending = { turnId: 'received', player: 0, attempt: 0, response: reply(8, 8), elapsedMs: 1 } })
  await new ArenaStore(env.root).init()
  assert.equal((await env.store.get(match.id)).status, 'paused')
  await env.host.control({ id: match.id, action: 'resume' }); await env.settle()
  const resumed = await env.store.get(match.id)
  assert.equal(resumed.state.moves.length, 1); assert.equal(resumed.calls, 0)
})
test('hard call budget and token budget stop at a turn boundary', async t => {
  const env = await setup(t, async () => reply(8, 8))
  const start = await env.start({ maxCalls: 1 }); await env.settle()
  assert.equal((await env.store.get(start.id)).calls, 1)
  assert.equal((await env.store.get(start.id)).result.winner, null)
})
test('bad config and unavailable model cannot create a match', async t => {
  const env = await setup(t, async () => reply(8, 8))
  await assert.rejects(env.start({ maxMoves: 0 }))
  await assert.rejects(env.start({ pace: 'fast' }), /模式已移除/u)
  await assert.rejects(env.host.start({ players: [{ provider: 'test', model: 'missing' }, { provider: 'test', model: 'white' }] }))
  assert.equal((await env.store.list()).length, 0)
  await assert.rejects(env.store.get('../escape'))
})
test('cancellation preserves a late response for audit but never commits its action', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const env = await setup(t, async () => { await pending; return reply(8, 8) })
  const start = await env.start()
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'cancel' })
  release(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'cancelled')
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.pending, null)
  assert.equal(match.events.filter(event => event.type === 'response').length, 1)
})
test('cancellation preserves a rejected partial response for audit without committing it', async t => {
  const env = await setup(t, async (request, signal) => await new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('session cancelled')
      error.result = { ...reply(8, 8), text: 'partial', finish: { kind: 'cancelled' } }
      reject(error)
    }, { once: true })
  }))
  const start = await env.start({ maxMoves: 1 })
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'cancel' }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'cancelled')
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.filter(event => event.type === 'response').length, 1)
  assert.equal(match.events.find(event => event.type === 'response').finish.kind, 'cancelled')
})
test('changed game rules cannot resume an old match', async t => {
  const env = await setup(t, async () => { throw new Error('pause') })
  const start = await env.start(); await env.settle()
  await env.store.update(start.id, match => { match.game.version = 'old' })
  await assert.rejects(env.host.control({ id: start.id, action: 'resume' }), /规则版本/)
  assert.equal((await env.store.get(start.id)).status, 'paused')
})
test('reported token budget stops additional calls', async t => {
  const env = await setup(t, async () => ({ ...reply(8, 8), usage: { totalTokens: 1200 } }))
  const start = await env.start({ tokenBudget: 1000 }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.calls, 1)
  assert.equal(match.tokens, 1200)
  assert.equal(match.result.kind, 'limit')
})
test('strict decision parsing and usage include cached input but not double counted reasoning', () => {
  assert.throws(() => parseDecision('```json\n{}\n```'))
  assert.throws(() => parseDecision('{"action":{},"speech":""}'))
  assert.equal(tokenCount({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5, reasoningTokens: 3 }), 14)
  assert.equal(tokenCount(null), null)
})

test('decision prompt preserves the full current board and feedback without replaying moves', () => {
  const game = new ArenaGames().get('gomoku')
  let state = game.apply(game.create(), { row: 8, col: 8 }, 0)
  state = game.apply(state, { row: 7, col: 8 }, 1)
  const prompt = decisionPrompt(game, state, 0, '交叉点已有棋子')
  assert.ok(!prompt.includes('"moves"'))
  assert.ok(prompt.includes('07 . . . . . . . W'))
  assert.ok(prompt.includes('08 . . . . . . . B'))
  assert.ok(prompt.includes('"board"'))
  assert.ok(!prompt.includes('快棋回合'))
  assert.match(prompt, /交叉点已有棋子/u)
})

test('live generation metadata is ephemeral and resume time limits are audited', async t => {
  let entered, release, report
  const ready = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const requests = []
  const env = await setup(t, async (request, signal, progress) => {
    requests.push(request); report = progress
    await new Promise(resolve => setImmediate(resolve))
    progress({ phase: 'reasoning', bytesReceived: 10 })
    entered(); await gate
    return reply(8, 8)
  })
  const started = await env.start({ maxMoves: 2 })
  assert.equal(started.config.timeoutSeconds, 300)
  await ready
  const stored = await env.store.get(started.id), live = await env.host.get(started.id)
  assert.equal(live.activeTurn.phase, 'reasoning')
  assert.equal(live.activeTurn.bytesReceived, 10)
  assert.equal(stored.activeTurn.phase, undefined)
  assert.equal(live.revision, stored.revision)
  await env.host.control({ id: started.id, action: 'pause' }); release(); await env.settle()
  env.host.complete = async request => { requests.push(request); return reply(7, 8) }
  await assert.rejects(env.host.control({ id: started.id, action: 'resume', pace: 'fast' }), /模式已移除/u)
  await env.host.control({ id: started.id, action: 'resume', timeoutSeconds: 600 }); await env.settle()
  const match = await env.host.get(started.id)
  assert.equal(match.config.pace, 'native')
  assert.ok(requests.every(request => request.generationMode === undefined))
  assert.ok(match.events.some(event => event.type === 'config-updated' && event.previous.timeoutSeconds === 300 && event.next.timeoutSeconds === 600))
  assert.ok(match.events.find(event => event.type === 'response').firstOutputMs >= 0)
  report({ phase: 'answering', bytesReceived: 20 })
  assert.equal(env.host.progress.size, 0)
  await assert.rejects(env.host.control({ id: started.id, action: 'pause', pace: 'fast' }), /只能在继续/u)
})

for (const pace of [undefined, 'fast', 'deep']) test(`legacy ${pace || 'unspecified'} matches resume with full observations and an audited native configuration`, async t => {
  const requests = []
  const env = await setup(t, async request => { requests.push(request); return reply(8, 8) })
  const match = await env.store.create({ game: env.host.games.list()[0], players: [{ name: 'B', provider: 'test', model: 'black', fastDecision: { effort: 'off' } }, { name: 'W' }], config: { pace, system: 'Rules', maxMoves: 1, maxCalls: 1, maxTokens: 32768, timeoutSeconds: 300, tokenBudget: 1000 }, state: env.host.games.get('gomoku').create() })
  await env.store.update(match.id, value => { value.status = 'paused' })
  await env.host.control({ id: match.id, action: 'resume' }); await env.settle()
  assert.equal(requests[0].generationMode, undefined)
  assert.equal(requests[0].fastDecision, undefined)
  assert.equal(requests[0].reasoningEffort, undefined)
  assert.ok(requests[0].prompt.includes('"board"'))
  const resumed = await env.store.get(match.id)
  assert.equal(resumed.config.pace, 'native')
  assert.equal(resumed.config.contextMode, 'current-position')
  assert.ok(resumed.events.some(event => event.type === 'config-updated' && event.previous.contextMode === 'player-history' && event.next.contextMode === 'current-position'))
  assert.ok(resumed.events.some(event => event.type === 'config-updated' && event.previous.pace === (pace || 'deep') && event.next.pace === 'native'))
})
test('turn deadline pauses without retry or forfeit and resume applies an audited longer limit', async t => {
  const deadlines = [], controller = new AbortController()
  let wait = true
  const env = await setup(t, async (request, signal) => {
    if (!wait) return reply(8, 8)
    await new Promise((resolve, reject) => {
      const aborted = () => {
      const error = new Error(signal.reason.message)
      error.result = { text: 'partial', reasoning: 'still deciding', usage: { totalTokens: 200 }, finish: { kind: 'cancelled' } }
      reject(error)
      }
      if (signal.aborted) aborted()
      else signal.addEventListener('abort', aborted, { once: true })
    })
  }, undefined, { turnTimeout: milliseconds => { deadlines.push(milliseconds); return controller.signal } })
  const started = await env.start({ timeoutSeconds: 90, maxMoves: 1 })
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  await env.settle()
  let match = await env.store.get(started.id)
  assert.equal(match.status, 'paused')
  assert.equal(match.result, null)
  assert.equal(match.calls, 1)
  assert.equal(match.tokens, 200)
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.at(-1).code, 'ARENA_TURN_TIMEOUT')
  assert.match(match.events.at(-1).error, /Black 本步超过 90 秒/u)
  assert.equal(match.events.at(-1).response.text, 'partial')
  await assert.rejects(env.host.control({ id: started.id, action: 'resume', timeoutSeconds: 1801 }), /单步时限/u)
  assert.equal((await env.store.get(started.id)).config.timeoutSeconds, 90)
  wait = false
  env.host.turnTimeout = milliseconds => { deadlines.push(milliseconds); return new AbortController().signal }
  await env.host.control({ id: started.id, action: 'resume', timeoutSeconds: 300 })
  await env.settle()
  match = await env.store.get(started.id)
  assert.deepEqual(deadlines, [90000, 300000])
  assert.equal(match.state.moves.length, 1)
  assert.equal(match.calls, 2)
  assert.equal(match.config.timeoutSeconds, 300)
  const changed = match.events.find(event => event.type === 'config-updated')
  assert.deepEqual(changed.previous, { timeoutSeconds: 90 })
  assert.deepEqual(changed.next, { timeoutSeconds: 300 })
  assert.equal(match.events.filter(event => event.type === 'request').at(-1).timeoutSeconds, 300)
})


test('truncated Session reply continues in place, then pauses with accumulated usage and resumes the same Session', async t => {
  const env = await setup(t, async request => {
    assert.equal(request.tools, 'none')
    assert.ok(request.system)
    return { ...reply(8, 8), finish: { kind: 'length' } }
  })
  const started = await env.start({ maxMoves: 1 }); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.status, 'paused')
  assert.equal(match.tokens, 60)
  assert.equal(match.usageUnknown, false)
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.filter(event => event.type === 'invalid').length, 0)
  assert.equal(match.events.find(event => event.type === 'error').code, 'ARENA_OUTPUT_LIMIT')
  assert.ok(Number.isSafeInteger(match.players[0].sessionSeq))
  assert.equal(match.events.filter(event => event.type === 'continuation').length, 2)
  assert.ok(match.events.filter(event => event.type === 'continuation').every(event => event.sessionId === match.players[0].sessionId))
  const sessionId = match.players[0].sessionId
  env.setResponder(async request => { assert.equal(request.maxTokens, 16384); return reply(8, 8) })
  await env.host.control({ id: started.id, action: 'resume', maxTokens: 16384 })
  await env.settle()
  const resumed = await env.store.get(started.id)
  assert.equal(resumed.tokens, 80)
  assert.equal(resumed.state.moves.length, 1)
  assert.equal(resumed.players[0].sessionId, sessionId)
  assert.equal(resumed.events.find(event => event.type === 'error').sessionId, match.players[0].sessionId)
  assert.equal(resumed.events.filter(event => event.type === 'request').at(-1).sessionId, resumed.players[0].sessionId)
})
