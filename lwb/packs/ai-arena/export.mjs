import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sceneHtml, SCENE_CSS, movesOf, escapeHtml, actionLabel, playerSide } from './presentation.mjs'

const exec = promisify(execFile)
const ROOT = dirname(fileURLToPath(import.meta.url))
const executionLabel = pace => pace === 'fast' ? '快棋（历史配置）' : pace === 'native' ? '正常模型调用' : '深度（历史配置）'
const OFFLINE_CSS = `html{background:#101814}body{min-height:100vh;display:flex;flex-direction:column;gap:12px;padding:18px;background:radial-gradient(circle at top,#263c31 0,#101814 56%);color:#eef5ef}.offline-top{display:flex;align-items:center;justify-content:space-between;gap:16px;width:min(1420px,100%);margin:0 auto;padding:12px 16px;border:1px solid #395247;border-radius:10px;background:#17251f;box-shadow:0 12px 28px #0004}.offline-brand{font-size:16px;font-weight:800;letter-spacing:.02em}.offline-meta{color:#b9cbbf;font-size:12px;text-align:right;overflow-wrap:anywhere}#view{display:flex;flex:1;min-height:0;width:min(1420px,100%);margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 18px 40px #0006}.scene{height:auto;min-height:0;flex:1;color:#27352d;background:#f8faf8}.scene-body{grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr)}.scene-board svg{max-width:680px;height:auto}.scene .versus strong,.scene .speaker p{color:#27352d}.scene aside{overflow:auto}.controls{display:flex;align-items:center;gap:10px;width:min(1420px,100%);margin:0 auto;padding:11px 13px;border:1px solid #395247;border-radius:10px;background:#17251f;box-shadow:0 12px 28px #0004}.controls button{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:34px;padding:0 11px;border:1px solid #4d6b5b;border-radius:6px;background:#22382d;color:#f1f7f2;font:600 13px/1 sans-serif;cursor:pointer}.controls button:hover{border-color:#9fcfaf;background:#2d4a3b}.controls input{flex:1;min-width:0;accent-color:#df9a4e}.controls #count{min-width:72px;color:#b5c7ba;font:600 12px/1.2 ui-monospace,monospace;text-align:right}@media(max-width:680px){body{padding:10px;gap:8px}.offline-top{padding:10px 12px}.offline-brand{font-size:14px}.offline-meta{font-size:11px}.scene{padding:16px}.scene-body{display:flex;flex-direction:column;gap:12px;padding:12px 0}.scene-board{height:auto;flex:none}.scene-board svg{height:auto;max-width:480px}.scene aside{flex:none;justify-content:flex-start;overflow:visible}.speaker{margin:12px 0}.speaker p{font-size:18px}.versus strong{font-size:15px}.recent{display:none}.scene header>span:last-child{font-size:11px}.brand{font-size:19px}.controls{gap:6px;padding:8px}.controls button{min-width:34px;padding:0 8px}.controls #count{min-width:54px;font-size:11px}}`
export function replayHtml(match) {
  const frames = Array.from({ length: movesOf(match).length + 1 }, (_, step) => sceneHtml(match, step))
  const encoded = JSON.stringify(frames).replace(/</gu, '\\u003c')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(match.title)} · AI竞技台离线回放</title><style>${SCENE_CSS}${OFFLINE_CSS}</style><header class="offline-top"><div class="offline-brand">AI竞技台 · 离线回放</div><div class="offline-meta">${escapeHtml(match.title)}<br>文件可在无网络环境下打开</div></header><div id="view"></div><nav class="controls" aria-label="回放控制"><button id="prev" aria-label="上一步" title="上一步">←</button><button id="play" aria-label="播放" title="播放">▶</button><button id="next" aria-label="下一步" title="下一步">→</button><input id="seek" aria-label="回放进度" type="range" min="0" max="${frames.length - 1}" value="0"><span id="count" aria-live="polite"></span></nav><script>const frames=${encoded};let step=0,timer=null;const view=document.getElementById('view'),seek=document.getElementById('seek'),play=document.getElementById('play'),count=document.getElementById('count');function show(){view.innerHTML=frames[step];seek.value=step;count.textContent='第 '+step+' / '+(frames.length-1)+' 手'}function stop(){clearInterval(timer);timer=null;play.textContent='▶';play.setAttribute('aria-label','播放')}seek.oninput=()=>{stop();step=Number(seek.value);show()};document.getElementById('prev').onclick=()=>{stop();step=Math.max(0,step-1);show()};document.getElementById('next').onclick=()=>{stop();step=Math.min(frames.length-1,step+1);show()};play.onclick=()=>{if(frames.length<2)return;if(timer){stop();return}if(step===frames.length-1){step=0;show()}play.textContent='Ⅱ';play.setAttribute('aria-label','暂停');timer=setInterval(()=>{step++;show();if(step>=frames.length-1)stop()},2500)};document.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();stop();step=Math.max(0,step-1);show()}else if(event.key==='ArrowRight'){event.preventDefault();stop();step=Math.min(frames.length-1,step+1);show()}else if(event.key===' '){event.preventDefault();play.click()}});show()</script></html>`
}
export function reportMarkdown(match) {
  const turns = new Map()
  for (const event of match.events) {
    if (event.type === 'request' || event.type === 'response') turns.set(event.turnId, { ...turns.get(event.turnId), ...event })
  }
  return [`# ${match.title}`, '', `规则：${match.game.description}（${match.game.version}）`, `创建：${match.createdAt}`, `当前调用配置：${executionLabel(match.config?.pace)}`, `状态：${match.status}`, `结果：${match.result?.message || '尚未结束'}`, `模型调用：${match.calls}；已知 Token：${match.tokens}${match.usageUnknown ? '（部分调用未报告用量）' : ''}`, '选手发言仅对观众可见。', '', ...match.players.map((player, i) => `${playerSide(match.game, i)}：${player.provider}/${player.model}；${player.name}；所选推理强度：${player.reasoningEffort || '模型默认'}`), '', ...movesOf(match).map(event => {
    const turn = turns.get(event.turnId)
    return `## 第 ${event.moveNumber} 手 · ${match.players[event.player].name}\n\n${actionLabel(event.action, match.game)} · ${event.elapsedMs} ms\n\n${executionLabel(turn?.pace)} · ${turn?.execution?.label || turn?.model?.reasoningEffort || '模型默认推理'}\n\n${event.speech}\n`
  })].join('\n')
}
export class ArenaExport {
  constructor({ store, scope, render = renderVideo }) { Object.assign(this, { store, scope, render }); this.running = new Set() }
  async start({ id, orientation = 'landscape', secondsPerMove = 3 }) {
    if (!['landscape', 'portrait'].includes(orientation) || !Number.isInteger(secondsPerMove) || secondsPerMove < 2 || secondsPerMove > 8) throw new Error('视频导出设置无效。')
    if (this.running.has(id)) throw new Error('比赛视频正在导出。')
    this.running.add(id)
    let snapshot
    try {
      snapshot = await this.store.update(id, match => {
        if (!['finished', 'cancelled'].includes(match.status) || !movesOf(match).length) throw new Error('请先完成比赛，再导出视频。')
        match.export = { id: randomUUID(), status: 'running', orientation, secondsPerMove, startedAt: new Date().toISOString(), sourceRevision: match.revision }
      })
    } catch (error) { this.running.delete(id); throw error }
    this.scope.background((async () => {
      try {
        await this.render(snapshot, this.store.directory(id), { orientation, secondsPerMove, signal: this.scope.signal })
        await this.store.update(id, match => { match.export = { ...match.export, status: 'succeeded', completedAt: new Date().toISOString() } })
      } catch (error) {
        await this.store.update(id, match => { match.export = { ...match.export, status: 'failed', error: error.message } })
      } finally { this.running.delete(id) }
    })())
    return snapshot
  }
  async chunk({ id, exportId, offset = 0 }) {
    const match = await this.store.get(id)
    if (match.export?.status !== 'succeeded') throw new Error('视频尚未导出成功。')
    if (exportId && exportId !== match.export.id) throw new Error('导出版本已变化，请重新下载。')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('下载偏移无效。')
    const file = join(this.store.directory(id), `${match.export.orientation}.mp4`)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('视频文件无效。')
    if (offset > info.size) throw new Error('下载偏移越界。')
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return { data: buffer.subarray(0, bytesRead).toString('base64'), offset, nextOffset: offset + bytesRead, bytes: info.size, done: offset + bytesRead === info.size }
    } finally { await handle.close() }
  }
}
export async function renderVideo(match, directory, { orientation, secondsPerMove, signal }) {
  signal.throwIfAborted()
  await exec('ffmpeg', ['-version'], { signal })
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, makeCancelSignal } = await import('@remotion/renderer')
  const dir = join(directory, 'render')
  await mkdir(dir, { recursive: true })
  const serveUrl = await bundle({ entryPoint: join(ROOT, 'video.mjs'), outDir: join(dir, 'bundle'), webpackOverride: config => config })
  signal.throwIfAborted()
  const width = orientation === 'landscape' ? 1280 : 720, height = orientation === 'landscape' ? 720 : 1280, fps = 30
  const frames = (movesOf(match).length + 1) * secondsPerMove * fps + 3 * fps
  const temporary = join(directory, `${orientation}.partial.mp4`)
  const { cancelSignal, cancel } = makeCancelSignal()
  const abort = () => cancel()
  signal.addEventListener('abort', abort, { once: true })
  const browserExecutable = process.env.LWB_REMOTION_BROWSER_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  try {
    const props = { match, orientation, secondsPerMove }
    await renderMedia({ serveUrl, composition: { id: 'Arena', width, height, fps, durationInFrames: frames, defaultProps: {}, props, defaultCodec: null, defaultOutName: null, defaultVideoImageFormat: null, defaultPixelFormat: null }, inputProps: props, outputLocation: temporary, codec: 'h264', crf: 23, pixelFormat: 'yuv420p', browserExecutable, cancelSignal, concurrency: 2, chromiumOptions: { gl: 'swiftshader' } })
    signal.throwIfAborted()
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', temporary], { signal })
    const probe = JSON.parse(stdout)
    if (!probe.streams.some(stream => stream.width === width && stream.height === height) || Math.abs(Number(probe.format.duration) - frames / fps) > 1) throw new Error('导出视频未通过尺寸或时长检查。')
    await rename(temporary, join(directory, `${orientation}.mp4`))
    await writeFile(join(directory, 'video-report.json'), `${JSON.stringify(probe, null, 2)}\n`, { mode: 0o600 })
  } finally {
    signal.removeEventListener('abort', abort)
    await rm(dir, { recursive: true, force: true })
    await rm(temporary, { force: true })
  }
}
