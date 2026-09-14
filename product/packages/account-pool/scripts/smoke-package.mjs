/** Verify a real product tarball in an independent npm project with normal public imports. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const archive = resolve(packageRoot, '../../dist', `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`)
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean)
if (listing.some(file => /(?:^|\/)(?:\.build|node_modules)(?:\/|$)/u.test(file) || file.includes('protocol.ambient'))) {
  throw new Error('account-pool archive contains analysis inputs or installed dependencies')
}
const directory = mkdtempSync(join(tmpdir(), 'dsh-account-pool-package-'))
copyFileSync(archive, join(directory, 'candidate.tgz'))
writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'account-pool-installed-check', private: true, type: 'module',
  dependencies: { [pkg.name]: 'file:./candidate.tgz' },
  devDependencies: { typescript: '6.0.3', '@types/node': '22.20.0', '@types/react': '18.3.31', '@types/react-dom': '18.3.7' },
}, null, 2) + '\n')
writeFileSync(join(directory, 'pnpm-workspace.yaml'), `packages: []\nnodeLinker: hoisted\nautoInstallPeers: true\nallowBuilds:\n  esbuild: true\n  node-pty: true\n  koffi: true\n  '@deepseek-ai/dsh-subprocess-local': true\n  '@google/genai': false\n  protobufjs: false\n`)
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('account-pool package smoke: run through pnpm run smoke:package')
const env = { ...process.env, NODE_PATH: '' }
execFileSync(process.execPath, [pnpm, 'install'], { cwd: directory, env, stdio: 'inherit' })
writeFileSync(join(directory, 'consumer.ts'), `import { Config, AccountPool } from '${pkg.name}';\nimport type { AccountPoolSnapshot } from '${pkg.name}/types';\nimport type { AccountPoolInjected } from '${pkg.name}/client';\nimport { TYPERT } from '${pkg.name}/typert';\nimport REMOTE from '${pkg.name}/remote';\nexport type PublicValues = AccountPoolSnapshot | AccountPoolInjected | AccountPool;\nexport const values = [Config, TYPERT, REMOTE];\n`)
writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, noEmit: true, jsx: 'react-jsx', types: ['node', 'react'] }, files: ['consumer.ts'] }) + '\n')
execFileSync(process.execPath, [join(directory, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: directory, env, stdio: 'inherit' })
writeFileSync(join(directory, 'runtime.mjs'), `import assert from 'node:assert/strict';\nimport {readFileSync,statSync,accessSync,constants} from 'node:fs';\nimport {execFileSync} from 'node:child_process';\nimport {dirname,join,relative} from 'node:path';\nimport {fileURLToPath} from 'node:url';\nimport {createHash} from 'node:crypto';\nimport {runInNewContext} from 'node:vm';\nimport * as product from '${pkg.name}';\nimport {TYPERT} from '${pkg.name}/typert';\nimport REMOTE from '${pkg.name}/remote';\nconst root=dirname(fileURLToPath(import.meta.resolve('${pkg.name}/package.json')));\nassert(relative(process.cwd(),root).startsWith('node_modules/'));\nconst upstream=JSON.parse(readFileSync(join(root,'UPSTREAM.json'),'utf8'));\nconst resource=join(root,'resources/cliproxyapi',process.platform+'-'+process.arch);\nconst manifest=JSON.parse(readFileSync(join(resource,'manifest.json'),'utf8'));\nassert.equal(manifest.sourceSHA,upstream.engine.commit);\nassert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);\nassert.equal(manifest.sha256,createHash('sha256').update(readFileSync(join(resource,manifest.filename))).digest('hex'));\nif(process.platform!=='win32'){assert(statSync(join(resource,manifest.filename)).mode&0o111);accessSync(join(resource,manifest.filename),constants.X_OK);}\nexecFileSync(join(resource,manifest.filename),['-h'],{timeout:10000,stdio:'pipe',maxBuffer:65536});\nassert(readFileSync(join(resource,'LICENSE'),'utf8').includes('MIT'));\nassert.equal(TYPERT.invocations.length,16);assert.equal(REMOTE.descriptors.length,16);\nassert(TYPERT.invocations.every(item=>item.result.mode==='strict'&&item.parameters.every(parameter=>parameter.codec.mode==='strict')));\nlet entry;runInNewContext(readFileSync(join(root,'lib/client.js'),'utf8'),{window:{__ModuleLoader__:{load:value=>{entry=value}}}});\nassert.equal(entry.id,'${pkg.name}');assert.equal(typeof entry.factory,'function');\nconsole.log(JSON.stringify({plugin:product.name,hostMethods:16,clientMethods:16,strictCodecs:true,clientFactory:true,installedExecutable:true,sourceSHA:manifest.sourceSHA,binarySHA256:manifest.sha256}));\n`)
const runtime = JSON.parse(execFileSync(process.execPath, ['runtime.mjs'], { cwd: directory, env, encoding: 'utf8' }))
const report = { package: `${pkg.name}@${pkg.version}`, directory, independentInstall: true,
  normalNodeNextTypes: true, skipLibCheck: false, analysisInputsExcluded: true,
  archiveSHA512: createHash('sha512').update(readFileSync(join(directory, 'candidate.tgz'))).digest('base64'), ...runtime }
writeFileSync(join(packageRoot, '.build/installed-package.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
