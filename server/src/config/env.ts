import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Generate deterministic dev secrets from a seed (only for local development)
function devSecret(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export const env = {
  PORT: parseInt(process.env.PORT || '3002', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://mailviz:mailviz_dev@localhost:5435/mailviz_db?schema=public',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5174',
  NODE_ENV: process.env.NODE_ENV || 'development',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/api/v1/auth/google/callback',
  SYNC_INTERVAL_SECONDS: parseInt(process.env.SYNC_INTERVAL_SECONDS || '60', 10),
  EMAIL_SYNC_ENABLED: process.env.EMAIL_SYNC_ENABLED !== 'false',
  CALENDAR_SYNC_ENABLED: process.env.CALENDAR_SYNC_ENABLED !== 'false',
  CALENDAR_SYNC_INTERVAL_SECONDS: parseInt(process.env.CALENDAR_SYNC_INTERVAL_SECONDS || '120', 10),
  EMAIL_SYNC_MONTHS: parseInt(process.env.EMAIL_SYNC_MONTHS || '0', 10), // 0 = all emails
  // How far back to catch up when Gmail rejects our history token as too old.
  // Gmail retains history for roughly a week, so 7 days covers everything the
  // history feed could have returned. Bounded on purpose: the alternative is a
  // full mailbox re-sync triggered by a condition we do not control.
  SYNC_CATCHUP_DAYS: parseInt(process.env.SYNC_CATCHUP_DAYS || '7', 10),
  CALENDAR_SYNC_PAST_MONTHS: parseInt(process.env.CALENDAR_SYNC_PAST_MONTHS || '24', 10),
  CALENDAR_SYNC_FUTURE_MONTHS: parseInt(process.env.CALENDAR_SYNC_FUTURE_MONTHS || '12', 10),

  // Gmail API throttling (per user — Gmail's quota is charged per user).
  // 5 concurrent calls spaced 50ms apart caps a single user at ~20 req/s; at
  // 5 quota units for messages.get/modify that is ~100 of the 250 units/second
  // Gmail allows, leaving headroom for the calls we don't route through here.
  GMAIL_MAX_CONCURRENT: parseInt(process.env.GMAIL_MAX_CONCURRENT || '5', 10),
  GMAIL_MIN_TIME_MS: parseInt(process.env.GMAIL_MIN_TIME_MS || '50', 10),
  // Retry budget for 429 / 403 rateLimitExceeded responses. 5 retries with
  // exponential backoff from 1s, capped at 32s, rides out ~1 minute of throttling.
  GMAIL_MAX_RETRIES: parseInt(process.env.GMAIL_MAX_RETRIES || '5', 10),
  GMAIL_RETRY_BASE_MS: parseInt(process.env.GMAIL_RETRY_BASE_MS || '1000', 10),
  GMAIL_RETRY_MAX_MS: parseInt(process.env.GMAIL_RETRY_MAX_MS || '32000', 10),

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || devSecret('mailviz-jwt-dev'),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || devSecret('mailviz-jwt-refresh-dev'),
  ALLOWED_EMAILS: (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || '',
  LOGO_DEV_TOKEN: process.env.LOGO_DEV_TOKEN || 'pk_fUKO-TNBQ3SBr89r_dj_6Q',
};
