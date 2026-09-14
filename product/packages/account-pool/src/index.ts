/** Product-owned account management, pooled inference, and Remote composition. */
export { AccountPool, AccountPoolError } from './account-pool.ts'
export type * from './account-pool.ts'
export { AccountPoolController } from './rpc/index.ts'

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './provider/config.ts'
import { CLIProxyAccountPool } from './provider/gateway.ts'
import { AccountPoolController } from './rpc/index.ts'
export { Config } from './provider/config.ts'
export { CLIProxyAccountPool } from './provider/gateway.ts'

/** Product plugin name. */
export const name = 'gestaltrun-account-pool'
/** The bundle supplies the local subprocess implementation in an isolated scope. */
export const inject = ['llm', 'subprocess', 'typert', 'connection']

/**
 * Mount account management and its narrow API in the current product composition.
 * @param ctx - Host services shared with the account pool Client.
 * @param config - validated deployment and credential-export policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(CLIProxyAccountPool, config)
  ctx.plugin(AccountPoolController, { allowCredentialExport: config.allowCredentialExport })
}
