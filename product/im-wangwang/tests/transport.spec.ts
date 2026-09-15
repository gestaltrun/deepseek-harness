import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CredentialProvider, credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImTransports } from '@gestaltrun/dsh-im-runtime'
import type { ImAccountId, ImAccountView, ImProviderCursorId, ImRevision, ImRouteId, ImTransportInboundPage, ImTransportListenPlan } from '@gestaltrun/dsh-im-runtime'
import { WangwangTransport } from '../src/transport.ts'

class MemoryCredentials extends CredentialProvider {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined) }
  override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }) }
  override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve() }
  override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve() }
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(this.records.get(key)) }
  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> { return Promise.resolve({ configured: this.records.has(key), writable: true }) }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]) }
  override async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(key))
    if (next !== undefined) this.records.set(key, next)
    return next
  }
  override deleteRecord(key: CredentialKey): Promise<void> { this.records.delete(key); return Promise.resolve() }
}

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const config = {
  admittedMerchants: [{
    candidateId: 'travel-store',
    endpoint: 'https://wangwang.invalid',
    merchantId: 'merchant-1',
    displayName: 'Travel Store',
    mainServiceAccountId: 'service-1',
  }],
  pollIntervalMs: 60_000,
  pollLimit: 10,
  pollWaitSeconds: 0,
}

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function account(): ImAccountView {
  return {
    id: brandString<ImAccountId>('account-1'),
    platform: 'wangwang',
    displayName: 'Travel Store',
    identity: { platform: 'wangwang', merchantId: 'merchant-1', displayName: 'Travel Store', mainServiceAccountId: 'service-1' },
    credentialKey: credentialKey('gestaltrun-im', 'account-1'),
    authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' },
    listener: { state: 'stopped', reason: 'manual' },
    connectionIntent: 'connected',
    paused: false,
    revision: brandString<ImRevision>('revision-1'),
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }
}

function boot(fetch: typeof globalThis.fetch): { ctx: Context; credentials: MemoryCredentials; transport: WangwangTransport } {
  const ctx = new Context()
  roots.push(ctx)
  new ImTransports(ctx)
  const credentials = new MemoryCredentials(ctx)
  const transport = new WangwangTransport(ctx, config, { fetch, now: () => Date.parse('2026-09-14T00:00:00.000Z') })
  return { ctx, credentials, transport }
}

function store(credentials: MemoryCredentials): void {
  credentials.records.set(account().credentialKey!, {
    kind: 'grant',
    payload: { version: 1, candidateId: 'travel-store', accessKeyId: 'access-id', accessKeySecret: 'secret-value' },
  })
}

function allDirectPlan(): ImTransportListenPlan {
  return { routes: [{
    routeId: brandString<ImRouteId>('route-all'),
    routeRevision: brandString<ImRevision>('route-revision-1'),
    conversationKind: 'direct',
    target: { kind: 'all' },
    needsMentionEvidence: false,
  }] }
}

describe('Wangwang transport', () => {
  it('lists only admitted merchants and returns write-only setup credentials with explicit authorization evidence', async () => {
    const { transport } = boot(async () => success({ events: [], nextSinceId: 0, hasMore: false }))
    await expect(transport.listAccountCandidates(new AbortController().signal)).resolves.toEqual([
      { platform: 'wangwang', candidateId: 'travel-store', endpoint: 'https://wangwang.invalid', displayName: 'Travel Store', merchantId: 'merchant-1' },
    ])
    const prepared = await transport.prepareAccount({
      platform: 'wangwang', candidateId: 'travel-store', endpoint: 'https://wangwang.invalid', accessKeyId: 'access-id', accessKeySecret: 'secret-value',
    }, new AbortController().signal)
    expect(prepared).toMatchObject({
      displayName: 'Travel Store',
      identity: { platform: 'wangwang', merchantId: 'merchant-1', mainServiceAccountId: 'service-1' },
      authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' },
      credentialRecord: { kind: 'grant', payload: { version: 1, candidateId: 'travel-store' } },
    })
    expect(JSON.stringify(prepared.identity)).not.toContain('secret-value')
  })

  it('distinguishes explicit expiry from a generic 401 response', async () => {
    const expired = boot(async () => success({ events: [], nextSinceId: 0, hasMore: false }))
    const explicit = new WangwangTransport(expired.ctx, config, {
      fetch: async () => new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), { status: 200 }),
      now: () => Date.parse('2026-09-14T00:00:00.000Z'),
    })
    await expect(explicit.prepareAccount({ platform: 'wangwang', candidateId: 'travel-store', endpoint: 'https://wangwang.invalid', accessKeyId: 'id', accessKeySecret: 'secret' }, new AbortController().signal))
      .resolves.toMatchObject({ authorization: { state: 'required', reason: 'expired' } })

    const generic = new WangwangTransport(expired.ctx, config, {
      fetch: async () => new Response('unauthorized', { status: 401 }),
      now: () => Date.parse('2026-09-14T00:00:00.000Z'),
    })
    await expect(generic.prepareAccount({ platform: 'wangwang', candidateId: 'travel-store', endpoint: 'https://wangwang.invalid', accessKeyId: 'id', accessKeySecret: 'secret' }, new AbortController().signal))
      .resolves.toMatchObject({ authorization: { state: 'failed', code: 'WANGWANG_HTTP_401' } })
  })

  it('re-reads the credential record on each operation and never falls back to another merchant', async () => {
    const headers: string[] = []
    const { credentials, transport } = boot(async (_input, init) => {
      headers.push(new Headers(init?.headers).get('x-api-access-key') ?? '')
      return success({ events: [], nextSinceId: 0, hasMore: false })
    })
    store(credentials)
    await transport.discoverConversations(account(), undefined, new AbortController().signal)
    store(credentials)
    credentials.records.set(account().credentialKey!, {
      kind: 'grant', payload: { version: 1, candidateId: 'travel-store', accessKeyId: 'rotated-id', accessKeySecret: 'rotated-secret' },
    })
    await transport.discoverConversations(account(), undefined, new AbortController().signal)
    expect(headers).toEqual(['access-id', 'rotated-id'])

    const other = { ...account(), identity: { platform: 'wangwang' as const, merchantId: 'merchant-other', displayName: 'Other' } }
    await expect(transport.discoverConversations(other, undefined, new AbortController().signal))
      .rejects.toMatchObject({ code: 'WANGWANG_MERCHANT_NOT_ADMITTED' })
  })

  it('submits one merchant page with every conversation before adopting its durable cursor receipt', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success({
      events: [
        { eventId: 'event-1', merchantId: 'merchant-1', senderType: 1, messageId: 'message-1', customerId: 'buyer-1', conversationId: 'conversation-1', msgType: 1, textContent: 'one', msgTime: 1_726_000_000_000 },
        { eventId: 'event-2', merchantId: 'merchant-1', senderType: 1, messageId: 'message-2', customerId: 'buyer-2', conversationId: 'conversation-2', msgType: 1, textContent: 'two', msgTime: 1_726_000_001_000 },
      ],
      nextSinceId: 9,
      hasMore: false,
    }))
    const { credentials, transport } = boot(fetch)
    store(credentials)
    const admitted: ImTransportInboundPage[] = []
    const listener = await transport.listen(account(), allDirectPlan(), {
      receivePage: async page => {
        admitted.push(page)
        return {
          conversations: [],
          cursor: {
            operationId: page.operationId,
            status: 'applied',
            cursor: {
              id: brandString<ImProviderCursorId>('cursor-1'),
              owner: page.owner,
              cursor: page.nextCursor,
              updatedAt: '2026-09-14T00:00:00.000Z',
            },
          },
        }
      },
    }, new AbortController().signal)
    expect(admitted).toHaveLength(1)
    expect(admitted[0]).toMatchObject({
      owner: { platform: 'wangwang', accountId: account().id, streamId: 'merchant-1' },
      observedCursor: null,
      nextCursor: '9',
      conversations: [
        { conversationId: 'conversation-1', messages: [{ externalMessageId: 'message-1' }] },
        { conversationId: 'conversation-2', messages: [{ externalMessageId: 'message-2' }] },
      ],
    })
    await listener.dispose()
    await listener.done
  })

  it('filters a specific route while still advancing the whole merchant page cursor', async () => {
    const { credentials, transport } = boot(async () => success({
      events: [
        { eventId: 'event-1', merchantId: 'merchant-1', senderType: 1, messageId: 'message-1', customerId: 'buyer-1', conversationId: 'conversation-1', msgType: 1, textContent: 'one', msgTime: 1_726_000_000_000 },
        { eventId: 'event-2', merchantId: 'merchant-1', senderType: 1, messageId: 'message-2', customerId: 'buyer-2', conversationId: 'conversation-future', msgType: 1, textContent: 'two', msgTime: 1_726_000_001_000 },
      ],
      nextSinceId: 11,
      hasMore: false,
    }))
    store(credentials)
    const admitted: ImTransportInboundPage[] = []
    const plan: ImTransportListenPlan = { routes: [{
      routeId: brandString<ImRouteId>('route-specific'),
      routeRevision: brandString<ImRevision>('route-revision-1'),
      conversationKind: 'direct',
      target: { kind: 'specific', conversationId: 'conversation-1', directRecipient: { providerActorId: 'buyer-1' } },
      needsMentionEvidence: false,
    }] }
    const listener = await transport.listen(account(), plan, {
      receivePage: async page => {
        admitted.push(page)
        return {
          conversations: [],
          cursor: {
            operationId: page.operationId,
            status: 'applied',
            cursor: {
              id: brandString<ImProviderCursorId>('cursor-11'), owner: page.owner,
              cursor: page.nextCursor, updatedAt: '2026-09-14T00:00:00.000Z',
            },
          },
        }
      },
    }, new AbortController().signal)

    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.nextCursor).toBe('11')
    expect(admitted[0]?.conversations.map(group => group.conversationId)).toEqual(['conversation-1'])
    await listener.dispose()
    await listener.done
  })

  it('rejects the listener terminal signal when polling fails after readiness', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const { credentials, transport } = boot(async () => {
        calls++
        if (calls === 1) return success({ events: [], nextSinceId: 0, hasMore: false })
        throw new Error('controlled polling failure')
      })
      store(credentials)
      const listener = await transport.listen(account(), allDirectPlan(), {
        receivePage: async page => ({
          conversations: [],
          cursor: {
            operationId: page.operationId,
            status: 'applied',
            cursor: {
              id: brandString<ImProviderCursorId>('cursor-ready'), owner: page.owner,
              cursor: page.nextCursor, updatedAt: '2026-09-14T00:00:00.000Z',
            },
          },
        }),
      }, new AbortController().signal)
      const terminal = expect(listener.done).rejects.toMatchObject({ code: 'WANGWANG_NETWORK_ERROR' })
      await vi.advanceTimersByTimeAsync(60_000)
      await terminal
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps ambiguous sends unknown until the provider status endpoint confirms a fact', async () => {
    let phase: 'send' | 'confirm' = 'send'
    const { credentials, transport } = boot(async () => {
      if (phase === 'send') return new Response('gateway timeout', { status: 504 })
      return success({ state: 'sent', messageId: 'message-confirmed' })
    })
    store(credentials)
    await expect(transport.send({ account: account(), conversationId: 'conversation-1', conversationKind: 'direct', directRecipient: { providerActorId: 'buyer-1' }, requestId: 'request-1', text: 'hello' }, new AbortController().signal))
      .resolves.toEqual({ state: 'unknown' })
    phase = 'confirm'
    await expect(transport.confirm({ account: account(), requestId: 'request-1' }, new AbortController().signal))
      .resolves.toEqual({ state: 'sent', externalMessageId: 'message-confirmed', rawStatus: 'sent' })
  })

  it('preserves producer receipt evidence in the durable raw status', async () => {
    let body: unknown
    const { credentials, transport } = boot(async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return success({ messageId: 'message-1', status: 'OK', producerId: 'service-agent', producerRevision: 'revision-3' })
    })
    store(credentials)

    await expect(transport.send({ account: account(), conversationId: 'conversation-1', conversationKind: 'direct', directRecipient: { providerActorId: 'buyer-1' }, requestId: 'request-1', text: 'hello' }, new AbortController().signal))
      .resolves.toEqual({
        state: 'sent',
        externalMessageId: 'message-1',
        rawStatus: '{"status":"OK","producerId":"service-agent","producerRevision":"revision-3"}',
      })
    expect(body).toMatchObject({ customerId: 'buyer-1' })
    expect(JSON.stringify(body)).not.toContain('conversation-1')
  })
})
