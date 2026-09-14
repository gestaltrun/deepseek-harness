import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ImTransports, type ImTransport } from '../src/index.ts'

function transport(platform: ImTransport['platform']): ImTransport {
  return {
    platform,
    prepareAccount: async () => ({
      displayName: 'fixture',
      identity: platform === 'dingtalk'
        ? { platform, profile: 'default', corpId: 'corp', userId: 'user', displayName: 'Fixture' }
        : { platform, merchantId: 'merchant', displayName: 'Fixture' },
      authorization: { state: 'unchecked' },
    }),
    discoverConversations: async () => ({ items: [] }),
    listen: async () => async () => {},
    send: async () => ({ state: 'unknown' }),
    confirm: async () => ({ state: 'unknown' }),
  }
}

describe('ImTransports', () => {
  it('owns provider registration with the registering Cordis fiber', async () => {
    const root = new Context()
    const registry = new ImTransports(root)
    const provider = transport('dingtalk')
    const child = root.plugin((ctx) => {
      ctx.imTransports.register(provider)
    })
    await child

    expect(registry.require('dingtalk')).toBe(provider)
    await child.dispose()
    expect(() => registry.require('dingtalk')).toThrowError("IM transport 'dingtalk' is not registered")
  })

  it('rejects a second live provider for the same platform', () => {
    const ctx = new Context()
    const registry = new ImTransports(ctx)
    registry.register(transport('wangwang'))

    expect(() => registry.register(transport('wangwang')))
      .toThrowError("IM transport 'wangwang' is already registered")
  })
})
