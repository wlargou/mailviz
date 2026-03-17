import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '3002', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://mailviz:mailviz_dev@localhost:5433/mailviz_db?schema=public',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  NODE_ENV: process.env.NODE_ENV || 'development',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/api/v1/auth/google/callback',
  SYNC_INTERVAL_SECONDS: parseInt(process.env.SYNC_INTERVAL_SECONDS || '60', 10),
  EMAIL_SYNC_ENABLED: process.env.EMAIL_SYNC_ENABLED !== 'false', // enabled by default
};
