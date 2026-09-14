// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ImAccountId, ImDeliverySnapshot, ImOperationId, ImRevision, ImRouteId,
  ImRuntimeSnapshot, ImSimulationInstanceId, ImSimulationInstanceView,
} from '@gestaltrun/dsh-api-im/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { ConversationTab } from '../src/client/ConversationTab.tsx'
import { SimulationHeader } from '../src/client/SimulationHeader.tsx'
import { createConversationUiStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { bindSnapshotSelector, makeTranslate } from './helpers.ts'

afterEach(cleanup)

const sessionId = brandString<SessionId>('session-sim')
const testedSessionId = brandString<SessionId>('session-tested')
const workspaceId = brandString<WorkspaceId>('workspace-sim')
const testedWorkspaceId = brandString<WorkspaceId>('workspace-tested')
const accountId = brandString<ImAccountId>('account')
const routeId = brandString<ImRouteId>('route')
const revision = brandString<ImRevision>('revision')
const instanceId = brandString<ImSimulationInstanceId>('simulation')
const now = '2026-09-14T00:00:00.000Z'

const instance = (status: ImSimulationInstanceView['status']): ImSimulationInstanceView => ({
  instanceId, status, simUserSessionId: sessionId, simUserWorkspaceId: workspaceId,
  testedSessionId, target: {
    platform: 'wangwang', accountId, routeId, routeRevision: revision, accountRevision: revision,
    conversationKind: 'direct', conversationId: 'buyer-1', workspaceId: testedWorkspaceId, agentPreset: 'standard',
  },
  speakingMembers: [{ actorId: 'buyer-1', displayName: 'Buyer' }],
  createdAt: now, updatedAt: now,
  ...(status === 'failed' ? { failure: { code: 'IM_SIMULATION_CREATE_FAILED', message: 'creation failed' } } : {}),
})

const configuration: ImRuntimeSnapshot = {
  revision: 1, accounts: [], routes: [],
  simulationTargets: [{ workspaceId, accountId, routeId, revision, updatedAt: now }],
}

const emptyDelivery: ImDeliverySnapshot = {
  scope: { kind: 'simulation', instanceId, platform: 'wangwang', accountId, conversationKind: 'direct', conversationId: 'buyer-1' },
  cursor: { scopeId: brandString('scope'), platformCursor: null, lastReceivedSequenceNumber: 0, lastSubmittedSequenceNumber: 0, pendingCount: 0, updatedAt: now },
  inbound: { items: [], hasMore: false }, outbound: { items: [], hasMore: false },
}

function source<Value>(value: Value) {
  return { getSnapshot: () => value, subscribe: () => () => {}, dispose: vi.fn(async () => {}) }
}

function mount(options: {
  status?: ImSimulationInstanceView['status']
  configured?: boolean
  create?: ReturnType<typeof vi.fn>
  injectMember?: ReturnType<typeof vi.fn>
  beginStop?: ReturnType<typeof vi.fn>
  waitStopped?: ReturnType<typeof vi.fn>
} = {}) {
  const store = createConversationUiStore().create()
  const bound = options.status === undefined ? undefined : instance(options.status)
  const scope = bound === undefined ? undefined : {
    instanceId, role: 'sim-user' as const, sessionId, peerSessionId: testedSessionId,
    workspaceId, peerWorkspaceId: testedWorkspaceId, deliveryScope: emptyDelivery.scope, status: bound.status,
  }
  const create = options.create ?? vi.fn(async () => ({ ok: true, value: instance('running') }))
  const injectMember = options.injectMember ?? vi.fn(async () => ({ ok: true, value: {} }))
  const beginStop = options.beginStop ?? vi.fn(async () => ({ ok: true, value: instance('stopping') }))
  const waitStopped = options.waitStopped ?? vi.fn(async () => ({ ok: true, value: instance('stopped') }))
  const openSession = vi.fn()
  const snapshot = options.configured === false ? { ...configuration, simulationTargets: [] } : configuration
  render(<ConversationTab {...({
    sessionId, t: makeTranslate(zh), useStore: bindSnapshotSelector(store), actions: store.actions,
    useConfiguration: bindSnapshotSelector(source({ phase: 'ready', value: snapshot, error: undefined })),
    useWorkspaces: bindSnapshotSelector(source({ items: [{ workspaceId, sessionIds: [sessionId], title: 'Sim' }] })),
    watchSession: () => source({ phase: 'ready', value: { sessionId, ...(scope === undefined ? {} : { scope }), ...(bound === undefined ? {} : { instance: bound }) }, error: undefined }),
    watchDelivery: () => source({ phase: 'ready', value: emptyDelivery, error: undefined }),
    create, injectMember, injectManagedHuman: vi.fn(async () => ({ ok: true, value: {} })), beginStop, waitStopped,
    resolveSession: vi.fn(async () => ({ ok: true, value: undefined })), openSession,
    useTabInfo: () => ({}),
  } as never)} />)
  return { store, create, injectMember, beginStop, waitStopped, openSession }
}

describe('simulation conversation sidebar', () => {
  it('shows role-specific main headings from Host scope and the bound Workspace', () => {
    const bound = instance('running')
    const header = (role: 'sim-user' | 'tested') => ({
      sessionId: role === 'sim-user' ? sessionId : testedSessionId,
      t: makeTranslate(zh),
      watchSession: () => source({
        phase: 'ready', error: undefined, value: {
          sessionId: role === 'sim-user' ? sessionId : testedSessionId,
          instance: bound,
          scope: {
            instanceId, role,
            sessionId: role === 'sim-user' ? sessionId : testedSessionId,
            peerSessionId: role === 'sim-user' ? testedSessionId : sessionId,
            workspaceId: role === 'sim-user' ? workspaceId : testedWorkspaceId,
            peerWorkspaceId: role === 'sim-user' ? testedWorkspaceId : workspaceId,
            deliveryScope: emptyDelivery.scope, status: 'running' as const,
          },
        },
      }),
      useSessions: bindSnapshotSelector(source({ byId: { [sessionId]: { displayTitle: '退货任务' } } })),
      useWorkspaces: bindSnapshotSelector(source({ items: [{ workspaceId, title: '模拟工作区' }, { workspaceId: testedWorkspaceId, title: '售后工作区' }] })),
    })
    const view = render(<SimulationHeader {...(header('sim-user') as never)} />)
    expect(screen.getByText('退货任务 · 模拟用户 Agent')).toBeTruthy()
    expect(screen.getByText('/ 模拟工作区（模拟用户 Agent 自己的工作区）')).toBeTruthy()
    view.rerender(<SimulationHeader {...(header('tested') as never)} />)
    expect(screen.getByText('buyer-1 接待 · 被测 Agent')).toBeTruthy()
    expect(screen.getByText('/ 售后工作区（目标绑定的被测工作区）')).toBeTruthy()
  })

  it('shows truthful unconfigured state without creation controls', () => {
    mount({ configured: false })
    expect(screen.getByText(zh.simulationUnconfigured)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.createSimulation })).toBeNull()
  })

  it('creates from the exact selected Session and frozen participants', async () => {
    const { create } = mount()
    fireEvent.change(screen.getByLabelText(zh.simulationConversationId), { target: { value: 'buyer-77' } })
    fireEvent.change(screen.getByLabelText(zh.simulationParticipants), { target: { value: 'buyer-77|Buyer' } })
    fireEvent.click(screen.getByRole('button', { name: zh.createSimulation }))
    await waitFor(() => { expect(create).toHaveBeenCalledWith({ simUserSessionId: sessionId, conversationId: 'buyer-77', speakingMembers: [{ actorId: 'buyer-77', displayName: 'Buyer' }] }) })
  })

  it('uses Host peer identity, injects one allow-listed member, and stops by begin then wait', async () => {
    const order: string[] = []
    const beginStop = vi.fn(async () => { order.push('begin'); return { ok: true, value: instance('stopping') } })
    const waitStopped = vi.fn(async () => { order.push('wait'); return { ok: true, value: instance('stopped') } })
    const { injectMember, openSession } = mount({ status: 'running', beginStop, waitStopped })
    fireEvent.click(screen.getByRole('button', { name: zh.openTested }))
    expect(openSession).toHaveBeenCalledWith(testedSessionId)
    fireEvent.change(screen.getByLabelText(zh.simulationSpeakingMember), { target: { value: 'buyer-1' } })
    fireEvent.change(screen.getByLabelText(zh.memberHint), { target: { value: 'Does XL fit?' } })
    fireEvent.click(screen.getByRole('button', { name: zh.sendAsMember }))
    await waitFor(() => { expect(injectMember).toHaveBeenCalledWith({ instanceId, actorId: 'buyer-1', text: 'Does XL fit?' }) })
    fireEvent.click(screen.getByRole('button', { name: zh.stopSimulation }))
    expect(beginStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.confirmStopSimulation }))
    await waitFor(() => { expect(order).toEqual(['begin', 'wait']) })
  })

  it.each(['creating', 'stopping', 'stopped', 'failed'] as const)('renders %s as a truthful read-only state', status => {
    mount({ status })
    expect(document.querySelector(`[data-simulation-status="${status}"]`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.sendAsMember })).toBeNull()
  })
})
