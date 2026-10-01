import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { desktopPnpmInvocation } from './toolchain.mjs'

test('runs Desktop-owned pnpm without an upstream root .bin shim', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lwb toolchain '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'apps', 'desktop')
  const pnpm = join(app, 'node_modules', 'pnpm')
  await mkdir(join(pnpm, 'bin'), { recursive: true })
  await writeFile(join(app, 'package.json'), '{"private":true}')
  await writeFile(join(pnpm, 'package.json'), '{"name":"pnpm","exports":"./package.json"}')
  await writeFile(join(pnpm, 'bin', 'pnpm.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))')
  for (const args of [['run', 'build'], ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'package', '--dir']]) {
    const invocation = desktopPnpmInvocation(app, args)
    assert.equal(invocation.command, process.execPath)
    assert.deepEqual(JSON.parse(execFileSync(invocation.command, invocation.args, { encoding: 'utf8' })), args)
  }
})

test('missing Desktop dependencies produce an actionable setup error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-no-pnpm-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => desktopPnpmInvocation(root, ['--version']), /npm run setup/)
})
