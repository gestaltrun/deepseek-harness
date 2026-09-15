/** Authenticated Host launch of provider authorization pages. */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { ACCOUNT_POOL_OPEN_PATH, authorizationUrl } from '../authorization-url.ts'

export { ACCOUNT_POOL_OPEN_PATH }

/**
 * Choose the platform opener for one admitted HTTPS URL.
 * @param url - canonical HTTPS href.
 * @param platform - host platform.
 * @returns argv for a detached OS protocol handler.
 */
export function authorizationOpener(url: string, platform: NodeJS.Platform = process.platform): {
  readonly command: string
  readonly args: readonly string[]
} {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Launch the system browser for one admitted HTTPS authorization URL.
 * @param url - canonical HTTPS href.
 * @returns after the opener process starts.
 */
export async function launchAuthorization(url: string): Promise<void> {
  const opener = authorizationOpener(url)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(opener.command, [...opener.args], { detached: true, stdio: 'ignore', cwd: tmpdir() })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Open one HTTPS authorization URL through the Host launcher.
 * @param request - authenticated POST with `{ url }`.
 * @param launch - platform opener; tests replace this.
 * @returns 204 after launch, or a credential-free refusal.
 */
export async function accountPoolOpenResponse(
  request: Request,
  launch: (url: string) => Promise<void> = launchAuthorization,
): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('A JSON authorization URL is required.', { status: 400, headers })
  }
  const url = typeof body === 'object' && body !== null && 'url' in body && typeof body.url === 'string'
    ? body.url : undefined
  if (url === undefined) return new Response('A JSON authorization URL is required.', { status: 400, headers })
  try {
    await launch(authorizationUrl(url))
    return new Response(null, { status: 204, headers })
  } catch (error) {
    if (error instanceof Error && error.message.includes('HTTPS')) {
      return new Response(error.message, { status: 400, headers })
    }
    return new Response('The authorization page could not be opened.', { status: 502, headers })
  }
}
