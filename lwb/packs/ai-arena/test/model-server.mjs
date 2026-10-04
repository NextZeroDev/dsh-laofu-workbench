import { createServer } from 'node:http'

// Local protocol fixture, never registered automatically in a user's model catalog.
const points = [[8, 4], [1, 1], [8, 5], [1, 2], [8, 6], [1, 3], [8, 7], [1, 4], [8, 8]]
const server = createServer(async (request, response) => {
  try {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (input.tools?.length) throw new Error('Unexpected tools')
    // DSH can append its own context/retry user messages after the arena prompt.
    // Read the latest actual board observation instead of a fixed message index.
    let observation
    for (const message of input.messages.filter(item => item.role === 'user').reverse()) {
      if (typeof message.content !== 'string') continue
      for (const line of message.content.split('\n')) {
        if (!line.startsWith('{')) continue
        try {
          const candidate = JSON.parse(line)
          if (Number.isInteger(candidate.turn) && typeof candidate.board === 'string') observation = candidate
        } catch { /* A context line is not a board observation. */ }
      }
      if (observation) break
    }
    if (!observation) throw new Error('No arena observation in request')
    const point = points[(observation.turn - 1) % points.length]
    const action = observation.legalMoves?.[(observation.turn * 7) % observation.legalMoves.length] || { row: point[0], col: point[1] }
    const text = JSON.stringify({ action, speech: `验收发言：第${observation.turn}手，稳步推进。` })
    console.log(JSON.stringify({ model: input.model, game: observation.legalMoves ? 'xiangqi' : 'gomoku', turn: observation.turn, action, tools: input.tools?.length || 0 }))
    await new Promise(resolve => setTimeout(resolve, 700))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = value => response.write(`data: ${JSON.stringify({ id: 'arena-fixture', object: 'chat.completion.chunk', created: 1, model: input.model, ...value })}\n\n`)
    emit({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    emit({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
    emit({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    emit({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })
    response.end('data: [DONE]\n\n')
  } catch (error) {
    console.error(error)
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: error.message } }))
  }
})
server.listen(4196, '127.0.0.1', () => console.log('Arena QA fixture http://127.0.0.1:4196/v1'))
