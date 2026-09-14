/** Independent route mutation dispatch retains every target's outcome. */
import { ImRuntimeError, type ImRuntimeService } from '@gestaltrun/dsh-im-runtime'
import type { ImRouteBatchItem, ImRouteBatchRequest, ImRouteBatchResult, ImRouteOperation } from './types.ts'

type RouteRuntime = Pick<ImRuntimeService, 'createRoute' | 'saveRoute' | 'rebindRoute' | 'deleteRoute'>

/**
 * Apply operations sequentially without promising a cross-target transaction.
 * @param runtime - authoritative account aggregates.
 * @param request - ordered operations, each carrying its own idempotency identity.
 * @param signal - prevents starting later operations after caller cancellation.
 * @returns every confirmed receipt; interrupted or failed attempts require receipt lookup.
 */
export async function applyRouteBatch(
  runtime: RouteRuntime,
  request: ImRouteBatchRequest,
  signal: AbortSignal,
): Promise<ImRouteBatchResult> {
  const items: ImRouteBatchItem[] = []
  for (const operation of request.operations) {
    const { accountId, operationId } = operation.request
    if (signal.aborted) {
      items.push({ state: 'unknown', accountId, operationId })
      continue
    }
    try {
      const result = await dispatch(runtime, operation)
      items.push({ state: 'known', accountId, result })
    } catch (error) {
      if (error instanceof ImRuntimeError) {
        items.push({ state: 'rejected', accountId, operationId, code: error.code, message: error.message })
      } else {
        // An unexpected failure does not establish whether its durable update committed.
        items.push({ state: 'unknown', accountId, operationId })
      }
    }
  }
  return { items }
}

function dispatch(runtime: RouteRuntime, operation: ImRouteOperation) {
  switch (operation.kind) {
    case 'create': return runtime.createRoute(operation.request)
    case 'save': return runtime.saveRoute(operation.request)
    case 'rebind': return runtime.rebindRoute(operation.request)
    case 'delete': return runtime.deleteRoute(operation.request)
    default: return assertNever(operation)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected IM route operation: ${String(value)}`)
}
