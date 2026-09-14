import { describe, expect, it } from 'vitest'
import { createQuotaObserver } from '../../src/quota/observer.ts'
import type { QuotaAccountRef, QuotaProbeInput } from '../../src/quota/types.ts'
import {
  FIXED_NOW,
  createFakeTransport,
  createTestObserver,
  createUrlTableTransport,
  jsonReply,
  textReply,
  transportFailure,
} from './helpers.ts'

const CLAUDE_WINDOWS: Record<string, unknown> = {
  five_hour: { utilization: 20, resets_at: '2027-01-02T03:04:05Z' },
  seven_day: { utilization: 30, resets_at: '2027-01-08T03:04:05Z' },
  seven_day_oauth_apps: { utilization: 1 },
  seven_day_opus: { utilization: 2 },
  seven_day_sonnet: { utilization: 3 },
  seven_day_cowork: { utilization: 4 },
  iguana_necktie: { utilization: 5 },
}

function input(partial: Partial<QuotaProbeInput> & Pick<QuotaProbeInput, 'provider'>): QuotaProbeInput {
  return { authIndex: 'auth-7' as QuotaAccountRef, ...partial }
}

describe('claude assembly', () => {
  it('probes the usage endpoint read-only and reports known for a complete payload', async () => {
    const transport = createUrlTableTransport({
      'api.anthropic.com/api/oauth/usage': jsonReply(CLAUDE_WINDOWS),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))

    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]).toMatchObject({
      authIndex: 'auth-7',
      method: 'GET',
      url: 'https://api.anthropic.com/api/oauth/usage',
    })
    expect(transport.requests[0]?.headers['Authorization']).toBe('Bearer $TOKEN$')
    expect(transport.requests[0]?.headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(observation).toMatchObject({
      provider: 'claude',
      accountRef: 'auth-7',
      status: 'known',
      observedAt: FIXED_NOW,
    })
    expect(observation.windows).toHaveLength(7)
  })

  it('reports partial when named windows are missing', async () => {
    const transport = createUrlTableTransport({
      'api.anthropic.com': jsonReply({ five_hour: { utilization: 20 } }),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation.status).toBe('partial')
    expect(observation.windows).toHaveLength(1)
  })

  it('reports failure when no window survives parsing', async () => {
    const transport = createUrlTableTransport({ 'api.anthropic.com': jsonReply({ other: 1 }) })
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation).toMatchObject({ status: 'failure', windows: [] })
  })

  it('treats a Fable limit as completing the named window set', async () => {
    const named: Record<string, unknown> = {}
    for (const key of ['five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_cowork']) {
      named[key] = { utilization: 10 }
    }
    const fable = {
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 60,
          is_active: true,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    }
    const complete = createUrlTableTransport({ 'api.anthropic.com': jsonReply({ ...named, ...fable }) })
    expect((await createTestObserver(complete).observe(input({ provider: 'claude' }))).status).toBe('known')

    const fiveNamed: Record<string, unknown> = { ...named }
    delete fiveNamed['seven_day_cowork']
    const incomplete = createUrlTableTransport({
      'api.anthropic.com': jsonReply({ ...fiveNamed, ...fable }),
    })
    expect((await createTestObserver(incomplete).observe(input({ provider: 'claude' }))).status).toBe('partial')
  })

  it('fails cleanly on non-record and blank-text payloads', async () => {
    const arrayPayload = createUrlTableTransport({ 'api.anthropic.com': textReply('[1,2]') })
    const fromArray = await createTestObserver(arrayPayload).observe(input({ provider: 'claude' }))
    expect(fromArray).toMatchObject({ status: 'failure', error: 'usage payload carried no windows' })

    const blank = createUrlTableTransport({ 'api.anthropic.com': textReply('   ') })
    const fromBlank = await createTestObserver(blank).observe(input({ provider: 'claude' }))
    expect(fromBlank.error).toBe('provider response was not parseable JSON')

    const errorWithStatus = createFakeTransport(() => ({ statusCode: 503, error: 'upstream broke' }))
    const fromStatus = await createTestObserver(errorWithStatus).observe(input({ provider: 'claude' }))
    expect(fromStatus.error).toBe('provider answered status 503')
  })

  it('decodes a text body and bounds oversized ones', async () => {
    const text = createUrlTableTransport({
      'api.anthropic.com': textReply(JSON.stringify(CLAUDE_WINDOWS)),
    })
    expect((await createTestObserver(text).observe(input({ provider: 'claude' }))).status).toBe('known')

    const huge = createUrlTableTransport({
      'api.anthropic.com': textReply(`{"pad":"${'x'.repeat(1_100_000)}"}`),
    })
    const oversized = await createTestObserver(huge).observe(input({ provider: 'claude' }))
    expect(oversized).toMatchObject({ status: 'failure', error: 'provider response exceeded the bounded body limit' })

    const garbage = createUrlTableTransport({ 'api.anthropic.com': textReply('not json') })
    expect(
      (await createTestObserver(garbage).observe(input({ provider: 'claude' }))).error,
    ).toBe('provider response was not parseable JSON')
  })
})

describe('codex assembly', () => {
  const usage = {
    plan_type: 'pro',
    rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18_000 } },
  }
  const credits = { available_count: 2, applicable_available_count: 1, credits: [{ id: 'c1' }] }

  it('probes usage and reset-credits read-only and reports known', async () => {
    const transport = createUrlTableTransport({
      'wham/usage': jsonReply(usage),
      'rate-limit-reset-credits': jsonReply(credits),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'codex' }))

    expect(observation).toMatchObject({ status: 'known', planType: 'pro' })
    expect(observation.resetCredits).toEqual({
      availableCount: 2,
      applicableAvailableCount: 1,
      creditCount: 1,
    })
    const urls = transport.requests.map(request => request.url)
    expect(urls).toContain('https://chatgpt.com/backend-api/wham/usage')
    expect(urls).toContain('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits')
    expect(urls.some(url => url.includes('consume'))).toBe(false)
    expect(transport.requests.every(request => request.method === 'GET')).toBe(true)
  })

  it('reports partial when the credits listing fails or changes shape', async () => {
    const failing = createUrlTableTransport({ 'wham/usage': jsonReply(usage) })
    const failed = await createTestObserver(failing).observe(input({ provider: 'codex' }))
    expect(failed).toMatchObject({ status: 'partial', error: 'provider answered status 404' })
    expect(failed).not.toHaveProperty('resetCredits')

    const reshaped = createUrlTableTransport({
      'wham/usage': jsonReply(usage),
      'rate-limit-reset-credits': jsonReply({ unexpected: true }),
    })
    const partial = await createTestObserver(reshaped).observe(input({ provider: 'codex' }))
    expect(partial).toMatchObject({
      status: 'partial',
      error: 'reset-credits payload had an unexpected shape',
    })
  })

  it('reports failure when the usage probe fails', async () => {
    const transport = createUrlTableTransport({
      'rate-limit-reset-credits': jsonReply(credits),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'codex' }))
    expect(observation).toMatchObject({ status: 'failure', windows: [] })
  })

  it('fails cleanly on windowless usage payloads, keeping the plan fact', async () => {
    const withPlan = createUrlTableTransport({
      'wham/usage': jsonReply({ plan_type: 'team' }),
      'rate-limit-reset-credits': jsonReply(credits),
    })
    const failed = await createTestObserver(withPlan).observe(input({ provider: 'codex' }))
    expect(failed).toMatchObject({
      status: 'failure',
      planType: 'team',
      error: 'usage payload carried no windows',
    })

    const arrayUsage = createUrlTableTransport({
      'wham/usage': textReply('[1]'),
      'rate-limit-reset-credits': jsonReply(credits),
    })
    const fromArray = await createTestObserver(arrayUsage).observe(input({ provider: 'codex' }))
    expect(fromArray).toMatchObject({ status: 'failure' })
    expect(fromArray).not.toHaveProperty('planType')
  })

  it('succeeds without a plan marker', async () => {
    const transport = createUrlTableTransport({
      'wham/usage': jsonReply({
        rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000 } },
      }),
      'rate-limit-reset-credits': jsonReply(credits),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'codex' }))
    expect(observation.status).toBe('known')
    expect(observation).not.toHaveProperty('planType')
  })
})

describe('antigravity assembly', () => {
  const groups = {
    groups: [
      {
        displayName: 'Gemini',
        buckets: [{ bucketId: 'g-5h', remainingFraction: 0.6, window: '5h' }],
      },
    ],
  }

  it('requires the project id metadata before probing', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(input({ provider: 'antigravity' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'antigravity account metadata lacks a project id',
    })
    expect(transport.requests).toHaveLength(0)
  })

  it('posts the project id through the endpoint fallback chain', async () => {
    const transport = createUrlTableTransport({
      'daily-cloudcode-pa.googleapis.com': jsonReply({ error: 'down' }, 503),
      'daily-cloudcode-pa.sandbox.googleapis.com': jsonReply(groups),
    })
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )

    expect(observation.status).toBe('known')
    expect(observation.windows[0]).toMatchObject({
      key: 'g-5h',
      remainingFraction: 0.6,
      periodHours: 5,
    })
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
      body: JSON.stringify({ project: 'proj-1' }),
    })
  })

  it('unwraps a management-enveloped body', async () => {
    const transport = createUrlTableTransport({
      'retrieveUserQuotaSummary': jsonReply({ body: groups }),
    })
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(observation.status).toBe('known')
  })

  it('reports failure after every endpoint fails', async () => {
    const transport = createUrlTableTransport({ retrieveUserQuotaSummary: jsonReply({}, 500) })
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(observation).toMatchObject({ status: 'failure', error: 'provider answered status 500' })
    expect(transport.requests).toHaveLength(3)
  })

  it('fails after bucketless and non-record payloads exhaust the chain', async () => {
    const bucketless = createUrlTableTransport({ retrieveUserQuotaSummary: jsonReply({ groups: [] }) })
    const failed = await createTestObserver(bucketless).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(failed).toMatchObject({
      status: 'failure',
      error: 'quota-summary payload carried no buckets',
    })
    expect(bucketless.requests).toHaveLength(3)

    const arrayPayload = createUrlTableTransport({ retrieveUserQuotaSummary: textReply('[1]') })
    const fromArray = await createTestObserver(arrayPayload).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(fromArray.status).toBe('failure')
  })

  it('rejects a whitespace project id without probing', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'antigravity', projectId: '   ' }),
    )
    expect(observation.status).toBe('failure')
    expect(transport.requests).toHaveLength(0)
  })
})

describe('kimi assembly', () => {
  it('probes the usage endpoint and reports known rows', async () => {
    const transport = createUrlTableTransport({
      'api.kimi.com': jsonReply({ usage: { used: 5, limit: 10 } }),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'kimi' }))
    expect(transport.requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.kimi.com/coding/v1/usages',
      headers: { Authorization: 'Bearer $TOKEN$' },
    })
    expect(observation).toMatchObject({ status: 'known' })
    expect(observation.windows[0]).toMatchObject({ key: 'summary', used: 5, limit: 10 })
  })

  it('reports failure on an empty usage payload', async () => {
    const transport = createUrlTableTransport({ 'api.kimi.com': jsonReply({}) })
    const observation = await createTestObserver(transport).observe(input({ provider: 'kimi' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'usage payload carried no limits',
    })
  })

  it('fails cleanly on a non-record usage payload', async () => {
    const transport = createUrlTableTransport({ 'api.kimi.com': textReply('[1]') })
    const observation = await createTestObserver(transport).observe(input({ provider: 'kimi' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'usage payload carried no limits',
    })
  })
})

describe('xai assembly', () => {
  const weekly = {
    config: {
      currentPeriod: { type: 'weekly', end: '2027-01-08T00:00:00Z' },
      creditUsagePercent: 40,
    },
  }
  const monthly = { config: { monthly_limit: 2000, used: 500 } }

  it('never probes paid accounts and reports unsupported', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'xai', xaiAccountKind: 'paid' }),
    )
    expect(observation).toMatchObject({ status: 'unsupported', windows: [] })
    expect(transport.requests).toHaveLength(0)
  })

  it('reads both billing endpoints and reports known', async () => {
    const transport = createUrlTableTransport({
      'billing?format=credits': jsonReply(weekly),
      'v1/billing': request =>
        request.url.includes('format=credits') ? jsonReply(weekly) : jsonReply(monthly),
    })
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'xai', xaiAccountKind: 'free', xaiUserId: 'user-9' }),
    )
    expect(observation.status).toBe('known')
    expect(observation.windows.map(window => window.key).sort()).toEqual(['monthly', 'weekly'])
    expect(
      transport.requests.every(request => request.headers['x-userid'] === 'user-9'),
    ).toBe(true)
    expect(
      transport.requests.some(request => request.url.includes('chat/completions')),
    ).toBe(false)
    expect(transport.requests.some(request => request.url.includes('/v1/me'))).toBe(false)
  })

  it('reports partial with one billing source and failure with none', async () => {
    const weeklyOnly = createUrlTableTransport({ 'format=credits': jsonReply(weekly) })
    const partial = await createTestObserver(weeklyOnly).observe(input({ provider: 'xai' }))
    expect(partial.status).toBe('partial')
    expect(partial.windows).toHaveLength(1)

    const none = createUrlTableTransport({})
    const failed = await createTestObserver(none).observe(input({ provider: 'xai' }))
    expect(failed.status).toBe('failure')
    expect(failed.error).toBe('billing endpoints returned no quota data')
  })

  it('notes an unresolvable tier when the kind is unknown and billing fails', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'xai', xaiAccountKind: 'unknown' }),
    )
    expect(observation.error).toContain('account tier is unknown')
  })

  it('omits the x-userid header for a whitespace user id', async () => {
    const transport = createUrlTableTransport({ 'format=credits': jsonReply(weekly) })
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'xai', xaiAccountKind: 'free', xaiUserId: '  ' }),
    )
    expect(observation.status).toBe('partial')
    expect(transport.requests.every(request => !('x-userid' in request.headers))).toBe(true)
  })

  it('skips non-record billing payloads without failing the other window', async () => {
    const transport = createUrlTableTransport({
      'format=credits': textReply('[1]'),
      'v1/billing': request =>
        request.url.includes('format=credits') ? textReply('[1]') : jsonReply(monthly),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'xai' }))
    expect(observation.status).toBe('partial')
    expect(observation.windows).toHaveLength(1)
    expect(observation.windows[0]?.key).toBe('monthly')
  })

  it('deduplicates windows when both endpoints report the same period type', async () => {
    const transport = createUrlTableTransport({
      'v1/billing': jsonReply(weekly),
    })
    const observation = await createTestObserver(transport).observe(input({ provider: 'xai' }))
    expect(observation.status).toBe('partial')
    expect(observation.windows).toHaveLength(1)
  })
})

describe('glm assembly', () => {
  const glmSignals = {
    signals: {
      'GLM-Quota-Status': 'ready',
      'GLM-Credential-Valid': 'true',
      'GLM-Quota-Last-Success-At': '2027-01-02T03:04:05Z',
      'GLM-Plan-Level': 'pro',
      'GLM-Quota-5h-Used-Percent': '35',
      'GLM-Quota-5h-Reset-At': '2027-01-02T08:04:05Z',
      'GLM-Quota-Weekly-Used-Percent': '61',
      'GLM-Quota-Weekly-Reset-At': '2027-01-09T03:04:05Z',
    },
  }

  it('parses the core-polled envelope without touching the transport', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'glm', quotaSignals: glmSignals }),
    )
    expect(transport.requests).toHaveLength(0)
    expect(observation).toMatchObject({
      provider: 'glm',
      status: 'known',
      planType: 'pro',
      observedAt: Date.parse('2027-01-02T03:04:05Z'),
    })
    expect(observation.windows.map(window => window.key)).toEqual(['five-hour', 'weekly'])
  })

  it('surfaces stale polls without a plan marker through the observer', async () => {
    const transport = createUrlTableTransport({})
    const staleSignals = {
      signals: {
        'GLM-Quota-Status': 'stale',
        'GLM-Quota-5h-Used-Percent': '10',
      },
    }
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'glm', quotaSignals: staleSignals }),
    )
    expect(observation).toMatchObject({ status: 'partial' })
    expect(observation.error).toContain('stale')
    expect(observation).not.toHaveProperty('planType')
    expect(transport.requests).toHaveLength(0)
  })

  it('fails when the envelope is absent and still issues no request', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(input({ provider: 'glm' }))
    expect(transport.requests).toHaveLength(0)
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'glm observation requires the core-polled quota signals envelope',
    })
  })
})

describe('observer boundary behavior', () => {
  it('rejects an empty account reference without probing', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'claude', authIndex: '   ' as QuotaAccountRef }),
    )
    expect(observation).toMatchObject({ status: 'failure', error: 'empty account reference' })
    expect(transport.requests).toHaveLength(0)
  })

  it('bounds raw text by UTF-8 bytes, not characters', async () => {
    // 400k euro signs are 400k chars but 1.2M bytes: over the 1 MiB bound.
    const multibyte = createUrlTableTransport({
      'api.anthropic.com': textReply(`{"pad":"${'€'.repeat(400_000)}"}`),
    })
    const observation = await createTestObserver(multibyte).observe(input({ provider: 'claude' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'provider response exceeded the bounded body limit',
    })
  })

  it('accepts a body exactly at the byte bound', async () => {
    // '{"pad":"' + 'x'.repeat(N) + '"}' totals exactly 1 MiB of ASCII bytes.
    const exact = `{"pad":"${'x'.repeat(1_048_576 - 10)}"}`
    const transport = createUrlTableTransport({ 'api.anthropic.com': textReply(exact) })
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation.error).toBe('usage payload carried no windows')
  })

  it('rejects an unserializable decoded body', async () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const transport = createFakeTransport(() => ({ statusCode: 200, body: circular }))
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'provider response was not parseable JSON',
    })
  })

  it('bounds an already-decoded body that bypasses raw text', async () => {
    const transport = createFakeTransport(() => ({
      statusCode: 200,
      body: { pad: 'x'.repeat(1_100_000) },
    }))
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'provider response exceeded the bounded body limit',
    })
  })

  it('fails loud when a payload claims more windows than the retained bound', async () => {
    const makeBuckets = (count: number) => ({
      groups: [
        {
          displayName: 'G',
          buckets: Array.from({ length: count }, (_, index) => ({
            bucketId: `b-${String(index)}`,
            remainingFraction: 0.5,
            window: '5h',
          })),
        },
      ],
    })
    const over = createUrlTableTransport({ retrieveUserQuotaSummary: jsonReply(makeBuckets(257)) })
    const failed = await createTestObserver(over).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(failed).toMatchObject({
      status: 'failure',
      windows: [],
      error: 'provider payload claimed more than 256 quota windows',
    })

    const atBound = createUrlTableTransport({ retrieveUserQuotaSummary: jsonReply(makeBuckets(256)) })
    const ok = await createTestObserver(atBound).observe(
      input({ provider: 'antigravity', projectId: 'proj-1' }),
    )
    expect(ok.status).toBe('known')
    expect(ok.windows).toHaveLength(256)
  })

  it('converts transport throws and status-0 failures into sanitized failure observations', async () => {
    const throwing = createFakeTransport(() => {
      throw new Error('dial tcp: Authorization: Bearer super-secret-token-123 refused')
    })
    const observation = await createTestObserver(throwing).observe(input({ provider: 'claude' }))
    expect(observation.status).toBe('failure')
    expect(observation.error).toContain('[redacted]')
    expect(observation.error).not.toContain('super-secret-token-123')

    const statusZero = createFakeTransport(() => transportFailure('connection reset'))
    const failed = await createTestObserver(statusZero).observe(input({ provider: 'claude' }))
    expect(failed).toMatchObject({ status: 'failure', error: 'connection reset' })
  })

  it('keeps credential-shaped payload content out of observation errors', async () => {
    const transport = createUrlTableTransport({
      'api.anthropic.com': textReply('{"error":"token sk-abcdefghijklmnopqrs expired"}'),
    })
    // The body is valid JSON, so it parses; the payload simply has no windows.
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(JSON.stringify(observation)).not.toContain('sk-abcdefghijklmnopqrs')
  })

  it('fails loud instead of throwing for an unhandled provider', async () => {
    const transport = createUrlTableTransport({})
    const observation = await createTestObserver(transport).observe(
      input({ provider: 'bogus' as QuotaProbeInput['provider'] }),
    )
    expect(observation.status).toBe('failure')
    expect(observation.error).toContain('unhandled provider bogus')
  })

  it('uses the injected clock for sampling stamps', async () => {
    const observer = createQuotaObserver({
      transport: createUrlTableTransport({ 'api.kimi.com': jsonReply({}) }),
      now: () => 42,
    })
    const observation = await observer.observe(input({ provider: 'kimi' }))
    expect(observation.observedAt).toBe(42)
  })

  it('defaults to the wall clock', async () => {
    const observer = createQuotaObserver({ transport: createUrlTableTransport({}) })
    const before = Date.now()
    const observation = await observer.observe(input({ provider: 'kimi' }))
    expect(observation.observedAt).toBeGreaterThanOrEqual(before)
  })

  it('treats a non-object decoded body as unparseable', async () => {
    const transport = createFakeTransport(() => ({ statusCode: 200, body: 42 }))
    const observation = await createTestObserver(transport).observe(input({ provider: 'claude' }))
    expect(observation).toMatchObject({
      status: 'failure',
      error: 'provider response was not parseable JSON',
    })
  })
})
