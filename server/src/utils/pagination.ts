export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parse a query-string integer, falling back when it is not one.
 *
 * `parseInt('x', 10)` is NaN, and every arithmetic guard around it inherits
 * that: `Math.max(1, NaN)` is NaN, `Math.min(100, NaN)` is NaN. So
 * `?limit=x` produced `skip: NaN` and `take: NaN`, which Prisma rejects — a 500
 * and an 'Unhandled error' log on five list endpoints, from a malformed query
 * string that deserves a default or a 400, not a server error.
 */
function intOr(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePagination(query: { page?: string; limit?: string }): PaginationParams {
  const page = Math.max(1, intOr(query.page, 1));
  const limit = Math.min(100, Math.max(1, intOr(query.limit, 20)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function paginationMeta(total: number, params: PaginationParams) {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.ceil(total / params.limit),
  };
}
