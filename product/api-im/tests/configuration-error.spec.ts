import { describe, expect, it } from 'vitest'
import { ImRuntimeError } from '@gestaltrun/dsh-im-runtime'
import { configurationResult } from '../src/configuration-error.ts'

describe('configuration Remote failures', () => {
  it('retains the documented runtime code in a Remote failure', async () => {
    await expect(configurationResult(() => {
      throw new ImRuntimeError('IM_ACCOUNT_NOT_FOUND', 'Account is unavailable')
    })).rejects.toMatchObject({
      code: 'im/configuration', message: 'Account is unavailable', details: { code: 'IM_ACCOUNT_NOT_FOUND' },
    })
  })

  it('leaves unexpected failures to Gateway sanitization', async () => {
    const failure = new Error('Unexpected provider failure')
    await expect(configurationResult(() => { throw failure })).rejects.toBe(failure)
  })
})
