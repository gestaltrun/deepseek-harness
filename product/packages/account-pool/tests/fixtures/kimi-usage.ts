/** Time fields from a redacted 2026-09-14 live /coding/v1/usages response; counters are synthetic. */
export const kimiUsage = {
  usage: { limit: 100, used: 30, remaining: 70, resetTime: '2026-09-17T18:17:55.594248Z' },
  limits: [{
    window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
    detail: { limit: 100, used: 20, remaining: 80, resetTime: '2026-09-14T13:17:55.594248Z' },
  }],
}

/** Fixed sampling instant independent from the test runner's clock. */
export const kimiObservedAt = Date.parse('2026-09-14T10:17:55.594Z')
