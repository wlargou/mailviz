/**
 * Read the server's error envelope off an Axios failure.
 *
 * `errorHandler` answers `{ error: { code, message, details } }` for every
 * `AppError`. Callers that want to say WHY a write was refused — a blocked
 * task, a duplicate domain — read it from here rather than each re-deriving
 * the shape.
 */
interface ApiErrorLike {
  response?: { status?: number; data?: { error?: { code?: string; message?: string; details?: unknown } } };
}

export function apiError(err: unknown): { status?: number; code?: string; message?: string; details?: unknown } {
  const e = err as ApiErrorLike | null | undefined;
  return {
    status: e?.response?.status,
    code: e?.response?.data?.error?.code,
    message: e?.response?.data?.error?.message,
    details: e?.response?.data?.error?.details,
  };
}

/** The server's message, or the fallback when there is none. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return apiError(err).message || fallback;
}
