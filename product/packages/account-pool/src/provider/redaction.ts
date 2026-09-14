/** Allowlisted account projections and explicit secret-field patch materialization. */
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AccountPoolError,
  type AccountPoolAccount, type AccountPoolAccountName, type AccountPoolAccountRef,
  type AccountPoolEditableFields, type AccountPoolFieldPatch, type AccountPoolFieldValues,
  type AccountPoolHeaderValue,
} from '../account-pool.ts'
import { nameSchema, parseInput, recordSchema } from './validation.ts'

const SAFE_HEADER_NAMES = new Set(['accept', 'accept-language', 'content-type', 'user-agent'])
const INFO_KEYS = ['account', 'account_type', 'created_at', 'disabled', 'email',
  'failed', 'type', 'prefix', 'priority', 'weight', 'note', 'websockets', 'disable_cooling',
  'success', 'status', 'provider'] as const

function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Derive a stable product reference from an observed core identity without exposing that identity.
 * @param coreIndex - auth_index received from the core roster, never guessed from credentials.
 * @returns an opaque product reference stable across generation replacement.
 */
export function oauthRef(coreIndex: string): AccountPoolAccountRef {
  return brandString<AccountPoolAccountRef>(`oauth:${createHash('sha256').update(coreIndex).digest('hex')}`)
}

/**
 * Read a proxy address without credential-bearing userinfo, query, or fragment.
 * @param value - core-owned proxy URL.
 * @returns a safe address and a separate credential-presence flag.
 */
export function redactProxy(value: string): { proxyUrl: string; proxyCredentialsConfigured: boolean } {
  try {
    const url = new URL(value)
    const configured = url.username.length > 0 || url.password.length > 0 || url.search.length > 0
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return { proxyUrl: url.toString(), proxyCredentialsConfigured: configured }
  } catch {
    // Malformed stored proxy strings cannot be shown safely.
    return { proxyUrl: '', proxyCredentialsConfigured: value.length > 0 }
  }
}

/**
 * Extract only editable metadata; unknown headers expose presence alone.
 * @param record - parsed core account JSON.
 * @returns fields safe for ordinary RPC and account cards.
 */
export function fieldValues(record: Record<string, unknown>): AccountPoolFieldValues {
  const result: Record<string, unknown> = {}
  for (const key of ['note', 'prefix'] as const) if (string(record[key]) !== undefined) result[key] = record[key]
  for (const key of ['priority', 'weight'] as const) if (number(record[key]) !== undefined) result[key] = record[key]
  for (const [source, target] of [['disable_cooling', 'disableCooling'], ['websockets', 'websockets']] as const) {
    if (typeof record[source] === 'boolean') result[target] = record[source]
  }
  const excluded = record.excluded_models ?? record['excluded-models']
  if (Array.isArray(excluded) && excluded.every(value => typeof value === 'string')) result.excludedModels = [...excluded]
  if (typeof record.proxy_url === 'string') Object.assign(result, redactProxy(record.proxy_url))
  const headers = recordSchema.safeParse(record.headers)
  if (headers.success) {
    const values = Object.create(null) as Record<string, AccountPoolHeaderValue>
    for (const [key, value] of Object.entries(headers.data)) {
      if (typeof value !== 'string') continue
      values[key] = SAFE_HEADER_NAMES.has(key.toLowerCase())
        ? { kind: 'value', value } : { kind: 'secret', configured: true }
    }
    result.headers = values
  }
  return result as AccountPoolFieldValues
}

/**
 * Project allowlisted information from an explicitly fetched auth file.
 * @param name - selected account filename.
 * @param record - parsed credential file kept on the Host.
 * @returns metadata and secret-presence markers, without raw auth JSON.
 */
export function editableFields(name: AccountPoolAccountName, record: Record<string, unknown>): AccountPoolEditableFields {
  const info: Record<string, string | number | boolean> = { id: name }
  for (const key of INFO_KEYS) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'boolean' || number(value) !== undefined) {
      info[key] = value as string | number | boolean
    }
  }
  return { name, info, fields: fieldValues(record) }
}

/**
 * Project an account roster; malformed identity data is an error rather than an empty pool.
 * @param payload - decoded core roster response.
 * @returns one redacted card per core account, before quota enrichment.
 */
export function roster(payload: unknown): AccountPoolAccount[] {
  const record = recordSchema.safeParse(payload)
  if (!record.success || !Array.isArray(record.data.files)) {
    throw new AccountPoolError('failed', 'The account roster response is invalid.')
  }
  return record.data.files.map((entry: unknown) => {
    const account = parseInput(recordSchema, entry)
    const name = brandString<AccountPoolAccountName>(parseInput(nameSchema, account.name))
    if (typeof account.auth_index !== 'string' || account.auth_index.length === 0) {
      throw new AccountPoolError('failed', 'An account reference is missing from the roster.')
    }
    const details: Record<string, unknown> = {}
    for (const [from, to] of [['created_at', 'createdAt'], ['modtime', 'modifiedAt'], ['project_id', 'projectId']] as const) {
      if (string(account[from]) !== undefined) details[to] = account[from]
    }
    const email = string(account.email) ?? string(account.account)
    if (email !== undefined) details.email = email
    const size = number(account.size)
    if (size !== undefined) details.sizeBytes = size
    const recent = Array.isArray(account.recent_requests) ? account.recent_requests : []
    return {
      ...fieldValues(account), ...details,
      ref: oauthRef(account.auth_index), name,
      capabilities: { models: 'account', quota: true, export: 'auth-file',
        editableFields: ['note', 'prefix', 'proxyUrl', 'priority', 'weight', 'disableCooling', 'websockets', 'excludedModels', 'headers'] },
      provider: string(account.provider) ?? string(account.type) ?? 'unknown',
      label: string(account.label) ?? name,
      status: account.disabled === true ? 'disabled' : string(account.status) ?? 'active',
      enabled: account.disabled !== true,
      ...number(account.success) === undefined ? {} : { successCount: number(account.success)! },
      ...number(account.failed) === undefined ? {} : { failCount: number(account.failed)! },
      ...!Array.isArray(account.recent_requests) ? {} : { recentRequests: Array.from({ length: 20 }, (_, i) => {
        const entry = recordSchema.safeParse(recent[i])
        return { success: entry.success ? number(entry.data.success) ?? 0 : 0,
          failed: entry.success ? number(entry.data.failed) ?? 0 : 0 }
      }) },
      quota: [], quotaState: { status: 'unobserved', stale: false },
    }
  })
}

/**
 * Apply explicit secret intents to a Host-owned auth read inside the serialized writer.
 * @param fields - validated edits.
 * @param existing - current auth JSON, never sent to the renderer.
 * @returns the narrow core field patch with preserved secrets unchanged.
 */
export function coreFieldPatch(fields: AccountPoolFieldPatch, existing: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [from, to] of [['note', 'note'], ['prefix', 'prefix'], ['priority', 'priority'], ['weight', 'weight'],
    ['disableCooling', 'disable_cooling'], ['websockets', 'websockets'], ['excludedModels', 'excluded_models']] as const) {
    if (fields[from] !== undefined) patch[to] = fields[from]
  }
  if (fields.proxyUrl?.kind === 'remove') patch.proxy_url = ''
  if (fields.proxyUrl?.kind === 'replace') {
    const value = fields.proxyUrl.value
    let url: URL
    try { url = new URL(value) } catch { throw new AccountPoolError('invalid-input', 'The proxy URL is invalid.') }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) {
      throw new AccountPoolError('invalid-input', 'The proxy URL protocol is unsupported.')
    }
    patch.proxy_url = value
  }
  if (fields.headers !== undefined) {
    const parsed = recordSchema.safeParse(existing.headers)
    const headers = Object.create(null) as Record<string, string>
    if (parsed.success) {
      for (const [key, value] of Object.entries(parsed.data)) if (typeof value === 'string') headers[key] = value
    }
    for (const [key, edit] of Object.entries(fields.headers)) {
      if (edit.kind === 'keep') continue
      for (const previous of Object.keys(headers)) if (previous.toLowerCase() === key.toLowerCase()) delete headers[previous]
      if (edit.kind === 'replace') {
        try { new Headers([[key, edit.value]]) } catch { throw new AccountPoolError('invalid-input', 'A header value is invalid.') }
        headers[key] = edit.value
      }
    }
    patch.headers = headers
  }
  return patch
}
