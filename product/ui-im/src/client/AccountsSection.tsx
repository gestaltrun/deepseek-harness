/** Accepted account settings consume authoritative configuration and provider choices. */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ImAccountCandidate, ImAccountCandidatesState, ImAccountLifecycleRequest, ImAccountView, ImPlatform } from '@gestaltrun/dsh-api-im/client'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountsFace } from './faces.ts'
import type { AccountAction, AccountActionOutcome, AccountActionState, createAccountActionStore } from './account-actions.ts'
import type {} from './locale-types.ts'
import { accountUsable, authorizationKey, listenerKey } from './accounts.ts'
import { InlineConfirm } from './InlineConfirm.tsx'
import css from './AccountsSection.module.css'

/** Derived props for the Accounts settings section. */
export type AccountsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.im'> & PropsStore<ReturnType<typeof createAccountActionStore>> & InjectFace<AccountsFace>

/** @param props - safe account data, choices, localized copy, and commands. @returns the Accounts settings page. */
export function AccountsSection(props: AccountsSectionProps): ReactElement {
  const configuration = props.useConfiguration(state => state)
  const candidates = props.useCandidates(state => state)
  const [adding, setAdding] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const accounts = configuration.value?.accounts ?? []
  const operations = props.useStore(state => state.operations)
  const dispatch = async (action: AccountAction): Promise<AccountActionOutcome> => {
    props.actions.begin(action)
    let outcome: AccountActionOutcome
    try {
      switch (action.kind) {
        case 'pause': outcome = await props.setPaused(action.request); break
        case 'disconnect': outcome = await props.disconnect(action.request); break
        case 'reconnect': outcome = await props.reconnect(action.request); break
        case 'refresh': outcome = await props.refresh(action.request); break
      }
    } catch (reason) {
      outcome = { status: 'unknown', message: reason instanceof Error ? reason.message : String(reason) }
    }
    props.actions.finish(action.request.accountId, action.request.operationId, outcome)
    return outcome
  }
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
      t={props.t} operation={operations[account.id]} dispatch={dispatch} operationId={props.operationId}
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
  readonly operation: AccountActionState | undefined
  readonly dispatch: (action: AccountAction) => Promise<AccountActionOutcome>
  readonly operationId: AccountsFace['operationId']
  readonly onFeedback: (message: string) => void
}

function AccountRow(props: AccountRowProps): ReactElement {
  const { account, t } = props
  const [confirmation, setConfirmation] = useState<{ request: ImAccountLifecycleRequest; routeCount: number; displayName: string }>()
  const busy = props.operation?.status === 'pending'
  const unknown = props.operation?.status === 'unknown'
  const blocked = busy || unknown
  const request = (): ImAccountLifecycleRequest => ({ operationId: props.operationId(), accountId: account.id, observedRevision: account.revision })
  const run = async (action: AccountAction, success: string): Promise<void> => {
    if (blocked) return
    const outcome = await props.dispatch(action)
    setConfirmation(undefined)
    if (outcome.status === 'applied') props.onFeedback(success)
  }
  const disconnected = account.connectionIntent === 'disconnected'
  const failed = props.operation?.status === 'conflict' || props.operation?.status === 'rejected'
  return <div className={css.row} data-account={account.id}>
    <div className={css.rowMain}>
      <div className={css.name}>{t(account.platform)} · {account.displayName}</div>
      <div className={css.sub}>{t(account.platform === 'dingtalk' ? 'authPathDingtalk' : 'authPathWangwang')}</div>
      {account.credentialKey !== undefined && <div className={css.sub}>{t('credentialRef')}: {account.credentialKey}</div>}
      {account.authorization.state === 'required' && <p className={css.sub}>{t('expiredHint')}</p>}
      {disconnected && <p className={css.sub}>{t('disconnectedKeepHint')}</p>}
      {failed && <p role="alert" className={css.error}>{props.operation?.message ?? t('accountChanged')}</p>}
      {unknown && <p role="alert" className={css.error}>{t('accountOperationUnknown')}</p>}
      {confirmation !== undefined && <InlineConfirm disabled={blocked} cancelLabel={t('cancel')} confirmLabel={t('confirmDisconnect')}
        onCancel={() => { setConfirmation(undefined) }} onConfirm={() => { void run({ kind: 'disconnect', request: confirmation.request }, t('disconnectedKeepHint')) }}>
        {confirmation.displayName} · {t('disconnectKeepRules').replace('{count}', String(confirmation.routeCount))}
      </InlineConfirm>}
    </div>
    <div className={css.statuses}>
      <Tag tone={account.authorization.state === 'ready' ? 'success' : account.authorization.state === 'unchecked' ? 'neutral' : 'danger'}>{t(authorizationKey(account))}</Tag>
      <Tag tone={account.listener.state === 'running' ? 'success' : account.paused ? 'warning' : 'neutral'}>{t(listenerKey(account))}</Tag>
    </div>
    <div className={css.acts}>
      <Switch checked={!account.paused} disabled={blocked || !accountUsable(account)} label={`${account.displayName} ${t('autoHandling')}`}
        onChange={enabled => { void run({ kind: 'pause', request: { ...request(), paused: !enabled } }, t(enabled ? 'accountResumed' : 'accountPaused')) }} />
      <Button variant="outline" size="sm" disabled={blocked} onClick={() => {
        if (disconnected) void run({ kind: 'reconnect', request: request() }, t('accountReconnectRequested'))
        else setConfirmation({ request: request(), displayName: account.displayName, routeCount: props.routeCount })
      }}>{t(disconnected ? 'reconnect' : 'disconnect')}</Button>
      <Button variant="outline" size="sm" disabled={blocked} onClick={() => { void run({ kind: 'refresh', request: request() }, t('accountAuthorizationRefreshed')) }}>{t('refreshAuthorization')}</Button>
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
