import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCommunitySources, readCommunityPlugins, readPublishedCommunityArchive, verifyCommunityPackage } from './community.ts'

describe('community product package isolation', () => {
  it('mounts Better Sidebar once via the aggregate and enables independent product bundles', () => {
    const plugins = readCommunityPlugins()
    expect(plugins.map(plugin => plugin.package)).toEqual([
      '@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all', '@gestaltrun/dsh-ego-browser',
      '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
      '@gestaltrun/dsh-sidebar-office', '@gestaltrun/dsh-video-preview',
    ])
    expect(plugins.filter(plugin => plugin.defaultBundle).map(plugin => plugin.package)).toEqual([
      '@gestaltrun/dsh-web-all', '@gestaltrun/dsh-ego-browser', '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
      '@gestaltrun/dsh-sidebar-office', '@gestaltrun/dsh-video-preview',
    ])
  })

  it('accepts exact fork dependencies and official SDK peer declarations', () => {
    expect(() => {
      verifyCommunityPackage({ name: '@gestaltrun/dsh-web-all', version: '1.0.0',
        dependencies: { '@gestaltrun/dsh-better-sidebar': '0.19.1-gestaltrun.0' },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.2' } })
    }).not.toThrow()
  })

  it.each(['@linxin666/dsh-web-all', 'dsh-better-sidebar', '@gestalt/dsh-better-sidebar', 'dsh-github-workbench', 'dsh-git-remotes', 'dsh-video-preview', 'ego-browser', 'cordis'])(
    'rejects upstream or incorrectly scoped dependency %s', (name) => {
      expect(() => {
        verifyCommunityPackage({ name: '@gestaltrun/dsh-web-all', version: '1.0.0',
          dependencies: { [name]: '1.0.0' } })
      }).toThrow('upstream community package')
    },
  )

  it.each(['workspace:*', 'file:../sidebar.tgz', 'link:../sidebar', '^1.0.0', 'latest'])(
    'rejects an unreproducible fork dependency %s', (version) => {
      expect(() => {
        verifyCommunityPackage({ name: '@gestaltrun/dsh-web-all', version: '1.0.0',
          dependencies: { '@gestaltrun/dsh-better-sidebar': version } })
      }).toThrow()
    },
  )

  it('rejects an official or original community package as our publication artifact', () => {
    expect(() => {
      verifyCommunityPackage({ name: '@deepseek-ai/dsh', version: '1.0.0' })
    }).toThrow('@gestaltrun')
    expect(() => {
      verifyCommunityPackage({ name: 'dsh-better-sidebar', version: '1.0.0' })
    }).toThrow('@gestaltrun')
  })
})

describe('published community archive pins', () => {
  const bytes = Buffer.from('original immutable archive bytes')
  const published = {
    commit: 'a'.repeat(40),
    tarball: 'https://registry.npmjs.org/@gestaltrun/sidebar/-/sidebar-1.0.0.tgz',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }

  it('retains the registry bytes and rejects changed bytes or unsuccessful responses', async () => {
    const result = await readPublishedCommunityArchive(published, (url, init) => {
      expect(url).toBe(published.tarball)
      expect(init?.redirect).toBe('error')
      return Promise.resolve(new Response(bytes))
    })
    expect(result).toEqual(bytes)
    await expect(readPublishedCommunityArchive(published, () => Promise.resolve(new Response('changed'))))
      .rejects.toThrow('integrity mismatch')
    await expect(readPublishedCommunityArchive(published, () => Promise.resolve(new Response(null, { status: 404 }))))
      .rejects.toThrow('HTTP 404')
  })

  it('binds a published artifact to an exact source revision, registry URL and integrity', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-published-community-'))
    try {
      mkdirSync(join(root, 'product'))
      const plugin = { path: 'community/sidebar', repository: 'gestaltrun/sidebar', package: '@gestaltrun/sidebar',
        version: '1.0.0', defaultBundle: true, publishedArtifact: published }
      const write = (value: unknown): void => { writeFileSync(join(root, 'product/community.json'), JSON.stringify({ schemaVersion: 1, plugins: [value] })) }
      write(plugin)
      expect(readCommunityPlugins(root)[0]?.publishedArtifact).toEqual(published)
      const source = join(root, plugin.path)
      mkdirSync(source, { recursive: true })
      writeFileSync(join(root, '.gitmodules'), `[submodule "${plugin.path}"]\n  path = ${plugin.path}\n  url = https://github.com/${plugin.repository}.git\n`)
      execFileSync('git', ['init', source], { stdio: 'pipe' })
      execFileSync('git', ['-c', `core.hooksPath=${join(root, 'no-hooks')}`, '-c', 'commit.gpgsign=false',
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'fixture'], {
        cwd: source, stdio: 'pipe',
      })
      expect(() => { checkCommunitySources(root) }).toThrow('differs from its published source revision')
      for (const changed of [{ commit: 'main' }, { integrity: 'sha512-invalid' },
        { tarball: 'https://example.org/sidebar.tgz' },
        { tarball: `${published.tarball}?replacement=true` }]) {
        write({ ...plugin, publishedArtifact: { ...published, ...changed } })
        expect(() => readCommunityPlugins(root)).toThrow('invalid published artifact pin')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
