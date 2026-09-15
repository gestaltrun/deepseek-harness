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

/** Product packages Desktop distributes, including the plugins its bundles select. */
const PRODUCT_PACKAGES = [
  '@gestaltrun/dsh-model-center',
  '@gestaltrun/dsh-im-runtime',
  '@gestaltrun/dsh-api-im',
  '@gestaltrun/dsh-ui-im',
  '@gestaltrun/dsh-im-bundle',
] as const

const SOURCE_SCOPE = '@gestaltrun/dsh-'
const PRODUCT_VERSION = /^\d+\.\d+\.\d+-gestaltrun\.\d+$/u

interface ProductManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly dsh?: { readonly bundle?: { readonly patch?: unknown; readonly desktopPatch?: unknown } }
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

function bundlePatches(manifest: ProductManifest): string {
  const bundle = manifest.dsh?.bundle
  return JSON.stringify([bundle?.patch, bundle?.desktopPatch])
}

function readProductArtifact(root: string, directory: string, commit: string, name: string): ProductArtifact {
  const source = JSON.parse(readFileSync(join(root, 'product', name.slice(SOURCE_SCOPE.length), 'package.json'), 'utf8')) as ProductManifest
  if (source.name !== name || typeof source.version !== 'string' || !PRODUCT_VERSION.test(source.version)) {
    throw new Error(`product: invalid ${name} package identity`)
  }
  const filename = `${name.replace('@', '').replace('/', '-')}-${source.version}.tgz`
  const path = join(directory, filename)
  const packed = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' })) as ProductManifest
  if (packed.name !== source.name || packed.version !== source.version || bundlePatches(packed) !== bundlePatches(source)) {
    throw new Error(`product: archive differs from the selected ${name} package`)
  }
  for (const spec of Object.values({ ...packed.dependencies, ...packed.peerDependencies, ...packed.optionalDependencies })) {
    if (/^(?:file|link|workspace):/u.test(spec)) throw new Error('product: archive contains a development dependency')
  }
  return { name, version: source.version, filename,
    integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`,
    repository: 'gestaltrun/deepseek-harness', commit }
}

/**
 * Verify every distributed product archive and bind its bytes to a source revision.
 * @param root - Product source checkout.
 * @param directory - Directory containing built or retained package archives.
 * @param commit - Exact revision recorded for this candidate.
 * @returns Immutable product artifact identities.
 */
export function readProductArtifacts(root: string, directory: string, commit: string): readonly ProductArtifact[] {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('product: invalid source revision')
  return PRODUCT_PACKAGES.map(name => readProductArtifact(root, directory, commit, name))
}
