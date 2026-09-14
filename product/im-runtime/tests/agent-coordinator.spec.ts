import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImRuntime, {
  type ImAccountId,
  type ImDeliveryOperationId,
  type ImDeliveryScope,
  type ImOperationId,
  type ImOutboundRequestId,
  type ImRouteView,
  type ImTransport,
  type ImTransportSendRequest,
  type ImTransportSink,
} from '../src/index.ts'

// Focused source tests replace only the unpublished native flock binary; JSONL Session reads and writes remain real.
vi.mock('@deepseek-ai/node-addon-system/flock', () => ({ tryLockExclusive: async () => {} }))

const contexts: Context[] = []
const directories: string[] = []
const holds: Array<ReturnType<typeof Promise.withResolvers<void>>> = []

afterEach(async () => {
  for (const hold of holds.splice(0)) hold.resolve()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function operation(value: string): ImOperationId { return brandString<ImOperationId>(value) }
function deliveryOperation(value: string): ImDeliveryOperationId { return brandString<ImDeliveryOperationId>(value) }

function response(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly signals: AbortSignal[] = []

  constructor(private readonly script: Array<'complete' | 'hold'>) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.signal !== undefined) this.signals.push(options.signal)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('IM recording adapter script exhausted')
    if (entry === 'hold') {
      const hold = Promise.withResolvers<void>()
      holds.push(hold)
      await hold.promise
    }
    yield* response('handled')
  }
}

function fixtureTransport(capture: (sink: ImTransportSink) => void, captureSend: (request: ImTransportSendRequest) => void): ImTransport {
  return {
    platform: 'wangwang',
    listAccountCandidates: async () => [{ platform: 'wangwang', candidateId: 'merchant-1', endpoint: 'https://wangwang.invalid', displayName: 'Merchant', merchantId: 'merchant-1' }],
    prepareAccount: async request => {
      if (request.platform !== 'wangwang') throw new Error('wrong fixture platform')
      return {
        displayName: 'Merchant',
        identity: { platform: 'wangwang', merchantId: request.candidateId, displayName: 'Merchant' },
        authorization: { state: 'unchecked' },
      }
    },
    inspectAccount: async () => ({ authorization: { state: 'unchecked' } }),
    refreshAccount: async () => ({ authorization: { state: 'unchecked' } }),
    discoverConversations: async () => ({ items: [] }),
    listen: async (_account, _plan, sink) => {
      capture(sink)
      const done = Promise.withResolvers<void>()
      return { done: done.promise, dispose: async () => { done.resolve() } }
    },
    send: async request => { captureSend(request); return { state: 'unknown' } },
    confirm: async () => ({ state: 'unknown' }),
  }
}

interface Bench {
  readonly ctx: Context
  readonly root: string
  sink(): ImTransportSink | undefined
  sent(): readonly ImTransportSendRequest[]
}

async function createSimUser(bench: Bench, workspacePath: string, id: string): Promise<{ handle: AgentHandle; workspace: Workspace }> {
  await mkdir(workspacePath, { recursive: true })
  const workspace = await bench.ctx.workspaceRegistry.create(workspacePath)
  const handle = await bench.ctx.agents.create({
    sessionId: SessionId(id), meta: { cwd: workspacePath, agentPreset: 'im-test' },
    agentOptions: bench.ctx.agentDefaultModel.currentSelection(),
    setup: async (agentCtx) => { await bench.ctx.agentPresets.mount(agentCtx, 'im-test') },
  })
  expect(await bench.ctx.sessions.flush(handle.agent.session)).toBe(true)
  await workspace.attachSession(handle.agent.id)
  return { handle, workspace }
}

async function mountAgentServices(ctx: Context, root: string, adapter: RecordingAdapter): Promise<void> {
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fixture'], adapter)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'im-test',
    roots: [{ path: join(root, 'presets'), trust: 'system' }],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'fixture' })
}

async function boot(
  adapter: RecordingAdapter,
  directory?: string,
  beforeAgentServices?: (ctx: Context) => void,
): Promise<Bench> {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'dsh-im-agent-'))
  if (!directories.includes(root)) directories.push(root)
  const preset = join(root, 'presets', 'im-test')
  await mkdir(preset, { recursive: true })
  await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(WorkspaceRegistry)
  if (beforeAgentServices !== undefined) {
    await ctx.plugin(ImRuntime)
    beforeAgentServices(ctx)
    await mountAgentServices(ctx, root, adapter)
  } else {
    await mountAgentServices(ctx, root, adapter)
    await ctx.plugin(ImRuntime)
  }
  let sink: ImTransportSink | undefined
  const sent: ImTransportSendRequest[] = []
  function fixtureProvider(providerCtx: Context): void { providerCtx.imTransports.register(fixtureTransport(value => { sink = value }, request => { sent.push(request) })) }
  fixtureProvider.inject = ['imTransports']
  await ctx.plugin(fixtureProvider)
  return { ctx, root, sink: () => sink, sent: () => sent }
}

async function configure(bench: Bench, workspacePath: string): Promise<{ accountId: ImAccountId; route: ImRouteView; scope: ImDeliveryScope }> {
  await mkdir(workspacePath, { recursive: true })
  const workspace = await bench.ctx.workspaceRegistry.create(workspacePath)
  const account = await bench.ctx.imRuntime.addAccount({ platform: 'wangwang', candidateId: 'merchant-1', endpoint: 'https://wangwang.invalid', accessKeyId: 'fixture-key', accessKeySecret: 'fixture-secret' })
  const result = await bench.ctx.imRuntime.createRoute({
    operationId: operation('route'), accountId: account.id, conversationKind: 'direct',
    target: { kind: 'specific', conversationId: 'buyer-1' }, workspaceId: workspace.id, enabled: true,
  })
  const route = result.route
  if (route === undefined) throw new Error('fixture route was not created')
  await expect.poll(bench.sink).toBeDefined()
  return {
    accountId: account.id,
    route,
    scope: { kind: 'real', platform: 'wangwang', accountId: account.id, conversationKind: 'direct', conversationId: 'buyer-1' },
  }
}

async function receive(bench: Bench, accountId: ImAccountId, suffix: string, text = suffix): Promise<void> {
  const sink = bench.sink()
  if (sink === undefined) throw new Error('fixture listener is not ready')
  const owner = { platform: 'wangwang' as const, accountId, streamId: 'merchant-inbox' }
  await sink.receivePage({
    operationId: deliveryOperation(`provider-${suffix}`),
    owner,
    observedCursor: bench.ctx.imRuntime.getProviderCursor(owner).cursor,
    nextCursor: `cursor-${suffix}`,
    conversations: [{
      operationId: deliveryOperation(`conversation-${suffix}`),
      conversationKind: 'direct',
      conversationId: 'buyer-1',
      messages: [{
        externalMessageId: `external-${suffix}`,
        senderEvidence: { kind: 'external-actor', senderId: 'buyer-1', senderDisplayName: 'Buyer', openDingTalkId: `open-${suffix}` },
        content: { text, format: 'text' },
        occurredAt: '2026-09-14T01:00:00.000Z',
      }],
    }],
  })
}

async function receiveGroup(
  bench: Bench,
  accountId: ImAccountId,
  suffix: string,
  messages: ReadonlyArray<{ readonly externalMessageId: string; readonly mentionedConfiguredAccount?: boolean }>,
): Promise<void> {
  const sink = bench.sink()
  if (sink === undefined) throw new Error('fixture listener is not ready')
  const owner = { platform: 'wangwang' as const, accountId, streamId: 'merchant-inbox' }
  await sink.receivePage({
    operationId: deliveryOperation(`provider-${suffix}`),
    owner,
    observedCursor: bench.ctx.imRuntime.getProviderCursor(owner).cursor,
    nextCursor: `cursor-${suffix}`,
    conversations: [{
      operationId: deliveryOperation(`conversation-${suffix}`),
      conversationKind: 'group',
      conversationId: 'group-1',
      presentation: { displayName: 'Support group', memberCount: 12 },
      messages: messages.map(message => ({
        externalMessageId: message.externalMessageId,
        senderEvidence: { kind: 'external-actor', senderId: 'buyer-1', senderDisplayName: 'Buyer' },
        content: { text: message.externalMessageId, format: 'text' },
        occurredAt: '2026-09-14T01:00:00.000Z',
        ...(message.mentionedConfiguredAccount === undefined ? {} : { mentionedConfiguredAccount: message.mentionedConfiguredAccount }),
      })),
    }],
  })
}

describe('IM Agent coordinator', () => {
  it('automatically admits a durable provider message through a real Agent and scoped tools', async () => {
    const adapter = new RecordingAdapter(['complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'workspace-a'))

    await receive(bench, configured.accountId, 'first', 'hello from IM')
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const task = bench.ctx.imRuntime.getAgentTask(configured.scope)
    expect(task).toMatchObject({ generation: 1, routeId: configured.route.id, workspaceId: configured.route.workspaceId })
    if (task === undefined) throw new Error('IM task was not created')
    const agent = bench.ctx.agents.get(task.sessionId)
    if (agent === undefined) throw new Error('IM Agent was not published')
    await agent.whenIdle()

    const message = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(message?.type === 'user/message' ? message.data.source : undefined).toMatchObject({
      kind: 'im',
      admission: {
        scope: configured.scope,
        messageIds: [expect.any(String)],
        triggerReasons: ['direct'],
        routeId: configured.route.id,
        workspaceId: configured.route.workspaceId,
        messages: [{ externalMessageId: 'external-first', sender: { kind: 'external', senderId: 'buyer-1' } }],
      },
    })
    expect(agent.session.header.cwd).toBe(bench.ctx.workspaceRegistry.get(configured.route.workspaceId)?.path)
    expect(bench.ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(expect.arrayContaining(['im_query_history', 'im_send_message']))
    expect(adapter.requests).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('hello from IM')
    await bench.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('current-task-send'),
      name: 'im_send_message',
      arguments: { text: 'current-task-reply' },
      agent,
    })
    expect(bench.sent()).toMatchObject([{
      conversationId: 'buyer-1',
      directRecipient: { providerActorId: 'buyer-1', openDingTalkId: 'open-first' },
    }])
  })

  it('projects quote, image, and unsupported presentation through the logged Agent input', async () => {
    const adapter = new RecordingAdapter(['complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'presentation-workspace'))
    const sink = bench.sink()
    if (sink === undefined) throw new Error('fixture listener is not ready')
    await sink.receivePage({
      operationId: deliveryOperation('provider-presentation'),
      owner: { platform: 'wangwang', accountId: configured.accountId, streamId: 'merchant-inbox' },
      observedCursor: null, nextCursor: 'presentation-cursor',
      conversations: [{
        operationId: deliveryOperation('conversation-presentation'), conversationKind: 'direct', conversationId: 'buyer-1',
        messages: [
          {
            externalMessageId: 'quote', senderEvidence: { kind: 'external-actor', senderId: 'buyer-1' },
            content: { text: 'current', format: 'text', quote: { text: 'earlier', senderDisplayName: 'Buyer' } },
            occurredAt: '2026-09-14T01:00:00.000Z',
          },
          {
            externalMessageId: 'image', senderEvidence: { kind: 'external-actor', senderId: 'buyer-1' },
            content: { text: '', format: 'image' }, occurredAt: '2026-09-14T01:01:00.000Z',
          },
          {
            externalMessageId: 'voice', senderEvidence: { kind: 'provider-unknown' },
            content: { text: '', format: 'unsupported', messageType: 'voice-note', details: { durationMs: 1200 } },
            occurredAt: '2026-09-14T01:02:00.000Z',
          },
        ],
      }],
    })
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const modelInput = JSON.stringify(adapter.requests[0]?.messages)
    expect(modelInput).toContain('[quoted from Buyer: earlier]\\ncurrent')
    expect(modelInput).toContain('[image]')
    expect(modelInput).toContain('[unsupported message type: voice-note]')
  })

  it('binds paused-account manual sends to one durable real Session and requires explicit retry', async () => {
    const adapter = new RecordingAdapter(['complete', 'complete'])
    const first = await boot(adapter)
    const configured = await configure(first, join(first.root, 'manual-workspace-a'))
    await receive(first, configured.accountId, 'manual-first')
    await expect.poll(() => first.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const firstTask = first.ctx.imRuntime.getAgentTask(configured.scope)
    if (firstTask === undefined) throw new Error('first real IM task missing')

    const secondWorkspacePath = join(first.root, 'manual-workspace-b')
    await mkdir(secondWorkspacePath)
    const secondWorkspace = await first.ctx.workspaceRegistry.create(secondWorkspacePath)
    const rebound = await first.ctx.imRuntime.rebindRoute({
      operationId: operation('manual-rebind'), accountId: configured.accountId, routeId: configured.route.id,
      observedRevision: configured.route.revision, observedWorkspaceId: configured.route.workspaceId,
      workspaceId: secondWorkspace.id,
    })
    if (rebound.route === undefined) throw new Error('rebound route missing')
    await first.ctx.imRuntime.ingestInboundPage({
      operationId: deliveryOperation('manual-second-generation'), scope: configured.scope,
      observedCursor: first.ctx.imRuntime.getConversationCursor(configured.scope).platformCursor,
      nextCursor: first.ctx.imRuntime.getConversationCursor(configured.scope).platformCursor,
      messages: [{
        externalMessageId: 'manual-second-generation', sender: { kind: 'external', senderId: 'buyer-1' },
        content: { text: 'new generation', format: 'text' }, occurredAt: '2026-09-14T02:00:00.000Z',
      }],
    })
    await expect.poll(() => first.ctx.imRuntime.getAgentTask(configured.scope)?.generation).toBe(2)
    await expect.poll(() => first.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const secondTask = first.ctx.imRuntime.getAgentTask(configured.scope)
    if (secondTask === undefined) throw new Error('second real IM task missing')
    const firstBinding = first.ctx.imRuntime.realScopeForSession(firstTask.sessionId)
    if (firstBinding === undefined) throw new Error('first real Session binding missing')
    expect(firstBinding).toMatchObject({ workspaceId: configured.route.workspaceId, routeRevision: configured.route.revision })
    expect(first.ctx.imRuntime.realScopeForSession(secondTask.sessionId)).toMatchObject({
      workspaceId: secondWorkspace.id, routeRevision: rebound.route.revision,
    })
    expect(first.ctx.imRuntime.realScopeForSession(SessionId('not-an-im-session'))).toBeUndefined()

    const account = first.ctx.imRuntime.snapshot().accounts.find(value => value.id === configured.accountId)
    if (account === undefined) throw new Error('manual account missing')
    await first.ctx.imRuntime.setAccountPaused({
      operationId: operation('manual-pause'), accountId: account.id, observedRevision: account.revision, paused: true,
    })
    const transport = first.ctx.imRuntime.transports.require('wangwang')
    const send = vi.fn()
      .mockResolvedValueOnce({ state: 'unknown', externalMessageId: 'provider-maybe' })
      .mockResolvedValueOnce({ state: 'unknown', externalMessageId: 'provider-confirming' })
      .mockResolvedValueOnce({ state: 'sent', externalMessageId: 'provider-retry', rawStatus: 'delivered' })
    const confirm = vi.fn()
      .mockResolvedValueOnce({ state: 'unknown', externalMessageId: 'provider-maybe' })
      .mockResolvedValueOnce({ state: 'sent', externalMessageId: 'provider-confirmed', rawStatus: 'delivered' })
    transport.send = send
    transport.confirm = confirm
    const requestId = brandString<ImOutboundRequestId>('manual-request')
    const uncertain = await first.ctx.imRuntime.sendManualMessage({
      sessionId: firstTask.sessionId, requestId, text: 'send while AI is paused',
    })
    expect(uncertain).toMatchObject({
      binding: {
        sessionId: firstTask.sessionId, workspaceId: configured.route.workspaceId,
        accountState: { paused: true, manualSend: { state: 'available' }, listener: { state: 'stopped', reason: 'account-paused' } },
        sync: { lastSyncedAt: expect.any(String) },
      },
      sender: { kind: 'human-dsh', outboundRequestId: requestId, providerActorId: 'merchant-1' },
      outbound: { status: 'result-unknown', manualBinding: { sessionId: firstTask.sessionId, taskId: firstTask.taskId } },
    })
    await expect(first.ctx.imRuntime.sendManualMessage({ sessionId: firstTask.sessionId, requestId, text: 'send while AI is paused' }))
      .resolves.toEqual(uncertain)
    expect(send).toHaveBeenCalledTimes(1)
    expect(first.ctx.imRuntime.queryManualMessage({ sessionId: firstTask.sessionId, requestId })).toMatchObject({
      state: 'known', result: { outbound: { status: 'result-unknown' } },
    })
    expect(confirm).not.toHaveBeenCalled()
    await expect(first.ctx.imRuntime.confirmManualMessage({ sessionId: firstTask.sessionId, requestId }))
      .resolves.toMatchObject({ outbound: { status: 'result-unknown' } })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(() => first.ctx.imRuntime.queryManualMessage({ sessionId: secondTask.sessionId, requestId }))
      .toThrowError(expect.objectContaining({ code: 'IM_MANUAL_MESSAGE_INVALID' }))

    const confirmedRequestId = brandString<ImOutboundRequestId>('manual-confirmed')
    await expect(first.ctx.imRuntime.sendManualMessage({
      sessionId: firstTask.sessionId, requestId: confirmedRequestId, text: 'confirm this delivery',
    })).resolves.toMatchObject({ outbound: { status: 'result-unknown', externalMessageId: 'provider-confirming' } })
    const confirmed = await first.ctx.imRuntime.confirmManualMessage({ sessionId: firstTask.sessionId, requestId: confirmedRequestId })
    expect(confirmed).toMatchObject({ outbound: { status: 'sent', externalMessageId: 'provider-confirmed' } })
    await expect(first.ctx.imRuntime.confirmManualMessage({ sessionId: firstTask.sessionId, requestId: confirmedRequestId }))
      .resolves.toEqual(confirmed)
    expect(send).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(first.ctx.imRuntime.classifyInboundSender(configured.scope, { kind: 'configured-echo', externalMessageId: 'provider-confirmed' }))
      .toEqual({ kind: 'human-dsh', outboundRequestId: confirmedRequestId, providerActorId: 'merchant-1' })

    await expect(first.ctx.imRuntime.retryManualMessage({
      sessionId: secondTask.sessionId,
      requestId: brandString<ImOutboundRequestId>('wrong-session-retry'), retryOfRequestId: requestId,
    })).rejects.toMatchObject({ code: 'IM_MANUAL_RETRY_INVALID' })
    const aiRequestId = brandString<ImOutboundRequestId>('manual-nonhuman-prior')
    await first.ctx.imRuntime.registerOutbound({
      requestId: aiRequestId, scope: configured.scope, intent: 'ai', content: { text: 'AI', format: 'text' },
    })
    expect(first.ctx.imRuntime.getOutbound({ scope: configured.scope, requestId: aiRequestId }))
      .toMatchObject({ status: 'pre-send-failed', preSendFailureReason: 'account-paused' })
    await expect(first.ctx.imRuntime.retryManualMessage({
      sessionId: firstTask.sessionId,
      requestId: brandString<ImOutboundRequestId>('nonhuman-retry'), retryOfRequestId: aiRequestId,
    })).rejects.toMatchObject({ code: 'IM_MANUAL_RETRY_INVALID' })

    const retryId = brandString<ImOutboundRequestId>('manual-explicit-retry')
    const retried = await first.ctx.imRuntime.retryManualMessage({
      sessionId: firstTask.sessionId, requestId: retryId, retryOfRequestId: requestId,
    })
    expect(retried).toMatchObject({
      sender: { kind: 'human-dsh', outboundRequestId: retryId, providerActorId: 'merchant-1' },
      outbound: { status: 'sent', retryOfRequestId: requestId, manualBinding: { sessionId: firstTask.sessionId } },
    })
    expect(send).toHaveBeenCalledTimes(3)
    await expect(first.ctx.imRuntime.retryManualMessage({
      sessionId: firstTask.sessionId, requestId: retryId, retryOfRequestId: requestId,
    })).resolves.toEqual(retried)
    await expect(first.ctx.imRuntime.confirmManualMessage({ sessionId: firstTask.sessionId, requestId: retryId }))
      .resolves.toEqual(retried)
    expect(send).toHaveBeenCalledTimes(3)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(first.ctx.imRuntime.classifyInboundSender(configured.scope, { kind: 'configured-echo', externalMessageId: 'provider-retry' }))
      .toEqual({ kind: 'human-dsh', outboundRequestId: retryId, providerActorId: 'merchant-1' })

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const second = await boot(new RecordingAdapter([]), first.root)
    expect(second.ctx.imRuntime.realScopeForSession(firstTask.sessionId)).toMatchObject({
      scope: firstBinding.scope, taskId: firstBinding.taskId, workspaceId: firstBinding.workspaceId,
      destination: firstBinding.destination, sync: firstBinding.sync,
      accountState: { paused: true, manualSend: { state: 'available' }, listener: { state: 'stopped', reason: 'account-paused' } },
    })
    expect(second.ctx.imRuntime.queryManualMessage({ sessionId: firstTask.sessionId, requestId: retryId }))
      .toMatchObject({ state: 'known', result: { outbound: { status: 'sent', retryOfRequestId: requestId } } })
    const pendingRequestId = brandString<ImOutboundRequestId>('manual-pending-before-rpc-response')
    await second.ctx.imRuntime.registerOutbound({
      scope: firstBinding.scope, requestId: pendingRequestId, intent: 'human-manual',
      content: { text: 'resume the durable pending request', format: 'text' },
      sender: { kind: 'human-dsh', outboundRequestId: pendingRequestId, providerActorId: 'merchant-1' },
      manualBinding: { sessionId: firstTask.sessionId, taskId: firstTask.taskId },
    })
    await expect(second.ctx.imRuntime.sendManualMessage({
      sessionId: firstTask.sessionId, requestId: pendingRequestId, text: 'resume the durable pending request',
    })).resolves.toMatchObject({ outbound: { status: 'result-unknown' } })
    expect(second.sent()).toHaveLength(1)
    const restartedAccount = second.ctx.imRuntime.snapshot().accounts.find(value => value.id === configured.accountId)
    if (restartedAccount === undefined) throw new Error('restarted manual account missing')
    const disconnected = await second.ctx.imRuntime.disconnectAccount({
      operationId: operation('manual-disconnect'), accountId: restartedAccount.id, observedRevision: restartedAccount.revision,
    })
    expect(second.ctx.imRuntime.realScopeForSession(firstTask.sessionId)).toMatchObject({
      accountState: { connectionIntent: 'disconnected', manualSend: { state: 'unavailable', reason: 'disconnected' } },
    })
    await expect(second.ctx.imRuntime.sendManualMessage({
      sessionId: firstTask.sessionId,
      requestId: brandString<ImOutboundRequestId>('manual-while-disconnected'),
      text: 'must not leave the Host',
    })).rejects.toMatchObject({ code: 'IM_MANUAL_ACCOUNT_UNAVAILABLE' })
    expect(second.sent()).toHaveLength(1)
    const reconnected = await second.ctx.imRuntime.reconnectAccount({
      operationId: operation('manual-reconnect'), accountId: disconnected.account.id, observedRevision: disconnected.account.revision,
    })
    second.ctx.imRuntime.transports.require('wangwang').refreshAccount = async () => ({
      authorization: { state: 'required', reason: 'revoked' },
    })
    await second.ctx.imRuntime.refreshAccount({
      operationId: operation('manual-revoked'), accountId: reconnected.account.id, observedRevision: reconnected.account.revision,
    })
    expect(second.ctx.imRuntime.realScopeForSession(firstTask.sessionId)).toMatchObject({
      accountState: { manualSend: { state: 'unavailable', reason: 'authorization-required' } },
    })
    await expect(second.ctx.imRuntime.sendManualMessage({
      sessionId: firstTask.sessionId,
      requestId: brandString<ImOutboundRequestId>('manual-with-revoked-auth'),
      text: 'must not leave the Host either',
    })).rejects.toMatchObject({ code: 'IM_MANUAL_ACCOUNT_UNAVAILABLE' })
    expect(second.sent()).toHaveLength(1)
  })

  it('keeps an in-flight task on its workspace and admits a post-rebind message into a new generation', async () => {
    const adapter = new RecordingAdapter(['hold', 'complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'workspace-a'))
    await receive(bench, configured.accountId, 'before-rebind')
    await expect.poll(() => adapter.requests.length).toBe(1)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const first = bench.ctx.imRuntime.getAgentTask(configured.scope)
    if (first === undefined) throw new Error('first IM task was not created')

    const secondWorkspacePath = join(bench.root, 'workspace-b')
    await mkdir(secondWorkspacePath)
    const secondWorkspace = await bench.ctx.workspaceRegistry.create(secondWorkspacePath)
    const rebound = await bench.ctx.imRuntime.rebindRoute({
      operationId: operation('rebind'), accountId: configured.accountId, routeId: configured.route.id,
      observedRevision: configured.route.revision, observedWorkspaceId: configured.route.workspaceId,
      workspaceId: secondWorkspace.id,
    })
    expect(rebound.status).toBe('applied')
    await receive(bench, configured.accountId, 'after-rebind')
    await expect.poll(() => adapter.requests.length).toBe(2)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    const second = bench.ctx.imRuntime.getAgentTask(configured.scope)
    expect(second).toMatchObject({ generation: 2, workspaceId: secondWorkspace.id })
    expect(second?.sessionId).not.toBe(first.sessionId)
    expect(bench.ctx.agents.get(first.sessionId)?.session.header.cwd).toBe(bench.ctx.workspaceRegistry.get(configured.route.workspaceId)?.path)
    expect(second === undefined ? undefined : bench.ctx.agents.get(second.sessionId)?.session.header.cwd).toBe(secondWorkspace.path)
    expect(adapter.signals[0]?.aborted).toBe(false)

    const firstAgent = bench.ctx.agents.get(first.sessionId)
    if (firstAgent === undefined) throw new Error('first IM Agent disappeared during rebind')
    await bench.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('old-task-send'),
      name: 'im_send_message',
      arguments: { text: 'old-task-reply' },
      agent: firstAgent,
    })
    expect(bench.ctx.imRuntime.queryOutbound({ scope: configured.scope, limit: 10 }).items.find(item => item.content.text === 'old-task-reply'))
      .toMatchObject({
        status: 'pre-send-failed',
        preSendFailureReason: 'route-changed',
        routeBinding: { routeId: configured.route.id, routeRevision: configured.route.revision, workspaceId: configured.route.workspaceId },
      })
    expect(bench.sent()).toEqual([])
  })

  it('steers new input into the same busy Agent without aborting its active model step', async () => {
    const adapter = new RecordingAdapter(['hold', 'complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'workspace-a'))
    await receive(bench, configured.accountId, 'first-steer')
    await expect.poll(() => adapter.requests.length).toBe(1)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)

    await receive(bench, configured.accountId, 'second-steer')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.signals[0]?.aborted).toBe(false)
    holds.shift()?.resolve()
    await expect.poll(() => adapter.requests.length).toBe(2)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    expect(bench.ctx.imRuntime.getAgentTask(configured.scope)?.generation).toBe(1)
  })

  it('combines group triggers once, upgrades late mention evidence, and fires a timer without another message', async () => {
    const adapter = new RecordingAdapter(['complete', 'complete', 'complete'])
    const bench = await boot(adapter)
    const workspacePath = join(bench.root, 'workspace-group')
    await mkdir(workspacePath)
    const workspace = await bench.ctx.workspaceRegistry.create(workspacePath)
    const account = await bench.ctx.imRuntime.addAccount({ platform: 'wangwang', candidateId: 'merchant-1', endpoint: 'https://wangwang.invalid', accessKeyId: 'fixture-key', accessKeySecret: 'fixture-secret' })
    const route = (await bench.ctx.imRuntime.createRoute({
      operationId: operation('group-route'), accountId: account.id, conversationKind: 'group',
      target: { kind: 'specific', conversationId: 'group-1' }, workspaceId: workspace.id, enabled: true,
      groupTrigger: { mention: true, everyN: 2, fixedIntervalSeconds: 1 },
    })).route
    if (route === undefined) throw new Error('group route was not created')
    await expect.poll(bench.sink).toBeDefined()
    const scope: ImDeliveryScope = { kind: 'real', platform: 'wangwang', accountId: account.id, conversationKind: 'group', conversationId: 'group-1' }

    await receiveGroup(bench, account.id, 'group-pair', [
      { externalMessageId: 'group-message-1' },
      { externalMessageId: 'group-message-2', mentionedConfiguredAccount: true },
    ])
    await expect.poll(() => adapter.requests.length).toBe(1)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    const firstTask = bench.ctx.imRuntime.getAgentTask(scope)
    if (firstTask === undefined) throw new Error('group Agent task was not created')
    expect(bench.ctx.imRuntime.realScopeForSession(firstTask.sessionId)).toMatchObject({
      destination: { conversationKind: 'group', conversationId: 'group-1', displayName: 'Support group', memberCount: 12 },
      accountState: { manualSend: { state: 'available' }, connectionIntent: 'connected', listener: { state: 'running' } },
      sync: { lastSyncedAt: expect.any(String), platformCursor: null },
    })
    const firstAgent = bench.ctx.agents.get(firstTask.sessionId)
    const firstSource = firstAgent?.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(firstSource?.type === 'user/message' ? firstSource.data.source : undefined)
      .toMatchObject({ admission: { triggerReasons: ['mention', 'every-n'] } })

    await receiveGroup(bench, account.id, 'group-late-all', [{ externalMessageId: 'late-mention' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(adapter.requests).toHaveLength(1)
    await receiveGroup(bench, account.id, 'group-late-at', [{ externalMessageId: 'late-mention', mentionedConfiguredAccount: true }])
    await expect.poll(() => adapter.requests.length).toBe(2)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    const sources = firstAgent?.session.snapshotEvents().filter(event => event.type === 'user/message') ?? []
    expect(sources.at(-1)?.type === 'user/message' ? sources.at(-1)?.data.source : undefined)
      .toMatchObject({ admission: { triggerReasons: ['mention'] } })

    await receiveGroup(bench, account.id, 'group-timer', [{ externalMessageId: 'timer-only' }])
    await expect.poll(() => adapter.requests.length, { timeout: 3000 }).toBe(3)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    const finalSources = firstAgent?.session.snapshotEvents().filter(event => event.type === 'user/message') ?? []
    expect(finalSources.at(-1)?.type === 'user/message' ? finalSources.at(-1)?.data.source : undefined)
      .toMatchObject({ admission: { triggerReasons: ['fixed-interval'] } })
    await bench.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(bench.ctx), 1)
    const restarted = await boot(new RecordingAdapter([]), bench.root)
    expect(restarted.ctx.imRuntime.realScopeForSession(firstTask.sessionId)).toMatchObject({
      destination: { displayName: 'Support group', memberCount: 12 },
      sync: { lastSyncedAt: expect.any(String) },
    })
  })

  it('creates a persisted pair and routes isolated input and replies through the shared delivery path', async () => {
    const adapter = new RecordingAdapter(['complete', 'complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'tested-workspace'))
    const simUserPath = join(bench.root, 'sim-user-workspace')
    const simUser = await createSimUser(bench, simUserPath, 'sim-user-session')
    expect(bench.ctx.tools.schemas(simUser.handle.agent).map(schema => schema.name).filter(name => name.startsWith('im_sim_'))).toEqual([])
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('simulation-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    expect(bench.ctx.tools.schemas(simUser.handle.agent).map(schema => schema.name)).toContain('im_sim_create')

    const instance = await bench.ctx.imRuntime.createSimulationInstance({
      simUserSessionId: simUser.handle.agent.id,
      speakingMembers: [{ actorId: 'buyer-1', displayName: 'Buyer' }],
    })
    expect(instance).toMatchObject({
      status: 'running', simUserSessionId: simUser.handle.agent.id,
      simUserWorkspaceId: simUser.workspace.id,
      target: { routeId: configured.route.id, workspaceId: configured.route.workspaceId, conversationId: 'buyer-1' },
    })
    expect(await bench.ctx.sessionPersistence.stat(instance.testedSessionId)).toBeDefined()
    expect(configured.route.workspaceId === simUser.workspace.id).toBe(false)
    const scope = bench.ctx.imRuntime.scopeForSession(instance.testedSessionId)?.deliveryScope
    if (scope === undefined) throw new Error('tested Session has no authoritative simulation scope')
    expect(bench.ctx.imRuntime.scopeForSession(simUser.handle.agent.id)).toMatchObject({
      role: 'sim-user', peerSessionId: instance.testedSessionId, workspaceId: simUser.workspace.id,
    })
    expect(bench.ctx.tools.schemas(simUser.handle.agent).map(schema => schema.name).filter(name => name.startsWith('im_sim_')).sort())
      .toEqual(['im_sim_send_as_managed_human', 'im_sim_send_as_member', 'im_sim_stop'])
    const tested = bench.ctx.agents.get(instance.testedSessionId)
    if (tested === undefined) throw new Error('tested Agent was not created')
    expect(bench.ctx.tools.schemas(tested).map(schema => schema.name).filter(name => name.startsWith('im_sim_'))).toEqual([])
    await expect(bench.ctx.imRuntime.beginStopSimulationForSession(instance.testedSessionId))
      .rejects.toMatchObject({ code: 'IM_SIMULATION_SESSION_INVALID' })

    const imported = await bench.ctx.imRuntime.importSimulationHistory({
      instanceId: instance.instanceId, operationId: deliveryOperation('simulation-history'),
      fileName: '/private/operator/history/simulation-history.jsonl',
      jsonl: `${JSON.stringify({
        externalMessageId: 'historical-only', sender: { kind: 'external', senderId: 'historic-buyer' },
        content: { text: 'historical context', format: 'text' }, occurredAt: '2026-09-14T00:00:00.000Z',
      })}\n`,
    })
    expect(imported).toMatchObject({
      source: { fileName: 'simulation-history.jsonl', messageCount: 1, importedCount: 1, duplicateCount: 0 },
      instance: { historyImports: [{ fileName: 'simulation-history.jsonl', messageCount: 1 }] },
    })
    expect(JSON.stringify(imported)).not.toContain('/private/operator/history')
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(adapter.requests).toHaveLength(0)

    await bench.ctx.imRuntime.injectSimulationMember({ instanceId: instance.instanceId, actorId: 'buyer-1', text: 'simulation input' })
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    expect(bench.ctx.imRuntime.getAgentTask(scope)).toMatchObject({ sessionId: instance.testedSessionId, scope: { kind: 'simulation', instanceId: instance.instanceId } })
    expect(adapter.requests).toHaveLength(1)
    await bench.ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('simulation-reply'), name: 'im_send_message',
      arguments: { text: 'isolated reply' }, agent: tested,
    })
    await expect.poll(() => adapter.requests.length).toBe(2)
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('isolated reply')
    expect(bench.sent()).toEqual([])
  })

  it('freezes targets, isolates parallel instances, and stops only the selected pair', async () => {
    const adapter = new RecordingAdapter(['complete', 'complete', 'complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'shared-tested-workspace'))
    const firstUser = await createSimUser(bench, join(bench.root, 'sim-users'), 'sim-user-a')
    const secondHandle = await bench.ctx.agents.create({
      sessionId: SessionId('sim-user-b'), meta: { cwd: firstUser.workspace.path, agentPreset: 'im-test' },
      agentOptions: bench.ctx.agentDefaultModel.currentSelection(),
      setup: async agentCtx => { await bench.ctx.agentPresets.mount(agentCtx, 'im-test') },
    })
    expect(await bench.ctx.sessions.flush(secondHandle.agent.session)).toBe(true)
    await firstUser.workspace.attachSession(secondHandle.agent.id)
    const target = await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('parallel-target'), workspaceId: firstUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const first = await bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: firstUser.handle.agent.id })
    const second = await bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: secondHandle.agent.id })
    expect(first.instanceId).not.toBe(second.instanceId)
    expect(first.testedSessionId).not.toBe(second.testedSessionId)
    expect(first.target).toEqual(second.target)
    if (target.target === undefined) throw new Error('parallel target missing')
    await bench.ctx.imRuntime.removeSimulationTarget({
      operationId: operation('clear-parallel-target'), workspaceId: firstUser.workspace.id, observedRevision: target.target.revision,
    })

    await Promise.all([
      bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: first.instanceId, text: 'first isolated input' }),
      bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: second.instanceId, text: 'second isolated input' }),
    ])
    await expect.poll(() => adapter.requests.length).toBe(2)
    const firstScope = bench.ctx.imRuntime.scopeForSession(first.testedSessionId)?.deliveryScope
    const secondScope = bench.ctx.imRuntime.scopeForSession(second.testedSessionId)?.deliveryScope
    if (firstScope === undefined || secondScope === undefined) throw new Error('parallel scopes missing')
    expect(firstScope.instanceId).not.toBe(secondScope.instanceId)
    expect(bench.ctx.imRuntime.queryHistory({ scope: firstScope, limit: 10 }).items.map(item => item.content.text)).toEqual(['first isolated input'])
    expect(bench.ctx.imRuntime.queryHistory({ scope: secondScope, limit: 10 }).items.map(item => item.content.text)).toEqual(['second isolated input'])
    expect(bench.ctx.imRuntime.queryHistory({ scope: firstScope, limit: 10 }).items[0]?.sender)
      .toMatchObject({ kind: 'human-dsh', outboundRequestId: expect.any(String), providerActorId: 'merchant-1' })

    expect((await bench.ctx.imRuntime.beginStopSimulation(first.instanceId)).status).toBe('stopping')
    await bench.ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('deduplicated-stop-after-gui'),
      name: 'im_sim_stop', arguments: {}, agent: firstUser.handle.agent,
    })
    const stopped = await bench.ctx.imRuntime.waitSimulationStopped(first.instanceId)
    expect(stopped.status).toBe('stopped')
    expect(bench.ctx.agents.get(first.simUserSessionId)).toBe(firstUser.handle.agent)
    expect(bench.ctx.agents.get(first.testedSessionId)).toBeUndefined()
    expect(bench.ctx.imRuntime.getSimulationInstance(second.instanceId)?.status).toBe('running')
    expect(bench.ctx.tools.schemas(firstUser.handle.agent).map(schema => schema.name).filter(name => name.startsWith('im_sim_'))).toEqual([])
    await bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: second.instanceId, text: 'second still running' })
    await expect.poll(() => adapter.requests.length).toBe(3)
    await expect(bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: first.instanceId, text: 'late input' }))
      .rejects.toMatchObject({ code: 'IM_SIMULATION_INSTANCE_NOT_RUNNING' })
  })

  it('returns stopping to the bound tool and lets GUI waiting observe true quiescence', async () => {
    const adapter = new RecordingAdapter(['hold'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'stop-tested-workspace'))
    const simUser = await createSimUser(bench, join(bench.root, 'stop-sim-user'), 'stop-sim-user')
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('stop-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const instance = await bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id })
    await bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: instance.instanceId, text: 'hold tested Agent' })
    await expect.poll(() => adapter.requests.length).toBe(1)
    const scope = bench.ctx.imRuntime.scopeForSession(instance.testedSessionId)?.deliveryScope
    if (scope === undefined) throw new Error('stop scope missing')
    const lateRequest = brandString<ImOutboundRequestId>('late-simulation-reply')
    await bench.ctx.imRuntime.registerOutbound({
      requestId: lateRequest, scope, intent: 'ai', content: { text: 'must not return after stop', format: 'text' },
    })
    expect(bench.ctx.tools.schemas(simUser.handle.agent).map(schema => schema.name)).toContain('im_sim_stop')
    await bench.ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('simulation-stop'), name: 'im_sim_stop', arguments: {}, agent: simUser.handle.agent,
    })
    expect(bench.ctx.imRuntime.getSimulationInstance(instance.instanceId)?.status).toBe('stopping')
    const waiting = bench.ctx.imRuntime.waitSimulationStopped(instance.instanceId)
    let settled = false
    void waiting.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(settled).toBe(false)
    holds.shift()?.resolve()
    await expect(waiting).resolves.toMatchObject({ status: 'stopped', stoppedAt: expect.any(String) })
    await expect(bench.ctx.imRuntime.settleSimulationOutbound({ scope, requestId: lateRequest }))
      .rejects.toMatchObject({ code: 'IM_OUTBOUND_STATE_INVALID' })
    expect(bench.ctx.imRuntime.queryHistory({ scope, limit: 100 }).items.map(message => message.content.text))
      .not.toContain('must not return after stop')
    await expect(bench.ctx.imRuntime.beginStopSimulation(instance.instanceId)).resolves.toMatchObject({ status: 'stopped' })
  })

  it('persists stopping while creation is blocked and never publishes running afterward', async () => {
    const bench = await boot(new RecordingAdapter([]))
    const configured = await configure(bench, join(bench.root, 'creating-stop-tested'))
    const simUser = await createSimUser(bench, join(bench.root, 'creating-stop-user'), 'creating-stop-user')
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('creating-stop-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const reachedFlush = Promise.withResolvers<void>()
    const releaseFlush = Promise.withResolvers<void>()
    const flush = bench.ctx.sessions.flush.bind(bench.ctx.sessions)
    let hold = true
    bench.ctx.sessions.flush = async (session) => {
      if (hold && session.id === simUser.handle.agent.id) {
        hold = false
        reachedFlush.resolve()
        await releaseFlush.promise
      }
      return flush(session)
    }
    const statuses: string[] = []
    const dispose = bench.ctx.imRuntime.subscribe((change) => {
      if (change.kind !== 'simulation-instance' || change.instanceId === undefined) return
      const status = bench.ctx.imRuntime.getSimulationInstance(change.instanceId)?.status
      if (status !== undefined) statuses.push(status)
    })
    const creating = bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id })
    await reachedFlush.promise
    const record = bench.ctx.imRuntime.listSimulationInstances().at(-1)
    if (record === undefined) throw new Error('creating simulation record missing')
    expect(record.status).toBe('creating')

    await expect(bench.ctx.imRuntime.beginStopSimulation(record.instanceId)).resolves.toMatchObject({ status: 'stopping' })
    expect(bench.ctx.imRuntime.getSimulationInstance(record.instanceId)?.status).toBe('stopping')
    releaseFlush.resolve()
    await expect(creating).resolves.toMatchObject({ status: 'stopping' })
    await expect(bench.ctx.imRuntime.waitSimulationStopped(record.instanceId)).resolves.toMatchObject({ status: 'stopped' })
    expect(statuses).toEqual(['creating', 'stopping', 'stopped'])
    expect(bench.ctx.agents.get(record.testedSessionId)).toBeUndefined()
    bench.ctx.sessions.flush = flush
    dispose()
  })

  it('stops cleanly when cancellation overtakes a newly queued admission', async () => {
    const adapter = new RecordingAdapter(['complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'overtake-tested-workspace'))
    const simUser = await createSimUser(bench, join(bench.root, 'overtake-sim-user'), 'overtake-sim-user')
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('overtake-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const instance = await bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id })
    await bench.ctx.imRuntime.injectSimulationManagedHuman({ instanceId: instance.instanceId, text: 'queued at stop boundary' })
    await bench.ctx.imRuntime.beginStopSimulation(instance.instanceId)
    await expect(bench.ctx.imRuntime.waitSimulationStopped(instance.instanceId)).resolves.toMatchObject({ status: 'stopped' })
    expect(bench.ctx.imRuntime.getSimulationInstance(instance.instanceId)?.status).toBe('stopped')
  })

  it('restores durable pair navigation without auto-resuming ordinary Sessions', async () => {
    const firstAdapter = new RecordingAdapter([])
    const first = await boot(firstAdapter)
    const configured = await configure(first, join(first.root, 'restart-tested-workspace'))
    const simUser = await createSimUser(first, join(first.root, 'restart-sim-user'), 'restart-sim-user')
    await first.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('restart-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const instance = await first.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id })
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const runtimePath = join(first.root, 'storage', 'gestaltrun_im_runtime.json')
    const stored = JSON.parse(await readFile(runtimePath, 'utf8')) as {
      tables: { simulation_instances: Record<string, { status: string; updatedAt: string }> }
    }
    const partial = stored.tables.simulation_instances[instance.instanceId]
    if (partial === undefined) throw new Error('stored simulation instance missing')
    partial.status = 'creating'
    partial.updatedAt = '2026-09-14T02:00:00.000Z'
    await writeFile(runtimePath, `${JSON.stringify(stored, null, 2)}\n`)

    const second = await boot(new RecordingAdapter([]), first.root)
    await expect.poll(() => second.ctx.imRuntime.getSimulationInstance(instance.instanceId)?.status).toBe('running')
    expect(second.ctx.imRuntime.getSimulationInstance(instance.instanceId)).toMatchObject({
      status: 'running', simUserSessionId: instance.simUserSessionId, testedSessionId: instance.testedSessionId,
    })
    expect(second.ctx.imRuntime.scopeForSession(instance.simUserSessionId)).toMatchObject({
      role: 'sim-user', peerSessionId: instance.testedSessionId,
    })
    expect(second.ctx.agents.get(instance.simUserSessionId)).toBeUndefined()
    expect(second.ctx.agents.get(instance.testedSessionId)).toBeUndefined()
    expect(await second.ctx.sessionPersistence.stat(instance.simUserSessionId)).toBeDefined()
    expect(await second.ctx.sessionPersistence.stat(instance.testedSessionId)).toBeDefined()
  })

  it('finishes a persisted stopping instance on restart without resuming either Session', async () => {
    const first = await boot(new RecordingAdapter([]))
    const configured = await configure(first, join(first.root, 'reload-stop-tested'))
    const simUser = await createSimUser(first, join(first.root, 'reload-stop-user'), 'reload-stop-user')
    await first.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('reload-stop-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const instance = await first.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id })
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const runtimePath = join(first.root, 'storage', 'gestaltrun_im_runtime.json')
    const stored = JSON.parse(await readFile(runtimePath, 'utf8')) as {
      tables: { simulation_instances: Record<string, { status: string; updatedAt: string }> }
    }
    const partial = stored.tables.simulation_instances[instance.instanceId]
    if (partial === undefined) throw new Error('stored simulation instance missing')
    partial.status = 'stopping'
    partial.updatedAt = '2026-09-14T02:00:00.000Z'
    await writeFile(runtimePath, `${JSON.stringify(stored, null, 2)}\n`)

    const second = await boot(new RecordingAdapter([]), first.root)
    await expect.poll(() => second.ctx.imRuntime.getSimulationInstance(instance.instanceId)?.status).toBe('stopped')
    expect(second.ctx.agents.get(instance.simUserSessionId)).toBeUndefined()
    expect(second.ctx.agents.get(instance.testedSessionId)).toBeUndefined()
    expect(await second.ctx.sessionPersistence.stat(instance.simUserSessionId)).toBeDefined()
    expect(await second.ctx.sessionPersistence.stat(instance.testedSessionId)).toBeDefined()
  })

  it('retains an honest failed record when tested Session creation cannot start', async () => {
    const bench = await boot(new RecordingAdapter([]))
    const configured = await configure(bench, join(bench.root, 'failed-tested-workspace'))
    const simUser = await createSimUser(bench, join(bench.root, 'failed-sim-user'), 'failed-sim-user')
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('failed-target'), workspaceId: simUser.workspace.id,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const create = bench.ctx.agents.create.bind(bench.ctx.agents)
    bench.ctx.agents.create = async () => { throw new Error('controlled Agent creation failure') }
    await expect(bench.ctx.imRuntime.createSimulationInstance({ simUserSessionId: simUser.handle.agent.id }))
      .rejects.toThrow('controlled Agent creation failure')
    bench.ctx.agents.create = create
    const failed = bench.ctx.imRuntime.listSimulationInstances().at(-1)
    expect(failed).toMatchObject({
      status: 'failed', simUserSessionId: simUser.handle.agent.id,
      failure: { code: 'IM_SIMULATION_CREATE_FAILED', message: 'Simulation instance creation did not complete' },
    })
    expect(failed === undefined ? undefined : await bench.ctx.sessionPersistence.stat(failed.testedSessionId)).toBeUndefined()
  })

  it('does not re-submit after a Session read failure and reconciles the logged batch on a later restart', async () => {
    const firstAdapter = new RecordingAdapter(['complete'])
    const first = await boot(firstAdapter)
    const configured = await configure(first, join(first.root, 'workspace-a'))
    const flush = first.ctx.sessions.flush.bind(first.ctx.sessions)
    first.ctx.sessions.flush = async (session) => {
      await flush(session)
      throw new Error('fixture crash after durable Session flush')
    }
    await receive(first, configured.accountId, 'crash-gap')
    await expect.poll(() => firstAdapter.requests.length).toBe(1)
    await expect.poll(() => first.ctx.imRuntime.getAgentTask(configured.scope)).toBeDefined()
    expect(first.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(1)
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const secondAdapter = new RecordingAdapter([])
    let restoreOpen: (() => void) | undefined
    const second = await boot(secondAdapter, first.root, (ctx) => {
      const open = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
      ctx.sessionPersistence.open = async () => { throw new Error('fixture Session read unavailable') }
      restoreOpen = () => { ctx.sessionPersistence.open = open }
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(second.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(1)
    expect(secondAdapter.requests).toHaveLength(0)
    await receive(second, configured.accountId, 'after-crash-gap')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(second.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(2)
    restoreOpen?.()
    await second.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(second.ctx), 1)

    const thirdAdapter = new RecordingAdapter(['complete'])
    const third = await boot(thirdAdapter, first.root)
    await expect.poll(() => third.ctx.imRuntime.getConversationCursor(configured.scope).pendingCount).toBe(0)
    expect(thirdAdapter.requests).toHaveLength(1)
    expect(JSON.stringify(thirdAdapter.requests[0]?.messages)).toContain('after-crash-gap')
    const task = third.ctx.imRuntime.getAgentTask(configured.scope)
    if (task === undefined) throw new Error('recovered IM task is missing')
    const agent = third.ctx.agents.get(task.sessionId)
    expect(agent?.session.snapshotEvents().filter(event => event.type === 'user/message').map(event =>
      event.type === 'user/message' && event.data.source.kind === 'im'
        ? event.data.source.admission?.messages.map(message => message.externalMessageId)
        : undefined)).toEqual([['external-crash-gap'], ['external-after-crash-gap']])
    expect(third.ctx.imRuntime.queryHistory({ scope: configured.scope, limit: 10 }).items[0])
      .toMatchObject({ stage: 'submitted', submission: { sessionId: task.sessionId } })
  })
})
