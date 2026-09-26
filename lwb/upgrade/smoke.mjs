/** Real, keyless Host acceptance. Every write is confined to a temporary product home. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { assertUpstream } from '../upstream.mjs'

assertUpstream()
const home = await realpath(await mkdtemp(join(tmpdir(), 'lwb-host-acceptance-')))
let child, output, exited
async function stop() {
  if (!child || exited) return
  const done = once(child, 'exit')
  child.kill('SIGTERM')
  const running = child
  const timer = setTimeout(() => running.kill('SIGKILL'), 10_000)
  try { await done } finally { clearTimeout(timer) }
}
async function start() {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  output = ''; exited = false
  const env = { ...process.env }
  for (const key of ['DSH_HOME', 'LWB_DSH_HOME', 'LWB_PROFILE_DIR', 'LWB_PACK_REGISTRY', 'LWB_PACK_STATE_DIR', 'LWB_PACK_RUNTIME_DIR']) delete env[key]
  child = spawn(process.execPath, ['lwb/dsh-launcher.mjs', '--port', String(port), '--no-open'], {
    env: { ...env, LWB_PRODUCT_HOME: home, LWB_PROFILE_ID: 'lwb' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.on('error', error => { exited = true; output += error.message })
  child.on('exit', () => { exited = true })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-100_000) })
  let address
  for (let attempt = 0; attempt < 300; attempt++) {
    address = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
    if (address) break
    if (exited) throw new Error('Host exited before readiness')
    await delay(100)
  }
  if (!address) throw new Error('Host readiness timed out')
  const origin = new URL(address).origin
  const auth = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'native DSH authentication must issue a cookie')
  return async (method, args = {}) => {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({ type: 'client-request', rpcId: 'acceptance', method, payload: { args } }),
    })
    assert.equal(response.status, 200, method)
    const { result } = await response.json()
    assert.equal(result.ok, true, `${method}: ${result.error?.message}`)
    return result.value
  }
}
try {
  let rpc = await start()
  assert.equal((await rpc('lwbPacks/list')).packs.length, 0)
  const loaded = await rpc('lwbPacks/load', { request: { id: 'spoken-video' } })
  assert.equal(loaded.status, 'loaded')
  assert.ok(loaded.client.url.startsWith('plugins/'))
  const catalog = await rpc('lwbPacks/list')
  assert.equal(catalog.packs[0].menus.length, 8)
  assert.ok((await rpc('lwbPacks/clientGraph')).entries.some(row => row.id === loaded.packageName))
  await rpc('spokenVideo/createAccount', { request: { name: 'Acceptance account' } })
  await rpc('lwbPacks/unload', { request: { id: 'spoken-video' } })
  assert.equal((await rpc('lwbPacks/list')).packs.length, 0)
  assert.ok(!(await rpc('lwbPacks/clientGraph')).entries.some(row => row.id === loaded.packageName))
  await rpc('lwbPacks/load', { request: { id: 'spoken-video' } })
  assert.equal((await rpc('spokenVideo/listAccounts')).accounts[0].name, 'Acceptance account')
  await stop()
  rpc = await start()
  assert.equal((await rpc('lwbPacks/list')).packs[0].id, 'spoken-video')
  assert.equal((await rpc('spokenVideo/listAccounts')).accounts[0].name, 'Acceptance account')
  await rpc('lwbPacks/unload', { request: { id: 'spoken-video' } })
  console.log('Host acceptance passed: native auth, dynamic load/unload, 8 menus, account retention and startup restore.')
} catch (error) {
  console.error(output.replace(/token=[^\s&]+/gu, 'token=[redacted]'))
  throw error
} finally {
  await stop()
  await rm(home, { recursive: true, force: true })
}
