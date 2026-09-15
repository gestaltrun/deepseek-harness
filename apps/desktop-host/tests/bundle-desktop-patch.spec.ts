/** A Desktop bundle overlay must live inside its own package and load only when declared. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadBundleDesktopPatches } from '../src/bundle-desktop-patch.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function bundlePackage(manifest: Record<string, unknown>, overlay?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundle-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  if (overlay !== undefined) writeFileSync(join(root, 'desktop.patch.yml'), overlay)
  return root
}

it('returns an empty layer when the bundle declares no Desktop overlay', () => {
  const root = bundlePackage({ name: '@example/plain', dsh: { bundle: { patch: './cordis.patch.yml' } } })
  expect(loadBundleDesktopPatches(root, '@example/plain')).toEqual([])
})

it('parses the declared Desktop overlay into one patch layer', () => {
  const overlay = '- id: some-row\n  disabled: true\n'
  const root = bundlePackage({ name: '@example/native', dsh: { bundle: { patch: './cordis.patch.yml', desktopPatch: './desktop.patch.yml' } } }, overlay)
  const layers = loadBundleDesktopPatches(root, '@example/native')
  expect(layers).toHaveLength(1)
  expect(layers[0]).toEqual([{ id: 'some-row', disabled: true }])
})

it('rejects an overlay path outside the bundle package', () => {
  const outside = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundle-outside-'))
  roots.push(outside)
  writeFileSync(join(outside, 'desktop.patch.yml'), '')
  const root = bundlePackage({ name: '@example/escape', dsh: { bundle: { patch: './cordis.patch.yml', desktopPatch: join(outside, 'desktop.patch.yml') } } })
  expect(() => loadBundleDesktopPatches(root, '@example/escape')).toThrow('outside its package')
})

it('rejects a blank overlay declaration', () => {
  const root = bundlePackage({ name: '@example/blank', dsh: { bundle: { patch: './cordis.patch.yml', desktopPatch: '' } } })
  expect(() => loadBundleDesktopPatches(root, '@example/blank')).toThrow('invalid Desktop patch')
})

it('parses the shipped im-bundle Desktop overlay to the native picker rows', () => {
  const root = new URL('../../../product/im-bundle', import.meta.url).pathname
  const layers = loadBundleDesktopPatches(root, '@gestaltrun/dsh-im-bundle')
  expect(layers).toHaveLength(1)
  expect(layers[0]).toEqual([
    { id: 'gestaltrun-im-directory-picker-browse', disabled: true },
    { id: 'gestaltrun-im-ui', config: { directoryPicker: 'native' } },
  ])
})
