/** Fresh-process recovery probe used only by the built API smoke. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadSmokeModules } from './smoke-modules.mjs'

const { Cordis, Storage, StorageJson, StorageDomain, Credentials, TypertRegistry, Gateway, ImRuntime, ImApi, Typert } = await loadSmokeModules()
const { TYPERT } = Typert

const directory = process.argv[2]
assert(directory, 'Recovery probe requires the owned smoke directory')
const ctx = new Cordis.Context()
try {
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(directory, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Credentials, { path: join(directory, 'credentials.yaml'), watch: false })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(ImRuntime)
  ctx.effect(() => ctx.typert.register(TYPERT), 'recovery: generated IM descriptors')
  await ctx.plugin(ImApi)
  await ctx.plugin(Gateway)
  const value = await ctx.typertGateway.invoke({ namespace: 'im', method: 'snapshot', args: {} })
  const receipt = await ctx.typertGateway.invoke({ namespace: 'im', method: 'queryRouteOperation', args: {
    request: { accountId: value.accounts[0].id, operationId: 'rebind' },
  } })
  assert(!JSON.stringify(value).includes('fixture-secret'))
  console.log(JSON.stringify({ accounts: value.accounts.length, routes: value.routes.length, rebound: receipt.result.route.workspaceId }))
} finally {
  await ctx.fiber.dispose()
}
