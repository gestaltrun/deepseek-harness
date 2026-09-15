/** Quota remaining fill with a time-window needle. */
import clsx from 'clsx'
import type { CSSProperties } from 'react'
import css from './QuotaBarWithTimeline.module.css'

/** Observed quota numbers and their localized presentation. */
export interface QuotaBarWithTimelineProps {
  percentRemaining?: number
  timeRemainingPercent?: number
  name: string
  resetText: string
  unknownLabel: string
  timeRemainingLabel?: string
  isReliable: boolean
  refreshing?: boolean
}

/**
 * Draw a remaining-quota bar only for a reliable numeric sample.
 * @param props - optional measurements and reliable/refreshing state.
 * @returns the labeled track; unknown samples have no fill or needle.
 */
export function QuotaBarWithTimeline({
  percentRemaining,
  timeRemainingPercent,
  name,
  resetText,
  unknownLabel,
  timeRemainingLabel,
  isReliable,
  refreshing = false,
}: QuotaBarWithTimelineProps) {
  const boundedQuota = percentRemaining === undefined ? undefined : Math.max(0, Math.min(100, percentRemaining))
  const boundedTime = timeRemainingPercent === undefined ? undefined : Math.max(0, Math.min(100, timeRemainingPercent))
  const tone = boundedQuota === undefined || !isReliable ? 'unknown' : boundedQuota < 30 ? 'low' : boundedQuota < 70 ? 'medium' : 'high'
  const quotaFill = isReliable ? boundedQuota : undefined
  const timeFill = isReliable ? boundedTime : undefined
  return (
    <div className={clsx(css.container, refreshing ? css.refreshing : '')} data-quota-tone={tone} style={{ '--quota-fill': `${String(quotaFill ?? 0)}%`, '--quota-time': `${String(timeFill ?? 0)}%` } as CSSProperties}>
      <div className={clsx(css.labelRow)}>
        <span className={clsx(css.metricName)} title={name}>{name}</span>
        <div className={clsx(css.metaGroup)}>
          <span className={clsx(css.percentText)}>
            {quotaFill === undefined ? unknownLabel : `${String(Math.round(quotaFill))}%`}
          </span>
          {resetText.length > 0 && <span className={clsx(css.resetTime)}>{resetText}</span>}
        </div>
      </div>
      <div
        className={clsx(css.track)}
        data-testid="quota-track"
        data-quota-fill={quotaFill === undefined ? 'none' : 'fill'}
        data-quota-needle={timeFill === undefined ? 'none' : 'needle'}
      >
        {quotaFill !== undefined && (
          <div className={clsx(css.quotaFill)} />
        )}
        {timeFill !== undefined && (
          <div className={clsx(css.timelineMarker)} title={timeRemainingLabel ?? `${String(Math.round(timeFill))}%`}>
            <div className={clsx(css.needleArrow)} />
            <div className={clsx(css.needleLine)} />
          </div>
        )}
      </div>
    </div>
  )
}
