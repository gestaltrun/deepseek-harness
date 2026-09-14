/** Account dialogs use the shared modal's keyboard and accessibility behavior. */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './LoginModal.module.css'

interface AccountDialogProps {
  title: string
  description?: string
  closeLabel: string
  children: ReactNode
  onClose: () => void
}

/** Render one account-management dialog. */
export function AccountDialog({ title, description, closeLabel, children, onClose }: AccountDialogProps) {
  return <Modal open onClose={onClose} title={title} closeLabel={closeLabel} {...description === undefined ? {} : { description }} className={clsx(css.dialog)}>{children}</Modal>
}
