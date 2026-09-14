/** Explicit authenticated credential downloads, separate from Remote results. */
import { safeAccountFilename } from '../provider/validation.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AccountPool, AccountPoolAccountName } from '../account-pool.ts'

/** Account-pool download route inside the authenticated Connection carrier. */
export const ACCOUNT_POOL_EXPORT_PATH = '/api/account-pool.export'

/**
 * Enforce download policy at execution, before obtaining any credential bytes.
 * @param owner - Host credential-file reader.
 * @param allowed - deployment's explicit credential-export policy.
 * @param request - authenticated download request.
 * @returns a private attachment or a credential-free refusal.
 */
export async function accountPoolExportResponse(
  owner: Pick<AccountPool, 'downloadAuthFile'>,
  allowed: boolean,
  request: Request,
): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  if (!allowed) return new Response('Credential export is disabled.', { status: 403, headers })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers })
  const query = new URL(request.url).searchParams
  const name = query.get('name')
  if (name === null || !safeAccountFilename(name) || query.getAll('name').length !== 1) {
    return new Response('A safe account filename is required.', { status: 400, headers })
  }
  if (request.method === 'HEAD') return new Response(null, { headers: { ...headers,
    'content-disposition': `attachment; filename="${name}"`, 'content-type': 'application/json' } })
  try {
    const file = await owner.downloadAuthFile(brandString<AccountPoolAccountName>(name), request.signal)
    if (!safeAccountFilename(file.name)) {
      return new Response('The account filename is invalid.', { status: 500, headers })
    }
    return new Response(file.body, { headers: {
      ...headers,
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${file.name}"`,
      'x-content-type-options': 'nosniff',
    } })
  } catch {
    // Provider read failures can contain credential-bearing upstream details.
    return new Response('The credential file could not be exported.', { status: 502, headers })
  }
}
