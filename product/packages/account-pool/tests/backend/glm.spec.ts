import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolError } from '../../src/account-pool.ts'
import { GlmAccounts, activeGlmEntries, glmCard, newGlmAccount } from '../../src/provider/glm.ts'
import { AccountState } from '../../src/provider/state.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'dsh-pool-ledger-')); roots.push(root); return root }

describe('committed GLM authority', () => {
  it('keeps disabled credentials privately and projects only enabled accounts', async () => {
    const path = await root()
    const store = new GlmAccounts(path, 1048576)
    await store.initialize()
    const account = newGlmAccount({ apiKey: 'fake-management-only-key', site: 'cn' })
    const updates: unknown[] = []
    await store.update(() => [account], async rows => { updates.push(activeGlmEntries(rows)) })
    await store.update(rows => rows.map(row => ({ ...row, enabled: false })), async rows => { updates.push(activeGlmEntries(rows)) })
    const restarted = new GlmAccounts(path, 1048576)
    expect((await restarted.read()).accounts[0]?.apiKey).toBe('fake-management-only-key')
    expect(updates).toEqual([[{ 'api-key': 'fake-management-only-key', site: 'cn' }], []])
    const card = glmCard((await restarted.read()).accounts[0]!)
    expect(card.status).toBe('disabled')
    expect(card.successCount).toBeUndefined()
    expect(card.quotaState.status).toBe('unobserved')
    expect(card.capabilities.quota).toBe(true)
    expect(JSON.stringify(card)).not.toContain('fake-management-only-key')
  })

  it('rolls back a settled core refusal using recovery authority', async () => {
    const path = await root()
    const store = new GlmAccounts(path, 1048576)
    await store.initialize()
    const calls: { entries: unknown; recovery: boolean }[] = []
    await expect(store.update(() => [newGlmAccount({ apiKey: 'fake-key', site: 'international' })], async (rows, recovery) => {
      calls.push({ entries: activeGlmEntries(rows), recovery })
      if (!recovery) throw new AccountPoolError('failed', 'settled core refusal')
    })).rejects.toThrow('not committed')
    expect(calls).toEqual([{ entries: [{ 'api-key': 'fake-key', site: 'international' }], recovery: false },
      { entries: [], recovery: true }])
    expect((await store.read()).revision).toBe(0)
    expect((await store.read()).accounts).toEqual([])
  })

  it('keeps an uncertain write journal for process recovery rather than racing a rollback against the original handler', async () => {
    const path = await root()
    const store = new GlmAccounts(path, 1048576)
    await store.initialize()
    let calls = 0
    let finishLate!: () => void
    const late = new Promise<void>(resolve => { finishLate = resolve })
    let engine: unknown = []
    await expect(store.update(() => [newGlmAccount({ apiKey: 'uncertain-key', site: 'cn' })], async rows => {
      calls++
      void late.then(() => { engine = activeGlmEntries(rows) })
      throw new Error('HTTP response lost while the Go handler continues')
    })).rejects.toThrow('uncertain')
    expect(calls).toBe(1)
    finishLate()
    await late
    expect(engine).toEqual([{ 'api-key': 'uncertain-key', site: 'cn' }])
    expect((await store.read()).accounts).toEqual([])
    expect(await readFile(join(path, 'glm-transaction.json'), 'utf8')).toContain('uncertain-key')
  })

  it('recovers from a pre-commit crash using the committed ledger and rejects concurrent owners', async () => {
    const path = await root()
    const state = await AccountState.acquire(path, 1048576)
    try {
      await expect(AccountState.acquire(path, 1048576)).rejects.toThrow('already locked')
      await writeFile(join(path, 'glm-transaction.json'), JSON.stringify({ previousRevision: 0,
        next: { revision: 1, accounts: [newGlmAccount({ apiKey: 'uncommitted-key', site: 'cn' })] } }), { mode: 0o600 })
      await state.configure({ host: '127.0.0.1', port: 1234 }, 1048576)
      expect(await readFile(state.configFile, 'utf8')).not.toContain('uncommitted-key')
      await state.glm.clearJournal()
    } finally { await state.release() }
    const reopened = await AccountState.acquire(path, 1048576)
    await reopened.release()
  })
})
