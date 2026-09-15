/** Regression cases for dependency-aware fork check selection. */
import { describe, expect, it } from 'vitest'
import { planForkCi, type ScopeInput } from './fork-ci-plan.ts'

function fixture(changed: string[] = []): ScopeInput {
  const after: Record<string, string> = {
    'packages/util/value/package.json': JSON.stringify({ name: '@test/value' }),
    'packages/core/consumer/package.json': JSON.stringify({ name: '@test/consumer', peerDependencies: { '@test/value': '*' } }),
    'packages/core/other/package.json': JSON.stringify({ name: '@test/other' }),
    'apps/desktop/package.json': JSON.stringify({ name: '@test/desktop' }),
    'apps/desktop-host/package.json': JSON.stringify({ name: '@test/desktop-host' }),
    'scripts/fork-ci-plan.spec.ts': '',
    'scripts/fork-ci-run.spec.ts': '',
    'scripts/fork-ci-workflow.spec.ts': '',
    'package.json': JSON.stringify({ scripts: {} }),
  }
  const files = [
    ...Object.keys(after),
    ...['util/value', 'core/consumer', 'core/other'].flatMap(path => [`packages/${path}/src/index.ts`, `packages/${path}/tests/index.spec.ts`]),
    'apps/desktop/tests/package.spec.ts', 'apps/desktop-host/tests/transport.spec.ts',
  ]
  return { changed, files, before: { ...after }, after }
}

describe('fork CI scope', () => {
  it('keeps community pin and configuration changes out of unchanged official suites', () => {
    const plan = planForkCi(fixture(['community/dsh-web', 'community/better-sidebar', 'product/community.json', '.gitmodules']))
    expect(plan.jobs.product).toBe(true)
    expect(plan.affectedPackages).toEqual([])
    expect(plan.unit).toEqual([])
    expect(plan.coverage).toEqual([])
    expect(plan.jobs.provider).toBe(false)
    expect(plan.jobs.python).toBe(false)
  })

  it('selects the changed package and reverse dependency consumers with separate coverage scopes', () => {
    const plan = planForkCi(fixture(['packages/util/value/src/index.ts']))
    expect(plan.affectedPackages).toEqual(['packages/core/consumer', 'packages/util/value'])
    expect(plan.unit).toEqual(['packages/core/consumer/tests/index.spec.ts', 'packages/util/value/tests/index.spec.ts'])
    expect(plan.coverage).toEqual(['packages/core/consumer/src/**/*.{ts,tsx}', 'packages/util/value/src/**/*.{ts,tsx}'])
    expect(plan.affectedPackages).not.toContain('packages/core/other')
  })

  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])('follows %s consumer edges', (section) => {
    const input = fixture(['packages/util/value/src/index.ts'])
    input.after['packages/core/consumer/package.json'] = JSON.stringify({ name: '@test/consumer', [section]: { '@test/value': '*' } })
    input.before = { ...input.after }
    expect(planForkCi(input).affectedPackages).toContain('packages/core/consumer')
  })

  it('preserves before-graph edges when a dependency or package is removed', () => {
    const input = fixture(['packages/util/value/package.json', 'packages/core/consumer/package.json'])
    delete input.after['packages/util/value/package.json']
    input.after['packages/core/consumer/package.json'] = JSON.stringify({ name: '@test/consumer' })
    input.files = input.files.filter(path => !path.startsWith('packages/util/value/'))
    expect(planForkCi(input).affectedPackages).toEqual(['packages/core/consumer', 'packages/util/value'])
  })

  it('checks only Desktop owners and product composition when desktop-host changes', () => {
    const plan = planForkCi(fixture(['apps/desktop-host/config/desktop.cordis.patch.yml']))
    expect(plan.jobs.product).toBe(true)
    expect(plan.jobs.desktop).toBe(true)
    expect(plan.jobs.affected).toBe(false)
    expect(plan.desktop).toEqual(['apps/desktop-host/tests/transport.spec.ts', 'apps/desktop/tests/package.spec.ts'])
    expect(plan.unit).toEqual([])
    expect(plan.snapshots).toEqual([])
    expect(plan.jobs.provider).toBe(false)
  })

  it('does not turn CI-only or community script additions into full official testing', () => {
    const input = fixture(['package.json', '.github/workflows/fork-ci.yml'])
    input.after['package.json'] = JSON.stringify({ scripts: { 'community:pack': 'node scripts/community.mjs pack', 'ci:plan': 'tsx scripts/fork-ci-plan.ts' } })
    const plan = planForkCi(input)
    expect(plan.jobs.product).toBe(true)
    expect(plan.scripts).toContain('scripts/fork-ci-plan.spec.ts')
    expect(plan.affectedPackages).toEqual([])
  })

  it('keeps README changes on documentation checks without running owner behavior tests', () => {
    const plan = planForkCi(fixture(['packages/util/value/README.md']))
    expect(plan.docs).toBe(true)
    expect(plan.unit).toEqual([])
    expect(plan.affectedPackages).toEqual([])
  })

  it('resolves changed lockfile importers without selecting unrelated packages', () => {
    const input = fixture(['pnpm-lock.yaml'])
    input.before['pnpm-lock.yaml'] = 'importers:\n  apps/desktop:\n    dependencies:\n      semver: {specifier: "1", version: "1"}\n'
    input.after['pnpm-lock.yaml'] = 'importers:\n  apps/desktop:\n    dependencies:\n      semver: {specifier: "2", version: "2"}\n'
    const plan = planForkCi(input)
    expect(plan.affectedPackages).toEqual(['apps/desktop'])
    expect(plan.jobs.product).toBe(true)
  })

  it('follows transitive lockfile updates back to external dependency consumers', () => {
    const input = fixture(['pnpm-lock.yaml'])
    input.after['packages/util/value/package.json'] = JSON.stringify({ name: '@test/value', dependencies: { parent: '1' } })
    input.before = { ...input.after }
    input.before['pnpm-lock.yaml'] = 'snapshots:\n  parent@1:\n    dependencies: {child: "1"}\n  child@1: {}\n'
    input.after['pnpm-lock.yaml'] = 'snapshots:\n  parent@1:\n    dependencies: {child: "2"}\n  child@2: {}\n'
    expect(planForkCi(input).affectedPackages).toEqual(['packages/core/consumer', 'packages/util/value'])
  })

  it('keeps another version of a transitive dependency outside the affected set', () => {
    const input = fixture(['pnpm-lock.yaml'])
    input.after['apps/desktop/package.json'] = JSON.stringify({ name: '@test/desktop', devDependencies: { 'ali-oss': '1' } })
    input.after['packages/core/other/package.json'] = JSON.stringify({ name: '@test/other', dependencies: { express: '2' } })
    input.before = { ...input.after }
    input.before['pnpm-lock.yaml'] = [
      'importers:',
      '  apps/desktop: {}',
      '  packages/core/other:',
      '    dependencies:',
      '      express: {specifier: "2", version: "2"}',
      'snapshots:',
      '  express@2:',
      '    dependencies: {statuses: "2"}',
      '  statuses@2: {}',
    ].join('\n')
    input.after['pnpm-lock.yaml'] = [
      'importers:',
      '  apps/desktop:',
      '    devDependencies:',
      '      ali-oss: {specifier: "1", version: "1"}',
      '  packages/core/other:',
      '    dependencies:',
      '      express: {specifier: "2", version: "2"}',
      'snapshots:',
      '  ali-oss@1:',
      '    dependencies: {statuses: "1"}',
      '  express@2:',
      '    dependencies: {statuses: "2"}',
      '  statuses@1: {}',
      '  statuses@2: {}',
    ].join('\n')
    expect(planForkCi(input).affectedPackages).toEqual(['apps/desktop'])
  })

  it('follows an aliased changed snapshot through a peer-qualified parent', () => {
    const input = fixture(['pnpm-lock.yaml'])
    input.after['apps/desktop/package.json'] = JSON.stringify({ name: '@test/desktop', dependencies: { parent: '1' } })
    input.after['packages/core/consumer/package.json'] = JSON.stringify({
      name: '@test/consumer', dependencies: { '@test/desktop': '*' },
    })
    input.before = { ...input.after }
    input.before['pnpm-lock.yaml'] = [
      'snapshots:',
      '  actual@1: {dependencies: {leaf: "1"}}',
      '  leaf@1: {}',
      '  parent@1(peer@2):',
      '    dependencies: {alias: "npm:actual@1"}',
      '  peer@2: {}',
    ].join('\n')
    input.after['pnpm-lock.yaml'] = [
      'snapshots:',
      '  actual@1: {dependencies: {leaf: "2"}}',
      '  leaf@2: {}',
      '  parent@1(peer@2):',
      '    dependencies: {alias: "npm:actual@1"}',
      '  peer@2: {}',
    ].join('\n')
    expect(planForkCi(input).affectedPackages).toEqual(['apps/desktop', 'packages/core/consumer'])
  })

  it('selects consumer tests for a shared script through local import edges', () => {
    const input = fixture(['scripts/helper.ts'])
    Object.assign(input.after, { 'scripts/helper.ts': '', 'scripts/consumer.ts': "import { value } from './helper.ts'", 'scripts/consumer.spec.ts': "import './consumer.ts'" })
    input.files.push('scripts/helper.ts', 'scripts/consumer.ts', 'scripts/consumer.spec.ts')
    expect(planForkCi(input).scripts).toEqual(['scripts/consumer.spec.ts'])
  })

  it('rejects an untested script even when an independent changed script has tests', () => {
    const input = fixture(['scripts/unowned.ts', '.github/workflows/fork-ci.yml'])
    input.files.push('scripts/unowned.ts')
    expect(() => planForkCi(input)).toThrow('No tests selected for script scripts/unowned.ts')
  })

  it('runs the snapshot lane when the corpus manifest changes instead of demanding a spec', () => {
    const input = fixture(['scripts/session-snapshot-corpus.corpus.ts'])
    input.files.push('scripts/session-snapshot-corpus.corpus.ts')
    const plan = planForkCi(input)
    expect(plan.snapshots).toEqual(['scripts/session-snapshot-corpus.corpus.ts'])
    expect(plan.build).toBe(true)
    expect(plan.scripts).toEqual([])
  })

  it('selects subprocess CLI regressions that have no static import of their entry point', () => {
    const input = fixture(['scripts/verify-translation-pairing.ts'])
    input.files.push('scripts/verify-translation-pairing.ts', 'scripts/translation-pairing.spec.ts', 'scripts/git-submodules.spec.ts')
    expect(planForkCi(input).scripts).toEqual(['scripts/git-submodules.spec.ts', 'scripts/translation-pairing.spec.ts'])
    input.files = input.files.filter(path => path !== 'scripts/git-submodules.spec.ts')
    expect(() => planForkCi(input)).toThrow('Missing CLI regression owner')
  })

  it('rejects new unowned implementation directories', () => {
    expect(() => planForkCi(fixture(['new-runtime/src/index.ts']))).toThrow('No CI owner')
  })

  it('checks Desktop packaging and community guards when only a plugin pin changes', () => {
    const input = fixture(['community/dsh-web'])
    input.files.push('scripts/community.spec.ts', 'apps/desktop/tests/main-startup.spec.ts')
    const plan = planForkCi(input)
    expect(plan.scripts).toEqual(['scripts/community.spec.ts'])
    expect(plan.desktop).toEqual(['apps/desktop/tests/package.spec.ts'])
    expect(plan.affectedPackages).toEqual([])
  })

  it('routes kernel sandbox e2e to its platform workflow without a duplicate provider or Windows run', () => {
    const input = fixture(['packages/shell/bash-sandbox/src/index.ts'])
    input.after['packages/shell/bash-sandbox/package.json'] = JSON.stringify({ name: '@test/bash-sandbox' })
    input.files.push('packages/shell/bash-sandbox/package.json', 'packages/shell/bash-sandbox/src/index.ts',
      'packages/shell/bash-sandbox/tests/index.spec.ts', 'packages/shell/bash-sandbox/tests/seatbelt.e2e.ts')
    const plan = planForkCi(input)
    expect(plan.jobs.sandbox).toBe(true)
    expect(plan.jobs.provider).toBe(false)
    expect(plan.jobs.windows).toBe(false)
    expect(plan.e2e).toEqual([])
  })

  it('expands shared compiler changes instead of assuming product-only impact', () => {
    const plan = planForkCi(fixture(['tsconfig.base.json']))
    expect(plan.affectedPackages).toContain('packages/core/other')
    expect(plan.jobs.product).toBe(true)
    expect(plan.build).toBe(true)
  })

  it('selects only Desktop owners when adding its host tests to the compiler include list', () => {
    const input = fixture(['tsconfig.host.json'])
    input.before['tsconfig.host.json'] = '{"compilerOptions":{"strict":true},"include":["scripts/**/*.ts"]}'
    input.after['tsconfig.host.json'] = '{ // owner-local test programs\n"compilerOptions":{"strict":true},"include":["scripts/**/*.ts","apps/desktop-host/tests/**/*.ts"]}'
    const plan = planForkCi(input)
    expect(plan.affectedPackages).toEqual(['apps/desktop', 'apps/desktop-host'])
    expect(plan.jobs.product).toBe(true)
    expect(plan.jobs.desktop).toBe(true)
    expect(plan.unit).toEqual([])
    expect(plan.coverage).toEqual([])
    expect(plan.jobs.python).toBe(false)
  })

  it('still broadens compiler-option changes accompanying a local test include', () => {
    const input = fixture(['tsconfig.host.json'])
    input.before['tsconfig.host.json'] = '{"compilerOptions":{"strict":true},"include":[]}'
    input.after['tsconfig.host.json'] = '{"compilerOptions":{"strict":false},"include":["apps/desktop-host/tests/**/*.ts"]}'
    expect(planForkCi(input).affectedPackages).toContain('packages/core/other')
  })

  it('rejects affected sources when no owning or consumer unit tests exist', () => {
    const input = fixture(['packages/core/other/src/index.ts'])
    input.files = input.files.filter(path => path !== 'packages/core/other/tests/index.spec.ts')
    expect(() => planForkCi(input)).toThrow('Affected package sources have no selected unit tests')
  })
})
