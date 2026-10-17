import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { loadSecretFiles } from './src/config/secretFiles.js';

// The migrator container is given DATABASE_URL_FILE (a mounted secret) rather
// than DATABASE_URL, the same way the app is. Before `env()` below, which
// throws when the variable is unset.
loadSecretFiles(['DATABASE_URL']);

/**
 * Prisma 7 removed the `prisma` key from package.json AND stopped allowing the
 * connection URL in the schema. Both now live here.
 *
 * The paths are not defaults and cannot be omitted: the schema is at
 * src/prisma/schema.prisma with its migrations beside it, while Prisma looks
 * only in ./prisma and ./ . Without this file `npx prisma generate` finds no
 * schema — which breaks the Railway build, where nixpacks.toml runs it with no
 * --schema flag, rather than anything local.
 *
 * `dotenv/config` is imported first because the CLI reads this file directly
 * and does not load server/.env on its own. It is quiet by default, unlike
 * `dotenv.config()`, which in dotenv 17 prints a line at every load unless
 * passed `{ quiet: true }` (see env.ts).
 */
export default defineConfig({
  schema: 'src/prisma/schema.prisma',
  migrations: {
    path: 'src/prisma/migrations',
    seed: 'tsx src/prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
