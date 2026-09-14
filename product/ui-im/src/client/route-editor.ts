/** Route drafts retain every target, observed revision, and operation identity. */
import type {
  IImClient, ImAccountId, ImGroupTrigger, ImOperationId, ImRouteOperation,
  ImRouteView, ImRuntimeSnapshot,
} from '@gestaltrun/dsh-api-im/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Editable route fields; account and target data remain in the Client configuration object. */
export interface ImRouteDraft {
  readonly accountId: string
  readonly conversationKind: 'direct' | 'group'
  readonly scope: 'all' | 'specific'
  readonly targetsText: string
  readonly mention: boolean
  readonly everyNEnabled: boolean
  readonly everyN: string
  readonly intervalEnabled: boolean
  readonly intervalMin: string
}

/** One pending editor command and its last acknowledged outcome. */
export interface RouteDraftItem {
  readonly label: string
  readonly operation: ImRouteOperation
  readonly status: 'pending' | 'applied' | 'conflict' | 'rejected' | 'unknown'
  readonly message?: string
  readonly followup?: { readonly enabled: boolean; readonly groupTrigger?: ImGroupTrigger }
}

/** Editor state survives workspace settings remounts without duplicating business state. */
export interface RouteEditorState {
  readonly draft: ImRouteDraft
  readonly original: readonly ImRouteView[]
  readonly items: readonly RouteDraftItem[]
  readonly confirmation: boolean
  readonly busy: boolean
  readonly error?: string
}

/** @param accountId - initially selected account. @returns the accepted disabled-rule draft defaults. */
export function emptyRouteDraft(accountId: string): ImRouteDraft {
  return { accountId, conversationKind: 'group', scope: 'all', targetsText: '', mention: true, everyNEnabled: false, everyN: '10', intervalEnabled: false, intervalMin: '5' }
}

/** @param routes - selected displayed group. @returns editable fields preserving all selected specific targets. */
export function draftFromRoutes(routes: readonly ImRouteView[]): ImRouteDraft {
  const route = routes[0]
  if (route === undefined) return emptyRouteDraft('')
  return {
    accountId: route.accountId, conversationKind: route.conversationKind, scope: route.target.kind,
    targetsText: routes.flatMap(item => item.target.kind === 'specific' ? [item.target.conversationId] : []).join(', '),
    mention: route.groupTrigger?.mention === true,
    everyNEnabled: route.groupTrigger?.everyN !== undefined, everyN: String(route.groupTrigger?.everyN ?? 10),
    intervalEnabled: route.groupTrigger?.fixedIntervalSeconds !== undefined, intervalMin: String((route.groupTrigger?.fixedIntervalSeconds ?? 300) / 60),
  }
}

/** @param text - comma or whitespace separated target identifiers. @returns every unique nonblank target in entered order. */
export function parseTargets(text: string): readonly string[] {
  return [...new Set(text.split(/[,，\s]+/u).map(value => value.trim()).filter(Boolean))]
}

/** @param draft - current editable fields. @returns locale validation key, or undefined. */
export function routeDraftError(draft: ImRouteDraft): 'triggerRequired' | 'everyNInvalid' | 'intervalInvalid' | undefined {
  if (draft.conversationKind === 'direct') return undefined
  if (!draft.mention && !draft.everyNEnabled && !draft.intervalEnabled) return 'triggerRequired'
  if (draft.everyNEnabled && (!Number.isSafeInteger(Number(draft.everyN)) || Number(draft.everyN) < 1)) return 'everyNInvalid'
  if (draft.intervalEnabled && (!Number.isSafeInteger(Number(draft.intervalMin)) || Number(draft.intervalMin) < 1)) return 'intervalInvalid'
  return undefined
}

function trigger(draft: ImRouteDraft): ImGroupTrigger | undefined {
  if (draft.conversationKind === 'direct') return undefined
  return { ...draft.mention ? { mention: true } : {}, ...draft.everyNEnabled ? { everyN: Number(draft.everyN) } : {}, ...draft.intervalEnabled ? { fixedIntervalSeconds: Number(draft.intervalMin) * 60 } : {} }
}

function targetMatches(route: ImRouteView, draft: ImRouteDraft, conversationId: string | undefined): boolean {
  return route.accountId === draft.accountId && route.conversationKind === draft.conversationKind
    && (conversationId === undefined ? route.target.kind === 'all' : route.target.kind === 'specific' && route.target.conversationId === conversationId)
}

/**
 * Prepare explicit commands without executing or transferring any route.
 * @param snapshot - observed authoritative routes.
 * @param workspaceId - workspace whose row opened this editor.
 * @param draft - complete editable target selection.
 * @param original - route revisions captured when editing began.
 * @param operationId - fresh idempotency identity per command.
 * @returns every required command, including guarded removals and explicit rebinds.
 */
export function prepareRouteDraft(snapshot: ImRuntimeSnapshot, workspaceId: WorkspaceId, draft: ImRouteDraft, original: readonly ImRouteView[], operationId: () => ImOperationId): readonly RouteDraftItem[] {
  const account = snapshot.accounts.find(value => value.id === draft.accountId)
  if (account === undefined) throw new Error('IM_ACCOUNT_NOT_FOUND')
  const targets = draft.scope === 'all' ? [undefined] : parseTargets(draft.targetsText)
  const groupTrigger = trigger(draft)
  const behavior = { ...(groupTrigger === undefined ? {} : { groupTrigger }) }
  const removed = original.filter(route => !targets.some(target => targetMatches(route, draft, target)))
  const items: RouteDraftItem[] = removed.map(route => ({
    label: route.target.kind === 'all' ? '*' : route.target.conversationId, status: 'pending',
    operation: { kind: 'delete', request: { operationId: operationId(), accountId: route.accountId, routeId: route.id, observedRevision: route.revision, observedWorkspaceId: route.workspaceId } },
  }))
  for (const conversationId of targets) {
    const current = snapshot.routes.find(route => targetMatches(route, draft, conversationId))
    const observed = current === undefined ? undefined : original.find(route => route.id === current.id) ?? current
    const label = conversationId ?? '*'
    if (observed === undefined) {
      items.push({ label, status: 'pending', operation: { kind: 'create', request: {
        operationId: operationId(), accountId: account.id, workspaceId, conversationKind: draft.conversationKind,
        target: conversationId === undefined ? { kind: 'all' } : { kind: 'specific', conversationId }, enabled: false, ...behavior,
      } } })
    } else if (observed.workspaceId === workspaceId) {
      items.push({ label, status: 'pending', operation: { kind: 'save', request: {
        operationId: operationId(), accountId: account.id, routeId: observed.id, observedRevision: observed.revision, enabled: observed.enabled, ...behavior,
      } } })
    } else {
      items.push({ label, status: 'pending', followup: { enabled: observed.enabled, ...behavior }, operation: { kind: 'rebind', request: {
        operationId: operationId(), accountId: account.id, routeId: observed.id, observedRevision: observed.revision,
        observedWorkspaceId: observed.workspaceId, workspaceId,
      } } })
    }
  }
  return items
}

type RouteCommands = Pick<IImClient, 'applyRoutes' | 'queryRouteOperation'>

/**
 * Reconcile unknown receipts before retrying, preserving applied targets and unfinished drafts.
 * @param commands - authoritative Client command object.
 * @param source - pending or previously attempted editor items.
 * @param operationId - fresh identity for behavior edits after confirmed rebinds.
 * @param signal - plugin lifetime cancellation.
 * @returns latest per-target editor outcomes without changing the configuration projection.
 */
export async function submitRouteDraft(commands: RouteCommands, source: readonly RouteDraftItem[], operationId: () => ImOperationId, signal: AbortSignal): Promise<readonly RouteDraftItem[]> {
  const results: RouteDraftItem[] = []
  for (const item of source) {
    if (item.status === 'applied' || item.status === 'conflict' || item.status === 'rejected') { results.push(item); continue }
    let result
    if (item.status === 'unknown') {
      const receipt = await commands.queryRouteOperation({ accountId: item.operation.request.accountId, operationId: item.operation.request.operationId })
      if (!receipt.ok) { results.push({ ...item, status: 'unknown', message: receipt.error.message }); continue }
      if (receipt.value.state === 'known') result = receipt.value.result
    }
    if (result === undefined) {
      const response = await commands.applyRoutes({ operations: [item.operation] }, signal)
      if (!response.ok) { results.push({ ...item, status: 'unknown', message: response.error.message }); continue }
      const receipt = response.value.items[0]
      if (receipt === undefined || receipt.state === 'unknown') { results.push({ ...item, status: 'unknown' }); continue }
      if (receipt.state === 'rejected') { results.push({ ...item, status: 'rejected', message: receipt.message }); continue }
      result = receipt.result
    }
    const status = result.status === 'unchanged' ? 'applied' : result.status
    if (status === 'applied' && item.operation.kind === 'rebind' && item.followup !== undefined && result.route !== undefined) {
      const next: RouteDraftItem = { label: item.label, status: 'pending', operation: { kind: 'save', request: {
        operationId: operationId(), accountId: result.route.accountId, routeId: result.route.id, observedRevision: result.route.revision, ...item.followup,
      } } }
      results.push(...await submitRouteDraft(commands, [next], operationId, signal))
    } else {
      results.push({ ...item, status, ...result.message === undefined ? {} : { message: result.message } })
    }
  }
  return results
}

/** @param routes - authoritative rows for one workspace. @returns presentation groups sharing editable behavior. */
export function groupRoutes(routes: readonly ImRouteView[]): readonly (readonly ImRouteView[])[] {
  const groups = new Map<string, ImRouteView[]>()
  for (const route of routes) {
    const key = JSON.stringify([route.accountId, route.conversationKind, route.target.kind, route.enabled, route.groupTrigger ?? null])
    const group = groups.get(key) ?? []
    group.push(route); groups.set(key, group)
  }
  return [...groups.values()]
}
