/** Standard browser navigation keeps credential downloads out of RPC results. */
import type { AccountPoolAccountName } from '../account-pool.ts'
import { ACCOUNT_POOL_OPEN_PATH, authorizationUrl } from '../authorization-url.ts'

/**
 * Check export policy and hand the authenticated URL to the download manager.
 * @param name - account filename supplied by the Host roster.
 * @param signal - plugin lifetime or action cancellation.
 * @returns after the browser download starts; policy and transport failures reject.
 */
export async function downloadAccount(name: AccountPoolAccountName, signal: AbortSignal): Promise<void> {
  const url = new URL('/api/account-pool.export', document.baseURI)
  url.searchParams.set('name', name)
  const response = await fetch(url, { method: 'HEAD', signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Account export failed: HTTP ${response.status}`)
  signal.throwIfAborted()
  const anchor = document.createElement('a')
  anchor.href = url.href
  anchor.download = name
  anchor.click()
}

/**
 * Ask the Host to open an HTTPS authorization link in the system browser.
 * @param url - provider authorization URL from the current login operation.
 * @returns after the Host starts the opener; invalid URLs and Host refusals reject.
 */
export async function openAuthorization(url: string): Promise<void> {
  const target = authorizationUrl(url)
  const response = await fetch(new URL(ACCOUNT_POOL_OPEN_PATH, document.baseURI), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target }),
  })
  if (!response.ok) throw new Error(`Account authorization failed: HTTP ${response.status}`)
}
