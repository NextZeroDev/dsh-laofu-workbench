import assert from 'node:assert/strict'
import test from 'node:test'
import { LwbPackEntitlements } from '../pack-entitlements.mjs'

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
