import { PrismaClient } from '@prisma/client';

// Single shared PrismaClient instance to avoid opening multiple connection pools.
// See: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections
export const prisma = new PrismaClient();
