import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { CLIProxyAccountPool } from '../../src/provider/gateway.ts'
import { Config } from '../../src/provider/config.ts'
import type { AccountPoolSnapshot } from '../../src/account-pool.ts'
const resourceDirectory = process.env.DSH_ACCOUNT_POOL_TEST_RESOURCES
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
class ObservedSubprocess extends LocalSubprocess {
  readonly handles: SubprocessHandle[] = []
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    this.handles.push(handle)
    return handle
  }
}
class ExistingAdapter extends LlmAdapter { override async *stream() {} }
function until(pool: CLIProxyAccountPool, condition: (snapshot: AccountPoolSnapshot) => boolean): Promise<AccountPoolSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('Account state condition timed out.')) }, 12000)
    const inspect = (snapshot: AccountPoolSnapshot): void => {
      if (condition(snapshot)) { clearTimeout(timeout); stop(); resolve(snapshot) }
    }
    const stop = pool.subscribe(inspect)
    inspect(pool.getSnapshot())
  })
}
async function create() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pool-lifecycle-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ObservedSubprocess)
  return { root, ctx, subprocess: ctx.subprocess as ObservedSubprocess }
}

describe.skipIf(resourceDirectory === undefined)('real engine generation lifetime', () => {
  it('restarts after an unexpected managed-process exit and disposes the replacement to quiescence', async () => {
    const { root, ctx, subprocess } = await create()
    const fiber = ctx.plugin(CLIProxyAccountPool, Config({ stateRoot: root, resourceDirectory,
      allowCredentialExport: false, restartLimit: 1, catalogRefreshIntervalMs: 100 }))
    await fiber
    const pool = ctx.accountPool as CLIProxyAccountPool
    await until(pool, snapshot => snapshot.state === 'ready')
    const first = subprocess.handles[0]!
    const replacementReady = until(pool, snapshot => snapshot.state === 'ready' && subprocess.handles.length === 2)
    first.terminate()
    await replacementReady
    expect(await first.waitForExit()).toBe(true)
    await fiber.dispose()
    expect(await subprocess.handles[1]!.waitForExit()).toBe(true)
    expect(await readdir(join(root, 'generations'))).toEqual([])
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('disposal during startup does not leave a late owned process', async () => {
    const { root, ctx, subprocess } = await create()
    const fiber = ctx.plugin(CLIProxyAccountPool, Config({ stateRoot: root, resourceDirectory,
      allowCredentialExport: false, restartLimit: 0 }))
    await fiber
    await fiber.dispose()
    expect(await Promise.all(subprocess.handles.map(handle => handle.waitForExit()))).not.toContain(false)
    expect((await readdir(root)).includes('.owner.lock')).toBe(false)
  })

  it('refuses a duplicate model route without replacing the existing adapter', async () => {
    const { root, ctx } = await create()
    await mkdir(join(root, 'auth'), { mode: 0o700 })
    await writeFile(join(root, 'auth', 'codex-fixture.json'), JSON.stringify({
      type: 'codex', access_token: 'fake-fixture-token', email: 'fixture@example.invalid',
    }), { mode: 0o600 })
    const original = new ExistingAdapter()
    ctx.llm.registerAdapter(['gestalt-account-pool'], original)
    await ctx.plugin(CLIProxyAccountPool, Config({ stateRoot: root, resourceDirectory,
      allowCredentialExport: false, restartLimit: 0 }))
    const snapshot = await until(ctx.accountPool as CLIProxyAccountPool, value => value.state === 'error')
    expect(snapshot.error).toContain('already owned')
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['gestalt-account-pool'])
  })
})
