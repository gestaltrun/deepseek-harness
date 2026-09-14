import { describe, expect, it } from 'vitest'
import {
  desktopBuildRecordFilename,
  desktopReleaseArtifactBase,
  desktopUpdateMetadataFilename,
  resolveDesktopAutoUpdateConfig,
  resolveDesktopAutoUpdateEnvironment,
  resolveDesktopAutoUpdateTarget,
  resolveDesktopUploadConfig,
} from '../scripts/desktop-auto-update-environment.mjs'

describe('desktop auto-update environment', () => {
  it('defaults packages and uploads to the test deployment', () => {
    expect(resolveDesktopAutoUpdateEnvironment({})).toBe('test')
    expect(resolveDesktopAutoUpdateConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://desktop-updates.example.com/desktop/test/',
    }, 'darwin', 'arm64')).toEqual({
      environment: 'test',
      target: 'mac-arm64',
      feedBaseUrl: 'https://desktop-updates.example.com/desktop/test',
      publicUrl: 'https://desktop-updates.example.com/desktop/test/mac-arm64/',
    })
    expect(resolveDesktopUploadConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://desktop-updates.example.com/desktop/test/',
      DESKTOP_RELEASE_TEST_OSS_PREFIX: '/desktop/test/',
      DESKTOP_RELEASE_OSS_BUCKET: 'desktop-releases',
      DESKTOP_RELEASE_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
      DESKTOP_RELEASE_ALIYUN_REGION: 'cn-hangzhou',
    }, 'darwin', 'arm64')).toMatchObject({
      bucket: 'desktop-releases',
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      region: 'cn-hangzhou',
      keyPrefix: 'desktop/test/mac-arm64',
    })
  })

  it('selects the production URL for packages and bucket for uploads', () => {
    expect(resolveDesktopAutoUpdateConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DESKTOP_RELEASE_PRODUCTION_FEED_URL: 'https://desktop-updates.example.com/desktop/stable',
    }, 'win32', 'x64')).toMatchObject({
      environment: 'production',
      target: 'win-x64',
      publicUrl: 'https://desktop-updates.example.com/desktop/stable/win-x64/',
    })
    expect(resolveDesktopUploadConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DESKTOP_RELEASE_PRODUCTION_FEED_URL: 'https://desktop-updates.example.com/desktop/stable',
      DESKTOP_RELEASE_PRODUCTION_OSS_PREFIX: 'desktop/stable',
      DESKTOP_RELEASE_OSS_BUCKET: 'desktop-releases',
      DESKTOP_RELEASE_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
      DESKTOP_RELEASE_ALIYUN_REGION: 'cn-hangzhou',
    }, 'win32', 'x64')).toMatchObject({
      bucket: 'desktop-releases',
      keyPrefix: 'desktop/stable/win-x64',
    })
  })

  it('requires the selected feed for packages and OSS settings only for uploads', () => {
    expect(() => resolveDesktopAutoUpdateConfig({}, 'darwin', 'arm64'))
      .toThrow(/DESKTOP_RELEASE_TEST_FEED_URL/u)
    expect(resolveDesktopAutoUpdateConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://desktop-updates.example.com/desktop/test',
    }, 'darwin', 'arm64').publicUrl).toContain('/mac-arm64/')
    expect(() => resolveDesktopUploadConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://desktop-updates.example.com/desktop/test',
    }, 'darwin', 'arm64')).toThrow(/DESKTOP_RELEASE_TEST_OSS_PREFIX/u)
    expect(() => resolveDesktopUploadConfig({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DESKTOP_RELEASE_PRODUCTION_FEED_URL: 'https://desktop-updates.example.com/desktop/stable',
      DESKTOP_RELEASE_PRODUCTION_OSS_PREFIX: 'desktop/stable',
    }, 'win32', 'x64')).toThrow(/DESKTOP_RELEASE_OSS_BUCKET/u)
  })

  it('rejects an unsafe feed URL or ambiguous object prefix', () => {
    expect(() => resolveDesktopAutoUpdateConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://user@desktop-updates.example.com/desktop/test',
    }, 'darwin', 'arm64')).toThrow(/without credentials/u)
    expect(() => resolveDesktopAutoUpdateConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'http://desktop-updates.example.com/desktop/test',
    }, 'darwin', 'arm64')).toThrow(/HTTPS URL/u)
    expect(() => resolveDesktopUploadConfig({
      DESKTOP_RELEASE_TEST_FEED_URL: 'https://desktop-updates.example.com/desktop/test',
      DESKTOP_RELEASE_TEST_OSS_PREFIX: 'desktop/../stable',
    }, 'darwin', 'arm64')).toThrow(/OSS object prefix/u)
  })

  it('rejects unknown deployments and targets', () => {
    expect(() => resolveDesktopAutoUpdateEnvironment({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'staging',
    })).toThrow(/test.*production/u)
    expect(() => resolveDesktopAutoUpdateTarget('linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopBuildRecordFilename('linux-x64' as 'mac-arm64')).toThrow(/unsupported target/u)
  })

  it('matches electron-builder channel metadata names to the Desktop version', () => {
    expect(desktopUpdateMetadataFilename('1.2.3', 'darwin')).toBe('latest-mac.yml')
    expect(desktopUpdateMetadataFilename('1.2.3-alpha.4', 'darwin')).toBe('alpha-mac.yml')
    expect(desktopUpdateMetadataFilename('1.2.3-beta.2', 'win32')).toBe('beta.yml')
    expect(() => desktopUpdateMetadataFilename('not-semver', 'darwin')).toThrow(/invalid Desktop version/u)
    expect(() => desktopUpdateMetadataFilename('1.2.3', 'linux')).toThrow(/unsupported metadata platform/u)
  })

  it('uses the Gestalt installer names for every release target', () => {
    expect(desktopReleaseArtifactBase('1.2.3', 'mac-arm64')).toBe('DeepSeek-Gestalt-1.2.3-arm64')
    expect(desktopReleaseArtifactBase('1.2.3', 'mac-x64')).toBe('DeepSeek-Gestalt-1.2.3-x64')
    expect(desktopReleaseArtifactBase('1.2.3', 'win-x64')).toBe('DeepSeekGestalt-Setup-1.2.3-x64')
    expect(() => desktopReleaseArtifactBase('invalid', 'mac-arm64')).toThrow(/invalid Desktop version/u)
  })
})
