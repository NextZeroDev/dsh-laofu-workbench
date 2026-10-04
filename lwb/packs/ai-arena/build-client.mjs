import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
await build({ entryPoints: [join(root, 'client-source.mjs')], outfile: join(root, 'client.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'], legalComments: 'eof', banner: { js: 'window.__ModuleLoader__.load({id:"@scitiger-ai/lwb-ai-arena",inject:["@scitiger-ai/lwb-dsh-bundle"],external:["react"],factory(require){const module={exports:{}};const exports=module.exports;' }, footer: { js: 'return module.exports;}});' } })
