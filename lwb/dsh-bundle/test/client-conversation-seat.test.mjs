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
      ['lwb.embedded.conversation', 'sidebar.settings', 'sidebar.workspaces'],
    )
    // The product navigation renders no slot, so it must not declare one.
    const [sidebar] = registry.entries('sidebar')
    assert.ok(sidebar, 'the product navigation entry is registered')
    assert.equal(sidebar.children, undefined)
    assert.equal(registry.spec('sidebar.workspaces')?.kind, 'single')

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
  return vm.runInNewContext(`(() => { ${source.slice(start, end)}\n; return { projectedHook, projectSessionList, projectWorkspaceList } })()`)
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
