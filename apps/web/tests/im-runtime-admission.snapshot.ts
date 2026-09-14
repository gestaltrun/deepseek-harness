/** Authored keyless replay of provider input through the product IM runtime and shipped Web profile. */

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PRODUCT_ROOT = join(REPO_ROOT, 'product')
const BUNDLE_MANIFEST = join(PRODUCT_ROOT, 'im-bundle/package.json')
const RUNTIME_ENTRY = join(PRODUCT_ROOT, 'im-runtime/lib/index.js')
const SNAPSHOT_DIR = join(REPO_ROOT, 'snapshots/web/im-runtime-admission')
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PROVIDER = join(PRODUCT_ROOT, 'im-bundle/fixtures/im-snapshot-provider.mjs')
const PRODUCT_SNAPSHOT_REQUIRED = process.env.DSH_PRODUCT_IM_SNAPSHOT_REQUIRED === '1'

function imIdentityValues(log: string): readonly string[] {
  const records = log.split(/\r?\n/u).filter(line => line.trim() !== '').map(line => JSON.parse(line) as {
    type?: unknown
    data?: Record<string, unknown>
  })
  const inbound = records.filter(record =>
    record.type === 'user/message'
    && (record.data?.source as Record<string, unknown> | undefined)?.kind === 'im')
  if (inbound.length !== 1) throw new Error(`IM snapshot must have one admitted user message; got ${inbound.length}`)
  const source = inbound[0]?.data?.source as Record<string, unknown> | undefined
  if (source === undefined) throw new Error('IM snapshot admitted user message has no source')
  const admission = source.admission as Record<string, unknown>
  const scope = admission.scope as Record<string, unknown>
  const messageIds = admission.messageIds
  const messages = admission.messages
  if (!Array.isArray(messageIds) || !Array.isArray(messages)) {
    throw new Error('IM snapshot admission message inventory is incomplete')
  }
  if (messageIds.length !== 1 || messages.length !== 1) {
    throw new Error('IM snapshot admission must preserve one source message')
  }
  const message = messages[0] as Record<string, unknown> | undefined
  if (source.messageId !== messageIds[0] || source.messageId !== message?.messageId) {
    throw new Error('IM snapshot source and admission message identities diverged')
  }
  const sendCalls = records.filter(record =>
    record.type === 'tool/call' && record.data?.name === 'im_send_message')
  if (sendCalls.length !== 1 || typeof sendCalls[0]?.data?.callId !== 'string') {
    throw new Error('IM snapshot must have one send tool call')
  }
  const sendCallId = sendCalls[0].data.callId
  const sendResults = records.filter((record) => {
    if (record.type !== 'tool/result') return false
    const content = (record.data?.message as { content?: unknown[] } | undefined)?.content
    const result = content?.[0] as { toolCallId?: unknown } | undefined
    return result?.toolCallId === sendCallId
  })
  const sendResult = ((sendResults[0]?.data?.message as { content?: unknown[] } | undefined)
    ?.content?.[0] as { content?: unknown[] } | undefined)?.content?.[0] as { text?: unknown } | undefined
  const outboundMatch = typeof sendResult?.text === 'string'
    ? /^IM reply sent \(([^)]+)\)$/u.exec(sendResult.text)
    : null
  if (sendResults.length !== 1 || outboundMatch === null) {
    throw new Error('IM snapshot send result has no unique outbound identity')
  }
  const values = [
    source.scopeId,
    source.messageId,
    admission.admissionId,
    scope.accountId,
    admission.routeId,
    admission.routeRevision,
    admission.accountRevision,
    admission.workspaceId,
    outboundMatch[1],
  ]
  if (values.some(value => typeof value !== 'string')) throw new Error('IM snapshot identity fields are incomplete')
  const identityValues = values as string[]
  if (new Set(identityValues).size !== identityValues.length) {
    throw new Error('IM snapshot opaque identity fields must remain distinct')
  }
  return identityValues
}

function imIdentityReplacements(fresh: string, existing: string): readonly { from: string; to: string }[] {
  const freshValues = imIdentityValues(fresh)
  const existingValues = imIdentityValues(existing)
  if (freshValues.length !== existingValues.length) {
    throw new Error('IM snapshot identity field inventory changed')
  }
  return freshValues.map((from, index) => ({ from, to: existingValues[index] as string }))
}

function identityFixture(overrides: {
  sourceMessageId?: string
  admittedMessageId?: string
  nestedMessageId?: string
  scopeId?: string
  accountRevision?: string | null
} = {}): string {
  const sourceMessageId = overrides.sourceMessageId ?? 'message-fresh'
  const admittedMessageId = overrides.admittedMessageId ?? sourceMessageId
  const nestedMessageId = overrides.nestedMessageId ?? sourceMessageId
  return [
    {
      type: 'user/message',
      data: {
        source: {
          kind: 'im',
          scopeId: overrides.scopeId ?? 'scope-fresh',
          messageId: sourceMessageId,
          admission: {
            admissionId: 'admission-fresh',
            scope: { accountId: 'account-fresh' },
            messageIds: [admittedMessageId],
            messages: [{ messageId: nestedMessageId }],
            routeId: 'route-fresh',
            routeRevision: 'route-revision-fresh',
            accountRevision: overrides.accountRevision === null
              ? undefined
              : overrides.accountRevision ?? 'account-revision-fresh',
            workspaceId: 'workspace-fresh',
          },
        },
      },
    },
    { type: 'tool/call', data: { callId: 'send-call', name: 'im_send_message' } },
    {
      type: 'tool/result',
      data: {
        message: {
          content: [{
            toolCallId: 'send-call',
            content: [{ text: 'IM reply sent (outbound-fresh)' }],
          }],
        },
      },
    },
  ].map(record => JSON.stringify(record)).join('\n')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readPublished(path: string): Promise<string | undefined> {
  if (!await exists(`${path}.complete`)) return undefined
  return await readFile(path, 'utf8')
}

describe('IM snapshot identity correspondence', () => {
  it('maps only the fixed opaque identity inventory', () => {
    const fixture = identityFixture()
    const replacements = imIdentityReplacements(fixture, fixture.replaceAll('-fresh', '-fixture'))
    expect(replacements).toHaveLength(9)
    expect(replacements).toContainEqual({ from: 'message-fresh', to: 'message-fixture' })
    expect(replacements).toContainEqual({ from: 'outbound-fresh', to: 'outbound-fixture' })
  })

  it('rejects inconsistent, colliding, and incomplete identities', () => {
    expect(() => imIdentityReplacements(
      identityFixture({ admittedMessageId: 'another-message' }),
      identityFixture(),
    )).toThrow(/message identities diverged/u)
    expect(() => imIdentityReplacements(
      identityFixture({ scopeId: 'message-fresh' }),
      identityFixture(),
    )).toThrow(/must remain distinct/u)
    expect(() => imIdentityReplacements(
      identityFixture({ accountRevision: null }),
      identityFixture(),
    )).toThrow(/identity fields are incomplete/u)
  })
})

async function waitForProvider(scaffold: WebScaffold): Promise<void> {
  const ready = join(scaffold.workspaceCwd, '.im-snapshot-ready')
  const failure = join(scaffold.workspaceCwd, '.im-snapshot-failure')
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    const failureText = await readPublished(failure)
    if (failureText !== undefined) throw new Error(failureText)
    if (await exists(ready)) return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
  }
  throw new Error('IM snapshot provider did not become ready')
}

async function readProviderProof(scaffold: WebScaffold): Promise<{
  sessionId: string
  outboundStatus: string
  outboundExternalMessageId: string
}> {
  const proof = join(scaffold.workspaceCwd, '.im-snapshot-proof.json')
  const failure = join(scaffold.workspaceCwd, '.im-snapshot-failure')
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    const failureText = await readPublished(failure)
    if (failureText !== undefined) throw new Error(failureText)
    const proofText = await readPublished(proof)
    if (proofText !== undefined) return JSON.parse(proofText) as {
      sessionId: string
      outboundStatus: string
      outboundExternalMessageId: string
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
  }
  throw new Error('IM snapshot provider did not publish completion proof')
}

async function waitForTurn(scaffold: WebScaffold): Promise<string> {
  const failure = join(scaffold.workspaceCwd, '.im-snapshot-failure')
  const stop = new AbortController()
  const failed = (async (): Promise<never> => {
    while (!stop.signal.aborted) {
      const failureText = await readPublished(failure)
      if (failureText !== undefined) throw new Error(failureText)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    }
    return await new Promise<never>(() => {})
  })()
  try {
    return await Promise.race([scaffold.whenTurnSettled(), failed])
  } finally {
    stop.abort()
  }
}

describe.skipIf(!PRODUCT_SNAPSHOT_REQUIRED && !await exists(RUNTIME_ENTRY))(
  'product IM runtime admission through the shipped Web profile', () => {
    it('replays one runtime-owned root Session from synthetic provider input', async () => {
      for (const path of [RUNTIME_ENTRY, BUNDLE_MANIFEST, PROVIDER, FIXTURE]) {
        if (!await exists(path)) throw new Error(`Required product IM snapshot input is missing: ${path}`)
      }
      const overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-im-snapshot-overlay-'))
      const overlay = join(overlayRoot, 'cordis.patch.yml')
      await writeFile(overlay, [
        '- insert:',
        '    - id: gestaltrun-im-snapshot-runtime',
        "      name: '@gestaltrun/dsh-im-runtime'",
        '    - id: gestaltrun-im-snapshot-provider',
        `      name: ${JSON.stringify(pathToFileURL(PROVIDER).href)}`,
        '',
      ].join('\n'))
      let scaffold: WebScaffold | undefined
      const roots: Session[] = []
      let off: (() => void) | undefined
      let scenarioFailure: unknown
      try {
        scaffold = await launchWebScaffold({
          replayFixture: FIXTURE,
          compareReplaySession: true,
          extraOverlayPath: overlay,
          extraInstallAnchors: [BUNDLE_MANIFEST],
          replayFixtureReplacements: imIdentityReplacements,
        })
        off = scaffold.ctx.on('session/created', (session: Session) => {
          if (session.header.parentSession === undefined) roots.push(session)
        })
        await waitForProvider(scaffold)
        const settled = waitForTurn(scaffold)
        await writeFile(join(scaffold.workspaceCwd, '.im-snapshot-trigger'), 'trigger\n')
        const sessionId = await settled
        const proof = await readProviderProof(scaffold)
        expect(roots.map(session => session.id)).toEqual([sessionId])
        expect(sessionId).toMatch(/^im-agent:/u)
        expect(proof).toEqual({
          sessionId,
          outboundStatus: 'sent',
          outboundExternalMessageId: 'snapshot-outbound-1',
        })
        const session = roots[0]
        expect(session).toBeDefined()
        const events = session?.snapshotEvents() ?? []
        const inbound = events.filter(event =>
          event.type === 'user/message'
          && String(event.data.source.kind) === 'im')
        expect(inbound).toHaveLength(1)
        expect(inbound?.[0]).toMatchObject({
          data: {
            source: {
              kind: 'im',
              admission: {
                scope: { platform: 'wangwang' },
                messages: [{ externalMessageId: 'snapshot-inbound-1' }],
              },
            },
          },
        })
        expect(events.filter(event => event.type === 'step/start')).toHaveLength(3)
        expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
        expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual([
          'im_query_history',
          'im_send_message',
        ])
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(2)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } catch (error) {
        scenarioFailure = error
        throw error
      } finally {
        off?.()
        try {
          try {
            await scaffold?.close()
          } catch (error) {
            if (scenarioFailure === undefined) throw error
            throw new AggregateError([scenarioFailure, error], 'IM snapshot scenario and teardown failed')
          }
        } finally {
          await rm(overlayRoot, { recursive: true, force: true })
        }
      }
    })
  },
)
