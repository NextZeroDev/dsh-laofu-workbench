import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const upstreamRequire = createRequire(new URL('../../../vendor/deepseek-harness/package.json', import.meta.url))
const { JSDOM } = upstreamRequire('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')

const clientPath = new URL('../client.js', import.meta.url)
const WORKBENCH_KEY = 'lwb.workbench.v3'
const NAV_KEY = 'lwb.nav.v1'

const PACKS = [
  { id: 'pack-a', name: 'Alpha', menus: [{ id: 'home', label: 'Alpha Home' }, { id: 'runs', label: 'Alpha Runs' }] },
  { id: 'pack-b', name: 'Beta', menus: [{ id: 'home', label: 'Beta Home' }] },
]
const MARKET = { packs: PACKS.map((pack) => ({ id: pack.id, name: pack.name, menus: pack.menus })) }

function navPreferenceFunctions(source) {
  const start = source.indexOf('function navStorage(storage) {')
  const end = source.indexOf('\n    function notify(', start)
  assert.ok(start >= 0 && end > start, 'client must define the nav preference store')
  const packId = source.match(/const PACK_ID = (\/.*?\/);/u)?.[1]
  assert.ok(packId, 'client must declare the pack id contract')
  const navKey = source.match(/const NAV_STORAGE_KEY = '([^']+)';/u)?.[1]
  assert.ok(navKey, 'client must declare the nav storage key')
  return vm.runInNewContext(`(() => { const PACK_ID = ${packId}; const NAV_STORAGE_KEY = ${JSON.stringify(navKey)}; ${source.slice(start, end)}\n; return { readNavPreference, writeNavPreference } })()`)
}

function snapshotFunction(source) {
  const start = source.indexOf('function persistedSnapshot(state) {')
  const end = source.indexOf('\n    function persist(', start)
  assert.ok(start >= 0 && end > start, 'client must define the persisted snapshot')
  const version = source.match(/const BASE_CONTRACT_VERSION = (\d+);/u)?.[1]
  assert.ok(version, 'client must declare its contract version')
  return vm.runInNewContext(`(() => { const BASE_CONTRACT_VERSION = ${version}; ${source.slice(start, end)}\n; return persistedSnapshot })()`)
}

function fakeStorage(initial) {
  const values = new Map(initial ? Object.entries(initial) : [])
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('the recorded group preference tolerates missing, malformed, and hostile storage', async () => {
  const { readNavPreference, writeNavPreference } = navPreferenceFunctions(await readFile(clientPath, 'utf8'))

  assert.equal(readNavPreference(fakeStorage()), null, 'no record means no preference yet')
  assert.equal(readNavPreference(undefined), null, 'a storage-less runtime degrades to no preference')
  assert.equal(readNavPreference(fakeStorage({ [NAV_KEY]: 'not json' })), null)
  assert.equal(readNavPreference(fakeStorage({ [NAV_KEY]: '[]' })), null, 'a bare array is not the record shape')
  assert.equal(readNavPreference({ getItem() { throw new Error('denied') } }), null, 'a throwing read must not break the shell')
  assert.deepEqual([...readNavPreference(fakeStorage({ [NAV_KEY]: JSON.stringify({ expandedPacks: [] }) }))], [], 'an empty record is a real answer')

  const sanitized = readNavPreference(fakeStorage({ [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-a', 'Not An Id', 'pack-b', 7, null, 'pack-a'] }) }))
  assert.deepEqual([...sanitized].sort(), ['pack-a', 'pack-b'], 'only contract-valid ids survive, deduplicated')

  const storage = fakeStorage()
  writeNavPreference(new Set(['pack-b', 'pack-a']), storage)
  assert.deepEqual(JSON.parse(storage.values.get(NAV_KEY)).expandedPacks, ['pack-a', 'pack-b'], 'the record is written in a stable order')
  assert.deepEqual([...readNavPreference(storage)].sort(), ['pack-a', 'pack-b'], 'the record round-trips')
  writeNavPreference(new Set(), storage)
  assert.deepEqual([...readNavPreference(storage)], [], 'collapsing everything is recorded as an empty set')
  assert.doesNotThrow(() => writeNavPreference(new Set(['pack-a']), { setItem() { throw new Error('quota') } }), 'a failing write stays silent')
  assert.doesNotThrow(() => writeNavPreference(new Set(['pack-a']), undefined), 'a storage-less runtime stops at the guard')
})

test('the workbench snapshot records the current page so a reload returns to it', async () => {
  const persistedSnapshot = snapshotFunction(await readFile(clientPath, 'utf8'))

  assert.equal(persistedSnapshot({ page: 'packs' }).page, 'packs')
  assert.equal(persistedSnapshot({ page: 'settings' }).page, 'settings')
  assert.equal(persistedSnapshot({ page: 'capability', capabilityPage: 'pack-a:home' }).capabilityPage, 'pack-a:home')
  assert.equal(persistedSnapshot({ page: 'conversation', capabilityPage: 7 }).capabilityPage, null)
  assert.equal(persistedSnapshot({ page: 'unknown' }).page, 'conversation', 'an unknown page falls back to the conversation')
  assert.ok(Number.isFinite(persistedSnapshot({ page: 'packs' }).stateUpdatedAt))
})

/**
 * Boot the real client bundle against a jsdom window and hand back the sidebar
 * seat, its container, and a reload helper that keeps localStorage.
 */
async function mountSidebar(options = {}) {
  const dom = new JSDOM('<!doctype html><title>DSH</title><body></body>', { url: 'http://localhost/' })
  const window = dom.window
  for (const [key, value] of Object.entries(options.seed || {})) window.localStorage.setItem(key, value)
  try {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    })
  } catch (_) {
    window.Window.prototype.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }

  let packs = options.packs || PACKS
  const events = new Map()
  const cleanups = []
  const ctx = {
    services: new Map(),
    get(name) { return this.services.get(name) },
    provide(name, value) { this.services.set(name, value) },
    on(event, handler) {
      const handlers = events.get(event) || new Set()
      handlers.add(handler)
      events.set(event, handlers)
      return () => handlers.delete(handler)
    },
    emit(event) { for (const handler of [...(events.get(event) || [])]) handler() },
    // The real context owns effect disposal; keep the returned cleanup so a test
    // does not leave the shell's account timer running.
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
  }
  const slots = new Map()
  const slotsService = {
    inject(name, register) { return register() },
    register({ name }, component) { slots.set(name, component); return () => slots.delete(name) },
  }
  ctx.slots = slotsService
  ctx.provide('slots', slotsService)
  const rpc = async (path, method) => {
    if (method === 'lwbPacks/visibility') return { ok: true, value: { sessionIds: [], workspacePaths: [] } }
    if (method === 'lwbPacks/list' || method === 'lwbPacks/market') {
      if (options.pendingPacks) return new Promise(() => {})
      return { ok: true, value: method === 'lwbPacks/market' ? MARKET : { packs } }
    }
    return { ok: true, value: {} }
  }
  ctx.provide('connection', { rpc: { call: rpc } })
  for (const name of ['sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale', 'modules']) ctx.provide(name, {})
  ctx.provide('remote', {})

  let plugin
  const primitives = new Proxy({}, { get: () => () => null })
  vm.runInNewContext(await readFile(clientPath, 'utf8'), {
    window: Object.assign(window, { __ModuleLoader__: { load({ factory }) {
      plugin = factory((name) => name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name))
    } } }),
    document: window.document, localStorage: window.localStorage,
    MutationObserver: window.MutationObserver, Node: window.Node, NodeFilter: window.NodeFilter,
    AbortController, URL, setInterval, clearInterval, requestAnimationFrame: (callback) => setTimeout(callback, 0), queueMicrotask, console,
  })
  plugin.apply(ctx)

  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container)
  const originals = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const Sidebar = slots.get('sidebar')
  assert.ok(Sidebar, 'the product navigation registers on apply')

  const flush = async (rounds = 4) => { for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }
  const render = async () => {
    // One act for mount and the catalog round trip that follows it: resolving the
    // pending RPC outside act would report a state update React never saw.
    await React.act(async () => { root.render(React.createElement(Sidebar, { collapsed: false, width: 248 })); await flush() })
  }
  const click = async (node) => { await React.act(async () => { node.click(); await flush() }) }
  const groups = () => [...container.querySelectorAll('.lwb-cap-group')].map((section) => {
    const toggle = section.querySelector('.lwb-cap-toggle')
    return {
      title: toggle.title,
      expanded: toggle.getAttribute('aria-expanded'),
      active: section.getAttribute('data-active'),
      menus: [...section.querySelectorAll('.lwb-cap-menu .lwb-nav-item')].map((button) => button.textContent),
    }
  })
  const navRecord = () => {
    const raw = window.localStorage.getItem(NAV_KEY)
    return raw === null ? null : JSON.parse(raw).expandedPacks
  }
  const pageRecord = () => {
    const raw = window.localStorage.getItem(WORKBENCH_KEY)
    return raw === null ? null : JSON.parse(raw).page
  }
  const unload = async () => {
    await React.act(async () => { root.unmount() })
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    // apply() hands its teardown to the context, not to the caller.
    for (const cleanup of cleanups.splice(0)) cleanup()
    window.close()
  }

  return {
    window, container, render, click, groups, navRecord, pageRecord, unload,
    setPacks: (next) => { packs = next },
    refreshCatalog: async () => { await React.act(async () => { ctx.emit('connection/reset'); await flush() }) },
  }
}

test('a reload keeps the capability group the user opened', async () => {
  const first = await mountSidebar()
  try {
    await first.render()
    assert.deepEqual(first.groups().map((group) => group.expanded), ['false', 'false'], 'two packs start collapsed with no recorded preference')
    assert.equal(first.navRecord(), null, 'nothing is written before the user acts')

    await first.click(first.container.querySelectorAll('.lwb-cap-toggle')[0])
    assert.deepEqual(first.groups()[0].expanded, 'true')
    assert.deepEqual(first.groups()[0].menus, ['Alpha Home', 'Alpha Runs'])
    assert.deepEqual(first.navRecord(), ['pack-a'], 'the open group is recorded')

    // A browser reload keeps localStorage but rebuilds the module: this is the
    // regression the grouping shipped with, where the page always came back shut.
    const seed = {
      [WORKBENCH_KEY]: first.window.localStorage.getItem(WORKBENCH_KEY),
      [NAV_KEY]: first.window.localStorage.getItem(NAV_KEY),
    }
    const reloaded = await mountSidebar({ seed })
    try {
      await reloaded.render()
      assert.deepEqual(reloaded.groups().map((group) => group.expanded), ['true', 'false'], 'the reloaded shell restores the open group')
      assert.deepEqual(reloaded.navRecord(), ['pack-a'], 'the restored record is not rewritten away')
    } finally {
      await reloaded.unload()
    }
  } finally {
    await first.unload()
  }
})

test('an explicitly collapsed group is not reopened by a reload of its own page', async () => {
  const seed = {
    [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-a:home' }),
    [NAV_KEY]: JSON.stringify({ expandedPacks: [] }),
  }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    const groups = harness.groups()
    assert.equal(groups[0].active, 'true', 'the capability route is restored')
    assert.equal(groups[0].expanded, 'false', 'a recorded collapse wins over the route reveal')
    assert.equal(groups[1].expanded, 'false')
    assert.deepEqual(harness.navRecord(), [], 'the recorded collapse survives the boot')
  } finally {
    await harness.unload()
  }
})

test('a first-run capability route reveals its pack without a recorded preference', async () => {
  const seed = { [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-b:home' }) }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    const groups = harness.groups()
    assert.equal(groups[1].active, 'true')
    assert.deepEqual(groups.map((group) => group.expanded), ['false', 'true'], 'only the active pack is revealed')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'the reveal becomes the starting record')
  } finally {
    await harness.unload()
  }
})

test('a pending catalog never erases the recorded groups', async () => {
  const seed = { [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-b'] }) }
  const harness = await mountSidebar({ seed, pendingPacks: true })
  try {
    await harness.render()
    assert.deepEqual(harness.groups(), [], 'no pack renders while the catalog is pending')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'the empty pending frame must not be written back')
  } finally {
    await harness.unload()
  }
})

test('a catalog refresh neither erases nor reopens a hand-collapsed group', async () => {
  const seed = {
    [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-b:home' }),
    [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-b'] }),
  }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    assert.equal(harness.groups()[1].expanded, 'true', 'the recorded group is restored')

    await harness.click(harness.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.equal(harness.groups()[1].expanded, 'false')
    assert.deepEqual(harness.navRecord(), [], 'the collapse is recorded')

    // A pack switch or a connection reset reprojects the same catalog as a new
    // array: that refresh used to force the active pack back open.
    await harness.refreshCatalog()
    assert.equal(harness.groups()[1].expanded, 'false', 'a refresh is not a route entry')
    assert.deepEqual(harness.navRecord(), [], 'the collapse stays recorded')
  } finally {
    await harness.unload()
  }
})

test('unloading a pack prunes it from the recorded groups', async () => {
  const harness = await mountSidebar()
  try {
    await harness.render()
    const toggles = harness.container.querySelectorAll('.lwb-cap-toggle')
    await harness.click(toggles[0])
    await harness.click(harness.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.deepEqual(harness.navRecord(), ['pack-a', 'pack-b'])

    harness.setPacks([PACKS[1]])
    await harness.refreshCatalog()
    assert.deepEqual(harness.groups().map((group) => group.title), ['Beta'], 'the unloaded pack leaves the navigation')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'its record is pruned with it')
  } finally {
    await harness.unload()
  }
})

test('primary navigation records the page the user leaves behind', async () => {
  const harness = await mountSidebar()
  try {
    await harness.render()
    await harness.click(harness.container.querySelector('.lwb-nav-item[data-icon="packs"]'))
    assert.equal(harness.pageRecord(), 'packs', 'the marketplace page is recorded')
    await harness.click(harness.container.querySelector('.lwb-cap-toggle'))
    assert.deepEqual(harness.navRecord(), ['pack-a'])
    await harness.click(harness.container.querySelector('.lwb-nav-item[data-icon="conversation"]'))
    assert.equal(harness.pageRecord(), 'conversation', 'returning to the conversation is recorded too')
  } finally {
    await harness.unload()
  }
})