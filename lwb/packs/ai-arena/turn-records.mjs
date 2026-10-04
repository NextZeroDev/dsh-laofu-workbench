export function turnRecords(match) {
  const outcomes = new Map(match.events.filter(event => ['response', 'error'].includes(event.type)).map(event => [event.turnId, event]))
  let moveNumber = 1
  return match.events.flatMap(event => {
    if (event.type === 'move') moveNumber = event.moveNumber + 1
    if (event.type !== 'request') return []
    const outcome = outcomes.get(event.turnId)
    const response = outcome?.type === 'error' ? outcome.response : outcome
    return [{ request: event, response, error: outcome?.type === 'error' ? outcome.error : null,
      moveNumber: event.moveNumber ?? moveNumber,
      sessionId: event.sessionId || response?.sessionId || outcome?.sessionId || null }]
  })
}

// DSH normalizes input as uncached input. Reasoning is part of outputTokens.
export function turnUsage(usage) {
  if (!usage) return null
  const cache = (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
  return { input: usage.inputTokens === undefined ? null : usage.inputTokens + cache,
    cacheRead: usage.cacheReadTokens ?? 0, output: usage.outputTokens ?? null,
    total: usage.totalTokens ?? (usage.inputTokens === undefined || usage.outputTokens === undefined ? null : usage.inputTokens + cache + usage.outputTokens) }
}
