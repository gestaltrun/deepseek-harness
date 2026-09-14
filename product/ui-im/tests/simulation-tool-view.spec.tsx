// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SimulationToolView, SIMULATION_TOOL_NAMES } from '../src/client/SimulationToolView.tsx'
import { makeTranslate } from './helpers.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function running(name: string): ToolCallBlock {
  return { callId: 'call-1', name, argsRaw: '{"text":"hello"}', turn: 1, step: 1, time: 1, subCalls: [] }
}

describe('IM simulation Tool presentation', () => {
  it.each(SIMULATION_TOOL_NAMES)('marks %s as an isolated simulation call from the frozen call slice', name => {
    const view = render(<SimulationToolView toolName={name} block={running(name)} t={makeTranslate(zh)} />)
    const card = view.container.querySelector(`[data-im-simulation-tool="${name}"]`)
    expect(card).not.toBeNull()
    expect(screen.getByText(zh.simulationToolBadge)).toBeTruthy()
    fireEvent.click(card!.querySelector('summary')!)
    expect(screen.getByText(/仅.*模拟/u)).toBeTruthy()
    expect(screen.getByText(/"text": "hello"/u)).toBeTruthy()
    expect(screen.getByText(zh.simulationToolPending)).toBeTruthy()
  })

  it('shows the durable result and failure without implying a real IM send', () => {
    const block: ToolCallBlock = {
      kind: 'tool-result', seq: 2, time: 2, callId: 'call-1', call: { name: 'im_sim_send_as_member', argsRaw: '{' },
      callTime: 1, content: [{ type: 'text', text: 'Host rejected this simulation input' }], isError: true, subCalls: [],
    }
    const view = render(<SimulationToolView toolName="im_sim_send_as_member" block={block} t={makeTranslate(en)} />)
    fireEvent.click(view.container.querySelector('summary')!)
    expect(screen.getByText(en.simulationToolFailed)).toBeTruthy()
    expect(screen.getByText('{')).toBeTruthy()
    expect(screen.getByText('Host rejected this simulation input')).toBeTruthy()
    expect(screen.getByText(en.simulationToolIsolationSend)).toBeTruthy()
  })
})
