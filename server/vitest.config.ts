import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './src/test/databaseUrl';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    globalSetup: ['src/test/globalSetup.ts'],

    // `env` is applied before any module is imported, which matters: lib/prisma.ts
    // constructs its PrismaClient at import time from DATABASE_URL. Setting this
    // inside a setup file would be too late and the tests would run against the
    // development database.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
      // Deterministic secrets so token tests don't depend on the developer's .env.
      JWT_SECRET: 'test-jwt-secret',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
      // 32 bytes of hex — exercises the real AES-256-GCM path rather than the
      // plaintext fallback. The fallback has its own dedicated test.
      TOKEN_ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    },

    // These tests share one Postgres database and TRUNCATE every table between
    // cases, which takes an AccessExclusiveLock. `fileParallelism: false` alone
    // is not enough — Vitest still spins up several workers, and two of them
    // truncating at once deadlocks (Postgres 40P01). A single fork serialises
    // every database interaction, which is what this suite needs.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.test.ts', 'src/prisma/**'],
    },
  },
});
