import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ImAccountId, ImOperationId, ImRuntimeService } from '@gestaltrun/dsh-im-runtime'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { applyRouteBatch } from '../src/route-batch.ts'
import type { ImRouteOperation } from '../src/types.ts'

const accountId = brandString<ImAccountId>('account')
const workspaceId = brandString<WorkspaceId>('workspace')
const create = (conversationId: string): ImRouteOperation => ({
  kind: 'create',
  request: {
    accountId, workspaceId, operationId: brandString<ImOperationId>(conversationId),
    conversationKind: 'group', target: { kind: 'specific', conversationId }, enabled: false,
  },
})
const unused = (): never => { throw new Error('Unexpected operation') }

describe('independent route batch outcomes', () => {
  it('retains applied, conflict, and unknown outcomes for every target in order', async () => {
    const seen: string[] = []
    const runtime: Pick<ImRuntimeService, 'createRoute' | 'saveRoute' | 'rebindRoute' | 'deleteRoute'> = {
      createRoute: async request => {
        seen.push(request.operationId)
        if (request.operationId === 'unknown') throw new Error('write acknowledgement lost')
        return { operationId: request.operationId, status: request.operationId === 'conflict' ? 'conflict' : 'applied' }
      },
      saveRoute: unused, rebindRoute: unused, deleteRoute: unused,
    }
    const result = await applyRouteBatch(runtime, {
      operations: [create('first'), create('conflict'), create('unknown'), create('last')],
    }, new AbortController().signal)
    expect(seen).toEqual(['first', 'conflict', 'unknown', 'last'])
    expect(result.items).toEqual([
      { state: 'known', accountId, result: { operationId: 'first', status: 'applied' } },
      { state: 'known', accountId, result: { operationId: 'conflict', status: 'conflict' } },
      { state: 'unknown', accountId, operationId: 'unknown' },
      { state: 'known', accountId, result: { operationId: 'last', status: 'applied' } },
    ])
  })

  it('does not start later targets after cancellation and keeps them queryable', async () => {
    const controller = new AbortController()
    const seen: string[] = []
    const result = await applyRouteBatch({
      createRoute: async request => {
        seen.push(request.operationId)
        controller.abort()
        return { operationId: request.operationId, status: 'applied' }
      },
      saveRoute: unused, rebindRoute: unused, deleteRoute: unused,
    }, { operations: [create('first'), create('next')] }, controller.signal)
    expect(seen).toEqual(['first'])
    expect(result.items[1]).toEqual({ state: 'unknown', accountId, operationId: 'next' })
  })
})
