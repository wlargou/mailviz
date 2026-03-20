/**
 * Shared utility functions used across multiple services.
 */

/** Convert empty strings to null in an object (for DB inserts/updates) */
export function cleanEmptyStrings(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    cleaned[key] = value === '' ? null : value;
  }
  return cleaned;
}

/** Convert seconds to a cron expression. Supports 10s–3600s. */
export function secondsToCron(seconds: number): string {
  if (seconds < 60) {
    // Run every N seconds
    return `*/${seconds} * * * * *`;
  }
  const minutes = Math.round(seconds / 60);
  return `*/${minutes} * * * *`;
}
