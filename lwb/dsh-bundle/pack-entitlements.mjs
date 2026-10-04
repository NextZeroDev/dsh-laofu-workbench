/**
 * Host-side access policy for capability packs.
 *
 * Membership state is read from ATS and never exposed as a browser-side
 * decision. Packs may opt into the policy with manifest.access.
 */
export class LwbPackEntitlements {
  constructor(account, { cacheMs = 15_000 } = {}) {
    this.account = account
    this.cacheMs = cacheMs
    this.cached = null
    this.pending = null
    this.generation = 0
    this.unsubscribe = account?.subscribe?.(() => this.invalidate())
  }

  invalidate() {
    this.generation += 1
    this.cached = null
    this.pending = null
  }

  async membership() {
    if (!this.account?.status) return { authenticated: false, active: false, reason: 'LWB 账号服务不可用。' }
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.value
    if (this.pending) return this.pending
    const generation = this.generation
    const pending = this.account.status().then((status) => {
      const membership = status?.membership
      const plan = String(membership?.planCode || membership?.code || '').trim().toLowerCase()
      const state = String(membership?.status || '').trim().toLowerCase()
      const expiresAt = membership?.expiresAt ? Date.parse(membership.expiresAt) : NaN
      const active = Boolean(membership) && plan !== '' && plan !== 'free' && plan !== 'trial'
        && state !== 'inactive' && state !== 'expired' && (!Number.isFinite(expiresAt) || expiresAt > Date.now())
      return {
        authenticated: Boolean(status?.user),
        active,
        userId: status?.user?.id,
        planCode: plan || null,
        reason: active ? null : (status?.user ? '当前 LWB 账号没有有效会员。' : '请先登录 LWB 账号。'),
      }
    }).catch((error) => ({
      authenticated: error?.code !== 'LWB_ATS_NOT_AUTHENTICATED',
      active: false,
      reason: error instanceof Error ? error.message : String(error),
    })).then((value) => {
      if (generation !== this.generation) return this.membership()
      this.cached = { value, expiresAt: Date.now() + this.cacheMs }
      return value
    }).finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return pending
  }

  async check(manifest) {
    const access = manifest?.access
    if (!access?.membershipRequired) return { allowed: true, required: false, reason: null }
    const state = await this.membership()
    return { allowed: state.active, required: true, ...state }
  }

  async assertAllowed(manifest) {
    const result = await this.check(manifest)
    if (!result.allowed) {
      const error = new Error(result.reason || '当前 LWB 账号没有使用此能力包的权限。')
      error.code = result.authenticated ? 'LWB_PACK_MEMBERSHIP_REQUIRED' : 'LWB_ATS_NOT_AUTHENTICATED'
      error.access = result
      throw error
    }
    return result
  }
}
