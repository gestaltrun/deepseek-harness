/** Durable product-owned GLM accounts; the engine configuration is a recoverable active projection. */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AccountPoolError, type AccountPoolAccount, type AccountPoolAccountName,
  type AccountPoolAccountRef, type AccountPoolFieldPatch, type AccountPoolGlmKey,
} from '../account-pool.ts'
import { coreFieldPatch, fieldValues } from './redaction.ts'

const accountSchema = z.object({
  id: z.string().uuid(), apiKey: z.string().min(1), site: z.enum(['cn', 'international']),
  organization: z.string().optional(), project: z.string().optional(), enabled: z.boolean(),
  note: z.string().optional(), prefix: z.string().optional(), proxyUrl: z.string().optional(),
  priority: z.number().int().optional(), weight: z.number().int().nonnegative().optional(),
}).strict()
const ledgerSchema = z.object({ revision: z.number().int().nonnegative(), accounts: z.array(accountSchema) }).strict()
/** Private product GLM credential record. */
export type GlmAccount = z.infer<typeof accountSchema>
/** The committed product GLM authority. */
export type GlmLedger = z.infer<typeof ledgerSchema>

/** Private ledger transactions; a failed operation never rolls forward on recovery. */
export class GlmAccounts {
  private readonly ledgerFile: string
  private readonly journalFile: string
  /**
   * @param root - private account root already owned under the supervisor lock.
   * @param maxBytes - complete ledger and journal byte limit.
   */
  constructor(private readonly root: string, private readonly maxBytes: number) {
    this.ledgerFile = join(root, 'glm-accounts.json')
    this.journalFile = join(root, 'glm-transaction.json')
  }

  /** Create an empty authority once; existing private records remain unchanged. */
  async initialize(): Promise<void> {
    try { await this.read() } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      await writeFile(this.ledgerFile, JSON.stringify({ revision: 0, accounts: [] }), { mode: 0o600, flag: 'wx' })
    }
  }

  /**
   * Read the committed credential ledger, rejecting links and oversized records.
   * @returns the validated private ledger.
   */
  async read(): Promise<GlmLedger> {
    const stat = await lstat(this.ledgerFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxBytes) {
      throw new AccountPoolError('failed', 'The GLM credential ledger is not a bounded regular file.')
    }
    return ledgerSchema.parse(JSON.parse(await readFile(this.ledgerFile, 'utf8')) as unknown)
  }

  /**
   * Commit a credential edit only after its active engine projection succeeds.
   * @param mutate - deterministic edit of the current committed account list.
   * @param project - engine projection; its recovery argument requires the owner lifetime, not a cancelled request.
   * @returns the newly committed ledger.
   */
  async update(
    mutate: (accounts: readonly GlmAccount[]) => readonly GlmAccount[],
    project: (accounts: readonly GlmAccount[], recovery: boolean) => Promise<void>,
  ): Promise<GlmLedger> {
    const previous = await this.read()
    const next = ledgerSchema.parse({ revision: previous.revision + 1, accounts: mutate(previous.accounts) })
    await this.atomic(this.journalFile, { previousRevision: previous.revision, next })
    try {
      await project(next.accounts, false)
      await this.atomic(this.ledgerFile, next)
    } catch (error) {
      if (!(error instanceof AccountPoolError && error.code === 'failed')) {
        // A cancelled or disconnected request can still be running in Go. Recovery must terminate that
        // generation before projecting the committed ledger, so an older handler cannot overwrite rollback.
        throw new AccountPoolError('unavailable', 'The GLM projection outcome is uncertain and requires engine recovery.', { cause: error })
      }
      try {
        await project(previous.accounts, true)
        await this.clearJournal()
      } catch (recoveryError) {
        throw new AccountPoolError('unavailable', 'The GLM change failed and its engine projection requires recovery.',
          { cause: new AggregateError([error, recoveryError]) })
      }
      throw new AccountPoolError('failed', 'The GLM change was not committed.', { cause: error })
    }
    // The ledger rename is the commit point. A leftover journal is recoverable from that committed ledger.
    try { await this.clearJournal() } catch {
      // The credential ledger is committed; a retained private journal is cleared after startup recovery.
    }
    return next
  }

  /** Clear a recovery journal only after the engine has loaded the committed ledger projection. */
  async clearJournal(): Promise<void> {
    try { await unlink(this.journalFile) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  private async atomic(path: string, value: unknown): Promise<void> {
    const body = JSON.stringify(value)
    if (Buffer.byteLength(body) > this.maxBytes) throw new AccountPoolError('failed', 'The GLM credential ledger exceeded its byte limit.')
    const temporary = join(this.root, `glm-write-${randomUUID()}.tmp`)
    await writeFile(temporary, body, { mode: 0o600, flag: 'wx' })
    try { await rename(temporary, path) } catch (error) { await unlink(temporary); throw error }
  }
}

/**
 * Project only enabled product accounts into the engine's supported GLM fields.
 * @param accounts - committed or transactional product records.
 * @returns the exact core GLM configuration entries, including private keys.
 */
export function activeGlmEntries(accounts: readonly GlmAccount[]): Record<string, unknown>[] {
  return accounts.filter(account => account.enabled).map(account => ({
    'api-key': account.apiKey, site: account.site,
    ...account.organization === undefined ? {} : { organization: account.organization },
    ...account.project === undefined ? {} : { project: account.project },
    ...account.prefix === undefined ? {} : { prefix: account.prefix },
    ...account.proxyUrl === undefined ? {} : { 'proxy-url': account.proxyUrl },
    ...account.priority === undefined ? {} : { priority: account.priority },
    ...account.weight === undefined ? {} : { weight: account.weight },
  }))
}

/**
 * Construct a product identity independent of any unavailable core GLM auth index.
 * @param input - validated write-only credentials.
 * @returns a new private enabled product record.
 */
export function newGlmAccount(input: AccountPoolGlmKey): GlmAccount {
  return { id: randomUUID(), apiKey: input.apiKey, site: input.site, enabled: true,
    ...input.organization === undefined ? {} : { organization: input.organization },
    ...input.project === undefined ? {} : { project: input.project } }
}

/**
 * Render a GLM configuration without claiming authenticated usage or account-level model observations.
 * @param account - committed private product record.
 * @returns a redacted account card with explicit action capabilities.
 */
export function glmCard(account: GlmAccount): AccountPoolAccount {
  return {
    ref: brandString<AccountPoolAccountRef>(`glm:${account.id}`),
    name: brandString<AccountPoolAccountName>(`glm-${account.id}.json`),
    provider: 'glm', label: 'GLM Coding Plan', enabled: account.enabled,
    status: account.enabled ? 'configured' : 'disabled',
    ...fieldValues({ ...account, proxy_url: account.proxyUrl }),
    capabilities: { models: 'provider', quota: false, export: 'glm-credential',
      editableFields: ['note', 'prefix', 'proxyUrl', 'priority', 'weight'] },
    quota: [], quotaState: { status: 'unsupported', stale: false,
      error: 'The engine does not expose account-level GLM quota observations.' },
  }
}

/**
 * Apply supported product GLM fields; engine-unsupported auth-file fields reject.
 * @param account - current private record.
 * @param fields - validated explicit edits.
 * @returns the candidate private record.
 */
export function patchGlmAccount(account: GlmAccount, fields: AccountPoolFieldPatch): GlmAccount {
  if (fields.disableCooling !== undefined || fields.websockets !== undefined || fields.excludedModels !== undefined || fields.headers !== undefined) {
    throw new AccountPoolError('invalid-input', 'The GLM engine does not support those account fields.')
  }
  const patch = coreFieldPatch(fields, { proxy_url: account.proxyUrl })
  return accountSchema.parse({ ...account,
    ...fields.note === undefined ? {} : { note: fields.note },
    ...fields.prefix === undefined ? {} : { prefix: fields.prefix },
    ...fields.priority === undefined ? {} : { priority: fields.priority },
    ...fields.weight === undefined ? {} : { weight: fields.weight },
    ...patch.proxy_url === undefined ? {} : { proxyUrl: patch.proxy_url },
  })
}
