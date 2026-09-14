import { describe, expect, it } from 'vitest'
import {
  authorizationFromProfile,
  parseAndRequireDwsVersion,
  parseDwsAuthStatus,
  parseDwsConversationPage,
  parseDwsInboundEvent,
  parseDwsProfiles,
  parseDwsSendResult,
} from '../src/protocol.ts'

describe('DWS public protocol', () => {
  it('requires the reviewed DWS release and stable multi-account profile selectors', () => {
    expect(parseAndRequireDwsVersion('dws version v1.0.61 (fixture)')).toBe('1.0.61')
    expect(() => parseAndRequireDwsVersion('v1.0.60')).toThrowError(expect.objectContaining({ code: 'DINGTALK_DWS_VERSION_UNSUPPORTED' }))
    const profiles = parseDwsProfiles(JSON.stringify({
      success: true,
      profiles: [
        { profile: 'corp-a:user-1', corpId: 'corp-a', corpName: 'A', userId: 'user-1', userName: '甲', status: 'active', isPrimary: true, isCurrent: true, isOrgCurrent: true },
        { profile: 'corp-a:user-2', corpId: 'corp-a', corpName: 'A', userId: 'user-2', userName: '乙', status: 'expired', isPrimary: false, isCurrent: false, isOrgCurrent: false },
      ],
    }))
    expect(profiles.map(value => value.profile)).toEqual(['corp-a:user-1', 'corp-a:user-2'])
    expect(authorizationFromProfile(profiles[0]!, 'now')).toEqual({ state: 'ready', checkedAt: 'now' })
    expect(authorizationFromProfile(profiles[1]!, 'now')).toEqual({ state: 'required', reason: 'expired', checkedAt: 'now' })
    expect(() => parseDwsProfiles(JSON.stringify({
      success: true,
      profiles: [{ profile: 'corp-a', corpId: 'corp-a', corpName: 'A', userId: 'user-1', status: 'active', isPrimary: true, isCurrent: true, isOrgCurrent: true }],
    }))).toThrowError(expect.objectContaining({ code: 'DINGTALK_PROFILE_SELECTOR_UNSTABLE' }))
  })

  it('distinguishes refresh expiry, missing login, identity facts, and local key failures', () => {
    expect(parseDwsAuthStatus(JSON.stringify({ success: true, authenticated: true, token_valid: true, corp_id: 'corp-a', user_id: 'user-1' }), 'now'))
      .toEqual({ authorization: { state: 'ready', checkedAt: 'now' }, corpId: 'corp-a', userId: 'user-1' })
    expect(parseDwsAuthStatus(JSON.stringify({ success: true, authenticated: false, reason: 'token_refresh_failed' }), 'now').authorization)
      .toEqual({ state: 'required', reason: 'expired', checkedAt: 'now' })
    expect(parseDwsAuthStatus(JSON.stringify({ success: true, authenticated: false }), 'now').authorization)
      .toEqual({ state: 'required', reason: 'missing', checkedAt: 'now' })
    expect(parseDwsAuthStatus(JSON.stringify({ success: true, authenticated: false, reason: 'keychain_unavailable' }), 'now').authorization)
      .toMatchObject({ state: 'failed', code: 'DINGTALK_AUTH_KEYCHAIN_UNAVAILABLE' })
  })

  it('keeps platform conversation IDs and rejects unknown kind or unsafe pagination', () => {
    expect(parseDwsConversationPage(JSON.stringify({
      conversations: [
        { openConversationId: 'cid-group', conversationName: '群', conversationType: 'group_chat' },
        { openConversationId: 'cid-direct', conversationName: '单聊', conversationType: 'P2P' },
      ],
      hasMore: true,
      nextCursor: 2,
    }))).toEqual({
      conversations: [
        { conversationId: 'cid-group', displayName: '群', conversationKind: 'group' },
        { conversationId: 'cid-direct', displayName: '单聊', conversationKind: 'direct' },
      ],
      nextCursor: '2',
    })
    expect(() => parseDwsConversationPage(JSON.stringify({ conversations: [{ openConversationId: 'cid', conversationType: 'bot' }], hasMore: false })))
      .toThrowError(expect.objectContaining({ code: 'DINGTALK_CONVERSATION_KIND_UNKNOWN' }))
    expect(() => parseDwsConversationPage(JSON.stringify({ conversations: [], hasMore: true })))
      .toThrowError(expect.objectContaining({ code: 'DINGTALK_CONVERSATION_CURSOR_INVALID' }))
  })

  it('derives mention only from the at-me event and retains direct peer identity separately', () => {
    const base = {
      event_id: 'event-1', timestamp: 1_726_000_000_000, subscribe_id: 'sub-1',
      message_id: 'message-1', conversation_id: 'cid-direct', sender: '买家',
      sender_open_dingtalk_id: 'D-peer', content: '@我 你好', create_time: '2026-09-14 00:00:00', event_time: 1_726_000_000_000,
    }
    const direct = parseDwsInboundEvent(JSON.stringify({ ...base, type: 'user_im_message_receive_o2o_all' }))
    expect(direct).toMatchObject({ conversationId: 'cid-direct', conversationKind: 'direct', directRecipientId: 'D-peer' })
    expect(direct).not.toHaveProperty('mentionedConfiguredAccount')
    const mention = parseDwsInboundEvent(JSON.stringify({ ...base, type: 'user_im_message_receive_at', conversation_id: 'cid-group' }))
    expect(mention).toMatchObject({ conversationId: 'cid-group', conversationKind: 'group', mentionedConfiguredAccount: true })
    expect(mention).not.toHaveProperty('directRecipientId')
    expect(() => parseDwsInboundEvent(JSON.stringify({ ...base, type: 'unknown' })))
      .toThrowError(expect.objectContaining({ code: 'DINGTALK_EVENT_INVALID' }))
  })

  it('keeps asynchronous sends unknown until status supplies a final message ID', () => {
    expect(parseDwsSendResult(JSON.stringify({ success: true, result: { openTaskId: 'task-1' } })))
      .toEqual({ state: 'unknown', externalMessageId: 'task-1' })
    expect(parseDwsSendResult(JSON.stringify({ result: { status: 'SUCCESS', openTaskId: 'task-1', openMessageId: 'message-1' } })))
      .toEqual({ state: 'sent', externalMessageId: 'message-1', rawStatus: 'SUCCESS' })
    expect(parseDwsSendResult(JSON.stringify({ result: { status: 'FAILED', openTaskId: 'task-1' } })))
      .toMatchObject({ state: 'failed', code: 'DINGTALK_SEND_FAILED' })
  })
})
