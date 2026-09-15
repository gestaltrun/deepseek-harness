/** Model Center uses the shared Desktop bundle upgrade mechanism. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginProfile, reconcileDesktopBundles } from '../src/project-manager.ts'
import { DESKTOP_PRODUCT_BUNDLES } from '../src/product-profile.ts'
const roots: string[] = []
const BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@gestaltrun/dsh-web-all']
const MODEL = '@gestaltrun/dsh-model-center'
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function profile() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-center-profile-'))
  roots.push(dir)
  createPluginProfile(dir, BASE)
  const file = join(dir, 'package.json')
  const read = () => JSON.parse(readFileSync(file, 'utf8')) as { dsh: { profile: { bundles: string[]; builtinBundles: string[] } } }
  return { dir, file, read }
}
describe('Desktop model-center profile', () => {
  it('adds Model Center while retaining the existing community bundle', () => {
    const p = profile()
    reconcileDesktopBundles(p.dir, [...BASE, MODEL])
    expect(p.read().dsh.profile.bundles).toEqual([...BASE, MODEL])
    expect(p.read().dsh.profile.builtinBundles).toEqual([...BASE, MODEL])
  })
  it('retains a disabled Model Center across subsequent release reconciliation', () => {
    const p = profile()
    reconcileDesktopBundles(p.dir, [...BASE, MODEL])
    const data = p.read()
    data.dsh.profile.bundles = [...BASE, '@example/user-plugin']
    writeFileSync(p.file, JSON.stringify(data))
    reconcileDesktopBundles(p.dir, [...BASE, MODEL])
    expect(p.read().dsh.profile.bundles).toEqual([...BASE, '@example/user-plugin'])
  })
})

it('activates the account pool through the existing product bundle reconciliation', () => {
  const p = profile()
  reconcileDesktopBundles(p.dir, [...BASE, ...DESKTOP_PRODUCT_BUNDLES])
  expect(p.read().dsh.profile.bundles).toEqual([...BASE, MODEL, '@gestaltrun/dsh-account-pool'])
})
