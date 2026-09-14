/** Durable IM admission coordinator that creates or resumes ordinary Agents. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import type { ImExecutionAggregate, ImPendingAdmission } from './delivery-schema.ts'
import type {
  ImAdmissionId,
  ImAgentTaskId,
  ImAgentAdmissionSource,
  ImDeliveryScope,
  ImInboundMessageView,
  ImMessageId,
  ImMessageSource,
  ImScopeId,
  ImTriggerReason,
} from './delivery-types.ts'
import { encodeImScopeId } from './delivery.ts'
import type { ImRuntime } from './runtime.ts'
import type { ImRouteView } from './types.ts'
import { registerImAgentTools } from './tools.ts'

const MAX_TIMER_DELAY = 2_147_483_647

function timestamp(): string { return new Date().toISOString() }
function assertNever(value: never): never { throw new Error(`unknown IM sender kind: ${String(value)}`) }

function formatInbound(message: ImInboundMessageView): string {
  switch (message.sender.kind) {
    case 'external': return message.sender.senderDisplayName === undefined ? message.content.text : `[${message.sender.senderDisplayName}]: ${message.content.text}`
    case 'human-native': return `[human-native]: ${message.content.text}`
    case 'human-dsh': return `[human-dsh]: ${message.content.text}`
    case 'unknown': return `[unknown-sender]: ${message.content.text}`
    case 'ai': return message.content.text
    default: return assertNever(message.sender)
  }
}

/** Runtime-owned coordinator; one serialized driver and one timer exist per complete scope. */
export class ImAgentCoordinator {
  private readonly tails = new Map<ImScopeId, Promise<void>>()
  private readonly timers = new Map<ImScopeId, ReturnType<typeof setTimeout>>()
  private readonly handles = new Map<ImAgentTaskId, AgentHandle>()
  private readonly closedScopes = new Set<ImScopeId>()
  private readonly scopeClosures = new Map<ImScopeId, AbortController>()
  private readonly shutdown = new AbortController()
  private disposed = false

  /** @param ctx - injected Agent, Workspace, preset, tools, Session, and persistence scope. @param runtime - IM authority. @param tasks - durable task assignments. */
  constructor(
    private readonly ctx: Context,
    private readonly runtime: ImRuntime,
    private readonly tasks: KvTable<ImAgentTaskId, ImExecutionAggregate>,
  ) {}

  /** Recover existing pending conversations and pending Session evidence. */
  start(scopes: readonly ImDeliveryScope[]): void {
    for (const scope of scopes) this.notify(scope)
  }

  /** Queue one post-commit scope observation without inheriting an Agent initiator. */
  notify(scope: ImDeliveryScope): void {
    if (this.disposed) return
    const id = encodeImScopeId(scope)
    if (this.closedScopes.has(id)) return
    const prior = this.tails.get(id) ?? Promise.resolve()
    const next = this.ctx.agents.withoutInitiator(() => prior.then(() => this.drive(scope)))
    this.tails.set(id, next.then(() => {}, () => {}))
    void next.catch(() => {
      if (!this.disposed && !this.closedScopes.has(id)) this.ctx.logger.warn(`IM Agent admission failed for scope '${id}'`)
    })
  }

  /** Close one simulation driver, cancel its Agent, and await only its derived work. */
  async stopScope(scope: ImDeliveryScope): Promise<void> {
    const id = encodeImScopeId(scope)
    this.closedScopes.add(id)
    const closure = this.scopeClosures.get(id) ?? new AbortController()
    this.scopeClosures.set(id, closure)
    closure.abort(new Error(`IM simulation scope '${id}' stopped`))
    this.clearTimer(id)
    const tail = this.tails.get(id)
    const tasks = this.tasksForScope(id)
    for (const task of tasks) this.ctx.agents.get(task.sessionId)?.cancel({ kind: 'user' })
    await Promise.all(tasks.map(task => this.ctx.agents.get(task.sessionId)?.whenIdle() ?? Promise.resolve()))
    if (tail !== undefined) await tail
    for (const task of tasks) {
      const handle = this.handles.get(task.taskId)
      if (handle === undefined) continue
      await handle.dispose()
      this.handles.delete(task.taskId)
    }
  }

  /** Stop timers, drain admission drivers, and dispose every Agent this coordinator owns. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.shutdown.abort(new Error('IM Agent coordinator stopped'))
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
    this.handles.clear()
    await Promise.all(this.tails.values())
  }

  /** Evaluate current durable input and submit one eligible batch. */
  private async drive(scope: ImDeliveryScope): Promise<void> {
    if (this.disposed) return
    if (scope.kind === 'simulation' && !this.runtime.isSimulationScopeRunning(scope)) {
      this.clearTimer(encodeImScopeId(scope))
      return
    }
    const pending = this.pending(scope)
    if (pending.length === 0) { this.clearTimer(encodeImScopeId(scope)); return }
    const scopeId = encodeImScopeId(scope)
    const interrupted = this.tasksForScope(scopeId).find(task => task.pendingAdmission !== undefined)
    if (interrupted !== undefined) {
      await this.reconcileTask(interrupted)
      await this.submitAdmission(interrupted, scope)
      return
    }
    const candidate = this.taskForCurrentBinding(scope, pending)
    if (candidate === undefined) return
    const reasons = this.triggerReasons(candidate, pending)
    if (reasons.length === 0) { this.scheduleInterval(candidate, pending); return }
    this.clearTimer(scopeId)
    const task = await this.persistTask(candidate)
    const admission = await this.freezeAdmission(task, pending, reasons)
    await this.submitAdmission({ ...task, pendingAdmission: admission }, scope)
  }

  /** Continue one frozen admission after checking its Session log for an earlier append. */
  private async submitAdmission(task: ImExecutionAggregate, scope: ImDeliveryScope): Promise<void> {
    const admission = task.pendingAdmission
    if (admission === undefined) throw new Error(`IM task '${task.taskId}' has no pending admission`)
    const pendingIds = new Set(this.pending(scope).map(message => message.messageId))
    const admissionPendingCount = admission.messageIds.filter(id => pendingIds.has(id)).length
    if (admissionPendingCount === 0) {
      await this.clearAdmission(task.taskId, admission.admissionId)
      this.clearTimer(task.scopeId)
      this.notify(scope)
      return
    }
    if (admissionPendingCount !== admission.messageIds.length) {
      throw new Error(`IM admission '${admission.admissionId}' is only partially pending`)
    }
    const messages = admission.messageIds.map(id => this.runtime.getInboundMessage(scope, id))
    const agent = await this.agentFor(task)
    const userMessage = this.admissionMessage(task, admission, messages)
    await this.submit(agent, userMessage, task.scopeId)
    await this.runtime.markSubmitted({ scope, messageIds: admission.messageIds, sessionId: task.sessionId })
    await this.clearAdmission(task.taskId, admission.admissionId)
    this.notify(scope)
  }

  /** Resolve a route generation without storing it before a trigger admits input. */
  private taskForCurrentBinding(scope: ImDeliveryScope, pending: readonly ImInboundMessageView[]): ImExecutionAggregate | undefined {
    const scopeId = encodeImScopeId(scope)
    if (scope.kind === 'simulation') {
      if (!this.runtime.isSimulationScopeRunning(scope)) return undefined
      return this.tasksForScope(scopeId).at(-1)
    }
    const resolved = this.runtime.resolveRoute(scope.accountId, scope.conversationKind, scope.conversationId)
    if (resolved.state !== 'matched') return undefined
    const route = resolved.route
    const workspace = this.ctx.workspaceRegistry.get(route.workspaceId)
    if (workspace === undefined) return undefined
    const account = this.runtime.snapshot().accounts.find(candidate => candidate.id === scope.accountId)
    if (account === undefined) return undefined
    const routeRecipient = route.target.kind === 'specific' ? route.target.directRecipient : undefined
    const latestExternal = scope.conversationKind === 'direct' && routeRecipient === undefined
      ? pending.findLast(message => message.sender.kind === 'external')
      : undefined
    const observedRecipient = latestExternal?.sender.kind === 'external'
      ? {
          providerActorId: latestExternal.sender.senderId,
          ...(latestExternal.sender.userId === undefined ? {} : { userId: latestExternal.sender.userId }),
          ...(latestExternal.sender.openDingTalkId === undefined ? {} : { openDingTalkId: latestExternal.sender.openDingTalkId }),
        }
      : undefined
    const directRecipient = routeRecipient ?? observedRecipient
    const tasks = this.tasksForScope(scopeId)
    const current = tasks.find(task => task.routeId === route.id && task.routeRevision === route.revision
      && task.workspaceId === route.workspaceId && task.accountRevision === account.revision)
    if (current !== undefined) return current
    const createdAt = timestamp()
    return {
      taskId: brandString<ImAgentTaskId>(`im-task:${randomUUID()}`),
      generation: (tasks.at(-1)?.generation ?? 0) + 1,
      scope,
      scopeId,
      sessionId: SessionId(`im-agent:${randomUUID()}`),
      routeId: route.id,
      routeRevision: route.revision,
      accountRevision: account.revision,
      workspaceId: route.workspaceId,
      agentPreset: this.ctx.agentPresets.defaultId,
      ...(route.groupTrigger === undefined ? {} : { groupTrigger: route.groupTrigger }),
      ...(directRecipient === undefined ? {} : { directRecipient }),
      createdAt,
      updatedAt: createdAt,
    }
  }

  /** Persist a newly admitted route generation, or return its existing record. */
  private async persistTask(task: ImExecutionAggregate): Promise<ImExecutionAggregate> {
    const current = this.tasks.get(task.taskId)
    if (current !== undefined) return current
    await this.tasks.put(task.taskId, task)
    return task
  }

  /** Read task generations for one complete conversation identity in generation order. */
  private tasksForScope(scopeId: ImScopeId): ImExecutionAggregate[] {
    return [...this.tasks.entries()]
      .map(([, task]) => task)
      .filter(task => task.scopeId === scopeId)
      .sort((left, right) => left.generation - right.generation)
  }

  /** Read one configured admission batch while excluding AI echoes. */
  private pending(scope: ImDeliveryScope): ImInboundMessageView[] {
    return this.runtime.pendingInbound({ scope, limit: this.runtime.config.admissionBatchSize })
      .filter(message => message.sender.kind !== 'ai')
  }

  /** Reconcile only when the durable Session exists; persistence failures stop this driver. */
  private async reconcileTask(task: ImExecutionAggregate): Promise<void> {
    if (await this.ctx.sessionPersistence.stat(task.sessionId) !== undefined) {
      await this.runtime.reconcileSession(task.sessionId)
    }
  }

  /** Return every true member of the configured OR trigger. */
  private triggerReasons(task: ImExecutionAggregate, messages: readonly ImInboundMessageView[]): ImTriggerReason[] {
    if (task.scope.conversationKind === 'direct') return ['direct']
    const trigger = task.groupTrigger
    if (trigger === undefined) return []
    const reasons: ImTriggerReason[] = []
    if (trigger.mention === true && messages.some(message => message.mentionedConfiguredAccount === true)) reasons.push('mention')
    if (trigger.everyN !== undefined && messages.length >= trigger.everyN) reasons.push('every-n')
    if (trigger.fixedIntervalSeconds !== undefined) {
      const first = messages[0]
      if (first !== undefined && Date.now() >= Date.parse(first.receivedAt) + trigger.fixedIntervalSeconds * 1000) reasons.push('fixed-interval')
    }
    return reasons
  }

  /** Arm the persisted-message deadline; later messages never slide it. */
  private scheduleInterval(task: ImExecutionAggregate, messages: readonly ImInboundMessageView[]): void {
    const seconds = task.groupTrigger?.fixedIntervalSeconds
    const first = messages[0]
    if (seconds === undefined || first === undefined || this.timers.has(task.scopeId)) return
    const delay = Math.max(0, Date.parse(first.receivedAt) + seconds * 1000 - Date.now())
    const timer = setTimeout(() => {
      this.timers.delete(task.scopeId)
      this.notify(task.scope)
    }, Math.min(delay, MAX_TIMER_DELAY))
    this.timers.set(task.scopeId, timer)
  }

  /** Store the exact batch and reasons before Agent lifecycle work starts. */
  private async freezeAdmission(task: ImExecutionAggregate, messages: readonly ImInboundMessageView[], reasons: readonly ImTriggerReason[]): Promise<ImPendingAdmission> {
    const admission: ImPendingAdmission = {
      admissionId: brandString<ImAdmissionId>(`im-admission:${randomUUID()}`),
      messageIds: messages.map(message => message.messageId),
      triggerReasons: [...reasons],
      createdAt: timestamp(),
    }
    await this.tasks.put(task.taskId, { ...task, pendingAdmission: admission, updatedAt: timestamp() })
    return admission
  }

  /** Reuse a live Agent or resume/create its frozen Session and scoped preset. */
  private async agentFor(task: ImExecutionAggregate): Promise<Agent> {
    const live = this.ctx.agents.get(task.sessionId)
    if (live !== undefined) return live
    const workspace = this.ctx.workspaceRegistry.get(task.workspaceId)
    if (workspace === undefined) throw new Error(`IM task workspace '${task.workspaceId}' is unavailable`)
    const setup = async (agentCtx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, task.agentPreset)
      registerImAgentTools(agentCtx, this.runtime, task.scope, {
        routeId: task.routeId,
        routeRevision: task.routeRevision,
        accountRevision: task.accountRevision,
        workspaceId: task.workspaceId,
      }, task.directRecipient)
    }
    const persisted = await this.ctx.sessionPersistence.stat(task.sessionId)
    const agentOptions = this.ctx.agentDefaultModel.currentSelection()
    const handle = persisted === undefined
      ? await this.ctx.agents.create({
          sessionId: task.sessionId,
          meta: { cwd: workspace.path, agentPreset: task.agentPreset },
          agentOptions,
          setup,
        })
      : await this.ctx.agents.resume({ resumeSessionId: task.sessionId, agentOptions, setup })
    this.handles.set(task.taskId, handle)
    await workspace.attachSession(task.sessionId)
    return handle.agent
  }

  /** Build one identified Session message whose source reconstructs the whole batch. */
  private admissionMessage(task: ImExecutionAggregate, admission: ImPendingAdmission, messages: readonly ImInboundMessageView[]) {
    const first = messages[0]
    if (first === undefined) throw new Error(`IM admission '${admission.admissionId}' has no messages`)
    const source: ImMessageSource = {
      kind: 'im',
      scopeId: task.scopeId,
      messageId: first.messageId,
      sequenceNumber: first.sequenceNumber,
      admission: {
        admissionId: admission.admissionId,
        scope: task.scope,
        messageIds: admission.messageIds,
        messages: messages.map(message => ({
          messageId: message.messageId,
          sequenceNumber: message.sequenceNumber,
          externalMessageId: message.externalMessageId,
          sender: message.sender,
          occurredAt: message.occurredAt,
        })),
        triggerReasons: admission.triggerReasons,
        routeId: task.routeId,
        routeRevision: task.routeRevision,
        accountRevision: task.accountRevision,
        workspaceId: task.workspaceId,
      } satisfies ImAgentAdmissionSource,
    }
    return createUserMessage({
      content: [{ type: 'text' as const, text: messages.map(formatInbound).join('\n') }],
      source,
    })
  }

  /** Await the exact Session append and its persistence barrier before returning. */
  private async submit(agent: Agent, message: ReturnType<typeof createUserMessage>, scopeId: ImScopeId): Promise<void> {
    const committed = Promise.withResolvers<void>()
    const dispose = agent.ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'user/message' && event.data.id === message.id) committed.resolve()
    })
    const aborted = (): void => { committed.reject(this.shutdown.signal.reason) }
    const scopeClosure = this.scopeClosures.get(scopeId) ?? new AbortController()
    this.scopeClosures.set(scopeId, scopeClosure)
    const scopeAborted = (): void => { committed.reject(scopeClosure.signal.reason) }
    this.shutdown.signal.addEventListener('abort', aborted, { once: true })
    scopeClosure.signal.addEventListener('abort', scopeAborted, { once: true })
    if (scopeClosure.signal.aborted) scopeAborted()
    try {
      agent.steer(message)
      await committed.promise
      const flushed = await this.ctx.sessions.flush(agent.session)
      if (!flushed) throw new Error(`IM Session '${agent.session.id}' has no persistence writer`)
    } finally {
      this.shutdown.signal.removeEventListener('abort', aborted)
      scopeClosure.signal.removeEventListener('abort', scopeAborted)
      dispose()
    }
  }

  /** Remove only the pending batch whose identity was submitted. */
  private async clearAdmission(taskId: ImAgentTaskId, admissionId: ImAdmissionId): Promise<void> {
    await this.tasks.update(taskId, current => {
      if (current.pendingAdmission?.admissionId !== admissionId) return current
      const { pendingAdmission: _removed, ...rest } = current
      return { ...rest, updatedAt: timestamp() }
    })
  }

  private clearTimer(scopeId: ImScopeId): void {
    const timer = this.timers.get(scopeId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(scopeId)
  }
}
