import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { LwbModelAdapter } from '../dsh-adapter/lwb-model.mjs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

test('LWB delegates real SSE and tool calls to the official adapter with managed credentials', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const data of req) raw += data
    requests.push({ path: req.url, key: req.headers.authorization, body: JSON.parse(raw) })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'msg-1', object: 'chat.completion.chunk', created: 1, model: 'lwb-fast', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    if (requests.length === 1) { chunk({ role: 'assistant', content: '你好' }); chunk({}, 'stop') }
    else { chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"test"}' } }] }); chunk({}, 'tool_calls') }
    res.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close() })
  const entry = { id: 'lwb-fast', name: '快速', available: true, supportsTools: true, contextWindow: 128000, maxOutputTokens: 393216 }
  const client = { baseUrl: `http://127.0.0.1:${server.address().port}`, generation: 0, serviceAbort: new AbortController(), catalog: async () => ({ models: [entry] }), readSession: async () => ({ user: { id: '7' } }), assertGeneration(g) { assert.equal(g, this.generation) }, serviceCredential: async () => ({ apiKey: 'local-test-key' }), changed() {} }
  const adapter = new LwbModelAdapter(client, { get() {} })
  assert.equal((await adapter.listModels())[0].name, '快速')
  assert.equal((await adapter.listModels())[0].maxOutputTokens, 32768)
  const prepared = await adapter.prepareCall('lwb', 'lwb-fast')
  assert.equal(prepared.model.defaultMaxTokens, 32768)
  const options = { provider: 'lwb', model: 'lwb-fast', messages: [createUserMessage({ content: [{ type: 'text', text: '测试' }], source: { kind: 'plugin', plugin: 'test' } })] }
  const textChunks = []; for await (const chunk of prepared.stream(options)) textChunks.push(chunk)
  assert.ok(JSON.stringify(textChunks).includes('你好'), JSON.stringify(textChunks))
  assert.ok(!textChunks.some(chunk => chunk.type === 'error'), JSON.stringify(textChunks))
  const toolChunks = []; for await (const chunk of adapter.stream({ ...options, tools: [{ name: 'lookup', description: 'test lookup', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] })) toolChunks.push(chunk)
  assert.ok(JSON.stringify(toolChunks).includes('lookup'), JSON.stringify(toolChunks))
  assert.ok(JSON.stringify(toolChunks).includes('call-1'), JSON.stringify(toolChunks))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].path, '/api/lwb/v1/chat/completions')
  assert.equal(requests[0].key, 'Bearer local-test-key')
  assert.equal(requests[0].body.model, 'lwb-fast')
  assert.equal(requests[1].body.tools[0].function.name, 'lookup')
  client.generation++
  await assert.rejects(async () => { for await (const _ of prepared.stream(options)) {} }, /账号已变更/)
  assert.equal(requests.length, 2)
})
