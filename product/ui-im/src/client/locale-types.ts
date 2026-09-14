/** Locale namespaces owned by the IM settings and workspace presentation. */
import type { ImKey } from './locales.ts'
import type { DirectoryKey } from './directory/locales.ts'
import type { WorkspaceKey } from './workspace/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account, takeover, simulation, and conversation copy. */
    'settings.im': ImKey
    'gestaltrun.imDirectory': DirectoryKey
    /** Product workspace browser and settings entry copy. */
    'gestaltrun.imWorkspace': WorkspaceKey
  }
}
