/** Credential-free account operation failures encoded through the public Remote error protocol. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { AccountPoolError } from '../account-pool.ts'

/** Account refusal category without private provider response bodies. */
export interface AccountPoolRejectionDetails {
  readonly reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict' | 'failed'
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'account-pool/rejected': AccountPoolRejectionDetails
  }
}

/**
 * Encode expected account errors while withholding unknown transport or credential-file details.
 * @param error - Host operation failure.
 * @returns the stable Remote refusal with a safe diagnostic.
 */
export function accountPoolRemoteError(error: unknown): RemoteError {
  if (error instanceof AccountPoolError) {
    return new RemoteError('account-pool/rejected', error.message, { reason: error.code }, { cause: error })
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new RemoteError('gateway/cancelled', 'The account operation was cancelled.', {}, { cause: error })
  }
  return new RemoteError('gateway/internal', 'The account operation could not be completed.', {}, { cause: error })
}
