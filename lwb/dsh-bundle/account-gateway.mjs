import { randomUUID } from 'node:crypto'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
const remoteInitializers = []
const PAYMENT_ROUTE = '/lwb/ats/payment'
const PAYMENT_FORM_TTL_MS = 10 * 60 * 1000

function decorateRemote(prototype, method, exportName) { const decorate = Remote(exportName); decorate(prototype[method], { kind: 'method', name: method, static: false, private: false, addInitializer(initializer) { remoteInitializers.push(initializer) } }) }
/** Browser-safe LWB account projection. Tokens stay in the Host credentials store. */
export class LwbAccountGateway extends TypertRemoteService {
  static inject = ['lwbAtsClient', 'webServer', 'lwbTaskModel', 'llm']
  constructor(ctx) {
    super(ctx, 'lwbAccount')
    this.paymentForms = new Map()
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: PAYMENT_ROUTE,
      handler: (request, response) => this.servePaymentForm(request, response),
    }), 'lwb-account: payment form route')
    for (const initializer of remoteInitializers) initializer.call(this)
  }
  async login(request) { return { user: (await this.ctx.lwbAtsClient.login(request)).user } }
  async register(request) { return { user: (await this.ctx.lwbAtsClient.register(request)).user } }
  async logout() { return this.ctx.lwbAtsClient.logout() }
  async status() {
    const account = await this.ctx.lwbAtsClient.status()
    try { return { ...account, catalog: await this.ctx.lwbAtsClient.catalog(), serviceError: null } }
    catch (error) { return { ...account, catalog: null, serviceError: error.status === 404 ? '请先更新 ATS 服务以启用 LWB 模型与场景服务。' : error.message } }
  }
  async taskModel() {
    const groups = await Promise.all(this.ctx.llm.listProviders().map(async provider => {
      try { return { ...provider, models: await this.ctx.llm.listModels(provider.id) } }
      catch { return { ...provider, models: [] } }
    }))
    return { config: this.ctx.lwbTaskModel.get(), selection: this.ctx.lwbTaskModel.selection(), groups }
  }
  async setTaskModel(request) { await this.ctx.lwbTaskModel.update(request); return this.taskModel() }
  async rechargePackages() { return this.ctx.lwbAtsClient.rechargePackages() }
  async membershipPlans() { return this.ctx.lwbAtsClient.membershipPlans() }
  async createPayment(request) {
    const payment = await this.ctx.lwbAtsClient.createPayment(request)
    this.discardExpiredPaymentForms()
    const token = randomUUID()
    this.paymentForms.set(token, { html: payment.paymentFormHtml, expiresAt: Date.now() + PAYMENT_FORM_TTL_MS })
    const host = this.ctx.webServer.host === '0.0.0.0' ? '127.0.0.1' : this.ctx.webServer.host
    return {
      orderId: payment.orderId,
      orderNo: payment.orderNo,
      paymentPageUrl: `http://${host}:${this.ctx.webServer.port}${PAYMENT_ROUTE}/${token}`,
    }
  }
  async orderStatus(request) { return this.ctx.lwbAtsClient.orderStatus(request?.orderId || request) }
  async servePaymentForm(request, response) {
    if (request.method !== 'GET') {
      response.statusCode = 405
      response.setHeader('allow', 'GET')
      response.end()
      return
    }
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const token = pathname.slice(`${PAYMENT_ROUTE}/`.length)
    if (!/^[0-9a-f-]{36}$/u.test(token)) {
      response.statusCode = 404
      response.end('支付链接无效或已过期。')
      return
    }
    this.discardExpiredPaymentForms()
    const payment = this.paymentForms.get(token)
    if (!payment) {
      response.statusCode = 410
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end('支付链接无效或已过期，请返回 LWB 重新创建订单。')
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    response.end(payment.html)
  }
  discardExpiredPaymentForms(now = Date.now()) {
    for (const [token, payment] of this.paymentForms) if (payment.expiresAt <= now) this.paymentForms.delete(token)
  }
}
for (const method of ['login', 'register', 'logout', 'status', 'taskModel', 'setTaskModel', 'rechargePackages', 'membershipPlans', 'createPayment', 'orderStatus']) decorateRemote(LwbAccountGateway.prototype, method, method)
export default LwbAccountGateway
