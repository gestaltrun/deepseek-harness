/** Product archive identities must match both the source manifest and packed contents. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readProductArtifacts } from '../scripts/product-artifacts.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const VERSION = '0.1.0-gestaltrun.0'
const PRODUCT = [
  { directory: 'model-center', name: '@gestaltrun/dsh-model-center', dsh: { bundle: { patch: './cordis.patch.yml' } } },
  { directory: 'im-runtime', name: '@gestaltrun/dsh-im-runtime', dsh: { engines: { dsh: '>=0.1.5-rc.2' } } },
  { directory: 'api-im', name: '@gestaltrun/dsh-api-im', dsh: { client: { platform: 'web' } } },
  { directory: 'ui-im', name: '@gestaltrun/dsh-ui-im', dsh: { client: { platform: 'web' } } },
  { directory: 'im-bundle', name: '@gestaltrun/dsh-im-bundle',
    dsh: { bundle: { patch: './cordis.patch.yml', desktopPatch: './desktop.patch.yml' } } },
] as const

function archiveName(name: string): string {
  return `${name.replace('@', '').replace('/', '-')}-${VERSION}.tgz`
}

function fixture(packedOverrides: Readonly<Record<string, Record<string, unknown>>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-artifact-'))
  roots.push(root)
  for (const entry of PRODUCT) {
    const source = { name: entry.name, version: VERSION, dsh: entry.dsh }
    mkdirSync(join(root, 'product', entry.directory), { recursive: true })
    writeFileSync(join(root, 'product', entry.directory, 'package.json'), JSON.stringify(source))
    const staging = join(root, 'staging', entry.directory)
    mkdirSync(join(staging, 'package'), { recursive: true })
    writeFileSync(join(staging, 'package/package.json'), JSON.stringify({ ...source, ...packedOverrides[entry.name] }))
    execFileSync('tar', ['-czf', join(root, archiveName(entry.name)), '-C', staging, 'package'])
  }
  return root
}

it('records every distributed product archive separately from the community forks', () => {
  const root = fixture()
  const artifacts = readProductArtifacts(root, root, 'a'.repeat(40))
  expect(artifacts.map(artifact => artifact.name)).toEqual(PRODUCT.map(entry => entry.name))
  expect(artifacts[0]).toMatchObject({
    name: '@gestaltrun/dsh-model-center', version: VERSION, filename: archiveName('@gestaltrun/dsh-model-center'),
    repository: 'gestaltrun/deepseek-harness', commit: 'a'.repeat(40),
  })
  for (const artifact of artifacts) expect(artifact.integrity).toMatch(/^sha512-/u)
})

it('rejects a stale archive under the expected filename', () => {
  const root = fixture({ '@gestaltrun/dsh-im-bundle': { version: '0.1.0-gestaltrun.9' } })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('archive differs')
})

it('rejects an archive that drops the declared Desktop overlay', () => {
  const root = fixture({ '@gestaltrun/dsh-im-bundle': { dsh: { bundle: { patch: './cordis.patch.yml' } } } })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('archive differs')
})

it('rejects unpublished dependencies in a product archive', () => {
  const root = fixture({ '@gestaltrun/dsh-api-im': { peerDependencies: { '@gestaltrun/dsh-im-runtime': 'workspace:^' } } })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('development dependency')
})
