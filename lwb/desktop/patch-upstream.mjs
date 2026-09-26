/** Apply the small, product-owned adaptations required by the official DSH Desktop shell. */

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DSH = join(ROOT, 'vendor', 'deepseek-harness')

async function replaceOnce(path, before, after, label) {
  const source = await readFile(path, 'utf8')
  if (source.includes(after)) return false
  if (!source.includes(before)) throw new Error(`LWB Desktop upstream patch could not find ${label} in ${path}`)
  await writeFile(path, source.replace(before, after))
  return true
}

async function patchMain() {
  const path = join(DSH, 'apps', 'desktop', 'src', 'main.ts')
  await replaceOnce(path,
    "import { extname, join, normalize, resolve, sep } from 'node:path'",
    "import { dirname, extname, join, normalize, resolve, sep } from 'node:path'",
    'main path imports')
  await replaceOnce(path,
    '  const manager = new DesktopProjectManager(paths, resources)\n',
    "  const manager = new DesktopProjectManager(paths, resources)\n  const exposePluginManager = process.env.DSH_DESKTOP_EXPOSE_PLUGIN_MANAGER === '1'\n  const keepBackendOnWindowClose = process.env.DSH_DESKTOP_KEEP_BACKEND_ON_WINDOW_CLOSE === '1'\n",
    'Desktop shell flags')
  await replaceOnce(path,
    '    const hostInspectPort = developmentHostInspectPort(development !== undefined)\n    const host = new DesktopHostProcess(resources.node, development ?? resources.dsh, activeProject,\n      hostInspectPort, process.env, onFailure)\n',
    "    const hostInspectPort = developmentHostInspectPort(development !== undefined)\n    const hostEnvironment: NodeJS.ProcessEnv = {\n      ...process.env,\n      LWB_PROFILE_ID: process.env.LWB_PROFILE_ID ?? 'desktop',\n      LWB_DSH_RUNTIME_DIR: process.env.LWB_DSH_RUNTIME_DIR ?? resources.dsh,\n      LWB_PACKS_DIR: process.env.LWB_PACKS_DIR ?? join(process.resourcesPath, 'lwb', 'packs'),\n      LWB_PRODUCT_HOME: process.env.LWB_PRODUCT_HOME ?? join(dirname(paths.root), 'lwb'),\n    }\n    const host = new DesktopHostProcess(resources.node, development ?? resources.dsh, activeProject,\n      hostInspectPort, hostEnvironment, onFailure)\n",
    'LWB Host environment')
  await replaceOnce(path,
    '        enabled: development === undefined,\n        click: openPluginWindow,\n',
    "        enabled: development === undefined && exposePluginManager,\n        visible: exposePluginManager,\n        click: openPluginWindow,\n",
    'plugin manager visibility')
  await replaceOnce(path,
    '    mainWindow = window\n    window.on(\'closed\', () => { if (mainWindow === window) mainWindow = undefined })\n',
    "    mainWindow = window\n    window.on('close', (event) => {\n      if (keepBackendOnWindowClose && !quitting && !shellInstallerOwnsQuit) {\n        event.preventDefault()\n        window.hide()\n      }\n    })\n    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })\n",
    'window lifecycle')
}

async function patchDevelopmentProject() {
  const path = join(DSH, 'apps', 'desktop', 'scripts', 'development-project.ts')
  await replaceOnce(path,
    'function linkDirectory(source: string, destination: string): void {\n  mkdirSync(dirname(destination), { recursive: true })\n',
    'function linkDirectory(source: string, destination: string): void {\n  // Optional platform packages may leave a dangling pnpm virtual-store link\n  // on a different host. They are irrelevant to the current Desktop target.\n  if (!existsSync(source)) return\n  mkdirSync(dirname(destination), { recursive: true })\n',
    'dangling optional dependency links')
}

async function patchProjectManager() {
  const path = join(DSH, 'apps', 'desktop', 'src', 'project-manager.ts')
  await replaceOnce(path,
    "const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const\n",
    "const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const\n\nfunction productProfileBundles(): readonly string[] {\n  const raw = process.env.DSH_DESKTOP_EXTRA_PROFILE_BUNDLES\n  if (raw === undefined || raw.trim() === '') return []\n  const value: unknown = JSON.parse(raw)\n  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !PACKAGE_NAME_PATTERN.test(item))) {\n    throw new Error('desktop project: DSH_DESKTOP_EXTRA_PROFILE_BUNDLES must be a JSON package-name array')\n  }\n  return [...new Set(value)]\n}\n\nfunction productProfileDependencies(): Readonly<Record<string, string>> {\n  const raw = process.env.DSH_DESKTOP_EXTRA_PROFILE_DEPENDENCIES\n  if (raw === undefined || raw.trim() === '') return {}\n  const value: unknown = JSON.parse(raw)\n  if (typeof value !== 'object' || value === null || Array.isArray(value)\n    || Object.entries(value).some(([name, version]) => !PACKAGE_NAME_PATTERN.test(name) || typeof version !== 'string' || valid(version) !== version)) {\n    throw new Error('desktop project: DSH_DESKTOP_EXTRA_PROFILE_DEPENDENCIES must map package names to exact versions')\n  }\n  return value as Readonly<Record<string, string>>\n}\n\nfunction profileBundles(): readonly string[] {\n  return [...DESKTOP_PROFILE_BUNDLES, ...productProfileBundles()]\n}\n",
    'Desktop product profile extension helpers')
  await replaceOnce(path,
    '  const plugins = bundles.slice(DESKTOP_PROFILE_BUNDLES.length)\n',
    '  const staticBundles = new Set(productProfileBundles())\n  const plugins = bundles.slice(DESKTOP_PROFILE_BUNDLES.length).filter(bundle => !staticBundles.has(bundle))\n',
    'static product bundle filtering')
  await replaceOnce(path,
    '  return Object.keys(projectManifest(projectDir).dependencies).sort().map(name => inspectPlugin(projectDir, name))\n',
    '  const staticDependencies = new Set(Object.keys(productProfileDependencies()))\n  return Object.keys(projectManifest(projectDir).dependencies).filter(name => !staticDependencies.has(name)).sort().map(name => inspectPlugin(projectDir, name))\n',
    'static product dependency filtering')
  await replaceOnce(path,
    '        bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins.filter(plugin => plugin.enabled).map(plugin => plugin.name)],\n',
    '        bundles: [...DESKTOP_PROFILE_BUNDLES, ...productProfileBundles(), ...plugins.filter(plugin => plugin.enabled).map(plugin => plugin.name)],\n',
    'static product bundle preservation')
  await replaceOnce(path,
    '    dependencies: desktopCorePackageOverrides(packageSet),\n    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },\n',
    '    dependencies: desktopCorePackageOverrides(packageSet),\n    dsh: { profile: { bundles: [...profileBundles()] } },\n',
    'runtime profile product bundles')
  await replaceOnce(path,
    '      [DESKTOP_HOST_PACKAGE]: release.version,\n    },\n    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },\n',
    '      [DESKTOP_HOST_PACKAGE]: release.version,\n      ...productProfileDependencies(),\n    },\n    dsh: { profile: { bundles: [...profileBundles()] } },\n',
    'development profile product bundles')
  await replaceOnce(path,
    '    name: PROJECT_NAME, private: true, version: \'0.0.0\', dependencies: {},\n    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },\n',
    "    name: PROJECT_NAME, private: true, version: '0.0.0', dependencies: { ...productProfileDependencies() },\n    dsh: { profile: { bundles: [...profileBundles()] } },\n",
    'empty profile product bundles')
}

async function patchPrepareDsh() {
  const path = join(DSH, 'apps', 'desktop', 'scripts', 'prepare-dsh.ts')
  await replaceOnce(path,
    "import { delimiter, dirname, join, relative, resolve } from 'node:path'",
    "import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'",
    'product runtime path imports')
  await replaceOnce(path,
    "function manifestVersion(path: string, subject: string): string {\n",
    "function productPackages(): readonly { name: string; directory: string; version: string }[] {\n  const entries = [\n    ['@scitiger-ai/lwb-dsh-bundle', process.env.LWB_DESKTOP_BUNDLE_DIR],\n    ['@scitiger-ai/lwb-pack-sdk', process.env.LWB_DESKTOP_PACK_SDK_DIR],\n  ] as const\n  return entries.flatMap(([name, directory]) => {\n    if (directory === undefined || directory.trim() === '') return []\n    const manifestPath = join(resolve(directory), 'package.json')\n    if (!existsSync(manifestPath)) throw new Error(`desktop runtime: missing product package ${name}`)\n    return [{ name, directory: resolve(directory), version: manifestVersion(manifestPath, name) }]\n  })\n}\n\nfunction materializeProductPackages(root: string, packages: readonly { name: string; directory: string; version: string }[]): void {\n  for (const product of packages) {\n    const destination = join(root, 'node_modules', ...product.name.split('/'))\n    mkdirSync(dirname(destination), { recursive: true })\n    cpSync(product.directory, destination, {\n      recursive: true,\n      dereference: true,\n      filter: source => !source.endsWith(`${sep}node_modules`) && !source.includes(`${sep}node_modules${sep}`),\n    })\n  }\n}\n\nfunction manifestVersion(path: string, subject: string): string {\n",
    'product runtime package materialization helpers')
  await replaceOnce(path,
    "    cpSync(modules, join(DSH_OUTPUT_ROOT, 'node_modules'), {\n      recursive: true, dereference: true,\n      filter: source => desktopRuntimeFileExclusion(relative(modules, source), target) === undefined,\n    })\n    writeFileSync(join(DSH_OUTPUT_ROOT, 'package.json'), `${JSON.stringify({\n      name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: release.version, type: 'module',\n      dependencies: Object.fromEntries(packageSet.packages.map(entry => [entry.name, entry.version])),\n    }, undefined, 2)}\\n`)\n",
    "    cpSync(modules, join(DSH_OUTPUT_ROOT, 'node_modules'), {\n      recursive: true, dereference: true,\n      filter: source => desktopRuntimeFileExclusion(relative(modules, source), target) === undefined,\n    })\n    const products = productPackages()\n    materializeProductPackages(DSH_OUTPUT_ROOT, products)\n    writeFileSync(join(DSH_OUTPUT_ROOT, 'package.json'), `${JSON.stringify({\n      name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: release.version, type: 'module',\n      dependencies: Object.fromEntries([\n        ...packageSet.packages.map(entry => [entry.name, entry.version]),\n        ...products.map(entry => [entry.name, entry.version]),\n      ]),\n    }, undefined, 2)}\\n`)\n",
    'product runtime package copy')
  await replaceOnce(path,
    '    const descriptor = await verifyDesktopRuntime(DSH_OUTPUT_ROOT, release.version, target)\n',
    '    const descriptor = await verifyDesktopRuntime(DSH_OUTPUT_ROOT, release.version, target)\n',
    'runtime descriptor')
  await replaceOnce(path,
    '    writeDesktopRuntime(DSH_OUTPUT_ROOT, release, packageSet.packages.map(entry => entry.name), target)\n',
    '    writeDesktopRuntime(DSH_OUTPUT_ROOT, release, [...packageSet.packages.map(entry => entry.name), ...productPackages().map(entry => entry.name)], target)\n',
    'product runtime shared package inventory')
}

async function patchBuilder() {
  const path = join(DSH, 'apps', 'desktop', 'electron-builder.config.mjs')
  await replaceOnce(path,
    "import { join } from 'node:path'\n",
    "import { join, resolve } from 'node:path'\n",
    'Desktop builder path imports')
  await replaceOnce(path,
    "import { fileURLToPath } from 'node:url'\n",
    "import { fileURLToPath } from 'node:url'\n\nconst PRODUCT_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))\n",
    'Desktop product root')
  await replaceOnce(path,
    "    extraResources: [\n      { from: buildPaths.runtime, to: 'runtime' },\n    ],\n",
    "    extraResources: [\n      { from: buildPaths.runtime, to: 'runtime' },\n      { from: join(PRODUCT_ROOT, 'lwb', 'packs'), to: 'lwb/packs', filter: ['**/*'] },\n    ],\n",
    'Desktop capability-pack resources')
}

await patchMain()
await patchDevelopmentProject()
await patchProjectManager()
await patchPrepareDsh()
await patchBuilder()
process.stdout.write('LWB Desktop upstream adaptations applied.\n')
