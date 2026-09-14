import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const resourceDirectory = process.env.DSH_ACCOUNT_POOL_TEST_RESOURCES
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

describe.skipIf(resourceDirectory === undefined)('published dsh profile and Loader', () => {
  it('boots the built product provider and reports committed real engine state from its configured row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pool-loader-'))
    cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'pool-acceptance')
    await mkdir(profile, { recursive: true })
    const report = join(root, 'observed.json')
    const observer = join(root, 'observer.mjs')
    const entry = fileURLToPath(new URL('../../lib/types/provider/gateway.js', import.meta.url))
    await writeFile(observer, `import { writeFile } from 'node:fs/promises';
export const name = 'account-pool-loader-observer';
export const inject = ['accountPool'];
export function apply(ctx, config) {
  let stop = () => {};
  const receive = snapshot => {
    if (snapshot.state !== 'ready') return;
    stop();
    void writeFile(config.report, JSON.stringify({state:snapshot.state,accounts:snapshot.accounts,service:ctx.accountPool.name}));
  };
  stop = ctx.accountPool.subscribe(receive);
  ctx.effect(() => stop);
  receive(ctx.accountPool.getSnapshot());
}
`)
    await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module',
      dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
      { id: 'pool', name: pathToFileURL(entry).href, config: { stateRoot: join(root, 'pool'), resourceDirectory,
        allowCredentialExport: false, restartLimit: 0 } },
      { id: 'observe', name: pathToFileURL(observer).href, config: { report } },
    ] }]))
    const ctx = new Context()
    await ctx.plugin(LocalSubprocess)
    cleanup.push(async () => { await ctx.fiber.dispose() })
    const manifest = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
    const bin = join(manifest, '..', 'lib', 'bin.js')
    const child = ctx.subprocess.spawn({ argv: [process.execPath, bin, '--profile', 'pool-acceptance'], cwd: root,
      env: { ...scrubbedParentEnv(), DSH_HOME: home, HOME: home, USERPROFILE: home }, graceMs: 2000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } } })
    const deadline = AbortSignal.timeout(12000)
    let observed: unknown
    while (!deadline.aborted) {
      try { observed = JSON.parse(await readFile(report, 'utf8')) as unknown; break } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      await delay(20)
    }
    expect(observed, child.collected.stderr?.readFrom(0).text).toEqual({ state: 'ready', accounts: [], service: 'accountPool' })
    child.terminate()
    expect(await child.waitForExit()).toBe(true)
  })
})
