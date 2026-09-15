/** Managed provider reservations over the public Settings and LLM services. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import * as Product from '../src/index.ts'
import type { ManagedProviderHandle, ProductProviderProfile } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function boot(managed: boolean, stored: Record<string, unknown> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'model-center-managed-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const settingsPath = join(home, 'settings.json')
  await writeFile(settingsPath, JSON.stringify(stored))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
  const product = ctx.plugin(Product, managed ? {
    managedProviders: [{ id: 'gestalt-account-pool', displayName: 'Account pool' }],
  } : {})
  await product
  for (const runtime of ctx.registry.values()) for (const child of runtime.fibers) await child.await()
  return { ctx, settingsPath }
}

const catalog = [{
  id: 'vision', name: 'Vision', contextWindow: 64000, maxTokens: 8000,
  input: ['text', 'image'] as ('text' | 'image')[],
  reasoningEfforts: { off: null, low: 'low', high: 'high' }, defaultReasoningLevel: 'high' as const,
}]

it('declares no account-pool route when Model Center is installed alone', async () => {
  const { ctx } = await boot(false)
  expect(ctx.llm.listConfigurableProviders().some(entry => entry.provider === 'gestalt-account-pool')).toBe(false)
})

it('reserves a stored managed route before generic pi-ai can register it', async () => {
  const stored = { 'llm-pi-ai': { providers: {
    ordinary: { api: 'openai-completions', baseURL: 'https://ordinary.invalid/v1', models: [{ id: 'ordinary' }] },
    'gestalt-account-pool': { api: 'openai-completions', models: catalog },
  } } }
  const { ctx } = await boot(true, stored)
  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['ordinary'])
  expect(ctx.llm.listConfigurableProviders().filter(entry => entry.provider === 'gestalt-account-pool')).toMatchObject([
    { displayName: 'Account pool', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gestalt-account-pool'], declared: false },
  ])
})

it('persists source fields, notifies the runtime owner, and overwrites a later manual model edit', async () => {
  const stored = { 'llm-pi-ai': { providers: {
    ordinary: { api: 'openai-completions', baseURL: 'https://ordinary.invalid/v1', models: [{ id: 'ordinary' }] },
    'gestalt-account-pool': { defaultInput: ['text'] },
  } } }
  const { ctx, settingsPath } = await boot(true, stored)
  const changed: Array<ProductProviderProfile | undefined> = []
  const updates = vi.fn()
  ctx.on('settings/updated', (ns) => { if (ns === 'llm-pi-ai') updates() })
  const owner = ctx.extend()
  const handle = ctx.modelCenter.registerManagedProvider(owner, 'gestalt-account-pool', {
    validate: () => undefined,
    changed: profile => { changed.push(profile) },
    discover: () => Promise.resolve(catalog),
  })
  await handle.syncCatalog(catalog)
  expect(updates).toHaveBeenCalledTimes(1)
  expect(changed.at(-1)?.models?.[0]).toMatchObject({
    id: 'vision', input: ['text', 'image'], reasoningEfforts: { off: null, low: 'low', high: 'high' },
    defaultReasoningLevel: 'high',
  })
  let descriptor = ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')!
  const syncedRevision = descriptor.revision
  await handle.syncCatalog(catalog)
  expect(ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')!.revision).toBe(syncedRevision)
  expect(updates).toHaveBeenCalledTimes(1)
  await ctx.settings.mutate('llm-pi-ai', [{
    op: 'set', path: ['providers', 'gestalt-account-pool', 'models'], value: [{ ...catalog[0]!, name: 'Manual' }],
  }], descriptor.revision)
  const mutate = ctx.settings.mutate.bind(ctx.settings)
  vi.spyOn(ctx.settings, 'mutate').mockImplementationOnce(async (ns, ops, revision) => {
    await mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'ordinary', 'displayName'], value: 'Concurrent edit',
    }], revision)
    return mutate(ns, ops, revision)
  })
  await handle.syncCatalog(catalog)
  descriptor = ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')!
  expect((descriptor.user as { providers: Record<string, ProductProviderProfile> }).providers['gestalt-account-pool']).toMatchObject({
    displayName: 'Account pool', api: 'openai-completions', defaultInput: ['text'], models: [{ name: 'Vision' }],
  })
  expect((descriptor.user as { providers: Record<string, unknown> }).providers).toHaveProperty('ordinary')
  expect((descriptor.user as { providers: Record<string, { displayName?: string }> }).providers.ordinary?.displayName)
    .toBe('Concurrent edit')
  expect(JSON.parse(await readFile(settingsPath, 'utf8'))['llm-pi-ai'].providers.ordinary).toBeDefined()
})

it('routes managed discovery to the catalog owner without forwarding endpoint authority', async () => {
  const { ctx } = await boot(true)
  const discover = vi.fn(() => Promise.resolve(catalog))
  ctx.modelCenter.registerManagedProvider(ctx.extend(), 'gestalt-account-pool', {
    validate: () => undefined,
    changed: () => undefined,
    discover,
  })
  expect(await ctx.llm.discoverModels('llm-pi-ai', {
    provider: 'gestalt-account-pool', baseURL: 'https://attacker.invalid', apiKey: 'must-not-forward', api: 'other',
  })).toEqual([{ id: 'vision', name: 'Vision', contextWindow: 64000, maxTokens: 8000 }])
  expect(discover).toHaveBeenCalledWith(undefined)
})

it('rejects managed connection fields before persistence and releases producer ownership with its context', async () => {
  const { ctx, settingsPath } = await boot(true)
  const before = await readFile(settingsPath, 'utf8')
  await expect(ctx.settings.mutate('llm-pi-ai', [{
    op: 'set', path: ['providers', 'gestalt-account-pool', 'baseURL'], value: 'https://attacker.invalid/v1',
  }])).rejects.toThrow(/does not accept a baseURL/)
  expect(await readFile(settingsPath, 'utf8')).toBe(before)

  const owner = ctx.extend()
  let handle: ManagedProviderHandle | undefined
  const fiber = owner.plugin({
    name: 'managed-owner-fixture',
    apply(pluginCtx: Context) {
      handle = ctx.modelCenter.registerManagedProvider(pluginCtx, 'gestalt-account-pool', {
        validate: () => undefined, changed: () => undefined, discover: () => Promise.resolve([]),
      })
    },
  })
  await fiber
  await fiber.dispose()
  await expect(handle!.syncCatalog(catalog)).rejects.toThrow(/producer is disposed/)
  const syncFailure = ctx.modelCenter.registerManagedProvider(ctx.extend(), 'gestalt-account-pool', {
    validate: () => undefined, changed: () => { throw new Error('contained') }, discover: () => Promise.resolve([]),
  })
  syncFailure.dispose()
  expect(() => ctx.modelCenter.registerManagedProvider(ctx.extend(), 'gestalt-account-pool', {
    validate: () => undefined, changed: () => Promise.reject(new Error('contained async')), discover: () => Promise.resolve([]),
  })).not.toThrow()
  await Promise.resolve()
})

it('does not continue a catalog conflict retry after its producer is disposed', async () => {
  const { ctx } = await boot(true)
  const handle = ctx.modelCenter.registerManagedProvider(ctx.extend(), 'gestalt-account-pool', {
    validate: () => undefined, changed: () => undefined, discover: () => Promise.resolve(catalog),
  })
  const mutate = vi.spyOn(ctx.settings, 'mutate').mockImplementationOnce((_ns, _ops, revision = 0) => {
    handle.dispose()
    throw new SettingsConflictError('llm-pi-ai', revision, revision + 1)
  })
  await expect(handle.syncCatalog(catalog)).rejects.toBeInstanceOf(SettingsConflictError)
  expect(mutate).toHaveBeenCalledTimes(1)
})
