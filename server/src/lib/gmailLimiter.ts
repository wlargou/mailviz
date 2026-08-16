import Bottleneck from 'bottleneck';
import { env } from '../config/env.js';

/**
 * Per-user throttling for Gmail API calls.
 *
 * Gmail's quota is charged per user (250 quota units/user/second), and the
 * expensive paths in this app are per-user loops: the batch email operations
 * fan a selection of threads out into one modify/trash call per message, and
 * initialSync fetches every message in the mailbox. A single global limiter
 * would make two users syncing at once starve each other for no reason, so we
 * use a Bottleneck Group: one limiter per userId, created lazily and evicted
 * after five minutes idle (Group's default `timeout`). Each user gets their own
 * concurrency + spacing budget, mirroring how Google accounts for the quota.
 */

const RATE_LIMIT_REASONS = new Set(['ratelimitexceeded', 'userratelimitexceeded']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Gaxios surfaces the HTTP status on `code`, `status`, or `response.status`. */
function statusOf(err: Record<string, unknown>): number | undefined {
  for (const candidate of [err.code, err.status]) {
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return parseInt(candidate, 10);
  }
  const responseStatus = asRecord(err.response)?.status;
  return typeof responseStatus === 'number' ? responseStatus : undefined;
}

/**
 * Google error payloads carry a machine-readable `reason` per error, either
 * flattened onto the error by googleapis or nested in the response body.
 */
function reasonsOf(err: Record<string, unknown>): string[] {
  const lists: unknown[] = [
    err.errors,
    asRecord(asRecord(asRecord(err.response)?.data)?.error)?.errors,
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

/**
 * True only for throttling responses: any 429, or a 403 whose reason is
 * rateLimitExceeded / userRateLimitExceeded.
 *
 * A plain 403 ("Insufficient Permission", "Request had insufficient
 * authentication scopes") means Gmail access was never granted — that must fail
 * immediately so emailService.syncFromGmail can tell the user to reconnect
 * Google, rather than being retried for half a minute first.
 */
export function isGmailRateLimitError(err: unknown): boolean {
  const error = asRecord(err);
  if (!error) return false;

  const status = statusOf(error);
  if (status === 429) return true;
  if (status !== 403) return false;

  if (reasonsOf(error).some((reason) => RATE_LIMIT_REASONS.has(reason))) return true;

  // Some 403s arrive with only a message ("User-rate limit exceeded"). This
  // pattern cannot match the permission-denied wording, so it stays distinct.
  const message = typeof error.message === 'string' ? error.message : '';
  return /rate limit exceeded/i.test(message);
}

/** Exponential backoff with jitter, capped at GMAIL_RETRY_MAX_MS. */
function backoffMs(retryCount: number): number {
  const capped = Math.min(env.GMAIL_RETRY_BASE_MS * 2 ** retryCount, env.GMAIL_RETRY_MAX_MS);
  // Jitter over the second half of the window so retries from a burst of
  // parallel jobs don't all come back at the same instant.
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

const gmailLimiters = new Bottleneck.Group({
  maxConcurrent: env.GMAIL_MAX_CONCURRENT,
  minTime: env.GMAIL_MIN_TIME_MS,
});

// Bottleneck's native retry: returning a number from the `failed` handler
// re-queues the job after that many milliseconds; returning nothing lets the
// error propagate to the caller unchanged.
gmailLimiters.on('created', (limiter: Bottleneck, key: string) => {
  limiter.on('failed', (error: unknown, info: Bottleneck.EventInfoRetryable) => {
    if (!isGmailRateLimitError(error)) return;
    if (info.retryCount >= env.GMAIL_MAX_RETRIES) {
      console.warn(`[GmailLimiter] Rate limited for ${key}; giving up after ${info.retryCount} retries`);
      return;
    }
    return backoffMs(info.retryCount);
  });

  limiter.on('retry', (_message: string, info: Bottleneck.EventInfoRetryable) => {
    console.warn(`[GmailLimiter] Gmail rate limited for ${key}; retry ${info.retryCount + 1}`);
  });
});

function gmailLimiterFor(key: string): Bottleneck {
  return gmailLimiters.key(key);
}

/**
 * googleapis builds its clients as a tree of `Resource$…` objects whose methods
 * are the actual HTTP calls, so recursing into those (and only those) lets us
 * throttle at one choke point instead of at every call site.
 */
function isApiResource(value: unknown): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.constructor?.name?.startsWith('Resource$') === true
  );
}

function limitedProxy<T extends object>(client: T, limiter: Bottleneck): T {
  const wrappedProps = new Map<PropertyKey, unknown>();

  // The proxy target is a blank object rather than the client itself:
  // googleapis freezes its top-level client, and a proxy is not allowed to
  // return a substitute value for a frozen (non-configurable, non-writable)
  // property. Reads are delegated to `client` explicitly instead.
  return new Proxy({} as T, {
    get(_blank, prop) {
      if (wrappedProps.has(prop)) return wrappedProps.get(prop);

      const value: unknown = Reflect.get(client, prop);
      let wrapped: unknown = value;

      if (typeof value === 'function') {
        const method = value as (...args: unknown[]) => unknown;
        // Called with the real client as `this` so googleapis internals still
        // see their own unproxied `context`.
        wrapped = (...args: unknown[]) => limiter.schedule(async () => method.apply(client, args));
      } else if (isApiResource(value)) {
        wrapped = limitedProxy(value, limiter);
      }

      wrappedProps.set(prop, wrapped);
      return wrapped;
    },
    has(_blank, prop) {
      return prop in client;
    },
  });
}

/**
 * Wrap a googleapis client so every API method it exposes runs through the
 * limiter for `key` (the userId). The returned object keeps the original type,
 * so call sites are unchanged.
 */
export function withGmailRateLimit<T extends object>(client: T, key: string): T {
  return limitedProxy(client, gmailLimiterFor(key));
}
