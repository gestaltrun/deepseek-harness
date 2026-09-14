// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ImAccountId, ImOperationId, ImRevision, ImRouteId, ImRuntimeSnapshot } from '@gestaltrun/dsh-api-im/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { SimulationSection, type SimulationSectionProps } from '../src/client/SimulationSection.tsx'
import { createRouteUiStore, type SimulationTargetCommand } from '../src/client/stores.ts'
import { submitTarget } from '../src/client/target-operation.ts'
import { bindSnapshotSelector, makeTranslate } from './helpers.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const accountId = brandString<ImAccountId>('account')
const workspaceId = brandString<WorkspaceId>('workspace-a')
const otherWorkspaceId = brandString<WorkspaceId>('workspace-b')
const routeId = brandString<ImRouteId>('route')
const revision = brandString<ImRevision>('revision')
const operationId = brandString<ImOperationId>('operation')
const target = { workspaceId, accountId, routeId, revision, updatedAt: '2026-09-14T00:00:00Z' }
const state: ImRuntimeSnapshot = {
  revision: 1,
  accounts: [{ id: accountId, platform: 'dingtalk', displayName: 'Employee', identity: { platform: 'dingtalk', profile: 'employee', corpId: 'corp', userId: 'employee', displayName: 'Employee' }, authorization: { state: 'unchecked' }, listener: { state: 'stopped', reason: 'no-enabled-route' }, paused: false, revision, createdAt: target.updatedAt, updatedAt: target.updatedAt }],
  routes: [{ id: routeId, accountId, workspaceId: otherWorkspaceId, platform: 'dingtalk', target: { kind: 'all' }, conversationKind: 'direct', enabled: false, revision, createdAt: target.updatedAt, updatedAt: target.updatedAt }],
  simulationTargets: [],
}

function mount(snapshot: ImRuntimeSnapshot, submit: SimulationSectionProps['submit']) {
  const store = createRouteUiStore().create()
  const props = {
    workspaceId, t: makeTranslate(zh), useStore: bindSnapshotSelector(store), actions: store.actions,
    useConfiguration: (select: (state: { value: ImRuntimeSnapshot }) => unknown) => select({ value: snapshot }),
    useWorkspaces: (select: (state: { items: [] }) => unknown) => select({ items: [] }),
    operationId: () => operationId, submit,
  } as SimulationSectionProps
  render(<SimulationSection {...props} />)
  return store
}

describe('Workspace simulation target configuration', () => {
  it('saves the selected real route reference even when its listener is stopped', async () => {
    const submit = vi.fn(async (_command: SimulationTargetCommand) => ({ state: 'known' as const, result: { operationId, status: 'applied' as const, target } }))
    mount(state, submit)
    fireEvent.click(screen.getByRole('button', { name: zh.selectTarget }))
    fireEvent.click(screen.getByRole('button', { name: /Employee.*workspace-b/u }))
    fireEvent.click(screen.getByRole('button', { name: zh.saveTarget }))
    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    expect(submit.mock.calls[0]?.[0]).toEqual({ kind: 'save', request: { operationId, workspaceId, observedRevision: null, accountId, routeId } })
    expect(await screen.findByText(zh.targetSaved)).toBeTruthy()
    expect(screen.getByText(zh.simulationEngineUnavailable)).toBeTruthy()
  })

  it('requires confirmation to clear and retains an unknown command', async () => {
    const submit = vi.fn(async () => ({ state: 'unknown' as const, message: 'Response lost' }))
    const store = mount({ ...state, simulationTargets: [target] }, submit)
    fireEvent.click(screen.getByRole('button', { name: zh.clearTarget }))
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: zh.clearTarget })[0]!)
    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    await screen.findByRole('button', { name: zh.queryAndRetry })
    expect(store.getSnapshot().simulations[workspaceId]?.unknown).toEqual({ kind: 'remove', request: { operationId, workspaceId, observedRevision: revision } })
  })

  it('queries the previous operation before deciding whether to repeat a target write', async () => {
    const save = vi.fn(async () => ({ ok: true as const, value: { operationId, status: 'applied' as const, target } }))
    const result = await submitTarget({
      querySimulationTargetOperation: async () => ({ ok: true, value: { state: 'known', result: { operationId, status: 'applied', target } } }),
      saveSimulationTarget: save, removeSimulationTarget: async () => { throw new Error('Unexpected remove') },
    }, { kind: 'save', request: { operationId, workspaceId, observedRevision: null, accountId, routeId } }, true)
    expect(result.state).toBe('known')
    expect(save).not.toHaveBeenCalled()
  })
})
