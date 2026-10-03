import assert from 'node:assert/strict'
import test from 'node:test'
import { LwbPackEntitlements } from '../pack-entitlements.mjs'
import { LwbAccountGateway } from '../account-gateway.mjs'
import { Context } from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'

const manifest = { access: { account: 'lwb', membershipRequired: true } }

function account(status) {
  return { subscribe() { return () => {} }, async status() { return status } }
}

test('membership policy allows active paid plans and rejects free or expired plans', async () => {
  assert.equal((await new LwbPackEntitlements(account({ user: { id: '1' }, membership: { planCode: 'pro', status: 'active' } })).check(manifest)).allowed, true)
  const free = new LwbPackEntitlements(account({ user: { id: '1' }, membership: { planCode: 'free', status: 'active' } }))
  const result = await free.check(manifest)
  assert.equal(result.allowed, false)
  await assert.rejects(free.assertAllowed(manifest), (error) => error.code === 'LWB_PACK_MEMBERSHIP_REQUIRED')
  const expired = new LwbPackEntitlements(account({ user: { id: '1' }, membership: { planCode: 'pro', status: 'active', expiresAt: '2020-01-01T00:00:00Z' } }))
  assert.equal((await expired.check(manifest)).allowed, false)
})

test('non-gated packs remain available without an account', async () => {
  const result = await new LwbPackEntitlements(account({ user: null, membership: null })).check({})
  assert.deepEqual(result, { allowed: true, required: false, reason: null })
})

test('an account change discards a pending anonymous membership check', async () => {
  let resolveAnonymous, changed, reads = 0
  const policy = new LwbPackEntitlements({
    subscribe(listener) { changed = listener; return () => {} },
    status() {
      reads++
      if (reads === 1) return new Promise(resolve => { resolveAnonymous = resolve })
      return Promise.resolve({ user: { id: 'member' }, membership: { planCode: 'business', status: 'active' } })
    },
  })
  const oldCheck = policy.check(manifest)
  changed()
  assert.equal((await policy.check(manifest)).allowed, true)
  resolveAnonymous({ user: null, membership: null })
  assert.equal((await oldCheck).allowed, true)
  assert.equal((await policy.check(manifest)).allowed, true)
  assert.equal(reads, 2)
})

test('refreshing account status makes a newly purchased membership available immediately', async () => {
  let status = { user: { id: 'member' }, membership: { planCode: 'free', status: 'active' } }
  const ats = { async status() { return status }, async catalog() { return {} } }
  const policy = new LwbPackEntitlements(ats)
  const ctx = new Context()
  ctx.provide('lwbAtsClient', ats)
  ctx.provide('lwbPackEntitlements', policy)
  ctx.provide('webServer', { register() { return () => {} } })
  ctx.provide('lwbTaskModel', {})
  ctx.provide('llm', {})
  try {
    await ctx.plugin(LwbAccountGateway).await()
    assert.equal((await policy.check(manifest)).allowed, false)
    status = { user: { id: 'member' }, membership: { planCode: 'business', status: 'active' } }
    await ctx.get('lwbAccount').status()
    assert.equal((await policy.check(manifest)).allowed, true)
  } finally {
    await ctx.fiber.dispose()
  }
})
