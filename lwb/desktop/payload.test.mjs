import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assembleProductPayload } from './payload.mjs'

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-payload-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function writeFileAt(root, path, contents = 'export default {}\n') {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), contents)
}

async function listFiles(root, prefix = '') {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await listFiles(join(root, entry.name), path))
    else files.push(path)
  }
  return files.sort()
}

/** A project with product paths, one owned pack, and a pack that is not listed. */
async function fixtureProject(t) {
  const root = await temporaryRoot(t)
  await writeFileAt(root, 'lwb/dsh-bundle/index.mjs')
  await writeFileAt(root, 'lwb/dsh-bundle/node_modules/dep/index.js')
  await writeFileAt(root, 'lwb/dsh-bundle/test/ignored.test.mjs')
  await writeFileAt(root, 'lwb/pack-sdk/index.mjs')
  await writeFileAt(root, 'lwb/profile-setup.mjs')
  await writeFileAt(root, 'lwb/packs/pack-one/index.mjs')
  await writeFileAt(root, 'lwb/packs/pack-one/client.js')
  await writeFileAt(root, 'lwb/packs/pack-one/node_modules/dep/index.js')
  await writeFileAt(root, 'lwb/packs/pack-one/test/ignored.test.mjs')
  await writeFileAt(root, 'lwb/packs/pack-one/.git/config')
  // Present on disk but absent from the edition: it must not ship.
  await writeFileAt(root, 'lwb/packs/secret-pack/lwb-pack.json')
  await writeFileAt(root, 'lwb/packs/secret-pack/index.mjs')
  return root
}

test('only the listed edition packs reach the payload', async (t) => {
  const root = await fixtureProject(t)
  const payload = join(root, 'payload')
  await assembleProductPayload({
    projectRoot: root,
    edition: { packs: [{ id: 'pack-one', source: join(root, 'lwb', 'packs', 'pack-one') }] },
    payload,
  })
  assert.deepEqual(await listFiles(payload), [
    'lwb/dsh-bundle/index.mjs',
    'lwb/pack-sdk/index.mjs',
    'lwb/packs/pack-one/client.js',
    'lwb/packs/pack-one/index.mjs',
    'lwb/profile-setup.mjs',
  ])
})

test('dependencies, test trees and repository metadata never ship', async (t) => {
  const root = await fixtureProject(t)
  const payload = join(root, 'payload')
  await assembleProductPayload({
    projectRoot: root,
    edition: { packs: [{ id: 'pack-one', source: join(root, 'lwb', 'packs', 'pack-one') }] },
    payload,
  })
  const files = await listFiles(payload)
  for (const excluded of ['node_modules', '/test/', '.git']) {
    assert.ok(!files.some(file => file.includes(excluded)), `${excluded} must not ship, got ${files.join(', ')}`)
  }
})

test('a pack checked out elsewhere ships under its edition id', async (t) => {
  const root = await fixtureProject(t)
  const external = await temporaryRoot(t)
  await writeFileAt(external, 'lwb-pack.json')
  await writeFileAt(external, 'index.mjs')
  await writeFileAt(external, 'test/ignored.test.mjs')
  const payload = join(root, 'payload')
  const keys = []
  await assembleProductPayload({
    projectRoot: root,
    edition: { packs: [{ id: 'model-review', source: external }] },
    payload,
    onFile: (key) => { keys.push(key) },
  })
  assert.deepEqual(await listFiles(join(payload, 'lwb', 'packs', 'model-review')), ['index.mjs', 'lwb-pack.json'])
  assert.ok(keys.includes(join('packs', 'model-review', 'index.mjs')), `keys were ${keys.join(', ')}`)
  assert.ok(!keys.some(key => key.includes(external)), 'a build key must not embed the pack checkout location')
})

test('shipped keys are stable no matter where the pack is checked out', async (t) => {
  const first = await fixtureProject(t)
  const second = await fixtureProject(t)
  const keysOf = async (root) => {
    const keys = []
    await assembleProductPayload({
      projectRoot: root,
      edition: { packs: [{ id: 'pack-one', source: join(root, 'lwb', 'packs', 'pack-one') }] },
      payload: join(root, 'payload'),
      onFile: (key) => { keys.push(key) },
    })
    return keys.sort()
  }
  assert.deepEqual(await keysOf(first), await keysOf(second))
})