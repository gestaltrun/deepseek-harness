import { describe, expect, it } from 'vitest'
import { desktopPnpmEnvironment } from '../scripts/desktop-pnpm-environment.ts'

describe('Desktop runtime pnpm environment', () => {
  it('forwards only validated network controls from package-manager settings', () => {
    expect(desktopPnpmEnvironment({
      CI: 'true',
      HTTPS_PROXY: 'http://proxy.example.com',
      PNPM_CONFIG_NETWORK_CONCURRENCY: '2',
      PNPM_CONFIG_FETCH_TIMEOUT: '600000',
      PNPM_CONFIG_REGISTRY: 'https://untrusted.example.com',
      NPM_CONFIG_USERCONFIG: '/private/npmrc',
      npm_config_token: 'secret',
      COREPACK_HOME: '/private/corepack',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'secret',
      NODE_OPTIONS: '--inspect',
      NODE_PATH: '/private/modules',
    }, {
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      NPM_CONFIG_USERCONFIG: '/owned/npmrc',
    })).toEqual({
      CI: 'true',
      HTTPS_PROXY: 'http://proxy.example.com',
      PNPM_CONFIG_NETWORK_CONCURRENCY: '2',
      PNPM_CONFIG_FETCH_TIMEOUT: '600000',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      NPM_CONFIG_USERCONFIG: '/owned/npmrc',
    })
  })

  it.each(['0', '-1', '1.5', '9007199254740992'])('rejects invalid network setting %j', (value) => {
    expect(() => desktopPnpmEnvironment({ PNPM_CONFIG_FETCH_TIMEOUT: value }, {}))
      .toThrow(/positive integer/u)
  })

  it('treats an empty optional setting as unset', () => {
    expect(desktopPnpmEnvironment({ PNPM_CONFIG_FETCH_TIMEOUT: ' ' }, {}))
      .not.toHaveProperty('PNPM_CONFIG_FETCH_TIMEOUT')
  })
})
