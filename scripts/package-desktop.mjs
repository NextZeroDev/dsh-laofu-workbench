#!/usr/bin/env node
/**
 * One-click Desktop packaging for the build host.
 *
 * Resolves the inputs the raw packaging commands need by hand — the private
 * commercial pack checkout, the test build number, and the Electron download
 * source — then runs the official packaging flow and reports what it produced,
 * with checksums.
 *
 *   npm run package:oneclick                  # this host's target, commercial, unsigned portable
 *   npm run package:mac                       # same, but refuses a non-macOS host
 *   npm run package:win                       # same, but refuses a non-Windows host
 *   npm run package:oneclick -- --dry-run     # print the resolved inputs and command only
 *   npm run package:oneclick -- --plan        # resolve the edition and shipped packs only
 *   npm run package:oneclick -- --community --release
 *
 * The official preparation binds the target platform to the build host, so a
 * Windows package is built on Windows: locally, or on the release runner.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  artifactDirectory, artifactExtensions, probeDownload, resolveBuildNumber, resolveCommercialPackDir,
  resolveEditionName, resolveElectronMirror, resolveHostTarget, unpackedApp,
} from '../lwb/desktop/package-inputs.mjs'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_MARKER = join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'package.json')

const HELP = `Usage: npm run package:oneclick -- [options]

Packages the Laofu Workbench Desktop build for this host and reports the
artifacts with checksums.

Options:
  --edition <name>       capability-pack set to ship: commercial (default) or community
  --community            shorthand for --edition community
  --host <mac|win>       refuse to run unless the build host matches
  --build-number <n>     test build number; default is the local date (YYYYMMDD)
  --signed               use the official signing environment instead of an unsigned test build
  --release              name the artifact as a release build (no -test.<n> suffix)
  --dir                  produce the unpacked app only
  --plan                 resolve the edition and shipped packs, then stop
  --dry-run              print the resolved inputs and the command, then stop
  --no-mirror-fallback   never substitute an Electron mirror when the release host is unreachable
  -h, --help             show this message

Environment:
  LWB_COMMERCIAL_PACK_DIR   commercial pack checkout; discovered beside this repository when unset
  LWB_DESKTOP_BUILD_NUMBER  test build number; the local date is used when unset
  ELECTRON_MIRROR           Electron download source; only probed when unset
  LWB_ELECTRON_MIRROR=off   keep the default release host without probing it
`

/** Fail loudly with a message a human can act on. */
function fail(message) {
  throw new Error(message)
}

/** Resolve every packaging input, failing before any expensive work starts. */
async function resolveInputs(values, manifest) {
  assertNodeEngine(manifest)
  if (!existsSync(UPSTREAM_MARKER)) fail('The pinned DSH checkout is missing; run npm run setup before packaging.')
  const edition = resolveEditionName(values.community ? 'community' : values.edition)
  const target = resolveHostTarget(process.platform, process.arch)
  const expected = values.host === undefined ? undefined : values.host === 'mac' ? 'darwin' : 'win32'
  if (expected !== undefined && expected !== process.platform) {
    fail(`--host ${values.host} needs a ${expected} build host, but this host is ${process.platform}. `
      + 'Windows packages are built on Windows, locally or on the release runner.')
  }
  const pack = edition === 'commercial'
    ? resolveCommercialPackDir({
      env: process.env,
      projectRoot: PROJECT_ROOT,
      exists: existsSync,
      readJson: path => JSON.parse(readFileSync(path, 'utf8')),
    })
    : undefined
  const buildNumber = resolveBuildNumber(values['build-number'], process.env)
  const electron = await electronVersion()
  const mirror = values['no-mirror-fallback']
    ? { mirror: process.env.ELECTRON_MIRROR?.trim() || undefined, source: 'no probe requested' }
    : await resolveElectronMirror({ env: process.env, version: electron, probe: url => probeDownload(url) })
  return { edition, target, pack, buildNumber, electron, mirror }
}

/**
 * Electron version the prepared runtime will download. The installed package
 * answers exactly; before the first install the declared range does.
 * @returns the version, or undefined when neither is readable.
 */
async function electronVersion() {
  const installed = join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'node_modules', 'electron', 'package.json')
  if (existsSync(installed)) return JSON.parse(readFileSync(installed, 'utf8')).version
  const declared = JSON.parse(await readFile(join(PROJECT_ROOT, 'vendor', 'deepseek-harness', 'apps', 'desktop', 'package.json'), 'utf8'))
  return declared.devDependencies?.electron?.replace(/^[^\d]*/u, '') || undefined
}

/** Compare the running Node version against the repository's engine floor. */
function assertNodeEngine(manifest) {
  const floor = />=(\d+)\.(\d+)\.(\d+)/u.exec(manifest.engines?.node ?? '')
  if (floor === null) return
  const current = process.versions.node.split('.').map(Number)
  const required = floor.slice(1).map(Number)
  const rank = parts => parts[0] * 1e6 + parts[1] * 1e3 + parts[2]
  if (rank(current) < rank(required)) {
    fail(`Node ${manifest.engines.node} is required; this host runs ${process.versions.node}.`)
  }
}

/** Build the official packaging command and the environment overrides it needs. */
function packagingCommand(values, inputs) {
  const forward = ['--edition', inputs.edition]
  if (!values.signed) forward.push('--unsigned')
  forward.push('--portable')
  if (values.release) forward.push('--release')
  if (values.dir) forward.push('--dir')
  if (values.plan) forward.push('--plan')
  const env = {
    ...process.env,
    LWB_DESKTOP_BUILD_NUMBER: inputs.buildNumber,
    ...(inputs.pack === undefined ? {} : { LWB_COMMERCIAL_PACK_DIR: inputs.pack.directory }),
    ...(inputs.mirror.mirror === undefined ? {} : { ELECTRON_MIRROR: inputs.mirror.mirror }),
  }
  return { args: ['run', 'package:desktop', '--', ...forward], env, forward }
}

/** Human-readable environment prefix that reproduces the run by hand. */
function reproduction(env, forward) {
  const names = ['ELECTRON_MIRROR', 'LWB_COMMERCIAL_PACK_DIR', 'LWB_DESKTOP_BUILD_NUMBER']
  const prefix = names.filter(name => env[name] !== undefined).map(name => `${name}=${env[name]}`)
  const command = `npm run package:desktop -- ${forward.join(' ')}`
  return prefix.length === 0 ? command : `${prefix.join(' \\\n  ')} \\\n${command}`
}

/** Names directly inside one directory, or an empty set when it does not exist. */
async function listing(directory) {
  try {
    return new Set((await readdir(directory, { withFileTypes: true })).map(entry => entry.name))
  } catch {
    return new Set()
  }
}

/** Byte size in a short human unit. */
function readable(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Streamed SHA-256 of one file. */
async function checksum(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Report this run's unpacked app, its build id, and the artifact files it wrote.
 * @param directory - artifact directory of the edition and target.
 * @param target - resolved target name.
 * @param productName - product name of the edition being packaged.
 * @param before - artifact directory entries captured before the build ran.
 */
async function reportArtifacts(directory, target, productName, before) {
  const { app, manifest, launch } = unpackedApp(directory, target, productName)
  if (!existsSync(app)) {
    console.log(`\nNo unpacked app at ${app}; inspect ${directory} for what the build wrote.`)
    return
  }
  console.log(`\nUnpacked app: ${app}`)
  if (existsSync(manifest)) {
    const build = JSON.parse(readFileSync(manifest, 'utf8'))
    console.log(`  build id  ${build.id}  (first launch copies it to runtime/${build.id})`)
  }
  console.log(`Launch with: ${launch}`)

  const extensions = artifactExtensions(target)
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && !before.has(entry.name))
  if (files.length === 0) {
    console.log(`\nNo new artifact files in ${directory}.`)
    return
  }
  console.log(`\nNew artifact files in ${directory}:`)
  for (const entry of files) {
    const path = join(directory, entry.name)
    const { size } = await stat(path)
    const digest = extensions.some(extension => entry.name.endsWith(extension)) ? `  sha256 ${await checksum(path)}` : ''
    console.log(`  ${entry.name}  ${readable(size)}${digest}`)
  }
}

/** Resolve the inputs, run the official packaging flow, and report the artifacts. */
async function main() {
  const { values } = parseArgs({
    options: {
      edition: { type: 'string' },
      community: { type: 'boolean' },
      host: { type: 'string' },
      'build-number': { type: 'string' },
      signed: { type: 'boolean' },
      release: { type: 'boolean' },
      dir: { type: 'boolean' },
      plan: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-mirror-fallback': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const inputs = await resolveInputs(values, manifest)
  const command = packagingCommand(values, inputs)

  console.log(`Packaging ${manifest.name} ${manifest.version} — ${inputs.edition} for ${inputs.target}`)
  console.log(`  build number    ${inputs.buildNumber}${values.release ? ' (release naming)' : ''}`)
  console.log(`  signing         ${values.signed ? 'official environment' : 'unsigned test build'}`)
  if (inputs.pack !== undefined) console.log(`  commercial pack ${inputs.pack.directory} (${inputs.pack.source})`)
  console.log(`  electron        ${inputs.electron === undefined ? 'unknown version' : `v${inputs.electron}`} from ${inputs.mirror.mirror ?? 'the default release host'} (${inputs.mirror.source})`)
  if (inputs.mirror.source === 'no reachable download source') {
    console.log('  hint            neither the release host nor the mirror served the checksum; set ELECTRON_MIRROR to a reachable copy')
  }
  console.log(`  artifacts       ${artifactDirectory(PROJECT_ROOT, inputs.edition, inputs.target)}`)

  if (values['dry-run']) {
    console.log('\nEnvironment overrides:')
    for (const name of ['LWB_DESKTOP_BUILD_NUMBER', 'LWB_COMMERCIAL_PACK_DIR', 'ELECTRON_MIRROR']) {
      console.log(`  ${name}=${command.env[name] ?? '(unset)'}`)
    }
    console.log(`\nCommand:\n  npm ${command.args.join(' ')}`)
    return
  }

  const directory = artifactDirectory(PROJECT_ROOT, inputs.edition, inputs.target)
  const before = await listing(directory)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, command.args, {
    cwd: PROJECT_ROOT,
    env: command.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) fail(result.error.message)
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    return
  }
  if (values.plan) return
  const editions = JSON.parse(await readFile(join(PROJECT_ROOT, 'lwb', 'desktop', 'editions.json'), 'utf8'))
  const productName = editions.editions[inputs.edition]?.productName ?? manifest.name
  await reportArtifacts(directory, inputs.target, productName, before)
  console.log('\nReproduce this build with:')
  console.log(`  ${reproduction(command.env, command.forward)}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}