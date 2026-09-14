/** Desktop defaults for installed community plugins. */
import type { composeEntries } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/**
 * Set launch defaults after composition while preserving explicit values and config expressions.
 * @param entries - Bundle and user profile entries selected for this Desktop Host.
 * @returns Patches for installed plugins with no explicit launch choice.
 */
export function desktopCommunityDefaults(entries: ReturnType<typeof composeEntries>): PatchOptions[] {
  return entries.flatMap((entry) => {
    if (entry.name !== '@gestaltrun/dsh-ego-browser' || typeof entry.id !== 'string') return []
    const config = entry.config as Record<string, unknown> | undefined
    if (config?.egoCliArgs !== undefined || typeof config?.__jsExpr === 'string') return []
    return [{ id: entry.id, name: entry.name, config: { ...config, egoCliArgs: '--headless' } }]
  })
}
