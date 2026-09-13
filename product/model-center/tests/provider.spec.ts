/** Real official service composition with persistent settings and a local streaming provider. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Product from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function environment() {
  const home = await mkdtemp(join(tmpdir(), 'gestaltrun-model-center-'))
  cleanups.push(() => rm(home, { recursive: true }))
  const requests: Array<Record<string, unknown>> = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { choices: [{ delta: { role: 'assistant', content: 'hello' }, index: 0, finish_reason: null }] },
      { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address')
  const profile = { api: 'openai-completions', baseURL: `http://127.0.0.1:${address.port}/v1`,
    apiKeyEnv: 'PRODUCT_TEST_KEY', reasoning: 'low', compat: { thinkingFormat: 'openai' }, models: [
      { id: 'vision', name: 'Vision', input: ['text', 'image'], defaultReasoningLevel: 'high',
        reasoningEfforts: { off: null, low: 'low', high: 'high' }, futureField: { retain: true } },
      { id: 'text', input: ['text'], reasoningEfforts: false },
    ] }
  await writeFile(join(home, 'settings.json'), JSON.stringify({ 'llm-pi-ai': { providers: { gateway: profile } } }))
  await writeFile(join(home, 'credentials.yaml'), 'version: 1\nrefs:\n  PRODUCT_TEST_KEY: non-secret-test-key\n', { mode: 0o600 })
  const boot = async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FileSettingsProvider, { path: join(home, 'settings.json'), watch: false })
    await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    const product = ctx.plugin(Product, {})
    await product
    for (const runtime of ctx.registry.values()) for (const child of runtime.fibers) await child.await()
    return { ctx, product }
  }
  const active = await boot()
  return { home, requests, profile, boot, ...active }
}

async function dispatch(ctx: Context, effort?: string) {
  const call = await ctx.llm.prepareCall({ provider: 'gateway', model: 'vision',
    ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }) })
  const chunks = []
  for await (const chunk of call.stream({ ...call.config, messages: [] })) chunks.push(chunk)
  expect(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error')).toBe(false)
  return call
}

async function setDefault(ctx: Context, effort: string | undefined, revision?: number) {
  const ns = ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')!
  const user = ns.user as { providers: { gateway: { models: Array<Record<string, unknown>> } } }
  const models = structuredClone(user.providers.gateway.models)
  if (effort === undefined) delete models[0]!.defaultReasoningLevel
  else models[0]!.defaultReasoningLevel = effort
  await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'gateway', 'models'], value: models }], revision)
}

describe('product model provider', () => {
  it('reads the fork configuration unchanged and sends model defaults through official preparation', async () => {
    const { ctx, requests } = await environment()
    expect(ctx.llm).toBeInstanceOf(LlmRuntime)
    expect(await ctx.llm.resolveModelInfo('gateway', 'vision')).toMatchObject({ inputModalities: ['text', 'image'], reasoning: { defaultEffort: 'high' } })
    const call = await dispatch(ctx)
    expect(call.adapterDefaults.reasoningEffort).toBe(true)
    expect(requests.at(-1)?.reasoning_effort).toBe('high')
    await dispatch(ctx, 'low')
    expect(requests.at(-1)?.reasoning_effort).toBe('low')
    await dispatch(ctx, 'off')
    expect(requests.at(-1)).not.toHaveProperty('reasoning_effort')
  })

  it('atomically saves defaults and capabilities, preserves unknown data, and survives restart', async () => {
    const { ctx, home, boot } = await environment()
    const ns = ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')!
    await setDefault(ctx, 'low', ns.revision)
    expect((await ctx.llm.resolveModelInfo('gateway', 'vision')).reasoning?.defaultEffort).toBe('low')
    const saved = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(saved['llm-pi-ai'].providers.gateway.models[0].futureField).toEqual({ retain: true })
    await ctx.fiber.dispose()
    const restarted = await boot()
    expect((await restarted.ctx.llm.resolveModelInfo('gateway', 'vision')).reasoning?.defaultEffort).toBe('low')
  })

  it('rejects unsupported defaults and stale edits before persisting', async () => {
    const { ctx, home } = await environment()
    const before = await readFile(join(home, 'settings.json'), 'utf8')
    const ns = ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')!
    await expect(setDefault(ctx, 'max', ns.revision)).rejects.toThrow(/absent from reasoningEfforts/)
    expect(await readFile(join(home, 'settings.json'), 'utf8')).toBe(before)
    await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'gateway', 'displayName'], value: 'Updated' }], ns.revision)
    await expect(ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'gateway', 'displayName'], value: 'Stale' }], ns.revision)).rejects.toThrow(/revision|changed|conflict/i)
  })

  it('holds one prepared configuration while subsequent requests read changed defaults', async () => {
    const { ctx, requests } = await environment()
    const prepared = await ctx.llm.prepareCall({ provider: 'gateway', model: 'vision' })
    await setDefault(ctx, 'low')
    for await (const _chunk of prepared.stream({ ...prepared.config, messages: [] })) { /* consume the captured request */ }
    expect(requests.at(-1)?.reasoning_effort).toBe('high')
    await dispatch(ctx)
    expect(requests.at(-1)?.reasoning_effort).toBe('low')
  })

  it('restores provider inheritance and removes every registration on unload', async () => {
    const { ctx, product } = await environment()
    await setDefault(ctx, undefined)
    expect((await ctx.llm.resolveModelInfo('gateway', 'vision')).reasoning?.defaultEffort).toBe('low')
    await product.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    expect(ctx.settings.describe()).toEqual([])
  })
})
