/** The product model row owns pi-ai capability editing while it is active. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'

/** Capabilities are rendered inline by ModelCapabilitiesFields, so no second panel is needed. */
function InlineCapabilities(): null { return null }

/**
 * Shadow the legacy pi-ai capability panel and restore it when the product unloads.
 * @param ctx - Product client context owning the slot contribution.
 */
export function registerCapabilityOwner(ctx: Context): void {
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-pi-ai', priority: -10,
  }, InlineCapabilities))
}
