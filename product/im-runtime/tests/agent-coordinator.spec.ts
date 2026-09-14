import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImRuntime, {
  type ImAccountId,
  type ImDeliveryOperationId,
  type ImDeliveryScope,
  type ImOperationId,
  type ImRouteView,
  type ImSimulationInstanceId,
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
        text,
        format: 'text',
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
      messages: messages.map(message => ({
        externalMessageId: message.externalMessageId,
        senderEvidence: { kind: 'external-actor', senderId: 'buyer-1', senderDisplayName: 'Buyer' },
        text: message.externalMessageId,
        format: 'text',
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
  })

  it('admits configured simulation input through the same Agent path', async () => {
    const adapter = new RecordingAdapter(['complete'])
    const bench = await boot(adapter)
    const configured = await configure(bench, join(bench.root, 'workspace-a'))
    await bench.ctx.imRuntime.saveSimulationTarget({
      operationId: operation('simulation-target'), workspaceId: configured.route.workspaceId,
      observedRevision: null, accountId: configured.accountId, routeId: configured.route.id,
    })
    const scope: ImDeliveryScope = {
      kind: 'simulation', instanceId: brandString<ImSimulationInstanceId>('simulation-1'),
      platform: 'wangwang', accountId: configured.accountId, conversationKind: 'direct', conversationId: 'buyer-1',
    }
    await bench.ctx.imRuntime.ingestInboundPage({
      operationId: deliveryOperation('simulation-message'), scope, observedCursor: null, nextCursor: null,
      messages: [{
        externalMessageId: 'simulation-external', sender: { kind: 'external', senderId: 'sim-user' },
        content: { text: 'simulation input', format: 'text' }, occurredAt: '2026-09-14T01:00:00.000Z',
      }],
    })
    await expect.poll(() => bench.ctx.imRuntime.getConversationCursor(scope).pendingCount).toBe(0)
    expect(bench.ctx.imRuntime.getAgentTask(scope)?.scope.kind).toBe('simulation')
    expect(adapter.requests).toHaveLength(1)
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
