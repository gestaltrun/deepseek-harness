/** Real durable delivery inputs and built Client readers used by the API smoke. */
import assert from 'node:assert/strict'

/** @param host - real Host runtime. @param client - built Client API. @param accountId - configured test account. @param waitFor - bounded observable waiter. */
export async function exerciseDelivery(host, client, accountId, waitFor) {
  const scope = { kind: 'real', platform: 'wangwang', accountId, conversationKind: 'direct', conversationId: 'delivery-a' }
  const other = { ...scope, conversationId: 'delivery-b' }
  const message = (id, text) => ({ externalMessageId: id, sender: { kind: 'external', senderId: 'visitor' }, content: { text, format: 'text' }, occurredAt: '2026-09-14T00:00:00.000Z' })
  const reader = client.im.watchDelivery({ scope, limit: 1 })
  await waitFor(reader, state => state.phase === 'ready', 'Delivery baseline')
  assert.equal(reader.getSnapshot().value.inbound.items.length, 0)
  await host.imRuntime.ingestInboundPage({ operationId: 'page-a', scope, observedCursor: null, nextCursor: 'a-1', messages: [message('a-1', 'First message'), message('a-2', 'Second message')] })
  await waitFor(reader, state => state.value?.inbound.items[0]?.externalMessageId === 'a-2', 'Live inbound')
  assert.equal(reader.getSnapshot().value.inbound.hasMore, true)
  await host.imRuntime.registerOutbound({ requestId: 'send-a', scope, intent: 'human-manual', content: { text: 'First response', format: 'text' } })
  const attempt = await host.imRuntime.beginOutboundAttempt({ requestId: 'send-a', scope })
  assert.equal(attempt.state, 'ready')
  // The fixture records an uncertain provider result without making a provider call.
  await host.imRuntime.settleOutboundAttempt({ requestId: 'send-a', scope, attemptId: attempt.attemptId, status: 'result-unknown' })
  await waitFor(reader, state => state.value?.outbound.items[0]?.status === 'result-unknown', 'Unknown outbound result')
  await host.imRuntime.registerOutbound({ requestId: 'send-b', scope, intent: 'human-manual', content: { text: 'Second response', format: 'text' } })
  await waitFor(reader, state => state.value?.outbound.items[0]?.requestId === 'send-b', 'Latest outbound')
  const prior = client.im.watchDelivery({ scope, limit: 1, inboundBeforeSequenceNumber: 2, outboundBeforeSequenceNumber: 2 })
  await waitFor(prior, state => state.phase === 'ready', 'Independent older pages')
  assert.equal(prior.getSnapshot().value.inbound.items[0].externalMessageId, 'a-1')
  assert.equal(prior.getSnapshot().value.outbound.items[0].requestId, 'send-a')
  assert.equal(prior.getSnapshot().value.outbound.items[0].status, 'result-unknown')
  const history = await client.remote.im.history({ scope, limit: 1, beforeSequenceNumber: 2 })
  const outbound = await client.remote.im.outbound({ scope, limit: 1, beforeSequenceNumber: 2 })
  assert(history.ok)
  assert(outbound.ok)
  assert.equal(history.value.items[0].externalMessageId, 'a-1')
  assert.equal(outbound.value.items[0].status, 'result-unknown')
  await assert.rejects(host.typertGateway.invoke({ namespace: 'im', method: 'history', args: {
    request: { scope: { ...scope, kind: 'invalid' }, limit: 1 },
  } }), error => error.code === 'gateway/input-invalid')
  const invalidLimit = await client.remote.im.outbound({ scope, limit: 0 })
  assert.equal(invalidLimit.ok, false)
  assert.equal(invalidLimit.error.code, 'im/configuration')
  await prior.dispose()
  const last = reader.getSnapshot()
  await reader.dispose()
  const selected = client.im.watchDelivery({ scope: other, limit: 2 })
  await waitFor(selected, state => state.phase === 'ready', 'Second scope baseline')
  await host.imRuntime.ingestInboundPage({ operationId: 'page-b', scope: other, observedCursor: null, nextCursor: 'b-1', messages: [message('b-1', 'Other conversation')] })
  await waitFor(selected, state => state.value?.inbound.items.length === 1, 'Second scope live message')
  assert.equal(selected.getSnapshot().value.inbound.items[0].externalMessageId, 'b-1')
  assert.equal(reader.getSnapshot(), last)
  await selected.dispose()
  return { live: true, separatePageCursors: true, unknownPreserved: true, immutableScope: true, invalidInputsRejected: true, disposalIsolated: true }
}
