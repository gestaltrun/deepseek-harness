/** Synthetic inbound transport for the authored Web recorded-session scenario. */
import assert from 'node:assert/strict'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Public Loader identity for the authored IM snapshot input. */
export const name = 'im-snapshot-provider'
/** Host services used to configure one route and deliver one provider page. */
export const inject = ['agents', 'imRuntime', 'imTransports', 'workspaceRegistry']

async function waitUntil(read, label, signal, attempts = 3_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw signal.reason
    const value = await read()
    if (value !== undefined) return value
    await delay(10, undefined, { signal })
  }
  throw new Error(`IM snapshot fixture timed out waiting for ${label}`)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Register one synthetic provider; IM runtime remains the sole Agent and Session owner.
 * @param ctx - isolated Web profile context.
 */
export function apply(ctx) {
  const root = process.cwd()
  const readyFile = join(root, '.im-snapshot-ready')
  const triggerFile = join(root, '.im-snapshot-trigger')
  const failureFile = join(root, '.im-snapshot-failure')
  const proofFile = join(root, '.im-snapshot-proof.json')
  const sent = []
  let sink
  const authorization = () => ({ state: 'ready', checkedAt: '2026-09-14T00:00:00.000Z' })
  ctx.effect(() => ctx.imTransports.register({
    platform: 'wangwang',
    async listAccountCandidates() {
      return [{
        platform: 'wangwang',
        candidateId: 'snapshot-merchant',
        endpoint: 'https://snapshot.invalid',
        merchantId: 'snapshot-merchant',
        displayName: 'Synthetic snapshot merchant',
      }]
    },
    async prepareAccount(request) {
      assert.equal(request.candidateId, 'snapshot-merchant')
      assert.equal(request.endpoint, 'https://snapshot.invalid')
      return {
        displayName: 'Synthetic snapshot merchant',
        identity: {
          platform: 'wangwang',
          merchantId: 'snapshot-merchant',
          displayName: 'Synthetic snapshot merchant',
        },
        authorization: authorization(),
      }
    },
    async inspectAccount() { return { authorization: authorization() } },
    async refreshAccount() { return { authorization: authorization() } },
    async discoverConversations() { return { items: [] } },
    async listen(_account, plan, target, signal) {
      assert.equal(plan.routes.length, 1)
      sink = target
      const finished = Promise.withResolvers()
      const stop = () => finished.resolve()
      signal.addEventListener('abort', stop, { once: true })
      return {
        done: finished.promise,
        async dispose() {
          signal.removeEventListener('abort', stop)
          stop()
        },
      }
    },
    async send(request) {
      sent.push(request)
      return {
        state: 'sent',
        externalMessageId: 'snapshot-outbound-1',
        rawStatus: 'synthetic-snapshot-confirmed',
      }
    },
    async confirm() { throw new Error('The synthetic snapshot transport has no uncertain receipt') },
  }), 'IM snapshot transport')
  ctx.effect(() => {
    const controller = new AbortController()
    void run(controller.signal).catch(async error => {
      if (!controller.signal.aborted) await writeFile(failureFile, String(error?.stack ?? error))
    })
    return () => { controller.abort(new Error('IM snapshot fixture disposed')) }
  }, 'IM snapshot admission')

  async function run(signal) {
    const workspace = await ctx.workspaceRegistry.create(root)
    const account = await ctx.imRuntime.addAccount({
      platform: 'wangwang',
      candidateId: 'snapshot-merchant',
      endpoint: 'https://snapshot.invalid',
      accessKeyId: 'synthetic-access-key',
      accessKeySecret: 'synthetic-access-secret',
    })
    const created = await ctx.imRuntime.createRoute({
      operationId: 'snapshot-create-route',
      accountId: account.id,
      conversationKind: 'direct',
      target: { kind: 'specific', conversationId: 'snapshot-buyer' },
      workspaceId: workspace.id,
      enabled: true,
    })
    assert.equal(created.status, 'applied')
    const target = await waitUntil(() => sink, 'runtime listener', signal)
    await writeFile(readyFile, 'ready\n')
    await waitUntil(() => exists(triggerFile).then(value => value ? true : undefined), 'test trigger', signal)
    const owner = { platform: 'wangwang', accountId: account.id, streamId: 'snapshot-inbox' }
    await target.receivePage({
      operationId: 'snapshot-page',
      owner,
      observedCursor: ctx.imRuntime.getProviderCursor(owner).cursor,
      nextCursor: 'snapshot-cursor-1',
      conversations: [{
        operationId: 'snapshot-conversation',
        conversationKind: 'direct',
        conversationId: 'snapshot-buyer',
        messages: [{
          externalMessageId: 'snapshot-inbound-1',
          senderEvidence: {
            kind: 'external-actor',
            senderId: 'snapshot-buyer',
            senderDisplayName: 'Synthetic Buyer',
          },
          text: 'Read the IM history, send a reply, and then confirm completion.',
          format: 'text',
          occurredAt: '2026-09-14T00:00:00.000Z',
        }],
      }],
    })
    const scope = {
      kind: 'real',
      platform: 'wangwang',
      accountId: account.id,
      conversationKind: 'direct',
      conversationId: 'snapshot-buyer',
    }
    const task = await waitUntil(() => ctx.imRuntime.getAgentTask(scope), 'runtime-owned Agent task', signal, 500)
    const agent = await waitUntil(() => ctx.agents.get(task.sessionId), 'runtime-owned Agent', signal, 500)
    await waitUntil(() => agent.session.snapshotEvents().some(event =>
      event.type === 'turn/end' && event.data.reason.kind === 'completed') || undefined, 'completed Agent turn', signal)
    const outbound = ctx.imRuntime.queryOutbound({ scope, limit: 10 }).items
    assert.equal(sent.length, 1)
    assert.equal(sent[0].conversationId, 'snapshot-buyer')
    assert.equal(sent[0].text, 'Offline fixture reply')
    assert.equal(outbound.length, 1)
    assert.equal(outbound[0].status, 'sent')
    assert.equal(outbound[0].externalMessageId, 'snapshot-outbound-1')
    await writeFile(proofFile, JSON.stringify({
      sessionId: task.sessionId,
      outboundStatus: outbound[0].status,
      outboundExternalMessageId: outbound[0].externalMessageId,
    }) + '\n')
  }
}
