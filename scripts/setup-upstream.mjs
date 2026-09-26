import { existsSync } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'vendor', 'deepseek-harness')
const lock = JSON.parse(await readFile(join(root, 'lwb', 'UPSTREAM.lock.json'), 'utf8'))

const run = (cmd, args, cwd = root) => new Promise((resolveRun, reject) => {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${cmd} exited with code ${code}`)))
})

const git = (...args) => execFileSync('git', ['-C', vendor, ...args], { encoding: 'utf8' }).trim()
if (existsSync(vendor) && git('status', '--porcelain', '--untracked-files=normal')) {
  throw new Error('Official DSH has local source changes. Preserve them before setup; no files were reset.')
}
if (existsSync(vendor) && git('rev-parse', 'HEAD') !== lock.commit) {
  const backup = join(root, '.tooling', `dsh-before-${Date.now()}`)
  await mkdir(join(root, '.tooling'), { recursive: true })
  await rename(vendor, backup)
  console.log(`Previous DSH preserved at ${backup}`)
}
if (!existsSync(vendor)) {
  await mkdir(join(root, 'vendor'), { recursive: true })
  await run('git', ['clone', '--no-checkout', lock.repository, vendor])
  await run('git', ['-C', vendor, 'checkout', '--detach', lock.commit])
}
if (git('rev-parse', 'HEAD') !== lock.commit) throw new Error('DSH checkout does not match the lock')
await run('corepack', ['pnpm', 'install', '--frozen-lockfile'], vendor)
await run('corepack', ['pnpm', 'run', 'build'], vendor)
await run('corepack', ['pnpm', '--filter', '@deepseek-ai/dsh-desktop', 'run', 'build'], vendor)
await run(process.execPath, ['lwb/upgrade/verify.mjs'])
console.log(`DeepSeek Harness ${lock.tag} is ready.`)
