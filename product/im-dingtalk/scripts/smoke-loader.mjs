/** Exercise the built DingTalk provider through Loader, Subprocess, JSON storage, and product runtime. */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'

async function waitFor(description, predicate) {
  const deadline = Date.now() + 5_000
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-im-dingtalk-loader-'))
const executable = join(root, 'dws-fixture.mjs')
const active = join(root, 'event-active')
const fixture = `#!/usr/bin/env node
import { rm, writeFile } from 'node:fs/promises'
const args = process.argv.slice(2)
const joined = args.join(' ')
if (args[0] === '--version') { console.log('dws version v1.0.61 (fixture)'); process.exit(0) }
if (args.at(-1) === '--help') { console.log('Usage: dws ' + args.slice(0, -1).join(' ')); process.exit(0) }
if (args[0] === 'profile') {
  console.log(JSON.stringify({success:true,profiles:[{profile:'corp-fixture:user-fixture',corpId:'corp-fixture',corpName:'Fixture Corp',userId:'user-fixture',userName:'Fixture User',status:'active',isPrimary:true,isCurrent:true,isOrgCurrent:true}]}))
  process.exit(0)
}
if (args[0] === 'auth') {
  console.log(JSON.stringify({success:true,authenticated:true,token_valid:true,corp_id:'corp-fixture',user_id:'user-fixture'}))
  process.exit(0)
}
if (args[0] === 'chat' && args[1] === '+conversation-list') { console.log(JSON.stringify({conversations:[],hasMore:false})); process.exit(0) }
if (args[0] !== 'event' || args[1] !== 'consume' || !joined.includes('--profile corp-fixture:user-fixture')) process.exit(2)
await writeFile(${JSON.stringify(active)}, String(process.pid))
console.error('[event] ready subscribe_id=fixture')
console.log(JSON.stringify({type:'user_im_message_receive_group_all',event_id:'event-fixture',timestamp:1726000000000,subscribe_id:'sub-fixture',message_id:'message-fixture',conversation_id:'cid-fixture',sender:'Fixture Sender',sender_open_dingtalk_id:'D-fixture-peer',content:'fixture text',create_time:'2026-09-14 00:00:00',event_time:1726000000000}))
const close = async () => { await rm(${JSON.stringify(active)}, {force:true}); process.exit(0) }
process.on('SIGTERM', () => { void close() })
process.stdin.resume()
process.stdin.on('end', () => { void close() })
`
await writeFile(executable, fixture)
await chmod(executable, 0o755)

const configPath = join(root, 'cordis.yml')
const moduleUrls = [
  import.meta.resolve('@deepseek-ai/dsh-storage'),
  import.meta.resolve('@deepseek-ai/dsh-storage-json'),
  import.meta.resolve('@deepseek-ai/dsh-storage-domain'),
  import.meta.resolve('@deepseek-ai/dsh-credentials-local'),
  import.meta.resolve('@deepseek-ai/dsh-subprocess-local'),
  new URL('../../im-runtime/lib/index.js', import.meta.url).href,
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
  `- name: '${moduleUrls[5]}'`,
  `- name: '${moduleUrls[6]}'`,
  '  config:',
  `    dwsPath: '${executable}'`,
  `    home: '${join(root, 'home')}'`,
  `    cwd: '${root}'`,
  '    graceMs: 1000',
  '    commandTimeoutMs: 3000',
  '    readinessTimeoutMs: 3000',
  '    maxOutputBytes: 1048576',
  '    maxLineBytes: 1048576',
  '    conversationPageSize: 10',
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
  const candidates = await runtime.listAccountCandidates('dingtalk')
  if (candidates.length !== 1 || candidates[0]?.platform !== 'dingtalk' || candidates[0].profile !== 'corp-fixture:user-fixture') {
    throw new Error('Loader did not register the exact fixture DWS profile')
  }
  const account = await runtime.addAccount({ platform: 'dingtalk', profile: 'corp-fixture:user-fixture' })
  if (account.authorization.state !== 'ready' || account.identity.platform !== 'dingtalk' || account.identity.userId !== 'user-fixture') {
    throw new Error('runtime did not persist provider-verified DingTalk identity')
  }
  const route = await runtime.createRoute({
    operationId: 'fixture-create-route', accountId: account.id, conversationKind: 'group', target: { kind: 'all' },
    workspaceId: 'fixture-workspace', enabled: true, groupTrigger: { everyN: 1 },
  })
  if (route.status !== 'applied') throw new Error(`runtime did not create the fixture route: ${route.status}`)
  await waitFor('provider listener readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  await waitFor('provider cursor receipt', () => runtime.getProviderCursor({ platform: 'dingtalk', accountId: account.id, streamId: 'corp-fixture:user-fixture:messages' }).cursor !== null)
  await waitFor('synthetic event process', async () => { try { await import('node:fs/promises').then(fs => fs.access(active)); return true } catch { return false } })
  const current = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (current === undefined) throw new Error('runtime lost the fixture DingTalk account')
  const disconnected = await runtime.disconnectAccount({ operationId: 'fixture-disconnect', accountId: account.id, observedRevision: current.revision })
  if (disconnected.status !== 'applied') throw new Error(`runtime did not persist disconnect intent: ${disconnected.status}`)
  await waitFor('provider listener teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
  await waitFor('synthetic process quiescence', async () => { try { await import('node:fs/promises').then(fs => fs.access(active)); return false } catch { return true } })
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
