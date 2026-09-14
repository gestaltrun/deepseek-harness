// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountPoolAccountName } from '../src/account-pool.ts'
import { downloadAccount, openAuthorization } from '../src/client/navigation.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account browser actions', () => {
  it('checks download policy before handing the authenticated URL to an anchor', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    await downloadAccount('codex.json' as AccountPoolAccountName, signal)
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), { method: 'HEAD', signal, credentials: 'same-origin' })
    const anchor = save.mock.instances[0]
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Expected a native download anchor')
    expect(anchor.download).toBe('codex.json')
    expect(new URL(anchor.href).pathname).toBe('/api/account-pool.export')
    expect(new URL(anchor.href).searchParams.get('name')).toBe('codex.json')
  })

  it('does not start a download after the Host denies export', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))
    await expect(downloadAccount('codex.json' as AccountPoolAccountName, new AbortController().signal)).rejects.toThrow('HTTP 403')
    expect(save).not.toHaveBeenCalled()
  })

  it('opens provider HTTPS links without an opener and rejects executable URLs', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await openAuthorization('https://login.example/authorize?state=fixture')
    expect(open).toHaveBeenCalledWith('https://login.example/authorize?state=fixture', '_blank', 'noopener,noreferrer')
    await expect(openAuthorization('javascript:alert(1)')).rejects.toThrow('HTTPS')
    await expect(openAuthorization('https://user:secret@login.example')).rejects.toThrow('HTTPS')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
