/** Session-scoped IM sidebar for authoritative simulation state and delivery history. */
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactElement } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  ImDeliverySnapshot, ImInboundMessageView, ImOutboundView, ImSimulationInstanceView,
  ImSimulationParticipant, ImSimulationSessionScope,
} from '@gestaltrun/dsh-api-im/client'
import type { ConversationFace } from './faces.ts'
import type { ConversationUiState, createConversationUiStore } from './stores.ts'
import type {} from './locale-types.ts'
import { InlineConfirm } from './InlineConfirm.tsx'
import css from './ConversationTab.module.css'

type ConversationTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'settings.im'>
  & PropsStore<ReturnType<typeof createConversationUiStore>> & InjectFace<ConversationFace>

/** @param props - active Session, authoritative simulation reader, and localized actions. @returns the IM conversation sidebar. */
export function ConversationTab(props: ConversationTabProps): ReactElement {
  const source = useMemo(() => props.watchSession(props.sessionId), [props.watchSession, props.sessionId])
  useEffect(() => () => { void source.dispose() }, [source])
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const configuration = props.useConfiguration(value => value.value)
  const workspaces = props.useWorkspaces(value => value.items)
  const workspace = workspaces.find(item => item.sessionIds.includes(props.sessionId))
  const configured = configuration?.simulationTargets.some(target => target.workspaceId === workspace?.workspaceId) ?? false
  const ui = props.useStore(value => value)

  if (state.phase === 'loading') return <section className={css.pane} data-im-conversation><p role="status" className={css.empty}>{props.t('loading')}</p></section>
  if (state.value?.scope !== undefined && state.value.instance !== undefined) {
    return <SimulationConversation {...props} scope={state.value.scope} instance={state.value.instance} ui={ui} />
  }
  return <section className={css.pane} data-im-conversation>
    <header className={css.head}><div className={css.title}>{props.t('tab')}</div></header>
    {state.error !== undefined && <p role="alert" className={css.error}>{state.error}</p>}
    {configured
      ? <CreateSimulation {...props} ui={ui} />
      : <div className={css.empty}><strong>{props.t('simulationUnconfigured')}</strong><p>{props.t('simulationUnconfiguredHint')}</p><p>{props.t('simulationSidebarEmpty')}</p></div>}
  </section>
}

function parseParticipants(value: string): readonly ImSimulationParticipant[] {
  return value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean).map(item => {
    const [actorId = '', ...name] = item.split('|')
    const displayName = name.join('|').trim()
    return { actorId: actorId.trim(), ...(displayName === '' ? {} : { displayName }) }
  }).filter(item => item.actorId !== '')
}

function CreateSimulation(props: ConversationTabProps & { readonly ui: ConversationUiState }): ReactElement {
  const { t, ui } = props
  const participants = parseParticipants(ui.participants)
  const create = async (): Promise<void> => {
    if (ui.creating || ui.createUnknown) return
    props.actions.patch({ creating: true, error: undefined, feedback: undefined })
    try {
      const result = await props.create({
        simUserSessionId: props.sessionId,
        ...(ui.conversationId.trim() === '' ? {} : { conversationId: ui.conversationId.trim() }),
        speakingMembers: participants,
      })
      if (!result.ok) props.actions.patch({ creating: false, error: result.message })
      else props.actions.patch({ creating: false, feedback: t('simulationCreated').replace('{instance}', result.value.instanceId) })
    } catch (reason) {
      props.actions.patch({ creating: false, createUnknown: true, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const check = async (): Promise<void> => {
    try {
      const result = await props.resolveSession(props.sessionId)
      if (!result.ok) props.actions.patch({ error: result.message })
      else if (result.value === undefined) props.actions.patch({ error: t('simulationCreateStillUnknown') })
      else props.actions.patch({ createUnknown: false, error: undefined, feedback: t('simulationCreateRecovered') })
    } catch (reason) {
      props.actions.patch({ error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return <div className={css.empty} data-simulation-create>
    <strong>{t('simulationSidebarReady')}</strong>
    <p>{t('simulationCreateHint')}</p>
    <label className={css.field}>{t('simulationConversationId')}<Input value={ui.conversationId} disabled={ui.creating || ui.createUnknown} onChange={event => { props.actions.patch({ conversationId: event.target.value }) }} /></label>
    <label className={css.field}>{t('simulationParticipants')}<Input value={ui.participants} disabled={ui.creating || ui.createUnknown} placeholder={t('simulationParticipantsPlaceholder')} onChange={event => { props.actions.patch({ participants: event.target.value }) }} /></label>
    {ui.error !== undefined && <p role="alert" className={css.error}>{ui.error}</p>}
    {ui.feedback !== undefined && <p role="status">{ui.feedback}</p>}
    {ui.createUnknown
      ? <><p role="status">{t('simulationCreateUnknown')}</p><Button onClick={() => { void check() }}>{t('checkSimulationState')}</Button></>
      : <Button variant="primary" disabled={ui.creating || participants.length === 0} onClick={() => { void create() }}>{t(ui.creating ? 'simulationCreating' : 'createSimulation')}</Button>}
  </div>
}

function SimulationConversation(props: ConversationTabProps & {
  readonly ui: ConversationUiState
  readonly scope: ImSimulationSessionScope
  readonly instance: ImSimulationInstanceView
}): ReactElement {
  const { instance, scope, t, ui } = props
  const target = props.useConfiguration(value => value.value?.simulationTargets.find(item => item.workspaceId === instance.simUserWorkspaceId))
  const diverged = target === undefined || target.accountId !== instance.target.accountId || target.routeId !== instance.target.routeId
  const stop = async (): Promise<void> => {
    props.actions.patch({ stopping: true, stopConfirmation: false, error: undefined })
    try {
      const begun = await props.beginStop(instance.instanceId)
      if (!begun.ok) { props.actions.patch({ stopping: false, error: begun.message }); return }
      const settled = await props.waitStopped(instance.instanceId)
      if (!settled.ok) props.actions.patch({ stopping: false, error: settled.message })
      else props.actions.patch({ stopping: false, feedback: settled.value.status === 'stopped'
        ? t('simulationStoppedToast').replace('{instance}', instance.instanceId)
        : settled.value.failure?.message ?? t('simulationFailedStrip') })
    } catch (reason) {
      props.actions.patch({ stopping: false, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return <section className={css.pane} data-im-conversation data-simulation-status={instance.status}>
    <header className={css.head}>
      <div className={css.title}>{t(instance.target.conversationKind === 'group' ? 'kindGroup' : 'kindDirect')}: {instance.target.conversationId} <Tag tone="neutral">{t('simulationBadge')}</Tag></div>
      <div className={css.meta}><span>{t('simulationTarget')}: {instance.target.platform} · {instance.target.accountId}</span><span>{t('simulationTestedWorkspace')}: {instance.target.workspaceId}</span></div>
      <div className={css.simBanner}>{t('simulationFrozen').replace('{instance}', instance.instanceId).replace('{target}', instance.target.conversationId).replace('{workspace}', instance.target.workspaceId)}{diverged && <strong>{t('simulationDivergedNote')}</strong>}</div>
      <nav className={css.roles} aria-label={t('simulationRoles')}>
        <Button size="sm" variant={scope.role === 'tested' ? 'primary' : 'outline'} onClick={() => { props.openSession(scope.role === 'tested' ? scope.sessionId : scope.peerSessionId) }}>{t('openTested')}</Button>
        <Button size="sm" variant={scope.role === 'sim-user' ? 'primary' : 'outline'} onClick={() => { props.openSession(scope.role === 'sim-user' ? scope.sessionId : scope.peerSessionId) }}>{t('openSimuser')}</Button>
      </nav>
    </header>
    <StatusStrip status={instance.status} t={t} />
    <DeliveryFlow {...props} />
    {ui.error !== undefined && <p role="alert" className={css.error}>{ui.error}</p>}
    {ui.feedback !== undefined && <p role="status" className={css.feedback}>{ui.feedback}</p>}
    {instance.status === 'running' && <div className={css.composer}>
      {scope.role === 'sim-user' ? <MemberComposer {...props} /> : <ManagedComposer {...props} />}
      <Button variant="outline" disabled={ui.sending || ui.sendUnknown || ui.stopping} onClick={() => { props.actions.patch({ stopConfirmation: true }) }}>{t('stopSimulation')}</Button>
      {ui.stopConfirmation && <InlineConfirm disabled={ui.stopping} cancelLabel={t('cancel')} confirmLabel={t('confirmStopSimulation')} onCancel={() => { props.actions.patch({ stopConfirmation: false }) }} onConfirm={() => { void stop() }}>{t('stopSimulationHint').replace('{instance}', instance.instanceId)}</InlineConfirm>}
      <div className={css.identityLine}>{t('stopSimulationScope').replace('{instance}', instance.instanceId)}</div>
    </div>}
    {instance.status === 'stopping' && <div className={css.composer}><div className={css.identityLine}>{t('simulationStoppingHint')}</div></div>}
    {instance.status === 'stopped' && <div className={css.composer}><div className={css.identityLine}>{t('simulationStoppedHint')}</div></div>}
    {instance.status === 'failed' && <div className={css.composer}><div role="alert" className={css.error}>{instance.failure?.message ?? t('simulationFailedStrip')}</div></div>}
  </section>
}

function StatusStrip({ status, t }: { readonly status: ImSimulationInstanceView['status']; readonly t: ConversationTabProps['t'] }): ReactElement {
  const key = status === 'creating' ? 'simulationCreatingStrip' : status === 'running' ? 'simulationRunningStrip' : status === 'stopping' ? 'simulationStoppingStrip' : status === 'stopped' ? 'simulationStoppedStrip' : 'simulationFailedStrip'
  return <div className={`${css.strip} ${css[status]}`} role="status">{status === 'stopping' || status === 'creating' ? <span className={css.spinner} aria-hidden="true" /> : null}{t(key)}</div>
}

function MemberComposer(props: ConversationTabProps & { readonly ui: ConversationUiState; readonly instance: ImSimulationInstanceView }): ReactElement {
  const { ui, instance, t } = props
  const send = async (): Promise<void> => {
    const text = ui.memberText.trim()
    if (text === '' || ui.memberId === '' || ui.sending || ui.sendUnknown) return
    props.actions.patch({ sending: true, error: undefined, feedback: undefined })
    try {
      const result = await props.injectMember({ instanceId: instance.instanceId, actorId: ui.memberId, text })
      if (!result.ok) props.actions.patch({ sending: false, error: result.message })
      else props.actions.patch({ sending: false, memberText: '', feedback: t('simulationSent') })
    } catch (reason) {
      props.actions.patch({ sending: false, sendUnknown: true, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return <><select aria-label={t('simulationSpeakingMember')} value={ui.memberId} disabled={ui.sending || ui.sendUnknown} onChange={event => { props.actions.patch({ memberId: event.target.value }) }}><option value="">{t('simulationSelectMember')}</option>{instance.speakingMembers.map(member => <option key={member.actorId} value={member.actorId}>{member.displayName ?? member.actorId}</option>)}</select>
    <div className={css.inputRow}><textarea className={css.input} aria-label={t('memberHint')} placeholder={t('memberHint')} value={ui.memberText} disabled={ui.sending || ui.sendUnknown} onChange={event => { props.actions.patch({ memberText: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><Button variant="primary" disabled={ui.memberId === '' || ui.memberText.trim() === '' || ui.sending || ui.sendUnknown} onClick={() => { void send() }}>{t('sendAsMember')}</Button></div>
    {ui.sendUnknown && <p role="alert">{t('simulationSendUnknown')}</p>}</>
}

function ManagedComposer(props: ConversationTabProps & { readonly ui: ConversationUiState; readonly instance: ImSimulationInstanceView }): ReactElement {
  const { ui, instance, t } = props
  const send = async (): Promise<void> => {
    const text = ui.managedText.trim()
    if (text === '' || ui.sending || ui.sendUnknown) return
    props.actions.patch({ sending: true, error: undefined, feedback: undefined })
    try {
      const result = await props.injectManagedHuman({ instanceId: instance.instanceId, text })
      if (!result.ok) props.actions.patch({ sending: false, error: result.message })
      else props.actions.patch({ sending: false, managedText: '', feedback: t('simulationSent') })
    } catch (reason) {
      props.actions.patch({ sending: false, sendUnknown: true, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return <><div className={css.identityLine}>{t('simulationManagedIdentity')}</div><div className={css.inputRow}><textarea className={css.input} aria-label={t('managedHumanHint')} placeholder={t('managedHumanHint')} value={ui.managedText} disabled={ui.sending || ui.sendUnknown} onChange={event => { props.actions.patch({ managedText: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><Button variant="primary" disabled={ui.managedText.trim() === '' || ui.sending || ui.sendUnknown} onClick={() => { void send() }}>{t('sendAsManagedHuman')}</Button></div>{ui.sendUnknown && <p role="alert">{t('simulationSendUnknown')}</p>}</>
}

function DeliveryFlow(props: ConversationTabProps & { readonly scope: ImSimulationSessionScope; readonly instance: ImSimulationInstanceView }): ReactElement {
  const deliveryScope = props.scope.deliveryScope
  const reader = useMemo(() => props.watchDelivery({ scope: deliveryScope, limit: 100 }), [
    props.watchDelivery, deliveryScope.instanceId, deliveryScope.platform, deliveryScope.accountId,
    deliveryScope.conversationKind, deliveryScope.conversationId,
  ])
  useEffect(() => () => { void reader.dispose() }, [reader])
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const flow = useRef<HTMLDivElement>(null)
  const rows = state.value === undefined ? [] : deliveryRows(state.value)
  useEffect(() => { if (flow.current !== null) flow.current.scrollTop = flow.current.scrollHeight }, [rows.length, props.instance.status])
  return <div className={css.flow} ref={flow} data-im-flow>
    {state.phase !== 'ready' && <p role="status">{state.error ?? props.t(state.phase === 'reconnecting' ? 'reconnecting' : 'loading')}</p>}
    {rows.length === 0 && state.value !== undefined && <p className={css.empty}>{props.t('simulationNoMessages')}</p>}
    {rows.map(row => <MessageRow key={row.key} row={row} t={props.t} />)}
  </div>
}

type DeliveryRow = { readonly key: string; readonly at: string; readonly text: string; readonly format: string; readonly sender: string; readonly state: string }

function deliveryRows(value: ImDeliverySnapshot): readonly DeliveryRow[] {
  return [
    ...value.inbound.items.map(message => ({ key: `in:${message.messageId}`, at: message.occurredAt, text: message.content.text, format: message.content.format, sender: senderKey(message), state: message.stage })),
    ...value.outbound.items.map(message => ({ key: `out:${message.requestId}`, at: message.createdAt, text: message.content.text, format: message.content.format, sender: message.intent === 'ai' ? 'senderAi' : 'senderDsh', state: message.status })),
  ].sort((left, right) => left.at.localeCompare(right.at) || left.key.localeCompare(right.key))
}

function senderKey(message: ImInboundMessageView): string {
  switch (message.sender.kind) {
    case 'external': return 'senderExternal'
    case 'ai': return 'senderAi'
    case 'human-native': return 'senderNative'
    case 'human-dsh': return 'senderSimulationInjected'
    case 'unknown': return 'senderUnknown'
  }
}

function stateKey(state: string): string {
  switch (state) {
    case 'received': return 'deliveryReceived'
    case 'submitted': return 'deliverySubmitted'
    case 'sent': return 'deliverySent'
    case 'pending': case 'dispatching': return 'deliveryPending'
    case 'result-unknown': return 'deliveryUnknown'
    case 'pre-send-failed': case 'confirmed-failed': return 'deliveryFailed'
    default: return 'deliveryUnknown'
  }
}

function MessageRow({ row, t }: { readonly row: DeliveryRow; readonly t: ConversationTabProps['t'] }): ReactElement {
  return <article className={css.row} data-message-state={row.state}>
    <div className={css.meta}><Tag tone={row.sender === 'senderUnknown' ? 'warning' : row.sender === 'senderAi' ? 'neutral' : 'info'}>{t(row.sender as never)}</Tag><time>{new Date(row.at).toLocaleTimeString()}</time></div>
    <div className={css.text}>{row.format === 'unsupported' ? t('unsupportedMessage') : row.text}</div>
    <div className={row.state === 'result-unknown' ? css.unknownState : css.time}>{t(stateKey(row.state) as never)}{row.state === 'result-unknown' ? ` · ${t('noAutomaticRetry')}` : ''}</div>
  </article>
}
