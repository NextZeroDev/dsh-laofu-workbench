import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

for (const enabled of [false, true]) {
  test(`Profile startup migrates old pack links before host resolution (enabled=${enabled})`, async t => {
    const home = await mkdtemp(join(tmpdir(), 'lwb-profile-upgrade-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    const oldSource = join(home, 'runtime', 'old-build', 'lwb', 'packs', 'spoken-video')
    const runtime = join(home, 'runtime', 'current-build')
    const source = join(runtime, 'lwb', 'packs', 'spoken-video')
    const profile = join(home, 'dsh-home', 'profiles', 'desktop')
    const link = join(profile, 'node_modules', '@scitiger-ai', 'lwb-spoken-video')
    const manifest = JSON.parse(await readFile(new URL('../packs/spoken-video/lwb-pack.json', import.meta.url)))
    const packageJson = JSON.parse(await readFile(new URL('../packs/spoken-video/package.json', import.meta.url)))
    for (const directory of [oldSource, source]) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'lwb-pack.json'), JSON.stringify(manifest))
      await writeFile(join(directory, 'package.json'), JSON.stringify(packageJson))
      // Preparing links must not activate even a previously enabled pack.
      await writeFile(join(directory, 'index.mjs'), 'throw new Error("Pack imported during Profile preparation")\n')
      await writeFile(join(directory, 'client.js'), 'throw new Error("Client imported during Profile preparation")\n')
    }
    await mkdir(join(link, '..'), { recursive: true })
    await symlink(oldSource, link, process.platform === 'win32' ? 'junction' : 'dir')
    const registryPath = join(home, 'packs.json')
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 2, packs: [{
      id: manifest.id, packageName: manifest.packageName, source: oldSource,
      enabled, installedAt: '2026-01-01T00:00:00.000Z', manifest,
    }] }))
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/^(?:LWB_|DSH_|ELECTRON_|NODE_OPTIONS$|NODE_PATH$)/u.test(key)) delete env[key]
    Object.assign(env, {
      LWB_PRODUCT_HOME: home, LWB_PROFILE_ID: 'desktop', LWB_PROFILE_DIR: profile,
      LWB_PACKS_DIR: join(runtime, 'lwb', 'packs'), LWB_PACK_RUNTIME_DIR: join(runtime, 'lwb', 'packs'),
    })
    await execFileAsync(process.execPath, ['--input-type=module', '--eval', `
      import { migrateRuntimePackRegistry } from ${JSON.stringify(new URL('./registry-migration.mjs', import.meta.url).href)}
      import { prepareLwbProfile } from ${JSON.stringify(new URL('../profile-setup.mjs', import.meta.url).href)}
      await migrateRuntimePackRegistry(${JSON.stringify(registryPath)}, {
        productHome: ${JSON.stringify(home)}, currentRuntime: ${JSON.stringify(runtime)},
      })
      await prepareLwbProfile()
      await prepareLwbProfile()
    `], { env, cwd: projectRoot, timeout: 30_000 })
    assert.equal(await realpath(link), await realpath(source))
    const record = JSON.parse(await readFile(registryPath)).packs[0]
    assert.equal(record.source, source)
    assert.equal(record.enabled, enabled)
    const profileManifest = JSON.parse(await readFile(join(profile, 'package.json')))
    assert.ok(!profileManifest.dsh.profile.bundles.includes(manifest.packageName))
  })
}
