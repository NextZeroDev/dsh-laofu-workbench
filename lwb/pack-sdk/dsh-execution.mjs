import { createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * Structured-output executor. It spawns a one-shot structured child through
 * the harness `subagents` seam and returns the captured structured output.
 * The service handle is captured from the pack's own declared `inject` —
 * Cordis contexts only expose services named there, so reaching through
 * `agent.ctx` is rejected. All model/credential/approval boundaries stay
 * inside DSH; the pack only supplies the prompt and schema. Topic
 * generation, script generation and account completion each receive one
 * instance.
 */
export function createDshExecutor(ctx, subagents, packId, label, structured, { maxTokenContinuations = 0, continuationPrompt } = {}) {
  return async function dshExecutor({ prompt, schema, agent, onDshStarted, onDshEvent, onDshContinuation, validate, repairPrompt, onDshRepair, maxRepairs = 2 }) {
    if (agent?.workspacePath) {
      return ctx.lwbPackServices.forPack(packId).withAgent((parent) => dshExecutor({ prompt, schema, agent: parent, onDshStarted, onDshEvent, onDshContinuation, validate, repairPrompt, onDshRepair, maxRepairs }))
    }
    if (!subagents || typeof subagents.start !== 'function') {
      throw new Error('当前环境不提供子代理执行接缝，无法执行生成任务。')
    }
    const controller = new AbortController()
    let childSessionId = null
    let continuationCount = 0
    let continuationFailure = null
    const continuedTurns = new Set()
    let traceTail = Promise.resolve()
    const recordEvent = (event) => {
      if (!onDshEvent) return
      traceTail = traceTail.then(() => Promise.resolve(onDshEvent(event)).catch(() => {}))
    }
    let run
    const runSignal = ctx.lwbPackServices ? AbortSignal.any([controller.signal, ctx.lwbPackServices.forPack(packId).signal]) : controller.signal
    const cancelChild = () => run?.localAgent?.cancel?.({ kind: 'parent' })
    const observeEvent = (session, event) => {
      if (!childSessionId || session.id !== childSessionId) return
      recordEvent(event)
      if (structured || event?.type !== 'turn/end' || event.data?.reason?.kind !== 'max-tokens') return
      const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : `seq-${event.seq}`
      if (continuedTurns.has(turn)) return
      continuedTurns.add(turn)
      if (continuationCount >= maxTokenContinuations) return
      const child = run?.localAgent
      if (!child || typeof child.followup !== 'function') {
        continuationFailure = new Error('当前子代理运行方式不支持在同一 DSH 会话中继续生成。')
        return
      }
      continuationCount += 1
      const text = continuationPrompt({ attempt: continuationCount, maximum: maxTokenContinuations })
      try {
        child.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: packId },
        }))
        if (onDshContinuation) {
          traceTail = traceTail.then(() => Promise.resolve(onDshContinuation({
            childSessionId: String(childSessionId),
            attempt: continuationCount,
            maximum: maxTokenContinuations,
          })).catch(() => {}))
        }
      } catch (error) {
        continuationFailure = error instanceof Error ? error : new Error(String(error))
      }
    }
    const disposeSessionEvent = ctx.on('session/event', observeEvent, { global: true })
    try {
      run = await subagents.start('spawn', {
        label,
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        // Preserve the task's captured route, including across child repairs.
        ...(agent?.options?.provider && agent?.options?.model ? { agentOptions: { provider: agent.options.provider, model: agent.options.model, ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }) } } : {}),
        signal: runSignal,
        ...(structured ? { outputSchema: schema } : {}),
      })
      childSessionId = run.id
      if (onDshStarted) {
        await Promise.resolve(onDshStarted({
          childSessionId: String(run.id),
          parentSessionId: typeof agent?.id === 'string' ? agent.id : null,
        })).catch(() => {})
      }
      // The one-shot run begins immediately after publication. Replay the in-memory prefix so
      // the audit timeline cannot miss an early turn or step before the listener observes it.
      const prefix = Array.isArray(run.localAgent?.session?.events) ? [...run.localAgent.session.events] : []
      prefix.forEach((event) => observeEvent(run.localAgent.session, event))
      let result = await run.result
      await traceTail
      if (continuationFailure) throw continuationFailure
      if (result.stopReason !== 'completed') {
        if (!structured && result.stopReason === 'max-tokens' && maxTokenContinuations > 0) {
          throw new Error(`视频 Agent 连续 ${continuationCount + 1} 个创作轮次达到单次输出上限，未能完成可渲染工程。`)
        }
        const detail = result.diagnostic ? `：${result.diagnostic}` : ''
        throw new Error(`生成未正常结束（${result.stopReason}）${detail}`)
      }
      // The driver keeps the published local child alive until dispose(). A repair
      // is another turn in that same session, after the first result has settled.
      if (!structured && validate) {
        runSignal.addEventListener('abort', cancelChild, { once: true })
        const maximum = Math.max(0, Math.min(2, Number.isSafeInteger(maxRepairs) ? maxRepairs : 2))
        for (let attempt = 0; ; attempt += 1) {
          runSignal.throwIfAborted()
          const report = await validate()
          runSignal.throwIfAborted()
          if (report.passed || report.repairable !== true || attempt >= maximum) break
          const child = run.localAgent
          if (!child?.followup || !child?.whenIdle || !repairPrompt) break
          const boundary = child.session.events.length
          await onDshRepair?.({ attempt: attempt + 1, maximum, failures: report.failures, childSessionId: String(run.id) })
          runSignal.throwIfAborted()
          child.followup(createUserMessage({
            content: [{ type: 'text', text: repairPrompt({ report, attempt: attempt + 1, maximum }) }],
            source: { kind: 'plugin', plugin: packId },
          }))
          await child.whenIdle()
          await traceTail
          runSignal.throwIfAborted()
          if (continuationFailure) throw continuationFailure
          const events = child.session.events.slice(boundary)
          const end = events.findLast((event) => event.type === 'turn/end')
          if (end?.data?.reason?.kind !== 'completed') throw new Error(`视频修复未正常结束（${end?.data?.reason?.kind || 'unknown'}）`)
          result = { ...result, output: events.filter((event) => event.type === 'assistant/message').at(-1)?.data?.message?.content || [] }
        }
      }
      return structured
        ? result.structured
        : { childSessionId: String(run.id), output: result.output }
    } finally {
      runSignal.removeEventListener('abort', cancelChild)
      disposeSessionEvent()
      await run?.dispose().catch(() => {})
    }
  }
}
