import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';

export const COMPANY_STATUSES = ['ACCOUNT', 'SENDER', 'IGNORED'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * Promote senders that have become accounts.
 *
 * A company is an account once there is a relationship: marked by hand (VIP,
 * a category), your own organisation, work against it (a task, deal or
 * tender), a meeting with it, or someone there you have written to. Only
 * SENDER rows move — an ignored sender stays ignored until the user says
 * otherwise, which is the point of ignoring it.
 *
 * The same rule the migration applied once; re-run after each sync, since
 * that is when new meetings and new replies arrive.
 */
export async function promoteSenders(userId: string, customerIds?: string[]): Promise<number> {
  const only = customerIds && customerIds.length > 0 ? Prisma.sql`AND c."id" IN (${Prisma.join(customerIds)})` : Prisma.empty;
  return prisma.$executeRaw`
    UPDATE "customers" c
    SET "status" = 'ACCOUNT', "updated_at" = NOW()
    WHERE c."user_id" = ${userId}
      AND c."status" = 'SENDER'
      ${only}
      AND (
        c."is_vip"
        OR c."is_internal"
        OR c."category_id" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "tasks" t WHERE t."customer_id" = c."id")
        OR EXISTS (SELECT 1 FROM "deals" d WHERE d."customer_id" = c."id")
        OR EXISTS (SELECT 1 FROM "rfps" r WHERE r."customer_id" = c."id")
        OR EXISTS (SELECT 1 FROM "calendar_event_customers" e WHERE e."customer_id" = c."id")
        OR EXISTS (
          SELECT 1 FROM "contacts" ct
          WHERE ct."customer_id" = c."id" AND ct."engagement" IN ('receiver', 'both')
        )
      )
  `;
}
