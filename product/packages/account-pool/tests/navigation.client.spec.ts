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
    const signal = new AbortController().signal
    await openAuthorization('https://login.example/authorize?state=fixture', signal)
    expect(open).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ signal })
    await expect(openAuthorization('javascript:alert(1)')).rejects.toThrow('HTTPS')
    await expect(openAuthorization('https://user:secret@login.example')).rejects.toThrow('HTTPS')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces a Host refusal instead of treating a blocked popup as success', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))
    await expect(openAuthorization('https://login.example/authorize')).rejects.toThrow('HTTP 502')
  })

  it('aborts the Host authorization fetch when the plugin lifetime ends', async () => {
    const lifetime = new AbortController()
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(lifetime.signal)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('The operation was aborted.', 'AbortError')) }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = openAuthorization('https://login.example/authorize', lifetime.signal)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    lifetime.abort()
    await expect(pending).rejects.toThrow()
  })
})
