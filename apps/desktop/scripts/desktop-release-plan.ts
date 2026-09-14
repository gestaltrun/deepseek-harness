/** Build the production GitHub Release identity and OSS download links. */

import { writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { prerelease } from 'semver'
import {
  createDesktopUploadPlan,
  type DesktopUploadPlan,
} from './desktop-upload-plan.ts'
import type { DesktopPackageTargetName } from './package-target.ts'

const REQUIRED_TARGETS = ['mac-arm64', 'mac-x64'] as const
const SUPPORTED_TARGETS = new Set<DesktopPackageTargetName>([...REQUIRED_TARGETS, 'win-x64'])

/** One platform download published in a GitHub Release. */
export interface DesktopReleaseDownload {
  readonly target: DesktopPackageTargetName
  readonly label: string
  readonly filename: string
  readonly url: string
}

/** Complete GitHub Release metadata for one validated Desktop version. */
export interface DesktopReleasePlan {
  readonly version: string
  readonly tag: string
  readonly title: string
  readonly prerelease: boolean
  readonly targets: readonly DesktopPackageTargetName[]
  readonly downloads: readonly DesktopReleaseDownload[]
  readonly body: string
}

function downloadLabel(target: DesktopPackageTargetName): string {
  if (target === 'mac-arm64') return 'macOS Apple Silicon'
  if (target === 'mac-x64') return 'macOS Intel'
  return 'Windows x64'
}

function downloadExtension(target: DesktopPackageTargetName): string {
  return target === 'win-x64' ? '.exe' : '.dmg'
}

/**
 * Build one GitHub Release plan from already validated production upload plans.
 * @param uploadPlans - Complete target upload plans for one Desktop version.
 * @returns Deterministic tag, title, bilingual body, and public OSS download links.
 */
export function createDesktopReleasePlan(uploadPlans: readonly DesktopUploadPlan[]): DesktopReleasePlan {
  if (uploadPlans.length === 0) throw new Error('desktop release: at least one upload plan is required')
  const versions = new Set(uploadPlans.map(plan => plan.version))
  if (versions.size !== 1) throw new Error('desktop release: every target must use the same Desktop version')
  const targets = uploadPlans.map(plan => plan.target)
  if (new Set(targets).size !== targets.length) throw new Error('desktop release: target plans must be unique')
  for (const target of REQUIRED_TARGETS) {
    if (!targets.includes(target)) throw new Error(`desktop release: missing required target ${target}`)
  }
  for (const plan of uploadPlans) {
    if (plan.environment !== 'production') {
      throw new Error(`desktop release: ${plan.target} must use the production update deployment`)
    }
  }

  const version = uploadPlans[0]!.version
  const downloads = uploadPlans.map((plan): DesktopReleaseDownload => {
    const extension = downloadExtension(plan.target)
    const artifact = plan.artifacts.find(candidate => candidate.filename.endsWith(extension))
    if (artifact === undefined || artifact.channelMetadata) {
      throw new Error(`desktop release: ${plan.target} has no ${extension} installer`)
    }
    return {
      target: plan.target,
      label: downloadLabel(plan.target),
      filename: basename(artifact.path),
      url: new URL(encodeURIComponent(artifact.filename), plan.publicUrl).href,
    }
  })
  const downloadLines = downloads.map(download => `- ${download.label}: [${download.filename}](${download.url})`)
  const body = [
    '## 下载',
    '',
    ...downloadLines,
    '',
    '安装包与此版本内置的 dsh 使用同一个版本号。',
    '',
    '## Downloads',
    '',
    ...downloadLines,
    '',
    'The installer and its bundled dsh use the same version.',
    '',
  ].join('\n')
  return {
    version,
    tag: `gestalt-v${version}`,
    title: `DeepSeek Gestalt ${version}`,
    prerelease: prerelease(version) !== null,
    targets,
    downloads,
    body,
  }
}

function parseTargets(value: string): DesktopPackageTargetName[] {
  const targets = value.split(',')
  if (targets.some(target => !SUPPORTED_TARGETS.has(target as DesktopPackageTargetName))) {
    throw new Error(`desktop release: unsupported targets ${JSON.stringify(value)}`)
  }
  return targets as DesktopPackageTargetName[]
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'artifacts-root': { type: 'string' },
      targets: { type: 'string', default: REQUIRED_TARGETS.join(',') },
      'output-json': { type: 'string' },
      'output-body': { type: 'string' },
    },
  })
  const artifactsRoot = values['artifacts-root']
  const outputJson = values['output-json']
  const outputBody = values['output-body']
  if (artifactsRoot === undefined || outputJson === undefined || outputBody === undefined) {
    throw new Error('desktop release: --artifacts-root, --output-json, and --output-body are required')
  }
  const targets = parseTargets(values.targets)
  const uploadPlans = await Promise.all(targets.map(async target => await createDesktopUploadPlan(target, {
    artifactsRoot: join(artifactsRoot, target),
  })))
  const plan = createDesktopReleasePlan(uploadPlans)
  await Promise.all([
    writeFile(outputJson, `${JSON.stringify({ ...plan, body: undefined }, null, 2)}\n`),
    writeFile(outputBody, plan.body),
  ])
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
