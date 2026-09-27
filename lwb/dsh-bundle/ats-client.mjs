import { randomUUID } from 'node:crypto'

const SESSION_REF = 'lwb-ats-session'
const DEFAULT_BASE_URL = 'https://link.scitiger.cn'
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function normalizeBaseUrl(value) {
  const base = text(value) || DEFAULT_BASE_URL
  const url = new URL(base)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('LWB ATS 地址必须使用 HTTPS。')
  return url.href.replace(/\/$/u, '')
}
function errorWithCode(message, code, status) { const error = new Error(message); error.code = code; if (status) error.status = status; return error }

/** Host-owned ATS protocol. Tokens never cross the browser RPC boundary. */
export class LwbAtsClient {
  constructor({ credentials, fetch = globalThis.fetch, baseUrl, deviceId, deviceName } = {}) {
    if (!credentials) throw new Error('LWB ATS 客户端缺少凭据服务。')
    if (typeof fetch !== 'function') throw new Error('LWB ATS 客户端缺少网络服务。')
    this.credentials = credentials; this.fetch = fetch; this.baseUrl = normalizeBaseUrl(baseUrl)
    this.deviceId = text(deviceId) || randomUUID(); this.deviceName = text(deviceName) || 'LWB'; this.refreshing = null
  }
  async readSession() {
    const stored = await this.credentials.resolve(SESSION_REF).catch(() => undefined); const raw = stored?.value
    if (!raw) return null
    try { const session = JSON.parse(raw); return text(session?.accessToken) && text(session?.refreshToken) ? session : null } catch { return null }
  }
  async writeSession(session) {
    const safe = { accessToken: text(session?.accessToken), refreshToken: text(session?.refreshToken), user: session?.user && { id: String(session.user.id), email: text(session.user.email), role: text(session.user.role) } }
    if (!safe.accessToken || !safe.refreshToken) throw errorWithCode('ATS 登录响应缺少会话令牌。', 'LWB_ATS_PROTOCOL_ERROR')
    await this.credentials.set(SESSION_REF, JSON.stringify(safe)); return safe
  }
  async clearSession() { await this.credentials.unset(SESSION_REF).catch(() => undefined) }
  async raw(path, { method = 'GET', body, accessToken } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { method, headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    let payload; try { payload = await response.json() } catch { payload = undefined }
    if (!response.ok) { const message = text(payload?.message) || text(payload?.error) || `ATS 请求失败（${response.status}）。`; throw errorWithCode(message, response.status === 401 ? 'LWB_ATS_UNAUTHORIZED' : 'LWB_ATS_REQUEST_FAILED', response.status) }
    return payload
  }
  async refresh(session) {
    if (!session?.refreshToken) throw errorWithCode('LWB 账号尚未登录。', 'LWB_ATS_NOT_AUTHENTICATED')
    if (!this.refreshing) this.refreshing = this.raw('/api/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName } }).then((next) => this.writeSession(next)).catch(async (error) => { await this.clearSession(); throw error }).finally(() => { this.refreshing = null })
    return this.refreshing
  }
  async request(path, options = {}, retry = true) {
    const session = await this.readSession(); if (!session) throw errorWithCode('请先登录 LWB 账号。', 'LWB_ATS_NOT_AUTHENTICATED')
    try { return await this.raw(path, { ...options, accessToken: session.accessToken }) } catch (error) { if (retry && error?.code === 'LWB_ATS_UNAUTHORIZED') { const next = await this.refresh(session); return this.raw(path, { ...options, accessToken: next.accessToken }) } throw error }
  }
  async login({ account, password }) { return this.writeSession(await this.raw('/api/auth/login', { method: 'POST', body: { account: text(account), password, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName } })) }
  async register({ email, password, confirmPassword, activationCode }) {
    const normalizedActivationCode = text(activationCode)
    const body = { email: text(email), password, confirmPassword, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName }
    if (normalizedActivationCode) body.activationCode = normalizedActivationCode
    const path = normalizedActivationCode ? '/api/auth/register-with-activation' : '/api/auth/register'
    return this.writeSession(await this.raw(path, { method: 'POST', body }))
  }
  async logout() { const session = await this.readSession(); if (session?.refreshToken) await this.raw('/api/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } }).catch(() => undefined); await this.clearSession(); return { ok: true } }
  async status() { const [user, membership, points] = await Promise.all([this.request('/api/auth/me'), this.request('/api/membership/current'), this.request('/api/points/account')]); return { user, membership, points, entitlements: null } }
}
export { DEFAULT_BASE_URL, SESSION_REF, normalizeBaseUrl }
