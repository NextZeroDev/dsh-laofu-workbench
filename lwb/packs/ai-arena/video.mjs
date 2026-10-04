import React from 'react'
import { Composition, registerRoot, useCurrentFrame, useVideoConfig } from 'remotion'
import { movesOf, sceneHtml, SCENE_CSS } from './presentation.mjs'

const h = React.createElement
function ArenaVideo({ match, orientation, secondsPerMove }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig()
  const step = Math.min(movesOf(match).length, Math.floor(frame / (secondsPerMove * fps)))
  const opacity = step === 0 ? 1 : Math.min(1, (frame % (secondsPerMove * fps) + 1) / 8)
  return h(React.Fragment, null, h('style', null, SCENE_CSS), h('div', { style: { width: '100%', height: '100%' }, dangerouslySetInnerHTML: { __html: sceneHtml(match, step, { orientation, opacity }) } }))
}
function Root() { return h(Composition, { id: 'Arena', component: ArenaVideo, width: 1280, height: 720, fps: 30, durationInFrames: 300 }) }
registerRoot(Root)
