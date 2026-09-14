// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ImAccountId, ImAgentTaskId, ImDeliveryOperationId, ImDeliverySnapshot, ImInboundMessageView, ImMessageContent, ImMessageId,
  ImOperationId, ImOutboundRequestId, ImOutboundView, ImRealSessionBinding, ImRevision, ImRouteId,
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
const taskId = brandString<ImAgentTaskId>('task')
const now = '2026-09-14T00:00:00.000Z'

const realBinding = (accountState: Partial<ImRealSessionBinding['accountState']> = {}, sync?: ImRealSessionBinding['sync']): ImRealSessionBinding => ({
  sessionId, taskId, routeId, routeRevision: revision, accountRevision: revision, workspaceId,
  scope: { kind: 'real', platform: 'dingtalk', accountId, conversationKind: 'group', conversationId: 'group-1' },
  senderIdentity: {
    accountId, platform: 'dingtalk', displayName: '张伟', providerActorId: 'actor-1',
    identity: { platform: 'dingtalk', profile: 'default', corpId: 'corp', userId: 'user', displayName: '张伟' },
  },
  accountState: {
    authorization: { state: 'ready', checkedAt: now }, connectionIntent: 'connected',
    listener: { state: 'running', readyAt: now }, paused: false, manualSend: { state: 'available' },
    ...accountState,
  },
  destination: { conversationKind: 'group', conversationId: 'group-1', displayName: '售后群', memberCount: 12 },
  ...(sync === undefined ? {} : { sync }),
})

const outbound = (status: ImOutboundView['status'], content: ImMessageContent, requestId: ImOutboundRequestId): ImOutboundView => ({
  requestId, scopeId: brandString('scope'), intent: 'human-manual', content, status,
  sequenceNumber: 1, createdAt: now, updatedAt: now,
})

const inbound = (content: ImMessageContent): ImInboundMessageView => ({
  messageId: brandString<ImMessageId>('message'), scopeId: brandString('scope'), externalMessageId: 'external',
  sender: { kind: 'external', senderId: 'buyer', senderDisplayName: '张伟' },
  content, origin: 'live', stage: 'received', sequenceNumber: 1, occurredAt: now, receivedAt: now,
})

const instance = (status: ImSimulationInstanceView['status'], historyImports: ImSimulationInstanceView['historyImports'] = []): ImSimulationInstanceView => ({
  instanceId, status, simUserSessionId: sessionId, simUserWorkspaceId: workspaceId,
  testedSessionId, target: {
    platform: 'wangwang', accountId, routeId, routeRevision: revision, accountRevision: revision,
    conversationKind: 'direct', conversationId: 'buyer-1', workspaceId: testedWorkspaceId, agentPreset: 'standard',
  },
  speakingMembers: [{ actorId: 'buyer-1', displayName: 'Buyer' }],
  historyImports,
  createdAt: now, updatedAt: now,
  ...(status === 'failed' ? { failure: { code: 'IM_SIMULATION_CREATE_FAILED', message: 'creation failed' } } : {}),
})

const liveRevision = brandString<ImRevision>('revision-live')

const configuredAccount = {
  id: accountId, platform: 'dingtalk' as const, displayName: '张伟',
  identity: { platform: 'dingtalk' as const, profile: 'default', corpId: 'corp', userId: 'user', displayName: '张伟' },
  authorization: { state: 'ready' as const, checkedAt: now }, listener: { state: 'running' as const, readyAt: now },
  connectionIntent: 'connected' as const, paused: false, revision: liveRevision, createdAt: now, updatedAt: now,
}

const configuration: ImRuntimeSnapshot = {
  revision: 1, accounts: [configuredAccount], routes: [],
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
  binding?: ImRealSessionBinding
  delivery?: ImDeliverySnapshot
  historyImports?: ImSimulationInstanceView['historyImports']
  sendManual?: ReturnType<typeof vi.fn>
  queryManual?: ReturnType<typeof vi.fn>
  confirmManual?: ReturnType<typeof vi.fn>
  retryManual?: ReturnType<typeof vi.fn>
  setPaused?: ReturnType<typeof vi.fn>
} = {}) {
  const store = createConversationUiStore().create()
  const bound = options.status === undefined ? undefined : instance(options.status, options.historyImports)
  const scope = bound === undefined ? undefined : {
    instanceId, role: 'sim-user' as const, sessionId, peerSessionId: testedSessionId,
    workspaceId, peerWorkspaceId: testedWorkspaceId, deliveryScope: emptyDelivery.scope, status: bound.status,
  }
  const create = options.create ?? vi.fn(async () => ({ ok: true, value: instance('running') }))
  const injectMember = options.injectMember ?? vi.fn(async () => ({ ok: true, value: {} }))
  const beginStop = options.beginStop ?? vi.fn(async () => ({ ok: true, value: instance('stopping') }))
  const waitStopped = options.waitStopped ?? vi.fn(async () => ({ ok: true, value: instance('stopped') }))
  const sendManual = options.sendManual ?? vi.fn(async () => ({ ok: true, value: { outbound: outbound('sent', { format: 'text', text: 'hi' }, brandString<ImOutboundRequestId>('sent')) } }))
  const queryManual = options.queryManual ?? vi.fn(async () => ({ ok: true, value: { state: 'not-found' } }))
  const confirmManual = options.confirmManual ?? vi.fn(async () => ({ ok: true, value: { outbound: outbound('sent', { format: 'text', text: 'hi' }, brandString<ImOutboundRequestId>('sent')) } }))
  const retryManual = options.retryManual ?? vi.fn(async () => ({ ok: true, value: { outbound: outbound('sent', { format: 'text', text: 'hi' }, brandString<ImOutboundRequestId>('retry')) } }))
  const setPaused = options.setPaused ?? vi.fn(async () => ({ ok: true, value: { operationId: 'operation', status: 'applied', account: configuredAccount } }))
  const openSession = vi.fn()
  const snapshot = options.configured === false ? { ...configuration, simulationTargets: [] } : configuration
  render(<ConversationTab {...({
    sessionId, t: makeTranslate(zh), useStore: bindSnapshotSelector(store), actions: store.actions,
    useConfiguration: bindSnapshotSelector(source({ phase: 'ready', value: snapshot, error: undefined })),
    useWorkspaces: bindSnapshotSelector(source({ items: [{ workspaceId, sessionIds: [sessionId], title: 'Sim' }, { workspaceId: testedWorkspaceId, sessionIds: [testedSessionId], title: '售后工作区' }] })),
    watchSession: () => source({ phase: 'ready', value: { sessionId, ...(scope === undefined ? {} : { scope }), ...(bound === undefined ? {} : { instance: bound }) }, error: undefined }),
    watchRealSession: () => source({ phase: 'ready', value: { sessionId, ...(options.binding === undefined ? {} : { binding: options.binding }) }, error: undefined }),
    watchDelivery: () => source({ phase: 'ready', value: options.delivery ?? emptyDelivery, error: undefined }),
    create, injectMember, injectManagedHuman: vi.fn(async () => ({ ok: true, value: {} })), beginStop, waitStopped,
    sendManual, queryManual, confirmManual, retryManual, setPaused,
    operationId: () => brandString<ImOperationId>('operation'),
    importHistory: vi.fn(async () => ({ ok: true, value: {} })),
    resolveSession: vi.fn(async () => ({ ok: true, value: undefined })), openSession,
    useTabInfo: () => ({}),
  } as never)} />)
  return { store, create, injectMember, beginStop, waitStopped, openSession, sendManual, queryManual, confirmManual, retryManual, setPaused }
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

  it('names the frozen account and tested workspace instead of their ids', () => {
    mount({ status: 'running' })
    expect(screen.getByText(`${zh.simulationTarget}: ${zh.wangwang} · 张伟`)).toBeTruthy()
    expect(screen.getByText(`${zh.simulationTestedWorkspace}: 售后工作区`)).toBeTruthy()
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

  it('presents an imported history file as query-only background', () => {
    mount({ status: 'running', historyImports: [{ operationId: brandString<ImDeliveryOperationId>('import'), fileName: 'buyer.jsonl', messageCount: 40, importedCount: 38, importedAt: now }] })
    expect(screen.getByText(zh.historyNote.replace('{file}', 'buyer.jsonl').replace('{count}', '38'))).toBeTruthy()
  })
})

describe('real IM conversation sidebar', () => {
  it('shows the Host destination, account identity, and AI handling strip', () => {
    mount({ binding: realBinding() })
    expect(screen.getByText(`${zh.kindGroup}: 售后群`)).toBeTruthy()
    expect(screen.getByText(`${zh.realAccount}: 张伟`)).toBeTruthy()
    expect(screen.getByText(zh.realMembers.replace('{count}', '12'))).toBeTruthy()
    expect(screen.getByText(`${zh.realWorkspace}: Sim`)).toBeTruthy()
    expect(screen.getByText(zh.live)).toBeTruthy()
    expect(screen.getByText(zh.sendIdentityReal.replace('{account}', '张伟').replace('{title}', '售后群'))).toBeTruthy()
  })

  it('pauses automatic handling against the observed account revision', async () => {
    const { setPaused } = mount({ binding: realBinding() })
    fireEvent.click(screen.getByRole('button', { name: zh.liveDisable }))
    await waitFor(() => {
      expect(setPaused).toHaveBeenCalledWith({ operationId: 'operation', accountId, observedRevision: liveRevision, paused: true })
    })
  })

  it('reports a rejected pause change instead of leaving the strip silent', async () => {
    const setPaused = vi.fn(async () => ({ ok: true, value: { operationId: 'operation', status: 'conflict', account: configuredAccount } }))
    mount({ binding: realBinding(), setPaused })
    fireEvent.click(screen.getByRole('button', { name: zh.liveDisable }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.pauseNotApplied) })
  })

  it('keeps manual sending available while automatic handling is paused', () => {
    mount({ binding: realBinding({ paused: true }) })
    expect(screen.getByText(zh.disabledStrip)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.enableStrip })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(zh.composerHint), { target: { value: '我来处理' } })
    expect(screen.getByRole('button', { name: zh.send }).hasAttribute('disabled')).toBe(false)
  })

  it.each([
    ['disconnected', zh.offlineStripSince],
    ['authorization-required', zh.authorizationRequiredStrip],
    ['listener-unavailable', zh.listenerUnavailableStrip],
  ] as const)('names %s as the reason manual sending is unavailable', (reason, copy) => {
    mount({ binding: realBinding({ manualSend: { state: 'unavailable', reason } }, { lastSyncedAt: now, platformCursor: null }) })
    const expected = copy === zh.offlineStripSince ? copy.replace('{time}', new Date(now).toLocaleTimeString()) : copy
    expect(screen.getByText(expected)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.send }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(zh.viewAccountsHint)).toBeTruthy()
  })

  it('explains the reconnect cursor without presenting old history as new', () => {
    mount({ binding: realBinding({ manualSend: { state: 'unavailable', reason: 'disconnected' } }, { lastSyncedAt: now, platformCursor: null }) })
    expect(screen.getByText(zh.cursorNote.replace('{time}', new Date(now).toLocaleString()))).toBeTruthy()
  })

  it('sends manually from the exact Session and clears the draft once accepted', async () => {
    const { sendManual } = mount({ binding: realBinding() })
    fireEvent.change(screen.getByLabelText(zh.composerHint), { target: { value: '稍后回复你' } })
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(sendManual).toHaveBeenCalledTimes(1) })
    expect(sendManual.mock.calls[0]?.[0]).toMatchObject({ sessionId, text: '稍后回复你' })
    await waitFor(() => { expect(screen.getByText(zh.manualSent)).toBeTruthy() })
  })

  it('never retries an unknown send on its own and verifies by receipt before confirming', async () => {
    const requestId = brandString<ImOutboundRequestId>('unknown')
    const sendManual = vi.fn(async () => ({ ok: true, value: { outbound: outbound('result-unknown', { format: 'text', text: 'hi' }, requestId) } }))
    const { queryManual, confirmManual, retryManual } = mount({ binding: realBinding(), sendManual })
    fireEvent.change(screen.getByLabelText(zh.composerHint), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(screen.getByText(zh.manualSendUnknown)).toBeTruthy() })
    expect(retryManual).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: zh.checkManualSend })[0] as HTMLElement)
    await waitFor(() => { expect(confirmManual).toHaveBeenCalledTimes(1) })
    expect(queryManual).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.getByText(zh.manualSendRecovered)).toBeTruthy() })
  })

  it('retries only on an explicit click and links the new request to its predecessor', async () => {
    const sendManual = vi.fn(async (request: { requestId: ImOutboundRequestId }) => ({ ok: true, value: { outbound: outbound('result-unknown', { format: 'text', text: 'hi' }, request.requestId) } }))
    const { retryManual } = mount({ binding: realBinding(), sendManual })
    fireEvent.change(screen.getByLabelText(zh.composerHint), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(screen.getByText(zh.manualSendUnknown)).toBeTruthy() })
    const sent = (sendManual.mock.calls[0]?.[0] as { requestId: ImOutboundRequestId }).requestId
    fireEvent.click(screen.getAllByRole('button', { name: zh.retryManualSend })[0] as HTMLElement)
    await waitFor(() => { expect(retryManual).toHaveBeenCalledTimes(1) })
    const request = retryManual.mock.calls[0]?.[0] as { sessionId: SessionId; requestId: string; retryOfRequestId: string }
    expect(request.sessionId).toBe(sessionId)
    expect(request.retryOfRequestId).toBe(sent)
    expect(request.requestId).not.toBe(sent)
  })

  it('renders a quote, an image placeholder, and unsupported details without pretending to understand them', () => {
    const delivery: ImDeliverySnapshot = {
      ...emptyDelivery,
      scope: { kind: 'real', platform: 'dingtalk', accountId, conversationKind: 'group', conversationId: 'group-1' },
      inbound: {
        hasMore: false,
        items: [
          { ...inbound({ format: 'text', text: '支付又超时了', quote: { text: '昨晚超时两次', senderDisplayName: '张伟' } }), messageId: brandString<ImMessageId>('quoted') },
          { ...inbound({ format: 'image', text: '' }), messageId: brandString<ImMessageId>('image') },
          { ...inbound({ format: 'unsupported', text: '', messageType: 'audio', details: { duration: 12 } }), messageId: brandString<ImMessageId>('audio') },
        ],
      },
    }
    mount({ binding: realBinding(), delivery })
    expect(screen.getByText('昨晚超时两次')).toBeTruthy()
    expect(screen.getByText(zh.imagePlaceholder)).toBeTruthy()
    expect(screen.getByText(zh.unsupportedMessageType.replace('{type}', 'audio'))).toBeTruthy()
    expect(screen.queryByText(/"duration": 12/u)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.viewMessageDetails }))
    expect(screen.getByText(/"duration": 12/u)).toBeTruthy()
  })
})
