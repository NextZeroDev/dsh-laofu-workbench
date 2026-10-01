import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as cordis from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'
import * as slots from '../../../vendor/deepseek-harness/packages/client/ui-slots/lib/index.js'

const require = createRequire(import.meta.url)
const upstream = new URL('../../../vendor/deepseek-harness/packages/client/', import.meta.url)
const clientPath = new URL('../client.js', import.meta.url)

async function clientModule(path) {
  let plugin
  vm.runInNewContext(await readFile(new URL(path, upstream), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => {
      plugin = factory((name) => name === '@deepseek-ai/cordis' ? cordis
        : name === '@deepseek-ai/dsh-client-ui-slots' ? slots : require(name))
    } } },
    queueMicrotask,
  })
  return plugin
}

/** Read one LWB registration's literal options object out of the client source. */
function registrationOptions(source, slot, component) {
  const name = slot.replace(/\./gu, '\\.')
  const options = source.match(new RegExp(`ctx\\.slots\\.inject\\('${name}', \\(\\) => ctx\\.slots\\.register\\((\\{[\\s\\S]*?\\}), ${component}\\)\\)`, 'u'))?.[1]
  assert.ok(options, `read the actual LWB ${slot} declaration`)
  return options
}

test('the conversation module declares its seat on the entry that renders it', async () => {
  const { SlotRegistry } = await clientModule('ui-renderer/lib/client.js')
  const source = await readFile(clientPath, 'utf8')
  const sidebarOptions = registrationOptions(source, 'sidebar', 'LwbSidebar')
  const overlayOptions = registrationOptions(source, 'shell.overlay', 'WorkbenchOverlay')

  const ctx = new cordis.Context()
  const slotRuntime = ctx.plugin(SlotRegistry)
  await slotRuntime.await()
  const registry = ctx.slots
  const disposeRoot = registry.register({ name: 'root', children: {
    sidebar: { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } }, () => null)
  try {
    registry.register(vm.runInNewContext(`(${sidebarOptions})`), () => null)
    registry.register(vm.runInNewContext(`(${overlayOptions})`), () => null)

    // The renderer authorizes renderSlot against the rendering entry's own
    // children table. Declaring the seat anywhere else throws
    // SlotOwnershipError mid-render and the entry's error boundary silently
    // replaces the whole overlay with an empty div.
    const overlay = registry.entries('shell.overlay').find(entry => entry.options.id === 'lwb-workbench-management')
    assert.ok(overlay, 'the workbench overlay entry is registered')
    assert.deepEqual(
      Object.keys(overlay.children ?? {}).sort(),
      ['lwb.embedded.conversation', 'sidebar.panellist', 'sidebar.settings', 'sidebar.workspaces'],
    )
    // The product navigation renders no slot, so it must not declare one.
    const [sidebar] = registry.entries('sidebar')
    assert.ok(sidebar, 'the product navigation entry is registered')
    assert.equal(sidebar.children, undefined)
    assert.equal(registry.spec('sidebar.workspaces')?.kind, 'single')

    // The official global panel rows (Plugins) are a list seat on the same
    // entry, because the conversation column renders one row per registration.
    assert.equal(registry.spec('sidebar.panellist')?.kind, 'list')
    const disposePanel = registry.register({
      name: 'sidebar.panellist', id: 'plugins', order: 0, label: '插件',
    }, () => null)
    assert.equal(registry.entries('sidebar.panellist').length, 1, 'the official Plugins entry fills the seat')
    disposePanel()
    assert.equal(registry.entries('sidebar.panellist').length, 0)

    // Declaring the seat is what wakes ui-workspace's Workspace browser, and the
    // browser owns the directory-flow hole underneath it.
    const flow = 'sidebar.workspaces.directoryFlow'
    const disposeBrowser = registry.register({
      name: 'sidebar.workspaces', children: { [flow]: { kind: 'single', scope: 'root' } },
    }, () => null)
    assert.equal(registry.entries('sidebar.workspaces').length, 1, 'the official browser fills the seat')
    assert.equal(registry.spec(flow)?.kind, 'single', 'the browser declares its own directory-flow seat')
    disposeBrowser()
    assert.equal(registry.entries('sidebar.workspaces').length, 0)
  } finally {
    disposeRoot()
    await slotRuntime.dispose()
  }
})

/** Extract the pack-visibility projections, which are pure functions. */
function projections(source) {
  const start = source.indexOf('function projectedHook(hook, project) {')
  const end = source.indexOf("\n    /**\n     * The conversation module's left column", start)
  assert.ok(start >= 0 && end > start, 'client must define the pack visibility projections')
  return vm.runInNewContext(`(() => { ${source.slice(start, end)}\n; return { insidePackWorkspace, projectedHook, projectSessionList, projectWorkspaceList } })()`)
}

test('pack projections keep snapshot identity when nothing is hidden', async () => {
  const { projectSessionList, projectWorkspaceList } = projections(await readFile(clientPath, 'utf8'))
  const list = { ids: ['a', 'b'], byId: { a: {}, b: {} }, phase: 'ready' }
  assert.equal(projectSessionList(list, () => false), list)
  const snapshot = { phase: 'ready', items: [{ workspaceId: 'w', path: '/w', sessionIds: ['a'] }] }
  assert.equal(projectWorkspaceList(snapshot, () => false, () => false), snapshot)
  // A non-list value must survive untouched rather than becoming an empty view.
  assert.equal(projectSessionList(undefined, () => true), undefined)
  assert.equal(projectWorkspaceList({ phase: 'pending' }, () => true, () => true).phase, 'pending')
})

test('pack projections hide pack-owned Sessions and Workspaces', async () => {
  const { projectSessionList, projectWorkspaceList } = projections(await readFile(clientPath, 'utf8'))
  const list = { ids: ['a', 'p'], byId: { a: { id: 'a' }, p: { id: 'p' } }, phase: 'ready' }
  const sessions = projectSessionList(list, id => id === 'p')
  assert.deepEqual(Array.from(sessions.ids), ['a'])
  assert.deepEqual(Object.keys(sessions.byId), ['a'])
  assert.equal(sessions.phase, 'ready')

  const snapshot = {
    phase: 'ready',
    items: [
      { workspaceId: 'w1', path: '/one', sessionIds: ['a', 'p'] },
      { workspaceId: 'w2', path: '/pack', sessionIds: ['q'] },
    ],
  }
  const workspaces = projectWorkspaceList(snapshot, workspace => workspace.workspaceId === 'w2', id => id === 'p')
  assert.deepEqual(Array.from(workspaces.items, workspace => workspace.workspaceId), ['w1'])
  assert.deepEqual(Array.from(workspaces.items[0].sessionIds), ['a'])
  assert.equal(workspaces.phase, 'ready')
})

test('the projected Hook keeps reference identity across reads and forwards the selector', async () => {
  const { projectedHook } = projections(await readFile(clientPath, 'utf8'))
  let current = { ids: ['a'], byId: { a: {} } }
  const seen = []
  const hook = (selector, equal) => { seen.push(equal); return selector(current) }
  let projected = 0
  const seat = projectedHook(hook, value => { projected += 1; return value })

  const first = seat(state => state)
  const second = seat(state => state)
  assert.equal(first, second, 'the browser selects whole snapshots, so identity must hold')
  assert.equal(projected, 1, 'an unchanged snapshot must not re-project')
  assert.equal(first, current)
  assert.equal(seen[0], undefined, 'no comparison argument means the default one')

  current = { ids: ['b'], byId: { b: {} } }
  assert.equal(seat(state => state), current)
  assert.equal(projected, 2)

  const comparison = () => true
  assert.equal(seat(state => state.ids.length, comparison), 1)
  assert.equal(seen[seen.length - 1], comparison, 'the comparison argument passes through')
})

test('the pack-workspace directory rule contains exactly the owned tree', async () => {
  const { insidePackWorkspace } = projections(await readFile(clientPath, 'utf8'))
  const roots = ['/home/u/pack-state/workspaces/model-review']
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces/model-review', roots), true, 'the Workspace itself is owned')
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces/model-review/runs/t/1', roots), true, 'a per-run directory is owned')
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces/model-review/', roots), true, 'a trailing separator stays owned')
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces/model-review-2', roots), false, 'a sibling sharing the prefix is not owned')
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces', roots), false, 'a parent directory is not owned')
  assert.equal(insidePackWorkspace('C:\\state\\workspaces\\model-review\\runs\\t\\1', ['C:\\state\\workspaces\\model-review']), true, 'a Windows directory is owned')
  assert.equal(insidePackWorkspace('C:\\state\\workspaces\\model-review-2', ['C:\\state\\workspaces\\model-review']), false, 'a Windows sibling is not owned')
  assert.equal(insidePackWorkspace('/home/u/pack-state/workspaces/model-review/runs', ['/home/u/pack-state/workspaces/model-review/']), true, 'a root trailing separator is tolerated')
  // Missing facts must never hide a Session: an unread cwd or an empty root list.
  assert.equal(insidePackWorkspace(undefined, roots), false)
  assert.equal(insidePackWorkspace('', roots), false)
  assert.equal(insidePackWorkspace('/home/u/anything', []), false)
  assert.equal(insidePackWorkspace('/home/u/anything', ['', null, undefined]), false)
})

test('a Session created after the ownership read is still hidden by its directory', async () => {
  const { insidePackWorkspace, projectSessionList } = projections(await readFile(clientPath, 'utf8'))
  const roots = ['/pack/model-review']
  // The index names one Session; the run Session was created while the browser
  // was open, so only its cwd can identify it.
  const isPackSession = (id, summary) => id === 'indexed' || insidePackWorkspace(summary?.cwd, roots)
  const list = {
    ids: ['ordinary', 'indexed', 'run'],
    byId: {
      ordinary: { id: 'ordinary', cwd: '/home/u/work' },
      indexed: { id: 'indexed' },
      run: { id: 'run', cwd: '/pack/model-review/runs/task/run' },
    },
    phase: 'ready',
  }
  const projected = projectSessionList(list, isPackSession)
  assert.deepEqual(Array.from(projected.ids), ['ordinary'])
  assert.deepEqual(Object.keys(projected.byId), ['ordinary'])
  assert.equal(projected.phase, 'ready')
  // The directory rule must not touch a snapshot it hides nothing in.
  const clean = { ids: ['ordinary'], byId: { ordinary: { id: 'ordinary', cwd: '/home/u/work' } } }
  assert.equal(projectSessionList(clean, isPackSession), clean)
})

/**
 * Extract the official panel-row projection and its selection guards. They read
 * `services` lazily, so the sandbox's global can be swapped between cases.
 */
function panelRows(source) {
  const start = source.indexOf('const conversationPanels = { rows: [], listeners: new Set() };')
  const end = source.indexOf("\n    /**\n     * The conversation module's left column", start)
  assert.ok(start >= 0 && end > start, 'client must define the panel-row projection')
  const sandbox = { React: { useSyncExternalStore: () => undefined } }
  const api = vm.runInNewContext(
    `(() => { ${source.slice(start, end)}\n; return { conversationPanels, readConversationPanels, syncConversationPanels, selectConversationPanel, clearConversationPanel } })()`,
    sandbox,
  )
  return {
    ...api,
    /** Install one fake service set for the next call. */
    use(next) { sandbox.services = next },
  }
}

test('panel rows follow the official registry order, labels, and identity', async () => {
  const rows = panelRows(await readFile(clientPath, 'utf8'))
  // A registrant may supply a function label (locale-bound); an entry without an
  // id is not a row, and the order comes from the registration's `order`.
  rows.use({
    slots: {
      entriesOfSlot: () => ([
        { options: { id: 'plugins', order: 10, label: '插件' } },
        { options: { id: 'schedules', order: 0, label: () => '日程' } },
        { options: { order: 0 } },
        { options: { id: '', order: 0 } },
      ]),
    },
  })
  assert.deepEqual(Array.from(rows.readConversationPanels(), (row) => [row.id, row.label]), [['schedules', '日程'], ['plugins', '插件']])

  // The React store reads this snapshot, so an unchanged registry must not
  // publish a new array.
  let notified = 0
  rows.conversationPanels.listeners.add(() => { notified += 1 })
  rows.syncConversationPanels()
  const first = rows.conversationPanels.rows
  rows.syncConversationPanels()
  assert.equal(rows.conversationPanels.rows, first, 'an unchanged registry keeps the snapshot identity')
  assert.equal(notified, 1, 'only the content change notifies')

  // An entry without a resolved label still renders as its id.
  rows.use({ slots: { entriesOfSlot: () => ([{ options: { id: 'plugins' } }]) } })
  rows.syncConversationPanels()
  assert.deepEqual(Array.from(rows.conversationPanels.rows, (row) => [row.id, row.label]), [['plugins', 'plugins']])

  // No slot service at all degrades to no rows instead of throwing.
  rows.use(undefined)
  assert.deepEqual(Array.from(rows.readConversationPanels()), [])
})

test('panel selection skips a row whose main panel is not registered', async () => {
  const rows = panelRows(await readFile(clientPath, 'utf8'))
  const selected = []
  // A real layout service keeps its state on the instance and reads `this` in
  // `selectPanel`. A reference detached from the service therefore throws here
  // instead of only in the browser, which is how this call shipped broken.
  class FakeLayout {
    constructor(activePanelId) { this.selected = selected; this.activePanelId = activePanelId; this.receiver = null }
    selectPanel(panelId) { this.receiver = this; this.selected.push(panelId) }
    get panelInfo() { return { getSnapshot: () => ({ activePanelId: this.activePanelId }) } }
  }
  const layout = (activePanelId) => new FakeLayout(activePanelId)

  // layout.selectPanel throws for an unregistered key, so the row must not call it.
  const empty = layout(null)
  rows.use({ slots: { entries: () => [] }, layout: empty })
  rows.selectConversationPanel('plugins')
  assert.deepEqual(selected, [], 'an unregistered panel is ignored')
  assert.equal(empty.receiver, null, 'the service is not called at all')

  const registered = layout(null)
  rows.use({ slots: { entries: () => [{ options: { key: 'plugins' } }] }, layout: registered })
  rows.selectConversationPanel('plugins')
  assert.deepEqual(selected, ['plugins'], 'a registered panel is selected')
  assert.equal(registered.receiver, registered, 'the call keeps its service receiver')

  // Returning to the Conversation is guarded by the current selection, and a
  // composition without the layout service stays silent.
  const already = layout(null)
  rows.use({ slots: { entries: () => [{ options: { key: 'plugins' } }] }, layout: already })
  rows.clearConversationPanel()
  assert.deepEqual(selected, ['plugins'], 'an already-selected Conversation is not reselected')
  const active = layout('plugins')
  rows.use({ slots: { entries: () => [{ options: { key: 'plugins' } }] }, layout: active })
  rows.clearConversationPanel()
  assert.deepEqual(selected, ['plugins', null], 'a selected panel returns to the Conversation')
  assert.equal(active.receiver, active, 'the receiver survives the return to the Conversation')
  rows.use({})
  rows.selectConversationPanel(null)
  rows.clearConversationPanel()
  assert.deepEqual(selected, ['plugins', null], 'a missing layout service is not an error')
})
