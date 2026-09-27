import { randomUUID } from 'node:crypto'
import { packCredentialRef } from './pack-workspaces.mjs'
import { PackTaskScope } from './pack-task-scope.mjs'
import { openPackSettings } from './pack-settings.mjs'

/** Scoped services issued by the host to one actually mounted package. */
export class LwbPackServices {
  constructor(ctx, workspaces, { account, taskModel } = {}) { this.ctx = ctx; this.workspaces = workspaces; this.scopes = new Map(); this.account = account; this.taskModel = taskModel }

  async mount(manifest) {
    await this.workspaces.activate(manifest)
    if (this.scopes.has(manifest.id)) return this.scopes.get(manifest.id)
    const { id } = manifest
    const tasks = new PackTaskScope()
    const settings = new Map()
    const credentialRef = (purpose) => packCredentialRef(id, purpose)
    const credentials = Object.fromEntries(['resolve', 'describe', 'set', 'unset'].map((method) => [method, (ref, ...args) => {
      if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)) throw new Error('能力包凭据引用无效。')
      return this.ctx.credentials[method](credentialRef(ref.toLowerCase().replaceAll('_', '-')), ...args)
    }]))
    const facade = Object.freeze({
      id, credentialRef, credentials, signal: tasks.signal,
      modelSelection: () => this.defaultSelection(),
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
      assertAgent: async (agent) => {
        const context = await this.workspaces.context(id)
        if (agent?.session?.header?.cwd !== context.workspacePath) throw new Error('此工具只供该能力包的内部任务使用。')
        return context
      },
    })
    this.workspaces.onStop(id, () => tasks.stop())
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
}
