/** Stable IM runtime configuration failure codes. */
export type ImRuntimeErrorCode =
  | 'IM_ACCOUNT_NOT_FOUND'
  | 'IM_IDENTITY_MISMATCH'
  | 'IM_OPERATION_REUSED'
  | 'IM_ROUTE_INVALID'

/** Structured IM runtime failure for requests that cannot produce a durable receipt. */
export class ImRuntimeError extends Error {
  /** @param code - stable failure code. @param message - diagnostic detail. */
  constructor(readonly code: ImRuntimeErrorCode, message: string) { super(message); this.name = 'ImRuntimeError' }
}
