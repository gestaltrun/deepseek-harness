import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AccountPoolAccountName } from '../../src/account-pool.ts'
import { coreFieldPatch, editableFields, roster } from '../../src/provider/redaction.ts'
import { patchSchema, parseInput } from '../../src/provider/validation.ts'
import { accountPoolExportResponse } from '../../src/rpc/export.ts'
const name = brandString<AccountPoolAccountName>('test.json')

describe('account metadata and explicit credential download', () => {
  it('keeps unknown credentials and headers out of ordinary reads while preserving explicit edit intents', () => {
    const raw = { name, auth_index: 'opaque-core-index', provider: 'codex', access_token: 'secret-token',
      random_password: 'hidden', arbitrary_auth_field: 'unknown-secret', note: 'note',
      proxy_url: 'https://proxy-user:proxy-password@proxy.example:1234/?key=proxy-secret',
      headers: { authorization: 'Bearer hidden', 'x-arbitrary-secret': 'custom-secret', accept: 'application/json' } }
    const fields = editableFields(name, raw)
    const snapshot = roster({ files: [raw] })
    const exposed = JSON.stringify({ fields, snapshot })
    for (const secret of ['secret-token', 'unknown-secret', 'proxy-user', 'proxy-password', 'proxy-secret', 'Bearer hidden', 'custom-secret']) {
      expect(exposed).not.toContain(secret)
    }
    expect(fields.fields.proxyCredentialsConfigured).toBe(true)
    expect(fields.fields.headers?.authorization).toEqual({ kind: 'secret', configured: true })
    expect(snapshot[0]?.ref).toMatch(/^oauth:[a-f0-9]{64}$/)
    expect(exposed).not.toContain('opaque-core-index')
    expect(coreFieldPatch({ headers: { authorization: { kind: 'keep' }, 'x-arbitrary-secret': { kind: 'remove' } },
      proxyUrl: { kind: 'keep' } }, raw)).toEqual({ headers: { authorization: 'Bearer hidden', accept: 'application/json' } })
    expect(coreFieldPatch({ headers: { Authorization: { kind: 'replace', value: 'Bearer new' } } }, raw)).toEqual({
      headers: { Authorization: 'Bearer new', 'x-arbitrary-secret': 'custom-secret', accept: 'application/json' } })
    expect(() => parseInput(patchSchema, { access_token: 'replacement' })).toThrow('input is invalid')
  })

  it('refuses malformed roster JSON instead of reporting an empty account pool', () => {
    expect(() => roster({ error: 'bad gateway' })).toThrow('roster response is invalid')
    expect(() => roster({ files: [{ name }] })).toThrow('reference is missing')
    expect(roster({ files: [] })).toEqual([])
  })

  it('enforces export denial before reads and keeps HEAD credential-free', async () => {
    let reads = 0
    const owner = { downloadAuthFile: async () => { reads++; return { name, body: '{"refresh_token":"export-only"}' } } }
    const url = `https://host/api/account-pool.export?name=${name}`
    expect((await accountPoolExportResponse(owner, false, new Request(url))).status).toBe(403)
    expect((await accountPoolExportResponse(owner, true, new Request(url, { method: 'HEAD' }))).status).toBe(200)
    expect(reads).toBe(0)
    const response = await accountPoolExportResponse(owner, true, new Request(url))
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="test.json"')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('export-only')
    expect((await accountPoolExportResponse(owner, true, new Request('https://host/api/account-pool.export?name=..%2Fbad'))).status).toBe(400)
    expect(reads).toBe(1)
  })
})
