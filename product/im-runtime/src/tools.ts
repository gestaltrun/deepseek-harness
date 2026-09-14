/** Scope-bound IM history and outbound tools for an admitted Agent. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImRuntime } from './runtime.ts'
import type { ImDeliveryScope, ImOutboundRequestId, ImOutboundRouteBinding } from './delivery-types.ts'
import type { ImDirectRecipient } from './types.ts'

/**
 * Register IM tools whose conversation scope is fixed by trusted Agent setup.
 * @param ctx - unpublished Agent context that owns the registrations.
 * @param runtime - Host runtime that owns history, policy checks, and transports.
 * @param scope - complete admitted conversation identity hidden from model arguments.
 * @param binding - route, workspace, and account generation frozen for this Agent.
 * @param directRecipient - provider peer identity frozen for a direct conversation.
 * @returns disposer for both registrations.
 */
export function registerImAgentTools(ctx: Context, runtime: ImRuntime, scope: ImDeliveryScope, binding: ImOutboundRouteBinding, directRecipient?: ImDirectRecipient): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'im_query_history',
      description: 'Read older messages from the IM conversation that started this task.',
      parameters: {
        limit: { type: 'integer', required: true },
        beforeSequenceNumber: { type: 'integer' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            messages: { type: 'array', required: true, items: { type: 'string' } },
            hasMore: { type: 'boolean', required: true },
            nextBeforeSequenceNumber: { type: 'integer' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.messages.join('\n') }],
      },
      execute: async (args) => {
        if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100) {
          throw new TypeError('IM history limit must be a positive safe integer no greater than 100')
        }
        if (args.beforeSequenceNumber !== undefined && (!Number.isSafeInteger(args.beforeSequenceNumber) || args.beforeSequenceNumber < 1)) {
          throw new TypeError('IM history cursor must be a positive safe integer')
        }
        const page = runtime.queryHistory({
          scope,
          limit: args.limit,
          ...(args.beforeSequenceNumber === undefined ? {} : { beforeSequenceNumber: args.beforeSequenceNumber }),
        })
        return {
          messages: page.items.map(message => `${message.sequenceNumber}: ${message.content.text}`),
          hasMore: page.hasMore,
          ...(page.nextBeforeSequenceNumber === undefined ? {} : { nextBeforeSequenceNumber: page.nextBeforeSequenceNumber }),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'im_send_message',
      description: 'Send a reply to the IM conversation that started this task.',
      parameters: {
        text: { type: 'string', required: true },
        replyToExternalMessageId: { type: 'string' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            requestId: { type: 'string', required: true },
            status: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `IM reply ${value.status} (${value.requestId})` }],
      },
      execute: async (args, execution) => {
        const requestId = brandString<ImOutboundRequestId>(`im-outbound:${randomUUID()}`)
        const outbound = await runtime.registerAgentOutbound({
          requestId,
          scope,
          intent: 'ai',
          content: { text: args.text, format: 'text' },
          ...(args.replyToExternalMessageId === undefined ? {} : { replyToExternalMessageId: args.replyToExternalMessageId }),
        }, binding)
        if (scope.kind === 'simulation') {
          const settled = await runtime.settleSimulationOutbound({ scope, requestId })
          return { requestId, status: settled.status }
        }
        const attempt = await runtime.beginOutboundAttempt({ scope, requestId })
        if (attempt.state !== 'ready') return { requestId, status: attempt.outbound.status }
        const account = runtime.snapshot().accounts.find(candidate => candidate.id === scope.accountId)
        if (account === undefined) throw new Error(`IM account '${scope.accountId}' disappeared before send`)
        const result = await runtime.transports.require(scope.platform).send({
          account,
          conversationId: scope.conversationId,
          conversationKind: scope.conversationKind,
          ...(directRecipient === undefined ? {} : { directRecipient }),
          requestId,
          text: args.text,
        }, execution.signal)
        const settled = await runtime.settleOutboundAttempt({
          scope,
          requestId,
          attemptId: attempt.attemptId,
          status: result.state === 'sent' ? 'sent' : result.state === 'failed' ? 'confirmed-failed' : 'result-unknown',
          ...(result.state === 'sent' ? { externalMessageId: result.externalMessageId } : {}),
          receipt: {
            ...(result.state === 'sent' && result.rawStatus !== undefined ? { providerStatus: result.rawStatus } : {}),
            ...(result.state === 'failed' ? { errorCode: result.code } : {}),
            observedAt: new Date().toISOString(),
          },
        })
        return { requestId, status: settled.status }
      },
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
