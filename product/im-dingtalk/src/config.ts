/** Deployment settings for the installed DWS command transport. */
import { homedir } from 'node:os'
import { z } from 'zod'

const configSchema = z.object({
  dwsPath: z.string().min(1).default('dws'),
  home: z.string().min(1).default(homedir()),
  cwd: z.string().min(1).default(process.cwd()),
  graceMs: z.number().int().positive().max(60_000).default(5_000),
  commandTimeoutMs: z.number().int().positive().max(120_000).default(15_000),
  readinessTimeoutMs: z.number().int().positive().max(120_000).default(30_000),
  maxOutputBytes: z.number().int().positive().max(16 * 1024 * 1024).default(1024 * 1024),
  maxLineBytes: z.number().int().positive().max(16 * 1024 * 1024).default(1024 * 1024),
  conversationPageSize: z.number().int().min(1).max(100).default(100),
}).strict()

/** Raw DingTalk transport plugin configuration. */
export type DingTalkTransportConfig = z.input<typeof configSchema>
/** Validated DingTalk transport plugin configuration. */
export type ResolvedDingTalkTransportConfig = z.output<typeof configSchema>

/**
 * Validate DingTalk transport configuration.
 * @param input - raw Cordis plugin configuration.
 * @returns settings with explicit process and output limits.
 */
export function resolveDingTalkTransportConfig(input: DingTalkTransportConfig = {}): ResolvedDingTalkTransportConfig {
  return configSchema.parse(input)
}
