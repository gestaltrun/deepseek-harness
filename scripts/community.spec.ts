import { describe, expect, it } from 'vitest'
import { readCommunityPlugins, verifyCommunityPackage } from './community.ts'

describe('community product package isolation', () => {
  it('enables only the aggregate so Better Sidebar is mounted once by that aggregate', () => {
    const plugins = readCommunityPlugins()
    expect(plugins.map(plugin => plugin.package)).toEqual([
      '@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all',
    ])
    expect(plugins.filter(plugin => plugin.defaultBundle).map(plugin => plugin.package)).toEqual(['@gestaltrun/dsh-web-all'])
  })

  it('accepts exact fork dependencies and official SDK peer declarations', () => {
    expect(() => {
      verifyCommunityPackage({ name: '@gestaltrun/dsh-web-all', version: '1.0.0',
        dependencies: { '@gestaltrun/dsh-better-sidebar': '0.19.1-gestaltrun.0' },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.2' } })
    }).not.toThrow()
  })

  it.each(['@linxin666/dsh-web-all', 'dsh-better-sidebar', '@gestalt/dsh-better-sidebar'])(
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
