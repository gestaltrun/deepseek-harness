/** Durable schema for one complete IM conversation aggregate. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { z, type ZodType } from 'zod'
import type {
  ImAdmissionId,
  ImAgentTaskId,
  ImAgentTaskView,
  ImDeliveryOperationId,
  ImInboundOperationResult,
  ImDeliveryScope,
  ImInboundMessageInput,
  ImInboundMessageView,
  ImMessageId,
  ImOutboundAttemptId,
  ImOutboundRequestId,
  ImOutboundView,
  ImScopeId,
  ImProviderCursorCommitResult,
  ImProviderCursorId,
  ImProviderCursorOwner,
  ImTriggerReason,
} from './delivery-types.ts'
import type { ImAccountId, ImRevision, ImRouteId } from './types.ts'

const accountId = z.string().min(1).transform(value => brandString<ImAccountId>(value))
const operationId = z.string().min(1).transform(value => brandString<ImDeliveryOperationId>(value))
const messageId = z.string().min(1).transform(value => brandString<ImMessageId>(value))
const outboundRequestId = z.string().min(1).transform(value => brandString<ImOutboundRequestId>(value))
const outboundAttemptId = z.string().min(1).transform(value => brandString<ImOutboundAttemptId>(value))
const scopeId = z.string().min(1).transform(value => brandString<ImScopeId>(value))
const providerCursorId = z.string().min(1).transform(value => brandString<ImProviderCursorId>(value))
const admissionId = z.string().min(1).transform(value => brandString<ImAdmissionId>(value))
const agentTaskId = z.string().min(1).transform(value => brandString<ImAgentTaskId>(value))
const timestamp = z.iso.datetime()

const realScope = z.object({
  kind: z.literal('real'),
  platform: z.enum(['dingtalk', 'wangwang']),
  accountId,
  conversationKind: z.enum(['direct', 'group']),
  conversationId: z.string().min(1),
})

const simulationScope = z.object({
  kind: z.literal('simulation'),
  instanceId: z.string().min(1).transform(value => brandString(value)),
  platform: z.enum(['dingtalk', 'wangwang']),
  accountId,
  conversationKind: z.enum(['direct', 'group']),
  conversationId: z.string().min(1),
})

export const imDeliveryScopeSchema = z.discriminatedUnion('kind', [realScope, simulationScope]) as ZodType<ImDeliveryScope>

const sender = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('external'), senderId: z.string().min(1), senderDisplayName: z.string().optional(),
    userId: z.string().min(1).optional(), openDingTalkId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal('human-native'), accountId, providerActorId: z.string().min(1) }),
  z.object({ kind: z.literal('human-dsh'), outboundRequestId }),
  z.object({ kind: z.literal('ai'), outboundRequestId }),
  z.object({
    kind: z.literal('unknown'),
    reason: z.enum(['insufficient-evidence', 'unmatched-self', 'unmatched-echo', 'provider-unknown']),
    observedSenderId: z.string().optional(),
  }),
])

const content = z.object({ text: z.string(), format: z.enum(['text', 'markdown', 'unsupported']) })

/** Parser for provider and JSONL inbound records. */
export const imInboundMessageInputSchema = z.object({
  externalMessageId: z.string().min(1),
  sender,
  content,
  occurredAt: timestamp,
  mentionedConfiguredAccount: z.boolean().optional(),
}) as ZodType<ImInboundMessageInput>

const inboundMessage = z.object({
  messageId,
  scopeId,
  externalMessageId: z.string().min(1),
  sender,
  content,
  origin: z.enum(['live', 'jsonl-import']),
  stage: z.enum(['received', 'submitted']),
  sequenceNumber: z.number().int().positive(),
  occurredAt: timestamp,
  mentionedConfiguredAccount: z.boolean().optional(),
  receivedAt: timestamp,
  submission: z.object({ sessionId: z.string().min(1).transform(SessionId), submittedAt: timestamp }).optional(),
}) as ZodType<ImInboundMessageView>

const cursor = z.object({
  scopeId,
  platformCursor: z.string().nullable(),
  lastReceivedSequenceNumber: z.number().int().nonnegative(),
  lastSubmittedSequenceNumber: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  updatedAt: timestamp,
})

const pageResult = z.object({
  kind: z.literal('page'),
  operationId,
  status: z.enum(['applied', 'conflict']),
  acceptedCount: z.number().int().nonnegative(),
  evidenceMergedCount: z.number().int().nonnegative().optional(),
  duplicateCount: z.number().int().nonnegative(),
  messages: z.array(inboundMessage),
  cursor,
})

const importResult = z.object({
  kind: z.literal('jsonl-import'),
  operationId,
  status: z.literal('applied'),
  importedCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
})

const routeBinding = z.object({
  routeId: z.string().min(1).transform(value => brandString<ImRouteId>(value)),
  routeRevision: z.string().min(1).transform(value => brandString<ImRevision>(value)),
  accountRevision: z.string().min(1).transform(value => brandString<ImRevision>(value)),
  workspaceId: z.string().min(1).transform(WorkspaceId),
})

const receipt = z.object({
  providerReceiptId: z.string().optional(),
  providerStatus: z.string().optional(),
  errorCode: z.string().optional(),
  observedAt: timestamp,
})

const outbound = z.object({
  requestId: outboundRequestId,
  scopeId,
  intent: z.enum(['ai', 'human-manual']),
  content,
  status: z.enum(['pending', 'dispatching', 'pre-send-failed', 'sent', 'result-unknown', 'confirmed-failed']),
  sequenceNumber: z.number().int().positive(),
  routeBinding: routeBinding.optional(),
  preSendFailureReason: z.enum(['account-not-found', 'platform-mismatch', 'account-paused', 'route-disabled', 'route-unmatched', 'route-changed', 'cancelled']).optional(),
  attempt: z.object({ attemptId: outboundAttemptId, startedAt: timestamp }).optional(),
  receipt: receipt.optional(),
  externalMessageId: z.string().optional(),
  replyToExternalMessageId: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}) as ZodType<ImOutboundView>

interface StoredDeliveryOperation {
  readonly fingerprint: string
  readonly result: ImInboundOperationResult
}

/** One durable record per complete conversation scope. */
export interface ImDeliveryAggregate {
  readonly scope: ImDeliveryScope
  readonly scopeId: ImScopeId
  readonly nextMessageSequenceNumber: number
  readonly nextOutboundSequenceNumber: number
  readonly cursor: import('./delivery-types.ts').ImConversationCursor
  readonly messages: Readonly<Record<string, ImInboundMessageView>>
  readonly messageIdsByExternalId: Readonly<Record<string, ImMessageId>>
  readonly operations: Readonly<Record<string, StoredDeliveryOperation>>
  readonly outbounds: Readonly<Record<string, ImOutboundView>>
}

export const imDeliveryAggregateSchema = z.object({
  scope: imDeliveryScopeSchema,
  scopeId,
  nextMessageSequenceNumber: z.number().int().positive(),
  nextOutboundSequenceNumber: z.number().int().positive(),
  cursor,
  messages: z.record(z.string(), inboundMessage),
  messageIdsByExternalId: z.record(z.string(), messageId),
  operations: z.record(z.string(), z.object({ fingerprint: z.string(), result: z.union([pageResult, importResult]) })),
  outbounds: z.record(z.string(), outbound),
}) as ZodType<ImDeliveryAggregate>

const providerCursorOwner = z.object({
  platform: z.enum(['dingtalk', 'wangwang']),
  accountId,
  streamId: z.string().min(1),
}) as ZodType<ImProviderCursorOwner>

const providerCursorView = z.object({
  id: providerCursorId,
  owner: providerCursorOwner,
  cursor: z.string().nullable(),
  updatedAt: timestamp,
})

const providerCursorResult = z.object({
  operationId,
  status: z.enum(['applied', 'unchanged', 'conflict', 'rejected']),
  cursor: providerCursorView,
  code: z.literal('IM_PROVIDER_PAGE_NOT_DURABLE').optional(),
  message: z.string().optional(),
}) as ZodType<ImProviderCursorCommitResult>

/** One provider feed cursor plus queryable CAS receipts. */
export interface ImProviderCursorAggregate {
  readonly id: ImProviderCursorId
  readonly owner: ImProviderCursorOwner
  readonly cursor: string | null
  readonly updatedAt: string
  readonly operations: Readonly<Record<string, { readonly fingerprint: string; readonly result: ImProviderCursorCommitResult }>>
}

const imProviderCursorAggregateSchema = z.object({
  id: providerCursorId,
  owner: providerCursorOwner,
  cursor: z.string().nullable(),
  updatedAt: timestamp,
  operations: z.record(z.string(), z.object({ fingerprint: z.string(), result: providerCursorResult })),
}) as ZodType<ImProviderCursorAggregate>

/** Batch frozen before Agent creation or steering begins. */
export interface ImPendingAdmission {
  readonly admissionId: ImAdmissionId
  readonly messageIds: readonly ImMessageId[]
  readonly triggerReasons: readonly ImTriggerReason[]
  readonly createdAt: string
}

/** Durable execution assignment for one conversation scope. */
export interface ImExecutionAggregate extends ImAgentTaskView {
  readonly pendingAdmission?: ImPendingAdmission
}

const triggerReason = z.enum(['direct', 'mention', 'every-n', 'fixed-interval'])

const imExecutionAggregateSchema = z.object({
  taskId: agentTaskId,
  generation: z.number().int().positive(),
  scope: imDeliveryScopeSchema,
  scopeId,
  sessionId: z.string().min(1).transform(SessionId),
  routeId: z.string().min(1).transform(value => brandString<ImRouteId>(value)),
  routeRevision: z.string().min(1).transform(value => brandString<ImRevision>(value)),
  accountRevision: z.string().min(1).transform(value => brandString<ImRevision>(value)),
  workspaceId: z.string().min(1).transform(WorkspaceId),
  agentPreset: z.string().min(1),
  groupTrigger: z.object({
    mention: z.boolean().optional(),
    everyN: z.number().int().positive().optional(),
    fixedIntervalSeconds: z.number().int().positive().optional(),
  }).optional(),
  directRecipient: z.object({
    providerActorId: z.string().min(1),
    userId: z.string().min(1).optional(),
    openDingTalkId: z.string().min(1).optional(),
  }).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  pendingAdmission: z.object({
    admissionId,
    messageIds: z.array(messageId).min(1),
    triggerReasons: z.array(triggerReason).min(1),
    createdAt: timestamp,
  }).optional(),
}) as ZodType<ImExecutionAggregate>

/** IM delivery domain. Each mutation writes exactly one scope aggregate. */
export const imDeliveryDomainSpec = defineDomain({
  name: 'gestaltrun_im_delivery',
  version: 1,
  tables: {
    scopes: domainTable<ImScopeId, ImDeliveryAggregate>(imDeliveryAggregateSchema),
    provider_cursors: domainTable<ImProviderCursorId, ImProviderCursorAggregate>(imProviderCursorAggregateSchema),
    executions: domainTable<ImAgentTaskId, ImExecutionAggregate>(imExecutionAggregateSchema),
  },
})
