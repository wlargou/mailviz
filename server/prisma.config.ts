import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

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
 * and does not load server/.env on its own.
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
