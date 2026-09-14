/** Regression cases for dependency-aware fork check selection. */
import { describe, expect, it } from 'vitest'
import { formatForkCiSummary, planForkCi, type ScopeInput } from './fork-ci-plan.ts'

const ciTests = [
  'scripts/fork-ci-plan.spec.ts', 'scripts/fork-ci-run.spec.ts', 'scripts/fork-ci-workflow.spec.ts',
  'scripts/ci-workflow.spec.ts', 'scripts/ci-compatible-selfhosted.spec.ts',
  'scripts/tests/ci-master-platforms.spec.ts', 'scripts/tests/ci-release-selfhosted.spec.ts',
].sort()

function fixture(changed: string[] = []): ScopeInput {
  const after: Record<string, string> = {
    'packages/util/value/package.json': JSON.stringify({ name: '@test/value' }),
    'packages/core/consumer/package.json': JSON.stringify({ name: '@test/consumer', peerDependencies: { '@test/value': '*' } }),
    'packages/core/other/package.json': JSON.stringify({ name: '@test/other' }),
    'apps/desktop/package.json': JSON.stringify({ name: '@test/desktop' }),
    'apps/desktop-host/package.json': JSON.stringify({ name: '@test/desktop-host' }),
    ...Object.fromEntries(ciTests.map(path => [path, ''])),
    'package.json': JSON.stringify({ scripts: {} }),
  }
  const files = [
    ...Object.keys(after),
    ...['util/value', 'core/consumer', 'core/other'].flatMap(path => [`packages/${path}/src/index.ts`, `packages/${path}/tests/index.spec.ts`]),
    'apps/desktop/tests/package.spec.ts', 'apps/desktop-host/tests/transport.spec.ts',
  ]
  return { changed, files, before: { ...after }, after }
}

function desktopReleaseFixture(changed: string[]): ScopeInput {
  const input = fixture(changed)
  Object.assign(input.after, {
    '.github/workflows/desktop-release.yml': 'name: Desktop Release\n',
    'apps/desktop/tests/desktop-release-workflow.spec.ts': "import { describe } from 'vitest'\nvoid describe\n",
  })
  input.before = { ...input.before, ...input.after }
  input.files.push('.github/workflows/desktop-release.yml', 'apps/desktop/tests/desktop-release-workflow.spec.ts')
  return input
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

  it('runs a changed workflow and its static owner entirely in quality', () => {
    const plan = planForkCi(desktopReleaseFixture([
      '.github/workflows/desktop-release.yml',
      'apps/desktop/tests/desktop-release-workflow.spec.ts',
    ]))
    expect(plan.scripts).toEqual(['apps/desktop/tests/desktop-release-workflow.spec.ts'])
    expect(plan.affectedPackages).toEqual([])
    expect(plan.build).toBe(false)
    expect(plan.jobs).toMatchObject({ quality: true, affected: false, product: false, desktop: false })
    expect(plan.reasons).toContain('static workflow owner: .github/workflows/desktop-release.yml -> apps/desktop/tests/desktop-release-workflow.spec.ts')
  })

  it('keeps Desktop source and shared test fixtures on the package-owned path', () => {
    for (const path of ['apps/desktop/src/main.ts', 'apps/desktop/tests/fixture.ts']) {
      const input = desktopReleaseFixture([path])
      input.files.push(path)
      const plan = planForkCi(input)
      expect(plan.affectedPackages).toEqual(['apps/desktop'])
      expect(plan.jobs.product).toBe(true)
      expect(plan.jobs.desktop).toBe(true)
      expect(plan.scripts).toEqual([])
    }
  })

  it('rejects a mapped static owner that imports package or shared fixture code', () => {
    const input = desktopReleaseFixture(['apps/desktop/tests/desktop-release-workflow.spec.ts'])
    input.after['apps/desktop/tests/desktop-release-workflow.spec.ts'] = "import './fixture.ts'"
    input.files.push('apps/desktop/tests/fixture.ts')
    expect(() => planForkCi(input)).toThrow('must not import local or workspace code: ./fixture.ts')
    input.after['apps/desktop/tests/desktop-release-workflow.spec.ts'] = "import '@test/value/testing'"
    expect(() => planForkCi(input)).toThrow('must not import local or workspace code: @test/value/testing')
  })

  it('fails loud when a retained static workflow loses its owner', () => {
    const input = desktopReleaseFixture(['apps/desktop/tests/desktop-release-workflow.spec.ts'])
    delete input.after['apps/desktop/tests/desktop-release-workflow.spec.ts']
    input.files = input.files.filter(path => path !== 'apps/desktop/tests/desktop-release-workflow.spec.ts')
    expect(() => planForkCi(input)).toThrow('Static workflow ownership must include')
  })

  it('fails loud when a retained static owner loses its workflow', () => {
    const input = desktopReleaseFixture(['.github/workflows/desktop-release.yml'])
    delete input.after['.github/workflows/desktop-release.yml']
    input.files = input.files.filter(path => path !== '.github/workflows/desktop-release.yml')
    expect(() => planForkCi(input)).toThrow('Static workflow ownership must include')
  })

  it('broadens a removed workflow-owner pair through its original owners', () => {
    const input = desktopReleaseFixture([
      '.github/workflows/desktop-release.yml', 'apps/desktop/tests/desktop-release-workflow.spec.ts',
    ])
    delete input.after['.github/workflows/desktop-release.yml']
    delete input.after['apps/desktop/tests/desktop-release-workflow.spec.ts']
    input.files = input.files.filter(file => ![
      '.github/workflows/desktop-release.yml', 'apps/desktop/tests/desktop-release-workflow.spec.ts',
    ].includes(file))
    const plan = planForkCi(input)
    expect(plan.jobs.product).toBe(true)
    expect(plan.jobs.desktop).toBe(true)
    expect(plan.scripts).toEqual(ciTests)
  })

  it('rejects a renamed workflow until the new path has an explicit owner', () => {
    const input = desktopReleaseFixture([
      '.github/workflows/desktop-release.yml', 'apps/desktop/tests/desktop-release-workflow.spec.ts',
      '.github/workflows/renamed.yml', 'apps/desktop/tests/renamed-workflow.spec.ts',
    ])
    delete input.after['.github/workflows/desktop-release.yml']
    delete input.after['apps/desktop/tests/desktop-release-workflow.spec.ts']
    input.files = input.files.filter(file => ![
      '.github/workflows/desktop-release.yml', 'apps/desktop/tests/desktop-release-workflow.spec.ts',
    ].includes(file))
    input.after['.github/workflows/renamed.yml'] = 'name: renamed\n'
    input.after['apps/desktop/tests/renamed-workflow.spec.ts'] = ''
    input.files.push('.github/workflows/renamed.yml', 'apps/desktop/tests/renamed-workflow.spec.ts')
    expect(() => planForkCi(input)).toThrow('No CI owner for .github/workflows/renamed.yml')
  })

  it('rejects a new GitHub workflow without an explicit owner mapping', () => {
    const input = fixture(['.github/workflows/unknown.yml'])
    input.after['.github/workflows/unknown.yml'] = 'name: unknown\n'
    input.files.push('.github/workflows/unknown.yml')
    expect(() => planForkCi(input)).toThrow('add an explicit GitHub policy mapping')
  })

  it('selects the fixed CI regression set when the planner changes', () => {
    const input = fixture(['scripts/fork-ci-plan.ts'])
    input.after['scripts/fork-ci-plan.ts'] = ''
    input.before['scripts/fork-ci-plan.ts'] = ''
    input.files.push('scripts/fork-ci-plan.ts')
    expect(planForkCi(input).scripts).toEqual(ciTests)
  })

  it('summarizes every run and skip without embedding the complete plan', () => {
    const plan = planForkCi(desktopReleaseFixture(['.github/workflows/desktop-release.yml']))
    const summary = formatForkCiSummary({ ...plan, base: 'base', head: 'head', mergeBase: 'merge-base' })
    expect(summary).toContain('- run `quality`')
    expect(summary).toContain('- skip `product`')
    expect(summary).toContain('- skip `desktop`')
    expect(summary).toContain('- run `all checks passed`')
    expect(summary).toContain('complete plan is retained')
    expect(summary).not.toContain('"changed"')
  })

  it('describes docs and shared product checks by the actions they run', () => {
    const docs = planForkCi(fixture(['packages/util/value/README.md']))
    expect(docs.jobReasons.quality).toEqual([
      'diff integrity check', 'documentation checks selected',
    ])
    const shared = planForkCi(fixture(['tsconfig.base.json']))
    expect(shared.jobs.product).toBe(true)
    expect(shared.jobReasons.product).toEqual(['product-owned build, lint, and composition checks selected'])
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
