/** Durable StorageDomain records for IM configuration. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { z, type ZodType } from 'zod'
import type {
  ImAccountAuthorization,
  ImAccountId,
  ImAccountMutationResult,
  ImAccountView,
  ImOperationId,
  ImRevision,
  ImRouteId,
  ImRouteMutationResult,
  ImRouteView,
  ImSimulationTargetMutationResult,
  ImSimulationTargetView,
  ImSimulationInstanceId,
  ImSimulationInstanceView,
} from './types.ts'

const accountId = z.string().min(1).transform(value => brandString<ImAccountId>(value))
const routeId = z.string().min(1).transform(value => brandString<ImRouteId>(value))
const operationId = z.string().min(1).transform(value => brandString<ImOperationId>(value))
const revision = z.string().min(1).transform(value => brandString<ImRevision>(value))
const workspaceId = z.string().min(1).transform(WorkspaceId)
const timestamp = z.iso.datetime()
const simulationInstanceId = z.string().min(1).transform(value => brandString<ImSimulationInstanceId>(value))

const authorization = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unchecked') }),
  z.object({ state: z.literal('ready'), checkedAt: timestamp }),
  z.object({ state: z.literal('required'), reason: z.enum(['missing', 'expired', 'revoked']), checkedAt: timestamp.optional() }),
  z.object({ state: z.literal('failed'), code: z.string().min(1), message: z.string().min(1), checkedAt: timestamp }),
]) as ZodType<ImAccountAuthorization>

const identity = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('dingtalk'), profile: z.string().min(1), corpId: z.string().min(1), userId: z.string().min(1), displayName: z.string().min(1) }),
  z.object({ platform: z.literal('wangwang'), merchantId: z.string().min(1), displayName: z.string().min(1), mainServiceAccountId: z.string().min(1).optional() }),
])

const groupTrigger = z.object({
  mention: z.boolean().optional(),
  everyN: z.number().int().positive().optional(),
  fixedIntervalSeconds: z.number().int().positive().optional(),
}).refine(value => value.mention === true || value.everyN !== undefined || value.fixedIntervalSeconds !== undefined, {
  message: 'group trigger must enable mention, everyN, or fixedIntervalSeconds',
})

const routeTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('specific'),
    conversationId: z.string().min(1),
    directRecipient: z.object({
      providerActorId: z.string().min(1),
      userId: z.string().min(1).optional(),
      openDingTalkId: z.string().min(1).optional(),
    }).optional(),
  }),
])

/** Stored account fields; listener status is process state and is derived on read. */
export type ImAccountRecord = Omit<ImAccountView, 'listener'>

export const imAccountRecordSchema = z.object({
  id: accountId,
  platform: z.enum(['dingtalk', 'wangwang']),
  displayName: z.string().min(1),
  identity,
  credentialKey: z.string().transform(parseCredentialKey).optional(),
  authorization,
  connectionIntent: z.enum(['connected', 'disconnected']).default('connected'),
  paused: z.boolean(),
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
}).superRefine((value, context) => {
  if (value.platform !== value.identity.platform) context.addIssue({ code: 'custom', message: 'account platform must match identity platform' })
}) as ZodType<ImAccountRecord>

export const imRouteSchema = z.object({
  id: routeId,
  platform: z.enum(['dingtalk', 'wangwang']),
  accountId,
  conversationKind: z.enum(['direct', 'group']),
  target: routeTarget,
  workspaceId,
  enabled: z.boolean(),
  groupTrigger: groupTrigger.optional(),
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
}).superRefine((value, context) => {
  if (value.conversationKind === 'group' && value.groupTrigger === undefined) context.addIssue({ code: 'custom', message: 'group routes require groupTrigger' })
  if (value.conversationKind === 'direct' && value.groupTrigger !== undefined) context.addIssue({ code: 'custom', message: 'direct routes cannot carry groupTrigger' })
}) as ZodType<ImRouteView>

const routeResult = z.object({
  operationId,
  status: z.enum(['applied', 'unchanged', 'conflict', 'rejected']),
  route: imRouteSchema.optional(),
  deletedRevision: revision.optional(),
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
}) as ZodType<ImRouteMutationResult>

const accountResult = z.object({
  operationId,
  status: z.enum(['applied', 'unchanged', 'conflict', 'rejected']),
  account: imAccountRecordSchema,
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
}) as ZodType<StoredAccountMutationResult>

interface StoredRouteOperation { readonly fingerprint: string; readonly result: ImRouteMutationResult }
interface StoredAccountMutationResult extends Omit<ImAccountMutationResult, 'account'> { readonly account: ImAccountRecord }
interface StoredAccountOperation { readonly fingerprint: string; readonly result: StoredAccountMutationResult }

/** One atomic account aggregate: safe account facts, routes, and queryable operation receipts. */
export interface ImAccountAggregate {
  readonly account: ImAccountRecord
  readonly routes: Readonly<Record<string, ImRouteView>>
  readonly routeOperations: Readonly<Record<string, StoredRouteOperation>>
  readonly accountOperations: Readonly<Record<string, StoredAccountOperation>>
}

export const imAccountAggregateSchema = z.object({
  account: imAccountRecordSchema,
  routes: z.record(z.string(), imRouteSchema),
  routeOperations: z.record(z.string(), z.object({ fingerprint: z.string(), result: routeResult })),
  accountOperations: z.record(z.string(), z.object({ fingerprint: z.string(), result: accountResult })),
}) as ZodType<ImAccountAggregate>

export const imSimulationTargetSchema = z.object({
  workspaceId,
  accountId,
  routeId,
  revision,
  updatedAt: timestamp,
}) as ZodType<ImSimulationTargetView>

const simulationTargetResult = z.object({
  operationId,
  status: z.enum(['applied', 'unchanged', 'conflict', 'rejected']),
  target: imSimulationTargetSchema.optional(),
  deletedRevision: revision.optional(),
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
}) as ZodType<ImSimulationTargetMutationResult>

interface StoredSimulationTargetOperation { readonly fingerprint: string; readonly result: ImSimulationTargetMutationResult }

/** Workspace simulation-target aggregate retaining receipts after target removal. */
export interface ImSimulationTargetAggregate {
  readonly workspaceId: import('@deepseek-ai/dsh-workspace').WorkspaceId
  readonly target?: ImSimulationTargetView
  readonly operations: Readonly<Record<string, StoredSimulationTargetOperation>>
}

export const imSimulationTargetAggregateSchema = z.object({
  workspaceId,
  target: imSimulationTargetSchema.optional(),
  operations: z.record(z.string(), z.object({ fingerprint: z.string(), result: simulationTargetResult })),
}) as ZodType<ImSimulationTargetAggregate>

/** Parser for one durable two-Session simulation lifecycle. */
export const imSimulationInstanceSchema = z.object({
  instanceId: simulationInstanceId,
  status: z.enum(['creating', 'running', 'stopping', 'stopped', 'failed']),
  simUserSessionId: z.string().min(1).transform(SessionId),
  simUserWorkspaceId: workspaceId,
  testedSessionId: z.string().min(1).transform(SessionId),
  target: z.object({
    platform: z.enum(['dingtalk', 'wangwang']),
    accountId,
    routeId,
    routeRevision: revision,
    accountRevision: revision,
    conversationKind: z.enum(['direct', 'group']),
    conversationId: z.string().min(1),
    workspaceId,
    agentPreset: z.string().min(1),
    groupTrigger: groupTrigger.optional(),
    directRecipient: z.object({
      providerActorId: z.string().min(1),
      userId: z.string().min(1).optional(),
      openDingTalkId: z.string().min(1).optional(),
    }).optional(),
  }),
  speakingMembers: z.array(z.object({ actorId: z.string().min(1), displayName: z.string().min(1).optional() })),
  createdAt: timestamp,
  updatedAt: timestamp,
  stoppedAt: timestamp.optional(),
  failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
}).superRefine((value, context) => {
  if ((value.status === 'stopped') !== (value.stoppedAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'only stopped simulation instances carry stoppedAt' })
  }
  if ((value.status === 'failed') !== (value.failure !== undefined)) {
    context.addIssue({ code: 'custom', message: 'only failed simulation instances carry failure details' })
  }
}) as ZodType<ImSimulationInstanceView>

/** IM configuration storage schema. Cross-account or cross-table transactions are not implied. */
export const imRuntimeDomainSpec = defineDomain({
  name: 'gestaltrun_im_runtime',
  version: 1,
  tables: {
    accounts: domainTable<ImAccountId, ImAccountAggregate>(imAccountAggregateSchema),
    simulation_targets: domainTable<import('@deepseek-ai/dsh-workspace').WorkspaceId, ImSimulationTargetAggregate>(imSimulationTargetAggregateSchema),
    simulation_instances: domainTable<ImSimulationInstanceId, ImSimulationInstanceView>(imSimulationInstanceSchema),
  },
})
