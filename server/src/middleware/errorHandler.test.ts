import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { Prisma } from '../lib/prismaClient.js';
import { errorHandler, AppError } from './errorHandler.js';
import { validate } from './validate.js';

/**
 * The error boundary every route funnels into.
 *
 * Two obligations, pulling in opposite directions:
 *
 *   1. Errors the code raised deliberately must reach the client intact.
 *      Services throw in two dialects — `new AppError(404, 'TASK_NOT_FOUND', …)`
 *      and `Object.assign(new Error('Event not found'), { status: 404 })` — and
 *      both are load-bearing. The client turns a 404 into "not found" and a 403
 *      into "you don't have access"; collapse either into a 500 and every
 *      not-found in the app becomes "something went wrong".
 *
 *   2. Errors nobody planned for must reveal nothing. A Prisma failure carries
 *      the connection string, table names and a stack trace in its message.
 *      This handler is the only thing between that and the browser, and the
 *      difference between safe and leaking is one interpolation.
 *
 * The composed block at the bottom runs through a real Express app, because the
 * contract that matters in production is not "the function returns the right
 * object" but "a throw in a controller becomes this response" — which depends
 * on Express forwarding async rejections and on validate() answering bad input
 * itself rather than punting it here.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface Captured {
  statusCode: number | null;
  body: unknown;
}

function makeRes() {
  const captured: Captured = { statusCode: null, body: undefined };
  const fake = {
    status(code: number) {
      captured.statusCode = code;
      return fake;
    },
    json(payload: unknown) {
      captured.body = payload;
      return fake;
    },
  };
  return { res: fake as unknown as Response, captured };
}

const req = {} as unknown as Request;

/**
 * A recording `next`. Hand-rolled rather than `vi.fn()` because Express's
 * NextFunction is an overloaded call signature that a Mock does not satisfy
 * without an unsafe cast.
 */
function makeNext() {
  const calls: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    calls.push(err);
  };
  return { next, calls };
}

describe('errorHandler — AppError', () => {
  it('surfaces the status, code and message the thrower chose', async () => {
    const { res, captured } = makeRes();

    errorHandler(new AppError(404, 'TASK_NOT_FOUND', 'Task not found'), req, res, makeNext().next);

    expect(captured.statusCode).toBe(404);
    expect(captured.body as ErrorBody).toMatchObject({
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  });

  it('keeps a domain code distinct from the generic ones', async () => {
    // `labelService` throws LABEL_EXISTS on a 409 and the client keys its
    // "that name is taken" message off the code, not the status.
    const { res, captured } = makeRes();

    errorHandler(
      new AppError(409, 'LABEL_EXISTS', 'Label "Work" already exists'),
      req,
      res,
      makeNext().next
    );

    expect(captured.statusCode).toBe(409);
    expect((captured.body as ErrorBody).error.code).toBe('LABEL_EXISTS');
  });

  it('passes structured details through', async () => {
    const { res, captured } = makeRes();

    errorHandler(
      new AppError(400, 'BAD_RANGE', 'Invalid range', { field: 'remindAt' }),
      req,
      res,
      makeNext().next
    );

    expect((captured.body as ErrorBody).error.details).toEqual({ field: 'remindAt' });
  });

  it('does not call next()', async () => {
    // This is the last handler in the chain; calling next() hands the error to
    // Express's default finaliser, which would try to respond a second time.
    const { res } = makeRes();
    const { next, calls } = makeNext();

    errorHandler(new AppError(404, 'NOPE', 'nope'), req, res, next);

    expect(calls).toHaveLength(0);
  });
});

describe('errorHandler — errors carrying a status property', () => {
  it('surfaces the status and message from the Object.assign dialect', async () => {
    // The dominant pattern in this codebase — calendarService, draftService,
    // onboardingService and others all throw this shape. If it fell through to
    // the 500 branch, every "not found" in the app would read as a server
    // crash and the client's 404 handling would never fire.
    const { res, captured } = makeRes();
    const err = Object.assign(new Error('Event not found'), { status: 404 });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(404);
    expect(captured.body as ErrorBody).toEqual({
      error: { code: 'ERROR', message: 'Event not found' },
    });
  });

  it('labels a 403 FORBIDDEN', async () => {
    // Sharing checks throw 403; the client distinguishes "you can't" from
    // "it isn't there" by this code.
    const { res, captured } = makeRes();
    const err = Object.assign(new Error('Not allowed'), { status: 403 });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(403);
    expect((captured.body as ErrorBody).error.code).toBe('FORBIDDEN');
  });

  it('surfaces a 400 with its message', async () => {
    const { res, captured } = makeRes();
    const err = Object.assign(new Error('Google Calendar not connected'), { status: 400 });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(400);
    expect((captured.body as ErrorBody).error.message).toBe('Google Calendar not connected');
  });
});

describe('errorHandler — unknown errors', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The handler logs unhandled errors on purpose; keep the test output clean.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('answers 500 INTERNAL_ERROR with a generic message', async () => {
    const { res, captured } = makeRes();

    errorHandler(new Error('boom'), req, res, makeNext().next);

    expect(captured.statusCode).toBe(500);
    expect(captured.body as ErrorBody).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('does not leak the error message to the client', async () => {
    // The realistic payload: a driver error naming the host, database and
    // credentials. `message: err.message` in the 500 branch is a one-word edit
    // that publishes all of it, and no happy-path test would notice.
    const { res, captured } = makeRes();
    const leaky = new Error(
      'connect ECONNREFUSED postgresql://mailviz:mailviz_dev@10.0.0.4:5432/mailviz_db'
    );

    errorHandler(leaky, req, res, makeNext().next);

    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('mailviz_dev');
    expect(serialised).not.toContain('10.0.0.4');
  });

  it('does not leak the stack trace', async () => {
    const { res, captured } = makeRes();
    const err = new Error('boom');

    errorHandler(err, req, res, makeNext().next);

    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain('stack');
    // `error.stack`, not `stack`: the body is always shaped { error: { … } }, so
    // a top-level key could never appear no matter what the handler emitted —
    // adding `stack: err.stack` inside the error object left the old assertion
    // silent and only the substring check above caught it.
    expect(captured.body).not.toHaveProperty('error.stack');
  });

  it('stays generic for an error that explicitly carries status 500', async () => {
    // `status: 500` takes the same branch as no status at all — deliberately.
    // A service that decides "this is a server error" still must not choose the
    // wording the client sees.
    const { res, captured } = makeRes();
    const err = Object.assign(new Error('gmail token decrypt failed for user abc'), {
      status: 500,
    });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(500);
    expect((captured.body as ErrorBody).error.message).toBe('An unexpected error occurred');
    expect(JSON.stringify(captured.body)).not.toContain('decrypt');
  });

  it('logs the real error server-side so it is still debuggable', async () => {
    // The message is withheld from the client, not thrown away — otherwise a
    // 500 in production would be unattributable.
    const { res } = makeRes();
    const err = new Error('boom');

    errorHandler(err, req, res, makeNext().next);

    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0]).toContain(err);
  });

  it('does not call next()', async () => {
    const { res } = makeRes();
    const { next, calls } = makeNext();

    errorHandler(new Error('boom'), req, res, next);

    expect(calls).toHaveLength(0);
  });
});

/**
 * Through a real Express app: the contract as a controller experiences it.
 */
describe('errorHandler — wired into Express', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let handledErrors: number;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    handledErrors = 0;
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const schema = z.object({ title: z.string().min(1), position: z.number().int() });

  function makeApp() {
    const app = express();
    app.use(express.json());

    app.get('/app-error', () => {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    });

    app.get('/async-status-error', async () => {
      await Promise.resolve();
      throw Object.assign(new Error('Draft not found'), { status: 404 });
    });

    app.get('/async-unknown-error', async () => {
      await Promise.resolve();
      throw new Error('prisma: relation "emails" does not exist');
    });

    app.post('/validated', validate(schema), (req: Request, res: Response) => {
      // Echo it back: "untouched" is a claim about req.body, and a handler that
      // ignores req.body cannot support it. validate() replacing the body with
      // {} passed the old version of this test.
      res.json({ ok: true, body: req.body });
    });

    app.use((err: Error, r: Request, res: Response, next: NextFunction) => {
      handledErrors += 1;
      errorHandler(err, r, res, next);
    });

    return app;
  }

  it('turns a thrown AppError into its own status and code', async () => {
    const res = await request(makeApp()).get('/app-error');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('DEAL_NOT_FOUND');
  });

  it('turns a rejected async handler into its status rather than hanging', async () => {
    // Express 5 forwards promise rejections to the error middleware. If that
    // ever stopped being true, this request would time out instead of 404ing —
    // the failure mode is a hung client, not an error page.
    const res = await request(makeApp()).get('/async-status-error');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.message).toBe('Draft not found');
  });

  it('turns an unexpected async rejection into an opaque 500', async () => {
    const res = await request(makeApp()).get('/async-unknown-error');

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('prisma');
    expect(JSON.stringify(res.body)).not.toContain('emails');
  });

  it('answers a bad request body with 400 and field detail, never a 500 — REGRESSION', async () => {
    // Validation failures used to arrive here as 500s: `validate` built its
    // response with Zod v3's `err.errors`, which v4 renamed to `.issues`, so
    // the catch block threw and Express turned every rejected body in the app
    // into "an unexpected error occurred". `validate.test.ts` pins the
    // middleware in isolation; this pins the pair, which is what the client
    // actually meets — and it also asserts the error handler is never reached,
    // because a 400 produced *here* would have lost the field details.
    const app = makeApp();

    const res = await request(app).post('/validated').send({ title: '', position: 1.5 });

    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const fields = (body.error.details as Array<{ field: string }>).map((d) => d.field);
    expect(fields).toContain('title');
    expect(fields).toContain('position');
    expect(handledErrors).toBe(0);
  });

  it('lets a valid body through untouched', async () => {
    const res = await request(makeApp()).post('/validated').send({ title: 'Ship it', position: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, body: { title: 'Ship it', position: 1 } });
    expect(handledErrors).toBe(0);
  });
});

describe('errorHandler — Prisma codes it does and does not claim', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('maps P2025 to 404', () => {
    // The branch existed and nothing covered it — a grep for P2025 in this file
    // returned nothing before this test, so deleting it reddened no assertion.
    const { res, captured } = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '7.0.0',
    });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(404);
    expect((captured.body as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('leaves P2002 as a logged 500, deliberately', () => {
    // This pins a DECISION, not an oversight. A unique violation is sometimes
    // the caller's fault — a company domain they already have — and sometimes
    // ours: `findOrCreateByDomain` is check-then-create, raced by the email and
    // calendar schedulers on their 60s and 120s ticks. The middleware sees one
    // indistinguishable error for both.
    //
    // Mapping it centrally to 409 would return before the logging branch, so
    // the race would stop being reported at all — a concurrency bug quietly
    // relabelled as the client's mistake. Conflicts that ARE the caller's
    // fault are answered at their call site, where the message can name the
    // concept; customerService.create is one.
    const { res, captured } = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: { target: ['user_id', 'domain'] },
    });

    errorHandler(err, req, res, makeNext().next);

    expect(captured.statusCode).toBe(500);
    // The load-bearing half: it must still reach the logs.
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0]).toContain(err);
  });

  it('never echoes the constraint back to the caller', () => {
    const { res, captured } = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: { target: ['user_id', 'domain'] },
    });

    errorHandler(err, req, res, makeNext().next);

    const body = JSON.stringify(captured.body);
    expect(body).not.toContain('user_id');
    expect(body).not.toContain('domain');
    expect(body).not.toContain('P2002');
  });
});

