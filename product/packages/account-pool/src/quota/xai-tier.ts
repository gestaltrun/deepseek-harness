/**
 * Paid-xAI credential recognition ported from the official CLIProxyAPI
 * management center (`src/utils/quota/xaiPaid.ts` `isPaidXaiAuthFile` at
 * ed5f1c48, MIT). This helper runs Host-side over the CLIProxyAPI auth-file
 * record to derive the non-secret `xaiAccountKind` probe metadata; the record
 * and its tokens never leave the Host and never enter probe input.
 * @module account-pool/quota/xai-tier
 */

import { asRecord } from './normalize.ts'

const XAI_PAID_PREFIX = 'paid'
const NESTED_AUTH_KEYS = ['metadata', 'attributes', 'oauth', 'raw', 'credential', 'auth']

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function collectAuthRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const visited = new Set<Record<string, unknown>>()

  const visit = (candidate: unknown, depth: number): void => {
    const record = asRecord(candidate)
    if (record === null || visited.has(record) || depth > 2) return
    visited.add(record)
    records.push(record)
    for (const key of NESTED_AUTH_KEYS) visit(record[key], depth + 1)
  }

  visit(value, 0)
  return records
}

function readStrings(records: readonly Record<string, unknown>[], keys: readonly string[]): string[] {
  const values: string[] = []
  for (const record of records) {
    for (const key of keys) {
      const value = asString(record[key])
      if (value !== null) values.push(value)
    }
  }
  return values
}

function isTruthyValue(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  return ['true', '1', 'yes', 'y', 'on'].includes(value.trim().toLowerCase())
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const encodedPayload = token.split('.')[1]
  if (encodedPayload === undefined || encodedPayload === '') return null

  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = globalThis.atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

function resolveJwtTier(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (payload === null) return null

  const tierEntry = Object.entries(payload).find(([key]) => {
    const normalized = key.toLowerCase()
    return normalized === 'tier' || normalized.endsWith('/tier') || normalized.endsWith(':tier')
  })
  const tier = Number(tierEntry?.[1])
  return Number.isFinite(tier) ? tier : null
}

/**
 * Judge whether an xAI auth-file record belongs to a paid account. Route hints
 * (`using_api` plus a `paid` prefix) recognize the documented paid pool setup;
 * otherwise a JWT `tier` claim of 1 or higher on any stored token decides.
 * @param authFile - the CLIProxyAPI auth-file record (read Host-side only).
 * @returns true for paid accounts.
 */
export function isPaidXaiCredential(authFile: unknown): boolean {
  const records = collectAuthRecords(authFile)
  const usesOfficialApi = records.some(record =>
    isTruthyValue(record['using_api'] ?? record['usingApi']),
  )
  const hasPaidPrefix = readStrings(records, ['prefix']).some(
    prefix => prefix.toLowerCase() === XAI_PAID_PREFIX,
  )
  if (usesOfficialApi && hasPaidPrefix) return true

  const tokens = readStrings(records, ['access_token', 'accessToken', 'id_token', 'idToken', 'token'])
  return tokens.some(token => (resolveJwtTier(token) ?? 0) >= 1)
}
