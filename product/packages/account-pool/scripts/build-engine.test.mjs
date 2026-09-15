/** Build admission rejects unsupported targets and incomplete source identities before compiler work. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { engineIdentity, engineTarget } from './build-engine.mjs'

test('selects platform filenames and rejects unsupported architectures', () => {
  assert.deepEqual(engineTarget('win32', 'x64'), { goos: 'windows', goarch: 'amd64', filename: 'cli-proxy-api.exe' })
  assert.deepEqual(engineTarget('darwin', 'arm64'), { goos: 'darwin', goarch: 'arm64', filename: 'cli-proxy-api' })
  assert.throws(() => engineTarget('darwin', 'ia32'), /unsupported target/)
})
test('requires complete immutable build identities from the reviewed source', () => {
  const valid = { engine: { repository: 'https://github.com/gestaltrun/CLIProxyAPI.git', submodule: 'community/cliproxyapi', commit: '1d25ceb7f38736880880a5a0d9e08ebb5349d950' }, harness: { scopeBase: '375e2838dec1ff3fba7730256b9bfda2a17c1983' } }
  assert.equal(engineIdentity(valid).commit, valid.engine.commit)
  assert.equal(engineIdentity(valid).submodule, 'community/cliproxyapi')
  assert.throws(() => engineIdentity({ ...valid, engine: { ...valid.engine, commit: 'master' } }), /must pin/)
  assert.throws(() => engineIdentity({ ...valid, engine: { ...valid.engine, repository: 'https://example.test/unreviewed.git' } }), /must pin/)
  assert.throws(() => engineIdentity({ ...valid, engine: { ...valid.engine, submodule: 'community/dsh-web' } }), /must pin/)
})
