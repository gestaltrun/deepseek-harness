/** Read-only pooled route information beside the ordinary Models settings. */
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountPoolInjected } from './contract.ts'
import css from './AccountPool.module.css'

type Props = PropsRuntime<'settings.models.footer'> & PropsLocale<'accountPool'> & InjectFace<AccountPoolInjected>

/**
 * Show live route availability without creating or editing Models settings.
 * @param props - directory observation and localized copy.
 * @returns the read-only Models footer.
 */
export function ModelsFooter({ t, useAccountPoolDirectory }: Props) {
  const directory = useAccountPoolDirectory(value => value)
  return <section className={clsx(css.modelsFooter)}>
    <h3>{t('footerTitle')}</h3>
    <p>{t('footerLead')}</p>
    {!directory.loaded ? <p role="status">{t('loading')}</p> : directory.provider === undefined ? <p>{t('footerUnavailable')}</p> : <p><strong>{directory.provider.name}</strong> <code>{directory.provider.id}</code></p>}
    {directory.error !== undefined && <p role="alert">{t('actionFailed', { message: directory.error })}</p>}
  </section>
}
