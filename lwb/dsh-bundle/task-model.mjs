import { openPackSettings } from './pack-settings.mjs'

export function validateTaskModel(value) {
  const mode = value.mode || 'follow-dsh'
  if (!['follow-dsh', 'specified'].includes(mode)) throw new Error('无效的场景任务模型模式。')
  if (mode === 'follow-dsh') return { mode }
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (!provider || !model || provider.length > 160 || model.length > 160) throw new Error('请选择场景任务使用的模型。')
  return { mode, provider, model, ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

export async function openTaskModel(root, ctx) {
  const store = await openPackSettings(root, 'task-model', validateTaskModel)
  return {
    get: store.get,
    selection() {
      const config = store.get()
      if (config.mode === 'follow-dsh') return ctx.agentDefaultModel.currentSelection()
      const { mode, ...selection } = config
      return selection
    },
    async update(request) {
      const next = validateTaskModel(request)
      if (next.mode === 'specified') {
        const models = await ctx.llm.listModels(next.provider)
        if (!models.some(model => model.id === next.model)) throw new Error('该场景任务模型暂不可用，请检查账号或模型配置。')
        await ctx.llm.resolveCallConfig(next)
      }
      await store.update(next)
      return store.get()
    },
  }
}
