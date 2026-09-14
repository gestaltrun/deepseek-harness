import { describe, expect, it, vi } from 'vitest'
import type { DwsProcessRunner } from '../src/process.ts'
import { DwsClient } from '../src/client.ts'

function runnerFor(command: (args: readonly string[]) => string): { runner: DwsProcessRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner = {
    run: vi.fn(async (args: readonly string[]) => {
      calls.push([...args])
      return { stdout: command(args), outcome: { exitCode: 0, signal: null } }
    }),
    stream: vi.fn(),
  } as unknown as DwsProcessRunner
  return { runner, calls }
}

function fixtureOutput(args: readonly string[]): string {
  if (args[0] === '--version') return 'dws version v1.0.61 (fixture)'
  if (args.at(-1) === '--help') return `Usage: dws ${args.slice(0, -1).join(' ')}`
  if (args[0] === 'profile') return JSON.stringify({ success: true, profiles: [{ profile: 'corp-a:user-1', corpId: 'corp-a', corpName: 'A', userId: 'user-1', status: 'active', isPrimary: true, isCurrent: true, isOrgCurrent: true }] })
  if (args[0] === 'auth') return JSON.stringify({ success: true, authenticated: true, token_valid: true, corp_id: 'corp-a', user_id: 'user-1' })
  if (args[1] === '+conversation-list') return JSON.stringify({ conversations: [], hasMore: false })
  if (args[2] === 'send') return JSON.stringify({ success: true, result: { openTaskId: 'task-1' } })
  return JSON.stringify({ result: { status: 'SUCCESS', openMessageId: 'message-1' } })
}

describe('DWS client argv', () => {
  it('probes public leaves once and pins each account operation to the exact profile', async () => {
    const { runner, calls } = runnerFor(fixtureOutput)
    const client = new DwsClient(runner, () => Date.parse('2026-09-14T00:00:00.000Z'))
    const signal = new AbortController().signal
    await client.listProfiles(signal)
    await client.refresh('corp-a:user-1', signal)
    await client.conversations('corp-a:user-1', 50, '2', signal)
    await client.send('corp-a:user-1', { kind: 'group', conversationId: 'cid-group' }, 'hello', 'request-1', signal)
    await client.confirm('corp-a:user-1', 'task-1', signal)

    expect(calls.filter(args => args[0] === '--version')).toHaveLength(1)
    expect(calls).toContainEqual(['auth', 'status', '--profile', 'corp-a:user-1', '--format', 'json'])
    expect(calls).toContainEqual(['chat', '+conversation-list', '--limit', '50', '--cursor', '2', '--format', 'json', '--profile', 'corp-a:user-1'])
    expect(calls).toContainEqual(['chat', 'message', 'send', '--conversation-id', 'cid-group', '--content', 'hello', '--idempotency-key', 'request-1', '--ai-tag=true', '--format', 'json', '--profile', 'corp-a:user-1'])
    expect(calls).toContainEqual(['chat', 'message', 'query-send-status', '--open-task-id', 'task-1', '--format', 'json', '--profile', 'corp-a:user-1'])
  })

  it('uses the direct peer identity only as the direct send target', async () => {
    const { runner, calls } = runnerFor(fixtureOutput)
    const client = new DwsClient(runner)
    await client.send('corp-a:user-2', { kind: 'direct', openDingTalkId: 'D-peer' }, 'hello', 'request-2', new AbortController().signal)
    expect(calls).toContainEqual(['chat', 'message', 'send', '--open-dingtalk-id', 'D-peer', '--content', 'hello', '--idempotency-key', 'request-2', '--ai-tag=true', '--format', 'json', '--profile', 'corp-a:user-2'])
  })
})
