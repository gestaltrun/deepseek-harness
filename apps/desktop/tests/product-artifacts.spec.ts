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
  mkdirSync(join(root, 'product/model-center'), { recursive: true })
  mkdirSync(join(root, 'package'))
  writeFileSync(join(root, 'product/model-center/package.json'), JSON.stringify(source))
  writeFileSync(join(root, 'package/package.json'), JSON.stringify({ ...packed, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  execFileSync('tar', ['-czf', join(root, 'gestaltrun-dsh-model-center-0.1.0-gestaltrun.0.tgz'), '-C', root, 'package'])
  return root
}

it('records a product archive separately from the community forks', () => {
  const root = fixture()
  expect(readProductArtifacts(root, root, 'a'.repeat(40))[0]).toMatchObject({
    ...source, repository: 'gestaltrun/deepseek-harness', commit: 'a'.repeat(40), integrity: expect.stringMatching(/^sha512-/u),
  })
})

it('rejects a stale archive under the expected filename', () => {
  const root = fixture({ ...source, version: '0.1.0-gestaltrun.9' })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('archive differs')
})

it('rejects unpublished dependencies in a product archive', () => {
  const root = fixture({ ...source, peerDependencies: { '@deepseek-ai/cordis': 'link:../local' } })
  expect(() => readProductArtifacts(root, root, 'a'.repeat(40))).toThrow('development dependency')
})
