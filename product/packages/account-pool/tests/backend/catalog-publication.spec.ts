/** Account model publication uses public settings and LLM services with a controlled engine catalog. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import * as ModelCenter from '@gestaltrun/dsh-model-center'
import type { Generation, SupervisorObserver } from '../../src/provider/supervisor.ts'
import { GenerationTransport } from '../../src/provider/transport.ts'
import { CLIProxyAccountPool } from '../../src/provider/gateway.ts'
import { Config } from '../../src/provider/config.ts'

const controlled = vi.hoisted(() => ({ generation: undefined as Generation | undefined, started: undefined as Promise<void> | undefined }))
vi.mock('../../src/provider/supervisor.ts', () => ({
  Supervisor: class {
    constructor(_process: unknown, _spec: unknown, private readonly observer: SupervisorObserver) {}
    start() {
      if (!controlled.generation) throw new Error('Missing controlled generation')
      controlled.started = this.observer.ready(controlled.generation)
    }
    async stop() { controlled.generation?.retire(); this.observer.withdraw(); await this.observer.quiesce() }
  },
}))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  controlled.generation = undefined
  controlled.started = undefined
})

class CatalogTransport extends GenerationTransport {
  rows: object[] = [{ id: 'model', name: 'Original', context_window: 32000, max_output_tokens: 8000,
    input_modalities: ['text', 'image'], reasoning_efforts: ['low', 'high'], default_reasoning_level: 'high' },
  { id: 'inherited-input' }]
  reads = 0
  override async catalog() { this.reads++; return { data: this.rows } }
  override async management() { return { status: 200, body: '{"files":[]}' } }
}

it('syncs source metadata through public settings, rebuilds new calls, and keeps prepared calls immutable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pool-catalog-publication-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const lifetime = new AbortController()
  const transport = new CatalogTransport('http://127.0.0.1:1', 'management-fixture', 'inference-fixture', lifetime.signal,
    { requestTimeoutMs: 1000, maxResponseBytes: 4096 })
  cleanup.push(async () => { lifetime.abort(); await transport.close() })
  cleanup.push(() => ctx.fiber.dispose())
  controlled.generation = { signal: lifetime.signal, transport, directory: root, retire: () => lifetime.abort() }
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalSubprocess)
  const settingsFile = join(root, 'model-settings.json')
  await writeFile(settingsFile, JSON.stringify({ 'llm-pi-ai': { providers: {
    'gestalt-account-pool': { defaultInput: ['text', 'image'] },
  } } }))
  await ctx.plugin(SettingsFile, { path: settingsFile, watch: false })
  await ctx.plugin(ModelCenter, { managedProviders: [{ id: 'gestalt-account-pool', displayName: 'Account pool' }] })
  await ctx.plugin(CLIProxyAccountPool, Config({ stateRoot: root, resourceDirectory: root,
    catalogRefreshIntervalMs: 3600000, requestTokenBudget: 4000 }))
  await vi.waitFor(() => { expect(controlled.started).toBeDefined() })
  await controlled.started
  const first = await ctx.llm.prepareCall({ provider: 'gestalt-account-pool', model: 'model' })
  expect((await ctx.llm.prepareCall({ provider: 'gestalt-account-pool', model: 'inherited-input' })).inputModalities)
    .toEqual(['text', 'image'])
  const updates: Promise<{ visible: string | undefined; resolved: string | undefined }>[] = []
  ctx.on('llm/adapters-updated', () => {
    const descriptor = ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')
    const visible = (descriptor?.value as { providers?: Record<string, { models?: Array<{ name?: string }> }> } | undefined)
      ?.providers?.['gestalt-account-pool']?.models?.[0]?.name
    if (ctx.llm.listProviders().some(provider => provider.id === 'gestalt-account-pool')) {
      updates.push(ctx.llm.resolveModelInfo('gestalt-account-pool', 'model').then(model => ({ visible, resolved: model.name })))
    }
  })
  transport.rows = [{ ...transport.rows[0], name: 'Updated', context_window: 64000 }, transport.rows[1]!]
  await ctx.accountPool.refresh()
  expect(await Promise.all(updates.splice(0))).toEqual([{ visible: 'Updated', resolved: 'Updated' }])
  expect(first.context?.contextWindow).toBe(32000)
  const reads = transport.reads
  const descriptor = ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')!
  await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'gestalt-account-pool', 'models'], value: [{
    id: 'model', name: 'Chosen', contextWindow: 64000, maxTokens: 8000, input: ['text'],
    reasoningEfforts: { low: 'low', high: 'high' }, defaultReasoningLevel: 'low',
  }] }], descriptor.revision)
  expect(transport.reads).toBe(reads)
  expect(await Promise.all(updates.splice(0))).toEqual([{ visible: 'Chosen', resolved: 'Chosen' }])
  const selected = await ctx.llm.prepareCall({ provider: 'gestalt-account-pool', model: 'model' })
  expect(selected.config.reasoningEffort).toBe('low')
  expect(selected.inputModalities).toEqual(['text'])
  expect(first.config.reasoningEffort).toBe('high')
  expect(first.config.maxTokens).toBe(4000)
  await ctx.accountPool.refresh()
  const resynced = await ctx.llm.prepareCall({ provider: 'gestalt-account-pool', model: 'model' })
  expect(resynced).toMatchObject({ inputModalities: ['text', 'image'], config: { reasoningEffort: 'high' } })
  expect(await ctx.llm.resolveModelInfo('gestalt-account-pool', 'model')).toMatchObject({ name: 'Updated' })
  const stored = JSON.parse(await readFile(settingsFile, 'utf8')) as { 'llm-pi-ai': { providers: Record<string, {
    displayName?: string; api?: string; models?: Array<{ name?: string }>
  }> } }
  expect(stored['llm-pi-ai'].providers['gestalt-account-pool']).toMatchObject({
    displayName: 'Account pool', api: 'openai-completions',
  })
  expect(stored['llm-pi-ai'].providers['gestalt-account-pool']?.models?.[0]?.name).toBe('Updated')
  transport.rows = []
  await ctx.accountPool.refresh()
  expect(ctx.llm.listProviders()).toEqual([])
  expect(ctx.llm.listConfigurableProviders().filter(provider => provider.provider === 'gestalt-account-pool')).toHaveLength(1)
  expect((JSON.parse(await readFile(settingsFile, 'utf8')) as typeof stored)['llm-pi-ai']
    .providers['gestalt-account-pool']?.models).toEqual([])
})
