import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function refreshPackCatalog(options = {})')
const end = source.indexOf('    class LwbPackClientRegistry', start)

function catalog() {
  const markets = []
  const context = {
    packCatalogGeneration: 0, lwbAccountGeneration: 0,
    packCatalog: { packs: [] }, packMarket: { packs: [] }, packVisibility: null,
    normalizePackCatalog: value => value, normalizePackMarket: value => value,
    setPackCatalog(value) { context.packCatalog = value },
    setPackMarket(value) { context.packMarket = value },
    services: { connection: { rpc: { async call(_path, method) {
      if (method === 'lwbPacks/market') return new Promise(resolve => { markets.push(resolve) })
      return { ok: true, value: { packs: [] } }
    } } } },
  }
  const refresh = vm.runInNewContext(`${source.slice(start, end)}; refreshPackCatalog`, context)
  return { context, markets, refresh }
}

test('an older marketplace request cannot overwrite updated member permissions', async () => {
  const { context, markets, refresh } = catalog()
  const old = refresh({ retain: true })
  const current = refresh({ retain: true })
  markets[1]({ ok: true, value: { packs: [{ allowed: true }] } })
  await current
  markets[0]({ ok: true, value: { packs: [{ allowed: false }] } })
  await old
  assert.equal(context.packMarket.packs[0].allowed, true)
})

test('a marketplace response from before login is ignored even while new permissions are pending', async () => {
  const { context, markets, refresh } = catalog()
  const old = refresh({ retain: true })
  context.lwbAccountGeneration++
  markets[0]({ ok: false, error: { message: 'Anonymous request failed' } })
  await old
  assert.equal(context.packMarket.error, undefined)
  assert.equal(context.packMarket.packs.length, 0)
})
