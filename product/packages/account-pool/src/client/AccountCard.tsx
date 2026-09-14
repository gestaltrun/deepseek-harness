/** Dual-face account card: management on A, quota on B. */
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountPoolAccount, AccountPoolAccountName, AccountPoolAccountRef } from '../account-pool.ts'
import { quotaPlanLabel, quotaResetText, visibleQuotaWindows, type AccountPoolCopy, type VisibleQuotaWindow } from './quota-display.ts'
import { ProviderIcon, providerDisplayName } from './ProviderIcon.tsx'
import { QuotaBarWithTimeline } from './QuotaBarWithTimeline.tsx'
import css from './AccountCard.module.css'

export interface AccountCardProps {
  t: AccountPoolCopy
  item: AccountPoolAccount
  globalFace: 'A' | 'B'
  globalEpoch: number
  refreshingQuota?: boolean
  refreshingRoster?: boolean
  onToggleStatus: (name: AccountPoolAccountName, enabled: boolean) => void
  onRefreshQuota: (authIndex: AccountPoolAccountRef) => void
  onDelete: (name: AccountPoolAccountName) => void
  onListModels: (name: AccountPoolAccountName) => void
  onRefresh: () => void
  onDownload: (name: AccountPoolAccountName) => void
  onEditSettings: (account: AccountPoolAccount) => void
}

export function AccountCard({
  t, item, globalFace, globalEpoch, refreshingQuota = false, refreshingRoster = false,
  onToggleStatus, onRefreshQuota, onDelete,
  onListModels, onRefresh, onDownload, onEditSettings,
}: AccountCardProps) {
  const [localOverride, setLocalOverride] = useState<'A' | 'B' | null>(null)
  useEffect(() => { setLocalOverride(null) }, [globalEpoch])
  const currentFace = localOverride ?? globalFace
  const flipFace = (): void => { setLocalOverride(currentFace === 'A' ? 'B' : 'A') }
  const quotaWindows = visibleQuotaWindows(item.quota, t)
  return (
    <div className={clsx(css.card, item.enabled ? '' : css.cardDisabled)} data-testid={`account-card-${item.authIndex}`} data-current-face={currentFace}>
      <div className={clsx(css.cardTop)}>
        <div className={clsx(css.providerBadge)}>
          <span className={clsx(css.providerIcon)}><ProviderIcon provider={item.provider} /></span>
          <div className={clsx(css.titleBox)}>
            <strong className={clsx(css.filename)} title={item.name}>{item.name}</strong>
            <span className={clsx(css.providerLabel)}>{providerDisplayName(item.provider)} · {item.label}</span>
          </div>
        </div>
        <div className={clsx(css.topRightActions)}>
          <button type="button" className={clsx(css.faceFlipBtn)} onClick={flipFace} data-testid={`card-flip-btn-${item.authIndex}`}>
            {currentFace === 'A' ? t('flipToQuota') : t('flipToManage')}
          </button>
          <span className={clsx(css.statusBadge, item.enabled ? css.status_active : css.status_expired)}>
            {item.enabled ? t('enabled') : t('disabled')}
          </span>
        </div>
      </div>
      {currentFace === 'A' && (
        <div className={clsx(css.faceA)} data-testid="card-face-a">
          {item.statusMessage !== undefined && item.statusMessage.length > 0 && <div className={clsx(css.alertBanner)}>{item.statusMessage}</div>}
          <div className={clsx(css.healthSection)}>
            <div className={clsx(css.healthHeader)}>
              <span>{t('health')}</span>
              <span>{t('successFail', { success: item.successCount, fail: item.failCount })}</span>
            </div>
            <div className={clsx(css.healthTicks)} data-testid={`health-ticks-${item.authIndex}`}>
              {healthTicks(item.recentRequests).map((tick, index) => (
                <span key={index} className={clsx(css.tick, tick === 'pass' ? css.tickPass : tick === 'fail' ? css.tickFail : css.tickEmpty)} />
              ))}
            </div>
          </div>
          <div className={clsx(css.metaFooter)}>
            <span className={clsx(css.dateText)}>{formatMeta(item.sizeBytes, item.modifiedAt ?? item.createdAt, t)}</span>
            <div className={clsx(css.footerActions)}>
              <button type="button" className={clsx(css.iconBtn)} title={t('models')} aria-label={t('models')} onClick={() => { onListModels(item.name) }}>{t('models')}</button>
              <button type="button" className={clsx(css.iconBtn, refreshingRoster ? css.spinning : '')} title={t('refresh')} aria-label={t('refresh')} onClick={onRefresh}>↻</button>
              <button type="button" className={clsx(css.iconBtn)} title={t('download')} aria-label={t('download')} onClick={() => { onDownload(item.name) }}>↓</button>
              <button type="button" className={clsx(css.iconBtn)} title={t('settings')} aria-label={t('settings')} onClick={() => { onEditSettings(item) }}>⚙</button>
              <button type="button" className={clsx(css.iconBtn)} title={t('delete')} aria-label={t('delete')} onClick={() => { onDelete(item.name) }}>🗑</button>
              <Button size="sm" variant="ghost" onClick={flipFace}>{t('viewQuota')}</Button>
              <Switch checked={item.enabled} onChange={enabled => { onToggleStatus(item.name, enabled) }} label={t(item.enabled ? 'disableAccount' : 'enableAccount', { name: item.name })} />
            </div>
          </div>
        </div>
      )}
      {currentFace === 'B' && (
        <div className={clsx(css.faceB)} data-testid="card-face-b">
          <div className={clsx(css.quotaObservation)}>
            {item.quotaState.status === 'unobserved' && <p>{t('quotaUnobserved')}</p>}
            {item.quotaState.status === 'unsupported' && <p>{t('quotaUnsupported')}</p>}
            {item.quotaState.status === 'partial' && <p>{t('quotaPartial')}</p>}
            {item.quotaState.status === 'failure' && <p role="alert">{t('quotaFailure', { message: item.quotaState.error ?? t('unknown') })}</p>}
            {item.quotaState.stale && <p>{t('quotaStale')}</p>}
            {(item.quotaState.lastSuccessAt ?? item.quotaState.observedAt) !== undefined && <p>{t('quotaObservedAt', { time: new Date((item.quotaState.lastSuccessAt ?? item.quotaState.observedAt)!).toLocaleString() })}</p>}
          </div>
          {quotaWindows.length === 0 ? (
            <div className={clsx(css.emptyQuota)}>
              <p>{t('emptyQuota')}</p>
              <QuotaBarWithTimeline
                name={t('unknown')}
                resetText=""
                unknownLabel={t('unknown')}
                isReliable={false}
              />
              <Button size="sm" variant="primary" disabled={refreshingQuota} onClick={() => { onRefreshQuota(item.authIndex) }}>{t('probeNow')}</Button>
            </div>
          ) : (
            <div className={clsx(css.quotaList)}>
              {quotaPlanLabel(item.planType) !== undefined && (
                <div className={clsx(css.planRow)}>
                  <span>{t('plan')}</span>
                  <span className={clsx(css.planChip)}>{quotaPlanLabel(item.planType)}</span>
                  {item.resetCreditsAvailable !== undefined && (
                    <span className={clsx(css.planMeta)}>{t('resetCredits', { count: item.resetCreditsAvailable })}</span>
                  )}
                </div>
              )}
              {groupedQuotaWindows(quotaWindows).map(group => (
                <section key={group.title ?? 'ungrouped'} className={clsx(css.quotaGroup)}>
                  {group.title !== undefined && <h4 className={clsx(css.groupTitle)}>{group.title}</h4>}
                  {group.description !== undefined && <p className={clsx(css.groupHint)}>{group.description}</p>}
                  {group.windows.map(window => (
                    <QuotaBarWithTimeline
                      key={window.key}
                      name={window.title}
                      resetText={quotaResetText(window.resetAtMs, t)}
                      unknownLabel={t('unknown')}
                      {...window.timeRemainingPercent === undefined ? {} : { timeRemainingLabel: t('timeRemaining', { percent: Math.round(Math.max(0, Math.min(100, window.timeRemainingPercent))) }) }}
                      isReliable={window.status === 'known' && window.remainingPercent !== undefined}
                      refreshing={refreshingQuota}
                      {...window.remainingPercent === undefined ? {} : { percentRemaining: window.remainingPercent }}
                      {...window.timeRemainingPercent === undefined ? {} : { timeRemainingPercent: window.timeRemainingPercent }}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}
          <div className={clsx(css.quotaFooter)}>
            <div className={clsx(css.footerActions)}>
              <Button
                size="sm"
                variant="ghost"
                aria-busy={refreshingQuota}
                icon={<span className={refreshingQuota ? css.spinning : undefined} aria-hidden>↻</span>}
                disabled={refreshingQuota} onClick={() => { onRefreshQuota(item.authIndex) }}
              >
                {t('refreshQuota')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function groupedQuotaWindows(windows: readonly VisibleQuotaWindow[]): readonly {
  readonly title?: string
  readonly description?: string
  readonly windows: readonly VisibleQuotaWindow[]
}[] {
  const groups: { title?: string; description?: string; windows: VisibleQuotaWindow[] }[] = []
  for (const window of windows) {
    const last = groups.at(-1)
    if (last !== undefined && last.title === window.group) {
      last.windows.push(window)
      continue
    }
    groups.push({
      ...window.group === undefined ? {} : { title: window.group },
      ...window.groupDescription === undefined ? {} : { description: window.groupDescription },
      windows: [window],
    })
  }
  return groups
}

function healthTicks(recent: AccountPoolAccount['recentRequests']): readonly ('pass' | 'fail' | 'empty')[] {
  const source = recent ?? []
  const buckets = source.length >= 20
    ? source.slice(-20)
    : [...Array.from({ length: 20 - source.length }, () => ({ success: 0, failed: 0 })), ...source]
  return buckets.map((bucket) => {
    if (bucket.failed > 0) return 'fail'
    if (bucket.success > 0) return 'pass'
    return 'empty'
  })
}

function formatMeta(sizeBytes: number | undefined, stamp: string | undefined, t: AccountPoolCopy): string {
  const size = sizeBytes === undefined
    ? ''
    : sizeBytes >= 1024
      ? t('kilobyteSize', { value: (sizeBytes / 1024).toFixed(2) })
      : t('byteSize', { value: sizeBytes.toFixed(2) })
  const shown = formatStamp(stamp)
  if (size.length === 0) return shown ?? ''
  if (shown === undefined) return size
  return `${size} · ${shown}`
}

function formatStamp(stamp: string | undefined): string | undefined {
  if (stamp === undefined || stamp.length === 0) return undefined
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return stamp
  return `${String(date.getFullYear())}/${String(date.getMonth() + 1)}/${String(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
