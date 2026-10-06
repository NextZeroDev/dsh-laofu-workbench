/**
 * Syntax-check every source file this repository owns.
 *
 * The previous `check` script was a hand-maintained `&&` chain: it listed 70
 * files, six of them test files already loaded by `node --test`, and silently
 * left 103 tracked files unchecked — including pack hosts, stores and clients.
 * Tracked-file discovery keeps the list complete and self-maintaining, and
 * excludes vendor/, node_modules/ and local runtime data by construction.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patterns = ['lwb/**/*.mjs', 'lwb/**/*.js', 'scripts/*.mjs', 'scripts/*.js']

const files = execFileSync('git', ['ls-files', ...patterns], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)

if (files.length === 0) {
  console.error('check-syntax: no tracked source files found; is this a git checkout?')
  process.exit(1)
}

const failures = []
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    failures.push({ file, detail: (error.stderr || '').toString().trim() })
  }
}

if (failures.length > 0) {
  for (const { file, detail } of failures) {
    console.error(`FAIL ${file}`)
    if (detail) console.error(detail.split('\n').slice(0, 4).join('\n'))
  }
  console.error(`check-syntax: ${failures.length} of ${files.length} files failed`)
  process.exit(1)
}

console.log(`check-syntax: ${files.length} files OK`)