/** The shipped bundle changes composition through the official patch interpreter. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
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
})
