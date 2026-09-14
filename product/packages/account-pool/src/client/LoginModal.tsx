/** Login dialog: device, PKCE, or GLM Coding Plan key. */
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, Input, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountPoolLoginKind, AccountPoolLoginStart, AccountPoolLoginState } from '../account-pool.ts'
import { ProviderIcon } from './ProviderIcon.tsx'
import type { AccountPoolCopy } from './quota-display.ts'
import css from './LoginModal.module.css'
import { AccountDialog } from './AccountDialog.tsx'

export interface LoginModalProps {
  t: AccountPoolCopy
  initialProvider: AccountPoolLoginKind
  login?: AccountPoolLoginStart
  onClose: () => void
  onStart: (kind: AccountPoolLoginKind) => void
  onCancel: (state: AccountPoolLoginState) => void
  onOpenExternal: (url: string) => void
  onSubmitCallback: (input: { provider: AccountPoolLoginKind; redirectUrl: string }) => void
  busy?: boolean
  error?: string
  onSubmitGlmKey: (input: { apiKey: string; site: 'cn' | 'international'; organization?: string; project?: string }) => void
}

export function LoginModal({
  t, initialProvider, login, onClose, onStart, onCancel, onOpenExternal, onSubmitCallback, onSubmitGlmKey, busy = false, error,
}: LoginModalProps) {
  const [provider, setProvider] = useState<AccountPoolLoginKind>(initialProvider)
  const [glmApiKey, setGlmApiKey] = useState('')
  const [glmSite, setGlmSite] = useState<'cn' | 'international'>('cn')
  const [glmScope, setGlmScope] = useState<'personal' | 'team'>('personal')
  const [organization, setOrganization] = useState('')
  const [project, setProject] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const isGlm = provider === 'glm'
  const isDevice = provider === 'kimi' || provider === 'xai'
  const step = login === undefined ? (isGlm ? 'apiKeyForm' : 'select') : login.status === 'complete' ? 'complete' : login.status === 'error' ? 'failed' : login.flow === 'glm-key' ? 'apiKeyForm' : 'authorizing'
  const cancelState = login?.state

  useEffect(() => { setProvider(initialProvider) }, [initialProvider])
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => { setCopied(false) }, 1_500)
    return () => { window.clearTimeout(timer) }
  }, [copied])

  return (
    <AccountDialog title={t('loginTitle')} description={t('loginLead')} closeLabel={t('close')} onClose={onClose}>
      {error !== undefined && <p role="alert" className={clsx(css.error)}>{t('actionFailed', { message: error })}</p>}
        <div className={clsx(css.body)}>
          {step === 'select' && (
            <div className={clsx(css.providerList)}>
              <label className={clsx(css.label)}>{t('chooseProvider')}</label>
              <div className={clsx(css.grid)}>
                {(['kimi', 'xai', 'codex', 'anthropic', 'antigravity', 'glm'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={clsx(css.providerCard, provider === kind ? css.selected : '')}
                    data-testid={`provider-card-${kind}`}
                    aria-label={t(`provider.${kind}`)}
                    onClick={() => { setProvider(kind) }}
                  >
                    <span className={clsx(css.providerIcon)}><ProviderIcon provider={kind} /></span>
                    <strong>{t(`provider.${kind}`)}</strong>
                    <span>{kind === 'glm' ? t('flowKey') : kind === 'kimi' || kind === 'xai' ? t('flowDevice') : t('flowPkce')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 'authorizing' && login !== undefined && (
            <div className={clsx(css.authStep)}>
              <div className={clsx(css.spinner)} />
              <h4>{t('waitingAuth', { provider: t(`provider.${provider}`), flow: isDevice ? t('flowDevice') : t('flowPkce') })}</h4>
              {login.url !== undefined && (
                <>
                  <div className={clsx(css.urlBox)}>{login.url}</div>
                  <div className={clsx(css.linkActions)}>
                    <Button variant="ghost" onClick={() => {
                      const url = login.url
                      if (url === undefined) return
                      void writeClipboard(url).then(ok => {
                        setCopied(ok)
                      }).catch(() => {
                        // Clipboard can be missing in a sandboxed renderer; the URL remains visible.
                      })
                    }}>{copied ? t('copied') : t('copyLink')}</Button>
                    <Button variant="primary" onClick={() => { onOpenExternal(login.url ?? '') }}>
                      {t('openBrowser')}
                    </Button>
                  </div>
                </>
              )}
              {login.userCode !== undefined && (
                <div className={clsx(css.deviceCodeBox)}><span>{t('deviceCode')}</span><strong>{login.userCode}</strong></div>
              )}
              {!isDevice && (
                <div className={clsx(css.callbackBox)}>
                  <label className={clsx(css.fieldLabel)} htmlFor="account-pool-callback-url">{t('callbackUrl')}</label>
                  <Input
                    id="account-pool-callback-url"
                    className={clsx(css.textInput)}
                    value={callbackUrl}
                    placeholder={t('placeholderCallback')}
                    onChange={(event) => { setCallbackUrl(event.target.value) }}
                  />
                  <p className={clsx(css.fieldTip)}>{t('callbackTip')}</p>
                  <Button variant="outline" disabled={busy || callbackUrl.trim().length === 0} onClick={() => {
                    onSubmitCallback({ provider, redirectUrl: callbackUrl.trim() })
                  }}>{t('submitCallback')}</Button>
                </div>
              )}
            </div>
          )}
          {step === 'apiKeyForm' && (
            <div className={clsx(css.formStep)}>
              <div className={clsx(css.formBadge)}>{t('glmBadge')}</div>
              <h4 className={clsx(css.formTitle)}>{t('glmTitle')}</h4>
              <div className={clsx(css.fieldGroup)}>
                <label className={clsx(css.fieldLabel)} htmlFor="account-pool-glm-key">{t('glmKey')}</label>
                <Input id="account-pool-glm-key" type="password" className={clsx(css.textInput)} value={glmApiKey} onChange={(event) => { setGlmApiKey(event.target.value) }} autoComplete="off" />
              </div>
              <div className={clsx(css.fieldGroup)}>
                <label className={clsx(css.fieldLabel)} htmlFor="account-pool-glm-site">{t('glmSite')}</label>
                <select id="account-pool-glm-site" className={clsx(css.textInput)} value={glmSite} onChange={(event) => { setGlmSite(event.target.value as 'cn' | 'international') }}>
                  <option value="cn">open.bigmodel.cn</option>
                  <option value="international">api.z.ai</option>
                </select>
              </div>
              <div className={clsx(css.fieldGroup)}>
                <span className={clsx(css.fieldLabel)}>{t('glmScope')}</span>
                <label className={clsx(css.choice)}>
                  <input type="radio" name="account-pool-glm-scope" checked={glmScope === 'personal'} onChange={() => { setGlmScope('personal') }} />
                  {t('glmPersonal')}
                </label>
                <label className={clsx(css.choice)}>
                  <input type="radio" name="account-pool-glm-scope" checked={glmScope === 'team'} onChange={() => { setGlmScope('team') }} />
                  {t('glmTeam')}
                </label>
              </div>
              {glmScope === 'team' && (
                <>
                  <div className={clsx(css.fieldGroup)}>
                    <label className={clsx(css.fieldLabel)} htmlFor="account-pool-glm-org">{t('glmOrg')}</label>
                    <Input id="account-pool-glm-org" className={clsx(css.textInput)} value={organization} onChange={(event) => { setOrganization(event.target.value) }} />
                  </div>
                  <div className={clsx(css.fieldGroup)}>
                    <label className={clsx(css.fieldLabel)} htmlFor="account-pool-glm-project">{t('glmProject')}</label>
                    <Input id="account-pool-glm-project" className={clsx(css.textInput)} value={project} onChange={(event) => { setProject(event.target.value) }} />
                  </div>
                </>
              )}
            </div>
          )}
          {step === 'complete' && <p role="status">{t('loginComplete')}</p>}
          {step === 'failed' && login !== undefined && (
            <div className={clsx(css.resultStep)}><h4>{login.error}</h4></div>
          )}
        </div>
        <footer className={clsx(css.footer)}>
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { onStart(provider) }}>
                {t('startLogin', { provider: t(`provider.${provider}`) })}
              </Button>
            </>
          )}
          {step === 'authorizing' && (
            cancelState === undefined
              ? <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
              : <Button variant="outline" onClick={() => { onCancel(cancelState) }}>{t('cancel')}</Button>
          )}
          {(step === 'failed' || step === 'complete') && (
            <Button variant="primary" onClick={onClose}>{t('close')}</Button>
          )}
          {step === 'apiKeyForm' && (
            <>
              <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
              <Button variant="primary" disabled={busy || glmApiKey.trim().length === 0 || glmScope === 'team' && organization.trim().length === 0} onClick={() => {
                if (glmScope === 'team' && organization.trim().length === 0) return
                onSubmitGlmKey({
                  apiKey: glmApiKey,
                  site: glmSite,
                  ...glmScope === 'team' ? { organization: organization.trim() } : {},
                  ...glmScope === 'team' && project.trim().length > 0 ? { project: project.trim() } : {},
                })
              }}>{t('glmSave')}</Button>
            </>
          )}
        </footer>
    </AccountDialog>
  )
}
