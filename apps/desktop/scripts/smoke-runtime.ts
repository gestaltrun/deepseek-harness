/** Boot the materialized target runtime without access to a user's Harness profile. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile, desktopRuntimeBundles } from '../src/project-manager.ts'
import { linkDesktopHostPackages, validateDesktopPluginGraph } from '../src/profile-packages.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/** Community artifacts exposed by one real Host composition. */
export interface CommunityRouteSmoke {
  readonly clientEntries: readonly string[]
  readonly assets: readonly string[]
  readonly routes: readonly string[]
}

/**
 * Verify mounted community routes and fetch their actual browser modules.
 * @param fetchResource - Authenticated resource requests for the current Desktop or Web Host.
 * @returns Community entry ids and route names that executed successfully.
 */
export async function smokeCommunityPluginRoutes(
  fetchResource: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<CommunityRouteSmoke> {
  const index = await fetchResource('/')
  const html = await index.text()
  if (index.status !== 200 || !html.includes('<html')) throw new Error('community smoke: Host did not serve its HTML')
  const match = /<script>globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u.exec(html)
  if (match?.[1] === undefined) throw new Error('community smoke: no client boot manifest')
  const boot = JSON.parse(match[1]) as { entries?: Array<{ id: string; url: string }> }
  if (!Array.isArray(boot.entries)) throw new Error('community smoke: invalid client boot entries')
  const expected = ['@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all']
  for (const name of expected) {
    const entry = boot.entries.find(entry => entry.id === name)
    if (entry === undefined) throw new Error(`community smoke: ${name} is absent from the client boot graph`)
    const response = await fetchResource(entry.url)
    const script = await response.text()
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('javascript') || script.length === 0) {
      throw new Error(`community smoke: ${name} client artifact was not served`)
    }
  }
  const assets = ['/sidebar/bundle/locale.js']
  for (const path of assets) {
    const response = await fetchResource(path)
    const script = await response.text()
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('javascript')
      || !script.includes('globalThis.__dshChunks__["locale"]')) {
      throw new Error(`community smoke: missing Sidebar lazy module ${path}`)
    }
  }
  const routes = ['settings.get', 'terminal.deps']
  for (const method of routes) {
    const response = await fetchResource(`/sidebar/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const result: unknown = await response.json()
    if (response.status !== 200 || typeof result !== 'object' || result === null || !('ok' in result)
      || result.ok !== true || !('value' in result)) throw new Error(`community smoke: ${method} did not execute successfully`)
    if (method === 'terminal.deps' && (typeof result.value !== 'object' || result.value === null
      || !('ok' in result.value) || result.value.ok !== true)) {
      throw new Error('community smoke: terminal.deps reported an unavailable node-pty binding')
    }
  }
  return { clientEntries: expected, assets, routes }
}

/**
 * Require usable Desktop remote controls and native-only Usage access in the packaged composition.
 * @param fetchResource - Resource requests through the private Desktop carrier.
 */
export async function smokeDesktopCommunityAccess(
  fetchResource: (path: string) => Promise<Response>,
): Promise<void> {
  const response = await fetchResource('/api/pair/lan-bind')
  const state: unknown = await response.json()
  if (response.status !== 200 || typeof state !== 'object' || state === null
    || !('ok' in state) || state.ok !== true || !('listening' in state) || state.listening !== true
    || !('bindHost' in state) || state.bindHost !== '127.0.0.1'
    || !('port' in state) || typeof state.port !== 'number' || !Number.isInteger(state.port) || state.port <= 0
    || !('pendingRestart' in state) || state.pendingRestart !== false) {
    throw new Error('community smoke: Desktop remote access did not start on loopback')
  }
  const usage = await fetchResource('/api/dsh-usage/overview')
  if (usage.status !== 200) throw new Error('community smoke: Desktop Usage route rejected its private carrier')
  await usage.arrayBuffer()
}

/**
 * Prove the final resource tree boots and serves its matching Web frontend.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Node executable.
 * @param runtime - Verified resource descriptor.
 */
export async function smokeDesktopRuntime(root: string, node: string, runtime: DesktopRuntimeDescriptor): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name)))
  const host = new DesktopHostProcess(node, root, profile, undefined, {
    ...environment, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
    XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'),
  })
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  try {
    createPluginProfile(profile, desktopRuntimeBundles(runtime))
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@deepseek-ai/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@deepseek-ai/cordis': cordis.version }, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@deepseek-ai/cordis'
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n')
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    linkDesktopHostPackages(profile, root, runtime)
    validateDesktopPluginGraph(profile, root, runtime, [pluginName])
    const ready = await Promise.race([host.start(), new Promise<never>((_, reject) => {
      readyTimer = setTimeout(() => { reject(new Error('desktop runtime: Host readiness timed out')) }, 120_000)
      readyTimer.unref()
    })])
    if (readyTimer !== undefined) clearTimeout(readyTimer)
    if (ready.dshVersion !== runtime.release.version) throw new Error('desktop runtime: Host reported another dsh release')
    const response = await host.fetch(new Request('dsh-app://app/'))
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    if (desktopRuntimeBundles(runtime).some(name => name.startsWith('@gestaltrun/'))) {
      await smokeCommunityPluginRoutes((path, init) => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        ...init, signal: AbortSignal.timeout(30_000),
      })))
      await smokeDesktopCommunityAccess(path => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        signal: AbortSignal.timeout(30_000),
      })))
    }
  } finally {
    if (readyTimer !== undefined) clearTimeout(readyTimer)
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
