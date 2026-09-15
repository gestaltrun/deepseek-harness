// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAuthorization } from '../src/client/navigation.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account browser actions', () => {
  it('asks the Host to open HTTPS authorization and rejects renderer popups and executable URLs', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.credentials).toBe('same-origin')
      const request = new Request(input, init)
      expect(new URL(request.url).pathname).toBe('/api/account-pool.open')
      expect(await request.json()).toEqual({ url: 'https://login.example/authorize?state=fixture' })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetcher)
    await openAuthorization('https://login.example/authorize?state=fixture')
    expect(open).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(openAuthorization('javascript:alert(1)')).rejects.toThrow('HTTPS')
    await expect(openAuthorization('https://user:secret@login.example')).rejects.toThrow('HTTPS')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces a Host refusal instead of treating a blocked popup as success', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))
    await expect(openAuthorization('https://login.example/authorize')).rejects.toThrow('HTTP 502')
  })
})
