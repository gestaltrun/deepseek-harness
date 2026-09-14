/** Durable two-Session simulation lifecycle and isolated local delivery. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { ImExecutionAggregate } from './delivery-schema.ts'
import type {
  ImAgentTaskId,
  ImDeliveryOperationId,
  ImInboundMessageView,
  ImOutboundView,
  ImOutboundRequestId,
  ImSimulationDeliveryScope,
  ImSimulationInstanceId,
} from './delivery-types.ts'
import { encodeImScopeId } from './delivery.ts'
import { ImRuntimeError } from './errors.ts'
import type { ImAgentCoordinator } from './agent-coordinator.ts'
import type { ImRuntime } from './runtime.ts'
import { registerSimulationTools } from './simulation-tools.ts'
import { registerImAgentTools } from './tools.ts'
import type {
  ImCreateSimulationInstanceRequest,
  ImInjectSimulationManagedHumanRequest,
  ImInjectSimulationMemberRequest,
  ImSimulationInstanceView,
  ImSimulationSessionScope,
} from './types.ts'

const time = (): string => new Date().toISOString()
const instanceId = (): ImSimulationInstanceId => brandString<ImSimulationInstanceId>(`im-simulation:${randomUUID()}`)
const testedSessionId = (): SessionId => SessionId(`im-simulation-tested-${randomUUID()}`)
const deliveryOperationId = (kind: string): ImDeliveryOperationId => brandString<ImDeliveryOperationId>(`im-simulation-${kind}:${randomUUID()}`)

/** Runtime-owned controller; durable state is authoritative and live handles are only execution resources. */
export class ImSimulationController {
  private readonly testedHandles = new Map<ImSimulationInstanceId, AgentHandle>()
  private readonly toolDisposers = new Map<SessionId, () => void>()
  private readonly tails = new Map<ImSimulationInstanceId, Promise<void>>()
  private readonly creations = new Map<ImSimulationInstanceId, Promise<ImSimulationInstanceView>>()
  private readonly stopping = new Map<ImSimulationInstanceId, Promise<ImSimulationInstanceView>>()
  private readonly replyClosures = new Map<ImSimulationInstanceId, AbortController>()
  private creationTail: Promise<void> = Promise.resolve()
  private disposed = false
  private disposeCreated?: () => void
  private disposeDisposed?: () => void

  /** @param ctx - injected Agent, Session, persistence, preset, tool, and Workspace services. @param runtime - IM delivery authority. @param instances - durable instance records. @param tasks - durable tested-Agent binding records. @param coordinator - normal IM admission coordinator. */
  constructor(
    private readonly ctx: Context,
    private readonly runtime: ImRuntime,
    private readonly instances: KvTable<ImSimulationInstanceId, ImSimulationInstanceView>,
    private readonly tasks: KvTable<ImAgentTaskId, ImExecutionAggregate>,
    private readonly coordinator: ImAgentCoordinator,
  ) {}

  /** Recover incomplete lifecycles without resuming ordinary running Sessions. */
  async start(): Promise<void> {
    this.disposeCreated = this.ctx.on('agent/created', ({ agent }) => {
      this.refreshTools(agent)
      const binding = this.runtime.scopeForSession(agent.id)
      if (binding?.role === 'sim-user' && binding.status === 'running') this.queueReplies(binding.instanceId)
    })
    this.disposeDisposed = this.ctx.on('agent/disposed', ({ agent }) => {
      this.toolDisposers.get(agent.id)?.()
      this.toolDisposers.delete(agent.id)
    })
    for (const [, instance] of this.instances.entries()) {
      if (instance.status === 'creating') await this.recoverCreating(instance)
      if (instance.status === 'stopping') this.scheduleStop(instance.instanceId)
    }
    for (const agent of this.ctx.agents.list()) this.refreshTools(agent)
  }

  /** Stop lifecycle work and release only handles and tool registrations owned here. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.disposeCreated?.()
    this.disposeDisposed?.()
    for (const dispose of this.toolDisposers.values()) dispose()
    this.toolDisposers.clear()
    for (const closure of this.replyClosures.values()) closure.abort(new Error('IM simulation controller stopped'))
    await this.creationTail
    await Promise.all(this.tails.values())
    await Promise.all(this.stopping.values())
    await Promise.all([...this.testedHandles.values()].map(handle => handle.dispose()))
    this.testedHandles.clear()
    this.replyClosures.clear()
  }

  /** Re-evaluate tool availability after target or instance state changes. */
  refreshAllTools(): void {
    for (const agent of this.ctx.agents.list()) this.refreshTools(agent)
  }

  /** Create and durably publish one tested Session paired with the live simulated-user Session. */
  create(request: ImCreateSimulationInstanceRequest): Promise<ImSimulationInstanceView> {
    const operation = this.creationTail.then(() => this.createSerialized(request))
    this.creationTail = operation.then(() => {}, () => {})
    return operation
  }

  /** Inject one allow-listed participant through the shared inbound store and coordinator. */
  injectMember(request: ImInjectSimulationMemberRequest): Promise<ImInboundMessageView> {
    return this.enqueue(request.instanceId, async () => {
      const instance = this.requireRunning(request.instanceId)
      const member = instance.speakingMembers.find(candidate => candidate.actorId === request.actorId)
      if (member === undefined) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', `simulation participant '${request.actorId}' is not allow-listed`)
      return this.ingest(instance, {
        externalMessageId: `sim-member:${randomUUID()}`,
        sender: { kind: 'external', senderId: member.actorId, ...(member.displayName === undefined ? {} : { senderDisplayName: member.displayName }) },
        content: { text: request.text, format: 'text' }, occurredAt: time(),
      })
    })
  }

  /** Inject the frozen account owner with provider actor evidence. */
  injectManagedHuman(request: ImInjectSimulationManagedHumanRequest): Promise<ImInboundMessageView> {
    return this.enqueue(request.instanceId, async () => {
      const instance = this.requireRunning(request.instanceId)
      const account = this.runtime.snapshot().accounts.find(candidate => candidate.id === instance.target.accountId)
      if (account === undefined) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'frozen simulation account is unavailable')
      const providerActorId = account.identity.platform === 'dingtalk'
        ? account.identity.userId
        : account.identity.mainServiceAccountId ?? account.identity.merchantId
      const scope = this.scope(instance)
      const requestId = brandString<ImOutboundRequestId>(`im-simulation-human:${randomUUID()}`)
      await this.runtime.registerOutbound({
        requestId, scope, intent: 'human-manual', content: { text: request.text, format: 'text' },
        sender: { kind: 'human-dsh', outboundRequestId: requestId, providerActorId },
      })
      await this.runtime.settleSimulationOutbound({ scope, requestId })
      return this.ingest(instance, {
        externalMessageId: `sim-managed-human:${randomUUID()}`,
        sender: { kind: 'human-dsh', outboundRequestId: requestId, providerActorId },
        content: { text: request.text, format: 'text' }, occurredAt: time(),
      })
    })
  }

  /** Begin a deduplicated terminal stop and return after delivery closes durably. */
  beginStop(instanceIdValue: ImSimulationInstanceId): Promise<ImSimulationInstanceView> {
    const observed = this.instances.get(instanceIdValue)
    if (observed !== undefined && observed.status !== 'stopped' && observed.status !== 'failed') this.closeReplies(instanceIdValue)
    return this.enqueue(instanceIdValue, async () => {
      const current = this.instances.get(instanceIdValue)
      if (current === undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_FOUND', `simulation instance '${instanceIdValue}' is unknown`)
      if (current.status === 'stopped' || current.status === 'failed' || current.status === 'stopping') return current
      const updated = { ...current, status: 'stopping' as const, updatedAt: time() }
      await this.instances.put(instanceIdValue, updated)
      this.runtime.publishSimulationInstanceChange(instanceIdValue)
      this.scheduleStop(instanceIdValue)
      return updated
    })
  }

  /** Await an already-begun stop until its persisted terminal state. */
  async waitStopped(instanceIdValue: ImSimulationInstanceId): Promise<ImSimulationInstanceView> {
    const current = this.instances.get(instanceIdValue)
    if (current === undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_FOUND', `simulation instance '${instanceIdValue}' is unknown`)
    if (current.status === 'stopped' || current.status === 'failed') return current
    if (current.status !== 'stopping') throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_RUNNING', `simulation instance '${instanceIdValue}' has not begun stopping`)
    this.scheduleStop(instanceIdValue)
    const promise = this.stopping.get(instanceIdValue)
    if (promise === undefined) throw new Error(`simulation instance '${instanceIdValue}' has no stop convergence`)
    return promise
  }

  /** Convert one locally settled tested-Agent reply into isolated inbound for its simulated-user Session. */
  deliverTestedReply(scope: ImSimulationDeliveryScope, outbound: ImOutboundView): Promise<void> {
    return this.enqueue(scope.instanceId, async () => {
      const instance = this.instances.get(scope.instanceId)
      if (instance?.status !== 'running') return
      if (encodeImScopeId(this.scope(instance)) !== encodeImScopeId(scope)) {
        throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'simulation reply scope does not match its frozen instance')
      }
      await this.runtime.ingestInboundPage({
        operationId: deliveryOperationId('reply'), scope, observedCursor: null, nextCursor: null,
        messages: [{
          externalMessageId: `sim-ai:${outbound.requestId}`,
          sender: { kind: 'ai', outboundRequestId: outbound.requestId },
          content: outbound.content,
          occurredAt: outbound.updatedAt,
        }],
      })
      this.queueReplies(instance.instanceId)
    })
  }

  private async createSerialized(request: ImCreateSimulationInstanceRequest): Promise<ImSimulationInstanceView> {
    const simUserAgent = this.ctx.agents.get(request.simUserSessionId)
    if (simUserAgent === undefined) throw new ImRuntimeError('IM_SIMULATION_SESSION_INVALID', 'simulation requires the current live simulated-user Agent')
    const simUserWorkspace = this.workspaceForSession(request.simUserSessionId)
    if (simUserWorkspace === undefined) throw new ImRuntimeError('IM_SIMULATION_SESSION_INVALID', 'simulated-user Session is not owned by a Workspace')
    const active = [...this.instances.entries()].map(([, value]) => value)
      .find(value => value.simUserSessionId === request.simUserSessionId && ['creating', 'running', 'stopping'].includes(value.status))
    if (active !== undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_ACTIVE', `simulated-user Session already owns instance '${active.instanceId}'`)
    const targetSetting = this.runtime.simulationTargetForWorkspace(simUserWorkspace.id)
    if (targetSetting === undefined) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'simulated-user Workspace has no configured simulation target')
    const route = this.runtime.routeForSimulationTarget(targetSetting)
    const account = this.runtime.accountForSimulationTarget(targetSetting)
    if (route === undefined || account === undefined) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'configured simulation target no longer resolves to its route and account')
    const targetWorkspace = this.ctx.workspaceRegistry.get(route.workspaceId)
    if (targetWorkspace === undefined) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'configured simulation target Workspace is unavailable')
    const conversationId = route.target.kind === 'specific' ? route.target.conversationId : request.conversationId?.trim()
    if (conversationId === undefined || conversationId === '') throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'an all-conversations route requires a simulation conversationId')
    if (route.target.kind === 'specific' && request.conversationId !== undefined && request.conversationId !== conversationId) {
      throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'simulation conversationId does not match the configured specific route')
    }
    const members = request.speakingMembers === undefined ? [] : [...request.speakingMembers]
    if (members.some(member => member.actorId.trim() === '')) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'simulation participant actorId must not be empty')
    if (new Set(members.map(member => member.actorId)).size !== members.length) throw new ImRuntimeError('IM_SIMULATION_TARGET_INVALID', 'simulation participant actorIds must be unique')
    const id = instanceId()
    const testedId = testedSessionId()
    const createdAt = time()
    const record: ImSimulationInstanceView = {
      instanceId: id, status: 'creating', simUserSessionId: request.simUserSessionId,
      simUserWorkspaceId: simUserWorkspace.id, testedSessionId: testedId,
      target: {
        platform: route.platform, accountId: account.id, routeId: route.id,
        routeRevision: route.revision, accountRevision: account.revision,
        conversationKind: route.conversationKind, conversationId,
        workspaceId: route.workspaceId, agentPreset: this.ctx.agentPresets.defaultId,
        ...(route.groupTrigger === undefined ? {} : { groupTrigger: route.groupTrigger }),
        ...(route.target.kind !== 'specific' || route.target.directRecipient === undefined ? {} : { directRecipient: route.target.directRecipient }),
      },
      speakingMembers: members,
      historyImports: [],
      createdAt, updatedAt: createdAt,
    }
    await this.instances.put(id, record)
    const operation = (async (): Promise<ImSimulationInstanceView> => {
      try {
        const task = this.task(record)
        await this.tasks.put(task.taskId, task)
        const simUserFlushed = await this.ctx.sessions.flush(simUserAgent.session)
        if (!simUserFlushed) throw new Error('simulated-user Session has no persistence writer')
        const handle = await this.createTestedAgent(record, targetWorkspace, task)
        this.testedHandles.set(id, handle)
        await targetWorkspace.attachSession(testedId)
        const testedFlushed = await this.ctx.sessions.flush(handle.agent.session)
        if (!testedFlushed) throw new Error('tested Session has no persistence writer')
        return this.enqueue(id, async () => {
          const current = this.instances.get(id)
          if (current === undefined) throw new Error(`simulation instance '${id}' disappeared during creation`)
          if (current.status !== 'creating') return current
          const running = { ...record, status: 'running' as const, updatedAt: time() }
          await this.instances.put(id, running)
          this.runtime.publishSimulationInstanceChange(id)
          return running
        })
      } catch (error) {
        await this.testedHandles.get(id)?.dispose().catch(() => {})
        this.testedHandles.delete(id)
        await this.enqueue(id, async () => {
          const failed: ImSimulationInstanceView = {
            ...record, status: 'failed', updatedAt: time(),
            failure: { code: 'IM_SIMULATION_CREATE_FAILED', message: 'Simulation instance creation did not complete' },
          }
          await this.instances.put(id, failed)
          this.runtime.publishSimulationInstanceChange(id)
        })
        throw error
      }
    })()
    this.creations.set(id, operation)
    void operation.finally(() => { this.creations.delete(id) }).catch(() => {})
    this.runtime.publishSimulationInstanceChange(id)
    return operation
  }

  private async recoverCreating(instance: ImSimulationInstanceView): Promise<void> {
    try {
      const workspace = this.ctx.workspaceRegistry.get(instance.target.workspaceId)
      if (workspace === undefined || this.ctx.workspaceRegistry.get(instance.simUserWorkspaceId) === undefined) throw new Error('simulation Workspace is unavailable')
      let handle = this.ctx.agents.get(instance.testedSessionId)
      if (await this.ctx.sessionPersistence.stat(instance.testedSessionId) === undefined) {
        const task = this.task(instance)
        if (this.tasks.get(task.taskId) === undefined) await this.tasks.put(task.taskId, task)
        const created = await this.createTestedAgent(instance, workspace, task)
        this.testedHandles.set(instance.instanceId, created)
        handle = created.agent
        const flushed = await this.ctx.sessions.flush(created.agent.session)
        if (!flushed) throw new Error('tested Session has no persistence writer')
      }
      await workspace.attachSession(instance.testedSessionId)
      const running = { ...instance, status: 'running' as const, updatedAt: time() }
      await this.instances.put(instance.instanceId, running)
      this.runtime.publishSimulationInstanceChange(instance.instanceId)
      if (handle !== undefined) this.refreshTools(handle)
    } catch {
      const failed: ImSimulationInstanceView = {
        ...instance, status: 'failed', updatedAt: time(),
        failure: { code: 'IM_SIMULATION_RECOVERY_FAILED', message: 'Simulation instance recovery did not complete' },
      }
      await this.instances.put(instance.instanceId, failed)
      this.runtime.publishSimulationInstanceChange(instance.instanceId)
    }
  }

  private task(instance: ImSimulationInstanceView): ImExecutionAggregate {
    const target = instance.target
    return {
      taskId: brandString<ImAgentTaskId>(`im-simulation-task:${instance.instanceId}`), generation: 1,
      scope: this.scope(instance), scopeId: encodeImScopeId(this.scope(instance)), sessionId: instance.testedSessionId,
      routeId: target.routeId, routeRevision: target.routeRevision, accountRevision: target.accountRevision,
      workspaceId: target.workspaceId, agentPreset: target.agentPreset,
      ...(target.groupTrigger === undefined ? {} : { groupTrigger: target.groupTrigger }),
      ...(target.directRecipient === undefined ? {} : { directRecipient: target.directRecipient }),
      createdAt: instance.createdAt, updatedAt: instance.createdAt,
    }
  }

  private async createTestedAgent(instance: ImSimulationInstanceView, workspace: Workspace, task: ImExecutionAggregate): Promise<AgentHandle> {
    const setup = async (agentCtx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, task.agentPreset)
      registerImAgentTools(agentCtx, this.runtime, task.scope, {
        routeId: task.routeId, routeRevision: task.routeRevision,
        accountRevision: task.accountRevision, workspaceId: task.workspaceId,
      }, task.directRecipient)
    }
    return this.ctx.agents.withoutInitiator(() => this.ctx.agents.create({
      sessionId: instance.testedSessionId,
      meta: { cwd: workspace.path, agentPreset: task.agentPreset },
      agentOptions: this.ctx.agentDefaultModel.currentSelection(), setup,
    }))
  }

  private async ingest(instance: ImSimulationInstanceView, message: Parameters<ImRuntime['ingestInboundPage']>[0]['messages'][number]): Promise<ImInboundMessageView> {
    const result = await this.runtime.ingestInboundPage({
      operationId: deliveryOperationId('input'), scope: this.scope(instance), observedCursor: null, nextCursor: null, messages: [message],
    })
    const accepted = result.messages[0]
    if (accepted === undefined) throw new Error('simulation input produced no durable message')
    return accepted
  }

  private queueReplies(instanceIdValue: ImSimulationInstanceId): void {
    void this.enqueue(instanceIdValue, () => this.driveReplies(instanceIdValue)).catch(() => {
      if (!this.disposed && !this.replyClosures.get(instanceIdValue)?.signal.aborted) {
        this.ctx.logger.warn(`IM simulation reply delivery failed for instance '${instanceIdValue}'`)
      }
    })
  }

  private async driveReplies(instanceIdValue: ImSimulationInstanceId): Promise<void> {
    const instance = this.instances.get(instanceIdValue)
    if (instance?.status !== 'running') return
    const agent = this.ctx.agents.get(instance.simUserSessionId)
    if (agent === undefined) return
    const scope = this.scope(instance)
    const messages = this.runtime.pendingInbound({ scope, limit: this.runtime.config.admissionBatchSize }).filter(message => message.sender.kind === 'ai')
    for (const message of messages) {
      await this.submit(instanceIdValue, agent, this.runtime.sessionUserMessage(scope, message.messageId))
      await this.runtime.markSubmitted({ scope, messageIds: [message.messageId], sessionId: instance.simUserSessionId })
    }
  }

  private async submit(instanceIdValue: ImSimulationInstanceId, agent: Agent, message: ReturnType<ImRuntime['sessionUserMessage']>): Promise<void> {
    const committed = Promise.withResolvers<void>()
    const dispose = agent.ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'user/message' && event.data.id === message.id) committed.resolve()
    })
    const closure = this.replyClosures.get(instanceIdValue) ?? new AbortController()
    this.replyClosures.set(instanceIdValue, closure)
    const aborted = (): void => { committed.reject(closure.signal.reason) }
    closure.signal.addEventListener('abort', aborted, { once: true })
    if (closure.signal.aborted) aborted()
    try {
      closure.signal.throwIfAborted()
      agent.steer(message)
      await committed.promise
      const flushed = await this.ctx.sessions.flush(agent.session)
      if (!flushed) throw new Error(`simulation Session '${agent.session.id}' has no persistence writer`)
    } finally {
      closure.signal.removeEventListener('abort', aborted)
      dispose()
    }
  }

  private scheduleStop(instanceIdValue: ImSimulationInstanceId): void {
    if (this.stopping.has(instanceIdValue)) return
    const promise = new Promise<ImSimulationInstanceView>((resolve, reject) => {
      const timer = setTimeout(() => { void this.convergeStop(instanceIdValue).then(resolve, reject) }, 0)
      if (typeof timer === 'object') timer.unref()
    }).finally(() => { this.stopping.delete(instanceIdValue) })
    this.stopping.set(instanceIdValue, promise)
    void promise.catch(() => {
      if (!this.disposed) this.ctx.logger.warn(`IM simulation stop convergence failed for instance '${instanceIdValue}'`)
    })
  }

  private async convergeStop(instanceIdValue: ImSimulationInstanceId): Promise<ImSimulationInstanceView> {
    await this.creations.get(instanceIdValue)?.catch(() => {})
    const current = this.instances.get(instanceIdValue)
    if (current === undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_FOUND', `simulation instance '${instanceIdValue}' is unknown`)
    if (current.status === 'stopped' || current.status === 'failed') return current
    const scope = this.scope(current)
    const simUser = this.ctx.agents.get(current.simUserSessionId)
    const tested = this.ctx.agents.get(current.testedSessionId)
    simUser?.cancel({ kind: 'user' }, { keepInbox: true })
    tested?.cancel({ kind: 'user' })
    await Promise.all([
      simUser?.whenIdle() ?? Promise.resolve(),
      tested?.whenIdle() ?? Promise.resolve(),
      this.coordinator.stopScope(scope),
    ])
    const owned = this.testedHandles.get(instanceIdValue)
    if (owned !== undefined) {
      await owned.dispose()
      this.testedHandles.delete(instanceIdValue)
    }
    await this.runtime.cancelPendingAi({ scope, reason: 'cancelled' })
    const latest = this.instances.get(instanceIdValue)
    if (latest?.status === 'stopped') return latest
    if (latest === undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_FOUND', `simulation instance '${instanceIdValue}' is unknown`)
    const stoppedAt = time()
    const stopped: ImSimulationInstanceView = { ...latest, status: 'stopped', updatedAt: stoppedAt, stoppedAt }
    await this.instances.put(instanceIdValue, stopped)
    this.runtime.publishSimulationInstanceChange(instanceIdValue)
    this.replyClosures.delete(instanceIdValue)
    return stopped
  }

  private refreshTools(agent: Agent): void {
    this.toolDisposers.get(agent.id)?.()
    this.toolDisposers.delete(agent.id)
    if (this.disposed) return
    const workspace = this.workspaceForSession(agent.id)
    const targetConfigured = workspace === undefined ? false : this.runtime.simulationTargetForWorkspace(workspace.id) !== undefined
    const bound = this.runtime.scopeForSession(agent.id)
    if (!targetConfigured && bound === undefined) return
    this.toolDisposers.set(agent.id, registerSimulationTools(agent.ctx, this.runtime, agent, targetConfigured, bound))
  }

  private workspaceForSession(id: SessionId): Workspace | undefined {
    return this.ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(id))
  }

  private scope(instance: ImSimulationInstanceView): ImSimulationDeliveryScope {
    return {
      kind: 'simulation', instanceId: instance.instanceId,
      platform: instance.target.platform, accountId: instance.target.accountId,
      conversationKind: instance.target.conversationKind, conversationId: instance.target.conversationId,
    }
  }

  private requireRunning(id: ImSimulationInstanceId): ImSimulationInstanceView {
    const instance = this.instances.get(id)
    if (instance === undefined) throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_FOUND', `simulation instance '${id}' is unknown`)
    if (instance.status !== 'running') throw new ImRuntimeError('IM_SIMULATION_INSTANCE_NOT_RUNNING', `simulation instance '${id}' is ${instance.status}`)
    return instance
  }

  private closeReplies(id: ImSimulationInstanceId): void {
    const closure = this.replyClosures.get(id) ?? new AbortController()
    this.replyClosures.set(id, closure)
    closure.abort(new Error(`IM simulation instance '${id}' is stopping`))
  }

  private enqueue<T>(id: ImSimulationInstanceId, job: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(id) ?? Promise.resolve()
    const result = prior.then(job)
    this.tails.set(id, result.then(() => {}, () => {}))
    return result
  }
}
