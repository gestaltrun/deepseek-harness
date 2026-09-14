import { expect, it } from 'vitest'
import { AccountPoolError } from '../../src/account-pool.ts'
import { accountPoolRemoteError } from '../../src/rpc/errors.ts'
it('preserves typed account refusals and withholds unknown credential-bearing failure details', () => {
  const refusal = accountPoolRemoteError(new AccountPoolError('conflict', 'The model route is already owned.'))
  expect(refusal.code).toBe('account-pool/rejected')
  expect(refusal.details).toEqual({ reason: 'conflict' })
  expect(refusal.message).toContain('already owned')
  const unknown = accountPoolRemoteError(new Error('upstream echoed secret-token-value'))
  expect(unknown.code).toBe('gateway/internal')
  expect(unknown.message).not.toContain('secret-token-value')
  expect(accountPoolRemoteError(new DOMException('cancelled', 'AbortError')).code).toBe('gateway/cancelled')
})
