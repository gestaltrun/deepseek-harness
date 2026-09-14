/** Validate an existing GitHub tag or draft before a Desktop release resumes. */

import { resolve } from 'node:path'

/** Existing GitHub release fields needed before publication resumes. */
export interface ExistingDesktopGitHubRelease {
  readonly draft: boolean
  readonly targetCommitish: string
}

/**
 * Refuse to reuse a tag or release draft owned by another candidate.
 * @param candidateSha - Exact commit selected by the workflow.
 * @param tagSha - Existing lightweight tag target, or an empty string when absent.
 * @param release - Existing release state, or undefined when no draft exists.
 */
export function assertDesktopGitHubReleaseState(
  candidateSha: string,
  tagSha: string,
  release?: ExistingDesktopGitHubRelease,
): void {
  if (!/^[0-9a-f]{40}$/u.test(candidateSha)) throw new Error('desktop release: candidate SHA must contain 40 lowercase hex characters')
  if (tagSha !== '' && tagSha !== candidateSha) {
    throw new Error('desktop release: existing tag does not point to the selected candidate')
  }
  if (release === undefined) return
  if (!release.draft) throw new Error('desktop release: existing GitHub Release is already published')
  if (release.targetCommitish !== candidateSha) {
    throw new Error('desktop release: existing draft does not target the selected candidate')
  }
}

function parseRelease(value: string): ExistingDesktopGitHubRelease | undefined {
  if (value === '') return undefined
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('desktop release: existing release must be a JSON object')
  }
  const release = parsed as Record<string, unknown>
  if (typeof release.draft !== 'boolean' || typeof release.target_commitish !== 'string') {
    throw new Error('desktop release: existing release has invalid fields')
  }
  return { draft: release.draft, targetCommitish: release.target_commitish }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const [candidateSha, tagSha, releaseJson] = process.argv.slice(2)
  if (candidateSha === undefined || tagSha === undefined || releaseJson === undefined) {
    throw new Error('desktop release: expected candidate SHA, existing tag SHA, and existing release JSON')
  }
  assertDesktopGitHubReleaseState(candidateSha, tagSha, parseRelease(releaseJson))
}
