export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const movesOf = match => (match.events || []).filter(event => event.type === 'move')
export const gameName = game => game?.name || (game?.id === 'xiangqi' ? '中国象棋' : '五子棋')
export const playerSide = (game, player) => game?.id === 'xiangqi' ? (player ? '黑方' : '红方') : (player ? '白方' : '黑方')
export const actionLabel = (action, game) => game?.id === 'xiangqi' || (action?.from && action?.to)
  ? Number.isInteger(action?.from?.row) && Number.isInteger(action?.from?.col) && Number.isInteger(action?.to?.row) && Number.isInteger(action?.to?.col) ? `${action.from.row}行${action.from.col}列 → ${action.to.row}行${action.to.col}列` : '等待走子'
  : Number.isInteger(action?.row) && Number.isInteger(action?.col) ? `${action.row} 行 ${action.col} 列` : '等待落子'
export function frameAt(match, step) {
  const events = movesOf(match).slice(0, step)
  return { moves: events.map(event => ({ ...event.action, player: event.player })), current: events.at(-1) || null, speech: events.slice(-6).reverse(), result: step >= movesOf(match).length ? match.result : null }
}
const XIANGQI_PIECES = Object.freeze({
  r: ['车', 'red'], n: ['马', 'red'], b: ['相', 'red'], a: ['仕', 'red'], k: ['帅', 'red'], c: ['炮', 'red'], p: ['兵', 'red'],
  R: ['車', 'black'], N: ['馬', 'black'], B: ['象', 'black'], A: ['士', 'black'], K: ['将', 'black'], C: ['砲', 'black'], P: ['卒', 'black'],
})
const XIANGQI_INITIAL = [
  ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'],
  [null, null, null, null, null, null, null, null, null],
  [null, 'C', null, null, null, null, null, 'C', null],
  ['P', null, 'P', null, 'P', null, 'P', null, 'P'],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ['p', null, 'p', null, 'p', null, 'p', null, 'p'],
  [null, 'c', null, null, null, null, null, 'c', null],
  [null, null, null, null, null, null, null, null, null],
  ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'],
]
const isXiangqiMove = move => !!move && move.from && move.to
const coordinate = value => {
  if (!value || !Number.isInteger(value.row) || !Number.isInteger(value.col) || value.row < 1 || value.row > 10 || value.col < 1 || value.col > 9) return null
  return { row: value.row - 1, col: value.col - 1 }
}
export function xiangqiPosition(moves = []) {
  const board = XIANGQI_INITIAL.map(row => [...row])
  for (const move of moves) {
    const from = coordinate(move.from), to = coordinate(move.to)
    if (!from || !to) continue
    const code = board[from.row][from.col]
    if (!code) continue
    board[from.row][from.col] = null
    board[to.row][to.col] = code
  }
  return board
}
export function xiangqiBoardSvg(moves = [], { opacity = 1 } = {}) {
  const margin = 38, gap = 54, width = margin * 2 + gap * 8, height = margin * 2 + gap * 9
  const board = xiangqiPosition(moves)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="中国象棋棋盘，${moves.length} 手"><defs><linearGradient id="ar-xq-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0b16b"/><stop offset=".5" stop-color="#c99251"/><stop offset="1" stop-color="#b9793f"/></linearGradient><filter id="ar-xq-shadow"><feDropShadow dx="1.5" dy="2" stdDeviation="1.5" flood-color="#4b2d15" flood-opacity=".35"/></filter></defs><rect width="${width}" height="${height}" rx="6" fill="url(#ar-xq-wood)"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="4" fill="none" stroke="#754a26" stroke-opacity=".55" stroke-width="1.5"/>`]
  const x = col => margin + col * gap, y = row => margin + row * gap
  for (let row = 0; row < 10; row++) parts.push(`<path d="M ${x(0)} ${y(row)} H ${x(8)}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/><text x="18" y="${y(row) + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${row + 1}</text>`)
  for (let col = 0; col < 9; col++) {
    const path = col === 0 || col === 8 ? `M ${x(col)} ${y(0)} V ${y(9)}` : `M ${x(col)} ${y(0)} V ${y(4)} M ${x(col)} ${y(5)} V ${y(9)}`
    parts.push(`<path d="${path}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/>`)
    parts.push(`<text x="${x(col)}" y="${height - 10}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${col + 1}</text>`)
  }
  parts.push(`<rect x="${x(0)}" y="${y(4)}" width="${gap * 8}" height="${gap}" fill="#edd095" fill-opacity=".36"/><text x="${width / 2 - 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">楚河</text><text x="${width / 2 + 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">汉界</text>`)
  for (const [fromCol, fromRow, toCol, toRow] of [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]]) parts.push(`<path d="M ${x(fromCol)} ${y(fromRow)} L ${x(toCol)} ${y(toRow)}" stroke="#674622" stroke-width="1.1"/>`)
  for (const [row, col] of [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]]) parts.push(`<path d="M ${x(col) - 5} ${y(row) - 5} h 4 v -4 M ${x(col) + 5} ${y(row) - 5} h -4 v -4 M ${x(col) - 5} ${y(row) + 5} h 4 v 4 M ${x(col) + 5} ${y(row) + 5} h -4 v 4" fill="none" stroke="#674622" stroke-width="1"/>`)
  board.forEach((line, row) => line.forEach((code, col) => {
    if (!code || !XIANGQI_PIECES[code]) return
    const [label, side] = XIANGQI_PIECES[code], fill = side === 'red' ? '#b83c2e' : '#202723', stroke = side === 'red' ? '#79231c' : '#101512'
    parts.push(`<g opacity="${opacity}" filter="url(#ar-xq-shadow)"><circle cx="${x(col)}" cy="${y(row)}" r="20" fill="#f4e4bd" stroke="${stroke}" stroke-width="1.5"/><circle cx="${x(col)}" cy="${y(row)}" r="16.5" fill="none" stroke="${fill}" stroke-opacity=".55" stroke-width="1"/><text x="${x(col)}" y="${y(row) + 7}" text-anchor="middle" fill="${fill}" font-family="serif" font-size="22" font-weight="700">${label}</text></g>`)
  }))
  const last = moves.at(-1), lastTo = coordinate(last?.to)
  if (lastTo) parts.push(`<circle cx="${x(lastTo.col)}" cy="${y(lastTo.row)}" r="24" fill="none" stroke="#e45d3c" stroke-width="2.4"/>`)
  return `${parts.join('')}</svg>`
}
export function boardSvg(moves, { size = 15, opacity = 1, gameId = '' } = {}) {
  if (gameId === 'xiangqi' || moves?.some(isXiangqiMove)) return xiangqiBoardSvg(moves, { opacity })
  const margin = 34, gap = 32, end = margin + gap * (size - 1), extent = end + margin
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="五子棋棋盘，${moves.length} 手"><defs><linearGradient id="ar-board-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7a866"/><stop offset=".5" stop-color="#c6904e"/><stop offset="1" stop-color="#b9793f"/></linearGradient><radialGradient id="ar-stone-black" cx="30%" cy="25%"><stop offset="0" stop-color="#4a514c"/><stop offset=".55" stop-color="#1c2521"/><stop offset="1" stop-color="#0d1310"/></radialGradient><radialGradient id="ar-stone-white" cx="30%" cy="25%"><stop offset="0" stop-color="#fffdf7"/><stop offset=".65" stop-color="#e8e5dc"/><stop offset="1" stop-color="#bdb8ad"/></radialGradient></defs><rect width="${extent}" height="${extent}" rx="6" fill="url(#ar-board-wood)"/><path d="M 0 48 H ${extent} M 0 128 H ${extent} M 0 214 H ${extent} M 0 302 H ${extent} M 0 384 H ${extent}" stroke="#fff1c4" stroke-opacity=".12" stroke-width="2"/>`]
  for (let i = 0; i < size; i++) {
    const p = margin + i * gap
    parts.push(`<path d="M ${margin} ${p} H ${end} M ${p} ${margin} V ${end}" stroke="#674622" stroke-opacity=".84" stroke-width="1.15"/><text x="${p}" y="18" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text><text x="15" y="${p + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text>`)
  }
  for (const row of [4, 8, 12]) for (const col of [4, 8, 12]) parts.push(`<circle cx="${margin + (col - 1) * gap}" cy="${margin + (row - 1) * gap}" r="2.8" fill="#5a3a1b"/>`)
  moves.forEach((move, index) => {
    const x = margin + (move.col - 1) * gap, y = margin + (move.row - 1) * gap, last = index === moves.length - 1
    const fill = move.player === 0 ? 'url(#ar-stone-black)' : 'url(#ar-stone-white)', stroke = move.player === 0 ? '#0b100d' : '#a59e91', text = move.player === 0 ? '#fff8df' : '#3b2b1a'
    parts.push(`<g opacity="${last ? opacity : 1}"><circle cx="${x + 2}" cy="${y + 3}" r="13.5" fill="#4b2d15" opacity=".32"/><circle cx="${x}" cy="${y}" r="12.5" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/><circle cx="${x - 4}" cy="${y - 4}" r="3.2" fill="#fff" opacity="${move.player === 0 ? '.16' : '.42'}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${text}">${index + 1}</text>${last ? `<circle cx="${x}" cy="${y}" r="15.5" fill="none" stroke="#e45d3c" stroke-width="2.2"/>` : ''}</g>`)
  })
  return `${parts.join('')}</svg>`
}
export function sceneHtml(match, step, { orientation = 'landscape', opacity = 1 } = {}) {
  const frame = frameAt(match, step), current = frame.current, xiangqi = match.game?.id === 'xiangqi'
  const player = current ? match.players[current.player] : match.players[0]
  const longSpeech = (current?.speech?.length || 0) > 40
  return `<main class="scene ${orientation}${xiangqi ? ' xiangqi' : ''}"><header><span class="brand">AI竞技台</span><span>${escapeHtml(gameName(match.game))} / ${escapeHtml(match.game.version)} / 第 ${step} 手</span></header><div class="scene-body"><section class="scene-board">${boardSvg(frame.moves, { opacity, gameId: match.game?.id })}</section><aside><div class="versus">${match.players.map((item, i) => `<div><i class="stone ${xiangqi ? i ? 'xq-black' : 'xq-red' : i ? 'white' : 'black'}"></i><strong>${escapeHtml(item.name)}</strong><small>${playerSide(match.game, i)} · ${i ? '后手' : '先手'}</small></div>`).join('<b>VS</b>')}</div><div class="speaker"><span>${escapeHtml(player.name)}${current ? ` · ${escapeHtml(actionLabel(current.action, match.game))}` : ''}</span><p${longSpeech ? ' style="font-size:20px"' : ''}>${escapeHtml(current?.speech || '比赛开始')}</p></div><div class="recent">${frame.speech.slice(1, longSpeech ? 2 : 4).map(event => `<p><b>${event.moveNumber}. ${escapeHtml(match.players[event.player].name)}</b>${escapeHtml(event.speech)}</p>`).join('')}</div>${frame.result ? `<div class="result">${escapeHtml(frame.result.message)}</div>` : ''}</aside></div><footer>${xiangqi ? '九路十线中国象棋 · 红方先手' : '15×15 自由五子棋'} · 发言来自参赛模型 · ${escapeHtml(match.id.slice(0, 8))}</footer></main>`
}
export const SCENE_CSS = `*{box-sizing:border-box}html,body{margin:0}body{font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#27352d;background:#f8faf8}.scene{color:#27352d;color-scheme:light;height:100%;width:100%;padding:28px 40px;display:flex;flex-direction:column;background:#f8faf8}.scene header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8e0d9;padding-bottom:16px;font-size:16px;color:#526458}.brand{font-size:26px;font-weight:700;color:#27352d}.scene-body{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:32px;flex:1;min-height:0;padding:24px 0}.scene-board{display:flex;align-items:center;justify-content:center;min-height:0}.scene-board svg{width:100%;height:100%;max-height:100%;aspect-ratio:1}.scene aside{min-width:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center}.versus{display:flex;align-items:center;gap:14px;border-bottom:1px solid #d8e0d9;padding-bottom:20px}.versus>div{flex:1;min-width:0}.versus strong,.versus small{display:block;overflow-wrap:anywhere}.versus strong{font-size:20px;margin:8px 0}.versus small{font-size:13px;color:#526458}.versus>b{font-size:14px;color:#dd6749}.stone{display:block;width:19px;height:19px;border-radius:50%;border:1px solid #a9b5ac}.black{background:#252b28}.white{background:#fff}.xq-red{background:#ad3b30;border-color:#f0c999}.xq-black{background:#29362e;border-color:#f0c999}.xiangqi .scene-board svg{aspect-ratio:508/562}.speaker{border-left:4px solid #dd6749;padding:0 0 0 18px;margin:26px 0}.speaker span{font-size:15px;color:#526458;overflow-wrap:anywhere}.speaker p{font-size:27px;font-weight:600;line-height:1.5;margin:12px 0;overflow-wrap:anywhere}.recent{color:#526458;font-size:14px;line-height:1.5}.recent b{display:block;color:#4c6154;font-size:12px;margin-bottom:4px}.result{background:#e2f0e7;color:#266644;padding:12px;font-size:18px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.scene footer{font-size:12px;color:#526458;padding-top:12px;border-top:1px solid #d8e0d9}.portrait{padding:24px}.portrait .scene-body{display:flex;flex-direction:column;gap:18px;padding:18px 0}.portrait .scene-board{flex:none;height:48%}.portrait aside{flex:1;justify-content:flex-start}.portrait .speaker{margin:18px 0}.portrait .speaker p{font-size:26px}.portrait .recent{display:none}.portrait header{gap:12px}.portrait header>span:last-child{font-size:12px}`
