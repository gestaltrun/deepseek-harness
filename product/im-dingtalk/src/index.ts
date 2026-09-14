/** Product DingTalk transport exports. */
export { DwsClient } from './client.ts'
export { resolveDingTalkTransportConfig } from './config.ts'
export type { DingTalkTransportConfig, ResolvedDingTalkTransportConfig } from './config.ts'
export { DwsCommandError, DwsProcessRunner } from './process.ts'
export type { DwsCommandOutput, DwsEventStream } from './process.ts'
export {
  DWS_EVENT_ALL_DIRECT,
  DWS_EVENT_ALL_GROUP,
  DWS_EVENT_MENTION,
  DWS_MESSAGE_EVENT_KEYS,
  DWS_MINIMUM_VERSION,
  DwsProtocolError,
  parseAndRequireDwsVersion,
  parseDwsAuthStatus,
  parseDwsConversationPage,
  parseDwsInboundEvent,
  parseDwsProfiles,
  parseDwsSendResult,
} from './protocol.ts'
export type { DwsAuthStatus, DwsConversation, DwsConversationPage, DwsInboundEvent, DwsProfile } from './protocol.ts'
export { apply, apply as default, DingTalkTransport } from './transport.ts'
