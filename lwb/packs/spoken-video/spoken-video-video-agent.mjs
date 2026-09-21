const REVIEW_FINDING_LIMIT = 12

function clipped(value, maximum) {
  const text = String(value || '').trim()
  return text.length > maximum ? text.slice(0, maximum) : text
}

export const VIDEO_REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    technicalPass: { type: 'boolean' },
    editorialPass: { type: 'boolean' },
    score: { type: 'integer', description: '0 到 100 的整数评分；范围由主机强制校验' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      description: `审核问题，主机最多接受 ${REVIEW_FINDING_LIMIT} 项`,
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] },
          category: { type: 'string', enum: ['technical', 'composition', 'readability', 'pacing', 'relevance', 'variation'] },
          timestampSeconds: { type: 'number', description: '非负的成片时间点（秒）；范围由主机强制校验' },
          message: { type: 'string' },
        },
        required: ['severity', 'category', 'message'],
        additionalProperties: false,
      },
    },
    reviewEvidence: {
      type: 'array',
      description: '必须提供 2 到 8 项不同抽帧时间点的观察证据；数量由主机强制校验',
      items: {
        type: 'object',
        properties: {
          timestampSeconds: { type: 'number', description: '非负的已提供抽帧时间点（秒）；范围由主机强制校验' },
          observedMainVisual: { type: 'string' },
        },
        required: ['timestampSeconds', 'observedMainVisual'],
        additionalProperties: false,
      },
    },
  },
  required: ['passed', 'technicalPass', 'editorialPass', 'score', 'summary', 'findings', 'reviewEvidence'],
  additionalProperties: false,
})

export function buildVideoCreatorPrompt({ runDir }) {
  return [
    '你是本次口播视频的 AI 视觉导演与 Remotion 实现者。你的任务不是输出分镜建议，而是直接完成可渲染的 Remotion 创意工程。',
    `任务工作目录：${runDir}`,
    '首先完整读取 task.json、inputs/draft.json、inputs/subtitles.srt，以及 task.json.skillPaths 指向的 remotion-best-practices 和 content-video 两份 SKILL.md。随后按 Remotion skill 的路由读取本任务需要的 subtitles、sequencing、timing、transitions 和 ffmpeg 规则。',
    '只允许修改 src/CreativeVideo.tsx。不得修改 Root.tsx、DeterministicSrtSubtitles.tsx、index.ts、task-props.json、输入文件或技能文件。字幕、配音与可选 BGM 混音由受保护外壳负责。',
    '直接根据完整稿件与字幕时间轴决定叙事节拍、视觉隐喻、场景边界、图表、流程、对比、模拟界面和转场。不要输出固定模板参数，也不要把视频做成连续文字卡片。',
    '视觉风格默认明亮、清晰、通透，适合知识讲解。除非 task.json.visualBrief 明确要求其他风格，优先使用浅色或中高明度背景，以清晰的深色文字、轮廓和少量主题强调色建立层次；亮色背景上的文字、图形与连线也必须有足够对比。不要因为主题涉及 AI、科技或软件，就自动采用黑底、深蓝仪表盘、霓虹光效或暗色卡片网格。高对比不等于明亮，不能仅凭黑底白字就视为满足默认视觉方向。深色可用于有语义动机的局部对比或重点强调，但不应成为整片的惯性底色。',
    '在开始实现时，根据本篇稿件确定协调的背景色、文字色、强调色与视觉隐喻，直接落实到创意代码；配色应服务内容，不要给所有主题套用同一套科技配色，也不要为了变化逐场景任意换色。保持主体与背景层次分明、线条和文字边缘清晰，避免低对比的灰字、模糊光晕或大面积装饰渐变削弱信息辨识；明亮不等于低对比粉彩或刺眼的高饱和铺底。这些选择在现有创作过程中完成，无需另写设计文档或增加制作阶段。',
    '画面默认不依赖外部素材、远程 URL、额外 API Key 或人工补充素材。优先使用 React、CSS 图形、程序化图表、图标化结构、数据动画、对象隐喻和状态变化完成主题相关表达。禁止抓取未授权网络素材。',
    '主画面必须与口播语义对应：机制用流程或状态变化表达，对比同时展示两侧，数字使用视觉强调，结论应形成可回忆的收束画面。字幕变化不等于主场景变化。',
    '构图以一个清楚的视觉焦点为主，让关键对象与关系占据足够画面；留白服务层次，不要把小图和细字缩在大面积空白中。主画面文案保留关键词和短句，复杂信息按讲解顺序逐步展开。显式设置统一的中文无衬线字体族（如 PingFang SC、Microsoft YaHei、Noto Sans CJK SC、sans-serif），使用本地可用字体。以短边 1080px 的成片为参考，标题通常 56–80px，关键标签和结论通常 36–48px，必要辅助说明尽量不低于 28px；这是视觉设计参考，需按横竖屏可用宽度与实际显示尺寸调整。信息放不下时优先精简、分步呈现或调整构图，不要靠缩小关键文字硬塞，也不要修改受保护字幕来配合主画面。',
    '动画应随字幕时间轴中的语义节点推进：讲到哪一步，就让相关对象移动、连接、改变状态或成为视觉焦点。长段落复用同一组对象逐步解释，避免在开头几秒展示完所有信息后，让余下大段口播只剩静止画面；也不要用持续漂浮、旋转、闪烁或机械定时切镜冒充内容推进。保留必要阅读停顿，关键数字与结论给足辨认时间；相邻观点尽量通过对象延续或状态转换衔接，避免每次都整屏淡入重置。',
    '让视觉承担解释，而不是给文字加装饰。优先用主题相关的简洁对象、流程动作、条件分支、前后状态或模拟操作呈现例子；例如权限限制可表现为请求被阻断，跨应用操作可表现为信息在对象之间传递，但不要把这些例子套用到所有题材。卡片用于必要分组，Emoji 只作少量辅助；避免反复使用编号标题加卡片网格、Emoji 加文字条的版式。图形保持统一的线条、形状与色彩语言，开场尽快呈现具体问题或反差，结尾用已出现的核心对象收束观点。',
    '视觉信息必须忠实于稿件。只有稿件或所提供材料有明确数值及比较依据时，才使用定量图表、评分、百分比、雷达图或带数值意义的进度条；不得为了画面丰富自行编造能力分数、比例、趋势或精确刻度。定性观点用条件、边界、状态或不带量化暗示的对比表达。模拟界面与示意场景应能辨认为示意，不得伪装成真实截图、实测结果或新增事实。按语义选择视觉形式，不为满足数量配额强行添加图表、SVG 动画或额外场景。',
    '使用 useCurrentFrame、interpolate、spring、Sequence 等帧驱动能力。所有延迟出现的前景 Sequence 必须有 durationInFrames；禁止由浏览器计时的 CSS animation 和 transition；明确关闭动画的 none 值允许，通常直接省略这些属性。',
    '横竖屏、安全区、视频时长和字幕策略以 task.json 为准。竖屏时必须避开底部字幕与平台信息区、右侧交互区；任何文本不得溢出或遮挡。',
    '不要先在回复或推理中完整展开全片的逐场景坐标、帧数和代码。完成必要读取后，必须尽快调用文件工具，把 src/CreativeVideo.tsx 从占位内容改成覆盖完整时长的最小可编译版本；随后分批完善场景并持续写回文件。工作进度以文件为准，不以文字方案为准。',
    '每次只规划当前准备落盘的一小批场景。较长视频应先建立完整场景骨架，再逐批补充细节；不要把所有场景的实现细节积压到一次超长模型输出中。',
    '完成后必须运行 task.json.commands.check（node scripts/preflight.mjs），这是主流程使用的同一套预检规则；失败时按文件行号修正并重查，不要自写正则冒充预检。还必须用 task.json.commands.still 追加 --frame 和 --scale 参数，至少检查开头、中段、结尾三个代表帧；视频超过 120 秒时，再检查两个场景交界附近的帧。重点确认主体没有长期挤在上半部或留下无意义大面积空白、连接线与组件没有压叠、不同语义段没有退化为同一套卡片版式。只使用工程已有的本地命令，不使用 npx 下载工具，不修改共享依赖或缓存权限。任务 node_modules/.cache 是独立可写缓存。不要改变 task.json 指定的最终输出路径。最后只需简要说明已经实现的视觉语言与检查结果；真正产物以工作区文件为准。',
  ].join('\n\n')
}

/** Prompt used only when the same creator session hit one response-output ceiling. */
export function buildVideoCreatorContinuationPrompt({ attempt, maximum }) {
  return [
    `上一轮达到单次输出上限，正在同一视频创作会话中继续（${attempt}/${maximum}）。`,
    '不要重新读取全部资料，不要复述或重新展开全片方案。先检查 src/CreativeVideo.tsx 的实际内容，立即从现有进度继续写入。',
    '如果文件仍是占位版本，先写出覆盖完整时长的最小可编译实现；如果已有部分实现，直接完成缺失场景。完成后运行低成本编译检查，并确认 data-agent-placeholder 已移除。',
  ].join('\n\n')
}

export function buildVideoCreatorRepairPrompt({ runDir, report, attempt, maximum }) {
  return [
    `渲染前检查未通过，正在原视频创作会话中修复（${attempt}/${maximum}）。`,
    `任务工作目录：${runDir}`,
    ...report.failures.map((failure) => `- ${failure}`),
    '保留已有场景、时间轴和创意，只修正上述问题。只允许修改 src/CreativeVideo.tsx，不得修改受保护外壳、检查器或检查清单。',
    '使用帧驱动动画；不需要 CSS 过渡时删除属性或明确使用 none。完成后运行 node scripts/preflight.mjs，确认检查通过。不要重建整个工程或重新生成上游素材。',
  ].join('\n\n')
}

export function buildVideoEditorialRepairPrompt({ runDir, review, frameFiles, timestamps, attempt, maximum }) {
  const evidence = (Array.isArray(review?.reviewEvidence) ? review.reviewEvidence : []).slice(0, 8).map((item) => ({
    timestampSeconds: item.timestampSeconds,
    observedMainVisual: clipped(item.observedMainVisual, 600),
  }))
  const findings = (Array.isArray(review?.findings) ? review.findings : []).slice(0, REVIEW_FINDING_LIMIT).map((item) => ({
    severity: item.severity,
    category: item.category,
    timestampSeconds: item.timestampSeconds,
    message: clipped(item.message, 500),
  }))
  return [
    `独立审片未通过，正在进行定向视觉修复（${attempt}/${maximum}）。`,
    `任务工作目录：${runDir}`,
    '继续现有 Remotion 工程。先读取 task.json、inputs/draft.json 和 src/CreativeVideo.tsx，再查看下面列出的本轮成片抽帧。只允许修改 src/CreativeVideo.tsx；不得修改字幕、配音、受保护外壳、预检器或输入文件。',
    `本轮抽帧：\n${frameFiles.map((file, index) => `- ${timestamps[index]} 秒：${file}`).join('\n')}`,
    `审片结果：\n${JSON.stringify({ score: review?.score, summary: clipped(review?.summary, 1000), findings, reviewEvidence: evidence }, null, 2)}`,
    '逐项修复 blocker 和 major 问题。问题涉及重复版式时，必须改变对应段落的视觉表达和空间结构，不能只换颜色或文字；问题涉及大面积无意义留白时，应重新分配主体尺度和垂直构图；问题涉及压叠、悬空连线或关系不可读时，应修正布局与元素生命周期。保留已经有效的场景，不要无关重做整片。',
    '修复必须落实到实际代码和完整时间轴。不要删除有问题的内容来规避审片，也不要修改字幕或稿件。完成后运行 node scripts/preflight.mjs，并用 task.json.commands.still 在问题时间点附近检查代表帧；本阶段不要自行渲染完整成片，主流程会统一重渲染和复审。',
  ].join('\n\n')
}

export function buildVideoReviewerPrompt({ runDir, technicalReportFile, frameFiles, timestamps }) {
  return [
    '你是独立的视频成片审核 Agent，不是创作者。你与创作会话相互独立，不得修改任何文件、不得重新渲染、不得替创作者解释问题。',
    `任务工作目录：${runDir}`,
    `先读取 task.json、inputs/draft.json、${technicalReportFile}，再逐张查看以下从最终成片提取的全帧图片：\n${frameFiles.map((file, index) => `- ${timestamps[index]} 秒：${file}`).join('\n')}`,
    '技术报告是音轨、尺寸、帧率、时长和画面变化的确定性事实，不得用主观判断推翻。若技术报告未通过，technicalPass 必须为 false。',
    '重点审核：主画面是否忠实对应稿件；是否具有清楚的视觉叙事与场景变化；机制、对比、数字和结论是否被视觉化；是否退化成文字卡片；横竖屏构图、字幕安全区、可读性和信息密度是否合格。',
    '通过条件：technicalPass 与 editorialPass 都为 true，score 不低于 70，且 reviewEvidence 至少引用两个不同的已提供时间点并具体描述当时看到的主画面。无法从抽帧确认的内容不得臆测。',
    '发现 blocker 或 major 问题时必须判定 editorialPass=false、passed=false。失败结果会交回视觉导演做有界定向修复，因此必须写明准确时间点、实际看到的画面和可执行的问题描述。',
    '严格返回 schema 要求的结构化审核结果，不输出 Markdown 或额外说明。',
  ].join('\n\n')
}

function nearestSample(value, samples) {
  const number = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(number) || number < 0 || !samples.length) return null
  return samples.reduce((best, sample) => Math.abs(sample - number) < Math.abs(best - number) ? sample : best, samples[0])
}

/** Reconcile model judgement with deterministic gates and evidence requirements. */
export function normalizeVideoReview(value, { technicalPassed, sampledTimestamps } = {}) {
  const samples = Array.isArray(sampledTimestamps) ? sampledTimestamps.map(Number).filter((item) => Number.isFinite(item) && item >= 0) : []
  const findings = (Array.isArray(value?.findings) ? value.findings : []).slice(0, REVIEW_FINDING_LIMIT).map((item) => ({
    severity: ['blocker', 'major', 'minor', 'note'].includes(item?.severity) ? item.severity : 'major',
    category: ['technical', 'composition', 'readability', 'pacing', 'relevance', 'variation'].includes(item?.category) ? item.category : 'composition',
    timestampSeconds: nearestSample(item?.timestampSeconds, samples),
    message: clipped(item?.message, 500) || '审核发现未提供具体说明。',
  }))
  const evidence = (Array.isArray(value?.reviewEvidence) ? value.reviewEvidence : []).slice(0, 8).map((item) => ({
    timestampSeconds: nearestSample(item?.timestampSeconds, samples),
    observedMainVisual: clipped(item?.observedMainVisual, 600),
  })).filter((item) => item.timestampSeconds !== null && item.observedMainVisual.length >= 12)
  const distinctEvidence = new Set(evidence.map((item) => item.timestampSeconds.toFixed(2))).size
  const score = Number.isSafeInteger(value?.score) && value.score >= 0 && value.score <= 100 ? value.score : 0
  const technicalPass = technicalPassed === true && value?.technicalPass === true
  const editorialPass = value?.editorialPass === true && !findings.some((item) => ['blocker', 'major'].includes(item.severity))
  const passed = technicalPass && editorialPass && score >= 70 && distinctEvidence >= 2 && value?.passed === true
  return {
    passed,
    technicalPass,
    editorialPass,
    score,
    summary: clipped(value?.summary, 1000) || (passed ? '视频通过独立审核。' : '视频未通过独立审核。'),
    findings,
    reviewEvidence: evidence,
    evidencePassed: distinctEvidence >= 2,
  }
}
