export function decisionPrompt(game, state, player, error) {
  return `${game.description}\n${JSON.stringify(game.observe(state, player))}${error ? `\n上一回复无效：${error}。请重新给出合法动作。` : ''}`
}
