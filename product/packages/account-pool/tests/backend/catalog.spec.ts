import { expect, it } from 'vitest'
import { parseAccountPoolCatalog, mergeAccountPoolCatalogs } from '../../src/llm/catalog.ts'
it('rejects malformed rows while preserving genuinely unknown capabilities and explicit wire reasoning', () => {
  expect(() => parseAccountPoolCatalog({ data: [null] })).toThrow('row is invalid')
  expect(() => parseAccountPoolCatalog({ data: [{ id: 42 }] })).toThrow('id is missing')
  expect(parseAccountPoolCatalog({ data: [] })).toEqual([])
  expect(parseAccountPoolCatalog({ data: [{ id: 'unknown' }] })).toEqual([{ id: 'unknown' }])
  const primary = parseAccountPoolCatalog({ data: [{ id: 'model', context_window: 128000,
    reasoning_efforts: [{ value: 'high' }, { value: 'ultra' }], default_reasoning_level: 'ultra' }] })
  const metadata = parseAccountPoolCatalog({ models: [{ id: 'model', context_length: 999,
    max_completion_tokens: 64000, supportedInputModalities: ['TEXT', 'IMAGE'] }] })
  expect(mergeAccountPoolCatalogs(primary, metadata)).toEqual([{ id: 'model', contextWindow: 128000,
    maxTokens: 64000, input: ['text', 'image'], reasoningEfforts: { high: 'high', max: 'ultra' }, defaultReasoningLevel: 'max' }])
  expect(parseAccountPoolCatalog({ models: [{ id: 'glm-5.3', thinking: { levels: ['low', 'high', 'max'] },
    supportedInputModalities: ['text', 'image'] }] })).toEqual([{
    id: 'glm-5.3', input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
  }])
})
