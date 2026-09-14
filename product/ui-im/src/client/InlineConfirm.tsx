/**
 * Inline destructive-action confirmation matching the accepted design's
 * ConfirmStrip: an inline bar with cancel and a danger confirm button.
 */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './InlineConfirm.module.css'

/** Props for one inline confirmation bar. */
export interface InlineConfirmProps {
  /** Explanatory content shown between cancel and confirm. */
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Render an inline confirm strip for destructive actions.
 * @param props - copy labels and both outcomes.
 */
export function InlineConfirm(props: InlineConfirmProps) {
  return (
    <div className={css.strip} role="alertdialog">
      <span className={css.body}>{props.children}</span>
      <Button variant="ghost" size="sm" onClick={props.onCancel}>
        {props.cancelLabel}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={css.danger}
        onClick={props.onConfirm}
      >
        {props.confirmLabel}
      </Button>
    </div>
  )
}
