// @vitest-environment jsdom

/** Built-artifact Client lifecycle smoke; run the product build before this file. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import * as React from 'react'
import * as ReactJsx from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Stores from '@deepseek-ai/dsh-client-store'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientBundleRegistration, ClientModuleLoaderTarget, ClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteStream, RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountPoolInjected } from '../src/client/contract.ts'
import type { AccountPoolSnapshot } from '../src/account-pool.ts'

const require = createRequire(import.meta.url)
const id = '@gestaltrun/dsh-account-pool'
const moduleId = '@deepseek-ai/dsh-client-modules'
const rendererId = '@deepseek-ai/dsh-client-ui-renderer'
const localeId = '@deepseek-ai/dsh-client-locale'
const hmrId = '@deepseek-ai/dsh-client-hmr'
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  vi.unstubAllGlobals()
  if (failures.length > 0) throw new AggregateError(failures, 'Client test cleanup failed')
})

function execute(specifier: string): void {
  const path = require.resolve(specifier)
  runInThisContext(readFileSync(path, 'utf8'), { filename: path })
}

function createModules(): ClientModuleSystem {
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  const queue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: queue,
    load: registration => { queue.push(registration) },
    create: () => { throw new Error('The test calls the public bootstrap export directly') },
  }
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: target })
  cleanups.push(() => {
    if (previous === undefined) Reflect.deleteProperty(window, '__ModuleLoader__')
    else Object.defineProperty(window, '__ModuleLoader__', previous)
  })
  execute(`${moduleId}/client`)
  const registration = queue.shift()!
  const bootstrap = registration.factory(() => { throw new Error('The bootstrap module requests no platform dependencies') })
  const api = bootstrap as typeof import('@deepseek-ai/dsh-client-modules/client')
  const ids = [moduleId, rendererId, localeId, hmrId, id]
  const rows = ids.map((name, index) => ({ id: name, url: `/client/${index}.js?rev=1`, rev: '1' }))
  const modules = api.createClientModuleSystem(target, { id: moduleId, exports: bootstrap }, {
    boot: { rev: '1', entries: rows, batches: rows.map(row => ({ phase: 'application', url: row.url, rev: '1', entries: [row.id] })) },
    staticModules: {
      react: React, 'react/jsx-runtime': ReactJsx, 'react-dom': ReactDom, 'react-dom/client': ReactDomClient,
      '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-store': Stores,
      '@deepseek-ai/dsh-client-ui-slots': Slots, '@deepseek-ai/dsh-client-ui-primitives': Primitives,
    },
    loadBundle: async url => {
      const path = new URL(url, 'https://client.test').pathname
      const row = rows.find(candidate => new URL(candidate.url, 'https://client.test').pathname === path)
      if (row === undefined) throw new Error(`Unexpected Client bundle ${path}`)
      execute(`${row.id}/client`)
    },
  })
  cleanups.push(() => {
    for (const name of [id, localeId, rendererId, hmrId]) {
      modules.invalidate(name)
      for (const style of document.querySelectorAll(`style[data-plugin="${name}"]`)) style.remove()
    }
  })
  return modules
}

function provideRemote(ctx: Cordis.Context) {
  const ready: AccountPoolSnapshot = { state: 'ready', accounts: [] }
  const listeners = new Set<() => void>()
  const stopped = vi.fn()
  const unmounted = vi.fn()
  const mount = vi.fn(async (contribution: TypertRemoteContribution) => {
    expect(contribution.descriptors).toHaveLength(16)
    expect(contribution.descriptors.every(method => method.result.mode === 'strict')).toBe(true)
    const dispose = ctx.provide('remote.accountPool', namespace)
    return async () => { await dispose(); unmounted() }
  })
  const namespace = {
    watch: async function* (signal?: AbortSignal) {
      try {
        yield ready
        await new Promise<void>(resolve => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
      } finally { stopped() }
    },
  }
  const remote = {
    accountPool: namespace,
    llm: { listProviders: async () => ({ ok: true, value: [] }) },
    $mount: mount,
    $on: (_event: string, listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    $stream: <Item,>(options: RemoteStreamOptions<Item>): RemoteStream<Item> => {
      const abort = new AbortController()
      let finish!: () => void
      const closed = new Promise<void>(resolve => { finish = resolve })
      const iterator = (async function* () {
        try {
          for await (const value of options.open(abort.signal)) yield { value, generation: 1, signal: abort.signal, accept: () => {} }
        } finally { finish() }
      })()
      // Remote is the scripted external boundary; Cordis, modules, locale and slots remain real.
      return {
        signal: abort.signal, restart: () => {}, [Symbol.asyncIterator]: () => iterator,
        dispose: async () => { abort.abort(); await closed },
      } as unknown as RemoteStream<Item>
    },
  }
  ctx.provide('remote', remote as unknown as ClientRemote)
  ctx.provide('remote.llm', remote.llm)
  return { mount, listeners, stopped, unmounted }
}

describe('built account-pool Client plugin', () => {
  it('hot-reloads through public HMR without duplicate Settings, subscriptions, or styles', async () => {
    const sources: Array<EventTarget & { closed: boolean }> = []
    class Source extends EventTarget {
      closed = false
      constructor() { super(); sources.push(this) }
      close(): void { this.closed = true }
    }
    vi.stubGlobal('EventSource', Source)
    const modules = createModules()
    const renderer = await modules.import(`${rendererId}/client`) as typeof import('@deepseek-ai/dsh-client-ui-renderer/client')
    const locales = await modules.import(`${localeId}/client`) as typeof import('@deepseek-ai/dsh-client-locale/client')
    const hmr = await modules.import(`${hmrId}/client`) as typeof import('@deepseek-ai/dsh-client-hmr/client')
    const ctx = new Cordis.Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(renderer.SlotRegistry).await()
    const locale = new locales.LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const remote = provideRemote(ctx)
    function Root({ renderSlot }: Slots.PropsRuntime<'root'> & Slots.PropsRenderSlots<'settings.section' | 'settings.models.footer'>) {
      return React.createElement('div', null, renderSlot('settings.section', { close: () => {} }), renderSlot('settings.models.footer', {}))
    }
    ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' }, 'settings.models.footer': { kind: 'list', scope: 'root' } } }, Root)
    await ctx.plugin(Loader).await()
    // Loader's public Node declaration omits the Client adapter documented by ClientModuleSystem.
    ctx.loader.internal = modules as unknown as NonNullable<Loader['internal']>
    ctx.provide('modules', modules)
    const hmrFiber = ctx.plugin(hmr)
    await hmrFiber.await()
    const entryId = await ctx.loader.create({ name: id })
    await ctx.loader.await()
    const entry = ctx.loader.resolve(entryId)
    const firstFiber = entry.fiber
    const firstStyles = [...document.querySelectorAll(`style[data-plugin="${id}"]`)]
    expect(firstStyles.length).toBeGreaterThan(0)
    expect(ctx.slots.entries('settings.section').map(item => item.options.id)).toEqual(['account-pool'])
    expect(ctx.slots.entries('settings.models.footer').map(item => item.options.id)).toEqual(['account-pool'])
    const firstFace = (ctx.slots.entries('settings.section')[0]!.inject as unknown as () => AccountPoolInjected)()
    await vi.waitFor(() => expect(firstFace.hooks.accountPool.getSnapshot()).toEqual({ state: 'ready', accounts: [] }))
    expect(locale.bind('accountPool')('settingsNav')).toBe('Account pool')
    expect(remote.listeners.size).toBe(1)

    sources[0]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'rebuilt', id, rev: '2' }) }))
    await vi.waitFor(() => expect(remote.mount).toHaveBeenCalledTimes(2))
    await entry.fiber?.await()
    expect(entry.fiber).not.toBe(firstFiber)
    expect(remote.stopped).toHaveBeenCalledTimes(1)
    expect(remote.unmounted).toHaveBeenCalledTimes(1)
    expect(remote.listeners.size).toBe(1)
    expect(firstStyles.every(style => !style.isConnected)).toBe(true)
    expect(document.querySelectorAll(`style[data-plugin="${id}"]`)).toHaveLength(firstStyles.length)
    expect(ctx.slots.entries('settings.section').map(item => item.options.id)).toEqual(['account-pool'])
    expect(ctx.slots.entries('settings.models.footer').map(item => item.options.id)).toEqual(['account-pool'])

    await ctx.loader.remove(entryId)
    expect(ctx.slots.entries('settings.section')).toEqual([])
    expect(ctx.slots.entries('settings.models.footer')).toEqual([])
    expect(ctx.get('remote.accountPool')).toBeUndefined()
    expect(locale.bind('accountPool')('settingsNav')).toBe('settingsNav')
    expect(remote.listeners.size).toBe(0)
    expect(remote.stopped).toHaveBeenCalledTimes(2)
    expect(remote.unmounted).toHaveBeenCalledTimes(2)
    await hmrFiber.dispose()
    expect(sources[0]!.closed).toBe(true)
  })
})
