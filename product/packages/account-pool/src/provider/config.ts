/** Product-owned deployment policy and installed engine provenance resolution. */
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'

/** Validated policy for one isolated embedded account pool. */
export interface Config {
  readonly stateRoot: string
  readonly resourceDirectory?: string
  readonly startupTimeoutMs: number
  readonly restartLimit: number
  readonly stopGraceMs: number
  readonly readinessIntervalMs: number
  readonly requestTimeoutMs: number
  readonly maxResponseBytes: number
  readonly catalogRefreshIntervalMs: number
  readonly quotaConcurrency: number
  readonly streamIdleTimeoutMs: number
  readonly maxRequestImageBytes: number
  readonly requestImagePixelBudget: number
  readonly requestImageMaxBytes: number
  readonly maxRetries: number
  readonly requestTokenBudget: number
  readonly unknownContextBudget: number
  readonly allowCredentialExport: boolean
}

const duration = (): Schema<number> => Schema.natural().min(1).max(2_147_483_647)

/** Validate product policy; resolved values also drive the public PiAi profile. */
export const Config: Schema<Config> = Schema.object({
  stateRoot: Schema.string().required(),
  resourceDirectory: Schema.string(),
  startupTimeoutMs: duration().default(15000),
  restartLimit: Schema.natural().default(2),
  stopGraceMs: duration().default(2000),
  readinessIntervalMs: duration().default(50),
  requestTimeoutMs: duration().default(15000),
  maxResponseBytes: Schema.natural().min(1).default(1048576),
  catalogRefreshIntervalMs: duration().default(2000),
  quotaConcurrency: Schema.natural().min(1).default(4),
  streamIdleTimeoutMs: duration().default(120000),
  maxRequestImageBytes: Schema.natural().min(1).default(20 * 1024 * 1024),
  requestImagePixelBudget: Schema.natural().min(1).default(2048 * 2048),
  requestImageMaxBytes: Schema.natural().min(1).default(5 * 1024 * 1024),
  maxRetries: Schema.natural().default(2),
  requestTokenBudget: Schema.natural().min(1).default(16384),
  unknownContextBudget: Schema.natural().min(1).default(131072),
  allowCredentialExport: Schema.boolean().required(),
})

/** Fully resolved instance paths and exact engine identity. */
export interface Spec extends Omit<Config, 'resourceDirectory'> {
  readonly resourceDirectory: string
  readonly expectedSourceSHA: string
}

/**
 * Resolve installed resources before starting work; no PATH lookup or downloads occur.
 * @param config - validated product deployment choices.
 * @returns explicit supervisor inputs tied to the installed product provenance.
 */
export async function resolve(config: Config): Promise<Spec> {
  if (!isAbsolute(config.stateRoot)) throw new Error('Account pool stateRoot must be absolute.')
  const packageRoot = new URL('./', import.meta.resolve('@gestaltrun/dsh-account-pool/package.json'))
  const resourceDirectory = config.resourceDirectory
    ?? fileURLToPath(new URL(`resources/cliproxyapi/${process.platform}-${process.arch}/`, packageRoot))
  if (!isAbsolute(resourceDirectory)) throw new Error('Account pool resourceDirectory must be absolute.')
  const provenance = z.object({ engine: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/u) }) })
    .parse(JSON.parse(await readFile(new URL('UPSTREAM.json', packageRoot), 'utf8')) as unknown)
  return { ...config, resourceDirectory, expectedSourceSHA: provenance.engine.commit }
}
