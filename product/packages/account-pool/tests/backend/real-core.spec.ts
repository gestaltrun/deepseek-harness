import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { CLIProxyAccountPool } from '../../src/provider/gateway.ts'
import { Config } from '../../src/provider/config.ts'
import type { AccountPoolSnapshot } from '../../src/account-pool.ts'

const resourceDirectory = process.env.DSH_ACCOUNT_POOL_TEST_RESOURCES
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function ready(pool: CLIProxyAccountPool): Promise<AccountPoolSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error(`Account engine never became ready: ${JSON.stringify(pool.getSnapshot())}`)) }, 15000)
    const stop = pool.subscribe(snapshot => {
      if (snapshot.state === 'ready') { clearTimeout(timeout); stop(); resolve(snapshot) }
    })
    if (pool.getSnapshot().state === 'ready') { clearTimeout(timeout); stop(); resolve(pool.getSnapshot()) }
  })
}
async function boot(stateRoot: string): Promise<{ ctx: Context; pool: CLIProxyAccountPool }> {
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(CLIProxyAccountPool, Config({ stateRoot, resourceDirectory, allowCredentialExport: true,
    restartLimit: 0, catalogRefreshIntervalMs: 100, startupTimeoutMs: 15000 }))
  const pool = ctx.accountPool as CLIProxyAccountPool
  await ready(pool)
  return { ctx, pool }
}

describe.skipIf(resourceDirectory === undefined)('exact packaged Go engine management', () => {
  it('retains OAuth files, serves the real core catalog, contains subscribers, and cancels PKCE login', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-pool-real-oauth-'))
    cleanup.push(async () => { await rm(stateRoot, { recursive: true, force: true }) })
    await mkdir(join(stateRoot, 'auth'), { mode: 0o700 })
    const filename = 'codex-fixture.json'
    await writeFile(join(stateRoot, 'auth', filename), JSON.stringify({ type: 'codex',
      access_token: 'fake-oauth-fixture-token', email: 'fixture@example.invalid', note: 'before' }), { mode: 0o600 })
    const { ctx, pool } = await boot(stateRoot)
    const account = pool.getSnapshot().accounts.find(account => account.name === filename)!
    expect(account).toBeDefined()
    expect(account.ref).toMatch(/^oauth:/)
    expect((await pool.listModels(account.name)).length).toBeGreaterThan(0)
    await pool.refresh()
    expect(ctx.llm.listProviders().some(provider => provider.id === 'gestalt-account-pool')).toBe(true)
    const failures = pool.subscribe(() => { throw new Error('test subscriber failed') })
    let received = 0
    const observed = pool.subscribe(() => { received++ })
    await pool.patchFields(account.name, { note: 'after', headers: { Authorization: { kind: 'replace', value: 'test-private-header' } } })
    failures()
    observed()
    expect(received).toBeGreaterThan(0)
    const fields = await pool.readFields(account.name)
    expect(fields.fields.note).toBe('after')
    expect(JSON.stringify(fields)).not.toContain('fake-oauth-fixture-token')
    expect(JSON.stringify(fields)).not.toContain('test-private-header')
    const login = await pool.startLogin('codex')
    expect(login.flow).toBe('pkce')
    expect(login.state).toBeDefined()
    await pool.cancelLogin(login.state!)
    expect(pool.getSnapshot().login).toBeUndefined()
    await pool.setEnabled(account.name, false)
    expect(pool.getSnapshot().accounts.find(value => value.ref === account.ref)?.enabled).toBe(false)
    await ctx.fiber.dispose()
    expect(JSON.parse(await readFile(join(stateRoot, 'auth', filename), 'utf8')).note).toBe('after')
    expect(await readdir(join(stateRoot, 'generations'))).toEqual([])
  })

  it('preserves GLM product credentials across disable, restart, re-enable, edit, export, and delete', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-pool-real-core-'))
    cleanup.push(async () => { await rm(stateRoot, { recursive: true, force: true }) })
    const first = await boot(stateRoot)
    expect(first.pool.getSnapshot().accounts).toEqual([])
    const added = await first.pool.submitGlmKey({ apiKey: 'fake-management-smoke-key', site: 'cn', organization: 'fixture-org' })
    const account = added.accounts.find(account => account.provider === 'glm')!
    expect(account).toBeDefined()
    expect(account.ref).toMatch(/^glm:/)
    expect(account.successCount).toBeUndefined()
    expect(account.quotaState.status).toBe('unsupported')
    const disabled = await first.pool.setEnabled(account.name, false)
    expect(disabled.accounts[0]?.enabled).toBe(false)
    const configWhileDisabled = await readFile(join(stateRoot, 'config.yaml'), 'utf8')
    expect(configWhileDisabled).not.toContain('fake-management-smoke-key')
    await first.ctx.fiber.dispose()
    expect(await readdir(join(stateRoot, 'generations'))).toEqual([])
    const second = await boot(stateRoot)
    expect(second.pool.getSnapshot().accounts[0]?.ref).toBe(account.ref)
    expect(second.pool.getSnapshot().accounts[0]?.enabled).toBe(false)
    await second.pool.setEnabled(account.name, true)
    expect(await readFile(join(stateRoot, 'config.yaml'), 'utf8')).toContain('fake-management-smoke-key')
    await second.pool.patchFields(account.name, { note: 'edited', priority: 3 })
    expect((await second.pool.readFields(account.name)).fields.note).toBe('edited')
    expect((await second.pool.downloadAuthFile(account.name)).body).toContain('fake-management-smoke-key')
    await second.pool.deleteAccount(account.name)
    expect(second.pool.getSnapshot().accounts).toEqual([])
    expect(await readFile(join(stateRoot, 'config.yaml'), 'utf8')).not.toContain('fake-management-smoke-key')
  })
})
