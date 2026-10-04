import { createServer } from 'node:http'

// Local protocol fixture, never registered automatically in a user's model catalog.
const points = [[8, 4], [1, 1], [8, 5], [1, 2], [8, 6], [1, 3], [8, 7], [1, 4], [8, 8]]
const server = createServer(async (request, response) => {
  try {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (input.tools?.length) throw new Error('Unexpected tools')
    const prompt = input.messages.find(item => item.role === 'user')?.content
    if (typeof prompt !== 'string' || prompt.includes('验收发言')) throw new Error('Unexpected prompt or opponent speech')
    const observation = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
    const [row, col] = points[observation.turn - 1]
    const text = JSON.stringify({ action: { row, col }, speech: `验收发言：第${observation.turn}手，我选择${row}行${col}列。` })
    console.log(JSON.stringify({ model: input.model, turn: observation.turn, tools: input.tools?.length || 0 }))
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
