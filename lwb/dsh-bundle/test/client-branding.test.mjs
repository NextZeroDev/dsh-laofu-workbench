import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { LOGO_PATH, registerLwbBranding } from '../branding.mjs'

test('product logo route serves the packaged PNG, supports HEAD and disposes', async () => {
  const routes = new Map()
  let dispose
  await registerLwbBranding({
    effect(register) { dispose = register() },
    webServer: { register(route) {
      assert.equal(route.kind, 'exact')
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } },
  })
  const route = routes.get(LOGO_PATH)
  const png = await readFile(new URL('../assets/laofu-workbench-logo.png', import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    route.handler({ method }, response)
    assert.equal(response.status, method === 'POST' ? 405 : 200)
    if (method !== 'POST') assert.equal(response.headers['content-type'], 'image/png')
    assert.deepEqual(response.body, method === 'GET' ? png : undefined)
  }
  dispose()
  assert.equal(routes.size, 0)
})
