import { fileURLToPath } from 'node:url'
import {
  installLwbPack,
  installedLwbPacks,
  removeLwbPack,
} from './dsh-bundle/pack-manager.mjs'

export * from './dsh-bundle/pack-manager.mjs'

function printablePack(pack) {
  return {
    id: pack.manifest.id,
    packageName: pack.manifest.packageName,
    name: pack.manifest.name,
    version: pack.manifest.version,
    source: pack.source,
    installedAt: pack.installedAt,
    enabled: pack.enabled,
  }
}

async function main(argv) {
  const [command, argument] = argv
  if (command === 'list' && argument === undefined) {
    process.stdout.write(`${JSON.stringify((await installedLwbPacks()).map(printablePack), null, 2)}\n`)
    return
  }
  if (command === 'install' && argument !== undefined) {
    process.stdout.write(`${JSON.stringify(printablePack(await installLwbPack(argument)), null, 2)}\n`)
    return
  }
  if (command === 'remove' && argument !== undefined) {
    await removeLwbPack(argument)
    process.stdout.write(`${JSON.stringify({ removed: argument })}\n`)
    return
  }
  throw new Error('Usage: node lwb/pack-manager.mjs <list | install <directory> | remove <id>>')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
