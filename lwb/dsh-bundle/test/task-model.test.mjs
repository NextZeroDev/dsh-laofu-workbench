import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTaskModel } from '../task-model.mjs'

test('scene model follows DSH by default, persists an independent choice and rejects unavailable models', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-task-model-')); t.after(() => rm(root, { force: true, recursive: true }))
  let dsh = { provider: 'official', model: 'default' }
  const ctx = { agentDefaultModel: { currentSelection: () => dsh }, llm: { listModels: async () => [{ id: 'lwb-fast' }], resolveCallConfig: async selection => selection } }
  const store = await openTaskModel(root, ctx)
  assert.deepEqual(store.get(), { mode: 'follow-dsh' })
  assert.deepEqual(store.selection(), dsh)
  await store.update({ mode: 'specified', provider: 'lwb', model: 'lwb-fast' })
  dsh = { provider: 'custom', model: 'another' }
  assert.deepEqual(store.selection(), { provider: 'lwb', model: 'lwb-fast' })
  assert.deepEqual((await openTaskModel(root, ctx)).selection(), store.selection())
  await assert.rejects(store.update({ mode: 'specified', provider: 'lwb', model: 'missing' }), /暂不可用/)
  await store.update({ mode: 'follow-dsh' })
  assert.deepEqual(store.selection(), dsh)
})
