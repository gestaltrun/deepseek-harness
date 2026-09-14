// @vitest-environment jsdom

import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AccountPoolAccount, AccountPoolAccountName, AccountPoolAccountRef, AccountPoolEditableFields, AccountPoolSnapshot, AccountPoolLoginState } from '../src/account-pool.ts'
import { AccountPoolControl, type AccountPoolControlProps } from '../src/client/AccountPoolControl.tsx'
import type { AccountPoolClientActions } from '../src/client/controller.ts'
import { createAccountPoolViewStore } from '../src/client/view-store.ts'
import { AccountCard } from '../src/client/AccountCard.tsx'
import { QuotaBarWithTimeline } from '../src/client/QuotaBarWithTimeline.tsx'
import { ModelsFooter } from '../src/client/ModelsFooter.tsx'
import { en, zh, type AccountPoolKey } from '../src/client/locales.ts'
import type { AccountPoolCopy } from '../src/client/quota-display.ts'

afterEach(cleanup)

function copy(locale: 'en' | 'zh' = 'en'): AccountPoolCopy {
  const dictionary = locale === 'en' ? en : zh
  return (key: AccountPoolKey, values?: Record<string, string | number>) => {
    let value: string = dictionary[key]
    for (const [name, item] of Object.entries(values ?? {})) value = value.replaceAll(`{${name}}`, String(item))
    return value
  }
}

const account: AccountPoolAccount = {
  authIndex: 'kimi-1' as AccountPoolAccountRef, name: 'kimi.json' as AccountPoolAccountName,
  provider: 'kimi', label: 'Kimi user', status: 'ready', enabled: true, successCount: 3, failCount: 1,
  recentRequests: [{ success: 1, failed: 0 }, { success: 0, failed: 1 }],
  quota: [], quotaState: { status: 'unobserved', stale: false },
}
const ready: AccountPoolSnapshot = { state: 'ready', accounts: [account] }

function commands(overrides: Partial<AccountPoolClientActions> = {}): AccountPoolClientActions {
  return {
    refresh: vi.fn(async () => ready), setEnabled: vi.fn(async () => ready), deleteAccount: vi.fn(async () => ready),
    startLogin: vi.fn(async kind => ({ kind, flow: 'pkce', status: 'pending' })),
    loginStatus: vi.fn(async () => ready), cancelLogin: vi.fn(async () => ready), dismissLogin: vi.fn(async () => ready),
    submitCallback: vi.fn(async () => ready), submitGlmKey: vi.fn(async () => ready), refreshQuota: vi.fn(async () => ready),
    refreshAllQuota: vi.fn(async () => ready), listModels: vi.fn(async () => [{ id: 'kimi-k2' }]),
    readFields: vi.fn(async name => ({ name, info: { account: name }, fields: {} })), patchFields: vi.fn(async () => ready),
    download: vi.fn(async () => {}), openExternal: vi.fn(async () => {}), ...overrides,
  }
}

function mount(snapshot = ready, actions = commands(), locale: 'en' | 'zh' = 'en') {
  const view = createAccountPoolViewStore().create()
  function View() {
    // Unused framework seats are supplied by the real renderer in composition tests.
    const props = {
      t: copy(locale), close: () => {}, accountPoolActions: actions,
      useAccountPool: <T,>(select: (value: AccountPoolSnapshot) => T) => select(snapshot),
      useAccountPoolDirectory: <T,>(select: (value: { loaded: boolean }) => T) => select({ loaded: true }),
      useStore: <T,>(select: (value: ReturnType<typeof view.store.getSnapshot>) => T) => select(useSyncExternalStore(view.store.subscribe, view.store.getSnapshot)),
      actions: view.actions,
    } as AccountPoolControlProps
    return <AccountPoolControl {...props} />
  }
  return { ...render(<View />), actions }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('account pool Settings', () => {
  it('renders without a Desktop bridge and preserves global and individual card faces', () => {
    mount()
    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByTestId('health-ticks-kimi-1').childElementCount).toBe(20)
    fireEvent.click(screen.getByTestId('global-face-btn-b'))
    expect(screen.getByTestId('card-face-b')).toBeTruthy()
    fireEvent.click(screen.getByTestId('card-flip-btn-kimi-1'))
    expect(screen.getByTestId('card-face-a')).toBeTruthy()
    fireEvent.click(screen.getByTestId('global-face-btn-b'))
    expect(screen.getByTestId('card-face-b')).toBeTruthy()
    fireEvent.click(screen.getByTestId('filter-codex'))
    expect(screen.queryByTestId('account-card-kimi-1')).toBeNull()
    fireEvent.click(screen.getByTestId('filter-all'))
    expect(screen.getByTestId('account-card-kimi-1')).toBeTruthy()
  })

  it('has a Chinese page and six provider enrollment choices', () => {
    mount(ready, commands(), 'zh')
    expect(screen.getByText(zh.title)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.addAccount))
    for (const name of ['CLAUDE', 'CODEX', 'ANTIGRAVITY', 'KIMI', 'XAI', 'GLM']) expect(screen.getByRole('button', { name, exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CODEX', exact: true }))
    expect(screen.getByRole('button', { name: zh.startLogin.replace('{provider}', 'CODEX') })).toBeTruthy()
  })

  it('retains failed and pending logins until the Host accepts dismissal, without Client polling', async () => {
    const actions = commands()
    mount({ ...ready, login: { kind: 'codex', flow: 'pkce', status: 'error', state: 'login-1' as AccountPoolLoginState, error: 'Authorization declined' } }, actions)
    expect(screen.getByText('Authorization declined')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.close })[0]!)
    await waitFor(() => expect(actions.dismissLogin).toHaveBeenCalledTimes(1))
    expect(actions.loginStatus).not.toHaveBeenCalled()
  })

  it('submits GLM site and organization only after a complete team form', async () => {
    const { actions } = mount()
    fireEvent.click(screen.getByText(en.addAccount))
    fireEvent.click(screen.getByRole('button', { name: 'GLM', exact: true }))
    fireEvent.change(screen.getByLabelText(en.glmKey), { target: { value: 'test-only-key' } })
    fireEvent.click(screen.getByLabelText(en.glmTeam))
    expect((screen.getByText(en.glmSave) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.glmOrg), { target: { value: 'test-team' } })
    fireEvent.change(screen.getByLabelText(en.glmSite), { target: { value: 'international' } })
    fireEvent.click(screen.getByText(en.glmSave))
    await waitFor(() => expect(actions.submitGlmKey).toHaveBeenCalledWith({ apiKey: 'test-only-key', site: 'international', organization: 'test-team' }))
  })

  it('ignores account A reads after its dialog closes and account B opens', async () => {
    const a = deferred<AccountPoolEditableFields>()
    const b = deferred<AccountPoolEditableFields>()
    const second = { ...account, authIndex: 'codex-2' as AccountPoolAccountRef, name: 'codex.json' as AccountPoolAccountName, provider: 'codex' }
    const actions = commands({ readFields: vi.fn(name => name === account.name ? a.promise : b.promise) })
    mount({ ...ready, accounts: [account, second] }, actions)
    fireEvent.click(within(screen.getByTestId('account-card-kimi-1')).getByRole('button', { name: en.settings }))
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    fireEvent.click(within(screen.getByTestId('account-card-codex-2')).getByRole('button', { name: en.settings }))
    b.resolve({ name: second.name, info: { account: 'second' }, fields: { prefix: 'second-prefix' } })
    await waitFor(() => expect((screen.getByLabelText(en.fieldPrefix) as HTMLInputElement).value).toBe('second-prefix'))
    a.resolve({ name: account.name, info: { account: 'first' }, fields: { prefix: 'first-prefix' } })
    await Promise.resolve()
    expect((screen.getByLabelText(en.fieldPrefix) as HTMLInputElement).value).toBe('second-prefix')
  })

  it('keeps the edit dialog open and preserves secret fields when saving fails', async () => {
    const actions = commands({
      readFields: vi.fn(async name => ({ name, info: { account: 'safe' }, fields: { proxyUrl: 'http://proxy.example:80', proxyCredentialsConfigured: true, headers: { Authorization: { kind: 'secret', configured: true }, 'X-Project': { kind: 'value', value: 'demo' } } } })),
      patchFields: vi.fn(async () => { throw new Error('Write refused') }),
    })
    mount(ready, actions)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    await screen.findByLabelText(en.fieldPrefix)
    expect(screen.getByText(en.secretConfigured)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.fieldPrefix), { target: { value: 'new-prefix' } })
    fireEvent.click(screen.getByRole('button', { name: en.save, exact: true }))
    await screen.findByText(en.actionFailed.replace('{message}', 'Write refused'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText(en.fieldPrefix) as HTMLInputElement).value).toBe('new-prefix')
    expect(actions.patchFields).toHaveBeenCalledWith(account.name, expect.objectContaining({ proxyUrl: { kind: 'keep' }, headers: {} }))
  })

  it('sends PKCE callbacks and displays device codes without a callback form', async () => {
    const actions = commands()
    const first = mount({ ...ready, login: { kind: 'codex', flow: 'pkce', status: 'pending', state: 'pkce' as AccountPoolLoginState, url: 'https://login.example/authorize' } }, actions)
    fireEvent.change(screen.getByLabelText(en.callbackUrl), { target: { value: 'http://localhost/auth/callback?code=fixture&state=pkce' } })
    fireEvent.click(screen.getByText(en.submitCallback))
    await waitFor(() => expect(actions.submitCallback).toHaveBeenCalledWith({ provider: 'codex', redirectUrl: 'http://localhost/auth/callback?code=fixture&state=pkce' }))
    first.unmount()
    mount({ ...ready, login: { kind: 'kimi', flow: 'device', status: 'pending', state: 'device' as AccountPoolLoginState, userCode: 'TEST-CODE', url: 'https://login.example/device' } })
    expect(screen.getByText('TEST-CODE')).toBeTruthy()
    expect(screen.queryByLabelText(en.callbackUrl)).toBeNull()
  })

  it('writes explicit replace and remove intents without submitting redacted values', async () => {
    const actions = commands({ readFields: vi.fn(async name => ({ name, info: {}, fields: { proxyUrl: 'https://proxy.example', proxyCredentialsConfigured: true, headers: { Authorization: { kind: 'secret', configured: true }, 'X-Project': { kind: 'value', value: 'demo' } } } })) })
    mount(ready, actions)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    await screen.findByLabelText('Authorization')
    fireEvent.change(screen.getByLabelText('Authorization'), { target: { value: 'replace' } })
    fireEvent.change(screen.getByLabelText(en.replaceHeader.replace('{name}', 'Authorization')), { target: { value: 'new-test-value' } })
    fireEvent.change(screen.getByLabelText('X-Project'), { target: { value: 'remove' } })
    fireEvent.change(screen.getAllByLabelText(en.fieldProxy).find(item => item.tagName === 'SELECT')!, { target: { value: 'remove' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => expect(actions.patchFields).toHaveBeenCalledWith(account.name, expect.objectContaining({ proxyUrl: { kind: 'remove' }, headers: { Authorization: { kind: 'replace', value: 'new-test-value' }, 'X-Project': { kind: 'remove' } } })))
  })

  it('shows a read-only live route in the Models footer', () => {
    const props = {
      t: copy(), useAccountPoolDirectory: <T,>(select: (value: { loaded: boolean; provider: { id: string; name: string } }) => T) => select({ loaded: true, provider: { id: 'gestalt-account-pool', name: 'Account pool' } }),
    } as Parameters<typeof ModelsFooter>[0]
    render(<ModelsFooter {...props} />)
    expect(screen.getByText('gestalt-account-pool')).toBeTruthy()
    expect(screen.getByText(en.footerLead)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reports failed commands without unhandled rejections and confirms deletion', async () => {
    const actions = commands({ setEnabled: vi.fn(async () => { throw new Error('Account busy') }) })
    mount(ready, actions)
    fireEvent.click(screen.getByRole('switch'))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.delete, exact: true }))
    expect(actions.deleteAccount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(actions.deleteAccount).toHaveBeenCalledWith(account.name))
  })
})

describe('quota observations', () => {
  it('shows an unknown track without fabricated quota or time fill', () => {
    render(<QuotaBarWithTimeline name="Weekly" resetText="" unknownLabel="Unknown" isReliable={false} percentRemaining={70} timeRemainingPercent={20} />)
    const track = screen.getByTestId('quota-track')
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(track.dataset.quotaFill).toBe('none')
    expect(track.dataset.quotaNeedle).toBe('none')
    expect(track.childElementCount).toBe(0)
  })

  it('keeps the last sample visible and separately reports its failed refresh', () => {
    render(<AccountCard t={copy()} item={{ ...account, quota: [{ key: 'weekly', label: 'Weekly', status: 'known', remainingPercent: 60 }], quotaState: { status: 'failure', stale: true, observedAt: 1, lastSuccessAt: 0, error: 'Quota unavailable' } }} globalFace="B" globalEpoch={0} onToggleStatus={() => {}} onRefreshQuota={() => {}} onDelete={() => {}} onListModels={() => {}} onRefresh={() => {}} onDownload={() => {}} onEditSettings={() => {}} />)
    expect(screen.getByText('60%')).toBeTruthy()
    expect(screen.getByText(en.quotaStale)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Quota unavailable')
  })
})
