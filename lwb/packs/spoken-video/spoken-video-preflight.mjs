// Copied into each video workspace: the creator and host use this same checker.
import { parse } from '@babel/parser'
import postcss from 'postcss'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const motionProperty = (name) => /^(?:animation|animationname|transition|transitionproperty)$/u.test(String(name).replace(/^(?:-webkit-|-moz-|-o-|Webkit|Moz|O)/u, '').replaceAll('-', '').toLowerCase())
const literal = (node) => ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type) ? literal(node.expression) : node?.type === 'StringLiteral' ? node.value : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null
const propertyName = (node) => node?.type === 'Identifier' ? node.name : literal(node)

/** Static checks of authored TSX. Locations point to the actual declaration, not a comment. */
export function inspectCreativeSource(source) {
  const findings = []
  const report = (code, node, message) => findings.push({ code, file: 'src/CreativeVideo.tsx', line: node?.loc?.start?.line || 1, column: (node?.loc?.start?.column || 0) + 1, message })
  let ast
  try { ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) }
  catch (error) {
    report('syntax', { loc: { start: error.loc } }, `TSX 语法错误：${error.message}`)
    return findings
  }
  let frameDriven = false
  const checkMotion = (name, value, node) => {
    if (!motionProperty(name)) return
    if (typeof value === 'string' && value.trim().toLowerCase() === 'none') return
    report('css-motion', node, `${name}: ${value === null ? '动态值' : JSON.stringify(value)} 使用了浏览器计时动画；请删除该声明、显式设为 "none"，或改用 Remotion 帧驱动。`)
  }
  const cssText = (node) => {
    if (node?.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked || '').join('__dynamic__')
    return literal(node)
  }
  const checkCss = (text, node) => {
    if (typeof text !== 'string') return
    try {
      const css = postcss.parse(text)
      css.walkDecls((decl) => {
        checkMotion(decl.prop, decl.value.replace(/\s*!important\s*$/iu, ''), { loc: { start: { line: (node.loc?.start?.line || 1) + (decl.source?.start?.line || 1) - 1, column: (decl.source?.start?.column || 1) - 1 } } })
      })
    } catch (error) { report('css-syntax', node, `样式块无法检查：${error.reason || error.message}`) }
  }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && ['useCurrentFrame', 'interpolate', 'spring'].includes(node.callee.name)) frameDriven = true
    if (node.type === 'JSXOpeningElement' && node.name?.name === 'Sequence') frameDriven = true
    if (node.type === 'JSXAttribute' && node.name?.name === 'data-agent-placeholder' && literal(node.value) === 'true') report('placeholder', node, '视频 Agent 未替换初始占位画面。')
    if (node.type === 'ObjectProperty' && (!node.computed || literal(node.key) !== null)) checkMotion(propertyName(node.key), literal(node.value), node)
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression') {
      const member = node.left
      if (!member.computed || literal(member.property) !== null) checkMotion(propertyName(member.property), literal(node.right), node)
    }
    if (node.type === 'JSXElement' && node.openingElement.name?.name === 'style') {
      for (const child of node.children) checkCss(child.type === 'JSXText' ? child.value : cssText(child.expression), child)
    }
    if (node.type === 'TaggedTemplateExpression' && (node.tag?.name === 'css' || node.tag?.object?.name === 'styled')) checkCss(cssText(node.quasi), node.quasi)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast.program)
  if (!frameDriven) report('frame-driven', null, '创意画面没有使用 Remotion 帧驱动动画。')
  if (source.length < 900) report('incomplete', null, '创意画面实现过于简单，未达到完整视频构图要求。')
  return findings
}

export async function inspectAgentProject(workspace) {
  const findings = []
  for (const [file, expected] of Object.entries(workspace.protected)) {
    const source = await readFile(join(workspace.projectDir, file), 'utf8').catch(() => null)
    if (source === null || createHash('sha256').update(source).digest('hex') !== expected) findings.push({ code: 'protected-file', file, line: 1, column: 1, message: `受保护文件 ${file} 被修改或丢失。` })
  }
  const creativeSource = await readFile(workspace.creativeFile, 'utf8').catch(() => '')
  if (!creativeSource.trim()) findings.push({ code: 'empty', file: 'src/CreativeVideo.tsx', line: 1, column: 1, message: 'CreativeVideo.tsx 为空。' })
  else findings.push(...inspectCreativeSource(creativeSource))
  return {
    passed: findings.length === 0,
    repairable: findings.length > 0 && findings.every((item) => item.code !== 'protected-file'),
    findings,
    failures: findings.map((item) => `${item.file}:${item.line}:${item.column} ${item.message}`),
    creativeBytes: Buffer.byteLength(creativeSource), creativeSource,
  }
}

// The installed workspace copy is a CLI; imports by the host have no side effects.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(await readFile(join(projectDir, 'preflight-manifest.json'), 'utf8'))
  const result = await inspectAgentProject({ projectDir, creativeFile: join(projectDir, 'src/CreativeVideo.tsx'), protected: manifest.protected })
  const { creativeSource, ...report } = result
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = result.passed ? 0 : 1
}
