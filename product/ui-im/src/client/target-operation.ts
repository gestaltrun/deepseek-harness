/** Target operation reconciliation remains outside presentation components. */
import type { IImClient } from '@gestaltrun/dsh-api-im/client'
import type { SimulationTargetCommand } from './stores.ts'
import type { TargetOutcome } from './SimulationSection.tsx'

/** @param im - authoritative configuration commands. @param command - observed target change. @param queryFirst - reconcile an unknown operation before retrying. @returns confirmed receipt or unresolved outcome. */
export async function submitTarget(im: Pick<IImClient, 'querySimulationTargetOperation' | 'saveSimulationTarget' | 'removeSimulationTarget'>, command: SimulationTargetCommand, queryFirst: boolean): Promise<TargetOutcome> {
  if (queryFirst) {
    const result = await im.querySimulationTargetOperation({ workspaceId: command.request.workspaceId, operationId: command.request.operationId })
    if (!result.ok) return { state: 'unknown', message: result.error.message }
    if (result.value.state === 'known') return { state: 'known', result: result.value.result }
  }
  const result = await (command.kind === 'save' ? im.saveSimulationTarget(command.request) : im.removeSimulationTarget(command.request))
  return result.ok ? { state: 'known', result: result.value } : { state: 'unknown', message: result.error.message }
}
