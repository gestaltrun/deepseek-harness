/** Generate product reflection with the published compiler and protocol declarations. */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const API_PACKAGE = '@gestaltrun/dsh-api-im'
const PROTOCOL_PACKAGE = '@deepseek-ai/dsh-typert-protocol'
const COMPILER_VERSION = '0.1.5-rc.2'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Emit the IM Host and Remote Client artifacts from unchanged product source.
 * The published compiler requires a packages directory and a registered protocol
 * project; only its private compilation inputs use that layout.
 * @param productRoot - Product workspace containing installed peers and Host references.
 * @returns The package and generated filenames written into its lib directory.
 */
export function generateImTypert(productRoot) {
  const root = resolve(productRoot)
  const config = readJson(join(root, 'tsconfig.host.json'))
  const projects = config.references.map(reference => {
    const configPath = resolve(root, reference.path)
    const directory = dirname(configPath)
    assert.equal(dirname(directory), root, `Product Host reference must name a direct member's config: ${reference.path}`)
    return { configPath, directory, name: readJson(join(directory, 'package.json')).name }
  })
  const api = projects.find(project => project.name === API_PACKAGE)
  assert.ok(api, `Product Host references must include ${API_PACKAGE}`)
  const require = createRequire(join(root, 'package.json'))
  const protocolPath = require.resolve(`${PROTOCOL_PACKAGE}/package.json`)
  const protocol = readJson(protocolPath)
  const compiler = readJson(require.resolve('@deepseek-ai/dsh-typert-generator/package.json'))
  assert.equal(compiler.version, COMPILER_VERSION, 'Product Typert compiler version differs from the reviewed npm release')
  assert.equal(protocol.version, COMPILER_VERSION, 'Product protocol version differs from the reviewed npm release')
  const staging = mkdtempSync(join(tmpdir(), 'dsh-product-typert-'))
  let linked = false
  try {
    const packages = join(staging, 'packages')
    mkdirSync(packages)
    symlinkSync(join(root, 'node_modules'), join(staging, 'node_modules'), 'junction')
    linked = true
    for (const file of readdirSync(root)) {
      if (/^tsconfig(?:\.[\w-]+)?\.json$/u.test(file)) cpSync(join(root, file), join(packages, file))
    }
    for (const project of projects) {
      const destination = join(packages, basename(project.directory))
      mkdirSync(destination)
      cpSync(join(project.directory, 'src'), join(destination, 'src'), { recursive: true })
      cpSync(join(project.directory, 'package.json'), join(destination, 'package.json'))
      for (const file of readdirSync(project.directory)) {
        if (/^tsconfig(?:\.[\w-]+)?\.json$/u.test(file)) cpSync(join(project.directory, file), join(destination, file))
      }
    }
    const protocolRoot = join(packages, '__typert-protocol')
    const declarations = dirname(resolve(dirname(protocolPath), protocol.exports['.'].types))
    mkdirSync(protocolRoot)
    cpSync(declarations, join(protocolRoot, 'src'), { recursive: true })
    const exports = Object.fromEntries(Object.entries(protocol.exports).flatMap(([subpath, value]) => {
      if (typeof value !== 'object' || value === null || typeof value.types !== 'string') return []
      const file = relative(declarations, resolve(dirname(protocolPath), value.types)).split(sep).join('/')
      assert.ok(!file.startsWith('../'), `Protocol declaration export leaves its public declaration directory: ${subpath}`)
      return [[subpath, `./src/${file}`]]
    }))
    writeJson(join(protocolRoot, 'package.json'), { ...protocol, exports })
    writeJson(join(protocolRoot, 'tsconfig.host.json'), { extends: '../tsconfig.base.json', include: ['src/**/*.d.ts'] })
    const basePath = join(packages, 'tsconfig.base.json')
    const base = readJson(basePath)
    base.compilerOptions.paths = {
      ...base.compilerOptions.paths,
      ...Object.fromEntries(Object.entries(exports).map(([subpath, file]) => [
        `${PROTOCOL_PACKAGE}${subpath === '.' ? '' : subpath.slice(1)}`,
        [`./__typert-protocol/${file.slice(2)}`],
      ])),
    }
    writeJson(basePath, base)
    writeJson(join(staging, 'tsconfig.host.json'), {
      extends: './packages/tsconfig.host.json', files: [],
      references: [
        ...projects.map(project => ({ path: `./packages/${relative(root, project.configPath).split(sep).join('/')}` })),
        { path: './packages/__typert-protocol/tsconfig.host.json' },
      ],
    })
    const artifacts = new WorkspaceTypertGenerator(staging).generate([API_PACKAGE], ['host'])
    assert.equal(artifacts.length, 1, `Expected one generated Host artifact for ${API_PACKAGE}`)
    const [artifact] = artifacts
    assert.equal(artifact.package, API_PACKAGE)
    assert.ok(artifact.remote, `Expected generated Remote methods for ${API_PACKAGE}`)
    const files = {
      'typert.host.js': artifact.js,
      'typert.host.d.ts': artifact.dts,
      'typert.remote-client.js': artifact.remote.js,
      'typert.remote-client.d.ts': artifact.remote.dts,
      'typert.remote-client.d.ts.map': artifact.remote.dtsMap,
    }
    const output = join(api.directory, 'lib')
    mkdirSync(output, { recursive: true })
    for (const [file, content] of Object.entries(files)) {
      assert.ok(content.length > 0 && !content.includes(staging) && !content.includes(root), `${file} contains a private compilation path or is empty`)
      writeFileSync(join(output, file), content)
    }
    return { package: API_PACKAGE, files: Object.keys(files) }
  } finally {
    if (linked) unlinkSync(join(staging, 'node_modules'))
    rmSync(staging, { recursive: true, force: true })
  }
}
