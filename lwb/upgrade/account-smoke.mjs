/** Local-only ATS + real DSH Host acceptance. No production accounts or billable requests. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const desktop = process.argv.includes('--desktop')
const serve = process.argv.includes('--serve')
const catalogUnavailable = process.argv.includes('--catalog-unavailable')
const home = await realpath(await mkdtemp(join(tmpdir(), 'lwb-account-acceptance-')))
const catalog = { schemaVersion: 1, models: [
  { id: 'lwb-fast', name: '快速', available: true, supportsTools: true, supportsVision: false, contextWindow: 128000, maxOutputTokens: 8192 },
  ...[['lwb-balanced', '均衡'], ['lwb-ultimate', '极致']].map(([id, name]) => ({ id, name, available: false, reason: '服务暂未开放' })),
], services: Object.fromEntries(['tts', 'subtitle', 'cover-image'].map(id => [id, { available: true, minimumPoints: 10000 }])) }
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const data = raw ? JSON.parse(raw) : {}
  const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
  const session = { accessToken: 'local-access-only', refreshToken: 'local-refresh-only', user: { id: '7', email: 'qa@example.test', role: 'user' } }
  if (req.url === '/api/auth/login') return send(session)
  if (req.url === '/api/auth/logout') return send({ ok: true })
  if (req.headers.authorization === 'Bearer local-access-only') {
    if (req.url === '/api/auth/me') return send(session.user)
    if (req.url === '/api/membership/current') return send({ planCode: 'pro', planName: '专业会员（本地验收）' })
    if (req.url === '/api/points/account') return send({ availablePoints: 880000 })
    if (req.url === '/api/lwb/catalog') return catalogUnavailable ? send({ message: 'Cannot GET /api/lwb/catalog' }, 404) : send(catalog)
    if (req.url === '/api/lwb/bootstrap') return send({ application: 'lwb', userId: '7', credential: { apiKey: 'local-key-only', apiKeyId: '11' } })
    if (['/api/recharge-packages', '/api/membership/plans'].includes(req.url)) return send([])
  }
  if (req.url === '/api/lwb/v1/chat/completions' && req.headers.authorization === 'Bearer local-key-only' && data.model === 'lwb-fast') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'LWB 本地验收对话成功。' }, null], [{}, 'stop']]) res.write(`data: ${JSON.stringify({ id: 'local-1', object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    return res.end('data: [DONE]\n\n')
  }
  send({ message: 'Local acceptance: route disabled' }, 401)
})
mock.listen(0, '127.0.0.1'); await once(mock, 'listening')
const mockUrl = `http://127.0.0.1:${mock.address().port}`
const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening')
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
const debugPorts = []
for (let i = 0; i < 3; i++) {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  debugPorts.push(listener.address().port); await new Promise(resolve => listener.close(resolve))
}
const env = { ...process.env }
for (const key of ['DSH_HOME', 'LWB_DSH_HOME', 'LWB_PROFILE_DIR', 'LWB_PACK_REGISTRY', 'LWB_PACK_STATE_DIR', 'LWB_PACK_RUNTIME_DIR']) delete env[key]
const child = spawn(process.execPath, desktop ? ['lwb/desktop/dev.mjs', '--skip-build'] : ['lwb/dsh-launcher.mjs', '--port', String(port), '--no-open'], {
  env: { ...env, LWB_PRODUCT_HOME: home, LWB_PROFILE_ID: desktop ? 'desktop' : 'lwb', LWB_ATS_URL: mockUrl, LWB_DESKTOP_PORT: String(port), DSH_DESKTOP_RENDERER_DEBUG_PORT: String(debugPorts[0]), DSH_DESKTOP_MAIN_INSPECT_PORT: String(debugPorts[1]), DSH_DESKTOP_HOST_INSPECT_PORT: String(debugPorts[2]) },
  detached: true, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = '', exited = false
child.on('error', error => { exited = true; output += error.message }); child.on('exit', () => { exited = true })
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-100000) })
try {
  let address
  for (let attempt = 0; attempt < 900; attempt++) {
    address = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
    if (address) break
    if (exited) throw new Error('Host exited before readiness')
    await delay(100)
  }
  assert.ok(address, 'Host readiness')
  const origin = new URL(address).origin
  const auth = await fetch(address, { redirect: 'manual' })
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  const rpc = async (method, request) => {
    const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ type: 'client-request', rpcId: 'account-acceptance', method, payload: { args: request === undefined ? {} : { request } } }) })
    const body = await response.json()
    assert.equal(body.result?.ok, true, `${method}: ${body.result?.error?.message}`)
    return body.result.value
  }
  const models = () => rpc('lwbAccount/taskModel')
  assert.equal((await models()).groups.find(g => g.id === 'lwb')?.models.length, 0)
  await rpc('lwbPacks/load', { id: 'spoken-video' })
  assert.equal((await rpc('spokenVideo/mediaStatus')).connection.provider, 'lwb')
  await rpc('lwbAccount/login', { account: 'qa@example.test', password: 'local-only-test' })
  const account = await rpc('lwbAccount/status')
  assert.equal(account.points.availablePoints, 880000)
  assert.equal(JSON.stringify(account).includes('local-access-only'), false)
  assert.equal(JSON.stringify(account).includes('local-key-only'), false)
  if (catalogUnavailable) {
    assert.equal(account.user.id, '7')
    assert.match(account.serviceError, /更新 ATS/u)
    assert.equal((await models()).groups.find(g => g.id === 'lwb')?.models.length, 0)
    const media = (await rpc('spokenVideo/mediaStatus')).connection.providers.lwb
    const cover = (await rpc('spokenVideo/publishStatus')).providers.lwb.credential
    for (const state of [media, cover]) {
      assert.equal(state.authenticated, true)
      assert.equal(state.configured, false)
      assert.match(state.reason, /更新 ATS/u)
    }
  } else {
    assert.deepEqual((await models()).groups.find(g => g.id === 'lwb').models.map(m => m.name), ['快速'])
    await rpc('lwbAccount/setTaskModel', { mode: 'specified', provider: 'lwb', model: 'lwb-fast' })
    assert.deepEqual((await models()).selection, { provider: 'lwb', model: 'lwb-fast' })
    assert.equal((await rpc('spokenVideo/mediaStatus')).connection.providers.lwb.configured, true)
  }
  await rpc('spokenVideo/configureMediaConnection', { provider: 'bailian', apiKey: 'local-bailian-only' })
  await rpc('lwbAccount/logout')
  assert.equal((await models()).groups.find(g => g.id === 'lwb')?.models.length, 0)
  const media = await rpc('spokenVideo/mediaStatus')
  assert.equal(media.connection.provider, 'bailian')
  assert.equal(media.connection.providers.bailian.configured, true)
  assert.equal(media.connection.providers.lwb.configured, false)
  assert.equal(JSON.stringify(media).includes('local-bailian-only'), false)
  await rpc('lwbAccount/setTaskModel', { mode: 'follow-dsh' })
  if (catalogUnavailable) {
    await rpc('spokenVideo/clearMediaConnectionCredential', { provider: 'bailian' })
    await rpc('spokenVideo/configureMediaConnection', { provider: 'lwb' })
  }
  console.log(`${desktop ? 'Desktop' : 'Web'} account acceptance passed: ${catalogUnavailable ? 'missing service catalog preserves login and exposes the failure reason' : 'model registration, account DTO, independent model'}, logout, BYOK preservation.`)
  if (serve) {
    const info = join(home, 'qa.json')
    await writeFile(info, JSON.stringify({ address, home, desktop, debugPort: debugPorts[0], pid: child.pid }), { mode: 0o600 })
    console.log(`QA_INFO=${info}`)
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve) })
  }
} catch (error) {
  console.error(output.replace(/token=[^\s&]+/gu, 'token=[redacted]'))
  throw error
} finally {
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  if (!exited) await Promise.race([once(child, 'exit'), delay(8000)])
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
  mock.closeAllConnections(); mock.close()
  await rm(home, { recursive: true, force: true })
}
