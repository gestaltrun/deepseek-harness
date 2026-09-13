import { describe, expect, it } from 'vitest'
import { readCommunityPlugins, verifyCommunityPackage } from './community.ts'

describe('community product package isolation', () => {
  it('mounts Better Sidebar once via the aggregate and enables independent product bundles', () => {
    const plugins = readCommunityPlugins()
    expect(plugins.map(plugin => plugin.package)).toEqual([
      '@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all',
      '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
    ])
    expect(plugins.filter(plugin => plugin.defaultBundle).map(plugin => plugin.package)).toEqual([
      '@gestaltrun/dsh-web-all', '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
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
