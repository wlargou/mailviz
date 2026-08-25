import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './prismaClient.js';
import { env } from '../config/env.js';

/**
 * Single shared PrismaClient instance to avoid opening multiple connection pools.
 * See: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections
 *
 * Prisma 7 removed the Rust query engine, and with it the ability for the client
 * to open its own connection: a driver adapter is now mandatory and
 * `new PrismaClient()` with no arguments no longer works. The URL comes from
 * `env` rather than the schema, which in Prisma 7 is no longer allowed to carry
 * one.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});
