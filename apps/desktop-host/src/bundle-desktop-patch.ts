/**
 * Load a profile bundle's Desktop-only overlay when its manifest declares one.
 * @module @deepseek-ai/dsh-desktop-host/bundle-desktop-patch
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInside(root: string, target: string): boolean {
  const canonicalRoot = realpathSync(root)
  const canonicalTarget = realpathSync(target)
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(canonicalRoot + sep)
}

/**
 * Load one bundle's Desktop overlay, or an empty layer when the manifest does not declare one.
 * @param packageDir - Bundle package directory.
 * @param packageName - Bundle package name for diagnostics.
 * @returns One patch layer, or an empty array when no overlay is declared.
 */
export function loadBundleDesktopPatches(packageDir: string, packageName: string): PatchOptions[][] {
  const value: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const dsh = isRecord(value) ? value.dsh : undefined
  const bundle = isRecord(dsh) ? dsh.bundle : undefined
  const declared = isRecord(bundle) ? bundle.desktopPatch : undefined
  if (declared === undefined) return []
  if (typeof declared !== 'string' || declared === '') {
    throw new Error(`dsh desktop: profile bundle ${JSON.stringify(packageName)} declares an invalid Desktop patch`)
  }
  const path = resolve(packageDir, declared)
  if (!isInside(packageDir, path)) {
    throw new Error(`dsh desktop: profile bundle ${JSON.stringify(packageName)} declares a Desktop patch outside its package`)
  }
  return [loadOverlayPatches('dsh desktop', path)]
}
