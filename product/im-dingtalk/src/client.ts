/** Public DWS commands used by the DingTalk transport. */
import type { ImTransportSendResult } from '@gestaltrun/dsh-im-runtime'
import type { DwsEventStream, DwsProcessRunner } from './process.ts'
import {
  DWS_MESSAGE_EVENT_KEYS,
  DwsProtocolError,
  parseAndRequireDwsVersion,
  parseDwsAuthStatus,
  parseDwsConversationPage,
  parseDwsProfiles,
  parseDwsSendResult,
} from './protocol.ts'
import type { DwsAuthStatus, DwsConversationPage, DwsProfile } from './protocol.ts'

function requireHelp(text: string, command: string): void {
  if (!text.includes(command)) throw new DwsProtocolError('DINGTALK_DWS_CAPABILITY_MISSING', `Installed DWS does not publish ${command}`)
}

/** DWS command client that pins every identity-sensitive call to one exact profile. */
export class DwsClient {
  private capability: Promise<void> | undefined

  /** @param runner - managed command and stream process runner. @param now - authorization clock. */
  constructor(private readonly runner: DwsProcessRunner, private readonly now: () => number = Date.now) {}

  /**
   * Prove the installed CLI version and reviewed public leaves once per provider instance.
   * @param signal - caller cancellation.
   */
  async ensureCapabilities(signal: AbortSignal): Promise<void> {
    this.capability ??= this.probe(signal).catch((error: unknown) => { this.capability = undefined; throw error })
    return this.capability
  }

  private async probe(signal: AbortSignal): Promise<void> {
    parseAndRequireDwsVersion((await this.runner.run(['--version'], signal)).stdout)
    const commands: readonly [readonly string[], string][] = [
      [['event', '+listen-im', '--help'], '+listen-im'],
      [['event', 'consume', '--help'], 'event consume'],
      [['chat', '+conversation-list', '--help'], '+conversation-list'],
      [['chat', 'message', 'send', '--help'], 'message send'],
      [['chat', 'message', 'query-send-status', '--help'], 'query-send-status'],
    ]
    for (const [args, marker] of commands) requireHelp((await this.runner.run(args, signal)).stdout, marker)
  }

  /** @param signal - caller cancellation. @returns all independently addressed installed profiles. */
  async listProfiles(signal: AbortSignal): Promise<readonly DwsProfile[]> {
    await this.ensureCapabilities(signal)
    return parseDwsProfiles((await this.runner.run(['profile', 'list', '--format', 'json'], signal)).stdout)
  }

  /**
   * Refresh and inspect one exact profile without changing DWS's current profile.
   * @param profile - stable corpId:userId selector.
   * @param signal - caller cancellation.
   * @returns refreshed authorization and identity facts.
   */
  async refresh(profile: string, signal: AbortSignal): Promise<DwsAuthStatus> {
    await this.ensureCapabilities(signal)
    const output = await this.runner.run(['auth', 'status', '--profile', profile, '--format', 'json'], signal)
    return parseDwsAuthStatus(output.stdout, new Date(this.now()).toISOString())
  }

  /**
   * Read one strict conversation page for an exact employee profile.
   * @param profile - stable corpId:userId selector.
   * @param limit - provider page size.
   * @param cursor - optional integer continuation.
   * @param signal - caller cancellation.
   * @returns platform conversation identifiers and continuation.
   */
  async conversations(profile: string, limit: number, cursor: string | undefined, signal: AbortSignal): Promise<DwsConversationPage> {
    await this.ensureCapabilities(signal)
    const args = ['chat', '+conversation-list', '--limit', String(limit)]
    if (cursor !== undefined) args.push('--cursor', cursor)
    args.push('--format', 'json', '--profile', profile)
    return parseDwsConversationPage((await this.runner.run(args, signal)).stdout)
  }

  /**
   * Start one DWS lifecycle that covers mentions, all direct messages, and all group messages.
   * @param profile - stable corpId:userId selector.
   * @param signal - account listener lifetime.
   * @param onLine - sequential flattened NDJSON handler.
   * @returns explicit DWS readiness and managed teardown.
   */
  async listen(profile: string, signal: AbortSignal, onLine: (line: string) => Promise<void>): Promise<DwsEventStream> {
    await this.ensureCapabilities(signal)
    return this.runner.stream([
      'event', 'consume', ...DWS_MESSAGE_EVENT_KEYS,
      '--flatten', '--format', 'ndjson', '--profile', profile,
    ], signal, onLine)
  }

  /**
   * Submit one text message with the caller's idempotency key.
   * @param profile - stable corpId:userId selector.
   * @param target - group conversation ID or one direct peer identifier published by DWS.
   * @param text - exact outbound text.
   * @param requestId - stable send intent.
   * @param signal - caller cancellation.
   * @returns definite facts or an asynchronous unknown receipt.
   */
  async send(
    profile: string,
    target: { readonly kind: 'group'; readonly conversationId: string }
      | { readonly kind: 'direct-open'; readonly openDingTalkId: string }
      | { readonly kind: 'direct-user'; readonly userId: string },
    text: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<ImTransportSendResult> {
    await this.ensureCapabilities(signal)
    const args = ['chat', 'message', 'send']
    if (target.kind === 'group') args.push('--conversation-id', target.conversationId)
    else if (target.kind === 'direct-open') args.push('--open-dingtalk-id', target.openDingTalkId)
    else args.push('--user', target.userId)
    args.push('--content', text, '--idempotency-key', requestId, '--ai-tag=true', '--format', 'json', '--profile', profile)
    return parseDwsSendResult((await this.runner.run(args, signal)).stdout)
  }

  /**
   * Query one uncertain DWS send task under the same exact employee profile.
   * @param profile - stable corpId:userId selector.
   * @param taskId - openTaskId returned by the send command.
   * @param signal - caller cancellation.
   * @returns current definite or unknown provider status.
   */
  async confirm(profile: string, taskId: string, signal: AbortSignal): Promise<ImTransportSendResult> {
    await this.ensureCapabilities(signal)
    const args = ['chat', 'message', 'query-send-status', '--open-task-id', taskId, '--format', 'json', '--profile', profile]
    return parseDwsSendResult((await this.runner.run(args, signal)).stdout)
  }
}
