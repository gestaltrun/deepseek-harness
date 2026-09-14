/** Searchable multi-select for exact excluded model ids. */
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountPoolCopy } from './quota-display.ts'
import css from './ExcludedModelsPicker.module.css'

export interface ExcludedModelOption {
  readonly id: string
  readonly name?: string
}

export function ExcludedModelsPicker({
  t,
  models,
  selected,
  onChange,
  disabled = false,
}: {
  t: AccountPoolCopy
  disabled?: boolean
  models: readonly ExcludedModelOption[]
  selected: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const options = useMemo(() => mergeOptions(models, selected), [models, selected])
  const chosen = new Set(selected)
  const filtered = options.filter((item) => {
    const haystack = `${item.id} ${item.name ?? ''}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const summary = chosen.size === 0 ? t('excludedNone') : t('excludedSome', { count: chosen.size })
  return (
    <div className={clsx(css.wrap)}>
      <button
        type="button"
        disabled={disabled}
        id="account-pool-excluded"
        className={clsx(css.trigger)}
        aria-expanded={open}
        aria-label={t('fieldExcluded')}
        onClick={() => { setOpen(current => !current) }}
      >
        <span>{summary}</span>
        <span className={clsx(css.caret)} aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className={clsx(css.panel)} data-testid="excluded-models-panel">
          <Input
            aria-label={t('searchModels')}
            className={clsx(css.search)}
            value={query}
            placeholder={t('searchModels')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          <ul className={clsx(css.list)}>
            {filtered.length === 0 ? (
              <li className={clsx(css.empty)}>{t('noMatchingModels')}</li>
            ) : filtered.map((item) => {
              const checked = chosen.has(item.id)
              return (
                <li key={item.id}>
                  <label className={clsx(css.row)}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        onChange(checked ? selected.filter(id => id !== item.id) : [...selected, item.id])
                      }}
                    />
                    <span>
                      <strong>{item.id}</strong>
                      {item.name !== undefined && item.name !== item.id && <em>{item.name}</em>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className={clsx(css.footer)}>
            <span>{t('excludedProgress', { selected: chosen.size, total: options.length })}</span>
            <span className={clsx(css.actions)}>
              <button type="button" className={clsx(css.link)} onClick={() => { onChange(options.map(item => item.id)) }}>{t('excludeAll')}</button>
              <button type="button" className={clsx(css.link)} onClick={() => { onChange([]) }}>{t('clearExcluded')}</button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function mergeOptions(
  models: readonly ExcludedModelOption[],
  selected: readonly string[],
): readonly ExcludedModelOption[] {
  const seen = new Set<string>()
  const out: ExcludedModelOption[] = []
  for (const item of models) {
    if (item.id.length === 0 || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  for (const id of selected) {
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push({ id })
  }
  return out
}
