import { describe, expect, it } from 'vitest'
import { assertDesktopGitHubReleaseState } from '../scripts/desktop-github-release-state.ts'

const candidate = '0123456789abcdef0123456789abcdef01234567'

describe('Desktop GitHub Release recovery', () => {
  it('accepts an absent release or an exact candidate-owned draft', () => {
    expect(() => { assertDesktopGitHubReleaseState(candidate, '') }).not.toThrow()
    expect(() => { assertDesktopGitHubReleaseState(candidate, candidate, {
      draft: true,
      targetCommitish: candidate,
    }) }).not.toThrow()
  })

  it('rejects another tag target, another draft target, and a published release', () => {
    const other = 'fedcba9876543210fedcba9876543210fedcba98'
    expect(() => { assertDesktopGitHubReleaseState(candidate, other) }).toThrow(/existing tag/u)
    expect(() => { assertDesktopGitHubReleaseState(candidate, '', {
      draft: true,
      targetCommitish: other,
    }) }).toThrow(/existing draft/u)
    expect(() => { assertDesktopGitHubReleaseState(candidate, candidate, {
      draft: false,
      targetCommitish: candidate,
    }) }).toThrow(/already published/u)
  })
})
