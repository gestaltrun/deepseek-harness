/** Registered community HTTP routes and the official RPC protocol share the Desktop carrier. */
import { Context } from '@deepseek-ai/cordis'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection/src/rpc-host.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopCommunityTransport } from '../src/community-transport.ts'
import { DESKTOP_STREAM_PATH, dispatchDesktopFetch } from '../src/fetch-dispatcher.ts'

const contexts: Context[] = []
const transports: DesktopCommunityTransport[] = []
const errors: Error[] = []

async function mounted() {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = ctx.plugin((scope) => { new HostConnectionService(scope, [], {} as BrowserAuth) })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionService
  connection.rpc.intercept('/api', () => true, () => Promise.resolve({ ok: true, value: 'core RPC' }))
  const community = new DesktopCommunityTransport({ collectIndexInjections: () => [], onError: (error) => { errors.push(error) } })
  transports.push(community)
  const broad = vi.fn(() => { throw new Error('The shared API must not pass through the community HTTP server') })
  community.register({ kind: 'prefix', path: '/api', handler: broad })
  community.registerFallback(() => { throw new Error('The community fallback must not receive core requests') })
  const routes = {
    api: connection.createSharedFetchHandler('/api'), community,
    assets: { fetch: vi.fn(() => Promise.resolve(new Response('core asset'))) },
    streams: { fetch: vi.fn(() => Promise.resolve(new Response('core stream'))) },
  }
  return { routes, broad }
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map(transport => transport.dispose()))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  expect(errors.splice(0)).toEqual([])
})

it('serves named community API routes before the shared RPC channel', async () => {
  const { routes, broad } = await mounted()
  routes.community.register({ kind: 'exact', path: '/api/dsh-web-all/rows', handler: (_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, children: ['@gestaltrun/dsh-session-archive'] }))
  } })
  routes.community.register({ kind: 'prefix', path: '/sidebar/api', handler: (request, response) => {
    expect(request.method).toBe('POST')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, value: { externalDisable: false } }))
  } })
  const rows = await dispatchDesktopFetch(new Request('dsh-app://app/api/dsh-web-all/rows'), routes)
  expect(rows.status).toBe(200)
  expect(await rows.json()).toEqual({ ok: true, children: ['@gestaltrun/dsh-session-archive'] })
  const settings = await dispatchDesktopFetch(new Request('dsh-app://app/sidebar/api/settings.get', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }), routes)
  expect(settings.status).toBe(200)
  expect(await settings.json()).toEqual({ ok: true, value: { externalDisable: false } })
  expect(broad).not.toHaveBeenCalled()
  expect(routes.assets.fetch).not.toHaveBeenCalled()
})

it('preserves directoryPicker protocol validation in the official RPC handler', async () => {
  const { routes, broad } = await mounted()
  const url = 'dsh-app://app/api/directoryPicker/pick'
  const wrongType = await dispatchDesktopFetch(new Request(url, { method: 'POST', body: '{}' }), routes)
  expect(wrongType.status).toBe(415)
  expect(await wrongType.text()).toBe('content type must be application/json')
  const invalid = await dispatchDesktopFetch(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }), routes)
  expect(invalid.status).toBe(200)
  expect(await invalid.json()).toMatchObject({ type: 'server-response', result: { ok: false, error: { code: 'gateway/bad-request' } } })
  const valid = await dispatchDesktopFetch(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'picker', method: 'directoryPicker/pick', payload: {} }),
  }), routes)
  expect(valid.status).toBe(200)
  expect(await valid.json()).toMatchObject({ result: { ok: true, value: 'core RPC' } })
  expect(broad).not.toHaveBeenCalled()
  expect(routes.assets.fetch).not.toHaveBeenCalled()
})

it('retains core roots, static namespaces, and the private stream owner', async () => {
  const { routes, broad } = await mounted()
  const hijack = vi.fn(() => { throw new Error('A core route was intercepted') })
  for (const path of ['/api', '/', '/index.html', '/plugins', '/assets', '/.dsh',
    '/plugins/client.js', '/assets/main.js', '/.dsh/unknown']) {
    routes.community.register({ kind: 'exact', path, handler: hijack })
  }
  for (const path of ['/plugins/client.js', '/assets/main.js', '/.dsh/unknown', '/', '/index.html']) {
    expect(await (await dispatchDesktopFetch(new Request(`dsh-app://app${path}`), routes)).text()).toBe('core asset')
  }
  expect((await dispatchDesktopFetch(new Request('dsh-app://app/api'), routes)).status).toBe(404)
  expect(await (await dispatchDesktopFetch(new Request(`dsh-app://app${DESKTOP_STREAM_PATH}`), routes)).text()).toBe('core stream')
  expect(hijack).not.toHaveBeenCalled()
  expect(broad).not.toHaveBeenCalled()
})
