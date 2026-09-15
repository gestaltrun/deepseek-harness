/**
 * Shared fake-transport test machinery. The fake records every request and
 * answers from a scripted table; it is a test double for the trusted
 * transport, never a stand-in for a live CLIProxyAPI service.
 */

import { createQuotaObserver, type QuotaObserver } from '../../src/quota/observer.ts'
import type {
  QuotaObservationTransport,
  QuotaProbeRequest,
  QuotaProbeResponse,
} from '../../src/quota/transport.ts'

export const FIXED_NOW = 1_800_000_000_000

export type ScriptedReply =
  | QuotaProbeResponse
  | ((request: QuotaProbeRequest) => QuotaProbeResponse)

export interface FakeTransport extends QuotaObservationTransport {
  readonly requests: QuotaProbeRequest[]
  readonly script: (request: QuotaProbeRequest) => Promise<QuotaProbeResponse>
}

/** Build a fake transport that routes requests through a caller script. */
export function createFakeTransport(
  script: (request: QuotaProbeRequest) => Promise<QuotaProbeResponse> | QuotaProbeResponse,
): FakeTransport {
  const requests: QuotaProbeRequest[] = []
  return {
    requests,
    script: request => Promise.resolve(script(request)),
    request: (request) => {
      requests.push(request)
      return Promise.resolve(script(request))
    },
  }
}

/** Build a fake transport answering one reply per URL substring, else a 404. */
export function createUrlTableTransport(
  table: Readonly<Record<string, ScriptedReply>>,
): FakeTransport {
  return createFakeTransport((request) => {
    for (const [needle, reply] of Object.entries(table)) {
      if (request.url.includes(needle)) {
        return typeof reply === 'function' ? reply(request) : reply
      }
    }
    return { statusCode: 404, body: { error: 'not found' } }
  })
}

/** Build an observer over the fake transport with a fixed clock. */
export function createTestObserver(transport: FakeTransport): QuotaObserver {
  return createQuotaObserver({ transport, now: () => FIXED_NOW })
}

/** Reply helpers. */
export function jsonReply(body: unknown, statusCode = 200): QuotaProbeResponse {
  return { statusCode, body }
}

export function textReply(bodyText: string, statusCode = 200): QuotaProbeResponse {
  return { statusCode, bodyText }
}

export function transportFailure(error: string): QuotaProbeResponse {
  return { statusCode: 0, error }
}
