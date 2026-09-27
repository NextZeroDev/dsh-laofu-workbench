import { LWB_RUNTIME } from './runtime-config.mjs'
import { createPackGroup, restoreEnabledPacks } from './dsh-adapter/loader.mjs'

const PROFILE_ID = LWB_RUNTIME.profileId

// The pack runtime projects Loader-managed browser bundles through DSH's
// client-module graph. Declare both host services at the bundle boundary.
export const inject = ['loader', 'clientModules', 'agents', 'agentPresets', 'permissionPresets', 'credentials', 'agentDefaultModel', 'webServer', 'llm']

import { LwbPackWorkspaces } from './pack-workspaces.mjs'
import { LwbPackServices } from './pack-services.mjs'

import LwbArchiveGateway from './archive-gateway.mjs'
import LwbPackGateway from './pack-gateway.mjs'
import { LwbPackRegistry } from './pack-registry.mjs'
import { LwbPackRuntime } from './pack-runtime.mjs'
import { LwbAtsClient } from './ats-client.mjs'
import LwbAccountGateway from './account-gateway.mjs'
import { openTaskModel } from './task-model.mjs'
import { registerLwbModels } from './dsh-adapter/lwb-model.mjs'

/**
 * Host-side product identity for the LWB DSH composition.
 *
 * This intentionally contributes a small service first. Product features will
 * be added as separate host/client bundles instead of growing a parallel HTTP
 * application beside the Harness tree.
 */
export async function apply(ctx, config = {}) {
  // The browser roster needs the same package name as the host bundle. Its
  // dedicated loader row is host-side only to expose ./client, so do not
  // register the identity service a second time for that row.
  if (config.clientOnly) return
  const identity = Object.freeze({
    id: PROFILE_ID,
    name: String(config.name || '老傅工作台'),
    version: String(config.version || '0.1.0'),
    architecture: 'dsh-profile',
  })
  ctx.provide('lwbProfile', identity)
  ctx.provide('lwbPackRegistry', new LwbPackRegistry())
  const workspaces = new LwbPackWorkspaces({ root: LWB_RUNTIME.packStateDir })
  ctx.provide('lwbPackWorkspaces', workspaces)
  const account = new LwbAtsClient({ credentials: ctx.credentials, baseUrl: LWB_RUNTIME.atsBaseUrl })
  const taskModel = await openTaskModel(LWB_RUNTIME.productHome, ctx)
  ctx.provide('lwbAtsClient', account)
  ctx.provide('lwbTaskModel', taskModel)
  ctx.provide('lwbPackServices', new LwbPackServices(ctx, workspaces, { account, taskModel }))
  registerLwbModels(ctx, account)
  const packGroup = await createPackGroup(ctx)
  const packRuntime = new LwbPackRuntime(ctx, { group: packGroup })
  ctx.provide('lwbPackRuntime', packRuntime)
  ctx.plugin(LwbArchiveGateway)
  ctx.plugin(LwbPackGateway)
  ctx.plugin(LwbAccountGateway)
  // The bundle's own services are only injectable once this fiber is active.
  // Start restoration on that transition, after the baseline pack dependencies
  // are available, and let the gateway await the resulting task.
  restoreEnabledPacks(ctx, packRuntime)
}
