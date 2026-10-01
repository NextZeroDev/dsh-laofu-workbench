import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as cordis from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'
import * as slots from '../../../vendor/deepseek-harness/packages/client/ui-slots/lib/index.js'

const require = createRequire(import.meta.url)
const upstream = new URL('../../../vendor/deepseek-harness/packages/client/', import.meta.url)

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

test('LWB shell keeps both native DSH directory pickers active across slot lifetimes', async () => {
  const { SlotRegistry } = await clientModule('ui-renderer/lib/client.js')
  const picker = await clientModule('ui-directory-picker-native/lib/client.js')
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const overlay = source.match(/ctx\.slots\.inject\('shell\.overlay', \(\) => ctx\.slots\.register\((\{[\s\S]*?\}), WorkbenchOverlay\)\)/u)?.[1]
  assert.ok(overlay, 'read the actual LWB overlay declaration')
  // The Workspace browser owns the sidebar flow hole; the seat itself is
  // declared by the overlay entry, because that is the entry whose render code
  // hosts it. This composition disables upstream ui-sidebar.
  assert.doesNotMatch(source, /'sidebar\.workspaces\.directoryFlow': \{ kind: 'single', scope: 'root' \}/u)

  const ctx = new cordis.Context()
  const slotRuntime = ctx.plugin(SlotRegistry)
  await slotRuntime.await()
  const registry = ctx.slots
  ctx.provide('uiWorkspace', { pickDirectory: async () => null })
  const hero = 'conversation.hero.workspace.directoryFlow'
  const flow = 'sidebar.workspaces.directoryFlow'
  const disposeRoot = registry.register({ name: 'root', children: {
    sidebar: { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.hero.workspace': { kind: 'single', scope: 'root' },
  } }, () => null)
  const runtime = ctx.plugin(picker)
  await runtime.await()
  try {
    // This was the broken composition: the native picker waits for its sibling.
    assert.equal(registry.entries(hero).length, 0)
    for (let mount = 0; mount < 2; mount++) {
      const disposeOverlay = registry.register(vm.runInNewContext(`(${overlay})`), () => null)
      // ui-workspace declares one flow hole per registration.
      const disposeBrowser = registry.register({ name: 'sidebar.workspaces', children: { [flow]: { kind: 'single', scope: 'root' } } }, () => null)
      const disposeHero = registry.register({ name: 'conversation.hero.workspace', children: { [hero]: { kind: 'single', scope: 'root' } } }, () => null)
      assert.equal(registry.entries(hero).length, 1, 'empty conversation must have a picker')
      assert.equal(registry.entries(flow).length, 1, 'history must share the DSH picker')
      disposeHero()
      disposeBrowser()
      disposeOverlay()
      assert.equal(registry.entries(hero).length, 0, 'paired picker retires with its owner')
    }
  } finally {
    await runtime.dispose()
    disposeRoot()
    await slotRuntime.dispose()
  }
  assert.match(source, /h\(ConversationOverlay, \{ renderSlot, useSessions, useWorkspaces \}\)/u)
  assert.match(source, /renderSlot\('sidebar\.workspaces', Object\.assign\(/u)
  assert.doesNotMatch(source, /services\??\.uiWorkspace\??\.pickDirectory/u)
})
