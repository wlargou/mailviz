import { createCipheriv, randomBytes } from 'crypto';
import { google } from 'googleapis';

/**
 * The error google-auth-library actually throws when Google's token endpoint
 * answers `status` with `body` — produced by the library itself, not written
 * out by hand.
 *
 * A hand-built `{ status: 400, message: 'invalid_grant' }` is what the earlier
 * test of a revoked grant used, and it matches whatever the code under test
 * happens to read. Going through a real `OAuth2Client` with only the transport
 * replaced keeps the classifier honest about where gaxios puts the code — and
 * fails here, not in production, if a library upgrade moves it.
 *
 * Never touches the network: `fetchImplementation` answers every request.
 */
export async function tokenEndpointError(status: number, body: unknown): Promise<unknown> {
  return refreshFailure(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

/** The error when the token endpoint cannot be reached at all. */
export async function tokenEndpointUnreachable(): Promise<unknown> {
  return refreshFailure(async () => {
    throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
  });
}

async function refreshFailure(fetchImplementation: () => Promise<Response>): Promise<unknown> {
  const client = new google.auth.OAuth2({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    // The library's own retry still runs for a 5xx, a 429 or a dropped
    // connection — as it does in production, where the error the caller sees
    // is the one after the last attempt. Only the waiting between them is cut.
    transporterOptions: { fetchImplementation, retryConfig: { retryBackoff: async () => {} } },
  });
  client.setCredentials({ refresh_token: 'stored-refresh' });
  try {
    // `getAccessToken`, not `refreshAccessToken`: the service tests stub the
    // latter on the prototype, and this has to reach the real token request.
    await client.getAccessToken();
  } catch (err) {
    return err;
  }
  throw new Error('the stubbed token endpoint accepted the refresh');
}

/** Google's answer for a revoked or expired grant, as its token endpoint sends it. */
export const INVALID_GRANT = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };

/**
 * A token stored the way `encrypt` stores it, but under a key this process does
 * not hold — the database after a move to a host with a different
 * `TOKEN_ENCRYPTION_KEY`. `decrypt` throws on it, as it does in production.
 */
export function encryptedUnderAnotherKey(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 0xab), iv);
  const body = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body}`;
}
