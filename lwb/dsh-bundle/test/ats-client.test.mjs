import assert from 'node:assert/strict'
import test from 'node:test'
import { LwbAtsClient } from '../ats-client.mjs'

function response(status, value) { return { ok: status >= 200 && status < 300, status, json: async () => value } }
function setup(fetch) {
  const values = new Map()
  const credentials = { resolve: async (key) => ({ value: values.get(key) }), set: async (key, value) => values.set(key, value), unset: async (key) => values.delete(key) }
  return { client: new LwbAtsClient({ credentials, fetch, baseUrl: 'https://ats.example.test', deviceId: 'test-device' }), values }
}

test('login stores opaque session in host credentials and status projects account data', async () => {
  const calls = []
  const { client, values } = setup(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'access', refreshToken: 'refresh', user: { id: '7', email: 'a@example.com', role: 'user' } })
    if (url.endsWith('/auth/me')) return response(200, { id: '7', email: 'a@example.com' })
    if (url.endsWith('/membership/current')) return response(200, { planCode: 'free' })
    return response(200, { availablePoints: 12 })
  })
  const session = await client.login({ account: 'a@example.com', password: 'password123' })
  assert.equal(session.user.email, 'a@example.com')
  assert.match(values.get('lwb-ats-session'), /access/)
  assert.deepEqual(await client.status(), { user: { id: '7', email: 'a@example.com' }, membership: { planCode: 'free' }, points: { availablePoints: 12 }, entitlements: null })
  assert.equal(calls[0][1].body.includes('password123'), true)
})

test('concurrent expired requests share one refresh and retry once', async () => {
  let refreshes = 0; let protectedCalls = 0
  const { client } = setup(async (url) => {
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'old', refreshToken: 'refresh', user: { id: '1' } })
    if (url.endsWith('/auth/refresh')) { refreshes += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return response(200, { accessToken: 'new', refreshToken: 'new-refresh', user: { id: '1' } }) }
    protectedCalls += 1
    return protectedCalls <= 2 ? response(401, { message: 'expired' }) : response(200, { ok: true })
  })
  await client.login({ account: 'user', password: 'password123' })
  const values = await Promise.all([client.request('/api/auth/me'), client.request('/api/auth/me')])
  assert.deepEqual(values, [{ ok: true }, { ok: true }])
  assert.equal(refreshes, 1)
})

test('refresh failure clears credentials and unauthenticated calls do not touch network', async () => {
  let calls = 0
  const { client, values } = setup(async () => { calls += 1; return response(401, { message: 'expired' }) })
  await assert.rejects(client.status(), { code: 'LWB_ATS_NOT_AUTHENTICATED' })
  assert.equal(calls, 0)
  await client.login({ account: 'user', password: 'password123' }).catch(() => {})
  assert.equal(values.has('lwb-ats-session'), false)
})
