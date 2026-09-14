/** Accepted account settings consume authoritative configuration and provider choices. */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ImAccountCandidate, ImAccountCandidatesState, ImAccountView, ImPlatform } from '@gestaltrun/dsh-api-im/client'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountsFace, UiOutcome } from './faces.ts'
import type {} from './locale-types.ts'
import { accountUsable, authorizationKey, listenerKey } from './accounts.ts'
import { InlineConfirm } from './InlineConfirm.tsx'
import css from './AccountsSection.module.css'

/** Derived props for the Accounts settings section. */
export type AccountsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.im'> & InjectFace<AccountsFace>

/** @param props - safe account data, choices, localized copy, and commands. @returns the Accounts settings page. */
export function AccountsSection(props: AccountsSectionProps): ReactElement {
  const configuration = props.useConfiguration(state => state)
  const candidates = props.useCandidates(state => state)
  const [adding, setAdding] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const accounts = configuration.value?.accounts ?? []
  return <section className={css.section} data-im-accounts>
    <h2 className={css.heading}>{props.t('accountsTitle')}</h2>
    <p className={css.intro}>{props.t('accountsIntro')}</p>
    {configuration.phase !== 'ready' && <p role="status">{configuration.error ?? props.t(configuration.phase === 'reconnecting' ? 'reconnecting' : 'loading')}</p>}
    {feedback !== undefined && <p role="status">{feedback}</p>}
    {configuration.value !== undefined && accounts.length === 0 && !adding && <div className={css.empty}>
      <div className={css.name}>{props.t('emptyAccounts')}</div>
      <p className={css.hint}>{props.t('emptyAccountsHint')}</p>
    </div>}
    {accounts.map(account => <AccountRow key={account.id} account={account}
      routeCount={configuration.value?.routes.filter(route => route.accountId === account.id).length ?? 0}
      t={props.t} setPaused={props.setPaused} disconnect={props.disconnect} reconnect={props.reconnect}
      onFeedback={setFeedback} />)}
    {adding ? <AddAccountForm t={props.t} candidates={candidates} loadCandidates={props.loadCandidates}
      connect={props.connect} onCancel={() => { setAdding(false) }} onConnected={() => { setAdding(false); setFeedback(props.t('accountSaved')) }} />
      : <Button variant={accounts.length === 0 ? 'primary' : 'outline'} disabled={configuration.value === undefined}
        onClick={() => { setAdding(true) }}>{props.t(accounts.length === 0 ? 'connectImAccount' : 'addAccount')}</Button>}
    <p className={css.hint}>{props.t('accountLegend')}</p>
  </section>
}

type AccountRowProps = {
  readonly account: ImAccountView
  readonly routeCount: number
  readonly t: AccountsSectionProps['t']
  readonly setPaused: AccountsFace['setPaused']
  readonly disconnect: AccountsFace['disconnect']
  readonly reconnect: AccountsFace['reconnect']
  readonly onFeedback: (message: string) => void
}

function AccountRow(props: AccountRowProps): ReactElement {
  const { account, t } = props
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (action: () => Promise<UiOutcome>, success: string): Promise<void> => {
    setBusy(true); setError(undefined)
    try {
      const result = await action()
      if (result.ok) { setConfirm(false); props.onFeedback(success) }
      else setError(result.message)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const disconnected = account.listener.state === 'stopped' && account.listener.reason === 'disconnected'
  const lifecycle = disconnected ? props.reconnect : props.disconnect
  return <div className={css.row} data-account={account.id}>
    <div className={css.rowMain}>
      <div className={css.name}>{t(account.platform)} · {account.displayName}</div>
      <div className={css.sub}>{t(account.platform === 'dingtalk' ? 'authPathDingtalk' : 'authPathWangwang')}</div>
      {account.credentialKey !== undefined && <div className={css.sub}>{t('credentialRef')}: {account.credentialKey}</div>}
      {account.authorization.state === 'required' && <p className={css.sub}>{t('expiredHint')}</p>}
      {disconnected && <p className={css.sub}>{t('disconnectedKeepHint')}</p>}
      {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
      {confirm && props.disconnect !== undefined && <InlineConfirm disabled={busy} cancelLabel={t('cancel')} confirmLabel={t('confirmDisconnect')}
        onCancel={() => { setConfirm(false) }} onConfirm={() => { if (!busy && props.disconnect !== undefined) void run(() => props.disconnect!(account.id), t('disconnectedKeepHint')) }}>
        {t('disconnectKeepRules').replace('{count}', String(props.routeCount))}
      </InlineConfirm>}
      {lifecycle === undefined && <p className={css.hint}>{t('accountLifecycleUnavailable')}</p>}
    </div>
    <div className={css.statuses}>
      <Tag tone={account.authorization.state === 'ready' ? 'success' : account.authorization.state === 'unchecked' ? 'neutral' : 'danger'}>{t(authorizationKey(account))}</Tag>
      <Tag tone={account.listener.state === 'running' ? 'success' : account.paused ? 'warning' : 'neutral'}>{t(listenerKey(account))}</Tag>
    </div>
    <div className={css.acts}>
      <Switch checked={!account.paused} disabled={busy || !accountUsable(account)} label={`${account.displayName} ${t('autoHandling')}`}
        onChange={enabled => { void run(() => props.setPaused(account, !enabled), t(enabled ? 'accountResumed' : 'accountPaused')) }} />
      <Button variant="outline" size="sm" disabled={busy || lifecycle === undefined} onClick={() => {
        if (disconnected && props.reconnect !== undefined) void run(() => props.reconnect!(account.id), t('accountSaved'))
        else setConfirm(true)
      }}>{t(disconnected ? 'reconnect' : 'disconnect')}</Button>
    </div>
  </div>
}

type AddAccountProps = {
  readonly t: AccountsSectionProps['t']
  readonly candidates: ImAccountCandidatesState
  readonly loadCandidates: AccountsFace['loadCandidates']
  readonly connect: AccountsFace['connect']
  readonly onCancel: () => void
  readonly onConnected: () => void
}

function candidateKey(candidate: ImAccountCandidate): string {
  return candidate.platform === 'dingtalk' ? candidate.profile : candidate.candidateId
}

function AddAccountForm(props: AddAccountProps): ReactElement {
  const [platform, setPlatform] = useState<ImPlatform | null>(null)
  const [step, setStep] = useState<'platform' | 'account'>('platform')
  const [selected, setSelected] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [accessKeySecret, setAccessKeySecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => { controller.abort() }
  }, [])
  const candidates = platform === null ? undefined : props.candidates[platform]
  const candidate = candidates?.items.find(item => candidateKey(item) === selected && item.platform === platform)
  const discover = (): void => {
    if (platform === null) return
    setError(undefined)
    void props.loadCandidates(platform, lifetime.current.signal).catch(reason => {
      if (!lifetime.current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const connect = async (): Promise<void> => {
    if (busy || candidate === undefined) return
    if (candidate.platform === 'wangwang' && (accessKeyId.trim() === '' || accessKeySecret === '')) {
      setError(props.t(accessKeyId.trim() === '' ? 'accessKeyRequired' : 'secretRequired')); return
    }
    setBusy(true); setError(undefined)
    try {
      const request = candidate.platform === 'dingtalk'
        ? { platform: candidate.platform, profile: candidate.profile, ...displayName.trim() === '' ? {} : { displayName: displayName.trim() } }
        : { platform: candidate.platform, candidateId: candidate.candidateId, accessKeyId: accessKeyId.trim(), accessKeySecret, ...displayName.trim() === '' ? {} : { displayName: displayName.trim() } }
      const result = await props.connect(request, lifetime.current.signal)
      if (lifetime.current.signal.aborted) return
      if (result.ok) { setAccessKeySecret(''); props.onConnected() }
      else setError(result.message)
    } catch (reason) {
      if (!lifetime.current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  const { t } = props
  return <div className={css.form} data-im-add-account>
    {step === 'platform' ? <>
      <p className={css.hint}>{t('pickPlatform')}</p>
      <div className={css.pick}>{(['dingtalk', 'wangwang'] as const).map(value => <Button key={value} variant={platform === value ? 'primary' : 'outline'}
        onClick={() => { setPlatform(value); setSelected('') }}>{t(value)}</Button>)}</div>
      <div className={css.acts}><Button variant="outline" onClick={props.onCancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={platform === null} onClick={() => { setStep('account'); discover() }}>{t('next')}</Button></div>
    </> : <>
      <label>{t('accountCandidate')}<select aria-label={t('accountCandidate')} value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setError(undefined) }}>
        <option value="">{t('selectAccountCandidate')}</option>
        {candidates?.items.filter(item => item.platform === platform).map(item => <option key={candidateKey(item)} value={candidateKey(item)}>{item.displayName}</option>)}
      </select></label>
      {candidates?.phase === 'loading' && <p role="status">{t('loading')}</p>}
      {candidates?.phase === 'ready' && candidates.items.length === 0 && <p className={css.hint}>{t('noAccountCandidates')}</p>}
      {candidates?.error !== undefined && <p role="alert" className={css.error}>{candidates.error}</p>}
      <Button variant="ghost" size="sm" disabled={busy || candidates?.phase === 'loading'} onClick={discover}>{t('refreshCandidates')}</Button>
      <label>{t('accountDisplayName')}<Input aria-label={t('accountDisplayName')} value={displayName} disabled={busy} onChange={event => { setDisplayName(event.target.value) }} /></label>
      {platform === 'wangwang' && <>
        <label>{t('accessKey')}<Input aria-label={t('accessKey')} value={accessKeyId} disabled={busy} onChange={event => { setAccessKeyId(event.target.value) }} /></label>
        <label>{t('secretKey')}<span className={css.fieldRow}><Input aria-label={t('secretKey')} type={showSecret ? 'text' : 'password'} value={accessKeySecret} disabled={busy}
          onChange={event => { setAccessKeySecret(event.target.value) }} /><Button variant="ghost" onClick={() => { setShowSecret(value => !value) }}>{t(showSecret ? 'hideSecret' : 'showSecret')}</Button></span></label>
        <p className={css.hint}>{t('secretHint')}</p>
      </>}
      {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.acts}><Button variant="outline" onClick={props.onCancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || candidate === undefined} onClick={() => { void connect() }}>{t(busy ? 'connecting' : 'connect')}</Button></div>
    </>}
  </div>
}
