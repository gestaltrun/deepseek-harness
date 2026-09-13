/** Boot the materialized target runtime without access to a user's Harness profile. */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile, desktopRuntimeBundles } from '../src/project-manager.ts'
import { DESKTOP_PRODUCT_BUNDLES } from '../src/product-profile.ts'
import { linkDesktopHostPackages, validateDesktopPluginGraph } from '../src/profile-packages.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { buildCommunityClientSeed, smokeCommunityClientModules } from './community-client-modules.ts'

/** Community artifacts exposed by one real Host composition. */
export interface CommunityRouteSmoke {
  readonly clientEntries: readonly string[]
  readonly assets: readonly string[]
  readonly routes: readonly string[]
}

/**
 * Verify the installed Ego settings resolve the expected carrier launch default.
 * @param fetchResource - Authenticated resource requests for this Host.
 * @param expected - Launch arguments configured by this fresh profile.
 */
export async function smokeEgoLaunchConfiguration(
  fetchResource: (path: string, init?: RequestInit) => Promise<Response>, expected: string,
): Promise<void> {
  const response = await fetchResource('/ego/api/get', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' })
  const body = await response.json() as { ok?: boolean; value?: { config?: { egoCliArgs?: unknown } } }
  if (!response.ok || body.ok !== true || body.value?.config?.egoCliArgs !== expected) {
    throw new Error('desktop runtime: installed Ego launch configuration differs from the profile default')
  }
}

/**
 * Verify mounted community routes and fetch their actual browser modules.
 * @param fetchResource - Authenticated resource requests for the current Desktop or Web Host.
 * @param additionalClientEntries - Product clients required by the selected profile.
 * @returns Community entry ids and route names that executed successfully.
 */
export async function smokeCommunityPluginRoutes(
  fetchResource: (path: string, init?: RequestInit) => Promise<Response>,
  additionalClientEntries: readonly string[] = [],
): Promise<CommunityRouteSmoke> {
  const index = await fetchResource('/')
  const html = await index.text()
  if (index.status !== 200 || !html.includes('<html')) throw new Error('community smoke: Host did not serve its HTML')
  const match = /<script>globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u.exec(html)
  if (match?.[1] === undefined) throw new Error('community smoke: no client boot manifest')
  const boot = JSON.parse(match[1]) as { entries?: Array<{ id: string; url: string }> }
  if (!Array.isArray(boot.entries)) throw new Error('community smoke: invalid client boot entries')
  const expected = ['@gestaltrun/dsh-better-sidebar', '@gestaltrun/dsh-web-all',
    '@gestaltrun/dsh-ego-browser', '@gestaltrun/dsh-github-workbench', '@gestaltrun/dsh-git-remotes',
    '@gestaltrun/dsh-sidebar-office', '@gestaltrun/dsh-video-preview', ...additionalClientEntries]
  const retired = new Set(['@gestaltrun/dsh-client-ui-market',
    '@gestaltrun/dsh-client-ui-preset-center', '@gestaltrun/dsh-client-ui-community-plugins'])
  if (boot.entries.some(entry => retired.has(entry.id))) throw new Error('community smoke: Workshop client remains in the boot graph')
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
  const childResponse = await fetchResource('/api/dsh-web-all/rows')
  const children: unknown = await childResponse.json()
  if (childResponse.status !== 200 || typeof children !== 'object' || children === null
    || !('ok' in children) || children.ok !== true || !('children' in children) || !Array.isArray(children.children)
    || children.children.some(name => typeof name !== 'string' || retired.has(name))) {
    throw new Error('community smoke: invalid aggregate rows or active Workshop child')
  }
  routes.push('dsh-web-all/rows')
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

async function smokeCommunityWorkspace(host: DesktopHostProcess, workspace: string, sessionId: string): Promise<void> {
  const fetchResource = (path: string, init?: RequestInit): Promise<Response> => host.fetch(new Request(
    new URL(path, 'dsh-app://app/'), { ...init, signal: AbortSignal.timeout(30_000) },
  ))
  const queryFor = (name: string): string => new URLSearchParams({ sessionId, path: join(workspace, name), cwd: workspace }).toString()
  for (const name of ['office-preview.docx', 'office-preview.xlsx', 'office-preview.pptx']) {
    const response = await fetchResource(`/sidebar/file?${queryFor(name)}`)
    if (response.status !== 200 || !Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(workspace, name)))) {
      throw new Error(`community smoke: Office file ${name} was not served intact`)
    }
  }
  const video = readFileSync(join(workspace, 'video-preview.mp4'))
  const videoPath = `/sidebar/video?${queryFor('video-preview.mp4')}`
  const ranged = await fetchResource(videoPath, { headers: { range: 'bytes=0-63' } })
  if (ranged.status !== 206 || ranged.headers.get('content-range') !== `bytes 0-63/${String(video.length)}`
    || !Buffer.from(await ranged.arrayBuffer()).equals(video.subarray(0, 64))) throw new Error('community smoke: video Range bytes differ')
  const head = await fetchResource(videoPath, { method: 'HEAD' })
  if (head.status !== 200 || head.headers.get('content-length') !== String(video.length)
    || (await head.arrayBuffer()).byteLength !== 0) throw new Error('community smoke: video HEAD failed')
  const unknown = await fetchResource(`/sidebar/video?${new URLSearchParams({ sessionId: 'unknown-smoke-session', path: join(workspace, 'video-preview.mp4') }).toString()}`)
  const unknownResult: unknown = await unknown.json()
  if (unknown.status !== 404 || typeof unknownResult !== 'object' || unknownResult === null
    || !('error' in unknownResult) || typeof unknownResult.error !== 'object' || unknownResult.error === null
    || !('code' in unknownResult.error) || unknownResult.error.code !== 'unknown-session') throw new Error('community smoke: video accepted an unknown session')
  const remotes = await fetchResource('/git-remotes/api/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: sessionId }),
  })
  const remoteState: unknown = await remotes.json()
  if (remotes.status !== 200 || typeof remoteState !== 'object' || remoteState === null || !('value' in remoteState)
    || typeof remoteState.value !== 'object' || remoteState.value === null || !('root' in remoteState.value)
    || remoteState.value.root !== workspace || !('isRepo' in remoteState.value) || remoteState.value.isRepo !== true) {
    throw new Error('community smoke: Git Remotes did not resolve the fixture session')
  }
  const ego = await fetchResource('/api/ego/spaces')
  const spaces: unknown = await ego.json()
  if (ego.status !== 200 || typeof spaces !== 'object' || spaces === null || !('spaces' in spaces)
    || !Array.isArray(spaces.spaces)) throw new Error('community smoke: Ego browser state is unavailable')
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
  const workspace = join(home, 'workspace')
  const sessionId = 'desktop-community-smoke'
  const hasCommunity = desktopRuntimeBundles(runtime).some(name => name.startsWith('@gestaltrun/'))
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name)))
  const host = new DesktopHostProcess(node, root, profile, undefined, {
    ...environment, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
    XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'),
  })
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  try {
    createPluginProfile(profile, desktopRuntimeBundles(runtime))
    if (hasCommunity) {
      mkdirSync(workspace)
      for (const name of ['office-preview.docx', 'office-preview.xlsx', 'office-preview.pptx', 'video-preview.mp4']) {
        copyFileSync(join(import.meta.dirname, '../tests/fixtures/community-viewers', name), join(workspace, name))
      }
      execFileSync('git', ['init', '--initial-branch=main', workspace], { stdio: 'pipe', env: {
        ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_TERMINAL_PROMPT: '0',
      } })
    }
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@deepseek-ai/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@deepseek-ai/cordis': cordis.version,
        ...(hasCommunity ? { '@deepseek-ai/dsh-session': runtime.release.version } : {}) }, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@deepseek-ai/cordis'
${hasCommunity ? "import { SessionId } from '@deepseek-ai/dsh-session'\nexport const inject = ['sessions']" : ''}
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  ${hasCommunity ? `ctx.sessions.create(SessionId(${JSON.stringify(sessionId)}), { meta: { cwd: ${JSON.stringify(workspace)} } })` : ''}
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
    if (hasCommunity) {
      await smokeCommunityPluginRoutes((path, init) => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        ...init, signal: AbortSignal.timeout(30_000),
      })), DESKTOP_PRODUCT_BUNDLES.filter(name => desktopRuntimeBundles(runtime).includes(name)))
      await smokeEgoLaunchConfiguration((path, init) => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        ...init, signal: AbortSignal.timeout(30_000),
      })), '--headless')
      await smokeDesktopCommunityAccess(path => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        signal: AbortSignal.timeout(30_000),
      })))
      await smokeCommunityWorkspace(host, workspace, sessionId)
      await smokeCommunityClientModules(path => host.fetch(new Request(new URL(path, 'dsh-app://app/'), {
        signal: AbortSignal.timeout(30_000),
      })), await buildCommunityClientSeed(join(home, 'client-seed')))
    }
  } finally {
    if (readyTimer !== undefined) clearTimeout(readyTimer)
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
