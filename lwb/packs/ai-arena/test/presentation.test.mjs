import assert from 'node:assert/strict'
import test from 'node:test'
import { actionLabel, boardSvg, frameAt, playerSide, sceneHtml, xiangqiPosition } from '../presentation.mjs'
import { replayHtml, reportMarkdown } from '../export.mjs'

const move = (fromRow, fromCol, toRow, toCol, player) => ({ from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol }, player })
const opening = [move(8, 2, 8, 5, 0), move(1, 2, 3, 3, 1), move(8, 5, 4, 5, 0)]
const fixture = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: '象棋演示',
  game: { id: 'xiangqi', name: '中国象棋', description: '中国象棋规则', version: '1' },
  players: [{ name: '红方模型', provider: 'test', model: 'red' }, { name: '黑方模型', provider: 'test', model: 'black' }],
  events: opening.map(({ player, ...action }, i) => ({ type: 'move', player, action, speech: `第 ${i + 1} 手`, moveNumber: i + 1, elapsedMs: 100 })),
  status: 'finished', result: { message: '比赛结束', winner: null }, calls: 3, tokens: 100,
}

test('xiangqi replay starts with 32 pieces and reconstructs moves and captures', () => {
  const initial = xiangqiPosition()
  assert.equal(initial.flat().filter(Boolean).length, 32)
  assert.equal(initial[0][4], 'K')
  assert.equal(initial[9][4], 'k')
  const beforeCapture = xiangqiPosition(frameAt(fixture, 2).moves)
  assert.equal(beforeCapture.flat().filter(Boolean).length, 32)
  assert.equal(beforeCapture[7][1], null)
  assert.equal(beforeCapture[7][4], 'c')
  assert.equal(beforeCapture[2][2], 'N')
  const captured = xiangqiPosition(frameAt(fixture, 3).moves)
  assert.equal(captured.flat().filter(Boolean).length, 31)
  assert.equal(captured[3][4], 'c')
  assert.equal(captured[7][4], null)
  assert.equal(initial[3][4], 'P')
})

test('xiangqi scenes and offline reports use red/black identities and coordinate actions', () => {
  assert.equal(playerSide(fixture.game, 0), '红方')
  assert.equal(playerSide(fixture.game, 1), '黑方')
  assert.equal(actionLabel(fixture.events[0].action, fixture.game), '8行2列 → 8行5列')
  for (const orientation of ['landscape', 'portrait']) {
    const html = sceneHtml(fixture, 3, { orientation })
    assert.ok(html.includes(`scene ${orientation} xiangqi`))
    assert.match(html, /中国象棋棋盘，3 手/u)
    assert.match(html, /红方 · 先手/u)
    assert.match(html, /黑方 · 后手/u)
    assert.match(html, /8行5列 → 4行5列/u)
    assert.match(html, /楚河/u)
    assert.match(html, /汉界/u)
  }
  const offline = replayHtml(fixture)
  assert.match(offline, /中国象棋棋盘/u)
  assert.match(offline, /max="3"/u)
  assert.equal(offline.includes('https://'), false)
  const report = reportMarkdown(fixture)
  assert.match(report, /红方：test\/red/u)
  assert.match(report, /黑方：test\/black/u)
  assert.match(report, /8行5列 → 4行5列/u)
  assert.equal(report.includes('undefined 行'), false)
})

test('gomoku retains its original display alongside xiangqi', () => {
  const game = { id: 'gomoku', name: '五子棋' }
  assert.equal(playerSide(game, 0), '黑方')
  assert.equal(playerSide(game, 1), '白方')
  assert.equal(actionLabel({ row: 8, col: 8 }, game), '8 行 8 列')
  assert.match(boardSvg([{ row: 8, col: 8, player: 0 }]), /五子棋棋盘，1 手/u)
  assert.match(boardSvg([], { gameId: 'xiangqi' }), /中国象棋棋盘，0 手/u)
})
