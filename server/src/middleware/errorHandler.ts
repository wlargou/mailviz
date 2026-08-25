import { Request, Response, NextFunction } from 'express';
import { Prisma } from '../lib/prismaClient.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  // Express's own finaliser checks this first, and so must we: an error raised
  // after something has already started writing (an OAuth `res.redirect`, a
  // streamed attachment) would otherwise throw ERR_HTTP_HEADERS_SENT from
  // inside the handler. Delegating lets Express close the connection properly
  // instead of leaving the client waiting on a response that cannot be sent.
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  /**
   * P2025 is "required record not found" — what Prisma raises when an
   * `update`/`delete` whose `where` carries the ownership filter matches
   * nothing. Every one of those is a caller asking for a row that is gone or
   * was never theirs, which is a 404, but P2025 has no `.status` so it used to
   * fall through to the generic branch below: `PATCH /task-statuses/:id` and
   * both `/reorder` handlers answered 500 INTERNAL_ERROR for another account's
   * id and logged it as an unhandled error. The write itself was always
   * correctly refused — this only ever mapped the refusal to the wrong code.
   */
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
      },
    });
    return;
  }

  // Handle errors with a custom status property (e.g. from services)
  const statusCode = (err as any).status || 500;
  if (statusCode !== 500) {
    res.status(statusCode).json({
      error: {
        code: statusCode === 403 ? 'FORBIDDEN' : 'ERROR',
        message: err.message,
      },
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
