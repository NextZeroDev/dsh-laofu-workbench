/** Upload validated build outputs to a draft release in the build repository. */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  edition: { type: 'string' }, target: { type: 'string' }, tag: { type: 'string' },
} })
const { edition, target, tag } = values
if (!['community', 'commercial'].includes(edition) || !['win-x64', 'mac-arm64'].includes(target)) throw new Error('Invalid desktop edition or target')
const directory = resolve('.tooling/artifacts', edition, target)
const report = JSON.parse(await readFile(join(directory, 'build-report.json'), 'utf8'))
if (tag !== `v${report.version}` || report.edition !== edition || report.target !== target) throw new Error('Release tag and build report must match')
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GH_TOKEN
if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '') || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required')
const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
const endpoint = `https://api.github.com/repos/${repository}`
async function request(path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status}): ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
const response = await fetch(`${endpoint}/releases/tags/${encodeURIComponent(tag)}`, { headers, signal: AbortSignal.timeout(60_000) })
let release
if (response.status === 404) {
  release = await request('/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    tag_name: tag, target_commitish: process.env.GITHUB_SHA, name: `Laofu Workbench ${report.version}`,
    draft: true, prerelease: true, body: 'Portable preview artifacts. Publication waits for both Windows and local macOS acceptance.',
  }) })
} else {
  if (!response.ok) throw new Error(`Cannot inspect release (${response.status})`)
  release = await response.json()
}
if (!release.draft) throw new Error('Build uploads may only modify draft releases')
const assets = await request(`/releases/${release.id}/assets?per_page=100`)
const files = [
  ...report.artifacts.map(row => ({ source: row.file, name: row.file })),
  { source: 'SHA256SUMS.txt', name: `${edition}-${target}-SHA256SUMS.txt` },
  { source: 'build-report.json', name: `${edition}-${target}-build-report.json` },
]
for (const file of files) {
  const previous = assets.find(asset => asset.name === file.name)
  if (previous) await request(`/releases/assets/${previous.id}`, { method: 'DELETE' })
  const path = join(directory, file.source)
  const size = (await stat(path)).size
  const upload = new URL(release.upload_url.split('{')[0])
  upload.searchParams.set('name', file.name)
  const result = await fetch(upload, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(size) },
    body: Readable.toWeb(createReadStream(path)), duplex: 'half', signal: AbortSignal.timeout(20 * 60_000),
  })
  if (!result.ok) throw new Error(`Release upload failed for ${file.name} (${result.status}): ${await result.text()}`)
  const asset = await result.json()
  if (asset.size !== size || asset.state !== 'uploaded') throw new Error(`Incomplete upload: ${file.name}`)
  console.log(`Uploaded ${file.name} (${size} bytes) to draft ${tag}`)
}
console.log(`Draft release: ${release.html_url}`)
