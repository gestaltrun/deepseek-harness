/** The shipped bundle changes composition through the official patch interpreter. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { expect, it } from 'vitest'

it('selects one product provider and removes the official Models UI from the active composition', () => {
  const patches = load(readFileSync(resolve(import.meta.dirname, '../cordis.patch.yml'), 'utf8')) as PatchOptions[]
  const warnings: string[] = []
  const entries = applyEntryPatches([
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' },
    { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models' },
  ], patches, message => warnings.push(message))
  expect(warnings).toEqual([])
  expect(entries.filter(entry => !entry.disabled).map(entry => entry.name))
    .toEqual(['@deepseek-ai/dsh-llm', '@gestaltrun/dsh-model-center'])
  expect(entries.find(entry => entry.id === 'gestaltrun-model-center')?.config).toBeUndefined()
})

it('lets the account-pool bundle reserve its route on the existing Model Center row', () => {
  const modelPatches = load(readFileSync(resolve(import.meta.dirname, '../cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const poolPatches = load(readFileSync(resolve(import.meta.dirname, '../../packages/account-pool/cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const entries = applyEntryPatches(applyEntryPatches([
    { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' },
    { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models' },
  ], modelPatches), poolPatches)
  expect(entries.find(entry => entry.id === 'gestaltrun-model-center')).toMatchObject({
    name: '@gestaltrun/dsh-model-center',
    config: { managedProviders: [{ id: 'gestalt-account-pool', displayName: 'Account pool' }] },
  })
  expect(entries.some(entry => entry.id === 'gestaltrun-account-pool-local')).toBe(true)
})
