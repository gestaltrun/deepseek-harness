/** Resolve runtime application artwork for the Desktop shell. */

import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/** Inputs needed to select runtime artwork without replacing packaged macOS resources. */
export interface DesktopIconOptionsInput {
  readonly platform: NodeJS.Platform
  readonly packaged: boolean
  readonly appPath: string
  readonly resourcesPath: string
  readonly setDockIcon: (path: string) => void
}

/** BrowserWindow fields contributed by the Desktop application icon. */
export type DesktopIconOptions = Pick<BrowserWindowConstructorOptions, 'icon'>

/**
 * Apply the development macOS Dock icon and select the Windows window icon.
 * @param input - Platform and application paths from Electron.
 * @returns BrowserWindow icon fields for the active platform.
 */
export function desktopIconOptions(input: DesktopIconOptionsInput): DesktopIconOptions {
  const icon = input.packaged
    ? join(input.resourcesPath, 'icon.png')
    : join(input.appPath, 'build', 'icon.png')
  if (input.platform === 'darwin') {
    if (!input.packaged) input.setDockIcon(icon)
    return {}
  }
  if (input.platform === 'win32') return { icon }
  return {}
}
