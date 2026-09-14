import { describe, expect, it, vi } from 'vitest'
import { WangwangProtocolClient } from '../src/index.ts'

const credentials = { accessKeyId: 'access-id', accessKeySecret: 'secret-value' }

describe('Wangwang OpenAPI protocol', () => {
  it('preserves an unsupported sender claim as unknown and never defaults it to external', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        events: [{
          eventId: 'event-1', merchantId: 'merchant-1', senderType: 99,
          messageId: 'message-1', customerId: 'buyer-1', conversationId: 'conversation-1',
          msgType: 1, textContent: 'hello', msgTime: 1_726_000_000_000,
        }],
        nextSinceId: 7,
        hasMore: false,
      },
    }), { status: 200 }))
    const client = new WangwangProtocolClient({ endpoint: 'https://wangwang.invalid', fetch, now: () => 1_726_000_000_000 })

    const page = await client.pullEvents({ merchantId: 'merchant-1', credentials, cursor: 0, limit: 10, waitSeconds: 0 })

    expect(page.events[0]?.sender).toEqual({ kind: 'provider-unknown', observedSenderId: 'buyer-1' })
    expect(page.nextCursor).toBe(7)
  })

  it('rejects a page that crosses the admitted merchant identity', async () => {
    const client = new WangwangProtocolClient({
      endpoint: 'https://wangwang.invalid',
      fetch: async () => new Response(JSON.stringify({
        code: 0,
        data: {
          events: [{
            eventId: 'event-1', merchantId: 'merchant-other', senderType: 1,
            messageId: 'message-1', customerId: 'buyer-1', conversationId: 'conversation-1',
            msgType: 1, textContent: 'hello', msgTime: 1_726_000_000_000,
          }],
          nextSinceId: 1,
          hasMore: false,
        },
      }), { status: 200 }),
    })

    await expect(client.pullEvents({ merchantId: 'merchant-1', credentials, cursor: 0, limit: 10, waitSeconds: 0 }))
      .rejects.toMatchObject({ code: 'WANGWANG_MERCHANT_MISMATCH' })
  })

  it('does not expose a provider response body in HTTP diagnostics', async () => {
    const client = new WangwangProtocolClient({
      endpoint: 'https://wangwang.invalid',
      fetch: async () => new Response('upstream echoed secret-value', { status: 403 }),
    })

    await expect(client.pullEvents({ merchantId: 'merchant-1', credentials, cursor: 0, limit: 10, waitSeconds: 0 }))
      .rejects.toSatisfy((error: unknown) => error instanceof Error && error.message === 'Wangwang request failed with HTTP 403')
  })
})
