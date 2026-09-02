/**
 * Reading a Google API error, shared by the Gmail and Calendar paths.
 *
 * `statusOf` and `reasonsOf` lived only in `gmailLimiter`, where they were
 * written for retry decisions. Calendar needs the same reading for a different
 * question — "should the user be told, and can they do anything about it" — and
 * two copies of the status lookup would drift. Notably `calendarService` was
 * already checking `err.code` alone, missing the `response.status` form these
 * handle.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Gaxios surfaces the HTTP status on `code`, `status`, or `response.status`. */
export function googleErrorStatus(err: unknown): number | undefined {
  const record = asRecord(err);
  if (!record) return undefined;
  for (const candidate of [record.code, record.status]) {
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return parseInt(candidate, 10);
  }
  const responseStatus = asRecord(record.response)?.status;
  return typeof responseStatus === 'number' ? responseStatus : undefined;
}

/**
 * Google error payloads carry a machine-readable `reason` per error, either
 * flattened onto the error by googleapis or nested in the response body.
 */
export function googleErrorReasons(err: unknown): string[] {
  const record = asRecord(err);
  if (!record) return [];
  const lists: unknown[] = [
    record.errors,
    asRecord(asRecord(asRecord(record.response)?.data)?.error)?.errors,
  ];
  const reasons: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const reason = asRecord(entry)?.reason;
      if (typeof reason === 'string') reasons.push(reason.toLowerCase());
    }
  }
  return reasons;
}

const RATE_LIMIT_REASONS = new Set(['ratelimitexceeded', 'userratelimitexceeded']);

/**
 * Already gone, as far as a delete is concerned.
 *
 * Google answers 404/410 for an event that no longer exists — which for a
 * delete is the outcome the caller wanted. Treating it as a failure makes a
 * row whose Google event was removed in Google's own UI permanently
 * undeletable here: every retry repeats the same 404.
 */
export function isAlreadyGone(err: unknown): boolean {
  const status = googleErrorStatus(err);
  return status === 404 || status === 410;
}

export interface PushFailure {
  code: 'rate_limited' | 'auth' | 'rejected' | 'unavailable';
  /** Whether trying the same thing again could plausibly work. */
  retryable: boolean;
  /** Safe to show a user: no stack, no request detail, no Google internals. */
  message: string;
}

/**
 * What kind of failure this is, in terms the caller can act on.
 *
 * The distinction that matters is `retryable`: a rate limit or an outage is
 * worth trying again, a revoked grant or a rejected payload is not, and telling
 * someone to "try again" for the second kind wastes their time.
 */
export function classifyGoogleError(err: unknown): PushFailure {
  const status = googleErrorStatus(err);
  const reasons = googleErrorReasons(err);

  if (status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)))) {
    return { code: 'rate_limited', retryable: true, message: 'Google Calendar is rate limiting this account.' };
  }
  if (status === 401) {
    // Not retryable by repeating the request: the grant has to be renewed.
    return { code: 'auth', retryable: false, message: 'Google access has expired. Reconnect Google in Settings.' };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { code: 'rejected', retryable: false, message: 'Google Calendar rejected the change.' };
  }
  return { code: 'unavailable', retryable: true, message: 'Google Calendar could not be reached.' };
}
