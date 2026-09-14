/** Inline model declarations and default effort edited in the provider's atomic draft. */
import type { ReactNode } from 'react'
import { InputModalityTags } from './InputModalityTags.tsx'
import { declaredEfforts, ReasoningEffortTags, THINKING_LEVELS } from './ReasoningEffortTags.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * Report a capability edit that the provider cannot serve.
 * @param model - Model draft preserving fields not edited by this component.
 * @returns Localized error key, or undefined for an admissible declaration.
 */
export function modelCapabilityError(model: Readonly<Record<string, unknown>>): 'modelDefaultInvalid' | 'modelReasoningInvalid' | undefined {
  const efforts = declaredEfforts(model.reasoningEfforts)
  if (efforts && (Object.keys(efforts).every(key => key === 'off')
    || Object.entries(efforts).some(([key, wire]) => key !== 'off' && (wire === null || wire.trim() === '')))) return 'modelReasoningInvalid'
  const selected = model.defaultReasoningLevel
  if (selected === undefined) return undefined
  if (typeof selected !== 'string' || !THINKING_LEVELS.some(level => level === selected)
    || efforts === false || (efforts !== undefined && !Object.hasOwn(efforts, selected))) return 'modelDefaultInvalid'
  return undefined
}

/** Inputs owned by one provider editor draft. */
export interface ModelCapabilitiesFieldsProps {
  model: Readonly<Record<string, unknown>>
  disabled: boolean
  t: (key: keyof typeof en) => string
  onChange(change: Record<string, unknown>): void
}

/** Render modality, offered efforts, wire values and the model's default selection. */
export function ModelCapabilitiesFields({ model, disabled, t, onChange }: ModelCapabilitiesFieldsProps): ReactNode {
  const efforts = declaredEfforts(model.reasoningEfforts)
  const selected = typeof model.defaultReasoningLevel === 'string' ? model.defaultReasoningLevel : ''
  const options = efforts === undefined ? [...THINKING_LEVELS] : efforts === false ? [] : Object.keys(efforts)
  return <>
    <div className={`${styles['modelField']} ${styles['modelFieldWide']}`}>
      <span className={styles['modelFieldLabel']}>{t('modelInput')}</span>
      <InputModalityTags value={model.input} disabled={disabled} name={t('modelInput')}
        labels={{ text: t('modalityText'), image: t('modalityImage') }} onChange={input => { onChange({ input }) }} />
    </div>
    <div className={`${styles['modelField']} ${styles['modelFieldWide']}`}>
      <span className={styles['modelFieldLabel']}>{t('modelReasoning')}</span>
      <ReasoningEffortTags value={model.reasoningEfforts} disabled={disabled} name={t('modelReasoning')}
        labels={{ off: t('effortOff'), minimal: t('effortMinimal'), low: t('effortLow'), medium: t('effortMedium'),
          high: t('effortHigh'), xhigh: t('effortXhigh'), max: t('effortMax') }}
        onChange={reasoningEfforts => { onChange({ reasoningEfforts }) }} />
    </div>
    <label className={`${styles['modelField']} ${styles['modelFieldWide']}`}>
      <span className={styles['modelFieldLabel']}>{t('defaultReasoning')}</span>
      <select className={styles['input']} aria-label={t('defaultReasoning')} disabled={disabled} value={selected}
        onChange={event => { onChange({ defaultReasoningLevel: event.target.value || undefined }) }}>
        <option value="">{t('defaultReasoningInherit')}</option>
        {selected !== '' && !options.includes(selected) && <option value={selected} disabled>{t('defaultReasoningUnavailable')}</option>}
        {options.map(effort => <option value={effort} key={effort}>{effort}</option>)}
      </select>
      <span className={styles['modelFieldHint']}>{t('defaultReasoningHint')}</span>
    </label>
    {efforts && <details className={styles['modelFieldWide']}><summary>{t('reasoningWireValues')}</summary>
      {Object.entries(efforts).map(([effort, wire]) => <label className={styles['modelField']} key={effort}>
        <span className={styles['modelFieldLabel']}>{effort}</span>
        <input className={styles['input']} aria-label={`${t('reasoningWireValues')} ${effort}`} disabled={disabled}
          value={wire ?? ''} placeholder={t('reasoningWireOmitted')}
          onChange={event => { onChange({ reasoningEfforts: { ...efforts, [effort]: event.target.value || null } }) }} />
      </label>)}
    </details>}
  </>
}
