import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from '@babel/parser'
import { applyLwbEntryPolicy, installLwbEntryPolicy } from './entry-policy.mjs'

const upstream = await readFile(new URL('../../vendor/deepseek-harness/apps/desktop/lib/main.js', import.meta.url), 'utf8')

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findNode(child, predicate)
      if (found) return found
    }
  }
}

function desktopFlow(source) {
  const ast = parse(source, { sourceType: 'module' })
  const code = (predicate) => {
    const node = findNode(ast, predicate)
    assert.ok(node, 'the pinned native entry flow must exist')
    return source.slice(node.start, node.end)
  }
  const decision = code(node => node.type === 'FunctionDeclaration' && node.id?.name === 'needsWelcome')
  const watch = code(node => node.type === 'CallExpression' && node.callee?.object?.name === 'accountBackend' && node.callee.property?.name === 'watch')
  const initial = code(node => node.type === 'VariableDeclarator' && node.id?.name === 'openInitialWindow')
  let changed, expired
  const effects = { welcome: 0, workspace: 0, focused: 0, external: [] }
  const context = vm.createContext({
    quitting: false, welcomeWindow: undefined, previousAccountStatus: undefined,
    openedAttempt: undefined, returnedAttempt: undefined, pendingWelcomeNotice: undefined,
    enteredWorkspace: true, recovery: { active: false }, backend: { state: { phase: 'ready' } },
    locale: undefined, windowsLanguage: undefined, systemLanguages: ['en'], raiseAfterUpdate: false,
    isQuitting: () => false, resolveDesktopStartupLocale: () => ({ id: 'en' }), refreshApplicationMenu() {},
    readWelcomeState: async () => ({ loggedIn: false, hasApiKey: false, localePreference: null }),
    showWelcome: async () => { effects.welcome++ },
    enterWorkspace: async () => { effects.workspace++; context.enteredWorkspace = true },
    focusPrimaryWindow: () => { effects.focused++ },
    platformLoginUrl: value => value,
    shell: { openExternal: async value => { effects.external.push(value) } },
    accountBackend: {
      state: async () => ({ status: 'signed-out', attempt: null }),
      watch(listener, _failed, expiry) { changed = listener; expired = expiry },
    },
  })
  vm.runInContext(`${decision}\n${watch};\nconst ${initial};`, context)
  return {
    effects, context,
    changed: async state => { changed(state); await new Promise(resolve => setImmediate(resolve)) },
    expired: async () => { expired(); await new Promise(resolve => setImmediate(resolve)) },
    initial: () => vm.runInContext('openInitialWindow()', context),
  }
}

test('LWB keeps the native workspace on logout and credential expiry without an API key', async () => {
  // The original main reproduces the reported transition; the adapted one must not.
  for (const [source, expectedWelcome] of [[upstream, 1], [applyLwbEntryPolicy(upstream), 0]]) {
    const flow = desktopFlow(source)
    await flow.changed({ status: 'credential-stored', attempt: null })
    await flow.changed({ status: 'signed-out', attempt: null })
    assert.equal(flow.effects.welcome, expectedWelcome)
    assert.equal(flow.context.enteredWorkspace, expectedWelcome === 0)
    assert.equal(flow.effects.workspace, 0, 'sign-out must not reload the workspace')
    await flow.expired()
    assert.equal(flow.effects.welcome, expectedWelcome * 2)
  }
})

test('anonymous Desktop startup enters LWB directly', async () => {
  const flow = desktopFlow(applyLwbEntryPolicy(upstream))
  flow.context.enteredWorkspace = false
  await flow.initial()
  assert.equal(flow.effects.welcome, 0)
  assert.equal(flow.effects.workspace, 1)
})

test('the official login observer still opens authorization once and handles failure and success', async () => {
  const flow = desktopFlow(applyLwbEntryPolicy(upstream))
  const attempt = { id: 'test-attempt', phase: 'waiting-browser', authorizeUrl: 'https://example.invalid/authorize' }
  await flow.changed({ status: 'signed-out', attempt })
  await flow.changed({ status: 'signed-out', attempt })
  assert.deepEqual(flow.effects.external, [attempt.authorizeUrl])
  await flow.changed({ status: 'signed-out', attempt: { ...attempt, phase: 'failed' } })
  assert.equal(flow.effects.focused, 1)
  await flow.changed({ status: 'credential-stored', attempt: { ...attempt, phase: 'succeeded' } })
  assert.equal(flow.effects.welcome, 0)
  assert.equal(flow.effects.workspace, 0, 'successful login retains the existing LWB page')
})

test('the welcome adapter rejects upstream boundary drift', () => {
  assert.throws(() => applyLwbEntryPolicy(upstream.replace('!authentication.loggedIn &&', '!authentication.loggedIn ||')), /does not match/)
  assert.throws(() => applyLwbEntryPolicy(`${upstream}\nneedsWelcome({});`), /does not match/)
  assert.throws(() => applyLwbEntryPolicy(applyLwbEntryPolicy(upstream)), /does not match/)
})

test('the load hook changes only its exact entry and never rewrites files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-entry-loader-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = 'function needsWelcome(authentication) {\nreturn !authentication.loggedIn && !authentication.hasApiKey;\n}\n' +
    'export const states = [needsWelcome({}), needsWelcome({loggedIn:true}), needsWelcome({hasApiKey:true})];'
  const entry = join(root, 'main.mjs')
  const other = join(root, 'other.mjs')
  await writeFile(entry, source)
  await writeFile(other, source)
  const hook = installLwbEntryPolicy(pathToFileURL(entry))
  t.after(() => hook.deregister())
  assert.deepEqual((await import(pathToFileURL(other))).states, [true, false, false])
  assert.deepEqual((await import(pathToFileURL(entry))).states, [false, false, false])
  assert.equal(await readFile(entry, 'utf8'), source)
  assert.equal(await readFile(other, 'utf8'), source)
})
