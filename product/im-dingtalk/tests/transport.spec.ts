import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ImAccountId, ImAccountView, ImProviderCursorId, ImRevision, ImRouteId, ImTransportInboundPage, ImTransportListenPlan } from '@gestaltrun/dsh-im-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DwsClient } from '../src/client.ts'
import { DingTalkTransport } from '../src/transport.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function account(): ImAccountView {
  return {
    id: brandString<ImAccountId>('account-1'), platform: 'dingtalk', displayName: 'A / 甲',
    identity: { platform: 'dingtalk', profile: 'corp-a:user-1', corpId: 'corp-a', userId: 'user-1', displayName: 'A / 甲' },
    authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' },
    listener: { state: 'stopped', reason: 'manual' }, connectionIntent: 'connected', paused: false,
    revision: brandString<ImRevision>('revision-1'), createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
  }
}

function boot(client: DwsClient): DingTalkTransport {
  const ctx = new Context()
  roots.push(ctx)
  return new DingTalkTransport(ctx, {}, { client, now: () => Date.parse('2026-09-14T00:00:00.000Z') })
}

function groupMentionPlan(): ImTransportListenPlan {
  return { routes: [{
    routeId: brandString<ImRouteId>('route-all-groups'),
    routeRevision: brandString<ImRevision>('route-revision-1'),
    conversationKind: 'group',
    target: { kind: 'all' },
    needsMentionEvidence: true,
  }] }
}

describe('DingTalk transport', () => {
  it('keeps same-organization employee profiles independent and refreshes the exact identity', async () => {
    const client = {
      listProfiles: vi.fn(async () => [
        { profile: 'corp-a:user-1', corpId: 'corp-a', corpName: 'A', userId: 'user-1', userName: '甲', status: 'active' },
        { profile: 'corp-a:user-2', corpId: 'corp-a', corpName: 'A', userId: 'user-2', userName: '乙', status: 'expired' },
      ]),
      refresh: vi.fn(async () => ({ authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' }, corpId: 'corp-a', userId: 'user-1' })),
    } as unknown as DwsClient
    const transport = boot(client)
    await expect(transport.listAccountCandidates(new AbortController().signal)).resolves.toEqual([
      { platform: 'dingtalk', profile: 'corp-a:user-1', displayName: 'A / 甲' },
      { platform: 'dingtalk', profile: 'corp-a:user-2', displayName: 'A / 乙' },
    ])
    await expect(transport.prepareAccount({ platform: 'dingtalk', profile: 'corp-a:user-2' }, new AbortController().signal))
      .resolves.toMatchObject({ identity: { profile: 'corp-a:user-2', userId: 'user-2' }, authorization: { state: 'required', reason: 'expired' } })
    await transport.refreshAccount(account(), new AbortController().signal)
    expect(client.refresh).toHaveBeenCalledWith('corp-a:user-1', expect.any(AbortSignal))
  })

  it('does not call refresh during inspection and does not classify a generic failure as expired', async () => {
    const client = {
      listProfiles: vi.fn(async () => { throw new Error('fixture 401') }),
      refresh: vi.fn(),
    } as unknown as DwsClient
    const result = await boot(client).inspectAccount(account(), new AbortController().signal)
    expect(result.authorization).toMatchObject({ state: 'failed', code: 'DINGTALK_AUTHORIZATION_CHECK_FAILED' })
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it('waits for explicit stream readiness, submits strict evidence, and awaits teardown', async () => {
    let onLine!: (line: string) => Promise<void>
    let finish!: () => void
    let ready!: () => void
    const readyPromise = new Promise<void>(resolve => { ready = resolve })
    const done = new Promise<void>(resolve => { finish = resolve })
    const stop = vi.fn(async () => { finish() })
    const client = {
      listen: vi.fn(async (_profile: string, _signal: AbortSignal, handler: (line: string) => Promise<void>) => {
        onLine = handler
        return { ready: readyPromise, done, stop }
      }),
    } as unknown as DwsClient
    const transport = boot(client)
    const pages: ImTransportInboundPage[] = []
    const listening = transport.listen(account(), groupMentionPlan(), {
      receivePage: async page => {
        pages.push(page)
        return {
          conversations: [],
          cursor: {
            operationId: page.operationId, status: 'applied',
            cursor: { id: brandString<ImProviderCursorId>('cursor-1'), owner: page.owner, cursor: page.nextCursor, updatedAt: '2026-09-14T00:00:00.000Z' },
          },
        }
      },
    }, new AbortController().signal)
    let resolved = false
    listening.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    ready()
    const dispose = await listening
    await onLine(JSON.stringify({
      type: 'user_im_message_receive_group_all', event_id: 'event-1', timestamp: 1_726_000_000_000, subscribe_id: 'sub-1',
      message_id: 'message-1', conversation_id: 'cid-group', sender: '客户', sender_open_dingtalk_id: 'D-peer',
      content: 'hello', create_time: '2026-09-14 00:00:00', event_time: 1_726_000_000_000,
    }))
    await onLine(JSON.stringify({
      type: 'user_im_message_receive_at', event_id: 'event-1', timestamp: 1_726_000_000_000, subscribe_id: 'sub-1',
      message_id: 'message-1', conversation_id: 'cid-group', sender: '客户', sender_open_dingtalk_id: 'D-peer',
      content: 'hello', create_time: '2026-09-14 00:00:00', event_time: 1_726_000_000_000,
    }))
    await onLine(JSON.stringify({
      type: 'user_im_message_receive_o2o_all', event_id: 'event-direct', timestamp: 1_726_000_001_000, subscribe_id: 'sub-1',
      message_id: 'message-direct', conversation_id: 'cid-direct', sender: '客户', sender_open_dingtalk_id: 'D-peer',
      content: 'direct', create_time: '2026-09-14 00:00:01', event_time: 1_726_000_001_000,
    }))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toMatchObject({
      owner: { platform: 'dingtalk', accountId: account().id, streamId: 'corp-a:user-1:messages' },
      observedCursor: null,
      conversations: [{ conversationId: 'cid-group', conversationKind: 'group', messages: [{ externalMessageId: 'message-1', senderEvidence: { kind: 'external-actor', senderId: 'D-peer' } }] }],
    })
    expect(pages[0]?.conversations[0]?.messages[0]).not.toHaveProperty('mentionedConfiguredAccount')
    expect(pages[1]).toMatchObject({
      conversations: [{ conversationId: 'cid-group', conversationKind: 'group', messages: [{ externalMessageId: 'message-1', mentionedConfiguredAccount: true }] }],
    })
    expect(client.listen).toHaveBeenCalledOnce()
    await dispose()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does not treat an async task as sent and sends direct messages only to durable peer facts', async () => {
    const client = { send: vi.fn(async () => ({ state: 'unknown', externalMessageId: 'task-1' })) } as unknown as DwsClient
    const transport = boot(client)
    await expect(transport.send({ account: account(), conversationKind: 'group', conversationId: 'cid-group', requestId: 'request-1', text: 'hello' }, new AbortController().signal))
      .resolves.toEqual({ state: 'unknown', externalMessageId: 'task-1' })
    await expect(transport.send({ account: account(), conversationKind: 'direct', conversationId: 'cid-direct', requestId: 'request-2', text: 'hello' }, new AbortController().signal))
      .resolves.toMatchObject({ state: 'failed', code: 'DINGTALK_DIRECT_RECIPIENT_UNAVAILABLE' })
    await expect(transport.send({
      account: account(), conversationKind: 'direct', conversationId: 'cid-direct',
      directRecipient: { providerActorId: 'D-peer', openDingTalkId: 'D-peer' },
      requestId: 'request-3', text: 'hello',
    }, new AbortController().signal)).resolves.toEqual({ state: 'unknown', externalMessageId: 'task-1' })
    expect(client.send).toHaveBeenCalledTimes(2)
    expect(client.send).toHaveBeenLastCalledWith(
      'corp-a:user-1', { kind: 'direct-open', openDingTalkId: 'D-peer' }, 'hello', 'request-3', expect.any(AbortSignal),
    )
  })
})
