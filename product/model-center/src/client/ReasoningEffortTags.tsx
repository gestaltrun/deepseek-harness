/**
 * Multi-select tags for a model's `reasoningEfforts` dict. Visible labels
 * are localized; stored keys stay the pi-ai level names, and each selected
 * level other than `off` writes itself as the wire value (`high: high`).
 * `off` writes `null`, which is the YAML `off:` spelling.
 *
 * Absent or empty means inherit the catalog (a hand-declared model then
 * offers no thinking levels). `false` is a stored non-reasoning model and
 * is left untouched until a tag is pressed.
 */

import type { ReactNode } from 'react'
import styles from './ModelsSection.module.css'

/** Every thinking level a profile may declare, in pi-ai escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One thinking level this card's tags can add or remove. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Localized tag labels keyed by the stored YAML spelling. */
export type ThinkingLevelLabels = Readonly<Record<ThinkingLevel, string>>

/** One model's stored `reasoningEfforts` as the card understands it. */
export type ReasoningEffortsDraft = false | Record<string, string | null>

/**
 * Read a stored efforts value. `false` is a declared non-reasoning model;
 * a non-object is treated as omitted so a future schema leaf is not rewritten.
 * @param value - the draft field as the card currently holds it.
 * @returns the stored dict or `false`, or `undefined` when the field should stay omitted.
 */
export function declaredEfforts(value: unknown): ReasoningEffortsDraft | undefined {
  if (value === false) return false
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const next: Record<string, string | null> = {}
  for (const [key, wire] of Object.entries(value as Record<string, unknown>)) {
    if (wire === null || typeof wire === 'string') next[key] = wire
  }
  return next
}

/**
 * Toggle one known level. A stored `false` becomes a dict with that level.
 * Clearing the last level omits the field rather than writing `{}`, which
 * the adapter refuses.
 * @param current - the list as stored, or `undefined` when the field is omitted.
 * @param level - the tag the user pressed.
 * @returns the next value, or `undefined` when nothing remains to store.
 */
export function toggleEffort(
  current: ReasoningEffortsDraft | undefined,
  level: ThinkingLevel,
): ReasoningEffortsDraft | undefined {
  const dict = current === false || current === undefined ? {} : { ...current }
  if (Object.prototype.hasOwnProperty.call(dict, level)) {
    Reflect.deleteProperty(dict, level)
  } else {
    dict[level] = level === 'off' ? null : level
  }
  return Object.keys(dict).length === 0 ? undefined : dict
}

/**
 * Whether a stored efforts value is one the adapter will refuse.
 * @param value - the draft field.
 * @returns true when the write would fail resolution.
 */
export function isInvalidEfforts(value: unknown): boolean {
  const declared = declaredEfforts(value)
  if (declared === undefined || declared === false) return false
  const keys = Object.keys(declared)
  if (keys.length === 0) return true
  return keys.every(key => key === 'off')
}

/** Props of {@link ReasoningEffortTags}. */
export interface ReasoningEffortTagsProps {
  /** The draft dict, `false`, or anything else the card has not yet interpreted. */
  value: unknown
  /** Disable every tag. */
  disabled: boolean
  /** Accessible name of the group; each tag appends its localized label. */
  name: string
  /** Localized label for each stored level key. */
  labels: ThinkingLevelLabels
  /** Replace the stored dict, or omit the field when `undefined`. */
  onChange: (next: ReasoningEffortsDraft | undefined) => void
}

/**
 * Render the thinking-level tags for one model's `reasoningEfforts`.
 * @param props - the draft value, localized labels, and the write-back.
 * @returns the tag group.
 */
export function ReasoningEffortTags(props: ReasoningEffortTagsProps): ReactNode {
  const declared = declaredEfforts(props.value)
  const selected = declared === false || declared === undefined
    ? new Set<string>()
    : new Set(Object.keys(declared))
  return (
    <div className={styles['modalityGroup']} role="group" aria-label={props.name}>
      {THINKING_LEVELS.map((level) => {
        const pressed = selected.has(level)
        const label = props.labels[level]
        return (
          <button
            type="button"
            key={level}
            className={`${styles['modalityTag']} ${pressed ? styles['modalityTagSelected'] : ''}`}
            aria-pressed={pressed}
            aria-label={`${props.name} ${label}`}
            disabled={props.disabled}
            onClick={() => { props.onChange(toggleEffort(declared, level)) }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
