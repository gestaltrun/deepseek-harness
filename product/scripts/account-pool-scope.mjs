/** Enforce the accepted product-only account-pool change scope before building or publishing. */
import { execFileSync } from 'node:child_process'
import { resolve, relative, dirname, sep } from 'node:path'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import yaml from 'js-yaml'

const desktopFiles = new Set([
  'apps/desktop/src/product-profile.ts',
  'apps/desktop/scripts/product-artifacts.ts',
  'apps/desktop/tests/product-profile.spec.ts',
  'apps/desktop/tests/product-artifacts.spec.ts',
  'apps/desktop/src/locale.ts',
  'apps/desktop/src/main.ts',
  'apps/desktop/tests/main-startup.spec.ts',
  'apps/desktop/README.md',
  'apps/desktop/README.zh.md',
  'apps/desktop/README.i18n.yaml',
])
const planning = [
  '.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool',
  '.agents/notes/proposed/architecture/2026-09-15-account-pool-engine-owned-glm',
  '.agents/notes/proposed/simplification/2026-09-15-account-pool-reuse-quota-observer',
  '.agents/notes/implemented/bug-fix/2026-09-15-account-pool-host-authorization-open',
  'docs/scratch/2026-09-14-account-pool-migration',
]

function leavesProduct(root, path) {
  const target = relative(resolve(root, 'product'), resolve(path))
  return target === '..' || target.startsWith('..' + sep)
}

function dependencyPolicy(value, path, errors) {
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, 'patchedDependencies') || Object.hasOwn(value.pnpm ?? {}, 'patchedDependencies')) {
    errors.push(`dependency patches are prohibited: ${path}`)
  }
  for (const overrides of [value.overrides, value.pnpm?.overrides]) {
    for (const [name, spec] of Object.entries(overrides ?? {})) {
      if (/^@(?:deepseek-ai|earendil-works)\//u.test(name) || /(?:file:|link:|workspace:|node_modules|\/src\/)/u.test(String(spec))) {
        errors.push(`upstream dependency override is prohibited: ${path}: ${name}`)
      }
    }
  }
  if (Object.hasOwn(value.scripts ?? {}, 'postinstall')) errors.push(`product postinstall is prohibited: ${path}`)
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(value[section] ?? {})) {
      if (/^@(?:deepseek-ai|earendil-works)\//u.test(name) && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(String(spec))) {
        errors.push(`upstream dependency must use an exact published version: ${path}: ${name}`)
      }
      if (/^(?:file|link|workspace):/u.test(String(spec)) && /^@deepseek-ai\//u.test(name)) {
        errors.push(`upstream source dependency is prohibited: ${path}: ${name}`)
      }
    }
  }
}

function inspectSource(root, path, content, errors) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const inspect = (node) => {
    let target
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      target = node.moduleSpecifier.text
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      target = node.arguments[0].text
    }
    if (target !== undefined) {
      if (/^@(?:deepseek-ai|earendil-works)\/.*\/src(?:\/|$)/u.test(target) || target.includes('node_modules/')) {
        errors.push(`upstream source import is prohibited: ${path}: ${target}`)
      }
      if (target.startsWith('.') && leavesProduct(root, resolve(dirname(resolve(root, path)), target))) {
        errors.push(`source import leaves product: ${path}: ${target}`)
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
}

function inspectProductFile(root, path, errors) {
  const absolute = resolve(root, path)
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) return
  const content = readFileSync(absolute, 'utf8')
  if (path.endsWith('package.json')) dependencyPolicy(JSON.parse(content), path, errors)
  if (path.endsWith('pnpm-workspace.yaml')) dependencyPolicy(yaml.load(content), path, errors)
  if (/\/tsconfig[^/]*\.json$/u.test(path)) {
    const parsed = ts.parseConfigFileTextToJson(path, content)
    if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'))
    const config = parsed.config
    for (const target of [config.extends, config.compilerOptions?.baseUrl, ...(config.references ?? []).map(item => item.path)].filter(Boolean)) {
      if (typeof target === 'string' && target.startsWith('.') && leavesProduct(root, resolve(dirname(absolute), target))) {
        errors.push(`compiler configuration references upstream source: ${path}: ${target}`)
      }
    }
    for (const [name, targets] of Object.entries(config.compilerOptions?.paths ?? {})) {
      if (/^@(?:deepseek-ai|earendil-works)\//u.test(name) || targets.some(target => leavesProduct(root, resolve(dirname(absolute), target)))) {
        errors.push(`compiler paths reference upstream source: ${path}: ${name}`)
      }
    }
  }
  if (/\.[cm]?[jt]sx?$/u.test(path)) inspectSource(root, path, content, errors)
}

/**
 * Reject tracked changes outside the approved product scope.
 * @param {{repositoryRoot: string, base: string}} options - Checkout and explicitly verified comparison revision.
 * @returns {{base: string, paths: string[]}} Accepted revision and complete tracked change inventory.
 */
export function verifyAccountPoolScope({ repositoryRoot, base }) {
  const root = resolve(repositoryRoot)
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const revision = git('rev-parse', '--verify', `${base}^{commit}`)
  // Disabling rename detection retains both the removed and added pathname.
  const paths = git('diff', '--name-only', '--no-renames', revision).split('\n').filter(Boolean)
  const errors = []
  for (const path of paths) {
    const allowed = path.startsWith('product/') || path === '.gitmodules' || path === 'community/cliproxyapi'
      || desktopFiles.has(path)
      || planning.some(stem => ['.md', '.zh.md', '.i18n.yaml'].some(suffix => path === stem + suffix))
    if (!allowed) errors.push(`outside product scope: ${path}`)
    if (path.startsWith('product/')) inspectProductFile(root, path, errors)
    const absolute = resolve(root, path)
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
      const target = relative(resolve(root, 'product'), realpathSync(absolute))
      if (target.startsWith('..' + sep) || target === '..') errors.push(`product symlink leaves product: ${path}`)
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return { base: revision, paths }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  const policy = JSON.parse(readFileSync(new URL('../packages/account-pool/UPSTREAM.json', import.meta.url), 'utf8'))
  const base = values.base ?? policy.harness.scopeBase
  if (typeof base !== 'string') throw new Error('account-pool scope: pass --base with the verified base revision')
  const result = verifyAccountPoolScope({ repositoryRoot: resolve(import.meta.dirname, '../..'), base })
  console.log(`account-pool scope: ${result.paths.length} tracked path(s) allowed against ${result.base}`)
}
