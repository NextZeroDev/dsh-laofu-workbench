import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LWB_RUNTIME } from './runtime-config.mjs'

const packageRoot = join(LWB_RUNTIME.dshRuntimeDir, 'packages', 'client', 'ui-sidebar-right')
const sourceFiles = {
  index: join(packageRoot, 'src', 'client', 'index.ts'),
  seat: join(packageRoot, 'src', 'client', 'shell', 'SidebarRight.tsx'),
}
const browserBundle = join(packageRoot, 'lib', 'client.js')

const runtimeExports = `
// These runtime building blocks are intentionally exported for products that
// embed a session conversation inside another surface. Such products provide
// their own session store/controller so resource navigation stays local.
export { RightbarSeat } from './shell/SidebarRight.tsx'
export { createSidebarRightStore } from './stores.ts'
export { createSidebarRightController } from './service.ts'
export { SidebarRightTabRegistry } from './tab-registry.ts'
export { defaultSeed } from './contract/seed.ts'
export { tabInfoFactory } from './tab-info.ts'
`

function patchIndex(source) {
  if (source.includes("export { RightbarSeat } from './shell/SidebarRight.tsx'")) return source
  const marker = "export type { SidebarRightOpenTab } from './tab-inventory.ts'\n"
  if (!source.includes(marker)) throw new Error('无法定位 DSH 右栏导出位置。')
  return source.replace(marker, marker + runtimeExports)
}

function patchSeat(source) {
  if (source.includes('readonly slotNames?:')) return source
  const replacements = [
    [
      "export interface SidebarRightInjected {\n",
      "export interface SidebarRightInjected {\n  /** Alternate child slot names used by embedded products. */\n  readonly slotNames?: { readonly body: string; readonly title: string; readonly menu: string }\n",
    ],
    [
      "  readonly reportRoom: (fits: ReadonlyMap<PaneId, HalvesFit>) => void\n",
      "  readonly reportRoom: (fits: ReadonlyMap<PaneId, HalvesFit>) => void\n  readonly slotNames: NonNullable<SidebarRightInjected['slotNames']>\n",
    ],
    [
      "interface TabSlotProps extends Pick<PanelProps, 'renderSlot' | 'occurrence' | 'useTabTypes' | 'useTabNavigation' | 'useStore' | 'fullscreen' | 'active' | 'retainTab' | 'shortcuts'> {\n",
      "interface TabSlotProps extends Pick<PanelProps, 'renderSlot' | 'occurrence' | 'useTabTypes' | 'useTabNavigation' | 'useStore' | 'fullscreen' | 'active' | 'retainTab' | 'shortcuts' | 'slotNames'> {\n",
    ],
    ["  readonly seat: 'sidebar.right.pane.tab' | 'sidebar.right.pane.tab.title'\n", "  readonly seat: 'body' | 'title'\n"],
    ["  const retained = seat === 'sidebar.right.pane.tab' && definition?.keepMounted === true\n", "  const retained = seat === 'body' && definition?.keepMounted === true\n"],
    ["    title: seat === 'sidebar.right.pane.tab.title',\n", "    title: seat === 'title',\n"],
    ["  const content = renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })\n", "  const content = renderSlot(seat === 'body' ? slotNames.body : slotNames.title, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })\n"],
    ["  return seat === 'sidebar.right.pane.tab.title'\n", "  return seat === 'title'\n"],
    ["      seat=\"sidebar.right.pane.tab\"\n", "      seat=\"body\"\n"],
    ["  return tab => <TabSlot key={tab.id} {...panel} tab={tab} seat=\"sidebar.right.pane.tab.title\" fallback={tab.title} />\n", "  return tab => <TabSlot key={tab.id} {...panel} tab={tab} seat=\"title\" fallback={tab.title} />\n"],
    ["  const { sessionId, surface, actions, t, renderSlot, openTab, width, reportRoom, fullscreen, panelRef } = panel\n", "  const { sessionId, surface, actions, t, renderSlot, openTab, width, reportRoom, fullscreen, panelRef, slotNames } = panel\n"],
    ["            renderSlot('sidebar.right.tab.menu.item', { tab, dismiss })}", "            renderSlot(slotNames.menu, { tab, dismiss })}"],
    ["  sessionId, width, viewportWidth, canShow, useStore, actions, t, renderSlot, syncPresentation, bindService, openTab, closeTab,\n", "  sessionId, width, viewportWidth, canShow, useStore, actions, t, renderSlot, syncPresentation, bindService, openTab, closeTab, slotNames,\n"],
    ["    fullscreen, autoFullscreen, reportRoom, active, retainTab, shortcuts, splitPane, toggleFullscreen,\n", "    fullscreen, autoFullscreen, reportRoom, active, retainTab, shortcuts, splitPane, toggleFullscreen,\n    slotNames: slotNames ?? { body: 'sidebar.right.pane.tab', title: 'sidebar.right.pane.tab.title', menu: 'sidebar.right.tab.menu.item' },\n"],
  ]
  let result = source
  for (const [from, to] of replacements) {
    if (!result.includes(from)) throw new Error(`无法定位 DSH 右栏适配点：${from.slice(0, 60)}`)
    result = result.replace(from, to)
  }
  return result
}

function bundle() {
  execFileSync('corepack', ['pnpm', '--filter', '@deepseek-ai/dsh-client-ui-sidebar-right', 'bundle'], {
    cwd: LWB_RUNTIME.dshRuntimeDir,
    stdio: 'inherit',
  })
}

/**
 * Build the official rightbar once with the two small embedding seams. The
 * generated lib is consumed by DSH's browser module loader; source files are
 * restored in a finally block so upstream remains clean for upgrade checks.
 */
export async function prepareEmbeddedSidebarBundle() {
  const [index, seat] = await Promise.all([readFile(sourceFiles.index, 'utf8'), readFile(sourceFiles.seat, 'utf8')])
  const alreadyPatched = index.includes("export { RightbarSeat } from './shell/SidebarRight.tsx'") && seat.includes('readonly slotNames?:')
  const bundleSource = await readFile(browserBundle, 'utf8').catch(() => '')
  if (alreadyPatched) {
    if (!bundleSource.includes('exports.RightbarSeat')) bundle()
    return
  }
  if (index.includes("export { RightbarSeat } from './shell/SidebarRight.tsx'") || seat.includes('readonly slotNames?:')) {
    throw new Error('DSH 右栏嵌入适配处于不完整状态，请运行 npm run setup 恢复官方源码后重试。')
  }
  const patchedIndex = patchIndex(index)
  const patchedSeat = patchSeat(seat)
  await Promise.all([writeFile(sourceFiles.index, patchedIndex), writeFile(sourceFiles.seat, patchedSeat)])
  try {
    bundle()
  } finally {
    await Promise.all([writeFile(sourceFiles.index, index), writeFile(sourceFiles.seat, seat)])
  }
}
