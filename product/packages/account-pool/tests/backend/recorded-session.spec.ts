/** Authored model replies replay through real public SDK/profile, image, tool, and persistence implementations. */
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { normalizeSessionSnapshots, normalizeSessionSnapshot, redactSessionSnapshotIds, latestPersistedSessionPaths, sessionHeaderVersion, sessionFixtureName, parseSessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const fixtureDirectory = fileURLToPath(new URL('../fixtures/recorded-session/', import.meta.url))
const recording = process.env.DSH_ACCOUNT_POOL_RECORD === '1'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8DwH4QZYAwAR8oH+Xm0fdIAAAAASUVORK5CYII='

interface ReplyBlock { type: string; text?: string; id?: string; name?: string; arguments?: string }
interface RecordedRow { type: string; data?: { message?: { content?: ReplyBlock[] }; content?: ReplyBlock[]; source?: { kind: string } } }

it('replays a recorded image/tool Session through the published SDK, product PiAi adapter, and durable log', async () => {
  const fixtures = (await readdir(fixtureDirectory)).filter(name => /^session(?:\.v\d+)?\.jsonl$/u.test(name))
    .sort((left, right) => parseSessionFixtureName(left)!.version - parseSessionFixtureName(right)!.version)
  const expectedName = fixtures.at(-1)
  const recorded = expectedName === undefined ? undefined : await readFile(join(fixtureDirectory, expectedName), 'utf8')
  if (!recording && recorded === undefined) throw new Error('Record the authored account-pool Session fixture first.')
  const recordedRows = recorded?.trim().split('\n').map(line => JSON.parse(line) as RecordedRow)
  const prompt = recordedRows?.find(row => row.type === 'user/message' && row.data?.source?.kind === 'user')
    ?.data?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n')
    ?? 'Use the image, then write tool-proof with fixture_write and finish.'
  const plan: ReplyBlock[][] = recordedRows === undefined ? [
    [{ type: 'reasoning', text: 'Use the stored image and write the requested proof.' },
      { type: 'tool-call', id: 'call_account_pool', name: 'fixture_write', arguments: '{"value":"tool-proof"}' }],
    [{ type: 'text', text: 'Account pool fixture completed.' }],
  ] : recordedRows.filter(row => row.type === 'assistant/message').map(row => row.data?.message?.content ?? [])
  expect(plan).toHaveLength(2)
  const root = await mkdtemp(join(tmpdir(), 'dsh-pool-session-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const home = join(root, '.home')
  const profile = join(home, 'profiles', 'pool-session')
  await mkdir(profile, { recursive: true })
  let calls = 0
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    requests.push(JSON.parse(body) as Record<string, unknown>)
    const reply = plan[calls++]
    if (reply === undefined) { response.writeHead(500); response.end(); return }
    const toolCalls = reply.filter(block => block.type === 'tool-call').map((block, index) => ({ index, id: block.id,
      type: 'function', function: { name: block.name, arguments: block.arguments } }))
    const delta = { role: 'assistant',
      ...reply.some(block => block.type === 'reasoning') ? { reasoning_content: reply.filter(block => block.type === 'reasoning').map(block => block.text).join('') } : {},
      ...reply.some(block => block.type === 'text') ? { content: reply.filter(block => block.type === 'text').map(block => block.text).join('') } : {},
      ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: `response-${calls}`, object: 'chat.completion.chunk', created: 1, model: 'pool-model',
      choices: [{ index: 0, delta, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`)
  })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture listener address.')
  const origin = `http://127.0.0.1:${address.port}`
  const built = new URL('../../lib/types/', import.meta.url)
  const toolModule = import.meta.resolve('@deepseek-ai/dsh-tools')
  const fixturePlugin = join(root, 'fixture-plugin.mjs')
  await writeFile(fixturePlugin, `import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool } from ${JSON.stringify(toolModule)};
import { GenerationAdapter, ACCOUNT_POOL_ROUTE } from ${JSON.stringify(new URL('llm/adapter.js', built).href)};
import { GenerationTransport } from ${JSON.stringify(new URL('provider/transport.js', built).href)};
import { Config } from ${JSON.stringify(new URL('provider/config.js', built).href)};
export const name = 'account-pool-recorded-provider';
export const inject = ['llm', 'tools'];
export function apply(ctx, config) {
  const lifetime = new AbortController();
  const settings = Config({stateRoot:config.cwd});
  const transport = new GenerationTransport(config.origin, 'fixture-management', 'fixture-inference', lifetime.signal, settings);
  const adapter = new GenerationAdapter(ctx, transport, [{id:'pool-model',contextWindow:131072,maxTokens:64000,input:['text','image'],reasoningEfforts:{high:'high'},defaultReasoningLevel:'high'}], settings);
  ctx.effect(() => ctx.llm.registerAdapter([ACCOUNT_POOL_ROUTE], adapter));
  ctx.effect(() => async () => {lifetime.abort();await transport.quiesce();await transport.close();});
  ctx.effect(() => ctx.tools.register(defineTool({name:'fixture_write',description:'Write the requested proof to the test workspace.',
    parameters:{value:{type:'string',required:true,description:'Proof content.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args){await writeFile(join(config.cwd,'proof.txt'),args.value);return 'Proof written.';}
  })));
}
`)
  await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-sdk-minimal'], patchReload: 'startup' } } }))
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'fixture-attachments', name: '@deepseek-ai/dsh-attachment-local', config: { dshHome: home } },
    { id: 'fixture-fs', name: '@deepseek-ai/dsh-fs-local', config: { cwd: root } },
    { id: 'recorded-provider',
    name: pathToFileURL(fixturePlugin).href, config: { cwd: root, origin } }] }]))
  const harness = new DeepSeekHarness({ profile: 'pool-session', dshHome: home, processCwd: root, cwd: root,
    provider: 'gestalt-account-pool', model: 'pool-model', initializeTimeoutMs: 12000, requestTimeoutMs: 12000,
    env: { ...scrubbedParentEnv(), HOME: home, USERPROFILE: home } })
  cleanup.push(() => harness.close())
  const sessionId = 'account-pool-recorded-session'
  const run = await harness.run([{ type: 'text', text: prompt },
    { type: 'image', data: png, mimeType: 'image/png' }], { sessionId })
  expect(run.finalResponse).toBe('Account pool fixture completed.')
  expect(await readFile(join(root, 'proof.txt'), 'utf8')).toBe('tool-proof')
  expect(calls).toBe(2)
  expect(requests.every(request => request.reasoning_effort === 'high')).toBe(true)
  expect(JSON.stringify(requests[0])).toContain('data:image/png;base64,')
  expect(run.events.some(event => event.type === 'tool/call')).toBe(true)
  expect(run.events.some(event => event.type === 'tool/result')).toBe(true)
  await harness.close()
  const directory = join(home, 'sessions')
  const files = latestPersistedSessionPaths((await readdir(directory, { recursive: true })).map(name => join(directory, name)))
  expect(files).toHaveLength(1)
  const raw = await readFile(files[0]!, 'utf8')
  expect(raw).not.toContain('fixture-inference')
  expect(raw).not.toContain('fixture-management')
  expect(raw).not.toContain(origin)
  const normalized = normalizeSessionSnapshots([raw], { sessionIds: [sessionId], cwd: root })[0]!
  if (recording) {
    const target = sessionFixtureName(0, sessionHeaderVersion(raw, 'account-pool fixture'))
    const fixture = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0]!,
      { sessionIds: [], cwd: root }, { identityMode: 'preserve' })
    await writeFile(join(fixtureDirectory, target), fixture, { flag: 'wx' })
  } else {
    expect(normalized).toBe(normalizeSessionSnapshots([recorded!], { sessionIds: [], cwd: root })[0])
  }
})
