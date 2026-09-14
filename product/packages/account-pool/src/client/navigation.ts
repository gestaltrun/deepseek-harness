/** Standard browser navigation keeps credential downloads out of RPC results. */
import type { AccountPoolAccountName } from '../account-pool.ts'

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
 * Open an HTTPS authorization link without granting the new page an opener.
 * @param url - provider authorization URL from the current login operation.
 * @returns after requesting navigation; invalid URLs reject.
 */
export async function openAuthorization(url: string): Promise<void> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username !== '' || target.password !== '') throw new Error('Authorization requires an HTTPS URL without user information')
  window.open(target.href, '_blank', 'noopener,noreferrer')
}
