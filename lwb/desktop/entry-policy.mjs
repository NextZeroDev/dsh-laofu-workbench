/** LWB owns entry navigation; DSH still owns authentication and credentials. */
import { registerHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const welcomeDecision = /function needsWelcome\(authentication\) \{\s*return !authentication\.loggedIn && !authentication\.hasApiKey;\s*\}/gu

/**
 * This pinned Desktop has no public welcome-policy option. Adapt only its
 * presentation predicate in memory, never its account state or upstream files.
 * Fail closed when an upstream build changes this boundary, instead of silently
 * restoring a welcome window or altering a different part of the main process.
 */
export function applyLwbEntryPolicy(source) {
  const decisions = [...source.matchAll(welcomeDecision)]
  const uses = [...source.matchAll(/\bneedsWelcome\(/gu)]
  if (decisions.length !== 1 || uses.length !== 4) {
    throw new Error('LWB Desktop entry policy does not match the pinned DSH build. Review the welcome adapter before upgrading.')
  }
  return source.replace(welcomeDecision, 'function needsWelcome(authentication) {\n\t// LWB account access is optional; its settings own sign-in and sign-out.\n\treturn false;\n}')
}

/** One exact main-module load; all other modules retain the native loader. */
export function installLwbEntryPolicy(mainUrl) {
  const target = pathToFileURL(realpathSync(fileURLToPath(mainUrl))).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (url !== target) return loaded
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
      const adapted = applyLwbEntryPolicy(source)
      hooks.deregister()
      return { ...loaded, source: adapted }
    },
  })
  return hooks
}

// The official development launcher is reused unchanged. Its --import reaches
// Node build tools and the Host too; only Electron's product main installs it.
if (process.versions.electron && process.type === 'browser' && process.env.LWB_PROFILE_ID === 'desktop' && process.env.LWB_DESKTOP_ENTRY_URL) {
  installLwbEntryPolicy(process.env.LWB_DESKTOP_ENTRY_URL)
}
