/** Wangwang OpenAPI HMAC request signing. */
import { createHmac } from 'node:crypto'

/** Query value accepted by the Wangwang canonical encoder. */
export type WangwangQueryValue = string | number | bigint | boolean | null | undefined

/**
 * Encode query entries in canonical key order.
 * @param query - Query values; null and undefined entries are omitted.
 * @returns the canonical URL query.
 */
export function buildWangwangQuery(query: Readonly<Record<string, WangwangQueryValue>>): string {
  const pairs: Array<readonly [string, string]> = []
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    const encoded = new URLSearchParams([[key, String(value)]]).toString()
    const separator = encoded.indexOf('=')
    pairs.push([encoded.slice(0, separator), encoded.slice(separator + 1)])
  }
  pairs.sort(([left], [right]) => left.localeCompare(right))
  return pairs.map(([key, value]) => `${key}=${value}`).join('&')
}

/** Signed Wangwang request fields. */
export interface SignedWangwangRequest {
  readonly query: string
  readonly headers: Readonly<Record<string, string>>
}

/**
 * Sign one Wangwang OpenAPI request with HMAC-SHA256.
 * @param input - HTTP and credential values required by the protocol.
 * @returns canonical query and authentication headers.
 */
export function signWangwangRequest(input: {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, WangwangQueryValue>>
  readonly timestamp: number
  readonly accessKeyId: string
  readonly accessKeySecret: string
  readonly requestId?: string
}): SignedWangwangRequest {
  const method = input.method.toUpperCase()
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`
  const query = buildWangwangQuery(input.query ?? {})
  const timestamp = String(input.timestamp)
  const signature = createHmac('sha256', input.accessKeySecret)
    .update(`${method}\n${path}\n${query}\n${timestamp}`, 'utf8')
    .digest('base64')
  return {
    query,
    headers: {
      'x-api-access-key': input.accessKeyId,
      'x-api-timestamp': timestamp,
      'x-api-signature': signature,
      ...(input.requestId === undefined ? {} : { 'x-api-request-id': input.requestId }),
    },
  }
}
