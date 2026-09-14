import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDingTalkTransportConfig } from '../src/config.ts'
import { DwsProcessRunner } from '../src/process.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function boot(handle: SubprocessHandle): { runner: DwsProcessRunner; spawn: ReturnType<typeof vi.fn> } {
  const ctx = new Context()
  roots.push(ctx)
  const spawn = vi.fn(() => handle)
  ctx.subprocess = {
    resolveExecutable: vi.fn(async () => '/fixture/dws'),
    spawn,
  } as unknown as typeof ctx.subprocess
  return {
    runner: new DwsProcessRunner(ctx, resolveDingTalkTransportConfig({
      home: '/fixture/home', cwd: '/fixture/cwd', commandTimeoutMs: 1_000,
      readinessTimeoutMs: 1_000, graceMs: 100, maxOutputBytes: 1_024, maxLineBytes: 1_024,
    })),
    spawn,
  }
}

describe('DWS subprocess runner', () => {
  it('uses bounded collected output and awaits managed-range quiescence for commands', async () => {
    const waitForExit = vi.fn(async () => true)
    const handle = {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text: '{"success":true}', nextOffset: 16, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: Promise.resolve<SubprocessOutcome>({ exitCode: 0, signal: null }),
      terminate: vi.fn(), waitForExit,
    } satisfies SubprocessHandle
    const { runner, spawn } = boot(handle)
    await expect(runner.run(['profile', 'list'], new AbortController().signal)).resolves.toMatchObject({ stdout: '{"success":true}' })
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['/fixture/dws', 'profile', 'list'], cwd: '/fixture/cwd', env: { HOME: '/fixture/home' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
    }))
    expect(waitForExit).toHaveBeenCalledOnce()
  })

  it('buffers early stdout until the exact ready marker and terminates before stop resolves', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let finish!: (outcome: SubprocessOutcome) => void
    const done = new Promise<SubprocessOutcome>(resolve => { finish = resolve })
    let exited = false
    const handle = {
      stdin, stdout, stderr, collected: {}, done,
      terminate: vi.fn(() => { if (!exited) { exited = true; finish({ exitCode: null, signal: 'SIGTERM' }) } }),
      waitForExit: vi.fn(async () => exited),
    } satisfies SubprocessHandle
    const { runner } = boot(handle)
    const lines: string[] = []
    const stream = await runner.stream(['event', 'consume'], new AbortController().signal, async line => { lines.push(line) })
    stdout.write('{"event":"early"}\n')
    stderr.write('[event] not-ready\n')
    await Promise.resolve()
    expect(lines).toEqual([])
    stderr.write('[event] ready subscribe_id=sub-1\n')
    await stream.ready
    await vi.waitFor(() => { expect(lines).toEqual(['{"event":"early"}']) })
    await stream.stop()
    expect(handle.terminate).toHaveBeenCalledOnce()
    expect(handle.waitForExit).toHaveBeenCalledOnce()
  })
})
