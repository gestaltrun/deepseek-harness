// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ImAccountSetupId, ImAccountSetupPreview, ImAccountSetupRequest, ImAccountView, ImAccountId,
  ImAccountLifecycleRequest, ImOperationId, ImRevision, ImConfigurationState, ImAccountCandidatesState,
} from '@gestaltrun/dsh-api-im/client'
import { AccountsSection, type AccountsSectionProps } from '../src/client/AccountsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { createAccountActionStore } from '../src/client/account-actions.ts'
import { bindSnapshotSelector } from './helpers.ts'

afterEach(cleanup)
const configuration: ImConfigurationState = { phase: 'ready', value: { revision: 0, accounts: [], routes: [], simulationTargets: [] }, error: undefined }
const candidates: ImAccountCandidatesState = {
  dingtalk: { phase: 'ready', items: [{ platform: 'dingtalk', profile: 'employee-a', displayName: 'Employee A' }], error: undefined },
  wangwang: { phase: 'ready', items: [{ platform: 'wangwang', candidateId: 'merchant-a', endpoint: 'https://wangwang.invalid', displayName: 'Merchant A' }], error: undefined },
}
const setupId = brandString<ImAccountSetupId>('setup')
const merchantPreview: ImAccountSetupPreview = {
  setupId, displayName: 'Verified Merchant',
  identity: { platform: 'wangwang', merchantId: 'merchant-a', displayName: 'Verified Merchant' },
  authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00Z' },
  expiresAt: '2026-09-14T00:10:00Z',
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}

function props(overrides: Partial<AccountsSectionProps> = {}): AccountsSectionProps {
  const operations = createAccountActionStore().create()
  // This component does not consume the standing Session/Workspace hooks.
  return {
    t: (key: keyof typeof zh) => zh[key],
    useConfiguration: select => select(configuration),
    useCandidates: select => select(candidates),
    previewSetup: async () => ({ ok: true, value: merchantPreview }),
    confirmSetup: async () => ({ status: 'applied' }),
    cancelSetup: async () => ({ ok: true, value: { state: 'cancelled' } }),
    queryOperation: async () => ({ status: 'unknown' }),
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
  it('detects a DWS identity before asking the operator to save it', async () => {
    const preview: ImAccountSetupPreview = {
      setupId, displayName: 'Verified Employee',
      identity: { platform: 'dingtalk', profile: 'employee-a', corpId: 'corp-a', userId: 'user-a', displayName: 'Verified Employee' },
      authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00Z' }, expiresAt: merchantPreview.expiresAt,
    }
    const previewSetup = vi.fn(async (_request: ImAccountSetupRequest) => ({ ok: true as const, value: preview }))
    render(<AccountsSection {...props({ previewSetup })} />)
    choose('dingtalk', 'employee-a')
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Employee/u)
    expect(previewSetup).toHaveBeenCalledWith({ platform: 'dingtalk', profile: 'employee-a' }, expect.any(AbortSignal))
    expect(screen.getByRole('button', { name: zh.confirmAccountSetup })).toBeTruthy()
  })

  it('verifies the admitted Wangwang identity before confirming the same setup', async () => {
    const previewSetup = vi.fn(async (_request: ImAccountSetupRequest) => ({ ok: true as const, value: merchantPreview }))
    const confirmSetup = vi.fn(async () => ({ status: 'applied' as const }))
    render(<AccountsSection {...props({ previewSetup, confirmSetup })} />)
    choose('wangwang', 'merchant-a')
    expect(screen.getByLabelText(zh.endpoint)).toHaveProperty('value', 'https://wangwang.invalid')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await waitFor(() => { expect(previewSetup).toHaveBeenCalledOnce() })
    expect(previewSetup.mock.calls[0]?.[0]).toEqual({ platform: 'wangwang', candidateId: 'merchant-a', endpoint: 'https://wangwang.invalid', accessKeyId: 'access-key', accessKeySecret: 'secret-value' })
    expect(await screen.findByText(/Verified Merchant/u)).toBeTruthy()
    expect(screen.getByText(zh.authorizationReady)).toBeTruthy()
    expect(screen.queryByLabelText(zh.secretKey)).toBeNull()
    expect(confirmSetup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.confirmAccountSetup }))
    await waitFor(() => { expect(confirmSetup).toHaveBeenCalledOnce() })
    expect(confirmSetup.mock.calls[0]?.[0]).toEqual({ setupId, operationId: 'operation' })
    await screen.findByText(zh.accountSaved)
    expect(screen.queryByText(zh.connected)).toBeNull()
  })

  it('clears a rejected secret and keeps the setup form visible', async () => {
    render(<AccountsSection {...props({ previewSetup: async () => ({ ok: false, message: 'Provider authorization required' }) })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Provider authorization required')
    expect(screen.getByLabelText(zh.secretKey)).toHaveProperty('value', '')
    expect(screen.getByRole('combobox', { name: zh.accountCandidate })).toHaveProperty('value', 'merchant-a')
    expect(screen.queryByText(zh.connected)).toBeNull()
  })

  it('rejects malformed or unadmitted endpoint values before verification', async () => {
    const previewSetup = vi.fn()
    render(<AccountsSection {...props({ previewSetup })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.change(screen.getByLabelText(zh.endpoint), { target: { value: 'invalid' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh.endpointInvalid)
    fireEvent.change(screen.getByLabelText(zh.endpoint), { target: { value: 'https://other.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh.endpointMismatch)
    expect(previewSetup).not.toHaveBeenCalled()
  })

  it('cancels the Host-held setup without confirming it', async () => {
    const cancelSetup = vi.fn(async () => ({ ok: true as const, value: { state: 'cancelled' as const } }))
    const confirmSetup = vi.fn()
    render(<AccountsSection {...props({ cancelSetup, confirmSetup })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Merchant/u)
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    await waitFor(() => { expect(cancelSetup).toHaveBeenCalledWith(setupId) })
    expect(cancelSetup).toHaveBeenCalledOnce()
    expect(confirmSetup).not.toHaveBeenCalled()
    expect(screen.queryByText(/Verified Merchant/u)).toBeNull()
  })

  it('releases an unconfirmed Host setup when the settings view closes', async () => {
    const cancelSetup = vi.fn(async () => ({ ok: true as const, value: { state: 'cancelled' as const } }))
    const view = render(<AccountsSection {...props({ cancelSetup })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Merchant/u)
    view.unmount()
    await waitFor(() => { expect(cancelSetup).toHaveBeenCalledWith(setupId) })
    expect(cancelSetup).toHaveBeenCalledOnce()
  })

  it('aborts provider verification when setup is cancelled before a preview exists', async () => {
    let observedSignal: AbortSignal | undefined
    const previewSetup = vi.fn(async (_request: ImAccountSetupRequest, signal: AbortSignal) => {
      observedSignal = signal
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { ok: false as const, message: 'cancelled' }
    })
    render(<AccountsSection {...props({ previewSetup })} />)
    choose('dingtalk', 'employee-a')
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await waitFor(() => { expect(previewSetup).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    expect(observedSignal?.aborted).toBe(true)
    expect(screen.queryByLabelText(zh.accountCandidate)).toBeNull()
  })

  it('keeps the setup open when cancellation races an in-progress confirmation', async () => {
    const confirmation = deferred<{ status: 'applied' }>()
    const confirmSetup = vi.fn(() => confirmation.promise)
    const cancelSetup = vi.fn(async () => ({ ok: true as const, value: { state: 'confirming' as const } }))
    render(<AccountsSection {...props({ cancelSetup, confirmSetup })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Merchant/u)
    fireEvent.click(screen.getByRole('button', { name: zh.confirmAccountSetup }))
    await waitFor(() => { expect(confirmSetup).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', zh.accountSetupConfirming)
    expect(screen.getByText(/Verified Merchant/u)).toBeTruthy()
    confirmation.resolve({ status: 'applied' })
    await screen.findByText(zh.accountSaved)
  })

  it('reports a setup already confirmed instead of treating cancellation as success', async () => {
    const cancelSetup = vi.fn(async () => ({ ok: true as const, value: { state: 'confirmed' as const, accountId: brandString<ImAccountId>('confirmed-account') } }))
    render(<AccountsSection {...props({ cancelSetup })} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Merchant/u)
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    await screen.findByText(zh.accountSaved)
  })

  it('replays an unknown confirmation with the same opaque identifiers after remount', async () => {
    const confirmSetup = vi.fn()
      .mockResolvedValueOnce({ status: 'unknown' as const })
      .mockResolvedValueOnce({ status: 'applied' as const })
    const properties = props({ confirmSetup })
    const first = render(<AccountsSection {...properties} />)
    choose('wangwang', 'merchant-a')
    fireEvent.change(screen.getByLabelText(zh.accessKey), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText(zh.secretKey), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: zh.verifyAccount }))
    await screen.findByText(/Verified Merchant/u)
    fireEvent.click(screen.getByRole('button', { name: zh.confirmAccountSetup }))
    await screen.findByText(zh.accountOperationUnknown)
    first.unmount()
    render(<AccountsSection {...properties} />)
    fireEvent.click(screen.getByRole('button', { name: zh.checkSetupResult }))
    await waitFor(() => { expect(confirmSetup).toHaveBeenCalledTimes(2) })
    expect(confirmSetup.mock.calls[0]?.[0]).toEqual({ setupId, operationId: 'operation' })
    expect(confirmSetup.mock.calls[1]?.[0]).toEqual(confirmSetup.mock.calls[0]?.[0])
    await screen.findByText(zh.accountSaved)
  })

  it('keeps verification unavailable without a provider-discovered identity', () => {
    render(<AccountsSection {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: zh.connectImAccount }))
    fireEvent.click(screen.getByRole('button', { name: zh.dingtalk }))
    fireEvent.click(screen.getByRole('button', { name: zh.next }))
    expect(screen.getByRole('button', { name: zh.verifyAccount })).toHaveProperty('disabled', true)
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

  it('queries an unknown operation across remounts without repeating the command', async () => {
    const disconnect = vi.fn(async () => ({ status: 'unknown' as const }))
    const queryOperation = vi.fn(async () => ({ status: 'applied' as const }))
    const properties = props({ useConfiguration: select => select(accountConfiguration(account)), disconnect, queryOperation })
    const first = render(<AccountsSection {...properties} />)
    fireEvent.click(screen.getByRole('button', { name: zh.disconnect }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmDisconnect }))
    await screen.findByText(zh.accountOperationUnknown)
    first.unmount()
    render(<AccountsSection {...properties} />)
    expect(screen.getByText(zh.accountOperationUnknown)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.disconnect })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: zh.refreshAuthorization })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: zh.checkAccountOperation }))
    await waitFor(() => { expect(queryOperation).toHaveBeenCalledOnce() })
    expect(queryOperation).toHaveBeenCalledWith({ accountId: account.id, operationId: 'operation' })
    expect(screen.getByRole('button', { name: zh.disconnect })).toHaveProperty('disabled', false)
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
