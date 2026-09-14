import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'

const root = await mkdtemp(join(tmpdir(), 'dsh-im-runtime-loader-'))
const configPath = join(root, 'cordis.yml')
const moduleUrls = [
  import.meta.resolve('@deepseek-ai/dsh-storage'),
  import.meta.resolve('@deepseek-ai/dsh-storage-json'),
  import.meta.resolve('@deepseek-ai/dsh-storage-domain'),
  import.meta.resolve('@deepseek-ai/dsh-credentials-local'),
  new URL('../lib/index.js', import.meta.url).href,
]
const lines = [
  `- name: '${moduleUrls[0]}'`,
  `- name: '${moduleUrls[1]}'`,
  '  config:',
  `    root: '${join(root, 'storage')}'`,
  `- name: '${moduleUrls[2]}'`,
  '  config:',
  "    backend: 'json'",
  `- name: '${moduleUrls[3]}'`,
  '  config:',
  `    path: '${join(root, 'credentials.yaml')}'`,
  '    watch: false',
  `- name: '${moduleUrls[4]}'`,
  '',
]
await writeFile(configPath, lines.join('\n'))

const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
try {
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
  if (unloaded.length > 0) throw new Error(`Loader left plugins inactive: ${unloaded.map(entry => entry.options.name).join(', ')}`)
  const runtime = ctx.get('imRuntime')
  if (runtime === undefined) throw new Error('Loader did not publish ctx.imRuntime')
  const snapshot = runtime.snapshot()
  if (snapshot.accounts.length !== 0 || snapshot.routes.length !== 0 || snapshot.simulationTargets.length !== 0) {
    throw new Error('fresh Loader composition did not produce an empty IM configuration')
  }
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
