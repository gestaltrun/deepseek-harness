/** Offline Provider and LLM fixture loaded only through a public dsh profile. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

/** Public Loader identity for the private configuration fixture. */
export const name = 'im-agent-profile-fixture'
/** Services supplied by the tested profile rather than a second application launcher. */
export const inject = ['imRuntime', 'imTransports', 'llm', 'agents', 'sessions', 'sessionPersistence', 'tools', 'workspaceRegistry', 'agentPresets']

function toolResponse(id, name, args) {
  const callId = ToolCallId(id)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class OfflineModel extends LlmAdapter {
  requests = []
  async resolveModel(provider, id) { return { provider, id, name: 'Offline scripted IM model', contextWindow: 128000 } }
  async * stream(options) {
    this.requests.push(options)
    switch (this.requests.length) {
      case 1: yield* toolResponse('fixture-history', 'im_query_history', { limit: 10 }); return
      case 2: yield* toolResponse('fixture-send', 'im_send_message', { text: 'Offline fixture reply' }); return
      case 3:
        yield* [
          { type: 'block-start', index: 0, blockType: 'text' },
          { type: 'text-delta', index: 0, text: 'Offline IM task complete.' },
          { type: 'block-end', index: 0, block: { type: 'text', text: 'Offline IM task complete.' } },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
          { type: 'finish', reason: { kind: 'stop' } },
        ]
        return
      default: throw new Error('Offline IM model received an unexpected request')
    }
  }
}

async function observe(read, signal, label) {
  while (true) {
    if (signal.aborted) throw new Error(`IM fixture timed out waiting for ${label}`, { cause: signal.reason })
    const value = read()
    if (value) return value
    try { await delay(10, undefined, { signal }) } catch (cause) {
      throw new Error(`IM fixture timed out waiting for ${label}`, { cause })
    }
  }
}

/**
 * Install deterministic input/output Providers; the runtime owns Agent creation.
 * @param ctx - isolated profile context.
 * @param config - test-owned workspace and output paths.
 */
export function apply(ctx, config) {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  assert.ok(ready && exit, 'The published dsh launcher must supply readiness and bounded exit')
  const model = new OfflineModel()
  const sent = []
  const logs = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { logs.push({ type: message.type, name: message.name, args: message.args.map(value => value instanceof Error ? value.stack : value) }) } })
  let sink
  const authorization = () => ({ state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' })
  ctx.effect(() => ctx.llm.registerAdapter(['im-offline-fixture'], model), 'im fixture model')
  ctx.effect(() => ctx.imTransports.register({
    platform: 'wangwang',
    async listAccountCandidates() { return [{ platform: 'wangwang', candidateId: 'offline-merchant', merchantId: 'offline-merchant', displayName: 'Offline synthetic merchant' }] },
    async prepareAccount(request) {
      assert.equal(request.candidateId, 'offline-merchant')
      return { displayName: 'Offline synthetic merchant', identity: { platform: 'wangwang', merchantId: 'offline-merchant', displayName: 'Offline synthetic merchant' }, authorization: authorization() }
    },
    async inspectAccount() { return { authorization: authorization() } },
    async refreshAccount() { return { authorization: authorization() } },
    async discoverConversations() { return { items: [] } },
    async listen(_account, plan, target, signal) {
      assert.equal(plan.routes.length, 1)
      assert.equal(plan.routes[0].conversationKind, 'direct')
      sink = target
      const finished = Promise.withResolvers()
      const stop = () => finished.resolve()
      signal.addEventListener('abort', stop, { once: true })
      return { done: finished.promise, async dispose() { signal.removeEventListener('abort', stop); stop() } }
    },
    async send(request) {
      sent.push(request)
      return { state: 'sent', externalMessageId: 'offline-outbound-1', rawStatus: 'offline-fixture-confirmed' }
    },
    async confirm() { throw new Error('Offline fixture has no uncertain receipt') },
  }), 'im fixture transport')
  ctx.effect(() => ready.onReady(() => {
    void run().then(() => exit(0), async error => {
      await writeFile(join(config.output, 'failure.txt'), String(error.stack ?? error))
      await writeFile(join(config.output, 'failure-state.json'), JSON.stringify({ modelRequests: model.requests.length, listenerReady: sink !== undefined, configuration: ctx.imRuntime.snapshot(), presets: await ctx.agentPresets.list(), logs }, null, 2) + '\n')
      exit(1)
    })
  }), 'im fixture startup')

  async function run() {
    const signal = AbortSignal.timeout(30000)
    await mkdir(config.workspace, { recursive: true })
    await mkdir(config.output, { recursive: true })
    const workspace = await ctx.workspaceRegistry.create(config.workspace)
    const account = await ctx.imRuntime.addAccount({ platform: 'wangwang', candidateId: 'offline-merchant' })
    const result = await ctx.imRuntime.createRoute({
      operationId: 'fixture-create-route', accountId: account.id, conversationKind: 'direct',
      target: { kind: 'specific', conversationId: 'offline-buyer' }, workspaceId: workspace.id, enabled: true,
    })
    assert.equal(result.status, 'applied')
    const target = await observe(() => sink, signal, 'listener ready')
    const owner = { platform: 'wangwang', accountId: account.id, streamId: 'offline-inbox' }
    const page = {
      operationId: 'fixture-page', owner, observedCursor: ctx.imRuntime.getProviderCursor(owner).cursor, nextCursor: 'offline-cursor-1',
      conversations: [{ operationId: 'fixture-conversation', conversationKind: 'direct', conversationId: 'offline-buyer', messages: [{
        externalMessageId: 'offline-inbound-1', senderEvidence: { kind: 'external-actor', senderId: 'offline-buyer', senderDisplayName: 'Offline Buyer' },
        text: 'Read the history and send an offline reply.', format: 'text', occurredAt: '2026-09-14T00:00:00.000Z',
      }] }],
    }
    await assert.rejects(target.receivePage({ ...page, owner: { ...owner, accountId: 'another-account' } }), /owner|account|scope/i)
    await target.receivePage(page)
    const scope = { kind: 'real', platform: 'wangwang', accountId: account.id, conversationKind: 'direct', conversationId: 'offline-buyer' }
    const task = await observe(() => ctx.imRuntime.getAgentTask(scope), signal, 'automatic Agent task')
    const agent = await observe(() => ctx.agents.get(task.sessionId), signal, 'published Agent')
    await observe(() => model.requests.length === 3, signal, 'model tool sequence')
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    const events = agent.session.snapshotEvents()
    const inbound = events.find(event => event.type === 'user/message')
    assert.equal(inbound?.data.source.kind, 'im')
    assert.equal(inbound?.data.source.admission.workspaceId, workspace.id)
    assert.equal(inbound?.data.source.admission.routeId, result.route.id)
    assert.equal(inbound?.data.source.admission.messages[0].externalMessageId, 'offline-inbound-1')
    assert.equal(agent.session.header.cwd, workspace.path)
    assert.equal(task.agentPreset, 'standard')
    assert.equal(ctx.imRuntime.getConversationCursor(scope).pendingCount, 0)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].conversationId, 'offline-buyer')
    assert.equal(sent[0].text, 'Offline fixture reply')
    const outbound = ctx.imRuntime.queryOutbound({ scope, limit: 10 }).items
    assert.equal(outbound[0].status, 'sent')
    assert.ok(JSON.stringify(model.requests[0].messages).includes('Read the history and send an offline reply.'))
    await writeFile(join(config.output, 'session-events.json'), JSON.stringify({ header: agent.session.header, events }, null, 2) + '\n')
    await writeFile(join(config.output, 'proof.json'), JSON.stringify({
      fixture: 'explicit synthetic Provider and scripted LLM; no real account or model',
      sessionId: task.sessionId, workspaceId: workspace.id, routeId: result.route.id,
      preset: task.agentPreset, modelRequests: model.requests.length,
      tools: ctx.tools.schemas(agent).map(schema => schema.name), outbound,
      rejectedWrongOwner: true, automaticAgent: true, persistedSession: await ctx.sessionPersistence.stat(task.sessionId),
    }, null, 2) + '\n')
  }
}
