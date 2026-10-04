import manifest from './lwb-pack.json' with { type: 'json' }
import { registerLwbPack } from '@scitiger-ai/lwb-pack-sdk'
import { ArenaStore } from './store.mjs'
import { ArenaGames } from './games.mjs'
import { ArenaHost } from './host.mjs'
import { ArenaExport } from './export.mjs'
import { ArenaGateway } from './gateway.mjs'

export const inject = ['lwbPackRegistry', 'lwbPackServices']
export async function apply(ctx, config = {}) {
  if (config.clientOnly) return
  const scope = ctx.lwbPackServices.forPack(manifest.id)
  const store = await new ArenaStore((await scope.context()).workspacePath).init()
  const games = new ArenaGames()
  ctx.provide('arenaScope', scope)
  ctx.provide('arenaStore', store)
  ctx.provide('arenaGames', games)
  ctx.provide('arenaHost', new ArenaHost({ store, games, scope }))
  ctx.provide('arenaExport', new ArenaExport({ store, scope }))
  ctx.plugin(ArenaGateway)
  ctx.effect(() => registerLwbPack(ctx, manifest), 'ai-arena: register')
}
