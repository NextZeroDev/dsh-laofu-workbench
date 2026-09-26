import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('    class LwbPackClientRuntime')
const end = source.indexOf('    async function archiveRemote', start)
const pack = { id: 'example', packageName: '@test/example', menus: [{ id: 'home' }] }
function create({ error, page = true } = {}) {
  const calls = []
  const graph = { entries: [{ id: pack.packageName }], batches: [], rev: '1' }
  const Runtime = vm.runInNewContext(`${source.slice(start, end)}; LwbPackClientRuntime`, {
    services: { connection: { rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: graph } } } } },
    lwbPackClient: { page: () => page },
  })
  const runtime = new Runtime({ entries: {
    sync: async value => { assert.equal(value, graph); calls.push('sync') },
    state: { getSnapshot: () => ({ failures: error ? [{ id: pack.packageName, message: error }] : [] }) },
  } })
  return { runtime, calls }
}
test('client delegates graph lifecycle to the official serial controller', async () => {
  const { runtime, calls } = create()
  await runtime.sync(pack, true)
  assert.equal(calls[0][1], 'lwbPacks/clientGraph')
  assert.equal(calls[1], 'sync')
})
test('load reports activation errors and missing pages; unload allows absent pages', async () => {
  await assert.rejects(create({ error: 'activation failed' }).runtime.sync(pack, true), /activation failed/u)
  await assert.rejects(create({ page: false }).runtime.sync(pack, true), /注册/u)
  await create({ page: false }).runtime.sync(pack, false)
})
