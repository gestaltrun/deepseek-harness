// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as Jsx from 'react/jsx-runtime'
import * as Cordis from '@deepseek-ai/cordis'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import * as Ui from '../src/client/index.ts'

const require = createRequire(import.meta.url)

function renderer(): { SlotRegistry: new (ctx: Cordis.Context) => SlotRegistry } {
  const root = dirname(require.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json'))
  const modules: Record<string, unknown> = { react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react/jsx-runtime': Jsx, '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-ui-slots': Slots }
  let loaded: unknown
  new Function('window', readFileSync(join(root, 'lib/client.js'), 'utf8'))({ __ModuleLoader__: { load: (entry: { factory: (request: (name: string) => unknown) => unknown }) => {
    loaded = entry.factory(name => {
      if (!(name in modules)) throw new Error(`Missing renderer module ${name}`)
      return modules[name]
    })
  } } })
  return loaded as ReturnType<typeof renderer>
}

describe('product IM slot ownership', () => {
  it('retains the original browser child and restores the browser when the product unloads', async () => {
    const ctx = new Cordis.Context()
    const { SlotRegistry } = renderer()
    new SlotRegistry(ctx)
    const root = ctx.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    } } as never, (() => null) as never)
    const originalBrowser = () => null
    const original = ctx.slots.register({ name: 'sidebar.workspaces', children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } } } as never, originalBrowser as never)
    const tabs = new Map<string, unknown>()
    const snapshot = { getSnapshot: () => ({ phase: 'ready', value: { revision: 0, accounts: [], routes: [], simulationTargets: [] } }), subscribe: () => () => {} }
    const dictionaries = new Map()
    const providers = ctx.plugin({ name: 'im-ui-registration-inputs', apply(owner: Cordis.Context) {
      for (const [key, value] of Object.entries({
        locale: { register: (key: string, value: unknown) => { dictionaries.set(key, value); return () => { dictionaries.delete(key) } }, bind: () => (key: string) => key },
        im: { configuration: snapshot, accountCandidates: snapshot },
        sidebarRightTabs: { register: (definition: { id: string }) => { tabs.set(definition.id, definition); return () => { tabs.delete(definition.id) } } },
        uiWorkspace: {}, sessions: { searchResultLimit: 20 }, workspaces: {}, remote: { $host: { isLoopback: true } }, layout: {},
      })) owner.reflect.provide(key, value)
    } })
    try {
      await providers
      const product = ctx.plugin(Ui, { directoryPicker: 'native' })
      await product
      expect(ctx.slots.entries('settings.section').map(entry => entry.options.id)).toContain('im-accounts')
      expect(ctx.slots.entries('sidebar.workspaces').map(entry => entry.options.priority ?? 0)).toEqual([-10, 0])
      expect(ctx.slots.entries('sidebar.workspaces.imSettings')).toHaveLength(2)
      expect(ctx.slots.entries('sidebar.workspaces.imDirectoryFlow')).toHaveLength(1)
      expect(tabs.has('@gestaltrun/dsh-ui-im/conversation')).toBe(true)
      await product.dispose()
      expect(ctx.slots.entries('sidebar.workspaces')).toHaveLength(1)
      expect(ctx.slots.entries('sidebar.workspaces')[0]?.component).toBe(originalBrowser)
      expect(ctx.slots.entries('sidebar.workspaces.imSettings')).toHaveLength(0)
      expect(tabs.size).toBe(0)
      const flow = ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow' } as never, (() => null) as never)
      flow()
    } finally {
      original(); root()
      await ctx.fiber.dispose()
    }
  })
})
