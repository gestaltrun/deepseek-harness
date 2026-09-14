/** Cordis registry for product IM transport providers. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ImPlatform } from './types.ts'
import type { ImTransport } from './transport.ts'

/** Stable transport registry failure codes. */
export type ImTransportErrorCode = 'IM_TRANSPORT_CONFLICT' | 'IM_TRANSPORT_UNAVAILABLE'
/** Structured transport registry failure. */
export class ImTransportError extends Error {
  /** @param code - stable failure code. @param message - diagnostic detail. */
  constructor(readonly code: ImTransportErrorCode, message: string) { super(message); this.name = 'ImTransportError' }
}

declare module '@deepseek-ai/cordis' { interface Context { imTransports: ImTransports } }

/** Registry whose entries live and die with their registering Cordis fiber. */
export class ImTransports extends Service {
  private readonly providers = new Map<ImPlatform, ImTransport>()
  /** @param ctx - owning Cordis context. */
  constructor(ctx: Context) { super(ctx, 'imTransports') }
  /** @param provider - complete transport capability. @returns disposer that releases the platform reservation. */
  register(provider: ImTransport): () => void {
    if (this.providers.has(provider.platform)) throw new ImTransportError('IM_TRANSPORT_CONFLICT', `IM transport '${provider.platform}' is already registered`)
    const dispose = this.ctx.effect(() => { this.providers.set(provider.platform, provider); return () => { this.providers.delete(provider.platform) } }, `imTransports.register(${provider.platform})`)
    return () => { void dispose() }
  }
  /** @param platform - platform to resolve. @returns the registered provider. */
  require(platform: ImPlatform): ImTransport {
    const provider = this.providers.get(platform)
    if (provider === undefined) throw new ImTransportError('IM_TRANSPORT_UNAVAILABLE', `IM transport '${platform}' is not registered`)
    return provider
  }
}
