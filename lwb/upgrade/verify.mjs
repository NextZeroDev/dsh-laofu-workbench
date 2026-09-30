import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { dshPackageDirectory } from '../dsh-bundle/dsh-adapter/package-paths.mjs'
import { applyLwbEntryPolicy } from '../desktop/entry-policy.mjs'
const result = assertUpstream()
// Inspect the exact built exports consumed by both product clients. Renamed
// upstream primitives must fail upgrade acceptance before opening a window.
const primitives = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-primitives'), 'src/index.ts'), 'utf8')
const icons = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-primitives'), 'src/icons/index.tsx'), 'utf8')
for (const file of ['../dsh-bundle/client.js', '../packs/spoken-video/client.js']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const names = source.match(/const \{ ([^}]+) \} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1].split(', ').map(name => name.trim()) ?? []
  for (const name of names) if (!new RegExp(`\\b${name}\\b`, 'u').test(primitives + icons)) throw new Error(`Missing DSH client export: ${name}`)
}
for (const path of ['apps/cli/lib/bin.js', 'apps/desktop/lib/main.js']) {
  if (!existsSync(join(DSH_ROOT, path))) throw new Error(`Missing official build: ${path}; run npm run setup`)
}
// The conversation module hosts the official Workspace browser instead of
// drawing its own history list. Both halves of that seam are version-sensitive:
// the seat must remain the one ui-workspace fills, and owner props must still
// win in the renderer's merge order — that override is how pack Sessions stay
// out of the official list without patching upstream.
const workspaceClient = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-workspace'), 'src/client/index.ts'), 'utf8')
if (!/ctx\.slots\.inject\('sidebar\.workspaces',/u.test(workspaceClient)) {
  throw new Error('ui-workspace no longer fills the sidebar.workspaces seat; the conversation module would render an empty column')
}
const rendererSlots = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-renderer'), 'src/client/scoped-slots.tsx'), 'utf8')
if (!/\{\.\.\.slotInjected\.props\} \{\.\.\.contextual\} \{\.\.\.ownerProps\}/u.test(rendererSlots)) {
  throw new Error('owner props no longer override entry props; the conversation filter cannot reach the official Workspace browser')
}
// renderSlot authorization reads the RENDERING entry's own children table, so a
// seat must be declared by the registration whose component renders it. Losing
// this check turns a misplaced declaration into a silently blanked overlay
// instead of a load error.
if (!/entry\.children\?\.\[key\]/u.test(rendererSlots)) {
  throw new Error('renderSlot authorization no longer reads the rendering entry children table; re-derive where the sidebar.workspaces seat must be declared')
}
applyLwbEntryPolicy(readFileSync(join(DSH_ROOT, 'apps/desktop/lib/main.js'), 'utf8'))
console.log(`LWB upstream contract passed: ${UPSTREAM.tag} (${result.commit}); official source clean.`)
