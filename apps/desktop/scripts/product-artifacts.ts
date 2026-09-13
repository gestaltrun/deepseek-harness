/** Verify product-owned npm archives before adding them to a Desktop release. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Exact product package bytes and the repository revision that owns them. */
export interface ProductArtifact {
  readonly name: string
  readonly version: string
  readonly filename: string
  readonly integrity: string
  readonly repository: string
  readonly commit: string
}

/**
 * Verify the named Model Center archive and bind its bytes to a source revision.
 * @param root - Product source checkout.
 * @param directory - Directory containing built or retained package archives.
 * @param commit - Exact revision recorded for this candidate.
 * @returns Immutable product artifact identities.
 */
export function readProductArtifacts(root: string, directory: string, commit: string): readonly ProductArtifact[] {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('product: invalid source revision')
  const source = JSON.parse(readFileSync(join(root, 'product/model-center/package.json'), 'utf8')) as { name: string; version: string }
  if (source.name !== '@gestaltrun/dsh-model-center' || !/^\d+\.\d+\.\d+-gestaltrun\.\d+$/u.test(source.version)) {
    throw new Error('product: invalid Model Center package identity')
  }
  const filename = `gestaltrun-dsh-model-center-${source.version}.tgz`
  const path = join(directory, filename)
  const packed = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' })) as {
    name: string
    version: string
    dsh?: { bundle?: { patch?: string } }
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  if (packed.name !== source.name || packed.version !== source.version || packed.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error('product: archive differs from the selected Model Center bundle')
  }
  for (const spec of Object.values({ ...packed.dependencies, ...packed.peerDependencies, ...packed.optionalDependencies })) {
    if (/^(?:file|link|workspace):/u.test(spec)) throw new Error('product: archive contains a development dependency')
  }
  return [{ name: source.name, version: source.version, filename,
    integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`,
    repository: 'gestaltrun/deepseek-harness', commit }]
}
