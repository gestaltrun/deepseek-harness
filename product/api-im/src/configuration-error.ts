/** Preserve stable domain failures without exporting provider exceptions. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ImRuntimeError, ImTransportError } from '@gestaltrun/dsh-im-runtime'
import type {} from './types.ts'

/**
 * Translate documented runtime failures into the product Remote error namespace.
 * @param run - authoritative configuration operation.
 * @returns the operation result; unexpected failures keep Gateway sanitization.
 */
export async function configurationResult<Value>(run: () => Value | Promise<Value>): Promise<Value> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ImRuntimeError || error instanceof ImTransportError) {
      throw new RemoteError('im/configuration', error.message, { code: error.code })
    }
    throw error
  }
}
