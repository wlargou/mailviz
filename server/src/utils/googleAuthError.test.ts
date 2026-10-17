import { describe, it, expect } from 'vitest';
import { classifyAuthFailure, classifyGoogleAuthError, httpStatusOf, tokenUnreadableError } from './googleAuthError.js';
import { INVALID_GRANT, tokenEndpointError, tokenEndpointUnreachable } from '../test/googleRefusal.js';

/**
 * Which failures mark a Google grant dead.
 *
 * Both directions cost something. Miss a refusal and the account's sync stops
 * with Settings still saying Connected — the state this exists to end. Count a
 * transient error and a working account is told to reconnect, every time
 * Google has a bad minute. The errors below are the library's own, from a real
 * OAuth2Client whose transport answers as Google would.
 */

describe('classifyGoogleAuthError — refusals', () => {
  it('reads invalid_grant off a refused refresh', async () => {
    const err = await tokenEndpointError(400, INVALID_GRANT);
    expect(classifyGoogleAuthError(err)).toBe('invalid_grant');
  });

  it('reads a Workspace re-authentication demand as invalid_grant', async () => {
    // google-auth-library rewrites this one's message to the JSON body, so a
    // check on the message alone would miss it.
    const err = await tokenEndpointError(400, {
      error: 'invalid_grant',
      error_description: 'reauth related error (invalid_rapt)',
      error_subtype: 'invalid_rapt',
    });
    expect(classifyGoogleAuthError(err)).toBe('invalid_grant');
  });

  it.each([
    [400, 'unauthorized_client'],
    [401, 'invalid_client'],
    [401, 'deleted_client'],
  ])('reads %i %s, which a changed or removed OAuth client produces', async (status, code) => {
    const err = await tokenEndpointError(status, { error: code, error_description: 'x' });
    expect(classifyGoogleAuthError(err)).toBe(code);
  });

  it('keeps the code when the error has lost its response', () => {
    expect(classifyGoogleAuthError(new Error('invalid_grant'))).toBe('invalid_grant');
  });
});

describe('classifyGoogleAuthError — everything else', () => {
  it('ignores a 500 from the token endpoint', async () => {
    const err = await tokenEndpointError(500, { error: 'internal_failure' });
    expect(httpStatusOf(err)).toBe(500);
    expect(classifyGoogleAuthError(err)).toBeNull();
  });

  it('ignores a 503 whose body is not JSON', async () => {
    const err = await tokenEndpointError(503, '<html>Service Unavailable</html>');
    expect(classifyGoogleAuthError(err)).toBeNull();
  });

  it('ignores a 429', async () => {
    const err = await tokenEndpointError(429, { error: 'rate_limit_exceeded' });
    expect(classifyGoogleAuthError(err)).toBeNull();
  });

  it('ignores a connection that never got an answer', async () => {
    const err = await tokenEndpointUnreachable();
    expect(classifyGoogleAuthError(err)).toBeNull();
  });

  it('ignores an API error, whose `error` is an object rather than a code', () => {
    // What Gmail answers a revoked access token with. It is not the grant's
    // verdict — the token endpoint's is (see noteAuthFailure's 401 probe).
    const err = Object.assign(new Error('Request had invalid authentication credentials.'), {
      status: 401,
      response: { status: 401, data: { error: { code: 401, message: 'x', status: 'UNAUTHENTICATED' } } },
    });
    expect(classifyGoogleAuthError(err)).toBeNull();
  });

  it('does not match a message that merely mentions a code', () => {
    expect(classifyGoogleAuthError(new Error('retrying after invalid_grant?'))).toBeNull();
  });

  it('ignores codes that are not refusals, and non-errors', () => {
    expect(classifyGoogleAuthError({ response: { data: { error: 'invalid_request' } } })).toBeNull();
    expect(classifyGoogleAuthError(null)).toBeNull();
    expect(classifyGoogleAuthError('invalid_grant')).toBeNull();
  });
});

describe('classifyAuthFailure', () => {
  it('reads the unreadable-credentials error as token_unreadable', () => {
    expect(classifyAuthFailure(tokenUnreadableError())).toBe('token_unreadable');
  });

  it('reads a refusal as Google’s code, like classifyGoogleAuthError', async () => {
    expect(classifyAuthFailure(await tokenEndpointError(400, INVALID_GRANT))).toBe('invalid_grant');
  });

  it('leaves a raw decryption failure alone — getAuthenticatedClient is what names it', () => {
    // The guard around `decrypt` turns it into tokenUnreadableError. Anything
    // that throws the crypto error itself is a different failure.
    expect(classifyAuthFailure(new Error('Unsupported state or unable to authenticate data'))).toBeNull();
    expect(classifyAuthFailure(Object.assign(new Error('Google not connected'), { status: 400 }))).toBeNull();
  });
});
