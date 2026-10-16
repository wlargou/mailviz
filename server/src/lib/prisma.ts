import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Email } from './prismaClient.js';
import { env } from '../config/env.js';

const EMAIL_OMIT = { bodyText: true, searchHead: true, searchBody: true } as const;

/** An email row as this client returns it: without mail search's columns. */
export type EmailRow = Omit<Email, keyof typeof EMAIL_OMIT>;

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
  // Mail search's columns: a message's whole text, twice over once folded.
  // Nothing displays them, and every email row the API returns is spread from
  // a query result, so they are left out unless a query asks for them.
  omit: { email: EMAIL_OMIT },
});
