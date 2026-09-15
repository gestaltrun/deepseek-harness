import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountState } from '../../src/provider/state.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('legacy GLM ledger migration', () => {
  it('writes leftover product GLM accounts onto auth-dir once and removes the ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pool-migrate-'))
    roots.push(root)
    await writeFile(join(root, 'glm-accounts.json'), JSON.stringify({
      revision: 1,
      accounts: [{
        id: '11111111-1111-4111-8111-111111111111', apiKey: 'legacy-glm-key', site: 'cn',
        organization: 'team', enabled: false, note: 'migrated',
      }],
    }), { mode: 0o600 })
    const state = await AccountState.acquire(root, 1048576)
    try {
      const name = 'glm-11111111-1111-4111-8111-111111111111.json'
      expect(JSON.parse(await readFile(join(state.authDirectory, name), 'utf8'))).toEqual({
        type: 'glm', api_key: 'legacy-glm-key', site: 'cn', disabled: true, organization: 'team', note: 'migrated',
      })
      expect(await readdir(root)).not.toContain('glm-accounts.json')
    } finally { await state.release() }
  })
})
