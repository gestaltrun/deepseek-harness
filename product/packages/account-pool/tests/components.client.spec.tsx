// @vitest-environment jsdom

import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AccountPoolAccount, AccountPoolAccountName, AccountPoolAccountRef, AccountPoolEditableFields, AccountPoolSnapshot, AccountPoolLoginState } from '../src/account-pool.ts'
import { AccountPoolControl, type AccountPoolControlProps } from '../src/client/AccountPoolControl.tsx'
import type { AccountPoolClientActions } from '../src/client/contract.ts'
import { createAccountPoolViewStore } from '../src/client/view-store.ts'
import { AccountCard } from '../src/client/AccountCard.tsx'
import { QuotaBarWithTimeline } from '../src/client/QuotaBarWithTimeline.tsx'
import { en, zh, type AccountPoolKey } from '../src/client/locales.ts'
import type { AccountPoolCopy } from '../src/client/quota-display.ts'

afterEach(cleanup)

function copy(locale: 'en' | 'zh' = 'en'): AccountPoolCopy {
  const dictionary = locale === 'en' ? en : zh
  return (key: AccountPoolKey, values?: Record<string, unknown>) => {
    let value: string = dictionary[key]
    for (const [name, item] of Object.entries(values ?? {})) value = value.replaceAll(`{${name}}`, String(item))
    return value
  }
}

const account: AccountPoolAccount = {
  ref: 'kimi-1' as AccountPoolAccountRef, name: 'kimi.json' as AccountPoolAccountName,
  capabilities: { models: 'account', quota: true, export: 'auth-file', editableFields: ['note', 'prefix', 'proxyUrl', 'priority', 'weight', 'disableCooling', 'websockets', 'excludedModels', 'headers'] },
  provider: 'kimi', label: 'Kimi user', status: 'ready', enabled: true, successCount: 3, failCount: 1,
  recentRequests: [{ success: 1, failed: 0 }, { success: 0, failed: 1 }],
  quota: [], quotaState: { status: 'unobserved', stale: false },
}
const ready: AccountPoolSnapshot = { state: 'ready', accounts: [account] }

function commands(overrides: Partial<AccountPoolClientActions> = {}): AccountPoolClientActions {
  return {
    refresh: vi.fn<AccountPoolClientActions['refresh']>(async () => ready), setEnabled: vi.fn<AccountPoolClientActions['setEnabled']>(async () => ready), deleteAccount: vi.fn<AccountPoolClientActions['deleteAccount']>(async () => ready),
    startLogin: vi.fn<AccountPoolClientActions['startLogin']>(async kind => ({ kind, flow: 'pkce', status: 'pending' })),
    loginStatus: vi.fn<AccountPoolClientActions['loginStatus']>(async () => ready), cancelLogin: vi.fn<AccountPoolClientActions['cancelLogin']>(async () => ready), dismissLogin: vi.fn<AccountPoolClientActions['dismissLogin']>(async () => ready),
    submitCallback: vi.fn<AccountPoolClientActions['submitCallback']>(async () => ready), submitGlmKey: vi.fn<AccountPoolClientActions['submitGlmKey']>(async () => ready), refreshQuota: vi.fn<AccountPoolClientActions['refreshQuota']>(async () => ready),
    refreshAllQuota: vi.fn<AccountPoolClientActions['refreshAllQuota']>(async () => ready), listModels: vi.fn<AccountPoolClientActions['listModels']>(async () => [{ id: 'kimi-k2' }]),
    readFields: vi.fn<AccountPoolClientActions['readFields']>(async name => ({ name, info: { account: name }, fields: {} })), patchFields: vi.fn<AccountPoolClientActions['patchFields']>(async () => ready),
    download: vi.fn<AccountPoolClientActions['download']>(async () => {}), openExternal: vi.fn<AccountPoolClientActions['openExternal']>(async () => {}), ...overrides,
  }
}

function mount(snapshot = ready, actions = commands(), locale: 'en' | 'zh' = 'en') {
  const view = createAccountPoolViewStore().create()
  function View() {
    // Unused framework seats are supplied by the real renderer in composition tests.
    const props = {
      t: copy(locale), close: () => {}, accountPoolActions: actions,
      useAccountPool: <T,>(select: (value: AccountPoolSnapshot) => T) => select(snapshot),
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
  it.each(['en', 'zh'] as const)('retains the assembled %s account-management copy', async locale => {
    const { container } = mount(ready, commands(), locale)
    const output = {
      text: container.textContent,
      actions: [...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent),
    }
    await expect(JSON.stringify(output, undefined, 2) + '\n').toMatchFileSnapshot(`./expected/account-pool.${locale}.json`)
  })

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
    for (const name of ['ANTHROPIC', 'CODEX', 'ANTIGRAVITY', 'KIMI', 'XAI', 'GLM']) expect(screen.getByRole('button', { name })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CODEX' }))
    expect(screen.getByRole('button', { name: zh.startLogin.replace('{provider}', 'CODEX') })).toBeTruthy()
  })

  it('opens the authorization URL when login starts and when the user retries the browser action', async () => {
    const actions = commands({
      startLogin: vi.fn<AccountPoolClientActions['startLogin']>(async kind => ({
        kind, flow: 'device', status: 'pending', url: 'https://login.example/device',
      })),
    })
    mount(ready, actions)
    fireEvent.click(screen.getByText(en.addAccount))
    fireEvent.click(screen.getByRole('button', { name: 'XAI' }))
    fireEvent.click(screen.getByRole('button', { name: en.startLogin.replace('{provider}', 'XAI') }))
    await waitFor(() => expect(actions.startLogin).toHaveBeenCalledWith('xai'))
    await waitFor(() => expect(actions.openExternal).toHaveBeenCalledWith('https://login.example/device'))
  })

  it('retries Host authorization open from the pending login dialog', async () => {
    const actions = commands()
    mount({ ...ready, login: { kind: 'xai', flow: 'device', status: 'pending', url: 'https://login.example/device' } }, actions)
    fireEvent.click(screen.getByRole('button', { name: en.openBrowser }))
    await waitFor(() => expect(actions.openExternal).toHaveBeenCalledWith('https://login.example/device'))
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
    fireEvent.click(screen.getByRole('button', { name: 'GLM' }))
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
    const second = { ...account, ref: 'codex-2' as AccountPoolAccountRef, name: 'codex.json' as AccountPoolAccountName, provider: 'codex' }
    const actions = commands({ readFields: vi.fn<AccountPoolClientActions['readFields']>(name => name === account.name ? a.promise : b.promise) })
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
      readFields: vi.fn<AccountPoolClientActions['readFields']>(async name => ({ name, info: { account: 'safe' }, fields: { proxyUrl: 'http://proxy.example:80', proxyCredentialsConfigured: true, headers: { Authorization: { kind: 'secret', configured: true }, 'X-Project': { kind: 'value', value: 'demo' } } } })),
      patchFields: vi.fn<AccountPoolClientActions['patchFields']>(async () => { throw new Error('Write refused') }),
    })
    mount(ready, actions)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    await screen.findByLabelText(en.fieldPrefix)
    expect(screen.getByText(en.secretConfigured)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.fieldPrefix), { target: { value: 'new-prefix' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
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
    const actions = commands({ readFields: vi.fn<AccountPoolClientActions['readFields']>(async name => ({ name, info: {}, fields: { proxyUrl: 'https://proxy.example', proxyCredentialsConfigured: true, headers: { Authorization: { kind: 'secret', configured: true }, 'X-Project': { kind: 'value', value: 'demo' } } } })) })
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

  it('keeps GLM observations unknown and disables unsupported edits', async () => {
    const { successCount: _success, failCount: _failed, ...base } = account
    const glm: AccountPoolAccount = {
      ...base, ref: 'glm-1' as AccountPoolAccountRef, provider: 'glm', status: 'configured',
      capabilities: { models: 'provider', quota: true, export: 'glm-credential', editableFields: ['note', 'prefix', 'proxyUrl', 'priority', 'weight'] },
      quotaState: { status: 'unobserved', stale: false },
    }
    mount({ ...ready, accounts: [glm] })
    expect(screen.getByText(en.configured)).toBeTruthy()
    expect(screen.getByText(en.successFail.replace('{success}', en.unknown).replace('{fail}', en.unknown))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.models }))
    await screen.findByText(en.providerModelsScope)
    fireEvent.click(screen.getAllByRole('button', { name: en.close })[0]!)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    await screen.findByLabelText(en.fieldPrefix)
    expect((screen.getByLabelText(en.fieldPrefix) as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByRole('switch', { name: en.fieldCooling }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: en.fieldWebsockets }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(en.limitedFields)).toBeTruthy()
  })

  it('tracks concurrent quota refreshes independently for each account', async () => {
    const first = deferred<AccountPoolSnapshot>()
    const second = deferred<AccountPoolSnapshot>()
    const other = { ...account, ref: 'kimi-2' as AccountPoolAccountRef, name: 'second.json' as AccountPoolAccountName }
    const actions = commands({ refreshQuota: vi.fn<AccountPoolClientActions['refreshQuota']>(ref => ref === account.ref ? first.promise : second.promise) })
    mount({ ...ready, accounts: [account, other] }, actions)
    fireEvent.click(screen.getByTestId('global-face-btn-b'))
    const firstButton = within(screen.getByTestId('account-card-kimi-1')).getByRole('button', { name: en.refreshQuota })
    const secondButton = within(screen.getByTestId('account-card-kimi-2')).getByRole('button', { name: en.refreshQuota })
    fireEvent.click(firstButton)
    fireEvent.click(secondButton)
    expect(firstButton.getAttribute('aria-busy')).toBe('true')
    expect(secondButton.getAttribute('aria-busy')).toBe('true')
    await act(async () => { first.resolve(ready); await first.promise })
    expect(firstButton.getAttribute('aria-busy')).toBe('false')
    expect(secondButton.getAttribute('aria-busy')).toBe('true')
    await act(async () => { second.resolve(ready); await second.promise })
    expect(secondButton.getAttribute('aria-busy')).toBe('false')
  })

  it('keeps account B confirmation open after account A deletion completes', async () => {
    const deletion = deferred<AccountPoolSnapshot>()
    const other = { ...account, ref: 'kimi-2' as AccountPoolAccountRef, name: 'second.json' as AccountPoolAccountName }
    mount({ ...ready, accounts: [account, other] }, commands({ deleteAccount: vi.fn<AccountPoolClientActions['deleteAccount']>(() => deletion.promise) }))
    fireEvent.click(within(screen.getByTestId('account-card-kimi-1')).getByRole('button', { name: en.delete }))
    fireEvent.click(screen.getByTestId('delete-confirm'))
    fireEvent.click(screen.getByTestId('delete-cancel'))
    fireEvent.click(within(screen.getByTestId('account-card-kimi-2')).getByRole('button', { name: en.delete }))
    await act(async () => { deletion.resolve(ready); await deletion.promise })
    expect(screen.getByRole('dialog').textContent).toContain('second.json')
  })

  it('reports failed commands without unhandled rejections and confirms deletion', async () => {
    const actions = commands({ setEnabled: vi.fn<AccountPoolClientActions['setEnabled']>(async () => { throw new Error('Account busy') }) })
    mount(ready, actions)
    fireEvent.click(screen.getByRole('switch'))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.delete }))
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
