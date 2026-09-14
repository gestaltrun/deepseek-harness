/** Exclusive private state and account configuration retained across process generations. */
import { createHash, randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSON_SCHEMA, dump, load } from 'js-yaml'
import { z } from 'zod'
import { AccountPoolError } from '../account-pool.ts'
import type { Spec } from './config.ts'
import { GlmAccounts, activeGlmEntries } from './glm.ts'
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
  readonly glm: GlmAccounts
  private readonly lockFile: string
  private released = false

  private constructor(readonly root: string, private readonly lock: Awaited<ReturnType<typeof open>>, maxBytes: number) {
    this.authDirectory = join(root, 'auth')
    this.configFile = join(root, 'config.yaml')
    this.lockFile = join(root, '.owner.lock')
    this.glm = new GlmAccounts(root, maxBytes)
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
    const state = new AccountState(root, lock, maxBytes)
    try {
      await lock.writeFile(`${process.pid}\n`)
      await directory(state.authDirectory)
      await directory(join(root, 'generations'))
      await state.glm.initialize()
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
   * Replace runtime fields while preserving validated durable GLM account entries.
   * @param runtime - complete generation-owned configuration fields.
   * @param limit - maximum existing stable configuration bytes.
   */
  async configure(runtime: Record<string, unknown>, limit: number): Promise<void> {
    let persistent: unknown
    try {
      const stat = await lstat(this.configFile)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) {
        throw new AccountPoolError('failed', 'The stable account configuration is not a bounded regular file.')
      }
      persistent = load(await readFile(this.configFile, 'utf8'), { schema: JSON_SCHEMA })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    z.record(z.string(), z.unknown()).parse(persistent ?? {})
    const ledger = await this.glm.read()
    const config = { ...runtime, 'glm-coding-plan': activeGlmEntries(ledger.accounts) }
    const path = join(this.root, `config-${randomBytes(12).toString('hex')}.tmp`)
    await writeFile(path, dump(config, { noRefs: true, lineWidth: -1, schema: JSON_SCHEMA }), { flag: 'wx', mode: 0o600 })
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
export async function removeGeneration(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) await unlink(path)
  else await rm(path, { recursive: true })
}
