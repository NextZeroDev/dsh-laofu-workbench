import { LwbAtsClient } from '../../../dsh-bundle/ats-client.mjs'

// Exercises the real host credential/scope boundary with a local-only ATS transport.
export function lwbAccountFixture(fetch, apiKey = 'test-managed-key', userId = '7') {
  const values = new Map()
  const client = new LwbAtsClient({ baseUrl: 'https://ats.test', credentials: {
    resolve: async key => ({ value: values.get(key) }),
    set: async (key, value) => values.set(key, value), unset: async key => values.delete(key),
  }, fetch: async (url, init) => {
    if (url.endsWith('/api/lwb/catalog')) return Response.json({ schemaVersion: 1, models: [], services: Object.fromEntries(['tts', 'subtitle', 'cover-image'].map(id => [id, { available: true, minimumPoints: 1 }])) })
    if (url.endsWith('/api/lwb/bootstrap')) return Response.json({ application: 'lwb', userId, credential: { apiKey } })
    return fetch(url, init)
  } })
  const ready = client.writeSession({ user: { id: userId }, accessToken: 'fake-access', refreshToken: 'fake-refresh' })
  return { client, status: async service => { await ready; return client.serviceStatus(service) }, open: async (service, options) => { await ready; return client.openService(service, options) } }
}
