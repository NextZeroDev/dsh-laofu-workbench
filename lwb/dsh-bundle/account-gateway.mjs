import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
const remoteInitializers = []
function decorateRemote(prototype, method, exportName) { const decorate = Remote(exportName); decorate(prototype[method], { kind: 'method', name: method, static: false, private: false, addInitializer(initializer) { remoteInitializers.push(initializer) } }) }
/** Browser-safe LWB account projection. Tokens stay in the Host credentials store. */
export class LwbAccountGateway extends TypertRemoteService {
  static inject = ['lwbAtsClient']
  constructor(ctx) { super(ctx, 'lwbAccount'); for (const initializer of remoteInitializers) initializer.call(this) }
  async login(request) { return { user: (await this.ctx.lwbAtsClient.login(request)).user } }
  async register(request) { return { user: (await this.ctx.lwbAtsClient.register(request)).user } }
  async logout() { return this.ctx.lwbAtsClient.logout() }
  async status() { return this.ctx.lwbAtsClient.status() }
}
for (const method of ['login', 'register', 'logout', 'status']) decorateRemote(LwbAccountGateway.prototype, method, method)
export default LwbAccountGateway
