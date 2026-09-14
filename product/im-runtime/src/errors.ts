/** Stable IM runtime configuration failure codes. */
export type ImRuntimeErrorCode =
  | 'IM_ACCOUNT_NOT_FOUND'
  | 'IM_ACCOUNT_SETUP_CONFIRMED'
  | 'IM_ACCOUNT_SETUP_NOT_FOUND'
  | 'IM_IDENTITY_MISMATCH'
  | 'IM_DELIVERY_OPERATION_REUSED'
  | 'IM_DELIVERY_SCOPE_INVALID'
  | 'IM_JSONL_INVALID'
  | 'IM_MESSAGE_ALREADY_SUBMITTED'
  | 'IM_MESSAGE_NOT_FOUND'
  | 'IM_OPERATION_REUSED'
  | 'IM_OUTBOUND_ATTEMPT_MISMATCH'
  | 'IM_OUTBOUND_NOT_FOUND'
  | 'IM_OUTBOUND_REQUEST_REUSED'
  | 'IM_OUTBOUND_STATE_INVALID'
  | 'IM_ROUTE_INVALID'
  | 'IM_SESSION_PERSISTENCE_UNAVAILABLE'

/** Structured IM runtime failure for requests that cannot produce a durable receipt. */
export class ImRuntimeError extends Error {
  /** @param code - stable failure code. @param message - diagnostic detail. */
  constructor(readonly code: ImRuntimeErrorCode, message: string) { super(message); this.name = 'ImRuntimeError' }
}
