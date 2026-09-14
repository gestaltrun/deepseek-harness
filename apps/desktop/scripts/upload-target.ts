/** Upload one validated Desktop release to its Alibaba Cloud OSS update directory. */

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import OSS from 'ali-oss'
import type { DesktopPackageTargetName } from './package-target.ts'
import {
  createDesktopUploadPlan,
  type DesktopUploadArtifact,
} from './desktop-upload-plan.ts'

const SUPPORTED_TARGETS = new Set<DesktopPackageTargetName>(['mac-arm64', 'mac-x64', 'win-x64'])
const SUPPORTED_PHASES = new Set<DesktopUploadPhase>(['all', 'immutable', 'channel'])

/** Artifact subset uploaded by one independently retryable publication phase. */
export type DesktopUploadPhase = 'all' | 'immutable' | 'channel'

/** OSS object operations used by the ordered release uploader. */
export interface DesktopOssObjectClient {
  readonly head: (key: string) => Promise<OSS.HeadObjectResult>
  readonly put: (key: string, path: string, options: OSS.PutObjectOptions) => Promise<unknown>
}

function targetName(value: string): DesktopPackageTargetName {
  if (!SUPPORTED_TARGETS.has(value as DesktopPackageTargetName)) {
    throw new Error(`desktop upload: unsupported target ${JSON.stringify(value)}; expected ${[...SUPPORTED_TARGETS].join(', ')}`)
  }
  return value as DesktopPackageTargetName
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`desktop upload: ${name} must be set to a non-empty value`)
  }
  return value
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function errorCode(error: unknown): string | undefined {
  const value = record(error)
  return typeof value.code === 'string' ? value.code : undefined
}

function errorStatus(error: unknown): number | undefined {
  const value = record(error)
  if (typeof value.status === 'number') return value.status
  return typeof value.statusCode === 'number' ? value.statusCode : undefined
}

function isMissingObject(error: unknown): boolean {
  return errorCode(error) === 'NoSuchKey' || errorStatus(error) === 404
}

function isExistingObject(error: unknown): boolean {
  return errorCode(error) === 'FileAlreadyExists' || errorStatus(error) === 409
}

/**
 * Require an existing immutable OSS object to match the validated local artifact.
 * @param artifact - Validated local release artifact.
 * @param result - OSS HEAD response for the same key.
 */
export function assertMatchingImmutableDesktopArtifact(
  artifact: DesktopUploadArtifact,
  result: OSS.HeadObjectResult,
): void {
  const headers = record(result.res.headers)
  const size = Number(headers['content-length'])
  const sha512 = result.meta['dsh-sha512'] ?? headers['x-oss-meta-dsh-sha512']
  if (size !== artifact.size || sha512 !== artifact.sha512) {
    throw new Error(`desktop upload: immutable object ${artifact.key} already exists with different bytes`)
  }
}

/**
 * Select immutable payloads or mutable channel metadata from a validated plan.
 * @param artifacts - Ordered upload artifacts with channel metadata last.
 * @param phase - Independently retryable publication phase.
 * @returns Selected artifacts in their validated order.
 */
export function desktopUploadArtifactsForPhase(
  artifacts: readonly DesktopUploadArtifact[],
  phase: DesktopUploadPhase,
): readonly DesktopUploadArtifact[] {
  if (!SUPPORTED_PHASES.has(phase)) throw new Error(`desktop upload: unsupported phase ${String(phase)}`)
  if (phase === 'all') return artifacts
  const channelMetadata = phase === 'channel'
  return artifacts.filter(artifact => artifact.channelMetadata === channelMetadata)
}

/**
 * Upload or verify one release object without replacing an immutable key.
 * @param client - OSS object operations authenticated by the publish job.
 * @param artifact - Validated local artifact and destination metadata.
 */
export async function uploadDesktopArtifact(
  client: DesktopOssObjectClient,
  artifact: DesktopUploadArtifact,
): Promise<void> {
  if (!artifact.channelMetadata) {
    try {
      assertMatchingImmutableDesktopArtifact(artifact, await client.head(artifact.key))
      process.stdout.write(`desktop upload: retained matching ${artifact.key}\n`)
      return
    } catch (error) {
      if (!isMissingObject(error)) throw error
    }
  }
  const headers = {
    'cache-control': artifact.cacheControl,
    'x-oss-meta-dsh-sha512': artifact.sha512,
    ...(artifact.channelMetadata ? {} : { 'x-oss-forbid-overwrite': 'true' }),
  }
  try {
    await client.put(artifact.key, artifact.path, { mime: artifact.contentType, headers })
  } catch (error) {
    if (artifact.channelMetadata || !isExistingObject(error)) throw error
    assertMatchingImmutableDesktopArtifact(artifact, await client.head(artifact.key))
    process.stdout.write(`desktop upload: retained matching ${artifact.key}\n`)
    return
  }
  if (!artifact.channelMetadata) {
    assertMatchingImmutableDesktopArtifact(artifact, await client.head(artifact.key))
  }
  process.stdout.write(`desktop upload: uploaded ${artifact.key}\n`)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { phase: { type: 'string', default: 'all' } },
  })
  const target = positionals[0]
  if (target === undefined || positionals.length !== 1) {
    throw new Error('desktop upload: expected exactly one target')
  }
  const plan = await createDesktopUploadPlan(targetName(target))
  const phase = values.phase as DesktopUploadPhase
  if (!SUPPORTED_PHASES.has(phase)) {
    throw new Error(`desktop upload: unsupported phase ${JSON.stringify(values.phase)}`)
  }
  const client = new OSS({
    accessKeyId: requiredEnvironmentValue(process.env, 'ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: requiredEnvironmentValue(process.env, 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
    stsToken: requiredEnvironmentValue(process.env, 'ALIBABA_CLOUD_SECURITY_TOKEN'),
    endpoint: plan.endpoint,
    bucket: plan.bucket,
    region: plan.region,
    secure: true,
    authorizationV4: true,
    timeout: plan.timeoutMs,
  })
  process.stdout.write(`desktop upload: ${plan.target} ${plan.version} ${phase} -> ${plan.publicUrl}\n`)
  for (const artifact of desktopUploadArtifactsForPhase(plan.artifacts, phase)) {
    await uploadDesktopArtifact(client, artifact)
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
