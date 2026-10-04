import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { migrateRuntimePackRegistry } from './registry-migration.mjs'

test('migrates built-in pack registrations from an old runtime to the current runtime', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-registry-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const productHome = join(root, 'LaofuWorkbench')
  const currentRuntime = join(productHome, 'runtime', 'current-build')
  const oldSource = join(productHome, 'runtime', 'old-build', 'lwb', 'packs', 'spoken-video')
  const currentSource = join(currentRuntime, 'lwb', 'packs', 'spoken-video')
  await mkdir(currentSource, { recursive: true })
  const registryPath = join(productHome, 'packs.json')
  await writeFile(registryPath, JSON.stringify({ schemaVersion: 2, packs: [
    { id: 'spoken-video', packageName: '@example/spoken-video', source: oldSource, installedAt: '2026-01-01T00:00:00.000Z', enabled: true, manifest: { id: 'spoken-video', packageName: '@example/spoken-video' } },
    { id: 'external', packageName: '@example/external', source: join(root, 'external'), installedAt: '2026-01-01T00:00:00.000Z', enabled: true, manifest: { id: 'external', packageName: '@example/external' } },
  ] }))

  assert.equal(await migrateRuntimePackRegistry(registryPath, { productHome, currentRuntime }), true)
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.packs[0].source, currentSource)
  assert.equal(registry.packs[1].source, join(root, 'external'))
})

test('does not rewrite a runtime registration when the current pack is absent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-registry-migration-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const productHome = join(root, 'LaofuWorkbench')
  const registryPath = join(productHome, 'packs.json')
  const oldSource = join(productHome, 'runtime', 'old-build', 'lwb', 'packs', 'spoken-video')
  await mkdir(productHome, { recursive: true })
  await writeFile(registryPath, JSON.stringify({ schemaVersion: 2, packs: [{ id: 'spoken-video', packageName: '@example/spoken-video', source: oldSource, installedAt: '2026-01-01T00:00:00.000Z', enabled: true, manifest: { id: 'spoken-video', packageName: '@example/spoken-video' } }] }))
  assert.equal(await migrateRuntimePackRegistry(registryPath, { productHome, currentRuntime: join(productHome, 'runtime', 'current-build') }), false)
  assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).packs[0].source, oldSource)
})
