/** Session-scoped IM sidebar for authoritative real and simulation state and delivery history. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { Button, FileTypeIcon, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  ImDeliveryScope, ImDeliverySnapshot, ImInboundMessageView, ImMessageContent, ImOutboundRequestId,
  ImRealSessionBinding, ImSimulationInstanceView, ImSimulationParticipant, ImSimulationSessionScope,
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
  const ui = props.useStore(value => value)

  if (state.phase === 'loading') return <section className={css.pane} data-im-conversation><p role="status" className={css.empty}>{props.t('loading')}</p></section>
  if (state.value?.scope !== undefined && state.value.instance !== undefined) {
    return <SimulationConversation {...props} scope={state.value.scope} instance={state.value.instance} ui={ui} />
  }
  return <RealConversationOrEmpty {...props} ui={ui} simulationError={state.error} />
}

function RealConversationOrEmpty(props: ConversationTabProps & {
  readonly ui: ConversationUiState
  readonly simulationError: string | undefined
}): ReactElement {
  const source = useMemo(() => props.watchRealSession(props.sessionId), [props.watchRealSession, props.sessionId])
  useEffect(() => () => { void source.dispose() }, [source])
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const configuration = props.useConfiguration(value => value.value)
  const workspaces = props.useWorkspaces(value => value.items)
  const workspace = workspaces.find(item => item.sessionIds.includes(props.sessionId))
  const configured = configuration?.simulationTargets.some(target => target.workspaceId === workspace?.workspaceId) ?? false

  if (state.value?.binding !== undefined) return <RealConversation {...props} binding={state.value.binding} />
  if (state.phase === 'loading') return <section className={css.pane} data-im-conversation><p role="status" className={css.empty}>{props.t('loading')}</p></section>
  const failure = props.simulationError ?? state.error
  return <section className={css.pane} data-im-conversation>
    <header className={css.head}><div className={css.title}>{props.t('tab')}</div></header>
    {failure !== undefined && <p role="alert" className={css.error}>{failure}</p>}
    {configured
      ? <CreateSimulation {...props} />
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

function RealConversation(props: ConversationTabProps & {
  readonly ui: ConversationUiState
  readonly binding: ImRealSessionBinding
}): ReactElement {
  const { binding, t, ui } = props
  const { destination, senderIdentity, accountState } = binding
  const manual = accountState.manualSend
  const blocked = manual.state === 'unavailable'
  const disconnected = manual.state === 'unavailable' && manual.reason === 'disconnected'
  const title = destination.displayName ?? destination.conversationId
  const busy = ui.sending || blocked
  const pending = ui.manualUnknown

  const patch = props.actions.patch
  const fail = (reason: unknown): void => { patch({ sending: false, error: reason instanceof Error ? reason.message : String(reason) }) }

  const send = async (): Promise<void> => {
    const text = ui.manualText.trim()
    if (text === '' || busy || ui.manualUnknown !== undefined) return
    const requestId = brandString<ImOutboundRequestId>(crypto.randomUUID())
    patch({ sending: true, error: undefined, feedback: undefined })
    try {
      const result = await props.sendManual({ sessionId: props.sessionId, requestId, text })
      if (!result.ok) { patch({ sending: false, error: result.message }); return }
      if (result.value.outbound.status === 'result-unknown') patch({ sending: false, manualText: '', manualUnknown: { requestId, text } })
      else patch({ sending: false, manualText: '', feedback: t('manualSent') })
    } catch (reason) {
      patch({ sending: false, manualText: '', manualUnknown: { requestId, text } })
      fail(reason)
    }
  }

  const verify = async (requestId: ImOutboundRequestId): Promise<void> => {
    patch({ error: undefined, feedback: undefined })
    try {
      const known = await props.queryManual({ sessionId: props.sessionId, requestId })
      if (!known.ok) { patch({ error: known.message }); return }
      if (known.value.state === 'known' && known.value.result.outbound.status !== 'result-unknown') {
        patch({ manualUnknown: undefined, feedback: t('manualSendRecovered') })
        return
      }
      const confirmed = await props.confirmManual({ sessionId: props.sessionId, requestId })
      if (!confirmed.ok) { patch({ error: confirmed.message }); return }
      if (confirmed.value.outbound.status === 'result-unknown') patch({ feedback: t('manualSendStillUnknown') })
      else patch({ manualUnknown: undefined, feedback: t('manualSendRecovered') })
    } catch (reason) {
      fail(reason)
    }
  }

  const retry = async (retryOfRequestId: ImOutboundRequestId): Promise<void> => {
    if (ui.sending || blocked) return
    const requestId = brandString<ImOutboundRequestId>(crypto.randomUUID())
    patch({ sending: true, error: undefined, feedback: undefined })
    try {
      const result = await props.retryManual({ sessionId: props.sessionId, requestId, retryOfRequestId })
      if (!result.ok) { patch({ sending: false, error: result.message }); return }
      if (result.value.outbound.status === 'result-unknown') patch({ sending: false, manualUnknown: { requestId, text: result.value.outbound.content.text } })
      else patch({ sending: false, manualUnknown: undefined, feedback: t('manualSent') })
    } catch (reason) {
      fail(reason)
    }
  }

  const togglePaused = async (paused: boolean): Promise<void> => {
    patch({ error: undefined, feedback: undefined })
    const result = await props.setPaused({
      operationId: props.operationId(), accountId: senderIdentity.accountId,
      observedRevision: binding.accountRevision, paused,
    })
    if (!result.ok) patch({ error: result.message })
  }

  return <section className={css.pane} data-im-conversation data-im-real data-im-strip={blocked ? 'offline' : accountState.paused ? 'disabled' : 'live'}>
    <header className={css.head}>
      <div className={css.title}>
        <Tag tone="info">{t(senderIdentity.platform)}</Tag>
        {t(destination.conversationKind === 'group' ? 'kindGroup' : 'kindDirect')}: {title}
      </div>
      <div className={css.meta}>
        <span>{t('realAccount')}: {senderIdentity.displayName}</span>
        {destination.conversationKind === 'group' && destination.memberCount !== undefined && <span>{t('realMembers').replace('{count}', String(destination.memberCount))}</span>}
        <span>{t('realWorkspace')}: {binding.workspaceId}</span>
      </div>
    </header>
    <RealStrip {...props} onToggle={togglePaused} />
    <DeliveryFlow {...props} deliveryScope={binding.scope} activity={`${manual.state}:${String(accountState.paused)}`} simulated={false} onVerify={verify} onRetry={retry} retryDisabled={busy} />
    {disconnected && <p className={css.cursorNote}>{binding.sync === undefined
      ? t('cursorNoteUnsynced')
      : t('cursorNote').replace('{time}', new Date(binding.sync.lastSyncedAt).toLocaleString())}</p>}
    {ui.error !== undefined && <p role="alert" className={css.error}>{ui.error}</p>}
    {ui.feedback !== undefined && <p role="status" className={css.feedback}>{ui.feedback}</p>}
    <div className={css.composer}>
      <div className={css.identityLine}>{t('sendIdentityReal').replace('{account}', senderIdentity.displayName).replace('{title}', title)}</div>
      <div className={css.inputRow}>
        <textarea className={css.input} aria-label={t('composerHint')} placeholder={t('composerHint')} value={ui.manualText}
          disabled={busy || pending !== undefined}
          onChange={event => { patch({ manualText: event.target.value }) }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
        <Button variant="primary" disabled={busy || ui.manualText.trim() === '' || pending !== undefined} onClick={() => { void send() }}>{t('send')}</Button>
      </div>
      {pending !== undefined && <div className={css.unknownState}>
        <p role="alert">{t('manualSendUnknown')}</p>
        <Button size="sm" variant="outline" onClick={() => { void verify(pending.requestId) }}>{t('checkManualSend')}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { void retry(pending.requestId) }}>{t('retryManualSend')}</Button>
      </div>}
      {blocked && <div className={css.identityLine}>{t('viewAccountsHint')}</div>}
    </div>
  </section>
}

function RealStrip(props: ConversationTabProps & {
  readonly binding: ImRealSessionBinding
  readonly onToggle: (paused: boolean) => Promise<void>
}): ReactElement {
  const { binding, t } = props
  const manual = binding.accountState.manualSend
  if (manual.state === 'unavailable') {
    const text = manual.reason === 'authorization-required'
      ? t('authorizationRequiredStrip')
      : manual.reason === 'listener-unavailable'
        ? t('listenerUnavailableStrip')
        : binding.sync === undefined
          ? t('offlineStrip')
          : t('offlineStripSince').replace('{time}', new Date(binding.sync.lastSyncedAt).toLocaleTimeString())
    return <div className={`${css.strip} ${css.offline}`} role="alert">{text}</div>
  }
  const paused = binding.accountState.paused
  return <div className={`${css.strip} ${paused ? css.disabled : css.live}`} role="status">
    {t(paused ? 'disabledStrip' : 'live')}
    <Button size="sm" variant="outline" onClick={() => { void props.onToggle(!paused) }}>{t(paused ? 'enableStrip' : 'liveDisable')}</Button>
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
    {instance.historyImports.map(imported => <p key={imported.operationId} className={css.cursorNote} data-im-history>
      {t('historyNote').replace('{file}', imported.fileName).replace('{count}', String(imported.importedCount))}
    </p>)}
    <DeliveryFlow {...props} deliveryScope={scope.deliveryScope} activity={instance.status} simulated />
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

function DeliveryFlow(props: ConversationTabProps & {
  readonly deliveryScope: ImDeliveryScope
  readonly activity: string
  readonly simulated: boolean
  readonly onVerify?: (requestId: ImOutboundRequestId) => Promise<void>
  readonly onRetry?: (requestId: ImOutboundRequestId) => Promise<void>
  readonly retryDisabled?: boolean
}): ReactElement {
  const { deliveryScope, simulated } = props
  const reader = useMemo(() => props.watchDelivery({ scope: deliveryScope, limit: 100 }), [
    props.watchDelivery, deliveryScope,
  ])
  useEffect(() => () => { void reader.dispose() }, [reader])
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const flow = useRef<HTMLDivElement>(null)
  const rows = state.value === undefined ? [] : deliveryRows(state.value, simulated)
  useEffect(() => { if (flow.current !== null) flow.current.scrollTop = flow.current.scrollHeight }, [rows.length, props.activity])
  return <div className={css.flow} ref={flow} data-im-flow>
    {state.phase !== 'ready' && <p role="status">{state.error ?? props.t(state.phase === 'reconnecting' ? 'reconnecting' : 'loading')}</p>}
    {rows.length === 0 && state.value !== undefined && <p className={css.empty}>{props.t('simulationNoMessages')}</p>}
    {rows.map(row => <MessageRow key={row.key} row={row} t={props.t}
      onVerify={props.onVerify} onRetry={props.onRetry} retryDisabled={props.retryDisabled === true} />)}
  </div>
}

type DeliveryRow = {
  readonly key: string
  readonly at: string
  readonly sender: string
  readonly state: string
  readonly content: ImMessageContent
  readonly requestId?: ImOutboundRequestId
}

function deliveryRows(value: ImDeliverySnapshot, simulated: boolean): readonly DeliveryRow[] {
  return [
    ...value.inbound.items.map(message => ({
      key: `in:${message.messageId}`, at: message.occurredAt, content: message.content,
      sender: senderKey(message, simulated), state: message.stage,
    })),
    ...value.outbound.items.map(message => ({
      key: `out:${message.requestId}`, at: message.createdAt, content: message.content,
      sender: message.intent === 'ai' ? 'senderAi' : simulated ? 'senderSimulationInjected' : 'senderDsh',
      state: message.status, requestId: message.requestId,
    })),
  ].sort((left, right) => left.at.localeCompare(right.at) || left.key.localeCompare(right.key))
}

function senderKey(message: ImInboundMessageView, simulated: boolean): string {
  switch (message.sender.kind) {
    case 'external': return 'senderExternal'
    case 'ai': return 'senderAi'
    case 'human-native': return 'senderNative'
    case 'human-dsh': return simulated ? 'senderSimulationInjected' : 'senderDsh'
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

function MessageRow({ row, t, onVerify, onRetry, retryDisabled }: {
  readonly row: DeliveryRow
  readonly t: ConversationTabProps['t']
  readonly onVerify: ((requestId: ImOutboundRequestId) => Promise<void>) | undefined
  readonly onRetry: ((requestId: ImOutboundRequestId) => Promise<void>) | undefined
  readonly retryDisabled: boolean
}): ReactElement {
  const unknown = row.state === 'result-unknown'
  return <article className={css.row} data-message-state={row.state} data-message-format={row.content.format}>
    <div className={css.meta}><Tag tone={row.sender === 'senderUnknown' ? 'warning' : row.sender === 'senderAi' ? 'neutral' : 'info'}>{t(row.sender as never)}</Tag><time>{new Date(row.at).toLocaleTimeString()}</time></div>
    {row.content.quote !== undefined && <blockquote className={css.quote} aria-label={t('quotedMessage')}>
      {row.content.quote.senderDisplayName !== undefined && <b>{row.content.quote.senderDisplayName}: </b>}
      {row.content.quote.text}
    </blockquote>}
    <MessageBody content={row.content} t={t} />
    <div className={unknown ? css.unknownState : css.time}>
      {t(stateKey(row.state) as never)}{unknown ? ` · ${t('noAutomaticRetry')}` : ''}
      {unknown && row.requestId !== undefined && onVerify !== undefined && <Button size="sm" variant="outline" onClick={() => { void onVerify(row.requestId as ImOutboundRequestId) }}>{t('checkManualSend')}</Button>}
      {unknown && row.requestId !== undefined && onRetry !== undefined && <Button size="sm" variant="outline" disabled={retryDisabled} onClick={() => { void onRetry(row.requestId as ImOutboundRequestId) }}>{t('retryManualSend')}</Button>}
    </div>
  </article>
}

function MessageBody({ content, t }: { readonly content: ImMessageContent; readonly t: ConversationTabProps['t'] }): ReactElement {
  const [open, setOpen] = useState(false)
  if (content.format === 'image') {
    return <div className={css.imageBody}>
      <FileTypeIcon kind="image" aria-hidden="true" />
      <span>{content.text === '' ? t('imagePlaceholder') : content.text}</span>
    </div>
  }
  if (content.format === 'unsupported') {
    return <div className={css.text}>
      <span className={css.degraded}>{t('unsupportedMessageType').replace('{type}', content.messageType)}</span>
      <Button size="sm" variant="outline" onClick={() => { setOpen(!open) }}>{t(open ? 'hideMessageDetails' : 'viewMessageDetails')}</Button>
      {open && <pre className={css.details}>{JSON.stringify(content.details, null, 2)}</pre>}
    </div>
  }
  return <div className={css.text}>{content.text}</div>
}
