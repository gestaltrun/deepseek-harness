/** Simulation role and Workspace facts beside the ordinary Session title. */
import { useEffect, useMemo, useSyncExternalStore, type ReactElement } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ImSimulationSessionSource } from '@gestaltrun/dsh-api-im/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConversationFace } from './faces.ts'
import type {} from './locale-types.ts'
import css from './SimulationHeader.module.css'

type SimulationHeaderBaseProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'settings.im'>
type SimulationHeaderProps = SimulationHeaderBaseProps & Pick<ConversationFace, 'watchSession'>

/** @param watchSession - Client reader factory captured by the registration. @returns a standard header-slot component. */
export function simulationHeaderEntry(watchSession: (sessionId: SessionId) => ImSimulationSessionSource): (props: SimulationHeaderBaseProps) => ReactElement | null {
  return function SimulationHeaderEntry(props: SimulationHeaderBaseProps): ReactElement | null {
    return <SimulationHeader {...props} watchSession={watchSession} />
  }
}

/** @param props - selected Session and authoritative simulation binding. @returns role heading and Workspace subtitle, or nothing for ordinary Sessions. */
export function SimulationHeader(props: SimulationHeaderProps): ReactElement | null {
  const source = useMemo(() => props.watchSession(props.sessionId), [props.watchSession, props.sessionId])
  useEffect(() => () => { void source.dispose() }, [source])
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const sessionTitle = props.useSessions(value => value.byId[props.sessionId]?.displayTitle ?? props.sessionId)
  const workspaces = props.useWorkspaces(value => value.items)
  if (state.value?.scope === undefined || state.value.instance === undefined) return null
  const { instance, scope } = state.value
  const workspace = workspaces.find(item => item.workspaceId === scope.workspaceId)
  const workspaceName = workspace?.title ?? scope.workspaceId
  const title = scope.role === 'sim-user'
    ? props.t('simulationSimuserTitle').replace('{title}', sessionTitle)
    : props.t('simulationTestedTitle').replace('{buyer}', instance.target.conversationId)
  const subtitle = props.t(scope.role === 'sim-user' ? 'simulationSimuserSubtitle' : 'simulationTestedSubtitle')
    .replace('{workspace}', workspaceName)
  return <span className={css.root} aria-label={title}>
    <span className={css.title}>{title}</span>
    <span className={css.subtitle}>{subtitle}</span>
    <Tag tone="neutral">{props.t('simulationBadge')}</Tag>
  </span>
}
