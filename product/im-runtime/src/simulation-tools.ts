/** Agent-scoped tools for creating, driving, and stopping isolated IM simulations. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImRuntime } from './runtime.ts'
import type { ImSimulationInstanceView, ImSimulationSessionScope } from './types.ts'

/**
 * Register only the simulation operations available to one exact live Agent.
 * @param ctx - Agent context that owns the registrations.
 * @param runtime - Host simulation authority.
 * @param agent - exact Agent whose Session is trusted by every operation.
 * @param targetConfigured - whether this Agent's workspace can create a new instance.
 * @param bound - existing instance role for this Session, when present.
 * @returns disposer for every registered tool.
 */
export function registerSimulationTools(
  ctx: Context,
  runtime: ImRuntime,
  agent: Agent,
  targetConfigured: boolean,
  bound: ImSimulationSessionScope | undefined,
): () => void {
  const disposers: Array<() => void> = []
  if (targetConfigured && (bound === undefined || bound.status === 'stopped' || bound.status === 'failed')) {
    disposers.push(ctx.tools.register(defineTool({
      name: 'im_sim_create',
      description: 'Create an isolated IM simulation against this workspace\'s configured target.',
      parameters: {
        conversationId: { type: 'string' },
        speakingMemberIds: { type: 'array', items: { type: 'string' } },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            instanceId: { type: 'string', required: true },
            testedSessionId: { type: 'string', required: true },
            status: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Created isolated IM simulation ${value.instanceId}; tested Session ${value.testedSessionId}` }],
      },
      execute: async (args, execution) => {
        if (execution.agent !== agent) throw new Error('IM simulation create caller changed')
        const instance = await runtime.createSimulationInstance({
          simUserSessionId: agent.id,
          ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
          ...(args.speakingMemberIds === undefined ? {} : {
            speakingMembers: args.speakingMemberIds.map(actorId => ({ actorId })),
          }),
        })
        return { instanceId: instance.instanceId, testedSessionId: instance.testedSessionId, status: instance.status }
      },
    })))
  }
  if (bound?.status === 'running' && bound.role === 'sim-user') {
    disposers.push(ctx.tools.register(defineTool({
      name: 'im_sim_send_as_member',
      description: 'Send as an allow-listed simulated participant through this instance only.',
      parameters: { actorId: { type: 'string', required: true }, text: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { messageId: { type: 'string', required: true }, status: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `Simulation message ${value.messageId} was delivered only to the tested Agent` }],
      },
      execute: async (args, execution) => {
        if (execution.agent !== agent) throw new Error('IM simulation member caller changed')
        const message = await runtime.injectSimulationMember({ instanceId: bound.instanceId, actorId: args.actorId, text: args.text })
        return { messageId: message.messageId, status: message.stage }
      },
    })))
    disposers.push(ctx.tools.register(defineTool({
      name: 'im_sim_send_as_managed_human',
      description: 'Send as the configured account owner through this instance only.',
      parameters: { text: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { messageId: { type: 'string', required: true }, status: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `Managed-human simulation message ${value.messageId} was delivered only to the tested Agent` }],
      },
      execute: async (args, execution) => {
        if (execution.agent !== agent) throw new Error('IM simulation managed-human caller changed')
        const message = await runtime.injectSimulationManagedHuman({ instanceId: bound.instanceId, text: args.text })
        return { messageId: message.messageId, status: message.stage }
      },
    })))
  }
  if (bound?.role === 'sim-user' && (bound.status === 'running' || bound.status === 'stopping')) {
    disposers.push(ctx.tools.register(defineTool({
      name: 'im_sim_stop',
      description: 'Begin the terminal stop of this exact simulation instance without waiting for this turn.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { instanceId: { type: 'string', required: true }, status: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `Simulation ${value.instanceId} is ${value.status}` }],
      },
      execute: async (_args, execution): Promise<Pick<ImSimulationInstanceView, 'instanceId' | 'status'>> => {
        if (execution.agent !== agent) throw new Error('IM simulation stop caller changed')
        const instance = await runtime.beginStopSimulationForSession(agent.id)
        return { instanceId: instance.instanceId, status: instance.status }
      },
    })))
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
