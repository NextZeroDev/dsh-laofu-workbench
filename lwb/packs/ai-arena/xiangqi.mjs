/**
 * Chinese chess (Xiangqi) rules for the AI Arena.
 *
 * Coordinates are one based. Row 1 is the black side of the board and row 10
 * is the red side. Player 0 is red and moves first. A move is represented as
 * { from: { row, col }, to: { row, col } }.
 */

const ROWS = 10
const COLS = 9
const RED = 0
const BLACK = 1
const PLAYERS = [RED, BLACK]
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const HORSE_STEPS = [
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [-1, 2, 0, 1], [1, -2, 0, -1], [1, 2, 0, 1],
]

const SYMBOLS = Object.freeze({
  0: Object.freeze({ general: '帥', advisor: '仕', elephant: '相', horse: '傌', chariot: '俥', cannon: '炮', soldier: '兵' }),
  1: Object.freeze({ general: '將', advisor: '士', elephant: '象', horse: '馬', chariot: '車', cannon: '砲', soldier: '卒' }),
})
const TERMINAL_REASONS = Object.freeze({ 'capture-general': '吃将获胜', checkmate: '将死获胜', stalemate: '困毙获胜', repetition: '三次重复局面和棋', 'move-limit': '连续 120 半回合无吃子及兵卒向前推进和棋' })

const inBounds = (row, col) => row >= 1 && row <= ROWS && col >= 1 && col <= COLS
const inPalace = (player, row, col) => col >= 4 && col <= 6 && (player === RED ? row >= 8 && row <= 10 : row >= 1 && row <= 3)
const ownTerritory = (player, row) => player === RED ? row >= 6 : row <= 5
const coord = (row, col) => ({ row, col })
const sameCoord = (a, b) => a?.row === b?.row && a?.col === b?.col
const clonePieces = pieces => pieces.map(piece => ({ ...piece }))

function initialPieces() {
  const pieces = []
  const add = (player, type, row, col, id) => pieces.push({ id, player, type, row, col })
  const back = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot']
  back.forEach((type, index) => add(BLACK, type, 1, index + 1, `b-${type[0]}${index + 1}`))
  add(BLACK, 'cannon', 3, 2, 'b-cannon2'); add(BLACK, 'cannon', 3, 8, 'b-cannon8')
  for (const col of [1, 3, 5, 7, 9]) add(BLACK, 'soldier', 4, col, `b-soldier${col}`)
  back.forEach((type, index) => add(RED, type, 10, index + 1, `r-${type[0]}${index + 1}`))
  add(RED, 'cannon', 8, 2, 'r-cannon2'); add(RED, 'cannon', 8, 8, 'r-cannon8')
  for (const col of [1, 3, 5, 7, 9]) add(RED, 'soldier', 7, col, `r-soldier${col}`)
  return pieces
}

function pieceAt(pieces, row, col) {
  return pieces.find(piece => piece.row === row && piece.col === col) || null
}

function generalOf(pieces, player) {
  return pieces.find(piece => piece.player === player && piece.type === 'general') || null
}

function pushIfAvailable(out, pieces, player, row, col) {
  if (!inBounds(row, col)) return
  const target = pieceAt(pieces, row, col)
  if (!target || target.player !== player) out.push({ row, col })
}

function slidingMoves(out, pieces, player, row, col, directions, cannon = false) {
  for (const [dr, dc] of directions) {
    let r = row + dr, c = col + dc, jumped = false
    while (inBounds(r, c)) {
      const target = pieceAt(pieces, r, c)
      if (!target) {
        if (!jumped) out.push({ row: r, col: c })
      } else if (!jumped) {
        if (cannon) jumped = true
        else {
          if (target.player !== player) out.push({ row: r, col: c })
          break
        }
      } else {
        if (cannon && target.player !== player) out.push({ row: r, col: c })
        break
      }
      r += dr; c += dc
    }
  }
}

/** Pseudo-legal moves, before checking whether the moving side leaves its king in check. */
function pseudoMoves(piece, pieces) {
  const out = []
  const { player, row, col, type } = piece
  if (type === 'general') {
    for (const [dr, dc] of ORTHOGONAL) {
      const r = row + dr, c = col + dc
      if (inPalace(player, r, c)) pushIfAvailable(out, pieces, player, r, c)
    }
    // The flying-general capture is a legal Xiangqi move when the file is clear.
    for (const other of pieces) {
      if (other.player === player || other.type !== 'general' || other.col !== col) continue
      const step = other.row > row ? 1 : -1
      let clear = true
      for (let r = row + step; r !== other.row; r += step) if (pieceAt(pieces, r, col)) { clear = false; break }
      if (clear) out.push({ row: other.row, col })
    }
  } else if (type === 'advisor') {
    for (const [dr, dc] of DIAGONAL) {
      const r = row + dr, c = col + dc
      if (inPalace(player, r, c)) pushIfAvailable(out, pieces, player, r, c)
    }
  } else if (type === 'elephant') {
    for (const [dr, dc] of DIAGONAL) {
      const r = row + dr * 2, c = col + dc * 2
      if (inBounds(r, c) && ownTerritory(player, r) && !pieceAt(pieces, row + dr, col + dc)) pushIfAvailable(out, pieces, player, r, c)
    }
  } else if (type === 'horse') {
    for (const [dr, dc, lr, lc] of HORSE_STEPS) {
      if (pieceAt(pieces, row + lr, col + lc)) continue
      pushIfAvailable(out, pieces, player, row + dr, col + dc)
    }
  } else if (type === 'chariot') {
    slidingMoves(out, pieces, player, row, col, ORTHOGONAL)
  } else if (type === 'cannon') {
    slidingMoves(out, pieces, player, row, col, ORTHOGONAL, true)
  } else if (type === 'soldier') {
    const forward = player === RED ? -1 : 1
    pushIfAvailable(out, pieces, player, row + forward, col)
    const crossed = player === RED ? row <= 5 : row >= 6
    if (crossed) {
      pushIfAvailable(out, pieces, player, row, col - 1)
      pushIfAvailable(out, pieces, player, row, col + 1)
    }
  }
  return out
}

function movePieces(pieces, piece, to) {
  const captured = pieceAt(pieces, to.row, to.col)
  const next = pieces.filter(candidate => candidate !== captured).map(candidate => candidate === piece ? { ...candidate, row: to.row, col: to.col } : { ...candidate })
  return { pieces: next, captured }
}

function isInCheck(player, pieces) {
  const king = generalOf(pieces, player)
  if (!king) return true
  return pieces.some(piece => piece.player !== player && pseudoMoves(piece, pieces).some(move => move.row === king.row && move.col === king.col))
}

function legalMoves(player, pieces) {
  const result = []
  for (const piece of pieces) {
    if (piece.player !== player) continue
    for (const to of pseudoMoves(piece, pieces)) {
      const moved = movePieces(pieces, piece, to).pieces
      if (!isInCheck(player, moved)) result.push({ piece, from: coord(piece.row, piece.col), to })
    }
  }
  return result
}

function positionKey(pieces, nextPlayer) {
  const board = pieces.map(piece => `${piece.player}${piece.type}${piece.row},${piece.col}`).sort().join(';')
  return `${nextPlayer}|${board}`
}

function parseSquare(value) {
  if (Array.isArray(value)) return { row: value[0], col: value[1] }
  return value && typeof value === 'object' ? { row: value.row, col: value.col } : null
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') throw new Error('中国象棋走法必须包含 from 和 to 坐标。')
  const from = parseSquare(action.from || action.source || { row: action.fromRow, col: action.fromCol })
  const to = parseSquare(action.to || action.target || { row: action.toRow, col: action.toCol })
  if (!from || !to || !Number.isInteger(from.row) || !Number.isInteger(from.col) || !Number.isInteger(to.row) || !Number.isInteger(to.col) || !inBounds(from.row, from.col) || !inBounds(to.row, to.col)) throw new Error('中国象棋坐标必须是行 1—10、列 1—9 的整数。')
  if (sameCoord(from, to)) throw new Error('起点和终点不能相同。')
  return { from, to }
}

function statePieces(state) {
  if (Array.isArray(state?.pieces)) return clonePieces(state.pieces)
  return initialPieces()
}

export const xiangqi = Object.freeze({
  id: 'xiangqi', name: '中国象棋', version: '1.0.0', players: 2,
  description: '中国象棋 · 10×9 棋盘 · 红方先手 · 将军、应将、将帅照面与困毙判定',
  actionExample: { from: { row: 10, col: 2 }, to: { row: 8, col: 3 } },
  create() {
    const pieces = initialPieces()
    return { rows: ROWS, cols: COLS, pieces, moves: [], nextPlayer: RED, winner: null, draw: false, check: false, terminalReason: null, halfmoveClock: 0, positionHistory: [positionKey(pieces, RED)] }
  },
  apply(state, action, player) {
    if (!state || typeof state !== 'object') throw new Error('中国象棋局面无效。')
    if (state.winner !== null || state.draw) throw new Error('比赛已经结束。')
    if (!PLAYERS.includes(player)) throw new Error('选手编号必须是 0 或 1。')
    if (player !== state.nextPlayer) throw new Error('当前不是该选手的回合。')
    const normalized = normalizeAction(action)
    const pieces = statePieces(state)
    const moving = pieceAt(pieces, normalized.from.row, normalized.from.col)
    if (!moving || moving.player !== player) throw new Error('起点没有该选手的棋子。')
    const legal = legalMoves(player, pieces).find(move => sameCoord(move.from, normalized.from) && sameCoord(move.to, normalized.to))
    if (!legal) throw new Error('该走法不符合中国象棋规则，或会使己方被将军。')

    const { pieces: nextPieces, captured } = movePieces(pieces, moving, normalized.to)
    const nextPlayer = 1 - player
    const checked = isInCheck(nextPlayer, nextPieces)
    const replies = captured?.type === 'general' ? [] : legalMoves(nextPlayer, nextPieces)
    let winner = captured?.type === 'general' ? player : null
    let draw = false
    let reason = winner === null ? null : 'capture-general'
    if (winner === null && replies.length === 0) {
      // In Xiangqi a side with no legal move loses even when it is not in check
      // (困毙); this also covers ordinary checkmate (将死).
      winner = player
      reason = checked ? 'checkmate' : 'stalemate'
    }
    // The 120-half-move counter is reset by captures and by a soldier's
    // forward advance. A river-crossed soldier's sideways move does not
    // advance it under this deliberately conservative draw rule.
    const soldierAdvanced = moving.type === 'soldier' && normalized.to.row !== normalized.from.row
    const halfmoveClock = captured || soldierAdvanced ? 0 : (state.halfmoveClock || 0) + 1
    const priorHistory = Array.isArray(state.positionHistory) && state.positionHistory.length ? state.positionHistory : [positionKey(pieces, state.nextPlayer)]
    const key = positionKey(nextPieces, nextPlayer)
    const positionHistory = [...priorHistory, key]
    if (winner === null && (positionHistory.filter(item => item === key).length >= 3 || halfmoveClock >= 120)) {
      draw = true
      reason = positionHistory.filter(item => item === key).length >= 3 ? 'repetition' : 'move-limit'
    }
    const move = { player, piece: moving.type, from: normalized.from, to: normalized.to, captured: captured ? { player: captured.player, type: captured.type } : null, check: checked }
    return {
      ...state,
      rows: ROWS,
      cols: COLS,
      pieces: nextPieces,
      moves: [...(Array.isArray(state.moves) ? state.moves : []), move],
      nextPlayer,
      winner,
      draw,
      check: checked,
      result: reason,
      terminalReason: reason ? TERMINAL_REASONS[reason] : null,
      halfmoveClock,
      positionHistory,
    }
  },
  observe(state, player) {
    const pieces = statePieces(state)
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill('·'))
    for (const piece of pieces) board[piece.row - 1][piece.col - 1] = SYMBOLS[piece.player]?.[piece.type] || '?'
    const legal = PLAYERS.includes(player) ? legalMoves(player, pieces) : []
    return {
      player,
      color: player === RED ? '红' : '黑',
      coordinateSystem: '行号从上到下 1—10（黑方在上、红方在下）；列号从左到右 1—9；红方先手。',
      legend: '红：帥仕相傌俥炮兵；黑：將士象馬車砲卒；·=空位。',
      board: board.map((row, index) => `${String(index + 1).padStart(2, '0')} ${row.join(' ')}`).join('\n'),
      turn: (Array.isArray(state.moves) ? state.moves.length : 0) + 1,
      nextPlayer: state.nextPlayer,
      check: Boolean(state.check),
      winner: state.winner,
      draw: Boolean(state.draw),
      terminalReason: state.terminalReason || null,
      legalMoves: legal.map(move => ({ from: move.from, to: move.to })),
    }
  },
})

export { ROWS as XIANGQI_ROWS, COLS as XIANGQI_COLS, SYMBOLS as XIANGQI_SYMBOLS }
