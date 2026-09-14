import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { desktopUpdateMetadataFilename } from '../scripts/desktop-auto-update-environment.mjs'
import type { DesktopPackageTargetName } from '../scripts/package-target.ts'

const temporaryDirectories: string[] = []
const TEST_FEED = 'https://desktop-updates.example.com/desktop/test'
const PRODUCTION_FEED = 'https://desktop-updates.example.com/desktop/stable'
const OSS_BUCKET = 'desktop-releases'
const OSS_ENVIRONMENT = {
  DESKTOP_RELEASE_OSS_BUCKET: OSS_BUCKET,
  DESKTOP_RELEASE_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
  DESKTOP_RELEASE_ALIYUN_REGION: 'cn-hangzhou',
  DESKTOP_RELEASE_OSS_TIMEOUT_MS: '600000',
}

interface Fixture {
  readonly repositoryRoot: string
  readonly appRoot: string
  readonly artifactsRoot: string
  readonly environment: NodeJS.ProcessEnv
}

function digest(contents: string): string {
  return createHash('sha512').update(contents).digest('base64')
}

async function fixture(
  target: DesktopPackageTargetName,
  version = '1.2.3',
  environment: 'test' | 'production' = 'test',
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-upload-'))
  temporaryDirectories.push(root)
  const repositoryRoot = join(root, 'repository')
  const appRoot = join(repositoryRoot, 'apps', 'desktop')
  const artifactsRoot = join(appRoot, '.desktop-build', 'artifacts')
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(join(repositoryRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({ version })}\n`)

  const [os, arch] = target.split('-') as ['mac' | 'win', 'arm64' | 'x64']
  const base = os === 'mac'
    ? `DeepSeek-Gestalt-${version}-${arch}`
    : `DeepSeekGestalt-Setup-${version}-${arch}`
  const feed = environment === 'test' ? TEST_FEED : PRODUCTION_FEED
  await writeFile(join(artifactsRoot, `${target}-release.json`), `${JSON.stringify({
    schemaVersion: 1,
    target,
    version,
    environment,
    publicUrl: `${feed}/${target}/`,
  })}\n`)

  if (os === 'mac') {
    const zip = 'signed macOS ZIP fixture'
    await writeFile(join(artifactsRoot, `${base}.zip`), zip)
    await writeFile(join(artifactsRoot, `${base}.zip.blockmap`), 'blockmap')
    await writeFile(join(artifactsRoot, `${base}.dmg`), 'notarized DMG fixture')
    await writeFile(join(artifactsRoot, desktopUpdateMetadataFilename(version, 'darwin')), `${JSON.stringify({
      version,
      files: [{ url: `${base}.zip`, size: Buffer.byteLength(zip), sha512: digest(zip) }],
    })}\n`)
  }
  else {
    const executable = 'signed NSIS executable fixture'
    await writeFile(join(artifactsRoot, `${base}.exe`), executable)
    await writeFile(join(artifactsRoot, desktopUpdateMetadataFilename(version, 'win32')), `${JSON.stringify({
      version,
      files: [{
        url: `${base}.exe`,
        size: Buffer.byteLength(executable),
        sha512: digest(executable),
        blockMapSize: 128,
      }],
    })}\n`)
  }
  return {
    repositoryRoot,
    appRoot,
    artifactsRoot,
    environment: environment === 'test'
      ? {
        ...OSS_ENVIRONMENT,
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        DESKTOP_RELEASE_TEST_FEED_URL: TEST_FEED,
        DESKTOP_RELEASE_TEST_OSS_PREFIX: 'desktop/test',
      }
      : {
        ...OSS_ENVIRONMENT,
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
        DESKTOP_RELEASE_PRODUCTION_FEED_URL: PRODUCTION_FEED,
        DESKTOP_RELEASE_PRODUCTION_OSS_PREFIX: 'desktop/stable',
      },
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => rm(path, {
    recursive: true,
    force: true,
  })))
})

describe('desktop upload plan', () => {
  it('validates macOS artifacts and puts channel metadata last', async () => {
    const paths = await fixture('mac-arm64')
    const plan = await createDesktopUploadPlan('mac-arm64', paths)
    expect(plan).toMatchObject({
      environment: 'test',
      version: '1.2.3',
      publicUrl: 'https://desktop-updates.example.com/desktop/test/mac-arm64/',
      bucket: OSS_BUCKET,
      endpoint: OSS_ENVIRONMENT.DESKTOP_RELEASE_OSS_ENDPOINT,
      region: `oss-${OSS_ENVIRONMENT.DESKTOP_RELEASE_ALIYUN_REGION}`,
      timeoutMs: 600000,
    })
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'DeepSeek-Gestalt-1.2.3-arm64.dmg',
      'DeepSeek-Gestalt-1.2.3-arm64.zip',
      'DeepSeek-Gestalt-1.2.3-arm64.zip.blockmap',
      'latest-mac.yml',
    ])
    expect(plan.artifacts.at(-1)).toMatchObject({
      channelMetadata: true,
      cacheControl: 'no-cache',
    })
  })

  it('uploads the prerelease channel metadata emitted by electron-builder', async () => {
    const paths = await fixture('mac-arm64', '1.2.3-alpha.4')
    const plan = await createDesktopUploadPlan('mac-arm64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'DeepSeek-Gestalt-1.2.3-alpha.4-arm64.dmg',
      'DeepSeek-Gestalt-1.2.3-alpha.4-arm64.zip',
      'DeepSeek-Gestalt-1.2.3-alpha.4-arm64.zip.blockmap',
      'alpha-mac.yml',
    ])
  })

  it('validates the Windows installer with its embedded blockmap and production destination', async () => {
    const paths = await fixture('win-x64', '2.0.0', 'production')
    const plan = await createDesktopUploadPlan('win-x64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'DeepSeekGestalt-Setup-2.0.0-x64.exe',
      'latest.yml',
    ])
    expect(plan).toMatchObject({
      publicUrl: 'https://desktop-updates.example.com/desktop/stable/win-x64/',
      bucket: OSS_BUCKET,
    })
  })

  it('rejects Windows metadata without an embedded blockmap size', async () => {
    const paths = await fixture('win-x64')
    const executable = 'signed NSIS executable fixture'
    await writeFile(join(paths.artifactsRoot, 'latest.yml'), `${JSON.stringify({
      version: '1.2.3',
      files: [{
        url: 'DeepSeekGestalt-Setup-1.2.3-x64.exe',
        size: Buffer.byteLength(executable),
        sha512: digest(executable),
      }],
    })}\n`)
    await expect(createDesktopUploadPlan('win-x64', paths)).rejects.toThrow(/blockMapSize/u)
  })

  it('rejects a completed build from another dsh version or deployment', async () => {
    const paths = await fixture('mac-x64')
    await writeFile(join(paths.repositoryRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await writeFile(join(paths.appRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await expect(createDesktopUploadPlan('mac-x64', paths)).rejects.toThrow(/completion record.*1\.2\.4/u)

    const productionPaths = await fixture('mac-x64', '1.2.3', 'production')
    await expect(createDesktopUploadPlan('mac-x64', {
      ...productionPaths,
      environment: {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        ...OSS_ENVIRONMENT,
        DESKTOP_RELEASE_TEST_FEED_URL: TEST_FEED,
        DESKTOP_RELEASE_TEST_OSS_PREFIX: 'desktop/test',
      },
    })).rejects.toThrow(/completion record.*test/u)
  })

  it('rejects stale architecture metadata and modified updater bytes', async () => {
    const paths = await fixture('mac-arm64')
    const metadataPath = join(paths.artifactsRoot, 'latest-mac.yml')
    const zipPath = join(paths.artifactsRoot, 'DeepSeek-Gestalt-1.2.3-arm64.zip')
    await writeFile(zipPath, 'modified')
    await expect(createDesktopUploadPlan('mac-arm64', paths)).rejects.toThrow(/size.*metadata/u)

    const x64 = 'wrong architecture'
    await writeFile(metadataPath, `${JSON.stringify({
      version: '1.2.3',
      files: [{
        url: 'DeepSeek-Gestalt-1.2.3-x64.zip',
        size: Buffer.byteLength(x64),
        sha512: digest(x64),
      }],
    })}\n`)
    await expect(createDesktopUploadPlan('mac-arm64', paths)).rejects.toThrow(/arm64\.zip/u)
  })
})
