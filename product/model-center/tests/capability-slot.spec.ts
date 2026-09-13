/** Legacy and product capability entries coexist without rendering two editors. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, expect, it } from 'vitest'
import { registerCapabilityOwner } from '../src/client/capability-slot.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it.each(['legacy-first', 'product-first'])('uses the inline editor with %s registration and restores the legacy panel on unload', async order => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null)
  ctx.slots.register({ name: 'settings.section', id: 'models', children: {
    'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
  } }, () => null)
  const LegacyPanel = () => 'legacy capability panel'
  const OtherProviderPanel = () => 'other provider extension'
  const registerLegacy = () => ctx.slots.register({ name: 'settings.models.provider-card', key: 'llm-pi-ai' }, LegacyPanel)
  ctx.slots.register({ name: 'settings.models.provider-card', key: 'llm-deepseek' }, OtherProviderPanel)
  if (order === 'legacy-first') registerLegacy()
  const product = await ctx.plugin({ inject: ['slots'], apply: registerCapabilityOwner })
  if (order === 'product-first') registerLegacy()
  const winners = () => ctx.slots.entriesOfSlot('settings.models.provider-card')
  expect(winners().filter(entry => entry.options.key === 'llm-pi-ai')).toHaveLength(1)
  expect(winners().some(entry => entry.component === LegacyPanel)).toBe(false)
  expect(winners().some(entry => entry.component === OtherProviderPanel)).toBe(true)
  await product.dispose()
  expect(winners().some(entry => entry.component === LegacyPanel)).toBe(true)
})
