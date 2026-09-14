/** Provider-discovered account choices live in the Client object layer. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ImAccountCandidate, ImPlatform } from '../types.ts'

/** Latest discovery for one platform, retaining usable choices during refresh. */
export interface ImAccountCandidateState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly items: readonly ImAccountCandidate[]
  readonly error: string | undefined
}

/** Independent candidate choices for both supported platforms. */
export type ImAccountCandidatesState = Readonly<Record<ImPlatform, ImAccountCandidateState>>

/** Plain snapshot source consumed by the renderer's injected hooks. */
export interface ImAccountCandidatesSource {
  /** @returns identity-stable state until a discovery changes. */
  getSnapshot(): ImAccountCandidatesState
  /** @param listener - observer. @returns the observer disposer. */
  subscribe(listener: () => void): () => void
}

type CandidateResult = RemoteResult<readonly ImAccountCandidate[]>
type CandidateLoader = (platform: ImPlatform, signal: AbortSignal) => Promise<CandidateResult>
const empty = (): ImAccountCandidateState => ({ phase: 'idle', items: [], error: undefined })

/** Owns per-platform request generations and cancellation-safe candidate projection. */
export class ImAccountCandidatesModel implements ImAccountCandidatesSource {
  private state: ImAccountCandidatesState = { dingtalk: empty(), wangwang: empty() }
  private readonly settled: Record<ImPlatform, ImAccountCandidateState> = { ...this.state }
  private readonly attempts = new Map<ImPlatform, AbortController>()
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private notifyPending = false

  /** @param read - generated candidate-discovery operation. */
  constructor(private readonly read: CandidateLoader) {}

  /** @returns the latest per-platform discovery states. */
  readonly getSnapshot = (): ImAccountCandidatesState => this.state

  /** @param listener - state observer. @returns the observer disposer. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.lifetime.signal.aborted) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Refresh one platform; a later request supersedes only that platform.
   * @param platform - provider whose choices are requested.
   * @param signal - requesting UI operation's cancellation.
   * @returns generated result; stale or cancelled responses cannot change the projection.
   */
  async load(platform: ImPlatform, signal?: AbortSignal): Promise<CandidateResult> {
    this.lifetime.signal.throwIfAborted()
    this.attempts.get(platform)?.abort()
    const attempt = new AbortController()
    this.attempts.set(platform, attempt)
    const lifetime = AbortSignal.any([this.lifetime.signal, attempt.signal, ...signal === undefined ? [] : [signal]])
    this.publish(platform, { ...this.settled[platform], phase: 'loading', error: undefined })
    const result = await this.read(platform, lifetime)
    if (this.lifetime.signal.aborted || this.attempts.get(platform) !== attempt) return result
    this.attempts.delete(platform)
    if (lifetime.aborted) {
      this.publish(platform, this.settled[platform])
      return result
    }
    const next: ImAccountCandidateState = result.ok
      ? { phase: 'ready', items: result.value, error: undefined }
      : { phase: 'error', items: this.settled[platform].items, error: result.error.message }
    this.settled[platform] = next
    this.publish(platform, next)
    return result
  }

  /** Cancel discovery and suppress late publication or queued notifications. */
  dispose(): void {
    this.lifetime.abort()
    this.attempts.clear()
    this.listeners.clear()
  }

  private publish(platform: ImPlatform, next: ImAccountCandidateState): void {
    this.state = { ...this.state, [platform]: next }
    if (this.notifyPending) return
    this.notifyPending = true
    queueMicrotask(() => {
      this.notifyPending = false
      if (!this.lifetime.signal.aborted) notifySubscribers(this.listeners, 'IM account candidates')
    })
  }
}
