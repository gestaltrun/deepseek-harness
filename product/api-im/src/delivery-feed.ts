/** Bounded, scope-isolated delivery projections over durable runtime history. */
import { encodeImScopeId, type ImRuntimeService } from '@gestaltrun/dsh-im-runtime'
import type { ImDeliveryFollowFrame, ImDeliveryFollowRequest, ImDeliverySnapshot } from './types.ts'
import { SnapshotFeed } from './snapshot-feed.ts'
import { configurationResult } from './configuration-error.ts'

/** Owns cancellation of all IM conversation readers installed by this BFF. */
export class ImDeliveryFeed {
  private readonly lifetime = new AbortController()

  /** @param runtime - authoritative scope and delivery records. */
  constructor(private readonly runtime: ImRuntimeService) {}

  /**
   * Open one complete conversation window, filtered by the entire scope identity.
   * @param request - real or simulation scope and bounded page size.
   * @param signal - Remote-generation cancellation.
   * @returns baseline followed by complete replacements after matching durable changes.
   */
  follow(request: ImDeliveryFollowRequest, signal: AbortSignal): AsyncIterable<ImDeliveryFollowFrame> {
    const scopeId = encodeImScopeId(request.scope)
    const feed = new SnapshotFeed<ImDeliverySnapshot>({
      snapshot: () => configurationResult(() => ({
        scope: request.scope,
        cursor: this.runtime.getConversationCursor(request.scope),
        inbound: this.runtime.queryHistory({ scope: request.scope, limit: request.limit, ...request.inboundBeforeSequenceNumber === undefined ? {} : { beforeSequenceNumber: request.inboundBeforeSequenceNumber } }),
        outbound: this.runtime.queryOutbound({ scope: request.scope, limit: request.limit, ...request.outboundBeforeSequenceNumber === undefined ? {} : { beforeSequenceNumber: request.outboundBeforeSequenceNumber } }),
      })),
      subscribe: listener => this.runtime.subscribeDelivery(change => { if (change.scopeId === scopeId) listener() }),
    })
    return feed.follow(AbortSignal.any([signal, this.lifetime.signal]))
  }

  /** Close all active Host readers, including readers suspended after yielding a frame. */
  dispose(): void { this.lifetime.abort() }
}
