/** Resolve every smoke dependency from one source-build or isolated-install anchor. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @returns actual package modules resolved beside DSH_IM_SMOKE_INSTALL_ROOT/package.json when supplied. */
export async function loadSmokeModules() {
  const anchor = process.env.DSH_IM_SMOKE_INSTALL_ROOT
  const require = createRequire(anchor === undefined ? import.meta.url : join(anchor, 'package.json'))
  const entries = [
    ['Cordis', '@deepseek-ai/cordis', false],
    ['ClientStore', '@deepseek-ai/dsh-client-store', false],
    ['Storage', '@deepseek-ai/dsh-storage', true],
    ['StorageJson', '@deepseek-ai/dsh-storage-json', false],
    ['StorageDomain', '@deepseek-ai/dsh-storage-domain', false],
    ['Credentials', '@deepseek-ai/dsh-credentials-local', true],
    ['TypertRegistry', '@deepseek-ai/dsh-typert-registry', true],
    ['Gateway', '@deepseek-ai/dsh-api-gateway', true],
    ['ImRuntime', '@gestaltrun/dsh-im-runtime', true],
    ['ImApi', '@gestaltrun/dsh-api-im', true],
    ['Typert', '@gestaltrun/dsh-api-im/typert', false],
  ]
  const loaded = await Promise.all(entries.map(async ([key, specifier, takeDefault]) => {
    const value = await import(pathToFileURL(require.resolve(specifier)).href)
    return [key, takeDefault ? value.default : value]
  }))
  return {
    ...Object.fromEntries(loaded), require,
    apiRoot: dirname(require.resolve('@gestaltrun/dsh-api-im/package.json')),
  }
}
