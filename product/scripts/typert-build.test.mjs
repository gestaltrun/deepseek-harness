/** Exercise product generation against installed public npm declarations. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { generateImTypert } from './typert-build.mjs'

const modules = resolve(import.meta.dirname, '../node_modules')
const packageName = '@gestaltrun/dsh-api-im'
const generatedFiles = [
  'typert.host.js', 'typert.host.d.ts',
  'typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map',
]

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-product-typert-test-'))
  let linked = false
  t.after(async () => {
    if (linked) await unlink(join(root, 'node_modules'))
    await rm(root, { recursive: true, force: true })
  })
  await symlink(modules, join(root, 'node_modules'), 'junction')
  linked = true
  await mkdir(join(root, 'api-im/src'), { recursive: true })
  const json = (file, value) => writeFile(join(root, file), `${JSON.stringify(value, null, 2)}\n`)
  await json('package.json', { name: '@gestaltrun/product-test', private: true, type: 'module' })
  await json('tsconfig.base.json', { compilerOptions: {
    target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, noEmit: true, skipLibCheck: true, types: [],
  } })
  await json('tsconfig.host.json', {
    extends: './tsconfig.base.json', files: [], references: [{ path: './api-im/tsconfig.host.json' }],
  })
  await json('api-im/tsconfig.host.json', { extends: '../tsconfig.base.json', include: ['src/**/*.ts'] })
  await json('api-im/package.json', {
    name: packageName, version: '0.1.0-gestaltrun.0', type: 'module',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
      './remote': { types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' },
    },
    files: ['lib/index.js', 'lib/types', ...generatedFiles.filter(file => !file.endsWith('.map')).map(file => `lib/${file}`)],
  })
  await writeFile(join(root, 'api-im/src/index.ts'), `import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
/** Build-only Remote fixture. */
export class ProbeRemote extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'imProbe') }
  /** Return text. @param text - Input text. @returns The input text. */
  @Remote
  ping(text: string): string { return text }
  /** Stream text. @param text - Input text. @returns One text item. */
  @Remote({ mode: 'stream' })
  async *watch(text: string): AsyncIterable<string> { yield text }
}
`)
  return root
}

test('published Remote declarations produce deterministic strict Host and Client artifacts', async (t) => {
  const roots = [await fixture(t), await fixture(t)]
  const results = roots.map(root => generateImTypert(root))
  assert.deepEqual(results.map(result => result.package), [packageName, packageName])
  for (const file of generatedFiles) {
    const values = await Promise.all(roots.map(root => readFile(join(root, 'api-im/lib', file), 'utf8')))
    assert.equal(values[0], values[1], `${file} changes with the temporary root`)
    for (const root of roots) assert.ok(!values[0].includes(root), `${file} contains an absolute input path`)
    assert.ok(!values[0].includes(modules), `${file} contains an installed dependency path`)
  }
  const host = await import(pathToFileURL(join(roots[0], 'api-im/lib/typert.host.js')).href)
  const client = await import(pathToFileURL(join(roots[0], 'api-im/lib/typert.remote-client.js')).href)
  assert.equal(host.TYPERT.package, packageName)
  assert.deepEqual(host.TYPERT.invocations.map(value => [value.service, value.method]), [
    ['imProbe', 'ping'], ['imProbe', 'watch'],
  ])
  assert.deepEqual(client.TYPERT_REMOTE.descriptors.map(value => value.id), [
    '@gestaltrun/dsh-api-im#imProbe/ping', '@gestaltrun/dsh-api-im#imProbe/watch',
  ])
  for (const invocation of host.TYPERT.invocations) {
    assert.equal(invocation.parameters[0].codec.schema.safeParse('hello').success, true)
    assert.equal(invocation.parameters[0].codec.schema.safeParse(42).success, false)
  }
})

test('a selected API without Remote methods fails instead of emitting an empty contribution', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'api-im/src/index.ts'), 'export const value = 1\n')
  assert.throws(() => generateImTypert(root), /Expected one generated Host artifact/u)
})

test('Remote artifacts require their exact public export declaration', async (t) => {
  const root = await fixture(t)
  const path = join(root, 'api-im/package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.exports['./remote'].default = './lib/incorrect.js'
  await writeFile(path, `${JSON.stringify(manifest)}\n`)
  assert.throws(() => generateImTypert(root), /must export \.\/remote/u)
})
