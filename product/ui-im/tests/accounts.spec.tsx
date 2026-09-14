// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImAccountSetupRequest, ImConfigurationState, ImAccountCandidatesState } from '@gestaltrun/dsh-api-im/client'
import { AccountsSection, type AccountsSectionProps } from '../src/client/AccountsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const configuration: ImConfigurationState = { phase: 'ready', value: { revision: 0, accounts: [], routes: [], simulationTargets: [] }, error: undefined }
const candidates: ImAccountCandidatesState = {
  dingtalk: { phase: 'ready', items: [{ platform: 'dingtalk', profile: 'employee-a', displayName: 'Employee A' }], error: undefined },
  wangwang: { phase: 'ready', items: [{ platform: 'wangwang', candidateId: 'merchant-a', displayName: 'Merchant A' }], error: undefined },
}

function props(overrides: Partial<AccountsSectionProps> = {}): AccountsSectionProps {
  // This component does not consume the standing Session/Workspace hooks.
  return {
    t: (key: keyof typeof zh) => zh[key],
    useConfiguration: select => select(configuration),
    useCandidates: select => select(candidates),
    connect: async () => ({ ok: true }),
    setPaused: async () => ({ ok: true }),
    loadCandidates: async () => {},
    ...overrides,
  } as AccountsSectionProps
}

function choose(platform: 'dingtalk' | 'wangwang', id: string): void {
  fireEvent.click(screen.getByRole('button', { name: zh.connectImAccount }))
  fireEvent.click(screen.getByRole('button', { name: zh[platform] }))
  fireEvent.click(screen.getByRole('button', { name: zh.next }))
  fireEvent.change(screen.getByRole('combobox', { name: zh.accountCandidate }), { target: { value: id } })
}

describe('accepted account setup', () => {
  it('passes real write-only credential fields and the selected admitted identity', async () => {
    const connect = vi.fn(async (_request: ImAccountSetupRequest) => ({ ok: true as const }))
    render(<AccountsSection {...props({ connect })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.connect }))
    await waitFor(() => { expect(connect).toHaveBeenCalledOnce() })
    expect(connect.mock.calls[0]?.[0]).toEqual({ platform: 'wangwang', candidateId: 'merchant-a', accessKeyId: 'access-key', accessKeySecret: 'secret-value' })
    await screen.findByText(zh.accountSaved)
    expect(screen.queryByLabelText(zh.secretKey)).toBeNull()
    expect(screen.queryByText(zh.connected)).toBeNull()
  })

  it('keeps failed setup visible without claiming connection success', async () => {
    render(<AccountsSection {...props({ connect: async () => ({ ok: false, message: 'Provider authorization required' }) })} />)
    choose('dingtalk', 'employee-a')
    fireEvent.click(screen.getByRole('button', { name: zh.connect }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Provider authorization required')
    expect(screen.getByRole('combobox', { name: zh.accountCandidate })).toHaveProperty('value', 'employee-a')
    expect(screen.queryByText(zh.connected)).toBeNull()
  })

  it('keeps the connect button unavailable without a provider-discovered identity', () => {
    render(<AccountsSection {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: zh.connectImAccount }))
    fireEvent.click(screen.getByRole('button', { name: zh.dingtalk }))
    fireEvent.click(screen.getByRole('button', { name: zh.next }))
    expect(screen.getByRole('button', { name: zh.connect })).toHaveProperty('disabled', true)
  })
})
