/** Materialize packaged community factories through the official browser module table. */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { JSDOM } from 'jsdom'
import type { DshWindow, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const ROOT = resolve(import.meta.dirname, '../../..')

/**
 * Compile the same official seed implementation used by this checkout's Web shell.
 * @param output - Owned temporary output directory.
 * @returns Browser script exporting the actual platform singleton table.
 */
export async function buildCommunityClientSeed(output: string): Promise<string> {
  const invocation = pnpmInvocation(['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build',
    '--config', join(ROOT, 'apps/desktop/tests/fixtures/community-client-seed.vite.mjs')])
  await execa(invocation.command, invocation.args, {
    cwd: ROOT, env: { DSH_COMMUNITY_SEED_OUT: output }, timeout: 120_000, forceKillAfterDelay: 5000,
  })
  return readFileSync(join(output, 'seed.js'), 'utf8')
}

/**
 * Resolve every community factory against the Host's graph and real platform values.
 * @param fetchResource - Authenticated requests to the installed Desktop or Web Host.
 * @param seed - Script built from the official platform seed implementation.
 * @returns Community module ids whose factories materialized successfully.
 */
export async function smokeCommunityClientModules(
  fetchResource: (path: string) => Promise<Response>, seed: string,
): Promise<readonly string[]> {
  const index = await fetchResource('/')
  if (index.status !== 200) throw new Error('community client modules: Host index is unavailable')
  const dom = new JSDOM(await index.text(), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  try {
    const win = dom.window as unknown as DshWindow & {
      __DSH_COMMUNITY_SEED__?: { getStaticModules(): Record<string, unknown> }
    }
    for (const script of dom.window.document.scripts) {
      if (script.src === '' && (script.textContent.includes('window.__ModuleLoader__=')
        || script.textContent.startsWith('globalThis["__DSH_BOOT__"] = '))) dom.window.eval(script.textContent)
    }
    const graph = win.__DSH_BOOT__ as WebBootGraph | undefined
    if (graph === undefined || !Array.isArray(graph.entries) || !Array.isArray(graph.batches)
      || win.__ModuleLoader__ === undefined) throw new Error('community client modules: Host bootstrap is missing')
    dom.window.eval(seed)
    if (win.__DSH_COMMUNITY_SEED__ === undefined) throw new Error('community client modules: official platform seed is missing')
    const loadBundle = async (url: string): Promise<void> => {
      const response = await fetchResource(url)
      if (response.status !== 200) throw new Error(`community client modules: bundle ${url} returned ${String(response.status)}`)
      dom.window.eval(await response.text())
    }
    for (const batch of graph.batches) await loadBundle(batch.url)
    const modules = win.__ModuleLoader__.create({
      boot: graph, staticModules: win.__DSH_COMMUNITY_SEED__.getStaticModules(), loadBundle,
    })
    const entries = modules.manifest.modules.filter(entry => entry.id.startsWith('@gestaltrun/')).map(entry => entry.id)
    if (entries.length === 0) throw new Error('community client modules: no community entries in Host graph')
    for (const id of entries) await modules.import(id)
    return entries
  } finally {
    dom.window.close()
  }
}
