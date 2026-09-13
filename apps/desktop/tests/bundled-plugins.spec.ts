import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopProjectManager, desktopRuntimeBundles } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { readDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
const BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const PLUGIN = '@gestaltrun/dsh-web-all'
const hooks = { beforeChange: async () => {}, afterChange: async () => {} }

function fixture(): { manager: DesktopProjectManager; addBundledPlugin: () => void; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bundled-plugins-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const descriptor = runtimeFixture(runtime)
  const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, 'home')),
    { node: process.execPath, pnpm: join(root, 'must-not-run-pnpm.mjs'), dsh: runtime })
  return {
    manager, runtime,
    addBundledPlugin: () => {
      const path = writePackage(join(runtime, 'node_modules'), PLUGIN, {
        version: '0.3.21-gestaltrun.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
      writeFileSync(join(path, 'cordis.patch.yml'), '[]\n')
      writeFileSync(join(runtime, 'package.json'), JSON.stringify({
        type: 'module', dsh: { profile: { bundles: [...BASE, PLUGIN] } },
      }))
      writeDesktopRuntime(runtime, descriptor.release,
        [...descriptor.sharedPackages.map(entry => entry.name), PLUGIN], process, [...BASE, PLUGIN])
    },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Desktop bundled community plugins', () => {
  it('enables the shipped plugin offline and keeps activation editable without replacing its files', async () => {
    const { manager, addBundledPlugin } = fixture()
    addBundledPlugin()
    await manager.applyRelease()
    expect(manager.listPlugins()).toEqual([{ name: PLUGIN, version: '0.3.21-gestaltrun.0', enabled: true, bundled: true }])
    await manager.mutate({ type: 'plugin-toggle', name: PLUGIN, enabled: false }, hooks)
    expect(manager.listPlugins()[0]?.enabled).toBe(false)
    await expect(manager.applyRelease()).resolves.toBe(false)
    await manager.mutate({ type: 'plugin-toggle', name: PLUGIN, enabled: true }, hooks)
    expect(manager.listPlugins()[0]?.enabled).toBe(true)
    await expect(manager.mutate({ type: 'plugin-remove', name: PLUGIN }, hooks)).rejects.toThrow('not installed')
    expect(manager.listPlugins()[0]?.enabled).toBe(true)
  })

  it('adds a newly shipped bundle once on upgrade, preserving user overlays and subsequent disable-all', async () => {
    const { manager, addBundledPlugin } = fixture()
    await manager.applyRelease()
    const overlay = join(manager.paths.profile, 'cordis.patch.yml')
    const text = '# user-owned overrides\n[]\n'
    writeFileSync(overlay, text)
    addBundledPlugin()
    await manager.applyRelease()
    expect(manager.listPlugins()[0]?.enabled).toBe(true)
    expect(readFileSync(overlay, 'utf8')).toBe(text)
    await manager.mutate({ type: 'plugins-disable-all' }, hooks)
    await manager.applyRelease()
    expect(manager.listPlugins()[0]?.enabled).toBe(false)
    expect(readFileSync(overlay, 'utf8')).toBe(text)
  })

  it('rejects malformed runtime defaults instead of silently booting a different composition', () => {
    const { runtime } = fixture()
    expect(desktopRuntimeBundles(readDesktopRuntime(runtime))).toEqual(BASE)
    const descriptor = readDesktopRuntime(runtime)
    writeFileSync(join(runtime, 'desktop-runtime.json'), JSON.stringify({ ...descriptor, bundles: [PLUGIN, ...BASE] }))
    expect(() => desktopRuntimeBundles(readDesktopRuntime(runtime))).toThrow('invalid product bundle roots')
  })
})
