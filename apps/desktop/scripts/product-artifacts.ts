/** Verify product-owned npm archives before adding them to a Desktop release. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_PRODUCT_BUNDLES } from '../src/product-profile.ts'

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
 * Verify the selected product archives and bind their bytes to a source revision.
 * @param root - Product source checkout.
 * @param directory - Directory containing built or retained package archives.
 * @param commit - Exact revision recorded for this candidate.
 * @returns Immutable product artifact identities.
 */
export function readProductArtifacts(root: string, directory: string, commit: string): readonly ProductArtifact[] {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('product: invalid source revision')
  const value: unknown = JSON.parse(readFileSync(join(root, 'product/bundles.json'), 'utf8'))
  if (!Array.isArray(value)) throw new Error('product: bundle catalog must be an array')
  const entries = value.map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || !('name' in entry) || !('directory' in entry)
      || typeof entry.name !== 'string' || typeof entry.directory !== 'string'
      || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(entry.directory)) {
      throw new Error('product: bundle catalog must contain names and relative product directories')
    }
    return { name: entry.name, directory: entry.directory }
  })
  const names = new Set(entries.map(entry => entry.name))
  if (entries.length !== DESKTOP_PRODUCT_BUNDLES.length || names.size !== entries.length
    || !DESKTOP_PRODUCT_BUNDLES.every(name => names.has(name))) {
    throw new Error('product: catalog differs from Desktop product bundles')
  }
  return DESKTOP_PRODUCT_BUNDLES.map((name) => {
    const entry = entries.find(candidate => candidate.name === name)
    if (entry === undefined) throw new Error(`product: missing source for ${name}`)
    const source = JSON.parse(readFileSync(join(root, 'product', entry.directory, 'package.json'), 'utf8')) as { name: string; version: string }
    if (source.name !== name || !/^\d+\.\d+\.\d+-gestaltrun\.\d+$/u.test(source.version)) {
      throw new Error(`product: invalid package identity for ${name}`)
    }
    const filename = `${name.slice(1).replace('/', '-')}-${source.version}.tgz`
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
      throw new Error(`product: archive differs from selected bundle ${name}`)
    }
    for (const spec of Object.values({ ...packed.dependencies, ...packed.peerDependencies, ...packed.optionalDependencies })) {
      if (/^(?:file|link|workspace):/u.test(spec)) throw new Error('product: archive contains a development dependency')
    }
    return { name: source.name, version: source.version, filename,
      integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`,
      repository: 'gestaltrun/deepseek-harness', commit }
  })
}
