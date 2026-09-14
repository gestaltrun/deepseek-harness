/** IM tab availability remains explicit until the authoritative session stream is composed. */
import type { ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locale-types.ts'
import css from './ConversationTab.module.css'

type ConversationTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'settings.im'>

/** @param props - registered session slot and localized availability. @returns the current tab availability. */
export function ConversationTab(props: ConversationTabProps): ReactElement {
  return <section className={css.pane} data-im-conversation><p role="status">{props.t('conversationUnavailable')}</p></section>
}
