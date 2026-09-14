/** Desktop browser defaults follow composed profiles without replacing explicit user values. */
import { describe, expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { desktopCommunityDefaults } from '../src/community-defaults.ts'

const bundle: PatchOptions[] = [{ insert: [{ id: 'ego-browser', name: '@gestaltrun/dsh-ego-browser' }] }]
function compose(user: PatchOptions[] = []) {
  const layers = [bundle, user]
  return composeEntries([...layers, desktopCommunityDefaults(composeEntries(layers))])
}

describe('Desktop Ego launch defaults', () => {
  it('enables headless in Desktop while the shared bundle remains unchanged', () => {
    expect(compose()[0]?.config).toEqual({ egoCliArgs: '--headless' })
    expect(composeEntries([bundle])[0]?.config).toBeUndefined()
  })
  it('keeps unrelated user config when adding the missing launch default', () => {
    expect(compose([{ id: 'ego-browser', config: { streamProfile: 'quality' } }])[0]?.config)
      .toEqual({ streamProfile: 'quality', egoCliArgs: '--headless' })
  })
  it.each(['', '--sdk-path /custom/sdk.js', '--headless'])('retains explicit launch args %j', (egoCliArgs) => {
    expect(compose([{ id: 'ego-browser', config: { egoCliArgs } }])[0]?.config).toEqual({ egoCliArgs })
  })
  it('leaves a user config expression to the Loader', () => {
    const config = { __jsExpr: "({ egoCliArgs: '' })" }
    expect(compose([{ id: 'ego-browser', config }])[0]?.config).toEqual(config)
  })
  it('does not add an absent plugin or enable a disabled one', () => {
    expect(desktopCommunityDefaults([])).toEqual([])
    expect(compose([{ id: 'ego-browser', disabled: true }])[0]?.disabled).toBe(true)
  })
})
