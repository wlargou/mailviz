import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validate } from './validate.js';

/**
 * Request-body validation middleware.
 *
 * REGRESSION. Zod v4 removed `ZodError.errors` in favour of `.issues`. This
 * middleware built its response with `err.errors.map(...)`, so on the upgrade
 * every validation failure threw a TypeError *inside the catch block*. The
 * error escaped the middleware, Express turned it into a 500, and the client
 * got an opaque server error instead of a 400 naming the bad field.
 *
 * It was invisible in normal use because nothing on the happy path touches the
 * catch block — you only see it by sending a bad request, and the symptom
 * ("the API 500s sometimes") looks nothing like a Zod upgrade. Every write
 * endpoint in the app was affected simultaneously.
 *
 * The assertions that matter are: the middleware must not throw, the status
 * must be 400 and not 500, and `details` must actually name the offending
 * field — a 400 with an empty details array would be the same bug wearing a
 * different hat.
 *
 * A hand-rolled req/res/next keeps this a unit test of the middleware; booting
 * Express would put the framework's own error handling between us and the bug.
 */

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
}

interface FakeResponse {
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
}

function makeRes() {
  const captured: CapturedResponse = { statusCode: null, body: undefined };
  const fake: FakeResponse = {
    status(code) {
      captured.statusCode = code;
      return fake;
    },
    json(payload) {
      captured.body = payload;
      return fake;
    },
  };
  return { res: fake as unknown as Response, captured };
}

function makeReq(body: unknown) {
  return { body } as unknown as Request;
}

/**
 * A recording `next`. Hand-rolled rather than `vi.fn()` because Express's
 * NextFunction is an overloaded call signature ('router' / 'route' deferrals)
 * that a Mock<NextFunction> does not satisfy without an unsafe cast.
 */
function makeNext() {
  const calls: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    calls.push(err);
  };
  return { next, calls };
}

interface ValidationErrorBody {
  error: {
    code: string;
    message: string;
    details: Array<{ field: string; message: string }>;
  };
}

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
  nickname: z.string().optional(),
});

describe('validate middleware — failures', () => {
  it('returns 400 with field details instead of crashing — REGRESSION', () => {
    const req = makeReq({ name: '', age: 30 });
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();

    // The bug: `err.errors` was undefined, so this call threw a TypeError.
    expect(() => validate(schema)(req, res, next)).not.toThrow();

    expect(captured.statusCode).toBe(400);
    expect(captured.statusCode).not.toBe(500);

    const body = captured.body as ValidationErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((d) => d.field)).toContain('name');
    expect(body.error.details[0].message).toBeTruthy();

    // A validation failure is fully handled here; passing it on would let the
    // error handler respond a second time.
    expect(calls).toHaveLength(0);
  });

  it('names a missing required field', () => {
    const req = makeReq({ name: 'Ada' });
    const { res, captured } = makeRes();

    validate(schema)(req, res, makeNext().next);

    const body = captured.body as ValidationErrorBody;
    expect(captured.statusCode).toBe(400);
    expect(body.error.details.map((d) => d.field)).toContain('age');
  });

  it('reports every offending field, not just the first', () => {
    const req = makeReq({ name: '', age: -1 });
    const { res, captured } = makeRes();

    validate(schema)(req, res, makeNext().next);

    const fields = (captured.body as ValidationErrorBody).error.details.map((d) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('age');
  });

  it('dot-joins nested field paths so the client can point at the right input', () => {
    const nested = z.object({ profile: z.object({ email: z.string().email() }) });
    const req = makeReq({ profile: { email: 'not-an-email' } });
    const { res, captured } = makeRes();

    validate(nested)(req, res, makeNext().next);

    const fields = (captured.body as ValidationErrorBody).error.details.map((d) => d.field);
    expect(fields).toContain('profile.email');
  });

  it('handles a body that is not an object at all', () => {
    const { res, captured } = makeRes();

    expect(() => validate(schema)(makeReq(undefined), res, makeNext().next)).not.toThrow();

    expect(captured.statusCode).toBe(400);
    expect((captured.body as ValidationErrorBody).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('validate middleware — success', () => {
  it('calls next() and leaves the parsed body on the request', () => {
    const req = makeReq({ name: 'Ada', age: 36 });
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();

    validate(schema)(req, res, next);

    // One call, with no error argument — anything else means the request would
    // be routed into the error handler instead of the controller.
    expect(calls).toEqual([undefined]);
    expect(captured.statusCode).toBeNull();
    expect(req.body).toEqual({ name: 'Ada', age: 36 });
  });

  it('replaces req.body with the parsed result, dropping unknown keys', () => {
    // Controllers read req.body after this runs, so the *parsed* object has to
    // land back on the request — assigning to a local would silently pass
    // unvalidated input downstream.
    const req = makeReq({ name: 'Ada', age: 36, isAdmin: true });
    const { res } = makeRes();

    validate(schema)(req, res, makeNext().next);

    expect(req.body).toEqual({ name: 'Ada', age: 36 });
    expect(req.body).not.toHaveProperty('isAdmin');
  });

  it('forwards non-Zod errors to next() rather than reporting them as validation failures', () => {
    const exploding = z.object({ name: z.string() }).superRefine(() => {
      throw new TypeError('boom');
    });
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();

    validate(exploding)(makeReq({ name: 'Ada' }), res, next);

    expect(captured.statusCode).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(TypeError);
  });
});
