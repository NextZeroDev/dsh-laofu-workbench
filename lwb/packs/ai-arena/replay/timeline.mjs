/**
 * 视频时间轴：离线 HTML、MP4 与测试共用同一套时长口径。
 * 不依赖 React，Node 侧也能直接 import（Remotion 组件另有 video.mjs）。
 */

/** 终局卡时长（秒），与离线 HTML 的 FINALE_MS 一致。 */
export const FINALE_SECONDS = 4

/** 视频固定用「吃大子 / 将军」档：38 处关键手里有 11 处是吃兵卒士象的常规兑换，
    而「仅将军」会丢掉第 17–20 手连续吃车吃炮的兑子高潮。 */
export const VIDEO_KEY_MODE = 'major'

/** 本帧属于哪一步、这一步已播了多少秒。 */
export function frameToStep(frame, fps, moveCount, secondsPerMove) {
  const stepFrames = secondsPerMove * fps
  const body = (moveCount + 1) * stepFrames
  if (frame < body) return { index: Math.floor(frame / stepFrames), t: (frame % stepFrames) / fps }
  return { index: moveCount + 1, t: (frame - body) / fps }
}

/** 每手 secondsPerMove 秒、终局卡 FINALE_SECONDS 秒。 */
export function totalFrames(moveCount, fps, secondsPerMove) {
  return (moveCount + 1) * secondsPerMove * fps + FINALE_SECONDS * fps
}