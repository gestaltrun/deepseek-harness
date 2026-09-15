/** Scope enforcement observes prohibited paths and dependency policies through a real Git diff. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { verifyAccountPoolScope } from './account-pool-scope.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'account-pool-scope-'))
  roots.push(root)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=' + join(root, 'hooks'),
    '-c', 'user.name=Scope Test', '-c', 'user.email=scope@example.test', ...args], { env, encoding: 'utf8' }).trim()
  const write = (file, body) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), body) }
  git('init', '--quiet')
  write('product/package.json', '{"name":"scope-fixture","private":true}\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'baseline')
  return { root, git, write, base: git('rev-parse', 'HEAD') }
}

test('rejects an upstream package addition even when staged with allowed product code', () => {
  const f = fixture()
  f.write('product/packages/account-pool/src/index.ts', 'export const name = "account-pool"\n')
  f.write('packages/llm/llm-pi-ai/src/new.ts', 'export const override = true\n')
  f.git('add', '.')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /packages\/llm\/llm-pi-ai\/src\/new.ts/)
})

test('rejects a protected deletion and both sides of a rename', () => {
  const f = fixture()
  f.write('packages/llm/upstream.ts', 'export {}\n')
  f.git('add', '.')
  f.git('commit', '--quiet', '-m', 'upstream source')
  const base = f.git('rev-parse', 'HEAD')
  f.git('mv', 'packages/llm/upstream.ts', 'product/relocated.ts')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base }), /packages\/llm\/upstream.ts/)
})

test('rejects product postinstall dependency patches', () => {
  const f = fixture()
  f.write('product/package.json', JSON.stringify({ scripts: { postinstall: 'node patch-upstream.mjs' } }))
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /postinstall/)
})

test('rejects private source imports while ignoring import-like fixture strings', () => {
  const f = fixture()
  f.write('product/packages/account-pool/src/index.ts', 'import { x } from "@deepseek-ai/dsh-llm/src/index.ts"\n')
  f.git('add', '.')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /source import/)
  f.write('product/packages/account-pool/src/index.ts', 'export const fixture = \'import x from "@deepseek-ai/dsh-llm/src/index.ts"\'\n')
  assert.doesNotThrow(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }))
})

test('rejects product compiler references into the upstream workspace', () => {
  const f = fixture()
  f.write('product/tsconfig.host.json', JSON.stringify({ references: [{ path: '../packages/llm/llm' }] }))
  f.git('add', '.')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /compiler.*upstream/)
})

test('accepts exact published peers and product-only source', () => {
  const f = fixture()
  f.write('product/packages/account-pool/package.json', JSON.stringify({ peerDependencies: { '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, devDependencies: { '@deepseek-ai/dsh-llm': '0.1.5-rc.2' } }))
  f.write('product/packages/account-pool/src/index.ts', 'import type { LlmAdapter } from "@deepseek-ai/dsh-llm"\nexport type Adapter = LlmAdapter\n')
  f.git('add', '.')
  assert.equal(verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }).paths.length, 2)
})

test('rejects dependency patch and upstream replacement settings in product YAML', () => {
  const f = fixture()
  f.write('product/pnpm-workspace.yaml', 'packages: []\npatchedDependencies:\n  "@deepseek-ai/dsh-llm@0.1.5-rc.2": patches/llm.patch\n')
  f.git('add', '.')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /dependency patches/)
  f.write('product/pnpm-workspace.yaml', 'packages: []\noverrides:\n  "@deepseek-ai/dsh-llm": file:../packages/llm/llm\n')
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /dependency override/)
})

test('rejects non-published dependency paths for an upstream peer', () => {
  const f = fixture()
  f.write('product/package.json', JSON.stringify({ peerDependencies: { '@deepseek-ai/dsh-llm': 'workspace:*' } }))
  assert.throws(() => verifyAccountPoolScope({ repositoryRoot: f.root, base: f.base }), /exact published version/)
})
