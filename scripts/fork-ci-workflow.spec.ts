/** Automatic fork jobs obey the plan and keep exhaustive upstream workflows available manually. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Workflow {
  on: Record<string, unknown>
  permissions: Record<string, string>
  concurrency: { group: string }
  jobs: Record<string, {
    name?: string
    needs?: string | string[]
    if?: string
    uses?: string
    steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown> }>
  }>
}

function workflow(name: string): Workflow {
  return load(readFileSync(resolve(import.meta.dirname, '../.github/workflows', name), 'utf8')) as Workflow
}

describe('fork CI workflow', () => {
  it('always plans every PR without workflow path filters', () => {
    const ci = workflow('fork-ci.yml')
    expect(ci.on.pull_request).toBeNull()
    expect(ci.permissions).toEqual({ contents: 'read' })
    expect(ci.jobs.plan!.if).toBeUndefined()
    expect(JSON.stringify(ci.jobs.plan)).toContain('github.event.pull_request.base.sha')
    expect(JSON.stringify(ci.jobs.plan)).toContain('github.event.pull_request.head.sha')
    expect(ci.jobs.plan!.steps!.find(step => step.uses === 'actions/upload-artifact@v4')?.with).toMatchObject({ 'if-no-files-found': 'error' })
  })

  it('keeps a stable required check that verifies every selected result even after failure', () => {
    const ci = workflow('fork-ci.yml')
    const aggregate = ci.jobs['all-checks-passed']!
    expect(aggregate.name).toBe('all checks passed')
    expect(aggregate.if).toBe('${{ always() }}')
    expect([...(aggregate.needs as string[])].sort()).toEqual(Object.keys(ci.jobs).filter(name => name !== 'all-checks-passed').sort())
    expect(JSON.stringify(aggregate)).toContain('node scripts/fork-ci-run.ts --summary')
    expect(JSON.stringify(aggregate)).toContain('toJSON(needs)')
  })

  it('gates every expensive job on the planner', () => {
    const ci = workflow('fork-ci.yml')
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (['plan', 'all-checks-passed'].includes(name)) continue
      expect(job.needs).toBe('plan')
      expect(job.if).toContain(`fromJSON(needs.plan.outputs.jobs).${name}`)
    }
  })

  it('builds submodule tarballs and verifies real product composition without publishing', () => {
    const job = workflow('fork-ci.yml').jobs.product!
    expect(job.steps?.filter(step => step.run?.startsWith('pnpm run community:')).map(step => step.run))
      .toEqual(['pnpm run community:check', 'pnpm run community:pack', 'pnpm run community:smoke'])
    expect(job.steps!.find(step => step.uses === 'actions/checkout@v6')?.with).toMatchObject({ submodules: 'recursive', 'persist-credentials': false })
    expect(JSON.stringify(job)).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|publish/)
  })

  it.each(['ci.yml', 'ci-master.yml', 'e2e.yml', 'release.yml', 'release-vendor.yml'])('keeps %s exhaustive checks dispatch-only', (name) => {
    expect(Object.keys(workflow(name).on)).toEqual(['workflow_dispatch'])
  })

  it('provides a nonempty archive baseline for manually dispatched official checks', () => {
    expect(JSON.stringify(workflow('ci.yml').jobs['node-24'])).toContain('inputs.base || github.sha')
  })

  it.each(['sandbox.yml', 'node-addon-system.yml'])('calls %s only from an affected plan without a second automatic run', (name) => {
    const ci = workflow(name)
    expect(Object.keys(ci.on).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
    expect(ci.concurrency.group).not.toBe('${{ github.workflow }}-${{ github.ref }}')
  })

  it('does not run all official unit tests during an affected sandbox call', () => {
    const jobs = workflow('sandbox.yml').jobs
    const unit = jobs['sandbox-e2e']!.steps!.find(step => step.run === 'pnpm run test') as { if?: string }
    expect(unit.if).toContain('!inputs.scoped')
  })
})
