import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildWangwangQuery, signWangwangRequest } from '../src/index.ts'

describe('Wangwang request signing', () => {
  it('sorts and encodes query values before signing the accepted HMAC text', () => {
    const query = buildWangwangQuery({ z: 'last value', a: 'first/value', absent: undefined })
    expect(query).toBe('a=first%2Fvalue&z=last+value')

    const signed = signWangwangRequest({
      method: 'get',
      path: 'openapi/wangwang/events',
      query: { z: 'last value', a: 'first/value' },
      timestamp: 1_726_000_000_000,
      accessKeyId: 'access-id',
      accessKeySecret: 'secret-value',
      requestId: 'request-1',
    })
    const expected = createHmac('sha256', 'secret-value')
      .update('GET\n/openapi/wangwang/events\na=first%2Fvalue&z=last+value\n1726000000000')
      .digest('base64')
    expect(signed).toEqual({
      query,
      headers: {
        'x-api-access-key': 'access-id',
        'x-api-request-id': 'request-1',
        'x-api-signature': expected,
        'x-api-timestamp': '1726000000000',
      },
    })
  })
})
