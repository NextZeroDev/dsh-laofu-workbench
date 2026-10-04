import { LlmAdapter, LlmError, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

// Use published DSH/pi-ai APIs. No upstream files or user provider settings are edited.
const ROUTE = 'lwb'
const INTERACTIVE_MAX_TOKENS = 32768
const retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'LWB')
const effectiveMaxTokens = item => Math.min(Number.isInteger(item.maxOutputTokens) ? item.maxOutputTokens : INTERACTIVE_MAX_TOKENS, INTERACTIVE_MAX_TOKENS)

export class LwbModelAdapter extends LlmAdapter {
  constructor(client, ctx) { super(); this.client = client; this.ctx = ctx }
  providerInfo() { return { id: ROUTE, name: 'LWB 模型服务' } }
  providerRetryPolicy() { return retryPolicy }
  async listModels() {
    if (!await this.client.readSession()) return []
    return (await this.client.catalog()).models.filter(item => item.available).map(item => this.info(item))
  }
  info(item) {
    const maxOutputTokens = effectiveMaxTokens(item)
    return { provider: ROUTE, id: item.id, name: item.name, inputModalities: item.supportsVision ? ['text', 'image'] : ['text'], context: { contextWindow: item.contextWindow }, maxOutputTokens, defaultMaxTokens: maxOutputTokens }
  }
  async resolveModel(provider, model) {
    if (provider !== ROUTE) throw new LlmError('无效的 LWB 模型来源。', 'NO_ADAPTER')
    const item = (await this.client.catalog()).models.find(value => value.id === model)
    if (!item?.available) throw new LlmError(item?.reason || 'LWB 模型暂不可用。', 'UNKNOWN_MODEL')
    return this.info(item)
  }
  async prepareCall(provider, model) {
    const generation = this.client.generation
    const info = await this.resolveModel(provider, model)
    this.client.assertGeneration(generation)
    return { model: info, stream: options => this.streamBound(options, generation) }
  }
  stream(options) { return this.streamBound(options, this.client.generation) }
  async *streamBound(options, generation) {
    const assertCurrent = () => { if (generation !== this.client.generation) throw new LlmError('LWB 账号已变更，请重新发起请求。', 'MISSING_CREDENTIAL') }
    assertCurrent()
    const catalog = await this.client.catalog()
    const item = catalog.models.find(entry => entry.id === options.model)
    if (!item?.available) throw new LlmError(item?.reason || 'LWB 模型暂不可用。', 'UNKNOWN_MODEL')
    if (options.tools?.length && !item.supportsTools) throw new LlmError('该 LWB 档位尚未开放工具调用，请先在 ATS 配置模型能力。', 'UNSUPPORTED_OPTION')
    const credential = await this.client.serviceCredential()
    assertCurrent()
    const baseUrl = `${this.client.baseUrl}/api/lwb/v1`
    const maxTokens = effectiveMaxTokens(item)
    const model = { id: item.id, name: item.name, api: 'openai-completions', provider: ROUTE, baseUrl, reasoning: false, input: item.supportsVision ? ['text', 'image'] : ['text'], contextWindow: item.contextWindow, maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } }
    const api = openAICompletionsApi()
    const piProvider = { id: ROUTE, name: 'LWB 模型服务', baseUrl, auth: { apiKey: { name: 'LWB', resolve: async ({ credential: key }) => ({ auth: { apiKey: key?.key }, source: 'LWB' }) } }, getModels: () => [model], stream: (...args) => api.stream(...args), streamSimple: (...args) => api.streamSimple(...args) }
    const profiles = new Map([[ROUTE, { provider: ROUTE, displayName: 'LWB 模型服务', api: 'openai-completions', baseURL: baseUrl, streamIdleTimeoutMs: 90000, maxRequestImageBytes: 20 * 1024 * 1024, requestImagePixelBudget: 20000000, requestImageMaxBytes: 10 * 1024 * 1024, retryPolicy, piProvider, modelErrors: new Map(), configuredMaxTokens: new Map([[item.id, maxTokens]]) }]])
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async () => { assertCurrent(); return credential.apiKey },
      auth: { credentials: { get: async () => undefined, list: async () => [], set: async () => { throw new Error('LWB 凭据由宿主管理。') }, delete: async () => {} }, authContext: { getEnv: () => undefined } },
      resolveAttachments: () => this.ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => this.ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    })
    const signal = options.signal ? AbortSignal.any([options.signal, this.client.serviceAbort.signal]) : this.client.serviceAbort.signal
    try {
      for await (const chunk of adapter.stream({ ...options, signal })) {
        if (chunk.type === 'finish' && chunk.reason?.failure?.code === 'AUTH') await this.client.discardServiceCredential(generation)
        yield chunk
      }
    } finally { this.client.changed('usage') }
  }
}

export function registerLwbModels(ctx, client) {
  const adapter = new LwbModelAdapter(client, ctx)
  ctx.llm.registerAdapter([ROUTE], adapter)
  ctx.effect(() => client.subscribe(kind => { if (kind === 'account' || kind === 'catalog') ctx.emit('llm/adapters-updated') }), 'lwb-model: account changes')
  return adapter
}
