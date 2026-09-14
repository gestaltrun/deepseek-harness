/** Accepted workspace takeover editor with explicit CAS and partial-result drafts. */
import { useState, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImConfigurationSource, ImOperationId, ImRouteView, ImRuntimeSnapshot } from '@gestaltrun/dsh-api-im/client'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locale-types.ts'
import type {} from './workspace/contract/slots.ts'
import type { createRouteUiStore } from './stores.ts'
import { accountUsable } from './accounts.ts'
import { draftFromRoutes, emptyRouteDraft, groupRoutes, parseTargets, prepareRouteDraft, routeDraftError, type ImRouteDraft, type RouteDraftItem, type RouteEditorState } from './route-editor.ts'
import { InlineConfirm } from './InlineConfirm.tsx'
import css from './WorkspaceCards.module.css'

/** Inputs injected at registration; requests carry only the displayed observations. */
export interface TakeoverFace {
  readonly hooks: { readonly configuration: ImConfigurationSource }
  readonly operationId: () => ImOperationId
  readonly submit: (items: readonly RouteDraftItem[]) => Promise<readonly RouteDraftItem[]>
}

/** Composed props for one real Workspace's takeover settings. */
export type TakeoverSectionProps = PropsRuntime<'sidebar.workspaces.imSettings'> & PropsLocale<'settings.im'> & PropsStore<ReturnType<typeof createRouteUiStore>> & InjectFace<TakeoverFace>

/** @param props - current Workspace, drafts, configuration, and mutation callbacks. @returns takeover controls. */
export function TakeoverSection(props: TakeoverSectionProps): ReactElement {
  const state = props.useConfiguration(value => value)
  const editor = props.useStore(value => value.editors[props.workspaceId])
  const feedback = props.useStore(value => value.feedback[props.workspaceId])
  const [deleting, setDeleting] = useState<readonly ImRouteView[]>()
  const configuration = state.value
  const accounts = configuration?.accounts.filter(accountUsable) ?? []
  const groups = groupRoutes(configuration?.routes.filter(route => route.workspaceId === props.workspaceId) ?? [])
  const start = (routes: readonly ImRouteView[]): void => {
    props.actions.setEditor(props.workspaceId, {
      draft: routes.length === 0 ? emptyRouteDraft(accounts[0]?.id ?? '') : draftFromRoutes(routes),
      original: routes, items: [], confirmation: false, busy: false,
    })
  }
  const execute = async (items: readonly RouteDraftItem[], current: RouteEditorState, success?: string): Promise<void> => {
    props.actions.setEditor(props.workspaceId, { ...current, items, confirmation: false, busy: true })
    try {
      const outcomes = await props.submit(items)
      if (outcomes.every(item => item.status === 'applied')) {
        props.actions.setEditor(props.workspaceId, undefined)
        props.actions.feedback(props.workspaceId, success ?? props.t(current.original.length === 0 ? 'routeAdded' : 'routeSaved'))
      } else props.actions.setEditor(props.workspaceId, { ...current, items: outcomes, confirmation: false, busy: false })
    } catch (reason) {
      props.actions.setEditor(props.workspaceId, { ...current, items: items.map(item => item.status === 'pending' ? { ...item, status: 'unknown' } : item), confirmation: false, busy: false, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const prepare = (): void => {
    if (editor === undefined || configuration === undefined || editor.busy) return
    if (editor.draft.scope === 'specific' && parseTargets(editor.draft.targetsText).length === 0) return
    const error = routeDraftError(editor.draft)
    if (error !== undefined) { props.actions.setEditor(props.workspaceId, { ...editor, error: props.t(error) }); return }
    if (!accounts.some(account => account.id === editor.draft.accountId)) return
    const items = prepareRouteDraft(configuration, props.workspaceId, editor.draft, editor.original, props.operationId)
    if (items.some(item => item.operation.kind === 'rebind' || item.operation.kind === 'delete')) {
      props.actions.setEditor(props.workspaceId, { ...editor, items, confirmation: true })
    } else void execute(items, editor)
  }
  const mutateRows = async (routes: readonly ImRouteView[], enabled?: boolean): Promise<void> => {
    const items: RouteDraftItem[] = routes.map(route => ({
      label: route.target.kind === 'all' ? '*' : route.target.conversationId, status: 'pending',
      operation: enabled === undefined
        ? { kind: 'delete', request: { operationId: props.operationId(), accountId: route.accountId, routeId: route.id, observedRevision: route.revision, observedWorkspaceId: route.workspaceId } }
        : { kind: 'save', request: { operationId: props.operationId(), accountId: route.accountId, routeId: route.id, observedRevision: route.revision, enabled, ...route.groupTrigger === undefined ? {} : { groupTrigger: route.groupTrigger } } },
    }))
    const current = { draft: draftFromRoutes(routes), original: routes, items, confirmation: false, busy: false }
    await execute(items, current, props.t(enabled === undefined ? 'routeDeleted' : enabled ? 'routeEnabled' : 'routeDisabled'))
  }
  const { t } = props
  return <section className={css.card} data-im-takeover>
    <div className={css.title}>{t('takeoverTitle')}</div><p className={css.intro}>{t('takeoverIntro')}</p>
    {state.phase !== 'ready' && <p role="status">{state.error ?? t('loading')}</p>}
    {feedback !== undefined && <p role="status">{feedback}</p>}
    {editor === undefined ? <>
      {groups.length === 0 && <div><div className={css.name}>{t('emptyRoutes')}</div><p className={css.hint}>{t('emptyRoutesHint')}</p></div>}
      {groups.map(group => {
        const route = group[0]!
        const account = configuration?.accounts.find(item => item.id === route.accountId)
        if (account === undefined) return null
        const specific = route.target.kind === 'specific'
        return <div className={css.row} key={route.id} data-route={route.id}>
          <div className={css.main}><div className={css.name}>{account.displayName} · {t(route.conversationKind === 'group' ? 'kindGroup' : 'kindDirect')} · {t(specific ? 'scopeSpecific' : 'scopeAll')}{specific ? ` ${group.length}` : ''}
            {specific && <Tag tone="info">{t('specificPriority')}</Tag>}{specific && !route.enabled && <Tag tone="neutral">{t('disabledKeep')}</Tag>}</div>
            <p className={css.sub}>{specific ? group.flatMap(item => item.target.kind === 'specific' ? [item.target.conversationId] : []).join('、') : t('scopeAllSuffix')}{triggerSummary(t, route)}</p>
            {specific && !route.enabled && <p className={css.hint}>{t('disabledKeepHint')}</p>}
            {deleting?.[0]?.id === route.id && <InlineConfirm cancelLabel={t('cancel')} confirmLabel={t('confirmDeleteRoute')} onCancel={() => { setDeleting(undefined) }} onConfirm={() => { setDeleting(undefined); void mutateRows(deleting) }}>
              {t(specific ? 'deleteRouteHintSpecific' : 'deleteRouteHintAll')}
            </InlineConfirm>}
          </div>
          <div className={css.acts}><Button variant="outline" size="sm" onClick={() => { start(group) }}>{t('editRoute')}</Button>
            <Button variant="outline" size="sm" onClick={() => { setDeleting(group) }}>{t('deleteRoute')}</Button>
            <Switch checked={route.enabled} label={t('enabled')} onChange={enabled => { void mutateRows(group, enabled) }} /></div>
        </div>
      })}
      <Button variant="outline" disabled={configuration === undefined} onClick={() => { start([]) }}>{t('addRoute')}</Button>
    </> : <>
      <RouteFields draft={editor.draft} accounts={accounts} disabled={editor.busy || editor.confirmation || editor.items.length > 0} t={t}
        onChange={patch => { props.actions.editDraft(props.workspaceId, patch) }} />
      {editor.error !== undefined && <p role="alert" className={css.error}>{editor.error}</p>}
      {editor.confirmation && <InlineConfirm cancelLabel={t('cancel')} confirmLabel={t('confirmRebind')} onCancel={() => { props.actions.setEditor(props.workspaceId, { ...editor, items: [], confirmation: false }) }} onConfirm={() => { void execute(editor.items, editor) }}>
        {editor.items.filter(item => item.operation.kind === 'rebind' || item.operation.kind === 'delete').map(item => <p key={item.operation.request.operationId}>{item.label}: {item.operation.kind === 'rebind' ? t('rebindOwner').replace('{owner}', item.operation.request.observedWorkspaceId).replace('{target}', props.workspaceId) : t('deleteRouteHintSpecific')}</p>)}
        {t('rebindConfirm')}
      </InlineConfirm>}
      {!editor.confirmation && editor.items.length > 0 && <div role="status">{editor.items.map(item => <p key={item.operation.request.operationId}>{item.label} · {t(item.status === 'applied' ? 'draftApplied' : item.status === 'conflict' ? 'draftConflict' : item.status === 'rejected' ? 'draftRejected' : item.status === 'unknown' ? 'draftUnknown' : 'draftPending')}{item.message === undefined ? '' : ` · ${item.message}`}</p>)}</div>}
      <div className={css.acts}><Button variant="outline" disabled={editor.busy} onClick={() => { props.actions.setEditor(props.workspaceId, undefined) }}>{t('cancel')}</Button>
        {editor.items.length === 0 ? <Button variant="primary" disabled={editor.busy || editor.confirmation || accounts.length === 0} onClick={prepare}>{t(editor.original.length === 0 ? 'addRouteDisabled' : 'saveRoute')}</Button>
          : !editor.confirmation && <>
            {editor.items.some(item => item.status === 'unknown') && <Button disabled={editor.busy} onClick={() => { void execute(editor.items, editor) }}>{t('queryAndRetry')}</Button>}
            <Button disabled={editor.busy} onClick={() => {
              const original = configuration?.routes.filter(route => editor.original.some(item => item.id === route.id)) ?? []
              props.actions.setEditor(props.workspaceId, { draft: editor.draft, original, items: [], confirmation: false, busy: false })
            }}>{t('reviewCurrentRoutes')}</Button>
          </>}
      </div><p className={css.hint}>{t('newRouteHint')}</p>
    </>}
  </section>
}

function triggerSummary(t: TakeoverSectionProps['t'], route: ImRouteView): string {
  if (route.conversationKind !== 'group' || route.groupTrigger === undefined) return ''
  const parts = [route.groupTrigger.mention ? '@' : '', route.groupTrigger.everyN === undefined ? '' : t('triggerEveryNSummary').replace('{n}', String(route.groupTrigger.everyN)), route.groupTrigger.fixedIntervalSeconds === undefined ? '' : t('triggerIntervalSummary').replace('{n}', String(route.groupTrigger.fixedIntervalSeconds / 60))].filter(Boolean)
  return ` · ${t('triggerSummaryPrefix')} ${parts.join(' · ')}`
}

function RouteFields({ draft, accounts, disabled, t, onChange }: {
  draft: ImRouteDraft; accounts: ImRuntimeSnapshot['accounts']; disabled: boolean; t: TakeoverSectionProps['t']; onChange: (patch: Partial<ImRouteDraft>) => void
}): ReactElement {
  return <fieldset className={css.form} disabled={disabled}>
    {accounts.length === 0 && <p className={css.warn}>{t('noAccounts')}</p>}
    <label>{t('account')}<select aria-label={t('account')} value={draft.accountId} onChange={event => { onChange({ accountId: event.target.value }) }}>{accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label>
    <select aria-label={t('kindGroup')} value={draft.conversationKind} onChange={event => { onChange({ conversationKind: event.target.value === 'direct' ? 'direct' : 'group' }) }}><option value="group">{t('kindGroup')}</option><option value="direct">{t('kindDirect')}</option></select>
    <label><input type="radio" checked={draft.scope === 'all'} onChange={() => { onChange({ scope: 'all' }) }} />{t('scopeAll')} {t('scopeAllSuffix')}</label>
    <label><input type="radio" checked={draft.scope === 'specific'} onChange={() => { onChange({ scope: 'specific' }) }} />{t('scopeSpecific')}</label>
    {draft.scope === 'specific' && <Input aria-label={t('targetsPlaceholder')} placeholder={t('targetsPlaceholder')} value={draft.targetsText} onChange={event => { onChange({ targetsText: event.target.value }) }} />}
    {draft.conversationKind === 'group' && <div className={css.checks}><div className={css.name}>{t('triggerTitle')}</div>
      <label><input type="checkbox" checked={draft.mention} onChange={event => { onChange({ mention: event.target.checked }) }} />{t('triggerMention')}</label>
      <label><input type="checkbox" checked={draft.everyNEnabled} onChange={event => { onChange({ everyNEnabled: event.target.checked }) }} />{t('triggerEveryN')}<Input type="number" min={1} aria-label={t('triggerEveryN')} value={draft.everyN} onChange={event => { onChange({ everyN: event.target.value, everyNEnabled: true }) }} /></label>
      <label><input type="checkbox" checked={draft.intervalEnabled} onChange={event => { onChange({ intervalEnabled: event.target.checked }) }} />{t('triggerInterval')}<Input type="number" min={1} aria-label={t('triggerInterval')} value={draft.intervalMin} onChange={event => { onChange({ intervalMin: event.target.value, intervalEnabled: true }) }} /></label>
      <p className={css.hint}>{t('triggerHint')}</p>
    </div>}
  </fieldset>
}
