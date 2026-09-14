/** Product Workspace settings dialog using the public Modal container. */
import type { ReactNode } from 'react'
import { IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkspaceSettingsDialog.module.css'

/** Localized dialog chrome and the product settings cards. */
export interface WorkspaceSettingsDialogProps {
  readonly open: boolean
  readonly title: string
  readonly closeLabel: string
  readonly onClose: () => void
  readonly children: ReactNode
}

/** @param props - dialog state and product-owned settings cards. @returns the portaled settings dialog. */
export function WorkspaceSettingsDialog(props: WorkspaceSettingsDialogProps) {
  return <Modal open={props.open} title={props.title} onClose={props.onClose} headless className={css.dialog!}>
    <header className={css.header}>
      <h2 className={css.title}>{props.title}</h2>
      <button className={css.close} type="button" aria-label={props.closeLabel} onClick={props.onClose}><IconCloseOutline16 size={14} /></button>
    </header>
    <div className={css.content} data-im-settings-scroll>{props.children}</div>
  </Modal>
}
