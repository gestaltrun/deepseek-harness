/** Host-owned authorization open keeps renderer popups out of enrollment. */
import { ACCOUNT_POOL_OPEN_PATH, authorizationUrl } from '../authorization-url.ts'

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
