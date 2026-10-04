export const DEFAULT_TIMEOUT_SECONDS = 300
export const MAX_TIMEOUT_SECONDS = 1800

export function turnTimedOut(event, timeoutSeconds) {
  return event?.type === 'error' && (event.code === 'ARENA_TURN_TIMEOUT'
    || (/timeout|timed out/iu.test(event.error || '') && event.elapsedMs >= timeoutSeconds * 1000))
}

export function timeoutMessage(name, seconds) {
  return `${name} 本步超过 ${seconds} 秒时限，比赛已暂停。可调整单步时限后继续，已完成的落子保留。`
}
