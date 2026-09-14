/**
 * Multi-select tags for a pi-ai `input` or `defaultInput` list. Visible
 * labels are localized; the stored values stay the YAML spellings
 * (`text`, `image`) so the card writes the same array a hand-edited
 * `settings.yaml` would.
 *
 * An empty or absent list is omitted rather than stored: on a model that
 * means inherit the catalog then the route; on the route that means the
 * adapter's `[text]` fallback. Unknown entries already in the array survive
 * a toggle so a future modality is not dropped by this card.
 */

import type { ReactNode } from 'react'
import styles from './ModelsSection.module.css'

/** Every request modality this card can declare, in settings-file order. */
export const INPUT_MODALITIES = ['text', 'image'] as const

/** One modality this card's tags can add or remove. */
export type InputModality = (typeof INPUT_MODALITIES)[number]

/** Localized tag labels keyed by the stored YAML spelling. */
export type InputModalityLabels = Readonly<Record<InputModality, string>>

/**
 * Read a stored modality list. Absent, empty, or a non-string array all mean
 * "this field states no answer" and must not be written back as `[]`.
 * @param value - the draft field as the card currently holds it.
 * @returns the string entries, or `undefined` when the field should stay omitted.
 */
export function declaredModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (!value.every(item => typeof item === 'string')) return undefined
  return [...value]
}

/**
 * Toggle one known modality and keep any unknown entries already stored.
 * @param current - the list as stored, or `undefined` when the field is omitted.
 * @param modality - the tag the user pressed.
 * @returns the next list, or `undefined` when nothing remains to store.
 */
export function toggleModality(
  current: readonly string[] | undefined,
  modality: InputModality,
): string[] | undefined {
  const known = new Set<string>(INPUT_MODALITIES)
  const extras = (current ?? []).filter(item => !known.has(item))
  const selected = new Set((current ?? []).filter(item => known.has(item)))
  if (!selected.delete(modality)) selected.add(modality)
  const next = [...INPUT_MODALITIES.filter(item => selected.has(item)), ...extras]
  return next.length === 0 ? undefined : next
}

/** Props of {@link InputModalityTags}. */
export interface InputModalityTagsProps {
  /** The draft array, or anything else the card has not yet interpreted. */
  value: unknown
  /** Disable every tag. */
  disabled: boolean
  /** Accessible name of the group; each tag appends its localized label. */
  name: string
  /** Localized label for each stored modality key. */
  labels: InputModalityLabels
  /** Replace the stored list, or omit the field when `undefined`. */
  onChange: (next: string[] | undefined) => void
}

/**
 * Render the `text` / `image` tags for one modality list.
 * @param props - the draft value, localized labels, and the write-back.
 * @returns the tag group.
 */
export function InputModalityTags(props: InputModalityTagsProps): ReactNode {
  const declared = declaredModalities(props.value)
  const selected = new Set(declared ?? [])
  return (
    <div className={styles['modalityGroup']} role="group" aria-label={props.name}>
      {INPUT_MODALITIES.map((modality) => {
        const pressed = selected.has(modality)
        const label = props.labels[modality]
        return (
          <button
            type="button"
            key={modality}
            className={`${styles['modalityTag']} ${pressed ? styles['modalityTagSelected'] : ''}`}
            aria-pressed={pressed}
            aria-label={`${props.name} ${label}`}
            disabled={props.disabled}
            onClick={() => { props.onChange(toggleModality(declared, modality)) }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
