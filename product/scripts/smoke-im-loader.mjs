/** Verify public Loader discovery and strict RPC using built or installed IM packages. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const anchor = process.env.DSH_IM_SMOKE_INSTALL_ROOT ?? resolve(import.meta.dirname, '../api-im')
const require = createRequire(join(anchor, 'package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { default: Include } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-include')).href)
const { default: Loader } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href)
const root = await mkdtemp(join(anchor, '.im-loader-smoke-'))
const config = join(root, 'cordis.yml')
const rows = [
  { name: '@deepseek-ai/dsh-storage' },
  { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
  { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
  { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
  { name: '@deepseek-ai/dsh-typert-registry' },
  { name: '@deepseek-ai/dsh-typert-loader' },
  { name: '@gestaltrun/dsh-im-runtime' },
  { name: '@gestaltrun/dsh-api-im' },
  { name: '@deepseek-ai/dsh-api-gateway' },
]
const ctx = new Context()
ctx.baseUrl = `${pathToFileURL(root).href}/`
try {
  await writeFile(config, `${JSON.stringify(rows, null, 2)}\n`)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  assert.deepEqual([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled).map(entry => entry.options.name), [])
  const typert = ctx.typert
  assert.ok(typert.getPackage('@gestaltrun/dsh-api-im'), 'Loader did not discover the installed ./typert export')
  const snapshot = await ctx.typertGateway.invoke({ namespace: 'im', method: 'snapshot', args: {} })
  assert.deepEqual(snapshot, { revision: 0, accounts: [], routes: [], simulationTargets: [] })
  await assert.rejects(
    ctx.typertGateway.invoke({ namespace: 'im', method: 'listAccountCandidates', args: { platform: 'invalid-platform' } }),
    error => error.code === 'gateway/input-invalid' && error.field === 'platform',
  )
  await ctx.fiber.dispose()
  assert.equal(typert.getPackage('@gestaltrun/dsh-api-im'), undefined)
  console.log(JSON.stringify({ loader: true, automaticTypert: true, publicRpc: true, invalidInputRejected: true, disposed: true, providerCalls: 0 }))
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
