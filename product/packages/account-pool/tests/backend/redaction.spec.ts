import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AccountPoolAccountName } from '../../src/account-pool.ts'
import { coreFieldPatch, editableFields, roster } from '../../src/provider/redaction.ts'
import { patchSchema, parseInput } from '../../src/provider/validation.ts'
import { accountPoolOpenResponse, authorizationOpener } from '../../src/rpc/open.ts'
const name = brandString<AccountPoolAccountName>('test.json')

describe('account metadata redaction', () => {
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

  it('opens only HTTPS authorization URLs through the Host launcher', async () => {
    const opened: string[] = []
    const launch = async (url: string) => { opened.push(url) }
    const post = (url: string) => new Request('https://host/api/account-pool.open', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
    })
    expect((await accountPoolOpenResponse(new Request('https://host/api/account-pool.open'), launch)).status).toBe(405)
    expect((await accountPoolOpenResponse(post('javascript:alert(1)'), launch)).status).toBe(400)
    expect((await accountPoolOpenResponse(post('https://user:secret@login.example'), launch)).status).toBe(400)
    expect((await accountPoolOpenResponse(post('http://login.example/authorize'), launch)).status).toBe(400)
    const ok = await accountPoolOpenResponse(post('https://login.example/authorize?state=fixture'), launch)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(opened).toEqual(['https://login.example/authorize?state=fixture'])
    const refused = await accountPoolOpenResponse(post('https://login.example/authorize'), async () => {
      throw new Error('spawn EACCES')
    })
    expect(refused.status).toBe(502)
    expect(authorizationOpener('https://login.example/authorize', 'darwin')).toEqual({
      command: 'open', args: ['https://login.example/authorize'],
    })
    expect(authorizationOpener('https://login.example/authorize', 'win32')).toEqual({
      command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'https://login.example/authorize'],
    })
    expect(authorizationOpener('https://login.example/authorize', 'linux')).toEqual({
      command: 'xdg-open', args: ['https://login.example/authorize'],
    })
  })
})
