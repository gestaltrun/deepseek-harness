/** Shared HTTPS authorization-URL admission for Client requests and Host launch. */

/** Account-pool authorization-open route inside the authenticated Connection carrier. */
export const ACCOUNT_POOL_OPEN_PATH = '/api/account-pool.open'

/**
 * Admit one provider authorization URL for the system browser.
 * @param url - provider authorization URL from the current login operation.
 * @returns the canonical HTTPS href.
 */
export function authorizationUrl(url: string): string {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username !== '' || target.password !== '') {
    throw new Error('Authorization requires an HTTPS URL without user information')
  }
  return target.href
}
