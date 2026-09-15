/** Validation of provider JSON and explicit account-management inputs. */
import { z } from 'zod'
import { AccountPoolError } from '../account-pool.ts'

/**
 * Recognize a credential filename without filesystem traversal or response-header syntax.
 * @param name - core filename or request input.
 * @returns whether the value is a safe single filename segment.
 */
export function safeAccountFilename(name: string): boolean {
  return name.length > 0 && name.length <= 255 && !/[\\/\u0000-\u001f\u007f"<>:|?*]/u.test(name)
    && name !== '.' && name !== '..' && !/[. ]$/u.test(name)
}

/** Scalar metadata record from core JSON. */
export const recordSchema = z.record(z.string(), z.unknown())
/** Filename validation at account-management entry points. */
export const nameSchema = z.string().min(1).max(512).regex(/^[^\\/\u0000-\u001f\u007f]+$/u)
/** Supported enrollment provider input. */
export const kindSchema = z.enum(['anthropic', 'codex', 'antigravity', 'kimi', 'xai', 'glm'])
/** Opaque login operation input. */
export const stateSchema = z.string().min(1).max(2048)
const text = z.string().max(8192)
const secretEdit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keep') }).strict(),
  z.object({ kind: z.literal('replace'), value: text }).strict(),
  z.object({ kind: z.literal('remove') }).strict(),
])
/** Only supported field edits are accepted; unknown auth fields cannot become writes. */
export const patchSchema = z.object({
  note: text.optional(), prefix: text.optional(),
  proxyUrl: secretEdit.optional(),
  priority: z.number().int().optional(), weight: z.number().nonnegative().optional(),
  disableCooling: z.boolean().optional(), websockets: z.boolean().optional(),
  excludedModels: z.array(z.string().min(1).max(512)).max(1024).optional(),
  headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu), secretEdit).optional(),
}).strict()
/** Write-only GLM account input. */
export const glmSchema = z.object({
  apiKey: z.string().trim().min(1).max(8192), site: z.enum(['cn', 'international']),
  organization: text.optional(), project: text.optional(),
}).strict()
/** Enrollment callback input; its operation state is checked by the owner. */
export const callbackSchema = z.object({ provider: kindSchema, redirectUrl: z.string().url().max(16384) }).strict()

/**
 * Convert input validation failures into a diagnostic that cannot echo secret values.
 * @param schema - validation owned by this input parser.
 * @param value - received JSON or request value.
 * @returns the validated value.
 */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AccountPoolError('invalid-input', 'Account pool input is invalid.')
  return result.data
}
