import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Generate deterministic dev secrets from a seed (only for local development)
function devSecret(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export const env = {
  PORT: parseInt(process.env.PORT || '3002', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://mailviz:mailviz_dev@localhost:5433/mailviz_db?schema=public',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  NODE_ENV: process.env.NODE_ENV || 'development',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/api/v1/auth/google/callback',
  SYNC_INTERVAL_SECONDS: parseInt(process.env.SYNC_INTERVAL_SECONDS || '60', 10),
  EMAIL_SYNC_ENABLED: process.env.EMAIL_SYNC_ENABLED !== 'false',
  CALENDAR_SYNC_ENABLED: process.env.CALENDAR_SYNC_ENABLED !== 'false',
  CALENDAR_SYNC_INTERVAL_SECONDS: parseInt(process.env.CALENDAR_SYNC_INTERVAL_SECONDS || '120', 10),
  EMAIL_SYNC_MONTHS: parseInt(process.env.EMAIL_SYNC_MONTHS || '3', 10),
  CALENDAR_SYNC_PAST_MONTHS: parseInt(process.env.CALENDAR_SYNC_PAST_MONTHS || '3', 10),
  CALENDAR_SYNC_FUTURE_MONTHS: parseInt(process.env.CALENDAR_SYNC_FUTURE_MONTHS || '6', 10),

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || devSecret('mailviz-jwt-dev'),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || devSecret('mailviz-jwt-refresh-dev'),
  ALLOWED_EMAILS: (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || '',
};
