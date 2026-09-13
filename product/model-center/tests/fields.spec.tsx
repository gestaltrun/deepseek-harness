// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelCapabilitiesFields, modelCapabilityError } from '../src/client/ModelCapabilitiesFields.tsx'
import { zh } from '../src/client/locales.ts'
import { validateDeepSeekModels } from '../src/client/DeepSeekModelsEditor.tsx'

afterEach(cleanup)

function Editor() {
  const [model, setModel] = useState<Record<string, unknown>>({ id: 'vision', input: ['text', 'image'],
    reasoningEfforts: { off: null, low: 'low', high: 'high' }, defaultReasoningLevel: 'high', opaque: { retain: true } })
  return <><ModelCapabilitiesFields model={model} disabled={false} t={key => zh[key]} onChange={change => setModel(current => {
    const next = { ...current, ...change }
    for (const key of Object.keys(change)) if (change[key] === undefined) delete next[key]
    return next
  })} /><output data-testid="model">{JSON.stringify(model)}</output><button disabled={modelCapabilityError(model) !== undefined}>Save</button></>
}

describe('model capability fields', () => {
  it('edits image input without dropping unrelated configuration', () => {
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: '输入类型 图片' }))
    expect(JSON.parse(screen.getByTestId('model').textContent!)).toMatchObject({ input: ['text'], opaque: { retain: true } })
  })

  it('requires a valid replacement when the selected default effort is removed', () => {
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: '支持的思考档位 高' }))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '默认思考档位' }), { target: { value: 'low' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    expect(JSON.parse(screen.getByTestId('model').textContent!).defaultReasoningLevel).toBe('low')
  })

  it('can restore inheritance and preserves explicit wire mappings', () => {
    render(<Editor />)
    fireEvent.change(screen.getByRole('combobox', { name: '默认思考档位' }), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('请求中的档位值 high'), { target: { value: 'thorough' } })
    const result = JSON.parse(screen.getByTestId('model').textContent!)
    expect(result).not.toHaveProperty('defaultReasoningLevel')
    expect(result.reasoningEfforts.high).toBe('thorough')
  })

  it('rejects invalid capability drafts through the provider form validator', () => {
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: false, defaultReasoningLevel: 'high' }])?.key).toBe('modelDefaultInvalid')
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: { high: '' } }])?.key).toBe('modelReasoningInvalid')
  })
})
