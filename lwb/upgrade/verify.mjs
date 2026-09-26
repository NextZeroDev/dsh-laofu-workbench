import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { dshPackageDirectory } from '../dsh-bundle/dsh-adapter/package-paths.mjs'
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
console.log(`LWB upstream contract passed: ${UPSTREAM.tag} (${result.commit}); official source clean.`)
