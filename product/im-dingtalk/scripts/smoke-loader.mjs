/** Exercise the built DingTalk provider through Loader, Subprocess, JSON storage, and product runtime. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const eventArgs = join(root, 'event-args.json')
const exitAfterReady = join(root, 'exit-after-ready')
const sendArgs = join(root, 'send-args.json')
const fixture = `#!/usr/bin/env node
import { rm, writeFile } from 'node:fs/promises'
const args = process.argv.slice(2)
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
if (args[0] === 'chat' && args[1] === 'message' && args[2] === 'send') {
  await writeFile(${JSON.stringify(sendArgs)}, JSON.stringify(args))
  console.log(JSON.stringify({success:true,result:{openTaskId:'task-fixture'}}))
  process.exit(0)
}
if (args[0] !== 'event' || args[1] !== 'consume') process.exit(2)
await writeFile(${JSON.stringify(eventArgs)}, JSON.stringify(args))
await writeFile(${JSON.stringify(active)}, String(process.pid))
console.error('[event] ready subscribe_id=fixture')
console.log(JSON.stringify({type:'user_im_message_receive_group_all',event_id:'event-group',timestamp:1726000000000,subscribe_id:'sub-fixture',message_id:'message-group',conversation_id:'cid-future-group',sender:'Fixture Sender',sender_open_dingtalk_id:'D-fixture-peer',content:'fixture group',create_time:'2026-09-14 00:00:00',event_time:1726000000000}))
console.log(JSON.stringify({type:'user_im_message_receive_at',event_id:'event-group',timestamp:1726000000000,subscribe_id:'sub-fixture',message_id:'message-group',conversation_id:'cid-future-group',sender:'Fixture Sender',sender_open_dingtalk_id:'D-fixture-peer',content:'fixture group',create_time:'2026-09-14 00:00:00',event_time:1726000000000}))
console.log(JSON.stringify({type:'user_im_message_receive_o2o_all',event_id:'event-direct',timestamp:1726000001000,subscribe_id:'sub-fixture',message_id:'message-direct',conversation_id:'cid-direct',sender:'Fixture Sender',sender_open_dingtalk_id:'D-fixture-peer',content:'fixture direct',create_time:'2026-09-14 00:00:01',event_time:1726000001000}))
const close = async () => { await rm(${JSON.stringify(active)}, {force:true}); process.exit(0) }
process.on('SIGTERM', () => { void close() })
try {
  await import('node:fs/promises').then(fs => fs.access(${JSON.stringify(exitAfterReady)}))
  await rm(${JSON.stringify(active)}, {force:true})
  process.exit(3)
} catch {
  // The absent fixture marker keeps this synthetic listener running.
}
setInterval(() => {}, 1000)
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

async function loadContext() {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
  if (unloaded.length > 0) throw new Error(`Loader left plugins inactive: ${unloaded.map(entry => entry.options.name).join(', ')}`)
  return ctx
}

let ctx
try {
  ctx = await loadContext()
  let runtime = ctx.get('imRuntime')
  if (runtime === undefined) throw new Error('Loader did not publish ctx.imRuntime')
  const candidates = await runtime.listAccountCandidates('dingtalk')
  if (candidates.length !== 1 || candidates[0]?.platform !== 'dingtalk' || candidates[0].profile !== 'corp-fixture:user-fixture') {
    throw new Error('Loader did not register the exact fixture DWS profile')
  }
  const account = await runtime.addAccount({ platform: 'dingtalk', profile: 'corp-fixture:user-fixture' })
  if (account.authorization.state !== 'ready' || account.identity.platform !== 'dingtalk' || account.identity.userId !== 'user-fixture') {
    throw new Error('runtime did not persist provider-verified DingTalk identity')
  }
  const directRoute = await runtime.createRoute({
    operationId: 'fixture-create-direct', accountId: account.id, conversationKind: 'direct',
    target: { kind: 'specific', conversationId: 'cid-direct', directRecipient: { providerActorId: 'D-fixture-peer', openDingTalkId: 'D-fixture-peer' } },
    workspaceId: 'fixture-workspace', enabled: true,
  })
  if (directRoute.status !== 'applied') throw new Error(`runtime did not create the fixture direct route: ${directRoute.status}`)
  await waitFor('initial direct listener readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  const groupRoute = await runtime.createRoute({
    operationId: 'fixture-create-groups', accountId: account.id, conversationKind: 'group', target: { kind: 'all' },
    workspaceId: 'fixture-workspace', enabled: true, groupTrigger: { mention: true },
  })
  if (groupRoute.status !== 'applied') throw new Error(`runtime did not create the fixture group route: ${groupRoute.status}`)
  await waitFor('provider listener readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  const listenerArgv = JSON.parse(await readFile(eventArgs, 'utf8'))
  for (const required of ['user_im_message_receive_at', 'user_im_message_receive_o2o_all', 'user_im_message_receive_group_all', 'corp-fixture:user-fixture']) {
    if (!listenerArgv.includes(required)) throw new Error(`fixture listener omitted ${required}`)
  }
  const groupScope = { kind: 'real', platform: 'dingtalk', accountId: account.id, conversationKind: 'group', conversationId: 'cid-future-group' }
  const directScope = { kind: 'real', platform: 'dingtalk', accountId: account.id, conversationKind: 'direct', conversationId: 'cid-direct' }
  await waitFor('late mention evidence and direct recipient receipt', () => {
    const group = runtime.queryHistory({ scope: groupScope, limit: 10 }).items
    const direct = runtime.queryHistory({ scope: directScope, limit: 10 }).items
    return group.length === 1 && group[0]?.mentionedConfiguredAccount === true && direct.length === 1
  })
  const groupHistory = runtime.queryHistory({ scope: groupScope, limit: 10 })
  if (groupHistory.items.length !== 1 || groupHistory.items[0]?.mentionedConfiguredAccount !== true) {
    throw new Error('runtime did not monotonically merge the late at-me evidence without duplicating history')
  }
  const directHistory = runtime.queryHistory({ scope: directScope, limit: 10 })
  if (directHistory.items.length !== 1 || directHistory.items[0]?.sender.kind !== 'external' || directHistory.items[0].sender.openDingTalkId !== 'D-fixture-peer') {
    throw new Error('runtime did not retain the direct sender openDingTalkId')
  }
  const current = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (current === undefined) throw new Error('runtime lost the fixture DingTalk account')
  const disconnected = await runtime.disconnectAccount({ operationId: 'fixture-disconnect', accountId: account.id, observedRevision: current.revision })
  if (disconnected.status !== 'applied') throw new Error(`runtime did not persist disconnect intent: ${disconnected.status}`)
  await waitFor('provider listener teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
  await waitFor('synthetic process quiescence', async () => { try { await import('node:fs/promises').then(fs => fs.access(active)); return false } catch { return true } })
  await ctx.fiber.dispose()

  ctx = await loadContext()
  runtime = ctx.get('imRuntime')
  if (runtime === undefined) throw new Error('reloaded Loader did not publish ctx.imRuntime')
  const reloadedAccount = runtime.snapshot().accounts.find(value => value.id === account.id)
  const reloadedDirect = runtime.snapshot().routes.find(value => value.id === directRoute.route?.id)
  if (reloadedAccount?.connectionIntent !== 'disconnected' || reloadedDirect?.target.kind !== 'specific' || reloadedDirect.target.directRecipient?.openDingTalkId !== 'D-fixture-peer') {
    throw new Error('runtime restart did not retain connection intent, routes, and direct recipient facts')
  }
  const sendResult = await runtime.transports.require('dingtalk').send({
    account: reloadedAccount,
    conversationKind: 'direct',
    conversationId: reloadedDirect.target.conversationId,
    directRecipient: reloadedDirect.target.directRecipient,
    requestId: 'fixture-send',
    text: 'fixture reply',
  }, new AbortController().signal)
  if (sendResult.state !== 'unknown' || sendResult.externalMessageId !== 'task-fixture') throw new Error('fixture direct send did not retain its uncertain DWS receipt')
  const argv = JSON.parse(await readFile(sendArgs, 'utf8'))
  if (!argv.includes('--open-dingtalk-id') || !argv.includes('D-fixture-peer') || argv.includes('cid-direct')) {
    throw new Error('restarted direct send did not use the persisted peer instead of the conversation id')
  }
  const reconnected = await runtime.reconnectAccount({ operationId: 'fixture-reconnect', accountId: reloadedAccount.id, observedRevision: reloadedAccount.revision })
  if (reconnected.status !== 'applied') throw new Error(`runtime did not persist reconnect intent: ${reconnected.status}`)
  await waitFor('reconnected provider readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  const afterReplay = runtime.queryHistory({ scope: groupScope, limit: 10 })
  if (afterReplay.items.length !== 1 || afterReplay.items[0]?.mentionedConfiguredAccount !== true) throw new Error('reconnect replay duplicated or weakened group evidence')
  const connected = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (connected === undefined) throw new Error('runtime lost the reconnected DingTalk account')
  const stopped = await runtime.disconnectAccount({ operationId: 'fixture-stop', accountId: connected.id, observedRevision: connected.revision })
  if (stopped.status !== 'applied') throw new Error(`runtime did not stop the reconnected listener: ${stopped.status}`)
  await waitFor('reconnected provider teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
  await writeFile(exitAfterReady, 'exit')
  const failedStart = await runtime.reconnectAccount({ operationId: 'fixture-post-ready-exit', accountId: stopped.account.id, observedRevision: stopped.account.revision })
  if (failedStart.status !== 'applied') throw new Error(`runtime did not start the exit fixture listener: ${failedStart.status}`)
  await waitFor('post-ready child failure', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'failed')
} finally {
  await ctx?.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
