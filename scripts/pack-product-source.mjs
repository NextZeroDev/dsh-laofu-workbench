#!/usr/bin/env node
/**
 * Write the product-source snapshot the Windows release runner builds from.
 *
 * That runner never clones this repository: it extracts
 * `.build/product-source.tar.gz` from the private commercial repository. This
 * script produces that archive from a committed revision (the default), or from
 * the working tree when asked, and refreshes the provenance record beside it.
 *
 *   npm run snapshot:product                    # archive origin/main
 *   npm run snapshot:product -- --ref <commit>  # archive one revision
 *   npm run snapshot:product -- --worktree      # archive the working tree, uncommitted work included
 *   npm run snapshot:product -- --dry-run       # report what would be written
 *
 * A committed snapshot is reproducible: the same revision produces the same
 * archive, so the recorded SHA-256 is a usable reference. A working-tree
 * snapshot is not, and its record says so.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { replaceSnapshotFields, serialiseSnapshotInputs, snapshotIsCurrent } from '../lwb/desktop/product-source.mjs'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = resolve(PROJECT_ROOT, '..', 'dsh-laofu-workbench-commercial', '.build')
const ARCHIVE = 'product-source.tar.gz'
const RECORD = 'inputs.json'

const HELP = `Usage: npm run snapshot:product -- [options]

Archive the product source the Windows release runner builds from, then refresh
the provenance record beside it in the private commercial repository.

Options:
  --ref <commit>   revision to archive (default origin/main)
  --worktree       archive the working tree, uncommitted changes included
  --out <dir>      destination directory (default ../dsh-laofu-workbench-commercial/.build)
  --dry-run        report the archive without writing it
  -h, --help       show this message

Next: commit .build in the private repository, push it, then trigger the
"Desktop portable test builds" workflow with the same build number as the
macOS build.
`

/** Run one git command and return its stdout. */
function git(args, options = {}) {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
}

/** Run one git command and return its raw stdout. */
function gitBuffer(args, options = {}) {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, maxBuffer: 512 * 1024 * 1024, ...options })
}

/** Resolve a revision to its commit id, failing loudly for anything unknown. */
function resolveCommit(ref) {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch {
    throw new Error(`Cannot resolve "${ref}" to a commit in ${PROJECT_ROOT}.`)
  }
}

/**
 * Archive the working tree without touching the user's index: a temporary index
 * stages every non-ignored file, and the resulting tree is what ships.
 * @returns the tree id and the commit it was based on.
 */
async function archiveWorkingTree() {
  const directory = await mkdtemp(join(tmpdir(), 'lwb-snapshot-'))
  const index = join(directory, 'index')
  try {
    git(['add', '--all'], { env: { ...process.env, GIT_INDEX_FILE: index } })
    const tree = git(['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: index } }).trim()
    return { tree, base: resolveCommit('HEAD') }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Archive one tree as a reproducible gzipped tar. */
function archiveTree(tree) {
  const tar = gitBuffer(['archive', '--format=tar', tree])
  return { tar, archive: gzipSync(tar, { level: 9 }) }
}

/** Number of files one tree contains. */
function countTree(tree) {
  return git(['ls-tree', '-r', '--name-only', tree]).trim().split('\n').filter(Boolean).length
}

/** Read the provenance record's text, if one exists. */
function readRecord(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** Human-readable byte size. */
function readable(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Resolve the snapshot this run would write, or fail before writing anything. */
async function resolveSnapshot(values) {
  if (values.ref !== undefined && values.worktree === true) throw new Error('--ref and --worktree are mutually exclusive.')
  if (values.worktree === true) {
    const { tree, base } = await archiveWorkingTree()
    const dirty = git(['status', '--porcelain', '--untracked-files=normal']).trim() !== ''
    return { tree, treeish: tree, commit: base, includesLocalTrackedChanges: dirty, kind: 'working tree' }
  }
  const ref = values.ref ?? 'origin/main'
  const commit = resolveCommit(ref)
  return { tree: commit, treeish: commit, commit, includesLocalTrackedChanges: false, kind: `${ref} (${commit.slice(0, 12)})` }
}

/** Write the archive and its provenance record. */
async function main() {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      worktree: { type: 'boolean' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const out = resolve(values.out ?? DEFAULT_OUT)
  const archivePath = join(out, ARCHIVE)
  const recordPath = join(out, RECORD)
  const snapshot = await resolveSnapshot(values)
  const { archive } = archiveTree(snapshot.tree)
  const archiveSha256 = createHash('sha256').update(archive).digest('hex')
  const recordText = readRecord(recordPath)
  const current = recordText === undefined ? undefined : JSON.parse(recordText)
  const update = {
    snapshotCommit: snapshot.commit,
    archiveSha256,
    includesLocalTrackedChanges: snapshot.includesLocalTrackedChanges,
  }

  console.log(`Product source snapshot: ${snapshot.kind}`)
  console.log(`  commit          ${snapshot.commit}${snapshot.includesLocalTrackedChanges ? '  (with uncommitted changes)' : ''}`)
  console.log(`  files           ${countTree(snapshot.tree)}`)
  console.log(`  archive         ${readable(archive.length)}  sha256 ${archiveSha256}`)
  console.log(`  destination     ${archivePath}`)
  if (current !== undefined) {
    console.log(`  replaces        ${current.productSnapshotCommit}  sha256 ${current.productArchiveSha256}`)
  }
  if (snapshotIsCurrent(current, update)) {
    console.log('\nAlready current; nothing written.')
    return
  }
  const record = recordText === undefined ? serialiseSnapshotInputs(undefined, update) : replaceSnapshotFields(recordText, update)
  if (record === undefined) throw new Error(`${RECORD} does not carry the three snapshot fields; refresh it by hand or delete it.`)
  console.log(`  record          ${RECORD}: ${['productSnapshotCommit', 'productArchiveSha256', 'includesLocalTrackedChanges'].join(', ')}`)
  if (values['dry-run']) {
    console.log('\nDry run: no files written.')
    return
  }
  await mkdir(out, { recursive: true })
  writeFileSync(archivePath, archive)
  writeFileSync(recordPath, record)
  console.log(`\nWritten. Commit and push .build in the private repository, then trigger the Windows workflow.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}