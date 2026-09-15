/** Exclusive private state and account configuration retained across process generations. */
import { createHash, randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSON_SCHEMA, dump, load } from 'js-yaml'
import { z } from 'zod'
import { AccountPoolError } from '../account-pool.ts'
import type { Spec } from './config.ts'
import { safeAccountFilename } from './validation.ts'

const manifestSchema = z.object({
  sourceSHA: z.string().regex(/^[a-f0-9]{40}$/u), platform: z.string(), arch: z.string(),
  filename: z.string().refine(safeAccountFilename), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()

async function directory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AccountPoolError('failed', 'Account state directories must not be links.')
  if (process.platform !== 'win32') await chmod(path, 0o700)
}

/**
 * Verify all manifest identity fields and executable bytes before spawn.
 * @param spec - expected source identity and installed resource directory.
 * @returns the verified absolute executable filename.
 */
export async function verifyResource(spec: Pick<Spec, 'resourceDirectory' | 'expectedSourceSHA'>): Promise<string> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(spec.resourceDirectory, 'manifest.json'), 'utf8')) as unknown)
  if (manifest.sourceSHA !== spec.expectedSourceSHA || manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new AccountPoolError('failed', 'The packaged account engine identity does not match this installation.')
  }
  const binary = join(spec.resourceDirectory, manifest.filename)
  const info = await lstat(binary)
  if (!info.isFile() || info.isSymbolicLink()) throw new AccountPoolError('failed', 'The packaged account engine must be a regular file.')
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex')
  if (digest !== manifest.sha256) throw new AccountPoolError('failed', 'The packaged account engine digest is invalid.')
  return binary
}

/** Exclusive state owner; stale crash locks require explicit operator recovery. */
export class AccountState {
  readonly authDirectory: string
  readonly configFile: string
  private readonly lockFile: string
  private released = false

  private constructor(readonly root: string, private readonly lock: Awaited<ReturnType<typeof open>>) {
    this.authDirectory = join(root, 'auth')
    this.configFile = join(root, 'config.yaml')
    this.lockFile = join(root, '.owner.lock')
  }

  /**
   * Acquire exclusive ownership without inspecting any default CLIProxyAPI home.
   * @param root - explicit private account state directory.
   * @returns the sole live state owner; concurrent owners reject.
   */
  static async acquire(root: string, maxBytes: number): Promise<AccountState> {
    await directory(root)
    let lock: Awaited<ReturnType<typeof open>>
    try { lock = await open(join(root, '.owner.lock'), 'wx', 0o600) } catch (cause) {
      throw new AccountPoolError('conflict', 'Account state is already locked. Stop its owner before recovering a stale lock.', { cause })
    }
    const state = new AccountState(root, lock)
    try {
      await lock.writeFile(`${process.pid}\n`)
      await directory(state.authDirectory)
      await directory(join(root, 'generations'))
      await migrateLegacyGlmLedger(root, state.authDirectory, maxBytes)
      return state
    } catch (error) {
      await state.release()
      throw error
    }
  }

  /**
   * Create one private generation directory.
   * @returns its absolute path, which only its terminated generation may remove.
   */
  async generationDirectory(): Promise<string> {
    return mkdtemp(join(this.root, 'generations', 'generation-'))
  }

  /**
   * Replace generation-owned runtime fields. Account files stay in auth-dir.
   * @param runtime - complete generation-owned configuration fields.
   * @param limit - maximum existing stable configuration bytes.
   */
  async configure(runtime: Record<string, unknown>, limit: number): Promise<void> {
    try {
      const stat = await lstat(this.configFile)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) {
        throw new AccountPoolError('failed', 'The stable account configuration is not a bounded regular file.')
      }
      z.record(z.string(), z.unknown()).parse(load(await readFile(this.configFile, 'utf8'), { schema: JSON_SCHEMA }) ?? {})
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const path = join(this.root, `config-${randomBytes(12).toString('hex')}.tmp`)
    await writeFile(path, dump(runtime, { noRefs: true, lineWidth: -1, schema: JSON_SCHEMA }), { flag: 'wx', mode: 0o600 })
    try { await rename(path, this.configFile) } catch (error) {
      await unlink(path)
      throw error
    }
  }

  /** Release the exact owned root lock after every child and account writer has stopped. */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    await this.lock.close()
    await unlink(this.lockFile)
  }
}

/**
 * Remove only the stopped generation's private directory; never scan the stable root for cleanup.
 * @param path - directory allocated by generationDirectory and owned by the terminated process.
 */
async function migrateLegacyGlmLedger(root: string, authDirectory: string, maxBytes: number): Promise<void> {
  const ledgerFile = join(root, 'glm-accounts.json')
  let body: string
  try {
    const stat = await lstat(ledgerFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return
    body = await readFile(ledgerFile, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  const ledger = z.object({
    accounts: z.array(z.object({
      id: z.string().min(1), apiKey: z.string().min(1), site: z.enum(['cn', 'international']),
      organization: z.string().optional(), project: z.string().optional(), enabled: z.boolean(),
      note: z.string().optional(), prefix: z.string().optional(), proxyUrl: z.string().optional(),
      priority: z.number().int().optional(), weight: z.number().int().nonnegative().optional(),
    })),
  }).parse(JSON.parse(body) as unknown)
  for (const account of ledger.accounts) {
    const name = `glm-${account.id}.json`
    if (!safeAccountFilename(name)) continue
    const path = join(authDirectory, name)
    try { await lstat(path); continue } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await writeFile(path, JSON.stringify({
      type: 'glm', api_key: account.apiKey, site: account.site, disabled: !account.enabled,
      ...account.organization === undefined ? {} : { organization: account.organization },
      ...account.project === undefined ? {} : { project: account.project },
      ...account.note === undefined ? {} : { note: account.note },
      ...account.prefix === undefined ? {} : { prefix: account.prefix },
      ...account.proxyUrl === undefined ? {} : { proxy_url: account.proxyUrl },
      ...account.priority === undefined ? {} : { priority: account.priority },
      ...account.weight === undefined ? {} : { weight: account.weight },
    }), { mode: 0o600, flag: 'wx' })
  }
  await unlink(ledgerFile)
}

export async function removeGeneration(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) await unlink(path)
  else await rm(path, { recursive: true })
}
