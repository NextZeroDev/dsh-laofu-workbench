import { GomokuMoverContext, GomokuDirectionTypes } from '@algorithm.ts/gomoku'

export const gomoku = Object.freeze({
  id: 'gomoku', name: '五子棋', version: '1.0.0', players: 2,
  description: '15×15 自由五子棋 · 黑方先手 · 连续五颗及以上获胜 · 无禁手',
  create() { return { size: 15, moves: [], nextPlayer: 0, winner: null, draw: false } },
  apply(state, action, player) {
    if (state.winner !== null || state.draw) throw new Error('比赛已经结束。')
    if (player !== state.nextPlayer) throw new Error('当前不是该选手的回合。')
    const { row, col } = action || {}
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || row > state.size || col < 1 || col > state.size) throw new Error('落点必须是 1—15 范围内的整数坐标。')
    if (state.moves.some(move => move.row === row && move.col === col)) throw new Error('该交叉点已有棋子。')
    const context = new GomokuMoverContext({ MAX_ROW: state.size, MAX_COL: state.size, MAX_ADJACENT: 5, MAX_DISTANCE_OF_NEIGHBOR: 2 })
    context.init(state.moves.map(move => ({ r: move.row - 1, c: move.col - 1, p: move.player })))
    const won = GomokuDirectionTypes.leftHalf.some(direction => context.couldReachFinalInDirection(player, context.idx(row - 1, col - 1), direction))
    const moves = [...state.moves, { row, col, player }]
    return { ...state, moves, nextPlayer: 1 - player, winner: won ? player : null, draw: !won && moves.length === state.size * state.size }
  },
  observe(state, player) {
    const board = Array.from({ length: state.size }, () => Array(state.size).fill('.'))
    for (const move of state.moves) board[move.row - 1][move.col - 1] = move.player === 0 ? 'B' : 'W'
    return { player, color: player === 0 ? '黑' : '白', coordinateSystem: '行号从上到下 1—15；列号从左到右 1—15；B=黑，W=白，.=空位', board: board.map((row, i) => `${String(i + 1).padStart(2, '0')} ${row.join(' ')}`).join('\n'), turn: state.moves.length + 1 }
  },
})
