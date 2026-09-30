import { randomUUID } from 'node:crypto'
import { packCredentialRef } from './pack-workspaces.mjs'
import { PackTaskScope } from './pack-task-scope.mjs'
import { openPackSettings } from './pack-settings.mjs'

async function modelRouteAvailability(ctx, provider) {
  if (provider.id !== 'deepseek-official') return {}
  const unavailableReason = '未配置 DeepSeek API Key，请先在“设置 → 模型”中配置。'
  try {
    const route = ctx.llm.listConfigurableProviders().find((item) => item.provider === provider.id)
    const settings = ctx.get('settings')
    if (!route || !settings) throw new Error('Model settings unavailable')
    const namespace = settings.describe({ redactSecrets: true }).find((item) => item.ns === route.settingsNs)
    if (!namespace) throw new Error('Model route settings unavailable')
    const profile = route.settingsPath.reduce((value, key) => value?.[key], namespace.value)
    const ref = profile?.apiKeyEnv || 'DEEPSEEK_API_KEY'
    const status = await ctx.credentials.describe(ref)
    return status.configured ? { selectable: true } : { selectable: false, unavailableReason }
  } catch {
    return { selectable: false, unavailableReason: '无法确认 DeepSeek API Key 状态，请检查模型设置后刷新。' }
  }
}

/** Scoped services issued by the host to one actually mounted package. */
export class LwbPackServices {
  constructor(ctx, workspaces, { account, taskModel, entitlements } = {}) { this.ctx = ctx; this.workspaces = workspaces; this.scopes = new Map(); this.account = account; this.taskModel = taskModel; this.entitlements = entitlements }

  async mount(manifest) {
    await this.workspaces.activate(manifest)
    if (this.scopes.has(manifest.id)) return this.scopes.get(manifest.id)
    const { id } = manifest
    const tasks = new PackTaskScope()
    const sessions = new Map()
    const settings = new Map()
    const credentialRef = (purpose) => packCredentialRef(id, purpose)
    const credentials = Object.fromEntries(['resolve', 'describe', 'set', 'unset'].map((method) => [method, (ref, ...args) => {
      if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)) throw new Error('能力包凭据引用无效。')
      return this.ctx.credentials[method](credentialRef(ref.toLowerCase().replaceAll('_', '-')), ...args)
    }]))
    const facade = Object.freeze({
      id, credentialRef, credentials, signal: tasks.signal,
      assertAccess: () => this.assertAccess(manifest),
      modelSelection: () => this.defaultSelection(),
      models: Object.freeze({
        list: async () => Promise.all((this.ctx.llm?.listProviders?.() || []).map(async (provider) => ({
          ...provider,
          ...await modelRouteAvailability(this.ctx, provider),
          models: await this.ctx.llm.listModels(provider.id).catch(() => []),
        }))),
      }),
      account: Object.freeze({
        status: (service) => this.account?.serviceStatus(service) || Promise.resolve({ configured: false, authenticated: false, reason: 'LWB 账号服务不可用。' }),
        open: (service, options = {}) => {
          tasks.signal.throwIfAborted()
          if (!manifest.requiredServices?.includes(service)) throw new Error('能力包未声明此 LWB 服务。')
          if (!this.account) throw new Error('LWB 账号服务不可用。')
          return this.account.openService(service, { ...options, signal: options.signal ? AbortSignal.any([options.signal, tasks.signal]) : tasks.signal })
        },
      }),
      context: () => this.workspaces.context(id),
      settings: (name, validate) => this.workspaces.run(id, async (context) => {
        if (!settings.has(name)) settings.set(name, openPackSettings(context.workspacePath, name, validate).catch(error => { settings.delete(name); throw error }))
        const store = await settings.get(name)
        return Object.freeze({ get: store.get, update: patch => this.workspaces.run(id, () => store.update(patch)) })
      }),
      request: (operation) => this.workspaces.run(id, operation),
      background: (promise) => tasks.track(promise),
      onStop: (dispose) => tasks.addDisposer(dispose),
      fetch: (url, options = {}) => {
        tasks.signal.throwIfAborted()
        return globalThis.fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, tasks.signal]) : tasks.signal })
      },
      withAgent: (operation, signal = tasks.signal) => tasks.track(this.withAgent(id, operation, AbortSignal.any([signal, tasks.signal]))),
      // Long-lived, pack-owned DSH sessions. The pack chooses the model route
      // explicitly and owns the returned handle until it disposes the session.
      sessions: Object.freeze({
        create: (options = {}) => tasks.track(this.createSession(id, options, tasks.signal, sessions)),
        resume: (sessionId, options = {}) => tasks.track(this.resumeSession(id, sessionId, options, tasks.signal, sessions)),
        get: (sessionId) => sessions.get(sessionId)?.public || null,
      }),
      assertAgent: async (agent) => {
        const context = await this.workspaces.context(id)
        if (agent?.session?.header?.cwd !== context.workspacePath) throw new Error('此工具只供该能力包的内部任务使用。')
        return context
      },
    })
    this.workspaces.onStop(id, async () => {
      await tasks.stop()
      await Promise.allSettled([...sessions.values()].map((session) => session.dispose()))
      sessions.clear()
    })
    this.scopes.set(id, facade)
    return facade
  }

  forPack(id) {
    const scope = this.scopes.get(id)
    if (!scope) throw new Error('能力包运行上下文尚未准备好。')
    return scope
  }

  async unmount(id) {
    await this.workspaces.deactivate(id)
    this.scopes.delete(id)
  }

  // Model routing and authentication belong to DSH. This snapshot is refreshed
  // for each new internal Session, independently of the browser's active chat.
  defaultSelection() {
    const selected = this.taskModel ? this.taskModel.selection() : this.ctx.agentDefaultModel.currentSelection()
    if (typeof selected?.provider !== 'string' || !selected.provider.trim()
      || typeof selected?.model !== 'string' || !selected.model.trim()) return null
    return { provider: selected.provider, model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) }
  }

  async executionStatus(id) {
    this.forPack(id)
    // This checks selection only. Provider availability and authentication are
    // validated by native DSH execution (including non-API-key auth methods).
    return { configured: this.defaultSelection() !== null }
  }

  async assertAccess(manifest) {
    return this.entitlements?.assertAllowed(manifest) || { allowed: true, required: false, reason: null }
  }

  async withAgent(id, operation, signal) {
    signal.throwIfAborted()
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.defaultSelection()
    if (!selection) throw new Error('尚未选择场景任务模型，请在“设置 → 场景任务默认模型”中完成配置。')
    const preset = await this.ctx.agentPresets.resolve('standard')
    const sessionId = `lwb-pack-${id}-${randomUUID()}`
    await this.workspaces.recordSession(id, sessionId)
    const handle = await this.ctx.agents.create({
      sessionId, meta: { cwd: context.workspacePath, agentPreset: preset.id },
      agentOptions: selection, signal,
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
      },
    })
    try {
      signal.throwIfAborted()
      // Use the published handle: the preset setup Context does not inject
      // agent. No task is submitted until this policy is installed.
      this.ctx.permissionPresets.set(handle.agent.session, 'workspace-write')
      return await operation(handle.agent)
    } finally { await handle.dispose() }
  }

  async createSession(id, options = {}, signal, sessions) {
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.normalizeSelection(options, this.defaultSelection())
    const sessionId = typeof options.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim() : `lwb-pack-${id}-${randomUUID()}`
    return this.openSession(id, { sessionId, context, selection, signal, sessions, resume: false })
  }

  async resumeSession(id, sessionId, options = {}, signal, sessions) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('能力包会话标识无效。')
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.normalizeSelection(options, this.defaultSelection())
    return this.openSession(id, { sessionId: sessionId.trim(), context, selection, signal, sessions, resume: true })
  }

  normalizeSelection(options, fallback) {
    const candidate = options && typeof options === 'object' && (options.provider || options.model)
      ? options : fallback
    if (typeof candidate?.provider !== 'string' || !candidate.provider.trim()
      || typeof candidate?.model !== 'string' || !candidate.model.trim()) {
      throw new Error('尚未选择可用的模型，请先完成模型配置。')
    }
    return { provider: candidate.provider.trim(), model: candidate.model.trim(),
      ...(candidate.reasoningEffort === undefined ? {} : { reasoningEffort: candidate.reasoningEffort }) }
  }

  async openSession(id, { sessionId, context, selection, signal, sessions, resume }) {
    if (sessions.has(sessionId)) return sessions.get(sessionId).public
    await this.workspaces.recordSession(id, sessionId)
    const preset = await this.ctx.agentPresets.resolve('standard')
    signal.throwIfAborted()
    await this.ctx.sessionController.create({ sessionId, cwd: context.workspacePath, agentPreset: preset.id })
    await this.ctx.sessionController.selectModel({ sessionId, ...selection })
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw new Error(`会话 "${sessionId}" 创建后不可用。`)
    this.ctx.permissionPresets.set(agent.session, 'workspace-write')
    const session = {
      public: null,
      async dispose() {
        if (sessions.get(sessionId) !== session) return
        sessions.delete(sessionId)
      },
    }
    const address = Object.freeze({ kind: 'session', sessionId })
    session.public = Object.freeze({
      id: sessionId,
      address,
      provider: selection.provider,
      model: selection.model,
      followup: async (text) => {
        if (typeof text !== 'string' || !text.trim()) throw new Error('会话消息不能为空。')
        signal.throwIfAborted()
        return this.ctx.sessionController.prompt({
          requestId: randomUUID(), sessionId, mode: 'queue',
          content: [{ type: 'text', text: text.trim() }],
        }, signal)
      },
      whenIdle: async () => {
        const current = this.ctx.agents.get(sessionId)
        if (!current) throw new Error(`会话 "${sessionId}" 不可用。`)
        await current.whenIdle()
      },
      cancel: () => this.ctx.agents.get(sessionId)?.cancel({ kind: 'parent' }),
      dispose: () => session.dispose(),
      page: (request = {}, pageSignal = signal) => this.sessionPage(id, address, request, pageSignal),
      follow: (request = {}, followSignal = signal) => this.sessionFollow(id, address, request, followSignal),
    })
    sessions.set(sessionId, session)
    return session.public
  }

  assertSession(id, address) {
    if (!address || address.kind !== 'session' || typeof address.sessionId !== 'string') throw new Error('能力包会话地址无效。')
    const owned = this.workspaces.visibility(id)
    return owned.then((value) => {
      if (!value.sessionIds.includes(address.sessionId)) throw new Error('该会话不属于此能力包。')
      return address
    })
  }

  async sessionPage(id, address, request, signal) {
    await this.assertSession(id, address)
    if (!this.ctx.sessionController?.page) throw new Error('当前环境不提供会话读取服务。')
    return this.ctx.sessionController.page({ ...request, address }, signal)
  }

  async *sessionFollow(id, address, request, signal) {
    await this.assertSession(id, address)
    if (!this.ctx.sessionController?.follow) throw new Error('当前环境不提供会话流服务。')
    const observing = AbortSignal.any([signal, this.forPack(id).signal])
    yield* this.ctx.sessionController.follow({ ...request, address, assistantStream: true }, observing)
  }
}
