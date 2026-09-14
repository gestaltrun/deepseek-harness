import { describe, expect, it, vi } from 'vitest'
import type { DesktopUploadArtifact } from '../scripts/desktop-upload-plan.ts'
import {
  assertMatchingImmutableDesktopArtifact,
  desktopUploadArtifactsForPhase,
  uploadDesktopArtifact,
  type DesktopOssObjectClient,
} from '../scripts/upload-target.ts'

const immutable = {
  filename: 'app.zip', key: 'desktop/test/mac-arm64/app.zip', size: 42, sha512: 'expected', channelMetadata: false,
} as DesktopUploadArtifact
const channel = {
  filename: 'latest-mac.yml', key: 'desktop/test/mac-arm64/latest-mac.yml', path: '/release/latest-mac.yml',
  size: 12, sha512: 'channel-digest', contentType: 'application/yaml', cacheControl: 'no-cache', channelMetadata: true,
} as DesktopUploadArtifact

function head(size = immutable.size, sha512 = immutable.sha512) {
  return {
    meta: { 'dsh-sha512': sha512 },
    res: { headers: { 'content-length': String(size) } },
  } as never
}

describe('Desktop upload phases', () => {
  it('keeps every immutable payload ahead of mutable channel metadata', () => {
    const artifacts = [immutable, channel]
    expect(desktopUploadArtifactsForPhase(artifacts, 'immutable')).toEqual([immutable])
    expect(desktopUploadArtifactsForPhase(artifacts, 'channel')).toEqual([channel])
    expect(desktopUploadArtifactsForPhase(artifacts, 'all')).toBe(artifacts)
  })

  it('rejects an unsupported publication phase', () => {
    expect(() => desktopUploadArtifactsForPhase([immutable], 'invalid' as 'all'))
      .toThrow(/unsupported phase/u)
  })

  it('reuses only an exact immutable OSS object', () => {
    expect(() => { assertMatchingImmutableDesktopArtifact(immutable, head()) }).not.toThrow()
    expect(() => { assertMatchingImmutableDesktopArtifact(immutable, head(43)) }).toThrow(/different bytes/u)
    expect(() => { assertMatchingImmutableDesktopArtifact(immutable, head(42, 'other')) }).toThrow(/different bytes/u)
  })

  it('forbids replacement, records the digest, and verifies a new immutable object', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'NoSuchKey', status: 404 })
    const client: DesktopOssObjectClient = {
      head: vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(head()),
      put: vi.fn().mockResolvedValue({}),
    }
    await uploadDesktopArtifact(client, {
      ...immutable,
      path: '/release/app.zip',
      contentType: 'application/zip',
      cacheControl: 'public, max-age=31536000, immutable',
    })
    expect(client.head).toHaveBeenCalledTimes(2)
    expect(client.put).toHaveBeenCalledWith(immutable.key, '/release/app.zip', {
      mime: 'application/zip',
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'x-oss-meta-dsh-sha512': immutable.sha512,
        'x-oss-forbid-overwrite': 'true',
      },
    })
  })

  it('reuses matching immutable objects and replaces channel metadata', async () => {
    const immutableClient: DesktopOssObjectClient = {
      head: vi.fn().mockResolvedValue(head()),
      put: vi.fn(),
    }
    await uploadDesktopArtifact(immutableClient, immutable)
    expect(immutableClient.put).not.toHaveBeenCalled()

    const channelClient: DesktopOssObjectClient = {
      head: vi.fn(),
      put: vi.fn().mockResolvedValue({}),
    }
    await uploadDesktopArtifact(channelClient, channel)
    expect(channelClient.head).not.toHaveBeenCalled()
    expect(channelClient.put).toHaveBeenCalledOnce()
    expect(channelClient.put).toHaveBeenCalledWith(channel.key, channel.path, {
      mime: channel.contentType,
      headers: {
        'cache-control': 'no-cache',
        'x-oss-meta-dsh-sha512': channel.sha512,
      },
    })
  })
})
