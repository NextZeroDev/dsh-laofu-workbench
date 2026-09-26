import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'

/** Pack-owned preferences. Model routing, credentials and permissions stay in DSH. */
export async function openPackSettings(workspace, name, validate) {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error('Invalid pack settings name')
  const root = join(workspace, 'settings')
  await mkdir(root, { recursive: true, mode: 0o700 })
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Pack settings must not be a symlink')
  const path = join(root, `${name}.json`)
  const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Invalid pack settings file')
  let value = validate(stat ? JSON.parse(await readFile(path, 'utf8')) : {})
  let tail = Promise.resolve()
  return Object.freeze({
    get: () => structuredClone(value),
    update(patch) {
      const operation = tail.then(async () => {
        const next = validate({ ...value, ...patch })
        const temporary = `${path}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
          await rename(temporary, path)
          value = next
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      })
      tail = operation.catch(() => {})
      return operation
    },
  })
}
