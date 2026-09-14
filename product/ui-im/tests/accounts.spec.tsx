// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ImAccountSetupRequest, ImAccountView, ImAccountId, ImAccountLifecycleRequest, ImOperationId, ImRevision, ImConfigurationState, ImAccountCandidatesState } from '@gestaltrun/dsh-api-im/client'
import { AccountsSection, type AccountsSectionProps } from '../src/client/AccountsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { createAccountActionStore } from '../src/client/account-actions.ts'
import { bindSnapshotSelector } from './helpers.ts'

afterEach(cleanup)
const configuration: ImConfigurationState = { phase: 'ready', value: { revision: 0, accounts: [], routes: [], simulationTargets: [] }, error: undefined }
const candidates: ImAccountCandidatesState = {
  dingtalk: { phase: 'ready', items: [{ platform: 'dingtalk', profile: 'employee-a', displayName: 'Employee A' }], error: undefined },
  wangwang: { phase: 'ready', items: [{ platform: 'wangwang', candidateId: 'merchant-a', displayName: 'Merchant A' }], error: undefined },
}

function props(overrides: Partial<AccountsSectionProps> = {}): AccountsSectionProps {
  const operations = createAccountActionStore().create()
  // This component does not consume the standing Session/Workspace hooks.
  return {
    t: (key: keyof typeof zh) => zh[key],
    useConfiguration: select => select(configuration),
    useCandidates: select => select(candidates),
    connect: async () => ({ ok: true }),
    setPaused: async () => ({ status: 'applied' }),
    disconnect: async () => ({ status: 'applied' }),
    reconnect: async () => ({ status: 'applied' }),
    refresh: async () => ({ status: 'applied' }),
    operationId: () => brandString<ImOperationId>('operation'),
    actions: operations.actions,
    useStore: bindSnapshotSelector(operations),
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

const account: ImAccountView = {
  id: brandString<ImAccountId>('account'), platform: 'dingtalk', displayName: 'Employee A',
  identity: { platform: 'dingtalk', profile: 'employee-a', corpId: 'corp', userId: 'employee-a', displayName: 'Employee A' },
  authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00Z' }, connectionIntent: 'connected',
  listener: { state: 'stopped', reason: 'no-enabled-route' }, paused: false,
  revision: brandString<ImRevision>('before-confirmation'), createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z',
}

function accountConfiguration(value: ImAccountView): ImConfigurationState {
  return { ...configuration, value: { ...configuration.value!, accounts: [value] } }
}

describe('authoritative account lifecycle actions', () => {
  it('does not call disconnect when confirmation is cancelled', () => {
    const disconnect = vi.fn(async () => ({ status: 'applied' as const }))
    render(<AccountsSection {...props({ useConfiguration: select => select(accountConfiguration(account)), disconnect })} />)
    fireEvent.click(screen.getByRole('button', { name: zh.disconnect }))
    expect(disconnect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    expect(disconnect).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('uses the account revision observed when the confirmation opened', async () => {
    const source = createSnapshotStore(accountConfiguration(account))
    const disconnect = vi.fn(async (_request: ImAccountLifecycleRequest) => ({ status: 'conflict' as const }))
    const properties = props({ useConfiguration: bindSnapshotSelector(source), disconnect })
    render(<AccountsSection {...properties} />)
    fireEvent.click(screen.getByRole('button', { name: zh.disconnect }))
    act(() => { source.set(accountConfiguration({ ...account, displayName: 'Updated Employee', revision: brandString<ImRevision>('after-confirmation') })) })
    expect(screen.getByText(/Updated Employee/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.confirmDisconnect }))
    await waitFor(() => { expect(disconnect).toHaveBeenCalledOnce() })
    expect(disconnect.mock.calls[0]?.[0]).toEqual({ operationId: 'operation', accountId: account.id, observedRevision: 'before-confirmation' })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh.accountChanged)
  })

  it('offers reconnect from durable intent even while paused and requests a real authorization refresh', async () => {
    const disconnected = { ...account, paused: true, connectionIntent: 'disconnected' as const, listener: { state: 'stopped' as const, reason: 'account-paused' as const } }
    const reconnect = vi.fn(async (_request: ImAccountLifecycleRequest) => ({ status: 'applied' as const }))
    const refresh = vi.fn(async (_request: ImAccountLifecycleRequest) => ({ status: 'applied' as const }))
    render(<AccountsSection {...props({ useConfiguration: select => select(accountConfiguration(disconnected)), reconnect, refresh })} />)
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    expect(screen.queryByText(zh.accountLifecycleUnavailable)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.reconnect }))
    await waitFor(() => { expect(reconnect).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: zh.refreshAuthorization }))
    await waitFor(() => { expect(refresh).toHaveBeenCalledOnce() })
    expect(refresh.mock.calls[0]?.[0].accountId).toBe(account.id)
  })

  it('retains an unknown operation across remounts and blocks blind repeated commands', async () => {
    const disconnect = vi.fn(async () => ({ status: 'unknown' as const }))
    const properties = props({ useConfiguration: select => select(accountConfiguration(account)), disconnect })
    const first = render(<AccountsSection {...properties} />)
    fireEvent.click(screen.getByRole('button', { name: zh.disconnect }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmDisconnect }))
    await screen.findByText(zh.accountOperationUnknown)
    first.unmount()
    render(<AccountsSection {...properties} />)
    expect(screen.getByText(zh.accountOperationUnknown)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.disconnect })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: zh.refreshAuthorization })).toHaveProperty('disabled', true)
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
