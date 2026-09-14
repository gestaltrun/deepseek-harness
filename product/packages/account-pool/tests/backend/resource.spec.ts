import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyResource } from '../../src/provider/state.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('refuses source, architecture, traversal, and binary drift before subprocess admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pool-resource-'))
  roots.push(root)
  const body = 'test executable bytes'
  const sourceSHA = '1'.repeat(40)
  const manifest = { sourceSHA, platform: process.platform, arch: process.arch,
    filename: 'cli-proxy-api', sha256: createHash('sha256').update(body).digest('hex') }
  await writeFile(join(root, manifest.filename), body)
  const writeManifest = async (patch: object = {}) => writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, ...patch }))
  const spec = { resourceDirectory: root, expectedSourceSHA: sourceSHA }
  await writeManifest()
  expect(await verifyResource(spec)).toBe(join(root, manifest.filename))
  await writeManifest({ sourceSHA: '2'.repeat(40) })
  await expect(verifyResource(spec)).rejects.toThrow('identity')
  await writeManifest({ arch: 'not-this-host' })
  await expect(verifyResource(spec)).rejects.toThrow('identity')
  await writeManifest({ filename: '../external' })
  await expect(verifyResource(spec)).rejects.toThrow()
  await writeManifest()
  await writeFile(join(root, manifest.filename), 'changed')
  await expect(verifyResource(spec)).rejects.toThrow('digest')
})
