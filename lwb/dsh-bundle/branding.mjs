import { readFile } from 'node:fs/promises'

export const LOGO_PATH = '/lwb/branding/logo.png'

/** Serve the product mark through the Host, including Electron's app origin. */
export async function registerLwbBranding(ctx) {
  const logo = await readFile(new URL('./assets/laofu-workbench-logo.png', import.meta.url))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGO_PATH,
    handler(request, response) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : logo)
    },
  }), 'lwb-branding: product logo')
}
