import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(join(process.cwd(), '.github/workflows/desktop-release.yml'), 'utf8')

describe('Desktop Release workflow', () => {
  it('is manual-only and keeps publication authority out of packaging jobs', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/mu)
    expect(workflow).not.toMatch(/^  (?:push|pull_request):/mu)
    expect(workflow).toMatch(/publish:[\s\S]*permissions:\n      contents: write\n      id-token: write/u)
    const packaging = workflow.slice(workflow.indexOf('  pack-mac:'), workflow.indexOf('  publish:'))
    expect(packaging).not.toContain('id-token: write')
    expect(packaging).not.toContain('configure-aliyun-credentials-action')
  })

  it('requires merged source for signed candidates and never packages unsigned macOS', () => {
    expect(workflow).toContain('if [[ "$OPERATION" != validate ]]')
    expect(workflow).toContain('git merge-base --is-ancestor "$CANDIDATE_SHA"')
    expect(workflow).not.toContain('--config.mac.identity=null')
    expect(workflow).not.toContain('package:desktop:win:x64:unsigned')
  })

  it('uses the API-key notarization strategy and cleans the temporary key', () => {
    expect(workflow).toContain('APPLE_API_KEY_BASE64')
    expect(workflow).toContain('APPLE_API_KEY_ID')
    expect(workflow).toContain('APPLE_API_ISSUER')
    expect(workflow).not.toContain('APPLE_APP_SPECIFIC_PASSWORD')
    expect(workflow).toContain('rm -f "$APPLE_API_KEY"')
  })

  it('maps only the reviewed package and OSS network timeouts', () => {
    expect(workflow).toContain('PNPM_CONFIG_NETWORK_CONCURRENCY: ${{ vars.DESKTOP_RELEASE_PNPM_NETWORK_CONCURRENCY }}')
    expect(workflow).toContain('PNPM_CONFIG_FETCH_TIMEOUT: ${{ vars.DESKTOP_RELEASE_PNPM_FETCH_TIMEOUT }}')
    expect(workflow).toContain('DESKTOP_RELEASE_OSS_TIMEOUT_MS: ${{ vars.DESKTOP_RELEASE_OSS_TIMEOUT_MS }}')
  })

  it('finishes every selected immutable upload before moving channel metadata', () => {
    const immutable = workflow.indexOf('      - name: Upload immutable installers and blockmaps')
    const channel = workflow.indexOf('      - name: Publish update channel metadata')
    expect(immutable).toBeGreaterThan(0)
    expect(channel).toBeGreaterThan(immutable)
    const immutableStep = workflow.slice(immutable, workflow.indexOf('      - name:', immutable + 20))
    expect(immutableStep).toContain('upload:mac:arm64 -- --phase immutable')
    expect(immutableStep).toContain('upload:mac:x64 -- --phase immutable')
    expect(immutableStep).toContain('upload:win:x64 -- --phase immutable')
  })
})
