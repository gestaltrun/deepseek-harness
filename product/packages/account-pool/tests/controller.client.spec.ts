import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteStream, RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountPoolAccountName, AccountPoolSnapshot } from '../src/account-pool.ts'
import { AccountPoolClientController } from '../src/client/controller.ts'

const ready: AccountPoolSnapshot = { state: 'ready', accounts: [] }
const controllers: AccountPoolClientController[] = []
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())) })

function bench() {
  let writeSnapshot: ((value: AccountPoolSnapshot) => void) | undefined
  const watchStopped = vi.fn()
  const watch = async function* (signal?: AbortSignal) {
    try {
      yield ready
      while (!signal?.aborted) {
        const next = await new Promise<AccountPoolSnapshot | undefined>(resolve => {
          writeSnapshot = value => { signal?.removeEventListener('abort', stop); resolve(value) }
          const stop = () => { resolve(undefined) }
          signal?.addEventListener('abort', stop, { once: true })
        })
        if (next === undefined) return
        yield next
      }
    } finally { watchStopped() }
  }
  const success = async () => ({ ok: true as const, value: ready })
  const remote: Pick<ClientRemote, 'accountPool' | '$stream'> = {
    accountPool: {
      getSnapshot: success, refresh: vi.fn(success), setEnabled: vi.fn(success), deleteAccount: success,
      startLogin: async kind => ({ ok: true, value: { kind, flow: 'pkce', status: 'pending' } }),
      loginStatus: success, cancelLogin: success, dismissLogin: success, submitCallback: success, submitGlmKey: success,
      refreshQuota: success, refreshAllQuota: success, listModels: async () => ({ ok: true, value: [] }),
      readFields: async name => ({ ok: true, value: { name, info: {}, fields: {} } }), patchFields: success, watch,
    },
    $stream: <Item,>(options: RemoteStreamOptions<Item>) => {
      const abort = new AbortController()
      let finish!: () => void
      const stopped = new Promise<void>(resolve => { finish = resolve })
      const iterator = (async function* () {
        try {
          for await (const value of options.open(abort.signal)) yield { value, generation: 1, signal: abort.signal, accept: () => {} }
        } finally { finish() }
      })()
      // The wire is the mocked nondeterministic boundary; controller teardown still awaits it.
      return {
        signal: abort.signal, restart: () => {},
        dispose: async () => { abort.abort(); await stopped },
        [Symbol.asyncIterator]: () => iterator,
      } as unknown as RemoteStream<Item>
    },
  }
  const controller = new AccountPoolClientController(remote, { openExternal: async () => {} })
  controllers.push(controller)
  return { remote, controller, write: (snapshot: AccountPoolSnapshot) => { writeSnapshot?.(snapshot) }, watchStopped }
}

describe('account-pool Client controller', () => {
  it('uses the stream baseline and changes, then awaits watch termination on disposal', async () => {
    const { controller, write, watchStopped } = bench()
    await vi.waitFor(() => expect(controller.snapshot.getSnapshot().state).toBe('ready'))
    const changed: AccountPoolSnapshot = { state: 'error', accounts: [], error: 'Core stopped' }
    write(changed)
    await vi.waitFor(() => expect(controller.snapshot.getSnapshot()).toEqual(changed))
    await controller.dispose()
    expect(watchStopped).toHaveBeenCalledTimes(1)
    write(ready)
    expect(controller.snapshot.getSnapshot()).toEqual(changed)
  })

  it('does not replace a newer watch snapshot with an older command answer', async () => {
    const { controller, remote, write } = bench()
    await vi.waitFor(() => expect(controller.snapshot.getSnapshot().state).toBe('ready'))
    let finish!: (result: Awaited<ReturnType<typeof remote.accountPool.refresh>>) => void
    remote.accountPool.refresh = () => new Promise(resolve => { finish = resolve })
    const refreshing = controller.actions.refresh()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    write({ state: 'error', accounts: [], error: 'Newer state' })
    await vi.waitFor(() => expect(controller.snapshot.getSnapshot().error).toBe('Newer state'))
    finish({ ok: true, value: ready })
    await refreshing
    expect(controller.snapshot.getSnapshot().error).toBe('Newer state')
  })

  it('rejects a failed mutation without inventing an empty successful account pool', async () => {
    const { controller, remote } = bench()
    remote.accountPool.setEnabled = async () => { throw new Error('Write denied') }
    await expect(controller.actions.setEnabled('test.json' as AccountPoolAccountName, false)).rejects.toThrow('Write denied')
    await controller.dispose()
    await expect(controller.actions.refresh()).rejects.toThrow()
  })
})
