/** Generate strict product Remote artifacts from equivalent public declarations in an isolated analysis project. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'
import ts from 'typescript'
import { WorkspaceAnalyzer, WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { assertProtocolEquivalent } from './protocol-equivalence.mjs'
import { verifyAccountPoolScope } from '../../../scripts/account-pool-scope.mjs'

const packageRoot = resolve(import.meta.dirname, '..')
const productRoot = resolve(packageRoot, '../..')
const repositoryRoot = resolve(productRoot, '..')
const require = createRequire(join(packageRoot, 'package.json'))
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(packageRoot, 'UPSTREAM.json'), 'utf8'))
const protocolName = '@deepseek-ai/dsh-typert-protocol'
const methods = ['getSnapshot', 'refresh', 'setEnabled', 'deleteAccount', 'startLogin', 'loginStatus',
  'cancelLogin', 'dismissLogin', 'submitCallback', 'submitGlmKey', 'refreshQuota', 'refreshAllQuota',
  'listModels', 'readFields', 'patchFields', 'watch'].sort()

function checkDiagnostics(program, cwd) {
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,
    { getCurrentDirectory: () => cwd, getCanonicalFileName: path => path, getNewLine: () => '\n' }))
}

function assertNormalConfig(face) {
  const path = join(packageRoot, `tsconfig.${face}-build.json`)
  const config = ts.readConfigFile(path, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot, undefined, path)
  assert.equal(parsed.errors.length, 0, 'normal compiler configuration must parse')
  assert.equal(Object.keys(parsed.options.paths ?? {}).length, 0, 'normal compilation cannot map dependency declarations')
  assert.notEqual(parsed.options.skipLibCheck, true, 'normal compilation must check public declarations')
  assert(!parsed.fileNames.some(file => file.includes(`${sep}.build${sep}`) || file.includes('/.build/')), 'analysis files entered normal compilation')
  return config.config
}

verifyAccountPoolScope({ repositoryRoot, base: provenance.harness.scopeBase })
const hostConfig = assertNormalConfig('host')
assertNormalConfig('client')
console.log('account-pool: normal Host TypeScript build against unchanged npm dependencies')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b', 'tsconfig.host-build.json'], { cwd: packageRoot, stdio: 'inherit' })

const cacheParent = join(packageRoot, '.build')
mkdirSync(cacheParent, { recursive: true })
const cache = mkdtempSync(join(cacheParent, 'remote-'))
symlinkSync(join(productRoot, 'node_modules'), join(cache, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const manifestPath = require.resolve(`${protocolName}/package.json`)
const protocol = JSON.parse(readFileSync(manifestPath, 'utf8'))
assert.equal(protocol.version, pkg.peerDependencies[protocolName], 'unreviewed public protocol version')
const dependencyLocation = relative(join(productRoot, 'node_modules'), manifestPath)
assert(!isAbsolute(dependencyLocation) && !dependencyLocation.startsWith('..'), 'protocol must resolve to product npm dependencies')
assert.equal(typeof protocol.exports['.'].types, 'string', 'protocol has no public types entry')
const entry = resolve(dirname(manifestPath), protocol.exports['.'].types)
const bundle = await rolldown({ input: entry,
  external: id => !id.startsWith('.') && !isAbsolute(id),
  plugins: dts({ dtsInput: true, emitDtsOnly: true, tsconfig: false }) })
try { await bundle.write({ file: join(cache, 'protocol.rollup.d.ts'), format: 'es' }) }
finally { await bundle.close() }
writeFileSync(join(cache, 'protocol.ts'), `/// <amd-module name="${protocolName}" />\n` + readFileSync(join(cache, 'protocol.rollup.d.ts'), 'utf8'))
const amd = ts.createProgram([join(cache, 'protocol.ts')], {
  target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.AMD, moduleResolution: ts.ModuleResolutionKind.Node10,
  declaration: true, emitDeclarationOnly: true, strict: true, skipLibCheck: false, types: ['node'],
  outFile: join(cache, 'protocol.ambient.d.ts'), ignoreDeprecations: '6.0',
})
checkDiagnostics(amd, cache)
assert.equal(amd.emit().emitSkipped, false, 'public AMD declaration emit was skipped')
const equivalent = assertProtocolEquivalent(cache, dirname(manifestPath))

// The snapshot contains only this product's source; npm dependencies remain original external inputs.
const analysis = join(cache, 'analysis')
const analysisPackage = join(analysis, 'packages/account-pool')
mkdirSync(analysisPackage, { recursive: true })
symlinkSync(join(productRoot, 'node_modules'), join(analysis, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
cpSync(join(packageRoot, 'src'), join(analysisPackage, 'src'), { recursive: true })
writeFileSync(join(analysisPackage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
cpSync(join(cache, 'protocol.ambient.d.ts'), join(analysisPackage, 'protocol.ambient.d.ts'))
const analysisConfig = structuredClone(hostConfig)
analysisConfig.include.push('protocol.ambient.d.ts')
analysisConfig.compilerOptions.paths = { [protocolName]: ['./protocol.ambient.d.ts'] }
writeFileSync(join(analysisPackage, 'tsconfig.host-build.json'), JSON.stringify(analysisConfig, null, 2) + '\n')
writeFileSync(join(analysis, 'tsconfig.host.json'), JSON.stringify({ files: [], references: [{ path: './packages/account-pool/tsconfig.host-build.json' }] }) + '\n')
writeFileSync(join(analysis, 'package.json'), '{"private":true,"type":"module"}\n')
const model = new WorkspaceAnalyzer({ root: analysis, faces: ['host'], checkDiagnostics: true, mode: 'check' }).analyze()
const owned = model.faces.flatMap(face => face.packages).find(candidate => candidate.name === pkg.name)
assert(owned, 'product was not discovered by the public analyzer')
const emitted = new WorkspaceTypertGenerator(analysis, { checkDiagnostics: true }).generate([pkg.name], ['host'])
assert.equal(emitted.length, 1, 'product must emit exactly one Host contribution')
const artifact = emitted[0]
assert(artifact.remote, 'product Remote generation is empty')
const output = join(analysisPackage, 'lib')
mkdirSync(output, { recursive: true })
const files = {
  'typert.host.js': artifact.js, 'typert.host.d.ts': artifact.dts,
  'typert.remote-client.js': artifact.remote.js, 'typert.remote-client.d.ts': artifact.remote.dts,
  'typert.remote-client.d.ts.map': artifact.remote.dtsMap,
}
for (const [name, content] of Object.entries(files)) writeFileSync(join(output, name), content)
const { TYPERT } = await import(pathToFileURL(join(output, 'typert.host.js')).href)
const { default: REMOTE } = await import(pathToFileURL(join(output, 'typert.remote-client.js')).href)
assert.deepEqual(TYPERT.invocations.map(item => item.method).sort(), methods, 'Host Remote method set differs from the accepted API')
assert.deepEqual(REMOTE.descriptors.map(item => item.method).sort(), methods, 'Client Remote method set differs from the accepted API')
assert(TYPERT.invocations.every(item => item.result.mode === 'strict' && item.parameters.every(parameter => parameter.codec.mode === 'strict')), 'Host codecs must be strict')
assert(REMOTE.descriptors.every(item => item.result.mode === 'strict' && item.parameters.every(parameter => parameter.codec.mode === 'strict')), 'Client codecs must be strict')
mkdirSync(join(packageRoot, 'lib'), { recursive: true })
for (const [name, content] of Object.entries(files)) writeFileSync(join(packageRoot, 'lib', name), content)
const report = { protocol: protocol.version, typescript: ts.version,
  protocolManifestSha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
  publicEntrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'),
  ambientSha256: createHash('sha256').update(readFileSync(join(cache, 'protocol.ambient.d.ts'))).digest('hex'),
  ...equivalent, hostMethods: methods, clientMethods: methods, strictCodecs: true, normalCompilerMappings: false }
writeFileSync(join(cacheParent, 'remote-build.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
