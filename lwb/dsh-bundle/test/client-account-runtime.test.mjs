import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as cordis from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'
import Loader from '../../../vendor/deepseek-harness/vendor/loader/lib/index.js'

const require = createRequire(import.meta.url)
const upstreamRequire = createRequire(new URL('../../../vendor/deepseek-harness/package.json', import.meta.url))
const { JSDOM } = upstreamRequire('jsdom')

// Use real traced Cordis services: a plain { account: ... } mock hides a
// missing remote.account injection and lets a broken Desktop boot pass.
async function checkClientActivation(accountInitiallyReady) {
  const dom = new JSDOM('<!doctype html><title>DSH</title><body></body>', { url: 'http://localhost/' })
  const ctx = new cordis.Context()
  let plugin
  let opened = 0
  let disposed = 0
  let accepted = 0
  let finishStream
  const streamEnded = new Promise(resolve => { finishStream = resolve })
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { value: { status: 'signed-out', attempt: null }, accept() { accepted++ } }
      await streamEnded
    },
    dispose() { disposed++; finishStream() },
  }
  class Remote extends cordis.Service {
    constructor(context) { super(context, 'remote') }
    $stream(options) { return options.open(new AbortController().signal) }
  }
  class Account extends cordis.Service {
    constructor(context) { super(context, 'remote.account') }
    watch() { opened++; return stream }
  }
  const window = dom.window
  window.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name))
  } }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window, document: window.document, localStorage: window.localStorage,
    MutationObserver: window.MutationObserver, Node: window.Node, NodeFilter: window.NodeFilter,
    AbortController, URL,
  })
  const slots = new Map()
  ctx.provide('slots', {
    inject(_name, register) { return register() },
    register(options, component) {
      slots.set(options.name, component)
      return () => { slots.delete(options.name) }
    },
  })
  ctx.provide('connection', { rpc: { async call(_path, method) {
    if (method === 'lwbPacks/visibility') return { ok: true, value: { sessionIds: [], workspacePaths: [] } }
    if (method === 'lwbPacks/list' || method === 'lwbPacks/market') return { ok: true, value: { packs: [] } }
    throw new Error(`Unexpected RPC: ${method}`)
  } } })
  for (const name of ['sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale', 'modules']) ctx.provide(name, {})
  try {
    await ctx.plugin(Loader).await()
    await ctx.plugin(Remote).await()
    if (accountInitiallyReady) await ctx.plugin(Account).await()
    ctx.loader.internal = { version: 'client', async import() { return plugin } }
    await ctx.loader.create({ name: '@scitiger-ai/lwb-dsh-bundle' })
    await ctx.loader.await()
    const entry = [...ctx.loader.entries()][0]
    if (!accountInitiallyReady) {
      assert.equal(entry.fiber.state, 0, 'wait for the account namespace before applying the shell')
      assert.equal(opened, 0)
      await ctx.plugin(Account).await()
    }
    await entry.fiber.await()
    assert.equal(entry.fiber.state, 2, 'the Desktop boot audit requires an ACTIVE client')
    assert.ok(ctx.get('lwbPackClient'), 'capability registration remains available')
    assert.ok(slots.has('sidebar'))
    assert.ok(slots.has('shell.overlay'))
    assert.equal(opened, 1, 'the official account stream starts once')
    assert.equal(accepted, 1, 'account snapshots are accepted')
    await entry.fiber.dispose()
    assert.equal(disposed, 1, 'unloading the shell stops its account stream')
    assert.equal(slots.size, 0)
  } finally {
    finishStream()
    await ctx.fiber.dispose()
    window.close()
  }
}

test('LWB client activates through the official Loader with a traced account namespace', () => checkClientActivation(true))
test('LWB client waits for the official account namespace when it arrives later', () => checkClientActivation(false))
