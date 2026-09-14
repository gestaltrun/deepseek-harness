/** Supported-models overlay: copyable id, display name, and provider chip. */
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountPoolModel } from '../account-pool.ts'
import { AccountDialog } from './AccountDialog.tsx'
import type { AccountPoolCopy } from './quota-display.ts'
import css from './ModelsDialog.module.css'
import poolCss from './AccountPool.module.css'

export function ModelsDialog({
  t,
  name,
  models,
  onClose,
}: {
  t: AccountPoolCopy
  name: string
  models: readonly AccountPoolModel[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string | undefined>()
  useEffect(() => {
    if (copied === undefined) return undefined
    const timer = window.setTimeout(() => { setCopied(undefined) }, 1200)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  return (
    <AccountDialog
      title={t('modelsTitle', { name })}
      {...models.length === 0 ? {} : { description: t('modelsCount', { count: models.length }) }}
      closeLabel={t('close')}
      onClose={onClose}
    >
      {models.length === 0 ? (
        <p className={poolCss.dialogEmpty}>{t('modelsEmpty')}</p>
      ) : (
        <ul className={clsx(css.list)} data-testid="account-pool-models-dialog">
          {models.map(model => (
            <li key={model.id}>
              <button
                type="button"
                className={clsx(css.row)}
                onClick={() => {
                  void writeClipboard(model.id).then(ok => {
                    if (ok) setCopied(model.id)
                  }).catch(() => {
                    // Clipboard can be missing in a sandboxed renderer.
                  })
                }}
              >
                <span className={clsx(css.id)}>{model.id}</span>
                {model.name !== undefined && model.name !== model.id && <span className={clsx(css.display)}>{model.name}</span>}
                {model.ownedBy !== undefined && <span className={clsx(css.owner)}>{model.ownedBy}</span>}
                <span className={clsx(css.copy)}>{copied === model.id ? t('copied') : t('copy')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={clsx(css.footer)}>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
      </div>
    </AccountDialog>
  )
}
