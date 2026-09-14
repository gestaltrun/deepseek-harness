/** Static admitted-merchant configuration. */
import { z } from 'zod'

const admittedMerchantSchema = z.object({
  candidateId: z.string().min(1),
  endpoint: z.url(),
  merchantId: z.string().min(1),
  displayName: z.string().min(1),
  mainServiceAccountId: z.string().min(1),
}).strict()

const configSchema = z.object({
  admittedMerchants: z.array(admittedMerchantSchema).min(1),
  pollIntervalMs: z.number().int().positive().default(1_000),
  pollLimit: z.number().int().min(1).max(100).default(50),
  pollWaitSeconds: z.number().int().min(0).max(30).default(15),
}).strict()

/** One merchant identity admitted by deployment configuration. */
export type WangwangAdmittedMerchant = z.infer<typeof admittedMerchantSchema>
/** Wangwang transport deployment configuration. */
export type WangwangTransportConfig = z.input<typeof configSchema>
/** Validated Wangwang transport configuration. */
export type ResolvedWangwangTransportConfig = z.output<typeof configSchema>

/**
 * Validate the admitted catalog and reject ambiguous identities at load.
 * @param input - raw Cordis plugin configuration.
 * @returns validated configuration with explicit polling defaults.
 */
export function resolveWangwangTransportConfig(input: WangwangTransportConfig): ResolvedWangwangTransportConfig {
  const config = configSchema.parse(input)
  const candidateIds = new Set<string>()
  const merchantIds = new Set<string>()
  for (const merchant of config.admittedMerchants) {
    if (candidateIds.has(merchant.candidateId)) throw new TypeError(`Duplicate Wangwang candidate '${merchant.candidateId}'`)
    if (merchantIds.has(merchant.merchantId)) throw new TypeError(`Duplicate Wangwang merchant '${merchant.merchantId}'`)
    candidateIds.add(merchant.candidateId)
    merchantIds.add(merchant.merchantId)
  }
  return config
}
