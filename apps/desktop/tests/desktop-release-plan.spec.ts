import { describe, expect, it } from 'vitest'
import type { DesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { createDesktopReleasePlan } from '../scripts/desktop-release-plan.ts'

function uploadPlan(target: DesktopUploadPlan['target'], version = '1.2.3'): DesktopUploadPlan {
  const windows = target === 'win-x64'
  const filename = windows
    ? `DeepSeekGestalt-Setup-${version}-x64.exe`
    : `DeepSeek-Gestalt-${version}-${target === 'mac-arm64' ? 'arm64' : 'x64'}.dmg`
  return {
    environment: 'production',
    target,
    version,
    publicUrl: `https://updates.example.com/desktop/stable/${target}/`,
    bucket: 'desktop-releases',
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    region: 'oss-cn-hangzhou',
    artifacts: [{
      path: `/artifacts/${filename}`,
      filename,
      key: `desktop/stable/${target}/${filename}`,
      size: 123,
      sha512: 'fixture-sha512',
      contentType: windows ? 'application/vnd.microsoft.portable-executable' : 'application/x-apple-diskimage',
      cacheControl: 'public, max-age=31536000, immutable',
      channelMetadata: false,
    }],
  }
}

describe('Desktop GitHub Release plan', () => {
  it('renders the required Mac downloads and optional signed Windows target', () => {
    const plan = createDesktopReleasePlan([
      uploadPlan('mac-arm64'),
      uploadPlan('mac-x64'),
      uploadPlan('win-x64'),
    ])
    expect(plan).toMatchObject({
      version: '1.2.3',
      tag: 'gestalt-v1.2.3',
      title: 'DeepSeek Gestalt 1.2.3',
      prerelease: false,
      targets: ['mac-arm64', 'mac-x64', 'win-x64'],
    })
    expect(plan.body).toContain('DeepSeek-Gestalt-1.2.3-arm64.dmg')
    expect(plan.body).toContain('DeepSeekGestalt-Setup-1.2.3-x64.exe')
    expect(plan.body).toContain('https://updates.example.com/desktop/stable/mac-x64/')
  })

  it('marks semantic prereleases for GitHub without changing their tag', () => {
    const plan = createDesktopReleasePlan([
      uploadPlan('mac-arm64', '1.2.3-rc.2'),
      uploadPlan('mac-x64', '1.2.3-rc.2'),
    ])
    expect(plan).toMatchObject({ tag: 'gestalt-v1.2.3-rc.2', prerelease: true })
  })

  it('rejects test feeds, mismatched versions, missing Mac targets, and duplicate targets', () => {
    const test = { ...uploadPlan('mac-arm64'), environment: 'test' as const }
    expect(() => createDesktopReleasePlan([test, uploadPlan('mac-x64')])).toThrow(/production/u)
    expect(() => createDesktopReleasePlan([
      uploadPlan('mac-arm64'), uploadPlan('mac-x64', '1.2.4'),
    ])).toThrow(/same Desktop version/u)
    expect(() => createDesktopReleasePlan([uploadPlan('mac-arm64')])).toThrow(/missing required target mac-x64/u)
    expect(() => createDesktopReleasePlan([
      uploadPlan('mac-arm64'), uploadPlan('mac-x64'), uploadPlan('mac-x64'),
    ])).toThrow(/unique/u)
  })
})
