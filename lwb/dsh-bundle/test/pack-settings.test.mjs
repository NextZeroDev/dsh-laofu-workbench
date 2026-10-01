import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPackSettings } from '../pack-settings.mjs'
const validate = input => {
  const next = { count: 0, label: '', ...input }
  if (!Number.isInteger(next.count) || next.count < 0) throw new Error('Invalid count')
  return next
}
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-settings-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('pack settings persist concurrent patches and recover after validation errors', async t => {
  const root = await workspace(t)
  const store = await openPackSettings(root, 'media', validate)
  await Promise.all([store.update({ count: 2 }), store.update({ label: 'voice' })])
  await assert.rejects(store.update({ count: -1 }), /Invalid count/u)
  assert.deepEqual(store.get(), { count: 2, label: 'voice' })
  await store.update({ count: 3 })
  const reopened = await openPackSettings(root, 'media', validate)
  assert.deepEqual(reopened.get(), { count: 3, label: 'voice' })
  const snapshot = reopened.get(); snapshot.count = 10
  assert.equal(reopened.get().count, 3)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'settings/media.json'), 'utf8')), reopened.get())
})
test('settings reject path traversal and symlink storage', async t => {
  const root = await workspace(t)
  const outside = await workspace(t)
  await assert.rejects(openPackSettings(root, '../outside', validate), /Invalid/u)
  await symlink(outside, join(root, 'settings'), 'dir')
  await assert.rejects(openPackSettings(root, 'media', validate), /symlink/u)
  await rm(join(root, 'settings'))
  await mkdir(join(root, 'settings'))
  await symlink(join(outside, 'missing.json'), join(root, 'settings/media.json'))
  await assert.rejects(openPackSettings(root, 'media', validate), /Invalid/u)
})
