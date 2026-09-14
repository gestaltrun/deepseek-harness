/** Built-in CLIProxyAPI account pool: dual-face cards and supported logins. */
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AccountPoolAccount, AccountPoolAccountRef, AccountPoolEditableFields, AccountPoolModel,
} from '../account-pool.ts'
import { AccountCard } from './AccountCard.tsx'
import { AccountDialog } from './AccountDialog.tsx'
import { LoginModal } from './LoginModal.tsx'
import { ModelsDialog } from './ModelsDialog.tsx'
import { PROVIDER_FILTERS, ProviderIcon, providerDisplayName } from './ProviderIcon.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'
import css from './AccountPool.module.css'
import type { AccountPoolInjected } from './contract.ts'
import type { createAccountPoolViewStore } from './view-store.ts'

/** Framework-derived Settings inputs and account-management callbacks. */
export type AccountPoolControlProps = PropsRuntime<'settings.section'>
  & PropsLocale<'accountPool'>
  & PropsStore<ReturnType<typeof createAccountPoolViewStore>>
  & InjectFace<AccountPoolInjected>

interface OpenModels {
  readonly name: string
  readonly models: readonly AccountPoolModel[]
  readonly scope: AccountPoolAccount['capabilities']['models']
}

interface OpenSettings {
  readonly account: AccountPoolAccount
  readonly details?: AccountPoolEditableFields
  readonly models?: readonly { id: string; name?: string }[]
  readonly error?: string
}

/**
 * Render account enrollment, cards, and identity-scoped editing dialogs.
 * @param props - account observations, Client actions, and viewing preferences.
 * @returns the account-pool Settings section.
 */
export function AccountPoolControl({ t, useAccountPool, accountPoolActions: client, useStore, actions }: AccountPoolControlProps) {
  const snapshot = useAccountPool(value => value)
  const { face: globalFace, faceRevision: globalEpoch, filter } = useStore(value => value)
  const [error, setError] = useState<string>()
  const [loginBusy, setLoginBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const dialogGeneration = useRef(0)
  const modelGeneration = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; dialogGeneration.current++; modelGeneration.current++ }
  }, [])
  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    setError(undefined)
    try { await operation(); return true }
    catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
      return false
    }
  }
  const loginAction = async (operation: () => Promise<unknown>): Promise<void> => {
    setLoginBusy(true)
    await run(operation)
    if (mounted.current) setLoginBusy(false)
  }
  const [loginOpen, setLoginOpen] = useState(false)
  const [refreshingQuota, setRefreshingQuota] = useState<readonly AccountPoolAccountRef[]>([])
  const [refreshingAllQuota, setRefreshingAllQuota] = useState(false)
  const [deleting, setDeleting] = useState<AccountPoolAccountRef>()
  const [refreshingRoster, setRefreshingRoster] = useState(false)
  const [modelsDialog, setModelsDialog] = useState<OpenModels | undefined>()
  const [settingsDialog, setSettingsDialog] = useState<OpenSettings | undefined>()
  const [pendingDelete, setPendingDelete] = useState<AccountPoolAccount | undefined>()
  const hadLogin = useRef(false)
  useEffect(() => {
    if (snapshot.login !== undefined) {
      hadLogin.current = true
      return
    }
    if (hadLogin.current) {
      hadLogin.current = false
      setLoginOpen(false)
    }
  }, [snapshot.login])
  const accounts = snapshot.accounts.filter(account => filter === 'all' || account.provider === filter || (filter === 'anthropic' && account.provider === 'claude'))
  const commandFace = (face: 'A' | 'B'): void => {
    actions.face(face)
  }
  return (
    <section className={clsx(css.poolHost)} data-account-pool-state={snapshot.state}>
      <header className={clsx(css.workspaceHeader)}>
        <div className={clsx(css.headerLeft)}>
          <div className={clsx(css.titleRow)}>
            <h2 className={clsx(css.pageTitle)} data-testid="account-pool-title">{t('title')}</h2>
            <span className={clsx(css.titleStatus)} data-testid="account-pool-status">
              <span className={snapshot.state === 'ready' ? css.healthyDot : css.runtimeText} />
              <span className={clsx(css.runtimeText)}>{snapshot.state === 'ready' ? t('running') : snapshot.error ?? t('starting')}</span>
            </span>
          </div>
          <div className={clsx(css.summaryCounts)}>
            <span>{t('credentialsCount', { count: snapshot.accounts.length })}</span>
            <span className={clsx(css.countActive)}>{t('enabledCount', { count: snapshot.accounts.filter(account => account.enabled).length })}</span>
          </div>
        </div>
        <div className={clsx(css.headerRight)}>
          <div className={clsx(css.globalFaceSwitch)}>
            <span className={clsx(css.switchTitle)}>{t('cardView')}</span>
            <div className={clsx(css.switchGroup)}>
              <button type="button" className={clsx(css.faceBtn, globalFace === 'A' ? css.faceBtnActive : '')} onClick={() => { commandFace('A') }} data-testid="global-face-btn-a">
                {t('faceManage')}
              </button>
              <button type="button" className={clsx(css.faceBtn, globalFace === 'B' ? css.faceBtnActive : '')} onClick={() => { commandFace('B') }} data-testid="global-face-btn-b">
                {t('faceQuota')}
              </button>
            </div>
          </div>
          <Button
            variant="ghost"
            disabled={refreshingAllQuota || refreshingQuota.length > 0}
            aria-busy={refreshingAllQuota}
            icon={<span className={refreshingAllQuota ? css.spinning : undefined} aria-hidden>↻</span>}
            onClick={() => {
              setRefreshingAllQuota(true)
              void run(() => client.refreshAllQuota()).finally(() => { if (mounted.current) setRefreshingAllQuota(false) })
            }}
          >
            {t('refreshAllQuota')}
          </Button>
          <Button variant="primary" onClick={() => { setLoginOpen(true) }}>{t('addAccount')}</Button>
        </div>
      </header>
      {error !== undefined && <p role="alert" className={clsx(css.error)}>{t('actionFailed', { message: error })}</p>}
      <div className={clsx(css.filterBar)}>
        <Pill active={filter === 'all'} onClick={() => { actions.filter('all') }} data-testid="filter-all">
          <span className={clsx(css.filterLabel)}><ProviderIcon provider="all" />{t('filterAll', { count: snapshot.accounts.length })}</span>
        </Pill>
        {PROVIDER_FILTERS.map(provider => (
          <Pill key={provider} active={filter === provider} onClick={() => { actions.filter(provider) }} data-testid={`filter-${provider}`}>
            <span className={clsx(css.filterLabel)}>
              <ProviderIcon provider={provider} />
              {providerDisplayName(provider)} ({snapshot.accounts.filter(account => account.provider === provider || (provider === 'anthropic' && account.provider === 'claude')).length})
            </span>
          </Pill>
        ))}
      </div>
      {snapshot.state === 'ready' && snapshot.accounts.length === 0 && <p className={clsx(css.dialogEmpty)}>{t('emptyPool')}</p>}
      <div className={clsx(css.cardsGrid)}>
        {accounts.map(account => (
          <AccountCard
            key={account.ref}
            t={t}
            item={account}
            globalFace={globalFace}
            globalEpoch={globalEpoch}
            refreshingQuota={refreshingAllQuota || refreshingQuota.includes(account.ref)}
            refreshingRoster={refreshingRoster}
            onToggleStatus={(name, enabled) => { void run(() => client.setEnabled(name, enabled)) }}
            onRefreshQuota={(ref) => {
              setRefreshingQuota(current => [...current, ref])
              void run(() => client.refreshQuota(ref)).finally(() => { if (mounted.current) setRefreshingQuota(current => current.filter(item => item !== ref)) })
            }}
            onDelete={() => { setPendingDelete(account) }}
            onListModels={(name) => {
              const generation = ++modelGeneration.current
              void run(async () => {
                const models = await client.listModels(name)
                if (mounted.current && generation === modelGeneration.current) setModelsDialog({ name, models, scope: account.capabilities.models })
              })
            }}
            onRefresh={() => {
              setRefreshingRoster(true)
              void run(() => client.refresh()).finally(() => { if (mounted.current) setRefreshingRoster(false) })
            }}
            onDownload={(name) => { void run(() => client.download(name)) }}
            onEditSettings={(item) => {
              const generation = ++dialogGeneration.current
              setSettingsDialog({ account: item })
              setSaving(false)
              const current = (): boolean => mounted.current && generation === dialogGeneration.current
              void client.readFields(item.name).then(details => {
                if (current()) setSettingsDialog(value => value?.account.name === item.name ? { ...value, details } : value)
              }).catch(failure => {
                if (current()) setSettingsDialog(value => value === undefined ? value : { ...value, error: failure instanceof Error ? failure.message : String(failure) })
              })
              void client.listModels(item.name).then(models => {
                if (current()) setSettingsDialog(value => value?.account.name === item.name ? { ...value, models } : value)
              }).catch(failure => {
                if (current()) setSettingsDialog(value => value === undefined ? value : { ...value, error: failure instanceof Error ? failure.message : String(failure) })
              })
            }}
          />
        ))}
      </div>
      {pendingDelete !== undefined && (
        <AccountDialog
          title={t('deleteTitle')}
          description={pendingDelete.name}
          closeLabel={t('close')}
          onClose={() => { setPendingDelete(undefined) }}
        >
          <p className={clsx(css.dialogEmpty)}>{t('deleteBody')}</p>
          <div className={clsx(css.confirmFooter)}>
            <Button variant="ghost" data-testid="delete-cancel" onClick={() => { setPendingDelete(undefined) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              data-testid="delete-confirm"
              disabled={deleting !== undefined}
              aria-busy={deleting === pendingDelete.ref}
              onClick={() => {
                const { name, ref } = pendingDelete
                setDeleting(ref)
                void run(() => client.deleteAccount(name)).then(ok => {
                  if (ok && mounted.current) setPendingDelete(current => current?.ref === ref ? undefined : current)
                }).finally(() => { if (mounted.current) setDeleting(undefined) })
              }}
            >
              {t('deleteConfirm')}
            </Button>
          </div>
        </AccountDialog>
      )}
      {modelsDialog !== undefined && (
        <ModelsDialog
          t={t}
          name={modelsDialog.name}
          models={modelsDialog.models}
          scope={modelsDialog.scope}
          onClose={() => { modelGeneration.current++; setModelsDialog(undefined) }}
        />
      )}
      {settingsDialog !== undefined && (
        <SettingsDialog
          key={settingsDialog.account.name}
          t={t}
          account={settingsDialog.account}
          saving={saving}
          {...settingsDialog.error === undefined ? {} : { error: settingsDialog.error }}
          {...settingsDialog.details === undefined ? {} : { details: settingsDialog.details }}
          {...settingsDialog.models === undefined ? {} : { models: settingsDialog.models }}
          onClose={() => { dialogGeneration.current++; setSettingsDialog(undefined) }}
          onSave={(name, fields) => {
            const generation = dialogGeneration.current
            setSaving(true)
            void client.patchFields(name, fields).then(() => {
              if (mounted.current && generation === dialogGeneration.current) setSettingsDialog(undefined)
            }).catch(failure => {
              if (mounted.current && generation === dialogGeneration.current) setSettingsDialog(value => value === undefined ? value : { ...value, error: failure instanceof Error ? failure.message : String(failure) })
            }).finally(() => { if (mounted.current && generation === dialogGeneration.current) setSaving(false) })
          }}
        />
      )}
      {(loginOpen || snapshot.login !== undefined) && (
        <LoginModal
          t={t}
          busy={loginBusy}
          {...error === undefined ? {} : { error }}
          initialProvider={snapshot.login?.kind ?? 'kimi'}
          {...snapshot.login === undefined ? {} : { login: snapshot.login }}
          onClose={() => {
            setLoginOpen(false)
            void loginAction(() => client.dismissLogin())
          }}
          onStart={(kind) => { void loginAction(() => client.startLogin(kind)) }}
          onCancel={(state) => { void loginAction(() => client.cancelLogin(state)) }}
          onOpenExternal={(url) => { void run(() => client.openExternal(url)) }}
          onSubmitCallback={(input) => { void loginAction(() => client.submitCallback(input)) }}
          onSubmitGlmKey={(input) => { void loginAction(async () => { await client.submitGlmKey(input); if (mounted.current) setLoginOpen(false) }) }}
        />
      )}
    </section>
  )
}
