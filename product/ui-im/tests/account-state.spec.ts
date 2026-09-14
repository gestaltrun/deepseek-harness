import { describe, expect, it } from 'vitest'
import type { ImAccountView } from '@gestaltrun/dsh-api-im/client'
import { accountUsable, listenerKey } from '../src/client/accounts.ts'

const account = {
  authorization: { state: 'ready', checkedAt: '2026-09-14T00:00:00Z' },
  connectionIntent: 'connected', paused: true,
  listener: { state: 'stopped', reason: 'account-paused' },
} as ImAccountView

describe('account connection facts', () => {
  it('keeps pause separate from connected, authorized route configuration', () => {
    expect(accountUsable(account)).toBe(true)
  })

  it('excludes manually disconnected accounts even while the listener reports another stopped reason', () => {
    expect(accountUsable({ ...account, connectionIntent: 'disconnected' })).toBe(false)
  })

  it('names an authorization-required listener state explicitly', () => {
    expect(listenerKey({ ...account, listener: { state: 'stopped', reason: 'authorization-required' } })).toBe('authorizationRequired')
  })

  it('excludes connected accounts without verified authorization', () => {
    expect(accountUsable({ ...account, authorization: { state: 'unchecked' } })).toBe(false)
  })
})
