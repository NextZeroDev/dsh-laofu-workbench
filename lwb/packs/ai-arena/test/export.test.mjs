import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArenaStore } from '../store.mjs'
import { ArenaExport, replayHtml, reportMarkdown } from '../export.mjs'
import { boardSvg, frameAt, sceneHtml } from '../presentation.mjs'

const fixture = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: '</script><img onerror=alert(1)>', game: { description: 'Rules', version: '1' }, players: [{ name: '<b>Black</b>', provider: 'test', model: 'black' }, { name: 'White', provider: 'test', model: 'white' }], calls: 1, tokens: 20, state: { moves: [{ row: 8, col: 8, player: 0 }] }, events: [{ type: 'move', turnId: 'turn', moveNumber: 1, player: 0, action: { row: 8, col: 8 }, speech: '</script><img onerror=alert(1)>', elapsedMs: 100 }], result: { message: 'Done', winner: null }, status: 'finished' }
test('replay shares game state and safely encodes model text offline', () => {
  assert.equal(frameAt(fixture, 0).moves.length, 0)
  assert.equal(frameAt(fixture, 1).moves.length, 1)
  assert.equal(frameAt(fixture, 0).result, null)
  const html = replayHtml(fixture)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.equal(html.includes('</script><img onerror='), false)
  assert.equal(html.includes('https://'), false)
  assert.ok(html.includes('AI竞技台 · 离线回放'))
  assert.ok(html.includes('回放控制'))
  assert.ok(sceneHtml(fixture, 1).includes('&lt;b&gt;Black'))
  assert.ok(boardSvg(fixture.state.moves).includes('棋盘，1 手'))
  assert.ok(boardSvg(fixture.state.moves).includes('ar-board-wood'))
  assert.ok(reportMarkdown(fixture).includes('第 1 手'))
})
test('report preserves historical fast turns after resuming with native calls', () => {
  const match = { ...fixture, config: { pace: 'native' }, events: [
    { type: 'request', turnId: 'turn', pace: 'fast' },
    { type: 'response', turnId: 'turn', execution: { label: '直接决策' } },
    ...fixture.events,
    { type: 'request', turnId: 'native-turn', pace: 'native', model: { reasoningEffort: 'high' } },
    { ...fixture.events[0], turnId: 'native-turn', moveNumber: 2 },
  ] }
  const report = reportMarkdown(match)
  assert.match(report, /当前调用配置：正常模型调用/u)
  assert.match(report, /快棋（历史配置） · 直接决策/u)
  assert.match(report, /正常模型调用 · high/u)
})
test('export runs once, snapshots config and downloads in bounded chunks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arena-export-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init(), jobs = [], signal = new AbortController()
  const match = await store.create({ ...fixture, id: undefined })
  await store.update(match.id, value => { value.status = 'finished'; value.events = fixture.events })
  let release
  const pending = new Promise(resolve => { release = resolve })
  const exporter = new ArenaExport({ store, scope: { signal: signal.signal, background: promise => jobs.push(promise) }, render: async (snapshot, directory, options) => { await pending; await writeFile(join(directory, `${options.orientation}.mp4`), Buffer.alloc(600000, 1)) } })
  await exporter.start({ id: match.id })
  await assert.rejects(exporter.start({ id: match.id }), /正在导出/)
  release(); await jobs[0]
  const first = await exporter.chunk({ id: match.id })
  assert.equal(Buffer.from(first.data, 'base64').length, 512 * 1024)
  assert.equal(first.done, false)
  assert.equal((await exporter.chunk({ id: match.id, offset: first.nextOffset })).done, true)
  await assert.rejects(exporter.chunk({ id: match.id, offset: -1 }))
  await assert.rejects(exporter.chunk({ id: match.id, offset: 600001 }))
  await assert.rejects(exporter.chunk({ id: match.id, exportId: 'previous-export' }), /版本已变化/)
})
