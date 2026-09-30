import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LwbPackServices } from '../pack-services.mjs'
import { LwbPackWorkspaces } from '../pack-workspaces.mjs'

const manifest = (id) => ({ id, packageName: `@test/${id}`, name: id })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-services-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const keys = new Map([['BAILIAN_API_KEY', 'ordinary-secret']])
  const settings = { providers: { ordinary: { apiKeyEnv: 'BAILIAN_API_KEY' } } }
  const calls = []
  const sessionAgents = new Map()
  let selection = { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' }
  const ctx = {
    agentDefaultModel: { currentSelection: () => selection },
    credentials: {
      resolve: async (ref) => ({ value: keys.get(ref) }),
      describe: async (ref) => ({ configured: keys.has(ref) }),
      set: async (ref, value) => keys.set(ref, value), unset: async (ref) => keys.delete(ref),
    },
    settings: {
      get: () => settings,
      register: (name) => name,
      mutate: async (ns, ops) => { assert.equal(ns, 'llm-pi-ai'); for (const op of ops) settings.providers[op.path[1]] = op.value },
    },
    agentPresets: { resolve: async () => ({ id: 'standard' }), mount: async (_, id) => calls.push(['preset', id]) },
    permissionPresets: { set: (_, value) => calls.push(['permission', value]) },
    agents: {
      create: async (options) => {
        const owned = await workspaces.visibility()
        assert.ok(owned.sessionIds.includes(options.sessionId), 'ownership must be durable before Agent publication')
        calls.push(['create', options])
        const agent = { session: { header: { cwd: options.meta.cwd } } }
        // The real setup Context deliberately does not inject `agent`.
        await options.setup({})
        return { agent, dispose: async () => calls.push(['dispose']) }
      },
      get: (sessionId) => sessionAgents.get(sessionId),
    },
    sessionController: {
      async create(options) {
        const owned = await workspaces.visibility()
        assert.ok(owned.sessionIds.includes(options.sessionId), 'ownership must be durable before Session publication')
        calls.push(['session.create', options])
        let agent = sessionAgents.get(options.sessionId)
        if (!agent) {
          agent = {
            id: options.sessionId,
            session: { header: { cwd: options.cwd } },
            whenIdle: async () => calls.push(['session.idle', options.sessionId]),
            cancel: (reason) => calls.push(['session.cancel', options.sessionId, reason]),
          }
          sessionAgents.set(options.sessionId, agent)
        }
        return { sessionId: options.sessionId, agentPreset: options.agentPreset }
      },
      async selectModel(options) {
        calls.push(['session.selectModel', options])
        return { selected: options }
      },
      async prompt(options) {
        calls.push(['session.prompt', options])
        return { accepted: true }
      },
    },
  }
  const workspaces = new LwbPackWorkspaces({ root })
  const services = new LwbPackServices(ctx, workspaces)
  const first = await services.mount(manifest('spoken-video'))
  const second = await services.mount(manifest('another-pack'))
  return { root, ctx, keys, settings, calls, sessionAgents, services, workspaces, first, second, setSelection: (value) => { selection = value } }
}

test('data access needs no Agent; directories, credentials and settings are isolated', async (t) => {
  const { first, second, calls, keys } = await setup(t)
  assert.notEqual((await first.context()).workspacePath, (await second.context()).workspacePath)
  await first.request(async (context) => writeFile(join(context.workspacePath, 'data'), 'first'))
  assert.equal(calls.length, 0)
  assert.equal((await first.credentials.describe('BAILIAN_API_KEY')).configured, false)
  await first.credentials.set('BAILIAN_API_KEY', 'first-secret')
  assert.equal((await second.credentials.describe('BAILIAN_API_KEY')).configured, false)
  assert.equal((await first.credentials.resolve('BAILIAN_API_KEY')).value, 'first-secret')
  assert.equal(keys.get('BAILIAN_API_KEY'), 'ordinary-secret')
  const firstSettings = await first.settings('media', input => ({ voice: '', ...input }))
  const secondSettings = await second.settings('media', input => ({ voice: '', ...input }))
  await firstSettings.update({ voice: 'first' })
  assert.equal(secondSettings.get().voice, '')
  await assert.rejects(first.assertAgent({ session: { header: { cwd: (await second.context()).workspacePath } } }), /此工具/)
})

test('model catalog marks only the unconfigured DeepSeek API route unavailable', async (t) => {
  const { first, ctx, keys } = await setup(t)
  let ref = 'CUSTOM_DEEPSEEK_KEY'
  ctx.get = (name) => name === 'settings' ? {
    describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: ref } }],
  } : undefined
  ctx.llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'deepseek-account', name: 'DeepSeek Account' }],
    listConfigurableProviders: () => [{ provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
  }
  let groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  assert.match(groups[0].unavailableReason, /API Key/)
  assert.equal(groups[1].selectable, undefined)
  keys.set(ref, 'configured')
  groups = await first.models.list()
  assert.equal(groups[0].selectable, true)
  ref = 'ANOTHER_KEY'
  groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  ctx.credentials.describe = async () => { throw new Error('credential service unavailable') }
  groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  assert.match(groups[0].unavailableReason, /无法确认/)
})

test('AI roots use DSH defaults without pack model credentials and keep owned cwd and permissions', async (t) => {
  const { first, second, calls, services, ctx, settings, keys } = await setup(t)
  // Authentication belongs to the DSH adapter, including OAuth/environment
  // discovery. The pack must neither inspect nor rewrite model credentials.
  ctx.credentials = new Proxy({}, { get() { throw new Error('pack must not touch DSH model authentication') } })
  const originalSettings = structuredClone(settings)
  const originalKeys = [...keys]
  assert.equal((await services.executionStatus(first.id)).configured, true)
  assert.equal((await services.executionStatus(second.id)).configured, true)
  await assert.rejects(first.withAgent(() => { throw new Error('job failed') }), /job failed/)
  const options = calls.find(([kind]) => kind === 'create')[1]
  assert.deepEqual(options.agentOptions, { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' })
  assert.equal(options.meta.cwd, (await first.context()).workspacePath)
  assert.deepEqual(calls.filter(([kind]) => kind !== 'create'), [['preset', 'standard'], ['permission', 'workspace-write'], ['dispose']])
  assert.deepEqual(settings, originalSettings)
  assert.deepEqual([...keys], originalKeys)
})

test('new pack sessions follow updated DSH defaults while each in-flight session keeps its snapshot', async (t) => {
  const { first, second, calls, settings, setSelection } = await setup(t)
  settings.providers['lwb-pack-spoken-video'] = { apiKeyEnv: 'STALE_PACK_KEY', models: [{ id: 'stale-pack-model' }] }
  const entered = deferred(), finish = deferred()
  const inFlight = first.withAgent(async () => { entered.resolve(); await finish.promise })
  await entered.promise
  setSelection({ provider: 'updated-dsh', model: 'new-default' })
  await second.withAgent(() => {})
  await first.withAgent(() => {})
  const roots = calls.filter(([kind]) => kind === 'create').map(([, options]) => options)
  assert.deepEqual(roots.map((options) => options.agentOptions), [
    { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' },
    { provider: 'updated-dsh', model: 'new-default' },
    { provider: 'updated-dsh', model: 'new-default' },
  ])
  assert.notEqual(roots[0].meta.cwd, roots[1].meta.cwd)
  assert.equal(roots[0].meta.cwd, roots[2].meta.cwd)
  finish.resolve(); await inFlight
})

test('missing selection points to scene model settings; native execution errors propagate unchanged', async (t) => {
  const { first, services, setSelection, calls, ctx } = await setup(t)
  setSelection(null)
  assert.equal((await services.executionStatus(first.id)).configured, false)
  await assert.rejects(first.withAgent(() => {}), /场景任务默认模型/)
  assert.equal(calls.length, 0)
  setSelection({ provider: 'ordinary', model: 'dsh-default' })
  const failure = Object.assign(new Error('DSH provider credentials unavailable'), { code: 'MISSING_CREDENTIAL' })
  ctx.agents.create = async () => { throw failure }
  await assert.rejects(first.withAgent(() => {}), (error) => error === failure)
})

test('independent scene model governs all pack roots without modifying DSH defaults', async t => {
  const { services, first, second, calls, ctx } = await setup(t)
  services.taskModel = { selection: () => ({ provider: 'lwb', model: 'lwb-fast' }) }
  await first.withAgent(() => {})
  await second.withAgent(() => {})
  assert.deepEqual(calls.filter(([kind]) => kind === 'create').map(([, options]) => options.agentOptions), [{ provider: 'lwb', model: 'lwb-fast' }, { provider: 'lwb', model: 'lwb-fast' }])
  assert.equal(ctx.agentDefaultModel.currentSelection().model, 'dsh-default')
})

test('pack sessions use the official controller and remain resumable after facade disposal', async t => {
  const { first, calls, ctx } = await setup(t)
  const session = await first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash' })
  const create = calls.find(([kind]) => kind === 'session.create')
  assert.equal(create[1].sessionId, session.id)
  assert.equal(create[1].cwd, (await first.context()).workspacePath)
  assert.equal(create[1].agentPreset, 'standard')
  assert.deepEqual(calls.find(([kind]) => kind === 'session.selectModel')[1], {
    sessionId: session.id,
    provider: 'deepseek-account',
    model: 'deepseek-flash',
  })

  await session.followup('  test prompt  ')
  const prompt = calls.find(([kind]) => kind === 'session.prompt')[1]
  assert.equal(prompt.sessionId, session.id)
  assert.equal(prompt.mode, 'queue')
  assert.deepEqual(prompt.content, [{ type: 'text', text: 'test prompt' }])
  assert.match(prompt.requestId, /^[0-9a-f-]{36}$/u)
  await session.whenIdle()
  session.cancel()
  assert.deepEqual(calls.find(([kind]) => kind === 'session.idle'), ['session.idle', session.id])
  assert.deepEqual(calls.find(([kind]) => kind === 'session.cancel'), ['session.cancel', session.id, { kind: 'parent' }])

  const officialAgent = ctx.agents.get(session.id)
  await session.dispose()
  assert.equal(first.sessions.get(session.id), null)
  assert.equal(ctx.agents.get(session.id), officialAgent, 'disposing the pack facade must not destroy the official Session')

  const resumed = await first.sessions.resume(session.id, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(resumed.id, session.id)
  assert.equal(calls.filter(([kind]) => kind === 'session.create').length, 2)
  await resumed.whenIdle()
})

test('pack sessions can own one directory each below the pack workspace', async (t) => {
  const { first, calls } = await setup(t)
  const workspacePath = (await first.context()).workspacePath
  const session = await first.sessions.create({
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-1',
  })
  const created = calls.find(([kind]) => kind === 'session.create')[1]
  assert.equal(created.cwd, join(workspacePath, 'runs', 'task-1', 'run-1'))
  assert.equal(session.cwd, created.cwd)
  await writeFile(join(created.cwd, 'answer.txt'), 'run one')
  assert.equal(await readFile(join(created.cwd, 'answer.txt'), 'utf8'), 'run one')

  const second = await first.sessions.create({
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-2',
  })
  assert.equal(second.cwd, join(workspacePath, 'runs', 'task-1', 'run-2'))
  await assert.rejects(readFile(join(second.cwd, 'answer.txt'), 'utf8'), { code: 'ENOENT' })

  const resumed = await first.sessions.resume(second.id, {
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-2',
  })
  assert.equal(calls.filter(([kind]) => kind === 'session.create').at(-1)[1].cwd, second.cwd)
  assert.equal(resumed.cwd, second.cwd)

  const escaped = []
  for (const cwd of ['..', '../outside', '/tmp/lwb-escape', 'runs/../../outside', 'runs/./inner', 'runs/', 'runs//inner', '.hidden', 'a\\b']) {
    escaped.push(await first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash', cwd })
      .then(() => undefined, (error) => error))
  }
  const outside = await import('node:fs/promises').then((module) => module.lstat(join(workspacePath, '..', 'outside')).then(() => true, () => false))
  assert.equal(outside, false, 'a rejected cwd must never create a directory outside the pack workspace')
  for (const [index, error] of escaped.entries()) {
    assert.ok(error, `cwd ${index} must be rejected`)
    assert.match(String(error.code || error.message), /PACK_WORKSPACE_INVALID|PACK_WORKSPACE_UNSAFE/, `cwd ${index} reported ${error.message}`)
  }
  await assert.rejects(first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash', cwd: 7 }), /会话工作目录必须是能力包工作区内的相对路径/u)
})

test('unload waits for late background final writes admitted by an in-flight request', async (t) => {
  const { first, second, services, workspaces } = await setup(t)
  const entered = deferred(), release = deferred(), backgroundStarted = deferred(), finish = deferred()
  const path = join((await first.context()).workspacePath, 'final')
  const request = first.request(async () => {
    entered.resolve(); await release.promise
    first.background((async () => { backgroundStarted.resolve(); await finish.promise; await writeFile(path, 'settled') })())
  })
  await entered.promise
  let stopped = false
  const stopping = services.unmount(first.id).then(() => { stopped = true })
  await new Promise((resolve) => setImmediate(resolve))
  release.resolve(); await request; await backgroundStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stopped, false)
  await assert.rejects(workspaces.clearData(first.id), { code: 'PACK_WORKSPACE_BUSY' })
  assert.equal(second.signal.aborted, false)
  finish.resolve(); await stopping
  assert.equal(await readFile(path, 'utf8'), 'settled')
  assert.equal(first.signal.aborted, true)
  await assert.rejects(first.request(() => {}), { code: 'PACK_WORKSPACE_INACTIVE' })
  const replacement = await services.mount(manifest(first.id))
  assert.equal(replacement.signal.aborted, false)
})

test('stopping a pack cancels its HTTP and explicit-signal AI operations only', async (t) => {
  const { first, second, services } = await setup(t)
  await services.unmount(first.id)
  assert.throws(() => first.fetch('http://127.0.0.1:1'), /停止/)
  await assert.rejects(first.withAgent(() => {}, new AbortController().signal), /停止/)
  assert.equal(second.signal.aborted, false)
})


test('settings share one writer per scope and cannot write after unload', async t => {
  const { first, services } = await setup(t)
  const validate = input => ({ left: 0, right: 0, ...input })
  const [a, b] = await Promise.all([first.settings('media', validate), first.settings('media', validate)])
  await Promise.all([a.update({ left: 1 }), b.update({ right: 2 })])
  assert.deepEqual(a.get(), { left: 1, right: 2 })
  assert.deepEqual(b.get(), a.get())
  await services.unmount(first.id)
  await assert.rejects(a.update({ left: 3 }))
})
