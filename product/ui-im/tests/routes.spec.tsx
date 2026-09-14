// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ImAccountId, ImOperationId, ImRevision, ImRouteId, ImRouteView, ImRuntimeSnapshot } from '@gestaltrun/dsh-api-im/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { createRouteUiStore } from '../src/client/stores.ts'
import { TakeoverSection, type TakeoverSectionProps } from '../src/client/TakeoverSection.tsx'
import { emptyRouteDraft, prepareRouteDraft, submitRouteDraft, type RouteDraftItem } from '../src/client/route-editor.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const accountId = brandString<ImAccountId>('account')
const workspaceId = brandString<WorkspaceId>('workspace-a')
const revision = brandString<ImRevision>('revision')
const account = {
  id: accountId, platform: 'dingtalk' as const, displayName: 'Employee', identity: { platform: 'dingtalk' as const, profile: 'employee', corpId: 'corp', userId: 'employee', displayName: 'Employee' },
  authorization: { state: 'ready' as const, checkedAt: '2026-09-14T00:00:00Z' }, listener: { state: 'stopped' as const, reason: 'no-enabled-route' as const }, paused: false, connectionIntent: 'connected' as const, revision, createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z',
}
const snapshot = (routes: readonly ImRouteView[] = []): ImRuntimeSnapshot => ({ revision: 1, accounts: [account], routes, simulationTargets: [] })
const route = (id: string, target: ImRouteView['target']): ImRouteView => ({ id: brandString<ImRouteId>(id), accountId, platform: 'dingtalk', conversationKind: 'group', target, workspaceId: brandString<WorkspaceId>('workspace-b'), enabled: true, groupTrigger: { mention: true }, revision, createdAt: account.createdAt, updatedAt: account.updatedAt })
let id = 0
const operationId = (): ImOperationId => brandString<ImOperationId>(`op-${++id}`)

function mount(configuration: ImRuntimeSnapshot, submit: TakeoverSectionProps['submit']) {
  const view = createRouteUiStore().create()
  // The test binds the declared draft source; standard Session hooks are unused here.
  const props = {
    workspaceId, t: (key: keyof typeof zh) => zh[key], actions: view.actions,
    useStore: (select: (state: ReturnType<typeof view.getSnapshot>) => unknown) => select(useSyncExternalStore(view.subscribe, view.getSnapshot)),
    useConfiguration: (select: (state: { phase: 'ready'; value: ImRuntimeSnapshot; error: undefined }) => unknown) => select({ phase: 'ready', value: configuration, error: undefined }),
    submit, operationId,
  } as TakeoverSectionProps
  render(<TakeoverSection {...props} />)
  return view
}

describe('accepted route drafts', () => {
  it('keeps all target operations and unfinished results in the editor', async () => {
    const submit = vi.fn(async (items: readonly RouteDraftItem[]) => items.map((item, index) => ({ ...item, status: index === 0 ? 'applied' as const : 'unknown' as const })))
    const view = mount(snapshot(), submit)
    fireEvent.click(screen.getByRole('button', { name: zh.addRoute }))
    fireEvent.click(screen.getByLabelText(zh.scopeSpecific))
    fireEvent.change(screen.getByLabelText(zh.targetsPlaceholder), { target: { value: 'one, two, three' } })
    fireEvent.click(screen.getByRole('button', { name: zh.addRouteDisabled }))
    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    expect(submit.mock.calls[0]?.[0].map(item => item.label)).toEqual(['one', 'two', 'three'])
    await screen.findByRole('button', { name: zh.queryAndRetry })
    expect(view.getSnapshot().editors[workspaceId]?.draft.targetsText).toBe('one, two, three')
    expect(view.getSnapshot().editors[workspaceId]?.items.map(item => item.status)).toEqual(['applied', 'unknown', 'unknown'])
  })

  it('requires explicit confirmation before rebinding an all-conversations rule', async () => {
    const submit = vi.fn(async (items: readonly RouteDraftItem[]) => items.map(item => ({ ...item, status: 'applied' as const })))
    mount(snapshot([route('all', { kind: 'all' })]), submit)
    fireEvent.click(screen.getByRole('button', { name: zh.addRoute }))
    fireEvent.click(screen.getByRole('button', { name: zh.addRouteDisabled }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog').textContent).toContain('workspace-b')
    fireEvent.click(screen.getByRole('button', { name: zh.confirmRebind }))
    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    expect(submit.mock.calls[0]?.[0][0]?.operation).toMatchObject({ kind: 'rebind', request: { observedRevision: revision, observedWorkspaceId: 'workspace-b', workspaceId } })
  })

  it('queries unknown operations before retrying and never resends an applied target', async () => {
    const items = prepareRouteDraft(snapshot(), workspaceId, { ...emptyRouteDraft(accountId), scope: 'specific', targetsText: 'one,two' }, [], operationId)
    const calls: string[] = []
    const source = items.map((item, index) => ({ ...item, status: index === 0 ? 'applied' as const : 'unknown' as const }))
    const result = await submitRouteDraft({
      queryRouteOperation: async request => { calls.push(`query:${request.operationId}`); return { ok: true, value: { state: 'not-found' } } },
      applyRoutes: async request => { calls.push(`apply:${request.operations[0]!.request.operationId}`); return { ok: true, value: { items: [{ state: 'known', accountId, result: { operationId: request.operations[0]!.request.operationId, status: 'applied' } }] } } },
    }, source, operationId, new AbortController().signal)
    expect(calls).toEqual([`query:${items[1]!.operation.request.operationId}`, `apply:${items[1]!.operation.request.operationId}`])
    expect(result.map(item => item.status)).toEqual(['applied', 'applied'])
  })
})
