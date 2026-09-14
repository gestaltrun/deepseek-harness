/** Configured simulation targets reference authoritative routes and preserve CAS outcomes. */
import { useState, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImConfigurationSource, ImOperationId, ImRouteView, ImSimulationTargetMutationResult } from '@gestaltrun/dsh-api-im/client'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locale-types.ts'
import type {} from './workspace/contract/slots.ts'
import type { createRouteUiStore, SimulationTargetCommand } from './stores.ts'
import { InlineConfirm } from './InlineConfirm.tsx'
import css from './WorkspaceCards.module.css'

/** Mutation acknowledgements preserve unknown operation identities. */
export type TargetOutcome = { readonly state: 'known'; readonly result: ImSimulationTargetMutationResult } | { readonly state: 'unknown'; readonly message: string }
/** Plain target commands and configuration source injected by the UI owner. */
export interface SimulationFace {
  readonly hooks: { readonly configuration: ImConfigurationSource }
  readonly operationId: () => ImOperationId
  readonly submit: (command: SimulationTargetCommand, queryFirst: boolean) => Promise<TargetOutcome>
}

/** Derived target settings props share only editable state with the takeover card. */
export type SimulationSectionProps = PropsRuntime<'sidebar.workspaces.imSettings'> & PropsLocale<'settings.im'> & PropsStore<ReturnType<typeof createRouteUiStore>> & InjectFace<SimulationFace>

/** @param props - real Workspace identity, authoritative routes, and target commands. @returns the target selection card. */
export function SimulationSection(props: SimulationSectionProps): ReactElement {
  const configuration = props.useConfiguration(state => state.value)
  const workspaces = props.useWorkspaces(state => state.items)
  const saved = configuration?.simulationTargets.find(target => target.workspaceId === props.workspaceId)
  const editor = props.useStore(state => state.simulations[props.workspaceId]) ?? { picking: false, selected: '', query: '', busy: false }
  const [confirmClear, setConfirmClear] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const current = configuration?.routes.find(route => route.id === saved?.routeId && route.accountId === saved.accountId)
  const ownerName = (id: string): string => workspaces.find(workspace => workspace.workspaceId === id)?.title ?? id
  const accountFor = (route: ImRouteView) => configuration?.accounts.find(account => account.id === route.accountId)
  const label = (route: ImRouteView): string => `${accountFor(route)?.displayName ?? route.accountId} · ${route.target.kind === 'specific' ? route.target.conversationId : props.t(route.conversationKind === 'group' ? 'allGroup' : 'allDirect')}`
  const execute = async (command: SimulationTargetCommand, queryFirst = false): Promise<void> => {
    props.actions.setSimulation(props.workspaceId, { ...editor, busy: true, unknown: command })
    try {
      const result = await props.submit(command, queryFirst)
      if (result.state === 'unknown') {
        props.actions.setSimulation(props.workspaceId, { ...editor, busy: false, unknown: command, error: result.message })
      } else if (result.result.status === 'applied' || result.result.status === 'unchanged') {
        props.actions.setSimulation(props.workspaceId, { picking: false, selected: '', query: '', busy: false })
        setConfirmClear(false); setFeedback(props.t(command.kind === 'save' ? 'targetSaved' : 'targetCleared'))
      } else props.actions.setSimulation(props.workspaceId, { picking: true, selected: editor.selected, query: editor.query, busy: false, error: result.result.message ?? props.t('targetChanged') })
    } catch (reason) {
      props.actions.setSimulation(props.workspaceId, { ...editor, busy: false, unknown: command, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const openPicker = (): void => { props.actions.setSimulation(props.workspaceId, { picking: true, selected: saved?.routeId ?? '', query: '', busy: false }) }
  const matches = configuration?.routes.filter(route => `${label(route)} ${ownerName(route.workspaceId)}`.toLocaleLowerCase().includes(editor.query.trim().toLocaleLowerCase())) ?? []
  const selected = matches.find(route => route.id === editor.selected)
  const t = props.t
  return <section className={css.card} data-im-simulation>
    <div className={css.title}>{t('simulationTitle')}</div><p className={css.intro}>{t('simulationIntro')}</p><p role="status" className={css.hint}>{t('simulationEngineUnavailable')}</p>
    {feedback !== undefined && <p role="status">{feedback}</p>}
    {editor.error !== undefined && <p role="alert" className={css.error}>{editor.error}</p>}
    {editor.unknown !== undefined && <p role="status">{t('draftUnknown')}<Button disabled={editor.busy} onClick={() => { void execute(editor.unknown!, true) }}>{t('queryAndRetry')}</Button></p>}
    {editor.picking ? <>
      <Input aria-label={t('pickerSearchPlaceholder')} placeholder={t('pickerSearchPlaceholder')} value={editor.query} disabled={editor.busy || editor.unknown !== undefined}
        onChange={event => { props.actions.setSimulation(props.workspaceId, { ...editor, query: event.target.value }) }} />
      {([true, false] as const).map(own => <div key={String(own)}><div className={css.pickerGroup}>{own ? t('groupThisWorkspace').replace('{ws}', ownerName(props.workspaceId)) : t('groupOtherWorkspaces')}</div>
        {matches.filter(route => (route.workspaceId === props.workspaceId) === own).map(route => <button key={route.id} type="button" className={css.pickerRow} aria-pressed={editor.selected === route.id}
          disabled={editor.busy || editor.unknown !== undefined || accountFor(route) === undefined} onClick={() => { props.actions.setSimulation(props.workspaceId, { ...editor, selected: route.id }) }}>{label(route)} · {ownerName(route.workspaceId)}</button>)}
      </div>)}
      {matches.length === 0 && <p className={css.hint}>{t('pickerNoMatch')}</p>}
      <div className={css.acts}><Button disabled={editor.busy} onClick={() => { props.actions.setSimulation(props.workspaceId, { ...editor, picking: false }) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={editor.busy || editor.unknown !== undefined || selected === undefined || accountFor(selected) === undefined} onClick={() => {
          if (selected !== undefined) void execute({ kind: 'save', request: { operationId: props.operationId(), workspaceId: props.workspaceId, observedRevision: saved?.revision ?? null, accountId: selected.accountId, routeId: selected.id } })
        }}>{t('saveTarget')}</Button></div>
    </> : current === undefined ? <>
      <div className={css.name}>{t(saved === undefined ? 'simulationUnconfigured' : 'identityMissing')}</div>
      <p className={css.hint}>{t('simulationUnconfiguredHint')}</p>
      <Button variant="primary" disabled={configuration === undefined || editor.unknown !== undefined} onClick={openPicker}>{t('selectTarget')}</Button>
    </> : <div className={css.row}><div className={css.main}><div className={css.name}>{label(current)}</div><p>{t('targetOwner').replace('{owner}', ownerName(current.workspaceId))}</p>
      {accountFor(current) === undefined ? <Tag tone="danger">{t('identityMissing')}</Tag> : <>
        {accountFor(current)?.listener.state !== 'running' && <Tag tone="neutral">{t('realChannelIdle')}</Tag>}
        {accountFor(current)?.authorization.state === 'required' && <Tag tone="neutral">{t('realChannelExpired')}</Tag>}
        {!current.enabled && <Tag tone="warning">{t('realHandlingDisabled')}</Tag>}<Tag tone="success">{t('simulationReadyData')}</Tag>
      </>}
      {confirmClear && saved !== undefined && <InlineConfirm disabled={editor.busy || editor.unknown !== undefined} cancelLabel={t('cancel')} confirmLabel={t('clearTarget')} onCancel={() => { setConfirmClear(false) }} onConfirm={() => { void execute({ kind: 'remove', request: { operationId: props.operationId(), workspaceId: props.workspaceId, observedRevision: saved.revision } }) }}>{t('clearTargetHint')}</InlineConfirm>}
    </div><div className={css.acts}><Button disabled={editor.busy || editor.unknown !== undefined} onClick={openPicker}>{t('changeTarget')}</Button><Button disabled={editor.busy || editor.unknown !== undefined} onClick={() => { setConfirmClear(true) }}>{t('clearTarget')}</Button></div></div>}
  </section>
}
