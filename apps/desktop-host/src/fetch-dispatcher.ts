/** Route the Desktop Fetch pipe to its registered HTTP, RPC, and asset owners. */
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
import type { DesktopCommunityTransport } from './community-transport.ts'

/** Private remote-stream carrier used by the Desktop browser adapter. */
export const DESKTOP_STREAM_PATH = '/.dsh/remote-stream'

/** Active response owners supplied by one Desktop Host composition. */
export interface DesktopFetchRoutes {
  readonly api: Pick<ConnectionFetchHandler, 'fetch'>
  readonly assets: Pick<ConnectionFetchHandler, 'fetch'>
  readonly streams: Pick<ConnectionFetchHandler, 'fetch'>
  readonly community: Pick<DesktopCommunityTransport, 'owns' | 'fetch'>
}

/**
 * Prefer registered community paths while preserving the shared RPC channel as fallback.
 * @param request - Request received through the Desktop protocol carrier.
 * @param routes - Current Host response owners.
 * @returns Response from exactly one owner.
 */
export function dispatchDesktopFetch(request: Request, routes: DesktopFetchRoutes): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (pathname === DESKTOP_STREAM_PATH) return routes.streams.fetch(request)
  if (routes.community.owns(pathname)) return routes.community.fetch(request)
  if (pathname === '/api' || pathname.startsWith('/api/')) return routes.api.fetch(request)
  return routes.assets.fetch(request)
}
