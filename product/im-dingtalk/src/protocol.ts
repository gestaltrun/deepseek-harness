/** Strict public DWS JSON and NDJSON protocol parsing. */
import type { ImAccountAuthorization, ImConversationKind, ImTransportSendResult } from '@gestaltrun/dsh-im-runtime'
import { z } from 'zod'

/** Minimum DWS release that publishes the reviewed IM listener facade. */
export const DWS_MINIMUM_VERSION = '1.0.61'
/** Provider-explicit mention event key. */
export const DWS_EVENT_MENTION = 'user_im_message_receive_at'
/** All direct message event key. */
export const DWS_EVENT_ALL_DIRECT = 'user_im_message_receive_o2o_all'
/** All group message event key. */
export const DWS_EVENT_ALL_GROUP = 'user_im_message_receive_group_all'
/** Complete public event set consumed for one employee profile. */
export const DWS_MESSAGE_EVENT_KEYS = [DWS_EVENT_MENTION, DWS_EVENT_ALL_DIRECT, DWS_EVENT_ALL_GROUP] as const

/** Typed DWS failure with a stable provider code and no captured output. */
export class DwsProtocolError extends Error {
  /** @param code - stable provider error code. @param message - safe diagnostic. */
  constructor(readonly code: string, message: string) { super(message); this.name = 'DwsProtocolError' }
}

const profileSchema = z.object({
  profile: z.string().min(1),
  corpId: z.string().min(1),
  corpName: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().optional(),
  status: z.enum(['active', 'expired', 'revoked', 'unavailable']).optional(),
  expiresAt: z.string().optional(),
  refreshExpAt: z.string().optional(),
  isPrimary: z.boolean(),
  isCurrent: z.boolean(),
  isOrgCurrent: z.boolean(),
}).passthrough()

const profileListSchema = z.object({ success: z.literal(true), profiles: z.array(profileSchema) }).passthrough()
const authStatusSchema = z.object({
  success: z.literal(true),
  authenticated: z.boolean(),
  reason: z.string().optional(),
  refreshed: z.boolean().optional(),
  token_valid: z.boolean().optional(),
  refresh_token_valid: z.boolean().optional(),
  corp_id: z.string().optional(),
  corp_name: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
}).passthrough()

/** One stable installed employee profile. */
export interface DwsProfile {
  readonly profile: string
  readonly corpId: string
  readonly corpName: string
  readonly userId: string
  readonly userName?: string
  readonly status?: 'active' | 'expired' | 'revoked' | 'unavailable'
}

function parseJson(text: string, code: string): unknown {
  try { return JSON.parse(text) } catch { throw new DwsProtocolError(code, 'DWS returned invalid JSON') }
}

/**
 * Parse installed profiles and require the stable corpId:userId selector.
 * @param text - complete `profile list --format json` output.
 * @returns independently addressable employee profiles.
 */
export function parseDwsProfiles(text: string): readonly DwsProfile[] {
  const parsed = profileListSchema.safeParse(parseJson(text, 'DINGTALK_PROFILE_LIST_INVALID'))
  if (!parsed.success) throw new DwsProtocolError('DINGTALK_PROFILE_LIST_INVALID', 'DWS profile list did not match the public schema')
  return parsed.data.profiles.map(profile => {
    if (profile.profile !== `${profile.corpId}:${profile.userId}`) {
      throw new DwsProtocolError('DINGTALK_PROFILE_SELECTOR_UNSTABLE', 'DWS profile is not addressed by corpId:userId')
    }
    return {
      profile: profile.profile,
      corpId: profile.corpId,
      corpName: profile.corpName,
      userId: profile.userId,
      ...(profile.userName === undefined ? {} : { userName: profile.userName }),
      ...(profile.status === undefined ? {} : { status: profile.status }),
    }
  })
}

/**
 * Convert a non-refreshing profile observation into durable authorization facts.
 * @param profile - exact installed profile.
 * @param checkedAt - observation time.
 * @returns authorization without inferring expiry from generic failures.
 */
export function authorizationFromProfile(profile: DwsProfile, checkedAt: string): ImAccountAuthorization {
  switch (profile.status) {
    case 'active': return { state: 'ready', checkedAt }
    case 'expired': return { state: 'required', reason: 'expired', checkedAt }
    case 'revoked': return { state: 'required', reason: 'revoked', checkedAt }
    case 'unavailable': return { state: 'failed', code: 'DINGTALK_PROFILE_UNAVAILABLE', message: 'DWS profile authorization is unavailable', checkedAt }
    case undefined: return { state: 'failed', code: 'DINGTALK_PROFILE_STATUS_UNKNOWN', message: 'DWS profile did not report authorization status', checkedAt }
    default: return assertNever(profile.status)
  }
}

/** Parsed refresh result plus provider-confirmed identity fields. */
export interface DwsAuthStatus {
  readonly authorization: ImAccountAuthorization
  readonly corpId?: string
  readonly corpName?: string
  readonly userId?: string
  readonly userName?: string
}

/**
 * Parse `auth status`, which may refresh only the explicitly selected profile.
 * @param text - complete command output.
 * @param checkedAt - observation time.
 * @returns authorization and refreshed identity facts.
 */
export function parseDwsAuthStatus(text: string, checkedAt: string): DwsAuthStatus {
  const parsed = authStatusSchema.safeParse(parseJson(text, 'DINGTALK_AUTH_STATUS_INVALID'))
  if (!parsed.success) throw new DwsProtocolError('DINGTALK_AUTH_STATUS_INVALID', 'DWS auth status did not match the public schema')
  const data = parsed.data
  const identity = {
    ...(data.corp_id === undefined ? {} : { corpId: data.corp_id }),
    ...(data.corp_name === undefined ? {} : { corpName: data.corp_name }),
    ...(data.user_id === undefined ? {} : { userId: data.user_id }),
    ...(data.user_name === undefined ? {} : { userName: data.user_name }),
  }
  if (data.authenticated) {
    if (data.token_valid !== true || data.corp_id === undefined || data.user_id === undefined) {
      return { authorization: { state: 'failed', code: 'DINGTALK_AUTH_FACTS_INCOMPLETE', message: 'DWS authenticated status omitted required token or identity facts', checkedAt }, ...identity }
    }
    return { authorization: { state: 'ready', checkedAt }, ...identity }
  }
  if (data.reason === 'token_refresh_failed') {
    return { authorization: { state: 'required', reason: 'expired', checkedAt }, ...identity }
  }
  if (data.reason === undefined) {
    return { authorization: { state: 'required', reason: 'missing', checkedAt }, ...identity }
  }
  return { authorization: { state: 'failed', code: `DINGTALK_AUTH_${data.reason.toUpperCase()}`, message: 'DWS could not establish employee authorization', checkedAt }, ...identity }
}

const conversationSchema = z.object({
  openConversationId: z.string().min(1),
  conversationName: z.string().min(1).optional(),
  conversationType: z.union([z.string(), z.boolean(), z.number()]),
}).passthrough()

const conversationPageSchema = z.object({
  conversations: z.array(conversationSchema),
  hasMore: z.boolean(),
  nextCursor: z.union([z.number(), z.string()]).optional(),
}).passthrough()

/** One DWS conversation that retains its real platform identifier. */
export interface DwsConversation {
  readonly conversationId: string
  readonly displayName: string
  readonly conversationKind: ImConversationKind
}
/** One strict DWS conversation page. */
export interface DwsConversationPage { readonly conversations: readonly DwsConversation[]; readonly nextCursor?: string }

function conversationKind(value: string | boolean | number): ImConversationKind | undefined {
  if (typeof value === 'boolean') return value ? 'direct' : 'group'
  if (typeof value === 'number') return value === 1 ? 'direct' : value === 0 ? 'group' : undefined
  switch (value.trim().toLowerCase()) {
    case 'group': case 'groupchat': case 'group_chat': return 'group'
    case 'direct': case 'single': case 'singlechat': case 'single_chat': case 'p2p': return 'direct'
    default: return undefined
  }
}

/**
 * Parse one `chat +conversation-list` page without defaulting an unknown kind.
 * @param text - complete command output.
 * @returns normalized conversation candidates and a proven continuation.
 */
export function parseDwsConversationPage(text: string): DwsConversationPage {
  const parsed = conversationPageSchema.safeParse(parseJson(text, 'DINGTALK_CONVERSATION_PAGE_INVALID'))
  if (!parsed.success) throw new DwsProtocolError('DINGTALK_CONVERSATION_PAGE_INVALID', 'DWS conversation page did not match the public schema')
  const conversations = parsed.data.conversations.map(row => {
    const kind = conversationKind(row.conversationType)
    if (kind === undefined) throw new DwsProtocolError('DINGTALK_CONVERSATION_KIND_UNKNOWN', 'DWS returned an unknown conversation type')
    return { conversationId: row.openConversationId, displayName: row.conversationName ?? row.openConversationId, conversationKind: kind }
  })
  if (!parsed.data.hasMore) return { conversations }
  const next = parsed.data.nextCursor
  if (next === undefined || !/^\d+$/u.test(String(next)) || !Number.isSafeInteger(Number(next)) || Number(next) <= 0) {
    throw new DwsProtocolError('DINGTALK_CONVERSATION_CURSOR_INVALID', 'DWS reported more conversations without a forward cursor')
  }
  return { conversations, nextCursor: String(next) }
}

const eventSchema = z.object({
  type: z.enum(DWS_MESSAGE_EVENT_KEYS),
  event_id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  subscribe_id: z.string().min(1),
  message_id: z.string().min(1),
  conversation_id: z.string().min(1),
  sender: z.string(),
  sender_open_dingtalk_id: z.string().min(1),
  content: z.string(),
  create_time: z.string(),
  event_time: z.number().int().nonnegative(),
}).passthrough()

/** One public flattened DWS message with explicit mention and direct-recipient facts. */
export interface DwsInboundEvent {
  readonly eventId: string
  readonly eventKey: typeof DWS_MESSAGE_EVENT_KEYS[number]
  readonly messageId: string
  readonly conversationId: string
  readonly conversationKind: ImConversationKind
  readonly senderId: string
  readonly senderName?: string
  readonly directRecipientId?: string
  readonly text: string
  readonly occurredAt: string
  readonly mentionedConfiguredAccount?: true
}

/**
 * Parse one flattened DWS NDJSON message; malformed or unrelated lines fail closed.
 * @param line - one complete stdout line.
 * @returns provider evidence needed by runtime admission.
 */
export function parseDwsInboundEvent(line: string): DwsInboundEvent {
  const parsed = eventSchema.safeParse(parseJson(line, 'DINGTALK_EVENT_INVALID'))
  if (!parsed.success) throw new DwsProtocolError('DINGTALK_EVENT_INVALID', 'DWS event did not match the flattened message schema')
  const event = parsed.data
  const direct = event.type === DWS_EVENT_ALL_DIRECT
  return {
    eventId: event.event_id,
    eventKey: event.type,
    messageId: event.message_id,
    conversationId: event.conversation_id,
    conversationKind: direct ? 'direct' : 'group',
    senderId: event.sender_open_dingtalk_id,
    ...(event.sender.length === 0 ? {} : { senderName: event.sender }),
    ...(direct ? { directRecipientId: event.sender_open_dingtalk_id } : {}),
    text: event.content,
    occurredAt: new Date(event.event_time).toISOString(),
    ...(event.type === DWS_EVENT_MENTION ? { mentionedConfiguredAccount: true as const } : {}),
  }
}

function records(value: unknown): readonly Record<string, unknown>[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const root = value as Record<string, unknown>
  const out = [root]
  for (const key of ['result', 'data']) {
    const nested = root[key]
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) out.push(nested as Record<string, unknown>)
  }
  return out
}

function stringField(values: readonly Record<string, unknown>[], names: readonly string[]): string | undefined {
  for (const value of values) for (const name of names) {
    const field = value[name]
    if (typeof field === 'string' && field.trim().length > 0) return field.trim()
  }
  return undefined
}

/**
 * Parse a send or query receipt without treating an asynchronous task as sent.
 * @param text - complete public command JSON output.
 * @returns definite sent/failed facts or an unknown result for later confirmation.
 */
export function parseDwsSendResult(text: string): ImTransportSendResult {
  const parsed = parseJson(text, 'DINGTALK_SEND_RESULT_INVALID')
  const values = records(parsed)
  if (values.length === 0) throw new DwsProtocolError('DINGTALK_SEND_RESULT_INVALID', 'DWS send result was not an object')
  const taskId = stringField(values, ['openTaskId', 'open_task_id'])
  const messageId = stringField(values, ['openMessageId', 'open_message_id'])
  const status = stringField(values, ['status', 'sendStatus', 'send_status'])?.toUpperCase()
  const explicitFailure = values.some(value => value['success'] === false) || status === 'FAILED' || status === 'FAILURE' || status === 'REJECTED'
  if (explicitFailure) return { state: 'failed', code: status === undefined ? 'DINGTALK_SEND_REJECTED' : `DINGTALK_SEND_${status}`, message: 'DWS reported that DingTalk rejected the message' }
  if (messageId !== undefined && (status === 'SUCCESS' || status === 'SENT' || status === 'DELIVERED')) {
    return { state: 'sent', externalMessageId: messageId, rawStatus: status }
  }
  return { state: 'unknown', ...(taskId === undefined ? {} : { externalMessageId: taskId }) }
}

function assertNever(value: never): never { throw new DwsProtocolError('DINGTALK_UNREACHABLE', `Unhandled DWS value ${String(value)}`) }

/**
 * Require a DWS semantic version at or above the reviewed release.
 * @param text - `dws --version` output.
 * @returns normalized version.
 */
export function parseAndRequireDwsVersion(text: string): string {
  const match = /\bv?(\d+)\.(\d+)\.(\d+)\b/u.exec(text)
  if (match === null) throw new DwsProtocolError('DINGTALK_DWS_VERSION_INVALID', 'DWS did not report a semantic version')
  const actual = match.slice(1, 4).map(Number)
  const minimum = DWS_MINIMUM_VERSION.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (actual[index]! > minimum[index]!) return actual.join('.')
    if (actual[index]! < minimum[index]!) throw new DwsProtocolError('DINGTALK_DWS_VERSION_UNSUPPORTED', `DWS ${actual.join('.')} is older than ${DWS_MINIMUM_VERSION}`)
  }
  return actual.join('.')
}
