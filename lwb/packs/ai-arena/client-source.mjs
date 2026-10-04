import React from 'react'
import { Trophy, Settings2, Play, Pause, Square, SkipBack, ChevronDown, ChevronLeft, ChevronRight, ArrowLeft, Download, FileText, Film, RefreshCw, MessageCircle, Radio, Eye } from 'lucide-react'
import { boardSvg, frameAt, movesOf } from './presentation.mjs'
import { CSS } from './styles.mjs'
import { activeMatchCount, useConfirmation } from './confirmation.mjs'
import { turnRecords, turnUsage } from './turn-records.mjs'
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, turnTimedOut, timeoutMessage } from './timeouts.mjs'

const h = React.createElement
let connection, rememberedId = null, arenaEntryMode = 'resume'
const statusLabel = { running: '比赛中', pausing: '回合结算后暂停', paused: '已暂停', finished: '已结束', cancelled: '已取消' }
const MIN_OUTPUT_TOKENS = 128
const MAX_OUTPUT_TOKENS = 393216
const DEFAULT_MODEL_OUTPUT_LIMIT = 32768
const DEFAULT_OUTPUT_TOKENS = 32768
const DEFAULT_TOKEN_BUDGET = 4000000
const MAX_TOKEN_BUDGET = 20000000
const modelOutputLimit = model => {
  const value = [model?.maxOutputTokens, model?.maxTokens, model?.defaultMaxTokens].find(candidate => Number.isInteger(candidate) && candidate >= MIN_OUTPUT_TOKENS)
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(value ?? DEFAULT_MODEL_OUTPUT_LIMIT, MAX_OUTPUT_TOKENS))
}
const api = async (method, request) => {
  const result = await connection.rpc.call('/api', `aiArena/${method}`, { args: request === undefined ? {} : { request } })
  if (!result?.ok) throw new Error(result?.error?.message || '竞技台服务请求失败。')
  return result.value
}
function IconButton({ icon, title, onClick, disabled, ...rest }) { return h('button', { type: 'button', className: 'ar-icon', title, 'aria-label': title, onClick, disabled, ...rest }, h(icon)) }
function Button({ icon, children, primary, className, ...rest }) { return h('button', { type: 'button', className: ['ar-button', primary && 'ar-primary', className].filter(Boolean).join(' '), ...rest }, icon && h(icon), children) }
function Status({ status }) { return h('span', { className: 'ar-tag', 'data-status': status }, h('i'), statusLabel[status] || status) }
function Frame({ tone, kicker, title, subtitle, actions, children }) {
  return h('main', { className: 'ar-page', 'data-tone': tone },
    h('header', { className: 'ar-top' }, h('div', { className: 'ar-top-copy' }, h('p', { className: 'ar-kicker' }, h('i'), kicker), h('h1', null, title), subtitle && h('p', null, subtitle)), actions && h('div', { className: 'ar-top-actions' }, actions)), children)
}
function StatBar({ items }) {
  return h('div', { className: 'ar-stats' }, items.map(item => h('div', { key: item.label, className: 'ar-stat' }, h('span', null, item.label), h('strong', { 'data-tone': item.tone }, item.value), item.detail && h('small', null, item.detail))))
}
function useQuery(method, request, dependency = '') {
  const [value, setValue] = React.useState(null), [error, setError] = React.useState('')
  const live = React.useRef(false), sequence = React.useRef(0)
  const refresh = React.useCallback(() => {
    const ticket = ++sequence.current
    return api(method, request).then(next => { if (live.current && ticket === sequence.current) { setValue(next); setError('') } }).catch(err => { if (live.current && ticket === sequence.current) setError(err.message) })
  }, [method, dependency])
  React.useEffect(() => { live.current = true; refresh(); return () => { live.current = false; sequence.current++ } }, [refresh])
  return { value, error, refresh, setValue }
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Field({ label, children }) { return h('label', { className: 'ar-field' }, h('span', null, label), children) }
function Setup({ onStarted, open, onOpenChange, activeCount = 0 }) {
  const [confirm, confirmation] = useConfirmation()
  const catalog = useQuery('models'), [selected, setSelected] = React.useState(['', ''])
  const [effort, setEffort] = React.useState(['', '']), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
  const [config, setConfig] = React.useState({ maxMoves: 100, maxCalls: 120, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, maxTokens: DEFAULT_OUTPUT_TOKENS, tokenBudget: DEFAULT_TOKEN_BUDGET })
  const customOutputBudget = React.useRef(false)
  const routes = catalog.value || []
  const models = routes.flatMap(route => (route.models || []).map(model => ({ ...model, provider: route.id, providerName: route.name, selectable: route.selectable, reason: route.unavailableReason, key: JSON.stringify([route.id, model.id]) })))
  const selectedModels = selected.map(key => models.find(model => model.key === key)).filter(Boolean)
  const maxTokenLimit = selectedModels.length ? Math.min(...selectedModels.map(modelOutputLimit)) : DEFAULT_MODEL_OUTPUT_LIMIT
  React.useEffect(() => { setConfig(previous => ({ ...previous, maxTokens: customOutputBudget.current ? Math.min(previous.maxTokens, maxTokenLimit) : Math.min(DEFAULT_OUTPUT_TOKENS, maxTokenLimit) })) }, [maxTokenLimit])
  const availabilityNotes = routes.flatMap(route => {
    if (route.unavailableReason) return [{ name: route.name || route.id, reason: route.unavailableReason }]
    if (!route.models?.length) return [{ name: route.name || route.id, reason: route.id === 'lwb' ? '当前没有已授权模型，请先登录 LWB 账号后刷新。' : '当前没有返回可用模型，请检查该模型服务的配置后刷新。' }]
    return []
  })
  const pick = (index, value) => { setSelected(previous => previous.map((item, i) => i === index ? value : item)); setEffort(previous => previous.map((item, i) => i === index ? '' : item)) }
  async function start(event) {
    event.preventDefault()
    if (busy) return
    if (!await confirm({ title: '开始新的五子棋比赛？', description: '确认后将调用参赛模型并记录用量。竞技台展示这场新比赛，其他比赛可在比赛记录中查看。', notice: activeCount > 0 ? `已有 ${activeCount} 场比赛进行中。继续开始将并行运行一场新比赛。` : null, players: selected.map(key => { const model = models.find(item => item.key === key); return model?.name || model?.id }), confirmLabel: '确认开始' })) return
    setBusy(true); setError('')
    try {
      const players = selected.map((key, i) => { const model = models.find(item => item.key === key); return { provider: model.provider, model: model.id, ...(effort[i] ? { reasoningEffort: effort[i] } : {}) } })
      onStarted(await api('start', { gameId: 'gomoku', players, ...config }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return h('details', { className: 'ar-setup', open, onToggle: event => onOpenChange(event.currentTarget.open) }, h('summary', null, h('span', { className: 'ar-setup-title' }, h(Settings2), '参赛配置'), h(ChevronDown, { className: 'ar-setup-chevron' })), h('form', { className: 'ar-form', onSubmit: start },
    h('div', { className: 'ar-participants' }, [0, 1].map(index => {
      const model = models.find(item => item.key === selected[index])
      const groups = routes.map(route => h('optgroup', { key: route.id, label: route.name || route.id }, (route.models || []).map(item => h('option', { key: item.id, value: JSON.stringify([route.id, item.id]), disabled: route.selectable === false, title: route.unavailableReason || undefined }, `${item.name || item.id}${route.selectable === false ? ' · 不可用' : ''}`))))
      return h('div', { key: index, className: 'ar-participant' },
        h('div', { className: 'ar-participant-head' }, h('i', { className: 'ar-stone', 'data-player': index }), index ? '白方选手' : '黑方选手', h('small', null, index ? '后手' : '先手')),
        h(Field, { label: '参赛模型' }, h('select', { 'aria-label': index ? '白方模型' : '黑方模型', value: selected[index], onChange: event => pick(index, event.target.value), required: true }, h('option', { value: '' }, '选择模型'), groups)),
        model?.reasoning?.efforts?.length ? h(Field, { label: '推理强度' }, h('select', { value: effort[index], onChange: event => setEffort(previous => previous.map((item, i) => i === index ? event.target.value : item)) }, h('option', { value: '' }, '模型默认'), model.reasoning.efforts.map(item => h('option', { key: item.id, value: item.id }, item.label || item.id)))) : null)
    })),
    h('details', { className: 'ar-budget' }, h('summary', null, '预算与时限'), h('div', { className: 'ar-settings' }, [['maxMoves', '落子上限', 1, 225], ['maxCalls', '调用上限', 1, 450], ['timeoutSeconds', '单步时限 / 秒', 5, MAX_TIMEOUT_SECONDS], ['maxTokens', '每步生成 Token', MIN_OUTPUT_TOKENS, maxTokenLimit], ['tokenBudget', '累计 Token 上限', 1000, MAX_TOKEN_BUDGET]].map(([key, label, min, max]) => h(Field, { key, label }, h('input', { type: 'number', value: config[key], min, max, required: true, onChange: event => { if (key === 'maxTokens') customOutputBudget.current = true; setConfig(previous => ({ ...previous, [key]: Number(event.target.value) })) } })))), h('p', { className: 'ar-muted' }, `本场单步上限：${maxTokenLimit.toLocaleString()} Token`)),
    catalog.value && availabilityNotes.length > 0 && h('div', { className: 'ar-config-empty' }, h('div', null, h('strong', null, models.some(model => model.selectable !== false) ? '模型服务状态' : '暂无可用模型'), h('ul', null, availabilityNotes.map(note => h('li', { key: `${note.name}:${note.reason}` }, h('b', null, `${note.name}：`), note.reason)))), h(IconButton, { icon: RefreshCw, title: '刷新模型列表', onClick: catalog.refresh })),
    h('div', { className: 'ar-submit' }, h('span', { className: 'ar-muted' }, `${config.maxMoves} 手上限 · 单步 ${config.timeoutSeconds} 秒 · 违规重试一次后判负`), h('button', { className: 'ar-button ar-primary', type: 'submit', disabled: busy || selected.some(key => !models.some(model => model.key === key && model.selectable !== false)) }, h(Play, { size: 16 }), busy ? '准备比赛…' : '开始比赛')),
    (error || catalog.error) && h('div', { className: 'ar-error', role: 'alert' }, error || catalog.error)), confirmation)
}
function Conversation({ match, turnId, renderConversation }) {
  const [player, setPlayer] = React.useState(null), [selected, setSelected] = React.useState(null)
  React.useEffect(() => { setPlayer(null); setSelected(null) }, [turnId])
  const turns = turnRecords(match)
  const following = turns.find(turn => turn.request.turnId === turnId) || turns.at(-1)
  const currentPlayer = player ?? following?.request.player ?? 0
  const choices = turns.filter(turn => turn.request.player === currentPlayer)
  const current = choices.find(turn => turn.request.turnId === selected)
    || (following?.request.player === currentPlayer ? following : choices.at(-1))
  const usage = turnUsage(current?.response?.usage)
  const count = value => value === null || value === undefined ? '—' : value.toLocaleString()
  return h('section', { className: 'ar-conversation', 'aria-label': 'DSH 官方对话' },
    h('div', { className: 'ar-conversation-head' }, h('h2', { className: 'ar-section-title' }, 'DSH 官方对话'), h('span', { className: 'ar-chip' }, '比赛会话 · 只读')),
    h('div', { className: 'ar-actions' }, [0, 1].map(index => h('button', { key: index, type: 'button', className: `ar-button${currentPlayer === index ? ' ar-live' : ''}`, 'aria-pressed': currentPlayer === index, onClick: () => { setPlayer(index); setSelected(null) } }, `${index ? '白方' : '黑方'} · ${match.players[index].name}`)),
      h('select', { className: 'ar-select ar-turn-select', 'aria-label': '查看决策会话', value: current?.request.turnId || '', onChange: event => setSelected(event.target.value) }, choices.map(turn => h('option', { key: turn.request.turnId, value: turn.request.turnId }, `第 ${turn.moveNumber} 手${turn.request.attempt ? ` · 重试 ${turn.request.attempt}` : ''}${turn.error ? ' · 未完成' : ''}`)))),
    h('p', { className: 'ar-muted' }, current?.request.contextMode === 'current-position' || match.config.contextMode === 'current-position' && !current
      ? '每次决策只发送当前棋盘与规则；历史会话保留用于回看。' : '历史比赛沿用选手会话，可查看其中的多轮记录。'),
    h(StatBar, { items: [{ label: '本次输入 Token', value: count(usage?.input), detail: '含缓存输入' }, { label: '缓存命中 Token', value: count(usage?.cacheRead), detail: '已计入输入' }, { label: '本次输出 Token', value: count(usage?.output), detail: '含模型上报的推理用量' }, { label: '本次总 Token', value: count(usage?.total), detail: current?.response ? usage ? '服务商上报用量' : '服务商未返回用量' : current?.error ? '用量未返回' : '等待本次用量' }] }),
    current?.sessionId && renderConversation ? renderConversation({ sessionId: current.sessionId, readOnly: true }) : h('div', { className: 'ar-empty' }, current ? '正在准备会话，或该历史记录没有会话编号。' : '首个决策开始后显示官方对话。'),
    h('details', { className: 'ar-raw' }, h('summary', null, '实际请求参数与原始结果'), h('pre', null, JSON.stringify(current || {}, null, 2))))
}
function MatchView({ id, initial, onChange, renderConversation, activeCount = 0 }) {
  const [confirm, confirmation] = useConfirmation()
  const data = useQuery('match', { id }, id), match = data.value || initial
  const [step, setStep] = React.useState(null), [playing, setPlaying] = React.useState(false), [speed, setSpeed] = React.useState('1')
  const [busy, setBusy] = React.useState(''), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('')
  const [orientation, setOrientation] = React.useState('landscape'), [videoUrl, setVideoUrl] = React.useState(null)
  const [resumeMaxTokens, setResumeMaxTokens] = React.useState(DEFAULT_OUTPUT_TOKENS)
  const [resumeTimeout, setResumeTimeout] = React.useState(DEFAULT_TIMEOUT_SECONDS)
  const [clock, setClock] = React.useState(Date.now())
  const moves = match ? movesOf(match) : [], currentStep = Math.min(step ?? moves.length, moves.length)
  const frame = match ? frameAt(match, currentStep) : null
  const lastError = match?.events.at(-1)?.type === 'error' ? match.events.at(-1) : null
  const timedOut = turnTimedOut(lastError, match?.config.timeoutSeconds)
  React.useEffect(() => {
    if (match?.status === 'paused') setResumeMaxTokens(match.config.maxTokens)
    if (match?.status === 'paused') setResumeTimeout(match.config.pace === 'fast' ? Math.max(DEFAULT_TIMEOUT_SECONDS, match.config.timeoutSeconds) : match.config.timeoutSeconds)
  }, [id, match?.status, match?.config.timeoutSeconds, lastError?.turnId, timedOut])
  React.useEffect(() => { setStep(null); setPlaying(false); setError(''); setNotice(''); setVideoUrl(null) }, [id])
  React.useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  React.useEffect(() => {
    if (!match || (!['running', 'pausing'].includes(match.status) && match.export?.status !== 'running')) return
    const timer = setInterval(data.refresh, 1000)
    return () => clearInterval(timer)
  }, [id, match?.status, match?.export?.status, data.refresh])
  React.useEffect(() => {
    if (!match?.activeTurn?.turnId) return
    setClock(Date.now())
    const timer = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(timer)
  }, [id, match?.activeTurn?.turnId])
  React.useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setStep(previous => { const next = Math.min(moves.length, (previous ?? 0) + 1); if (next === moves.length) setPlaying(false); return next }), 2500 / Number(speed))
    return () => clearInterval(timer)
  }, [playing, moves.length, speed])
  async function run(label, operation) { setBusy(label); setError(''); setNotice(''); try { await operation(); data.refresh(); onChange?.() } catch (err) { setError(err.message) } finally { setBusy('') } }
  async function downloadRecord(format) {
    const result = await api('exportRecord', { id, format })
    saveBlob(new Blob([result.text], { type: `${result.type};charset=utf-8` }), `ai-arena-${id.slice(0, 8)}.${result.extension}`)
    setNotice('比赛记录已导出。')
  }
  async function video(preview) {
    const chunks = []; let offset = 0
    while (true) {
      const part = await api('videoChunk', { id, exportId: match.export.id, offset })
      chunks.push(Uint8Array.from(atob(part.data), char => char.charCodeAt(0)))
      if (part.done) break
      if (part.nextOffset <= offset) throw new Error('视频下载中断。')
      offset = part.nextOffset; setNotice(`正在读取视频 ${Math.floor(offset / part.bytes * 100)}%`)
    }
    const blob = new Blob(chunks, { type: 'video/mp4' })
    if (preview) setVideoUrl(URL.createObjectURL(blob)); else saveBlob(blob, `ai-arena-${id.slice(0, 8)}-${match.export.orientation}.mp4`)
    setNotice('')
  }
  const seek = value => { setPlaying(false); setStep(value) }
  if (!match) return h('div', { className: 'ar-empty' }, data.error || '正在读取比赛…')
  const live = step === null && ['running', 'pausing'].includes(match.status), thinking = live && match.activeTurn?.turnId
  const currentPlayer = thinking ? match.activeTurn.player : frame.current?.player ?? 0
  const elapsedSeconds = thinking ? Math.max(0, (clock - Date.parse(match.activeTurn.startedAt)) / 1000) : 0
  const phaseLabel = { waiting: '等待模型响应', reasoning: '思考中', answering: '正在生成落子与发言' }[match.activeTurn?.phase] || '等待模型响应'
  return h('section', { className: 'ar-match-view', 'data-ar-match': id },
    h('div', { className: 'ar-match-head' }, h('div', null, h('div', { className: 'ar-match-title' }, h('h2', { className: 'ar-section-title' }, '五子棋'), h('span', { className: 'ar-match-count' }, `${activeCount} 场进行中`)), h('p', null, `${new Date(match.createdAt).toLocaleString('zh-CN')} · ${id.slice(0, 8)}`)), h('div', { className: 'ar-actions' }, match.config.pace === 'fast' && h('span', { className: 'ar-chip' }, '历史快棋对局'), h(Status, { status: match.status }),
      match.status === 'running' && h(IconButton, { icon: Pause, title: '回合结束后暂停', disabled: !!busy, onClick: () => run('pause', () => api('control', { id, action: 'pause' })) }),
      ['running', 'pausing', 'paused'].includes(match.status) && h(IconButton, { icon: Square, title: '取消比赛', disabled: !!busy, onClick: async () => { if (await confirm({ title: '取消这场比赛？', description: '取消后停止继续落子，已完成的落子、选手发言和用量记录会保留。', confirmLabel: '确认取消比赛' })) run('cancel', () => api('control', { id, action: 'cancel' })) } }))),
    match.status === 'paused' && h('form', { className: 'ar-resume', onSubmit: event => { event.preventDefault(); run('resume', () => api('control', { id, action: 'resume', timeoutSeconds: resumeTimeout, maxTokens: resumeMaxTokens })) } },
      h(Field, { label: '单步时限 / 秒' }, h('input', { type: 'number', 'aria-label': '继续比赛单步时限', min: 5, max: MAX_TIMEOUT_SECONDS, required: true, value: resumeTimeout, disabled: !!busy, onChange: event => setResumeTimeout(Number(event.target.value)) })),
      h(Field, { label: '每步生成 Token' }, h('input', { type: 'number', 'aria-label': '继续比赛每步输出上限', min: MIN_OUTPUT_TOKENS, max: match.config.maxTokensLimit || DEFAULT_OUTPUT_TOKENS, required: true, value: resumeMaxTokens, disabled: !!busy, onChange: event => setResumeMaxTokens(Number(event.target.value)) })),
      h('button', { className: 'ar-button ar-primary', type: 'submit', disabled: !!busy }, h(Play), '继续比赛')),
    h('div', { className: 'ar-match' }, h('div', { className: 'ar-board-col' },
      h('div', { className: 'ar-scoreboard' }, h(Player, { player: match.players[0], index: 0 }), h('span', { className: 'ar-vs' }, 'VS'), h(Player, { player: match.players[1], index: 1 })),
      h('div', { className: 'ar-board', key: currentStep, dangerouslySetInnerHTML: { __html: boardSvg(frame.moves) } }),
      h('div', { className: 'ar-toolbar' }, h(IconButton, { icon: SkipBack, title: '回到开局', onClick: () => seek(0) }), h(IconButton, { icon: ChevronLeft, title: '上一步', onClick: () => seek(Math.max(0, currentStep - 1)), disabled: currentStep === 0 }), h(IconButton, { icon: playing ? Pause : Play, title: playing ? '暂停回放' : '播放回放', disabled: !moves.length, onClick: () => { if (playing) setPlaying(false); else { if (step === null || currentStep >= moves.length) setStep(0); setPlaying(true) } } }), h(IconButton, { icon: ChevronRight, title: '下一步', onClick: () => seek(Math.min(moves.length, currentStep + 1)), disabled: currentStep === moves.length }),
        h('input', { type: 'range', 'aria-label': '比赛回放进度', min: 0, max: moves.length, value: currentStep, onChange: event => seek(Number(event.target.value)) }), h('span', { className: 'ar-counter' }, `${currentStep} / ${moves.length}`), h('select', { className: 'ar-select', style: { width: 60 }, value: speed, 'aria-label': '回放速度', onChange: event => setSpeed(event.target.value) }, ['0.5', '1', '2', '4'].map(value => h('option', { key: value, value }, `${value}×`))), h(IconButton, { icon: Radio, title: '跟随最新回合', onClick: () => { setPlaying(false); setStep(null) }, className: `ar-icon${step === null ? ' ar-live' : ''}` }))),
      h('aside', { className: 'ar-commentary' }, h('div', { className: 'ar-commentary-head' }, h('h2', { className: 'ar-section-title' }, '选手发言'), h('span', { className: 'ar-chip' }, thinking ? '决策中' : `第 ${currentStep} 手`)),
        h('div', { className: 'ar-speaking', 'data-thinking': !!thinking }, h('div', { className: 'ar-speaking-name' }, h(MessageCircle), match.players[currentPlayer].name), h('p', { role: thinking ? 'status' : undefined }, thinking ? phaseLabel : frame.current?.speech || '等待第一步落子'), thinking ? h('div', { className: 'ar-generation' }, h('div', null, h('small', null, match.players[currentPlayer].reasoningEffort ? `推理强度：${match.players[currentPlayer].reasoningEffort}` : '模型默认推理'), h('small', null, `${elapsedSeconds.toFixed(1)} / ${match.config.timeoutSeconds} 秒`)), h('progress', { 'aria-label': '本步已用时间', value: Math.min(elapsedSeconds, match.config.timeoutSeconds), max: match.config.timeoutSeconds })) : frame.current && h('small', null, `${frame.current.action.row} 行 ${frame.current.action.col} 列 · ${(frame.current.elapsedMs / 1000).toFixed(1)} 秒`)),
        frame.result && h('div', { className: 'ar-result' }, h(Trophy), frame.result.message),
        h('div', { className: 'ar-transcript-title' }, h('span', null, '回合记录'), h('span', null, `${frame.speech.length} 条`)),
        h('div', { className: 'ar-transcript' }, frame.speech.length ? frame.speech.map(event => h('button', { key: event.turnId, className: 'ar-speech', onClick: () => seek(event.moveNumber), 'aria-label': `查看第 ${event.moveNumber} 手` }, h('div', { className: 'ar-speech-head' }, h('span', { className: 'ar-speech-num' }, event.moveNumber), h('strong', null, match.players[event.player].name), h('small', null, `${event.action.row} 行 ${event.action.col} 列`)), h('p', null, event.speech))) : h('div', { className: 'ar-empty' }, '暂无回合记录')))),
    h(StatBar, { items: [{ label: '已完成落子', value: moves.length, detail: `上限 ${match.config.maxMoves} 手`, tone: 'brand' }, { label: '模型调用', value: match.calls, detail: `上限 ${match.config.maxCalls} 次` }, { label: '累计 Token', value: match.tokens.toLocaleString(), detail: match.usageUnknown ? '用量不完整' : `预算 ${match.config.tokenBudget.toLocaleString()}` }, { label: '比赛状态', value: statusLabel[match.status] || match.status, tone: match.status === 'finished' ? 'green' : undefined }] }),
    (error || data.error) && h('p', { className: 'ar-error', role: 'alert' }, error || data.error),
    lastError && h('p', { className: 'ar-error', role: 'alert' }, timedOut ? timeoutMessage(match.players[lastError.player]?.name || '模型', match.config.timeoutSeconds) : lastError.error),
    h('div', { className: 'ar-export' }, h('div', { className: 'ar-actions' }, h(Button, { icon: FileText, disabled: !!busy, onClick: () => run('report', () => downloadRecord('markdown')) }, '战报'), h(Button, { icon: Download, disabled: !!busy, onClick: () => run('json', () => downloadRecord('json')) }, '完整记录'), h(Button, { icon: Play, disabled: !!busy, onClick: () => run('html', () => downloadRecord('html')) }, '离线回放')),
      h('div', { className: 'ar-actions' }, h('label', null, '视频', h('select', { className: 'ar-select', value: orientation, 'aria-label': '视频画幅', onChange: event => setOrientation(event.target.value) }, h('option', { value: 'landscape' }, '横屏 16:9'), h('option', { value: 'portrait' }, '竖屏 9:16'))), h(Button, { icon: Film, disabled: !!busy || match.export?.status === 'running' || !['finished', 'cancelled'].includes(match.status) || !moves.length, onClick: () => run('render', () => api('exportVideo', { id, orientation })) }, match.export?.status === 'running' ? '渲染中…' : '导出 MP4'), match.export?.status === 'succeeded' && h(React.Fragment, null, h(IconButton, { icon: Eye, title: '预览成片', disabled: !!busy, onClick: () => run('preview', () => video(true)) }), h(IconButton, { icon: Download, title: '下载 MP4', disabled: !!busy, onClick: () => run('video', () => video(false)) })))),
    match.export?.status === 'failed' && h('p', { className: 'ar-error' }, match.export.error), notice && h('p', { className: 'ar-notice', role: 'status' }, notice), videoUrl && h('video', { className: 'ar-video', src: videoUrl, controls: true }),
    h(Conversation, { match, turnId: step === null ? match.events.findLast(event => event.type === 'request')?.turnId : frame.current?.turnId, renderConversation }), confirmation)
}
function Player({ player, index }) { return h('div', { className: 'ar-player' }, h('i', { className: 'ar-stone', 'data-player': index }), h('div', null, h('strong', null, player.name), h('small', null, `${index ? '白方 · 后手' : '黑方 · 先手'} / ${player.providerName}`))) }
function Arena({ renderConversation }) {
  const [freshEntry] = React.useState(() => arenaEntryMode === 'fresh')
  const [id, setId] = React.useState(null), [initial, setInitial] = React.useState(null), [setup, setSetup] = React.useState(freshEntry)
  const matchesData = useQuery('matches'), matches = matchesData.value || [], activeCount = activeMatchCount(matches)
  React.useEffect(() => { if (freshEntry || id) return; if (!matches.length) { setSetup(true); return } const latest = matches[0]; setId(latest.id); rememberedId = latest.id; setSetup(false) }, [freshEntry, id, matches])
  React.useEffect(() => { const timer = setInterval(matchesData.refresh, 2000); return () => clearInterval(timer) }, [matchesData.refresh])
  React.useEffect(() => { if (freshEntry) arenaEntryMode = 'resume' }, [freshEntry])
  const displayedActiveCount = initial && ['running', 'pausing'].includes(initial.status) && !matches.some(match => match.id === initial.id) ? activeCount + 1 : activeCount
  return h(Frame, { tone: 'orange', kicker: '模型对战', title: 'AI竞技台', subtitle: '五子棋 · 15 × 15 · 自由规则 · 连五及以上获胜', actions: h(Button, { primary: true, className: 'ar-config-button', icon: Settings2, onClick: () => setSetup(previous => !previous) }, '参赛配置') }, h(Setup, { open: setup, onOpenChange: setSetup, activeCount, onStarted: match => { setInitial(match); setId(match.id); rememberedId = match.id; setSetup(false); matchesData.refresh() } }),
    id ? h(MatchView, { key: id, id, initial, activeCount: displayedActiveCount, renderConversation }) : h('div', { className: 'ar-match' }, h('div', { className: 'ar-board-col' }, h('div', { className: 'ar-scoreboard' }, h(Player, { index: 0, player: { name: '待选模型', providerName: '未参赛' } }), h('span', { className: 'ar-vs' }, 'VS'), h(Player, { index: 1, player: { name: '待选模型', providerName: '未参赛' } })), h('div', { className: 'ar-board', dangerouslySetInnerHTML: { __html: boardSvg([]) } })), h('aside', { className: 'ar-commentary' }, h('div', { className: 'ar-commentary-head' }, h('h2', { className: 'ar-section-title' }, '选手发言'), h('span', { className: 'ar-chip' }, '未开始')), h('div', { className: 'ar-speaking', 'data-thinking': true }, h('div', { className: 'ar-speaking-name' }, h(MessageCircle), '等待参赛选手'), h('p', null, '比赛尚未开始')), h('div', { className: 'ar-transcript-title' }, '回合记录'), h('div', { className: 'ar-empty' }, activeCount ? `已有 ${activeCount} 场比赛进行中，可在比赛记录中查看。` : '暂无回合记录'))))
}
function History({ renderConversation }) {
  const list = useQuery('matches'), [id, setId] = React.useState(null), [search, setSearch] = React.useState(''), [status, setStatus] = React.useState('')
  React.useEffect(() => { const timer = setInterval(list.refresh, 2000); return () => clearInterval(timer) }, [list.refresh])
  const matches = list.value || [], filtered = matches.filter(match => (!status || match.status === status) && `${match.title} ${match.id}`.toLowerCase().includes(search.trim().toLowerCase()))
  if (id) return h(Frame, { tone: 'cyan', kicker: '比赛记录', title: '比赛回放', subtitle: matches.find(match => match.id === id)?.title, actions: h(Button, { primary: true, className: 'ar-back-button', icon: ArrowLeft, onClick: () => setId(null) }, '返回记录') }, h(MatchView, { key: id, id, activeCount: activeMatchCount(matches), onChange: list.refresh, renderConversation }))
  return h(Frame, { tone: 'cyan', kicker: '对战档案', title: '比赛记录', subtitle: '五子棋', actions: h(IconButton, { icon: RefreshCw, title: '刷新比赛记录', onClick: list.refresh }) }, list.error && h('p', { className: 'ar-error' }, list.error),
    h(StatBar, { items: [{ label: '全部比赛', value: matches.length, tone: 'brand' }, { label: '正在比赛', value: activeMatchCount(matches) }, { label: '已结束', value: matches.filter(match => match.status === 'finished').length, tone: 'green' }, { label: '累计落子', value: matches.reduce((total, match) => total + match.moves, 0) }] }),
    h('div', { className: 'ar-history-toolbar' }, h('h2', { className: 'ar-section-title' }, '对战记录'), h('div', { className: 'ar-actions' }, h('input', { className: 'ar-search', type: 'search', placeholder: '搜索模型或比赛编号', 'aria-label': '搜索比赛', value: search, onChange: event => setSearch(event.target.value) }), h('select', { className: 'ar-select', 'aria-label': '比赛状态筛选', value: status, onChange: event => setStatus(event.target.value) }, h('option', { value: '' }, '全部状态'), Object.entries(statusLabel).map(([value, label]) => h('option', { key: value, value }, label))))),
    filtered.length ? h('nav', { className: 'ar-history-list', 'aria-label': '历史比赛' }, h('div', { className: 'ar-history-columns', 'aria-hidden': true }, h('span', null, '参赛选手'), h('span', null, '比赛时间'), h('span', null, '落子'), h('span', null, '状态'), h('span')), filtered.map(match => h('button', { key: match.id, className: 'ar-row', onClick: () => setId(match.id), 'aria-label': `回放 ${match.title} · ${match.moves} 手` }, h('span', { className: 'ar-row-title' }, h('strong', null, match.title), h('small', null, `五子棋 · ${match.id.slice(0, 8)}`)), h('span', { className: 'ar-row-date' }, new Date(match.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })), h('span', { className: 'ar-row-count' }, `${match.moves} 手`), h(Status, { status: match.status }), h(ChevronRight)))) : h('div', { className: 'ar-empty' }, h(Trophy), list.value ? search || status ? '没有符合条件的比赛' : '暂无比赛记录' : '正在读取比赛记录…'))
}
function Games({ openPackMenu }) {
  const [confirm, confirmation] = useConfirmation()
  const games = useQuery('games'), matches = useQuery('matches'), activeCount = activeMatchCount(matches.value || [])
  React.useEffect(() => { const timer = setInterval(matches.refresh, 2000); return () => clearInterval(timer) }, [matches.refresh])
  const example = [{ row: 8, col: 8, player: 0 }, { row: 8, col: 9, player: 1 }, { row: 7, col: 8, player: 0 }, { row: 9, col: 8, player: 1 }, { row: 6, col: 8, player: 0 }]
  const enterArena = async () => {
    if (!await confirm({ title: '准备一场新的五子棋比赛？', description: '确认后进入全新棋盘，再选择参赛模型和比赛配置。历史比赛保留在比赛记录中。', notice: activeCount > 0 ? `已有 ${activeCount} 场比赛进行中，进入新棋盘不会中断这些比赛。` : null, confirmLabel: '进入竞技台' })) return
    rememberedId = null; arenaEntryMode = 'fresh'; openPackMenu?.('arena')
  }
  return h(Frame, { tone: 'violet', kicker: '竞技游戏', title: '游戏库', subtitle: `${games.value?.length || 0} 款游戏` }, games.error && h('p', { className: 'ar-error' }, games.error), h('div', { className: 'ar-game-grid' }, (games.value || []).map(game => h('article', { key: game.id, className: 'ar-game' }, h('div', { className: 'ar-game-preview', dangerouslySetInnerHTML: { __html: boardSvg(example) } }), h('div', { className: 'ar-game-body' }, h('div', { className: 'ar-game-title' }, h('h2', null, game.name), h('span', { className: 'ar-chip', 'data-tone': 'page' }, '可竞技')), h('p', { className: 'ar-game-rule' }, game.description), h('div', { className: 'ar-game-facts' }, h('span', { className: 'ar-chip' }, '15 × 15'), h('span', { className: 'ar-chip' }, `${game.players} 位选手`), h('span', { className: 'ar-chip' }, '黑方先手')), h('div', { className: 'ar-game-footer' }, h('span', null, `规则版本 ${game.version}`), h(Button, { primary: true, icon: Play, onClick: enterArena }, '开始比赛')))))), confirmation)
}
export function apply(ctx) {
  connection = ctx.connection
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = '@scitiger-ai/lwb-ai-arena'; style.textContent = CSS; document.head.append(style)
    return () => style.remove()
  }, 'ai-arena: styles')
  ctx.effect(() => ctx.lwbPackClient.register({ packId: 'ai-arena', pages: { games: Games, arena: Arena, history: History } }), 'ai-arena: pages')
}
export const inject = ['lwbPackClient', 'connection']
