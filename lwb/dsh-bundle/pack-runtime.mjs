import {
  loadMarketplaceLwbPack,
  marketplaceLwbPacks,
  unloadLwbPack,
} from './pack-manager.mjs'
import { linkLwbPackForRuntime } from './pack-runtime-links.mjs'
import { DshPackDriver } from './dsh-adapter/loader.mjs'

function requestId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('能力包操作请求无效。')
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!/^[a-z][a-z0-9-]{1,62}$/u.test(id)) throw new Error('能力包标识无效。')
  return id
}

function clientOnly(entry) {
  return entry.options.config?.clientOnly === true
}

export { projectClientBundle } from './dsh-adapter/loader.mjs'

/**
 * Generic lifecycle manager for optional packages. It never imports a package
 * while cataloguing. Code is imported only by Cordis Loader from an
 * inspectable package source, either after an explicit user load or while
 * restoring a previously enabled package at startup.
 */
export class LwbPackRuntime {
  static inject = ['lwbPackRegistry', 'clientModules', 'lwbPackServices', 'lwbPackWorkspaces']

  constructor(ctx, options = {}) {
    this.ctx = ctx
    this.driver = options.driver || new DshPackDriver(ctx, options.group)
    this.tail = Promise.resolve()
    this.restoreFailures = new Map()
    this.startupRestore = Promise.resolve()
  }

  serial(operation) {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  isMounted(id) {
    return this.ctx.lwbPackRegistry.list().some((pack) => pack.id === id)
  }

  entriesFor(packageName) { return this.driver.entriesFor(packageName) }

  clientBundle(packageName) { return this.driver.clientBundle(packageName) }

  async removeCreatedEntries(packageName, previous) {
    const created = this.entriesFor(packageName)
      .filter((entry) => !previous.has(entry.id))
      .sort((left, right) => Number(clientOnly(right)) - Number(clientOnly(left)))
    for (const entry of created) {
      try { await this.removeEntry(entry) } catch (_) {}
    }
  }

  awaitEntries(ids) { return this.driver.awaitEntries(ids) }

  async mount(pack) {
    const { id, packageName } = pack.manifest
    if (!pack.available) {
      throw new Error(`LWB pack ${JSON.stringify(id)} is unavailable: ${pack.error || 'source cannot be inspected'}`)
    }
    if (this.isMounted(id)) {
      return {
        id,
        packageName,
        status: 'loaded',
        reloaded: false,
        client: await this.clientBundle(packageName),
      }
    }

    await linkLwbPackForRuntime(pack)
    const before = new Set(this.entriesFor(packageName).map((entry) => entry.id))
    try {
      await this.ctx.lwbPackServices?.mount(pack.manifest)
      const entries = [
        await this.createEntry({ name: packageName }),
        await this.createEntry({ name: packageName, config: { clientOnly: true } }),
      ]
      // Do not await the entire Loader here. Startup restoration runs while the
      // LWB root entry is still activating, so the global tree includes us.
      await this.awaitEntries(entries)
      if (!this.isMounted(id)) {
        throw new Error(`能力包 ${JSON.stringify(id)} 未能成功注册到 LWB 宿主。`)
      }
      return { id, packageName, status: 'loaded', reloaded: true, client: await this.clientBundle(packageName) }
    } catch (error) {
      await this.removeCreatedEntries(packageName, before)
      await this.ctx.lwbPackServices?.unmount(id)
      throw error
    }
  }

  createEntry(options) { return this.driver.createEntry(options) }

  removeEntry(entry) { return this.driver.removeEntry(entry) }

  setStartupRestore(task) {
    this.startupRestore = Promise.resolve(task).catch((error) => {
      this.ctx.logger.error(error)
      return { loaded: [], failed: [{ id: 'startup', error: error instanceof Error ? error.message : String(error) }] }
    })
  }

  ready() {
    return this.startupRestore
  }

  async restore() {
    return this.serial(async () => {
      let packs
      try {
        packs = await marketplaceLwbPacks()
      } catch (error) {
        this.ctx.logger.error(error)
        return { loaded: [], failed: [{ id: 'marketplace', error: error instanceof Error ? error.message : String(error) }] }
      }

      const loaded = []
      const failed = []
      for (const pack of packs.filter((candidate) => candidate.enabled === true)) {
        try {
          loaded.push(await this.mount(pack))
          this.restoreFailures.delete(pack.manifest.id)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.restoreFailures.set(pack.manifest.id, message)
          this.ctx.logger.error(`LWB capability pack ${JSON.stringify(pack.manifest.id)} was not restored: ${message}`)
          failed.push({ id: pack.manifest.id, error: message })
        }
      }
      return { loaded, failed }
    })
  }

  async market() {
    const mounted = new Set(this.ctx.lwbPackRegistry.list().map((pack) => pack.id))
    const packs = await marketplaceLwbPacks()
    return {
      schemaVersion: 1,
      packs: packs.map((pack) => ({
        ...pack.manifest,
        status: mounted.has(pack.manifest.id) ? 'loaded' : pack.available ? 'available' : 'unavailable',
        origin: pack.origin,
        installedAt: pack.installedAt,
        enabled: pack.enabled,
        ...((pack.error || this.restoreFailures.get(pack.manifest.id)) ? { error: pack.error || this.restoreFailures.get(pack.manifest.id) } : {}),
      })),
    }
  }

  async load(request) {
    const id = requestId(request)
    return this.serial(async () => {
      if (this.isMounted(id)) {
        const pack = (await marketplaceLwbPacks()).find((item) => item.manifest.id === id)
        if (!pack) throw new Error(`未找到能力包 ${JSON.stringify(id)}。`)
        this.restoreFailures.delete(id)
        return {
          id,
          packageName: pack.manifest.packageName,
          status: 'loaded',
          reloaded: false,
          client: await this.clientBundle(pack.manifest.packageName),
        }
      }
      const pack = await loadMarketplaceLwbPack(id)
      try {
        const result = await this.mount(pack)
        this.restoreFailures.delete(id)
        return result
      } catch (error) {
        await unloadLwbPack(id).catch(() => {})
        throw error
      }
    })
  }

  async unload(request) {
    const id = requestId(request)
    return this.serial(async () => {
      const market = await marketplaceLwbPacks()
      const pack = market.find((item) => item.manifest.id === id)
      if (!pack) throw new Error(`未找到能力包 ${JSON.stringify(id)}。`)
      const entries = this.entriesFor(pack.manifest.packageName)
        .sort((left, right) => Number(clientOnly(right)) - Number(clientOnly(left)))
      await this.ctx.lwbPackServices?.unmount(id)
      for (const entry of entries) await this.removeEntry(entry)
      await unloadLwbPack(id)
      this.restoreFailures.delete(id)
      return { id, packageName: pack.manifest.packageName, status: 'available', reloaded: entries.length > 0 }
    })
  }

  async maintain(request, operation) {
    const id = requestId(request)
    if (request.confirm !== true) throw new Error('请明确确认本次能力包数据操作。')
    return this.serial(async () => {
      if (this.isMounted(id)) throw new Error('请先卸载能力包，等待任务停止后再执行数据操作。')
      return this.ctx.lwbPackWorkspaces[operation](id)
    })
  }
}
