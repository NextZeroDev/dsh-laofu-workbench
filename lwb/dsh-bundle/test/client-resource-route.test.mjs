// The file route a conversation uses to open a file or artifact in the official
// right Sidebar, and the panel rule that route has to survive.
//
// LWB replaces `sidebarRight.openResource` so a pack card's file lands in that
// card's own Sidebar, which means the replacement resolves the Session its
// address names before it can decide anything. Two facts make that delicate:
// every address that names no pack Session must still reach the official call
// untouched (the dialog in `ui-chat` reports on it), and a card focus owes a
// panel collapse that the same gesture's official open must be able to supersede.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as cordis from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'

const require = createRequire(import.meta.url)
const clientPath = new URL('../client.js', import.meta.url)
const source = await readFile(clientPath, 'utf8')
const FILE_ADDRESS = 'dsh-resource://file/session/B/out/index.html'

/** Load the workbench client module with just enough browser surface to apply it. */
async function workbenchPlugin() {
  let plugin
  const element = { setAttribute() {}, remove() {}, style: {}, textContent: '' }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  // A new vm context has no host APIs, so every one `apply()` touches is stated.
  vm.runInNewContext(await readFile(clientPath, 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          plugin = factory(name => name === 'react' ? require('react') : new Proxy({}, { get: () => () => null }))
        },
      },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
    },
    document: {
      title: '',
      body: { nodeType: 1 },
      documentElement: { style: { removeProperty() {} } },
      head: { appendChild() {}, append() {} },
      visibilityState: 'visible',
      createElement: () => element,
      createTreeWalker: () => ({ nextNode: () => null }),
      getElementById: () => undefined,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver,
    NodeFilter: { SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    queueMicrotask,
    // The refresh interval must not outlive the test process.
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    AbortController,
  })
  return plugin
}

/** Apply the module and hand back the route it installed on the Sidebar service. */
async function appliedRoute() {
  const plugin = await workbenchPlugin()
  const opened = []
  const focused = []
  const official = (address, options) => { opened.push({ address, options }) }
  const sidebarRight = {
    openResource: official,
    mounted: { getSnapshot: () => undefined },
    isExpanded: () => false,
    toggleExpanded() {},
  }
  const provided = {
    slots: { inject: () => () => {}, register: () => () => {} },
    connection: {},
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    workspaces: {},
    uiWorkspace: { openSession: (sessionId) => { focused.push(sessionId) } },
    layout: {},
    locale: {},
    remote: {},
    loader: {},
    modules: {},
    shortcuts: {},
    sidebarRight,
  }
  const ctx = new cordis.Context()
  for (const [name, value] of Object.entries(provided)) ctx.provide(name, value)
  plugin.apply(ctx)
  return { sidebarRight, official, opened, focused }
}

/**
 * Evaluate the card route's own logic against a stand-in official service.
 *
 * The route closes over the module's panel state, so the slice is evaluated with
 * that state, a frame queue this test drives, and the services it reads.
 * @param services - what the module looks up as `services` (`sidebarRight`, `uiWorkspace`).
 * @param dom - the document the panel lookups read, when a test drives them.
 * @returns the route's own functions plus the frame queue they scheduled on.
 */
function panelRoute(services, dom) {
  const start = source.indexOf('const packSessionRendered = new Set();')
  const end = source.indexOf('\n    /**\n     * The control the official conversation header would have carried.')
  assert.ok(start >= 0 && end > start, 'client must define the pack Session panel route')
  const frames = []
  const route = vm.runInNewContext(`((services, document, requestAnimationFrame, frames) => { ${source.slice(start, end)}
    return {
      focusSession, settlePanelGesture, openPackResource, panelControlState, embeddedHostSessions,
      onScreenPanel, readPanelOpen,
      pending: () => pendingPanelCollapse, epoch: () => packPanelEpoch,
      flush: () => { let guard = 0; while (frames.length > 0 && guard < 500) { frames.shift()(); guard += 1 } return guard },
    } })`, {})(services, dom, (callback) => { frames.push(callback); return frames.length }, frames)
  return { ...route, frames }
}

/** One panel element as the lookups read it: its marker, and whether a hidden view covers it. */
function panelNode({ open = false, hidden = false } = {}) {
  const attributes = new Set(['data-sidebar-right-panel'])
  if (open) attributes.add('data-sidebar-right-open')
  return {
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => (name === 'data-sidebar-right-panel' ? 'push' : null),
    closest: (selector) => (selector === '[hidden]' && hidden ? { hidden: true } : null),
  }
}

/** A stand-in for the official Sidebar service: one surface per Session, minted by its seat. */
function panelService() {
  let mounted
  let expands = true
  const minted = new Set()
  const open = new Map()
  const expanded = new Map()
  const toggles = []
  return {
    mounted: { getSnapshot: () => mounted, subscribe: () => () => {} },
    opens: open,
    expanded,
    toggles,
    setMounted: (sessionId) => { mounted = sessionId },
    mint: (sessionId) => { minted.add(sessionId) },
    /** Whether placing a tab also expands the column; the official store only does so for a new tab. */
    setExpands: (value) => { expands = value },
    openResource(address, options) {
      if (mounted === undefined || !minted.has(mounted)) {
        throw new Error('sidebarRight: no session surface is mounted')
      }
      const list = open.get(mounted) ?? []
      list.push({ address, options })
      open.set(mounted, list)
      if (expands) expanded.set(mounted, true)
    },
    isExpanded: () => expanded.get(mounted) === true,
    toggleExpanded() { toggles.push(mounted); expanded.set(mounted, expanded.get(mounted) !== true) },
  }
}

/** The frame's own navigation: pointing it at a card names that Session at once. */
function routeFor(service) {
  return panelRoute({
    sidebarRight: service,
    uiWorkspace: { openSession: (sessionId) => { service.setMounted(sessionId) } },
  })
}

/** Two armed cards, with card A's file on screen: the state the reported bug starts from. */
function twoCards(service) {
  service.setMounted('A')
  service.mint('A')
  service.mint('B')
  service.expanded.set('A', true)
  const route = routeFor(service)
  route.embeddedHostSessions.set('A', 1)
  route.embeddedHostSessions.set('B', 1)
  return route
}

test('an address naming no pack Session reaches the official file route', async () => {
  const { sidebarRight, official, opened, focused } = await appliedRoute()
  assert.notEqual(sidebarRight.openResource, official, 'the file route is installed over the official call')

  const addresses = [
    'dsh-resource://file/session/never-rendered/out/index.html',
    'dsh-resource://file/session/encoded%20id/out/index.html',
    // The same scheme's other scope carries no Session at all.
    'dsh-resource://file/absolute/tmp/out/index.html',
    // A malformed escape names no Session either; it must not fail the open.
    'dsh-resource://file/session/%zz/out/index.html',
    'not-an-address',
  ]
  for (const address of addresses) sidebarRight.openResource(address)

  assert.deepEqual(opened.map(item => item.address), addresses, 'every address is delivered unchanged')
  assert.deepEqual(focused, [], 'no pack card is focused for an address outside this host')
})

test('the official file route receives the placement it was called with', async () => {
  const { sidebarRight, opened } = await appliedRoute()
  const options = { params: { line: 12 } }
  sidebarRight.openResource('dsh-resource://file/session/never-rendered/out/index.html', options)

  assert.equal(opened.length, 1)
  assert.equal(opened[0].address, 'dsh-resource://file/session/never-rendered/out/index.html')
  assert.equal(opened[0].options, options, 'placement parameters travel by identity, not by copy')
})

test('an artifact opened from another card keeps the panel and shows the file', async () => {
  const service = panelService()
  const route = twoCards(service)

  // The gesture: pointerdown focuses card B, its end settles the owed collapse,
  // and the artifact's own click focuses B as a panel gesture and opens the file.
  route.focusSession('B')
  route.settlePanelGesture()
  route.focusSession('B', { keepExpanded: true })
  route.openPackResource(service, service.openResource.bind(service), 'B', FILE_ADDRESS)
  assert.ok(route.flush() >= 1, 'the settled collapse runs once and finds itself superseded')

  assert.deepEqual(service.toggles, [], 'the panel the user was reading is never toggled')
  assert.deepEqual(Array.from(service.opens.keys()), ['B'], 'the file lands in the card it came from')
  assert.equal(service.expanded.get('B'), true, 'the column ends expanded on the file')
})

test('a plainly focused card still collapses its own remembered panel', async () => {
  const service = panelService()
  const route = twoCards(service)
  service.expanded.set('B', true)

  route.focusSession('B')
  route.settlePanelGesture()
  route.flush()

  assert.deepEqual(service.toggles, ['B'], 'the arriving card is the one collapsed')
  assert.equal(service.expanded.get('B'), false)
  assert.equal(service.expanded.get('A'), true, 'the card being left is not toggled: the column follows the frame')
})

test('a card focused while it is already the one on screen owes nothing', async () => {
  const service = panelService()
  const route = twoCards(service)

  route.focusSession('A')
  assert.equal(route.pending(), undefined, 'no collapse is owed for a gesture inside the card on screen')
  service.expanded.set('A', true)
  route.settlePanelGesture()
  assert.equal(route.flush(), 0)
  assert.deepEqual(service.toggles, [])
  assert.equal(service.expanded.get('A'), true)
})

test('an open waits for the arriving Session to be named and minted', async () => {
  const service = panelService()
  service.setMounted('A')
  service.mint('A')
  const route = routeFor(service)
  route.embeddedHostSessions.set('A', 1)
  route.embeddedHostSessions.set('B', 1)

  // The seat has not published B: the open is held, and never lands on A.
  route.openPackResource(service, service.openResource.bind(service), 'B', FILE_ADDRESS)
  assert.equal(service.opens.size, 0)

  service.setMounted('B')
  service.mint('B')
  route.flush()
  assert.deepEqual(Array.from(service.opens.keys()), ['B'])
  assert.equal(service.expanded.get('B'), true, 'the open leaves the column expanded')
})

test('an open retries while the arriving seat has not minted its surface', async () => {
  const service = panelService()
  // The service names B before the seat mints B's store, exactly as upstream
  // documents, so the first official attempt is refused.
  service.setMounted('B')
  const route = routeFor(service)
  route.embeddedHostSessions.set('B', 1)

  route.openPackResource(service, service.openResource.bind(service), 'B', FILE_ADDRESS)
  assert.equal(service.opens.size, 0, 'the refusal is not an open')
  assert.ok(route.frames.length > 0, 'the refusal is retried, not reported')

  service.mint('B')
  route.flush()
  assert.deepEqual(Array.from(service.opens.keys()), ['B'])
  assert.equal(service.expanded.get('B'), true, 'the open leaves the column expanded')
})

test('an open that only reveals an existing tab still leaves the column expanded', async () => {
  const service = panelService()
  service.setMounted('B')
  service.mint('B')
  service.setExpands(false)
  const route = routeFor(service)
  route.embeddedHostSessions.set('B', 1)

  route.openPackResource(service, service.openResource.bind(service), 'B', FILE_ADDRESS)

  assert.deepEqual(service.toggles, ['B'], 'the open, not the collapse, decides the column')
  assert.equal(service.expanded.get('B'), true)
})

test('an open no registered type can claim is reported to the gesture', async () => {
  const service = panelService()
  service.setMounted('B')
  service.mint('B')
  const route = routeFor(service)
  route.embeddedHostSessions.set('B', 1)

  const refuse = () => { throw new Error('sidebarRight: no registered tab type claims "x"') }
  assert.throws(() => route.openPackResource(service, refuse, 'B', 'x'), /no registered tab type claims/u)
  assert.equal(route.frames.length, 0, 'a wiring mistake is not retried: the file dialog still reports it')
})

test('a card head shows the panel only while that card owns the column', async () => {
  const service = panelService()
  service.setMounted('A')
  service.mint('A')
  const route = routeFor(service)

  assert.equal(route.panelControlState('A', 'A', true).expanded, true)
  assert.equal(route.panelControlState('A', 'B', true).expanded, false, 'another card is on screen')
  assert.equal(route.panelControlState('B', 'B', false).expanded, false, 'the column is collapsed')
})

test('the panel read is the one in view, not a hidden card of its own', () => {
  const services = { sidebarRight: {}, uiWorkspace: {} }
  // A card that opened a tab keeps its own panel in the DOM after the frame has
  // moved on; the element to read is the one no hidden view covers.
  const hiddenOpen = panelNode({ open: true, hidden: true })
  const visibleClosed = panelNode()
  const covered = panelRoute(services, { querySelectorAll: () => [hiddenOpen, visibleClosed] })
  assert.equal(covered.onScreenPanel(), visibleClosed)
  assert.equal(covered.readPanelOpen(), false, 'a hidden panel never answers for the column')

  const visibleOpen = panelNode({ open: true })
  const shown = panelRoute(services, { querySelectorAll: () => [hiddenOpen, visibleOpen] })
  assert.equal(shown.readPanelOpen(), true)
  const none = panelRoute(services, { querySelectorAll: () => [] })
  assert.equal(none.onScreenPanel(), undefined)
  assert.equal(none.readPanelOpen(), false)
})

test('the head reads the rendered column, and the shell settles a card gesture', () => {
  // The service publishes the on-screen Session only: a per-Session layout read
  // off it is always undefined, so the head must read the rendered marker.
  assert.doesNotMatch(source, /sidebar\?\.bySession/u)
  assert.ok(source.includes('useObservable(services?.sidebarRight?.mounted, undefined)'))
  assert.ok(source.includes('panelControlState(mounted, sessionId, open)'))
  assert.ok(source.includes("document.addEventListener('pointerup', settlePanelGesture, true)"))
  assert.ok(source.includes("document.addEventListener('click', settlePanelGesture, false)"))
  assert.ok(source.includes("document.removeEventListener('pointerup', settlePanelGesture, true)"))
  assert.ok(source.includes("document.removeEventListener('click', settlePanelGesture, false)"))
})
