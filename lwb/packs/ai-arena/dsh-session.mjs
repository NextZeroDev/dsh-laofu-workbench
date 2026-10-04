import { setTimeout as delay } from 'node:timers/promises'

export function recordEvent(record) {
  let value = record
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== 'object') return null
    if (value.type === 'event' && value.event && typeof value.event === 'object') {
      value = value.event
      continue
    }
    if (value.record && typeof value.record === 'object') {
      value = value.record
      continue
    }
    if (value.event && typeof value.event === 'object' && !value.seq) {
      value = value.event
      continue
    }
    break
  }
  return value && typeof value === 'object' ? value : null
}

export function eventSeq(record) {
  const event = recordEvent(record)
  const seq = typeof event?.seq === 'number' ? event.seq : Number(event?.seq)
  return Number.isSafeInteger(seq) ? seq : -1
}

export function pageEvents(page) {
  const records = page?.records || page?.value?.records || page?.page?.records || (Array.isArray(page) ? page : [])
  return records.map(recordEvent).filter(Boolean)
}

function safeCursor(value) {
  const cursor = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(cursor) ? cursor : -1
}

/**
 * Open the DSH history stream long enough to obtain its opening snapshot.
 * `page({ throughSeq: -1 })` means an empty history in DSH; the live follow
 * snapshot is the supported way to learn the current inclusive cursor.
 */
async function readSessionSnapshot(session, signal) {
  if (typeof session.follow !== 'function') return null
  const controller = new AbortController()
  const bounded = AbortSignal.any([controller.signal, AbortSignal.timeout(3000), ...(signal ? [signal] : [])])
  bounded.throwIfAborted()
  const stream = session.follow({ maxMessages: 200 }, bounded)
  const iterator = stream?.[Symbol.asyncIterator]?.()
  if (!iterator) return null
  try {
    const opening = await iterator.next()
    const frame = opening?.value
    if (!frame) return { cursor: -1, events: [] }
    const events = pageEvents(frame)
    return {
      cursor: Math.max(safeCursor(frame.cursor), ...events.map(eventSeq)),
      events,
    }
  } finally {
    controller.abort()
    try { await iterator.return?.() } catch {}
  }
}

function contentParts(message) {
  const content = message?.content ?? message?.message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content
  return content && typeof content === 'object' ? [content] : []
}

export function assistantText(message) {
  return contentParts(message).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
}

export function assistantReasoning(message) {
  return contentParts(message).filter(part => part?.type === 'reasoning' && typeof part.text === 'string').map(part => part.text).join('')
}

function finishFor(reason) {
  const kind = reason?.kind || reason || 'completed'
  if (kind === 'completed') return { kind: 'stop' }
  if (kind === 'max-tokens') return { kind: 'length' }
  if (kind === 'cancelled' || kind === 'aborted') return { kind: 'cancelled' }
  return { kind }
}

export function latestTurn(events, afterSeq = -1) {
  const fresh = events.filter(event => eventSeq(event) > afterSeq).sort((a, b) => eventSeq(a) - eventSeq(b))
  const assistant = fresh.filter(event => event.type === 'assistant/message').findLast(event => {
    const message = event.data?.message
    return assistantText(message).trim() || assistantReasoning(message).trim()
  })
  const end = fresh.findLast(event => event.type === 'turn/end')
  if (!assistant && !end) return null
  const message = assistant?.data?.message || {}
  return {
    text: assistantText(message),
    reasoning: assistantReasoning(message),
    usage: assistant?.data?.usage || message.usage || null,
    finish: end ? finishFor(end.data?.reason) : { kind: 'pending' },
    sessionSeq: Math.max(eventSeq(assistant), eventSeq(end)),
    turn: assistant?.data?.turn ?? end?.data?.turn ?? null,
  }
}

export async function readLatest(session, afterSeq = -1, { fallbackEvents = [], attempts = 5, retryDelayMs = 60 } = {}) {
  let latest = latestTurn(fallbackEvents, afterSeq)
  const collected = [...fallbackEvents]
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const snapshot = await readSessionSnapshot(session)
      const page = await session.page({ throughSeq: snapshot?.cursor ?? -1, maxMessages: 200 })
      collected.push(...(snapshot?.events || []), ...pageEvents(page))
      const candidate = latestTurn(collected, afterSeq)
      if (candidate) latest = candidate
      if (candidate?.text?.trim() && candidate.finish.kind !== 'pending') return candidate
    } catch (error) {
      lastError = error
    }
    if (attempt + 1 < attempts) await delay(retryDelayMs)
  }
  if (latest) return latest
  if (lastError) throw lastError
  return null
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || '会话已取消。'))
}

function streamChunk(frame) {
  const chunk = frame?.chunk || frame?.frame?.chunk || frame?.data?.chunk
  return chunk && typeof chunk === 'object' ? chunk : null
}

function streamEvents(frame) {
  const values = []
  const add = value => {
    const event = recordEvent(value)
    if (event?.type === 'assistant/message' || event?.type === 'turn/end') values.push(event)
  }
  for (const record of frame?.records || []) add(record)
  add(frame?.event)
  add(frame?.entry)
  add(frame?.record)
  return values
}

async function observeSession(session, signal, progress, observed) {
  if (typeof session.follow !== 'function') return
  try {
    for await (const frame of session.follow({ maxMessages: 20 }, signal)) {
      observed.push(...streamEvents(frame))
      const chunk = streamChunk(frame)
      if (!chunk || typeof chunk.text !== 'string' || !chunk.text) continue
      if (chunk.type === 'reasoning-delta') progress?.({ phase: 'reasoning', bytesReceived: chunk.text.length })
      else if (chunk.type === 'text-delta') progress?.({ phase: 'answering', bytesReceived: chunk.text.length })
    }
  } catch {
    // The stream is observational. The persisted event page remains authoritative.
  }
}

async function settleAfterAbort(session, boundary) {
  const idle = Promise.resolve().then(() => session.whenIdle())
  let settled
  try {
    settled = await Promise.race([
      idle.then(() => ({ kind: 'idle' }), error => ({ kind: 'error', error })),
      new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 1000)),
    ])
  } catch {
    settled = { kind: 'timeout' }
  }
  if (settled.kind === 'error' && settled.error?.result) return settled.error.result
  if (settled.kind !== 'idle') return null
  return readLatest(session, boundary)
}

async function waitForIdle(session, signal) {
  if (!signal) return session.whenIdle()
  if (signal.aborted) {
    try { session.cancel?.() } catch {}
    throw abortError(signal)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn(value)
    }
    const onAbort = () => {
      try { session.cancel?.() } catch {}
      finish(reject, abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(session.whenIdle()).then(() => finish(resolve), error => finish(reject, error))
  })
}

export async function executeSessionTurn(session, prompt, { afterSeq = -1, signal, progress } = {}) {
  signal?.throwIfAborted()
  const beforeSnapshot = await readSessionSnapshot(session, signal)
  const before = beforeSnapshot || await session.page({ throughSeq: -1, maxMessages: 200 })
  const boundary = Math.max(afterSeq, beforeSnapshot?.cursor ?? -1, ...pageEvents(before).map(eventSeq))
  const observerController = new AbortController()
  const observerSignal = signal ? AbortSignal.any([signal, observerController.signal]) : observerController.signal
  const observed = []
  const observer = observeSession(session, observerSignal, progress, observed)
  try {
    signal?.throwIfAborted()
    await session.followup(prompt)
    await waitForIdle(session, signal)
  } catch (error) {
    if (signal?.aborted) {
      const late = await settleAfterAbort(session, boundary)
      if (late) {
        if (signal.reason?.name === 'TimeoutError') {
          const timeout = new Error('DSH 会话在时限到达后才返回。')
          timeout.result = late
          throw timeout
        }
        return { ...late, finish: { kind: 'cancelled' } }
      }
    }
    if (!error.result) {
      try { error.result = await readLatest(session, boundary, { fallbackEvents: observed, attempts: 1 }) } catch {}
    }
    throw error
  } finally {
    observerController.abort()
    await observer
  }
  progress?.({ phase: 'receiving' })
  const response = await readLatest(session, boundary, { fallbackEvents: observed })
  if (!response || (!response.text.trim() && response.finish.kind === 'stop')) {
    const error = new Error('DSH 会话未返回可解析的选手回复。')
    error.result = response
    throw error
  }
  return response
}

export function sessionPrompt(system, prompt) {
  return `${system}\n\n${prompt}`
}
