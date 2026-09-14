import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import { Context } from '@deepseek-ai/cordis'
import { MessageId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createServer, type Server } from 'node:https'
import { once } from 'node:events'
import { generate } from 'selfsigned'
import { GenerationTransport } from '../../src/provider/transport.ts'
import { GenerationAdapter, ACCOUNT_POOL_ROUTE } from '../../src/llm/adapter.ts'
import { Config } from '../../src/provider/config.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function certificate() { return generate([{ name: 'commonName', value: 'localhost' }], {
  keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
  extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
}) }
async function serve(listener: Parameters<typeof createServer>[1]): Promise<{ server: Server; origin: string; cert: string }> {
  const keys = await certificate()
  const server = createServer({ key: keys.private, cert: keys.cert }, listener)
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing server address')
  return { server, origin: `https://127.0.0.1:${address.port}`, cert: keys.cert }
}
function transport(origin: string, cert: string, lifetime = new AbortController(), maxResponseBytes = 1048576) {
  const result = new GenerationTransport(origin, cert, 'test-management-key', 'test-inference-key', lifetime.signal,
    { requestTimeoutMs: 2000, maxResponseBytes })
  cleanup.push(async () => { lifetime.abort(); await result.close() })
  return result
}
const options: GenerateOptions = { provider: ACCOUNT_POOL_ROUTE, model: 'known-model', messages: [{
  id: MessageId('user'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }],
}] }
async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('generation-owned TLS and public PiAi composition', () => {
  it('sends no HTTP credentials through an untrusted generation certificate', async () => {
    let requests = 0
    const endpoint = await serve((_request, response) => { requests++; response.end('{}') })
    const wrong = await certificate()
    const current = transport(endpoint.origin, wrong.cert)
    await expect(current.catalog()).rejects.toThrow()
    await expect(current.management('GET', '/v0/management/auth-files')).rejects.toThrow()
    await expect(current.fetch(`${endpoint.origin}/v1/chat/completions`, { method: 'POST', body: '{}',
      headers: { authorization: 'Bearer test-inference-key' } })).rejects.toThrow()
    expect(requests).toBe(0)
  })

  it('rejects redirects and oversized individual multibyte response chunks', async () => {
    let otherRequests = 0
    const other = await serve((_request, response) => { otherRequests++; response.end('{}') })
    const endpoint = await serve((request, response) => {
      if (request.url === '/v1/models') { response.writeHead(302, { location: `${other.origin}/v1/models` }); response.end(); return }
      response.end('测'.repeat(10))
    })
    const current = transport(endpoint.origin, endpoint.cert, new AbortController(), 16)
    await expect(current.catalog()).rejects.toThrow()
    await expect(current.management('GET', '/v0/management/auth-files')).rejects.toThrow('byte limit')
    await expect(current.management('GET', `${other.origin}/v0/management/auth-files`)).rejects.toThrow('outside')
    expect(otherRequests).toBe(0)
  })

  it('records known reasoning before dispatch and keeps a prepared call on its captured authority', async () => {
    const calls: { key: string | undefined; body: Record<string, unknown> }[] = []
    const endpoint = await serve(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      calls.push({ key: request.headers.authorization, body: JSON.parse(body) as Record<string, unknown> })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const envelope = { id: 'completion', object: 'chat.completion.chunk', created: 1, model: 'known-model' }
      response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: { role: 'assistant', content: 'real-sse' }, finish_reason: null }] })}\n\n`)
      response.end(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
    const lifetime = new AbortController()
    const current = transport(endpoint.origin, endpoint.cert, lifetime)
    const config = Config({ stateRoot: '/unused-product-state', allowCredentialExport: true })
    const original = new GenerationAdapter(new Context(), current, [{ id: 'known-model', contextWindow: 131072,
      maxTokens: 64000, input: ['text'], reasoningEfforts: { high: 'high' }, defaultReasoningLevel: 'high' }], config)
    const prepared = await original.prepareCall(ACCOUNT_POOL_ROUTE, 'known-model')
    expect(prepared.model.context).toEqual({ contextWindow: 131072 })
    expect(prepared.model.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
    expect(prepared.model.reasoning?.defaultEffort).toBe('high')
    const later = new GenerationAdapter(new Context(), current, [], config)
    expect(await later.listModels(ACCOUNT_POOL_ROUTE)).toEqual([])
    expect((await drain(prepared.stream(options))).some(chunk => chunk.type === 'text-delta' && chunk.text === 'real-sse')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.key).toBe('Bearer test-inference-key')
    expect(calls[0]?.body.reasoning_effort).toBe('high')
    expect(calls[0]?.body.max_completion_tokens ?? calls[0]?.body.max_tokens).toBe(16384)
    lifetime.abort()
    await expect(async () => drain(prepared.stream(options))).rejects.toThrow()
    await original.quiesce()
    expect(calls).toHaveLength(1)
  })
})

it('revocation closes an admitted iterator even when its consumer pauses after a chunk', async () => {
  const cert = await certificate()
  const lifetime = new AbortController()
  const current = transport('https://127.0.0.1:1', cert.cert, lifetime)
  let finalized = false
  async function* source() {
    try { yield 1; yield 2 } finally { finalized = true }
  }
  const reader = current.ownStream(source())[Symbol.asyncIterator]()
  expect(await reader.next()).toEqual({ done: false, value: 1 })
  lifetime.abort()
  await current.quiesce()
  expect(finalized).toBe(true)
  expect((await reader.next()).done).toBe(true)
})

it('uses the public durable image pipeline and does not expose placeholder pricing as free usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pool-image-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalAttachments, { dshHome: root })
  await ctx.plugin(LocalFs, { cwd: root })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8DwH4QZYAwAR8oH+Xm0fdIAAAAASUVORK5CYII=', 'base64')
  const attachment = await ctx.attachments.saveImage({ data: png, mediaType: 'image/png', name: 'red-square.png' })
  const hostPath = ctx.attachments.imageHostPath(attachment)!
  expect((await readFile(hostPath)).equals(Buffer.from((await ctx.attachments.readImage(attachment)).data))).toBe(true)
  let requestBody = ''
  const endpoint = await serve(async (request, response) => {
    for await (const chunk of request) requestBody += String(chunk)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'image-response', object: 'chat.completion.chunk', created: 1, model: 'known-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'image-received' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`)
  })
  const current = transport(endpoint.origin, endpoint.cert)
  const adapter = new GenerationAdapter(ctx, current, [{ id: 'known-model', contextWindow: 8192, maxTokens: 1024, input: ['text', 'image'] }],
    Config({ stateRoot: root, allowCredentialExport: false }))
  const prepared = await adapter.prepareCall(ACCOUNT_POOL_ROUTE, 'known-model')
  expect(prepared.model.inputModalities).toEqual(['text', 'image'])
  const chunks = await drain(prepared.stream({ ...options, messages: [{ id: MessageId('image-user'), role: 'user', source: { kind: 'user' },
    content: [{ type: 'image', attachment }] }] }))
  const body = JSON.parse(requestBody) as { messages: { content: { type: string; image_url?: { url: string }; text?: string }[] }[] }
  const parts = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  expect(parts.some(part => part.image_url?.url.startsWith('data:image/png;base64,'))).toBe(true)
  expect(parts.some(part => part.text?.includes('2x2'))).toBe(true)
  expect(requestBody).toContain(hostPath)
  expect(adapter.imageRequestPricing(ACCOUNT_POOL_ROUTE, 'known-model')).toBeUndefined()
  const usage = chunks.find(chunk => chunk.type === 'usage')
  expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })
  const publicMetadata = JSON.stringify({ model: prepared.model, provider: adapter.providerInfo(ACCOUNT_POOL_ROUTE) })
  expect(publicMetadata).not.toContain(endpoint.origin)
  expect(publicMetadata).not.toContain('test-inference-key')
})
