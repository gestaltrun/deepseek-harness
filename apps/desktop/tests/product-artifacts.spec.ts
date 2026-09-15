/** Product archive identities must match both the source manifest and packed contents. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readProductArtifacts } from '../scripts/product-artifacts.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const source = { name: '@gestaltrun/dsh-model-center', version: '0.1.0-gestaltrun.0' }

function fixture(packed: Record<string, unknown> = source) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-artifact-'))
  roots.push(root)
  const entries = [
    { name: source.name, directory: 'model-center' },
    { name: '@gestaltrun/dsh-account-pool', directory: 'packages/account-pool' },
  ]
  mkdirSync(join(root, 'product'), { recursive: true })
  mkdirSync(join(root, 'package'))
  writeFileSync(join(root, 'product/bundles.json'), JSON.stringify(entries))
  for (const entry of entries) {
    const manifest = { ...source, name: entry.name }
    mkdirSync(join(root, 'product', entry.directory), { recursive: true })
    writeFileSync(join(root, 'product', entry.directory, 'package.json'), JSON.stringify(manifest))
    const selected = entry.name === source.name ? packed : manifest
    writeFileSync(join(root, 'package/package.json'), JSON.stringify({ ...selected, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    execFileSync('tar', ['-czf', join(root, `${entry.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`), '-C', root, 'package'])
  }
  return root
}

it('records a product archive separately from the community forks', () => {
  const root = fixture()
  const artifacts = readProductArtifacts(root, root, 'a'.repeat(40))
  expect(artifacts.map(artifact => artifact.name)).toEqual([source.name, '@gestaltrun/dsh-account-pool'])
  const artifact = artifacts[0]
  expect(artifact).toMatchObject({
    ...source, repository: 'gestaltrun/deepseek-harness', commit: 'a'.repeat(40),
  })
  expect(artifact?.integrity).toMatch(/^sha512-/u)
})

it('rejects a stale archive under the expected filename', () => {
  const root = fixture({ ...source, version: '0.1.0-gestaltrun.9' })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('archive differs')
})

it('rejects unpublished dependencies in a product archive', () => {
  const root = fixture({ ...source, peerDependencies: { '@deepseek-ai/cordis': 'link:../local' } })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('development dependency')
})

it('rejects a product catalog that omits an enabled Desktop bundle', () => {
  const root = fixture()
  writeFileSync(join(root, 'product/bundles.json'), JSON.stringify([{ name: source.name, directory: 'model-center' }]))
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('Desktop product bundles')
})
