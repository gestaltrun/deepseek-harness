/** Redacted field reads and explicit account editing intents. */
import clsx from 'clsx'
import { useState } from 'react'
import { Button, Input, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AccountPoolAccount, AccountPoolAccountName, AccountPoolEditableFields, AccountPoolFieldPatch,
} from '../account-pool.ts'
import { AccountDialog } from './AccountDialog.tsx'
import { ExcludedModelsPicker, type ExcludedModelOption } from './ExcludedModelsPicker.tsx'
import type { AccountPoolCopy } from './quota-display.ts'
import css from './LoginModal.module.css'
import poolCss from './AccountPool.module.css'

/** Identity-scoped field reads and mutation outcomes for an account dialog. */
export interface SettingsDialogProps {
  t: AccountPoolCopy
  account: AccountPoolAccount
  details?: AccountPoolEditableFields
  models?: readonly ExcludedModelOption[]
  saving: boolean
  error?: string
  onClose: () => void
  onSave: (name: AccountPoolAccountName, fields: AccountPoolFieldPatch) => void
}

/**
 * Wait for the named field read before allowing edits; failed saves retain the draft.
 * @param props - account, field read, capabilities, and save outcome.
 * @returns the field editor or its pending/error state.
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { t, account, details, onClose, error } = props
  if (details === undefined) {
    return <AccountDialog title={t('settingsTitle')} description={account.name} closeLabel={t('close')} onClose={onClose}>
      {error === undefined ? <p role="status">{t('loading')}</p> : <p role="alert">{t('actionFailed', { message: error })}</p>}
    </AccountDialog>
  }
  return <SettingsForm {...props} details={details} />
}

function SettingsForm({ t, account, details, models = [], onClose, onSave, saving, error }: SettingsDialogProps & { details: AccountPoolEditableFields }) {
  const editable = new Set(account.capabilities.editableFields)
  const seed = details.fields
  const [note, setNote] = useState(seed.note ?? '')
  const [prefix, setPrefix] = useState(seed.prefix ?? '')
  const [proxyMode, setProxyMode] = useState<'keep' | 'replace' | 'remove'>('keep')
  const [proxyUrl, setProxyUrl] = useState('')
  const [priority, setPriority] = useState(
    seed.priority === undefined ? '' : String(seed.priority),
  )
  const [weight, setWeight] = useState(
    seed.weight === undefined ? '1' : String(seed.weight),
  )
  const [disableCooling, setDisableCooling] = useState(seed.disableCooling === true)
  const [websockets, setWebsockets] = useState(seed.websockets === true)
  const [excludedExact, setExcludedExact] = useState((seed.excludedModels ?? []).filter(item => !item.includes('*')))
  const [excludedWildcards, setExcludedWildcards] = useState((seed.excludedModels ?? []).filter(item => item.includes('*')).join('\n'))
  const [headersText, setHeadersText] = useState('{}')
  const [headerEdits, setHeaderEdits] = useState<NonNullable<AccountPoolFieldPatch['headers']>>({})
  const [headersError, setHeadersError] = useState<string | undefined>()
  const preview = details.info
  return (
    <AccountDialog title={t('settingsTitle')} description={account.name} closeLabel={t('close')} onClose={onClose}>
      {error !== undefined && <p role="alert" className={clsx(css.error)}>{t('actionFailed', { message: error })}</p>}
      {account.capabilities.editableFields.length < 9 && <p className={css.fieldTip}>{t('limitedFields')}</p>}
      <div className={poolCss.settingsBody}>
        <section className={poolCss.settingsSection}>
          <h4>{t('settingsInfo')}</h4>
          <pre className={poolCss.jsonPreview}>{JSON.stringify(preview, undefined, 2)}</pre>
        </section>
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-prefix">{t('fieldPrefix')}</label>
        <Input disabled={!editable.has('prefix')} id="account-pool-prefix" className={clsx(css.textInput)} value={prefix} onChange={(event) => { setPrefix(event.target.value) }} />
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-proxy">{t('fieldProxy')}</label>
        <p className={clsx(css.fieldTip)}>{seed?.proxyUrl ?? ''}{seed?.proxyCredentialsConfigured === true ? ` · ${t('proxyCredentialsConfigured')}` : ''}</p>
        <select disabled={!editable.has('proxyUrl')} aria-label={t('fieldProxy')} value={proxyMode} onChange={event => { setProxyMode(event.target.value as 'keep' | 'replace' | 'remove') }}>
          {(['keep', 'replace', 'remove'] as const).map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
        </select>
        <Input
          disabled={proxyMode !== 'replace' || !editable.has('proxyUrl')}
          id="account-pool-proxy"
          className={clsx(css.textInput)}
          value={proxyUrl}
          placeholder={t('placeholderProxy')}
          onChange={(event) => { setProxyUrl(event.target.value) }}
        />
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-priority">{t('fieldPriority')}</label>
        <Input
          disabled={!editable.has('priority')} id="account-pool-priority"
          className={clsx(css.textInput)}
          value={priority}
          placeholder={t('placeholderPriority')}
          onChange={(event) => { setPriority(event.target.value) }}
        />
        <p className={clsx(css.fieldTip)}>{t('fieldPriorityTip')}</p>
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-weight">{t('fieldWeight')}</label>
        <Input
          disabled={!editable.has('weight')} id="account-pool-weight"
          className={clsx(css.textInput)}
          value={weight}
          onChange={(event) => { setWeight(event.target.value) }}
        />
        <p className={clsx(css.fieldTip)}>{t('fieldWeightTip')}</p>
        <div className={poolCss.toggleRow}>
          <Switch disabled={!editable.has('disableCooling')} checked={disableCooling} onChange={setDisableCooling} label={t('fieldCooling')} />
          <span>{t('fieldCooling')}</span>
        </div>
        <p className={clsx(css.fieldTip)}>{t('fieldCoolingTip')}</p>
        <div className={poolCss.toggleRow}>
          <Switch disabled={!editable.has('websockets')} checked={websockets} onChange={setWebsockets} label={t('fieldWebsockets')} />
          <span>{t('fieldWebsockets')}</span>
        </div>
        <p className={clsx(css.fieldTip)}>{t('fieldWebsocketsTip')}</p>
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-excluded">{t('fieldExcluded')}</label>
        <ExcludedModelsPicker disabled={!editable.has('excludedModels')} t={t} models={models} selected={excludedExact} onChange={(next) => { setExcludedExact([...next]) }} />
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-wildcards">{t('fieldWildcards')}</label>
        <textarea
          disabled={!editable.has('excludedModels')}
          id="account-pool-wildcards"
          className={clsx(css.textInput)}
          rows={2}
          placeholder={t('placeholderWildcards')}
          value={excludedWildcards}
          onChange={(event) => { setExcludedWildcards(event.target.value) }}
        />
        <p className={clsx(css.fieldTip)}>{t('fieldWildcardsTip')}</p>
        <h4>{t('fieldHeaders')}</h4>
        {Object.entries(seed?.headers ?? {}).map(([name, header]) => {
          const edit = headerEdits[name] ?? { kind: 'keep' as const }
          return <div key={name} className={clsx(css.fieldGroup)}>
            <span className={clsx(css.fieldLabel)}>{name}</span>
            <p className={clsx(css.fieldTip)}>{header.kind === 'secret' ? t('secretConfigured') : header.value}</p>
            <select disabled={!editable.has('headers')} aria-label={name} value={edit.kind} onChange={event => {
              const kind = event.target.value as 'keep' | 'replace' | 'remove'
              setHeaderEdits(current => ({ ...current, [name]: kind === 'replace' ? { kind, value: '' } : { kind } }))
            }}>
              {(['keep', 'replace', 'remove'] as const).map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}
            </select>
            {edit.kind === 'replace' && <Input aria-label={t('replaceHeader', { name })} type={header.kind === 'secret' ? 'password' : 'text'} autoComplete="off" value={edit.value} onChange={event => { setHeaderEdits(current => ({ ...current, [name]: { kind: 'replace', value: event.target.value } })) }} />}
          </div>
        })}
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-headers">{t('newHeaders')}</label>
        <textarea
          disabled={!editable.has('headers')}
          id="account-pool-headers"
          className={clsx(css.textInput)}
          rows={3}
          value={headersText}
          onChange={(event) => { setHeadersText(event.target.value); setHeadersError(undefined) }}
        />
        <p className={clsx(css.fieldTip)}>{t('fieldHeadersTip')}</p>
        {headersError !== undefined && <p className={clsx(css.fieldTip)}>{headersError}</p>}
        <label className={clsx(css.fieldLabel)} htmlFor="account-pool-note">{t('fieldNote')}</label>
        <Input
          disabled={!editable.has('note')} id="account-pool-note"
          className={clsx(css.textInput)}
          value={note}
          placeholder={t('placeholderNote')}
          onChange={(event) => { setNote(event.target.value) }}
        />
        <p className={clsx(css.fieldTip)}>{t('fieldNoteTip')}</p>
      </div>
      <div className={clsx(css.footer)}>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
        <Button variant="ghost" onClick={() => {
          void writeClipboard(JSON.stringify(preview, undefined, 2)).catch(() => {
            // Clipboard can be missing in a sandboxed renderer; INFO remains visible.
          })
        }}>{t('copy')}</Button>
        <Button variant="primary" disabled={saving} aria-busy={saving} onClick={() => {
          const headers = parseHeaders(headersText)
          if (headers === undefined) {
            setHeadersError(t('headersInvalid'))
            return
          }
          const nextPriority = parseOptionalInt(priority)
          const nextWeight = parseOptionalInt(weight)
          const candidate: AccountPoolFieldPatch = {
            note,
            prefix,
            proxyUrl: proxyMode === 'replace' ? { kind: 'replace', value: proxyUrl } : { kind: proxyMode },
            ...nextPriority === undefined ? {} : { priority: nextPriority },
            ...nextWeight === undefined ? {} : { weight: nextWeight },
            disableCooling,
            websockets,
            excludedModels: [...excludedExact, ...lines(excludedWildcards)],
            headers: { ...headerEdits, ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, { kind: 'replace' as const, value }])) },
          }
          const fields = Object.fromEntries(Object.entries(candidate).filter(([field]) => account.capabilities.editableFields.includes(field as typeof account.capabilities.editableFields[number]))) as AccountPoolFieldPatch
          onSave(account.name, fields)
        }}>{t(saving ? 'saving' : 'save')}</Button>
      </div>
    </AccountDialog>
  )
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) ? parsed : undefined
}

function lines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') return undefined
      out[key] = value
    }
    return out
  } catch {
    return undefined
  }
}
