import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { assertUpstream, UPSTREAM } from '../upstream.mjs'

test('launch rejects a different commit and source edits before profile setup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-upstream-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  const version = UPSTREAM.tag.replace(/^dsh-v/u, '')
  for (const directory of ['', 'apps/cli', 'apps/desktop', 'apps/desktop-host']) {
    await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, directory, 'package.json'), JSON.stringify({ version }))
  }
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
  const commit = git('rev-parse', 'HEAD')
  const lock = { ...UPSTREAM, commit }
  assert.equal(assertUpstream(root, lock).version, version)
  assert.throws(() => assertUpstream(root, { ...lock, commit: '0'.repeat(40) }), /does not match/u)
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'broken' }))
  assert.throws(() => assertUpstream(root, lock), /must be unmodified/u)
})
