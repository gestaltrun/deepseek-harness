/** Artifact and real-route smoke guards reject stale identities and degraded product assemblies. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRetainedCandidate, verifyCommunityArchives, verifyCommunityInstallation } from './community-smoke.ts'
import { smokeCommunityPluginRoutes, smokeDesktopCommunityAccess } from '../apps/desktop/scripts/smoke-runtime.ts'
import type { CommunityArtifact, CommunityPlugin } from './community.ts'

const roots: string[] = []
const commit = 'a'.repeat(40)
const plugin: CommunityPlugin = { path: 'community/sidebar', repository: 'gestaltrun/sidebar',
  package: '@gestaltrun/sidebar', version: '1.0.0', defaultBundle: true }

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-community-smoke-test-'))
  roots.push(root)
  return root
}

function writeManifest(directory: string, value: unknown): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(value))
}

function archive(): { root: string; artifact: CommunityArtifact } {
  const root = temporary()
  writeManifest(join(root, 'package'), { name: plugin.package, version: plugin.version })
  const filename = 'gestaltrun-sidebar-1.0.0.tgz'
  execFileSync('tar', ['-czf', join(root, filename), '-C', root, 'package'], { stdio: 'pipe' })
  const artifact: CommunityArtifact = { name: plugin.package, version: plugin.version, filename,
    repository: plugin.repository, commit,
    integrity: `sha512-${createHash('sha512').update(readFileSync(join(root, filename))).digest('base64')}` }
  writeFileSync(join(root, 'product-community.json'), JSON.stringify({ schemaVersion: 1, packages: [artifact] }))
  return { root, artifact }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('community artifact verification', () => {
  it('accepts a real tarball with the declared version, source pin and integrity', () => {
    const { root, artifact } = archive()
    expect(verifyCommunityArchives(root, [plugin], { [plugin.repository]: commit })).toEqual([artifact])
  })

  it('rejects tampered bytes before extracting or installing the archive', () => {
    const { root, artifact } = archive()
    writeFileSync(join(root, artifact.filename), 'tampered')
    expect(() => verifyCommunityArchives(root, [plugin], { [plugin.repository]: commit })).toThrow('integrity mismatch')
  })

  it('rejects stale Git pins and product versions', () => {
    const { root } = archive()
    expect(() => verifyCommunityArchives(root, [plugin], { [plugin.repository]: 'b'.repeat(40) })).toThrow('source pin')
    expect(() => verifyCommunityArchives(root, [{ ...plugin, version: '2.0.0' }], { [plugin.repository]: commit })).toThrow('product version')
  })

  it('rejects a correctly hashed archive when its contents claim another package', () => {
    const { root, artifact } = archive()
    writeManifest(join(root, 'package'), { name: '@linxin666/sidebar', version: plugin.version })
    execFileSync('tar', ['-czf', join(root, artifact.filename), '-C', root, 'package'])
    writeFileSync(join(root, 'product-community.json'), JSON.stringify({ schemaVersion: 1, packages: [{ ...artifact,
      integrity: `sha512-${createHash('sha512').update(readFileSync(join(root, artifact.filename))).digest('base64')}` }] }))
    expect(() => verifyCommunityArchives(root, [plugin], { [plugin.repository]: commit })).toThrow('@gestaltrun package name')
  })

  it('rejects extra stale tarballs and path traversal in the inventory', () => {
    const { root, artifact } = archive()
    writeFileSync(join(root, 'stale.tgz'), 'unused')
    expect(() => verifyCommunityArchives(root, [plugin], { [plugin.repository]: commit })).toThrow('unrecorded')
    writeFileSync(join(root, 'product-community.json'), JSON.stringify({ schemaVersion: 1, packages: [{ ...artifact, filename: '../escape.tgz' }] }))
    expect(() => verifyCommunityArchives(root, [plugin], { [plugin.repository]: commit })).toThrow('invalid artifact identity')
  })
})

describe('materialized runtime verification', () => {
  function installation(): { root: string; artifact: CommunityArtifact } {
    const { root, artifact } = archive()
    writeManifest(root, { name: 'runtime', private: true })
    writeManifest(join(root, 'node_modules/@deepseek-ai/cordis'), { name: '@deepseek-ai/cordis', version: '1.0.0', main: 'index.js' })
    writeFileSync(join(root, 'node_modules/@deepseek-ai/cordis/index.js'), 'module.exports = {}\n')
    writeManifest(join(root, 'node_modules', artifact.name), { name: artifact.name, version: artifact.version })
    return { root, artifact }
  }

  it('resolves both the runtime and installed plugin to one Cordis module', () => {
    const { root, artifact } = installation()
    expect(verifyCommunityInstallation(root, [artifact])).toEqual({ packages: 2, cordis: 'node_modules/@deepseek-ai/cordis/index.js' })
  })

  it.each(['@gestaltrun/dsh-client-ui-market', '@gestaltrun/dsh-client-ui-preset-center', '@gestaltrun/dsh-client-ui-community-plugins'])(
    'rejects the retired Workshop package %s in the installed product', (name) => {
      const { root, artifact } = installation()
      writeManifest(join(root, 'node_modules', name), { name, version: '0.3.21-gestaltrun.1' })
      expect(() => verifyCommunityInstallation(root, [artifact])).toThrow('Workshop package remains installed')
    },
  )

  it('rejects source links instead of using the checkout as installation evidence', () => {
    const { root, artifact } = installation()
    symlinkSync(join(root, 'package'), join(root, 'node_modules/source-link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => verifyCommunityInstallation(root, [artifact])).toThrow('runtime contains a link')
  })

  it('rejects a second nested Cordis package', () => {
    const { root, artifact } = installation()
    writeManifest(join(root, 'node_modules', artifact.name, 'node_modules/@deepseek-ai/cordis'), { name: '@deepseek-ai/cordis', version: '2.0.0' })
    expect(() => verifyCommunityInstallation(root, [artifact])).toThrow('expected one Cordis package, found 2')
  })

  it('rejects an old upstream community package in the installed closure', () => {
    const { root, artifact } = installation()
    writeManifest(join(root, 'node_modules/@linxin666/legacy'), { name: '@linxin666/legacy', version: '1.0.0' })
    expect(() => verifyCommunityInstallation(root, [artifact])).toThrow('upstream community package remains installed')
  })
})

describe('mounted community route verification', () => {
  const entries = ['@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all',
    '@gestaltrun/dsh-ego-browser', '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
    '@gestaltrun/dsh-sidebar-office', '@gestaltrun/dsh-video-preview']
  function request(path: string): Promise<Response> {
    if (path === '/') return Promise.resolve(new Response(`<html><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
      entries: entries.map(id => ({ id, url: `/plugins/${id}/client.js` })),
    })}</script></html>`))
    if (path === '/api/dsh-web-all/rows') return Promise.resolve(Response.json({ ok: true, children: ['@gestaltrun/dsh-client-ui-plugin-manager'] }))
    if (path.endsWith('/client.js')) return Promise.resolve(new Response('globalThis.loaded = true', { headers: { 'content-type': 'text/javascript' } }))
    if (path.endsWith('/locale.js')) return Promise.resolve(new Response('globalThis.__dshChunks__["locale"] = () => {}', { headers: { 'content-type': 'text/javascript' } }))
    return Promise.resolve(Response.json({ ok: true, value: { ok: true } }))
  }

  it('checks all product browser modules and actual route envelopes', async () => {
    const calls: string[] = []
    expect(await smokeCommunityPluginRoutes((path, init) => {
      calls.push(path)
      if (path.startsWith('/sidebar/api/')) expect(init).toMatchObject({ method: 'POST', body: '{}' })
      return request(path)
    })).toEqual({ clientEntries: entries, assets: ['/sidebar/bundle/locale.js'], routes: ['settings.get', 'terminal.deps', 'dsh-web-all/rows'] })
    expect(calls).toHaveLength(12)
  })

  it('rejects a Workshop child left active inside the aggregate', async () => {
    await expect(smokeCommunityPluginRoutes(path => path === '/api/dsh-web-all/rows'
      ? Promise.resolve(Response.json({ ok: true, children: ['@gestaltrun/dsh-client-ui-market'] })) : request(path)))
      .rejects.toThrow('active Workshop child')
  })

  it('rejects a missing new plugin client entry', async () => {
    await expect(smokeCommunityPluginRoutes(path => path === '/'
      ? Promise.resolve(new Response(`<html><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
        entries: entries.filter(id => id !== '@gestaltrun/dsh-ego-browser').map(id => ({ id, url: `/plugins/${id}/client.js` })),
      })}</script></html>`)) : request(path))).rejects.toThrow('@gestaltrun/dsh-ego-browser is absent')
  })

  it('rejects an omitted packaged locale module', async () => {
    await expect(smokeCommunityPluginRoutes(path => path.endsWith('/locale.js')
      ? Promise.resolve(new Response('missing', { status: 404 })) : request(path))).rejects.toThrow('missing Sidebar lazy module')
  })

  it('rejects a Host that serves only the official HTML without community entries', async () => {
    await expect(smokeCommunityPluginRoutes(() => Promise.resolve(new Response('<html></html>')))).rejects.toThrow('no client boot manifest')
  })

  it('rejects a missing registered route instead of accepting the running Host', async () => {
    await expect(smokeCommunityPluginRoutes(path => path.endsWith('/settings.get')
      ? Promise.resolve(Response.json({ ok: false }, { status: 404 })) : request(path))).rejects.toThrow('settings.get')
  })

  it('rejects a successful route response reporting unavailable terminal dependencies', async () => {
    await expect(smokeCommunityPluginRoutes(path => path.endsWith('/terminal.deps')
      ? Promise.resolve(Response.json({ ok: true, value: { ok: false } })) : request(path))).rejects.toThrow('unavailable node-pty')
  })
})

describe('Desktop community access verification', () => {
  const listening = { ok: true, bindHost: '127.0.0.1', port: 31415, listening: true, pendingRestart: false }
  it('accepts a loopback listener with native Usage access', async () => {
    await smokeDesktopCommunityAccess(path => Promise.resolve(Response.json(path.endsWith('/lan-bind') ? listening : {})))
  })

  it.each([
    { ...listening, listening: false },
    { ...listening, port: 0 },
    { ...listening, bindHost: '0.0.0.0' },
    { ...listening, pendingRestart: true },
    { ok: true },
  ])('rejects unavailable or exposed default remote access: %j', async (state) => {
    await expect(smokeDesktopCommunityAccess(() => Promise.resolve(Response.json(state)))).rejects.toThrow('did not start on loopback')
  })

  it('rejects the private-carrier Usage 403 regression', async () => {
    await expect(smokeDesktopCommunityAccess(path => Promise.resolve(path.endsWith('/lan-bind')
      ? Response.json(listening) : new Response('forbidden', { status: 403 })))).rejects.toThrow('Usage route rejected')
  })
})

describe('retained candidate ownership', () => {
  function candidate(includeProduct = false): { scratch: string; project: string; artifact: CommunityArtifact } {
    const { root: project, artifact } = archive()
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gestaltrun-community-smoke-')))
    roots.push(scratch)
    const fields = ['name', 'version', 'filename', 'integrity', 'repository', 'commit'] as const
    const productArtifacts = includeProduct ? [{ ...artifact, name: '@gestaltrun/dsh-model-center',
      repository: 'gestaltrun/deepseek-harness', filename: 'model-center.tgz' }] : []
    const rows = [artifact, ...productArtifacts].map(item => fields.map(field => item[field]))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    const artifacts = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    writeFileSync(join(scratch, 'report.json'), JSON.stringify({ artifacts: [artifact],
      ...(includeProduct ? { productArtifacts } : {}) }))
    writeFileSync(join(scratch, '.community-smoke-owner.json'), JSON.stringify({ schemaVersion: 1,
      root: realpathSync(project), scratch, artifacts }))
    return { scratch, project, artifact }
  }

  it('accepts only the bound directory, checkout, and recorded candidate bytes', () => {
    const { scratch, project, artifact } = candidate()
    expect(readRetainedCandidate(scratch, project)).toEqual({ scratch, report: { artifacts: [artifact] } })
    expect(() => readRetainedCandidate(scratch, temporary())).toThrow('ownership mismatch')
  })

  it('rejects artifact changes in a retained report', () => {
    const { scratch, project, artifact } = candidate()
    writeFileSync(join(scratch, 'report.json'), JSON.stringify({ artifacts: [{ ...artifact, integrity: 'changed' }] }))
    expect(() => readRetainedCandidate(scratch, project)).toThrow('ownership mismatch')
  })

  it('binds product artifacts into the retained candidate identity', () => {
    const { scratch, project } = candidate(true)
    expect(() => readRetainedCandidate(scratch, project)).not.toThrow()
    const file = join(scratch, 'report.json')
    const report = JSON.parse(readFileSync(file, 'utf8')) as { productArtifacts: CommunityArtifact[] }
    report.productArtifacts[0] = { ...report.productArtifacts[0]!, integrity: 'tampered' }
    writeFileSync(file, JSON.stringify(report))
    expect(() => readRetainedCandidate(scratch, project)).toThrow('ownership mismatch')
  })

  it('rejects a user directory without mutating or removing it', () => {
    const root = temporary()
    const file = join(root, 'preserve.txt')
    writeFileSync(file, 'user content')
    expect(() => readRetainedCandidate(root, root)).toThrow('own temporary candidates')
    expect(readFileSync(file, 'utf8')).toBe('user content')
  })
})
