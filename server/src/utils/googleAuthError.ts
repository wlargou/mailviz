/**
 * Whether a failure means Google refused the grant itself.
 *
 * A dead grant used to look exactly like "not connected": both schedulers
 * skipped every 400 without a word, Settings kept saying Connected, and the
 * only symptom was mail that stopped arriving. The schedulers still skip the
 * account — there is nothing to retry — but these codes are now recorded on
 * `google_auth.auth_error`, so the user is told and offered Reconnect.
 *
 * Only Google's OAuth error codes count, read from the token endpoint's body
 * (`{ error: 'invalid_grant', error_description: … }`, which gaxios keeps on
 * `err.response.data`). A 5xx, a 429 or a network error never matches: those
 * pass on their own, and marking the account dead for one would tell the user
 * to reconnect a grant that is fine.
 */
export const GOOGLE_AUTH_ERROR_CODES = [
  // Revoked by the user, expired (a Testing app's 7 days, six months unused, a
  // password change), or a Workspace re-authentication policy (`invalid_rapt`
  // arrives as an `error_subtype` of this one).
  'invalid_grant',
  // The refresh token was issued to a different OAuth client.
  'unauthorized_client',
  // The client id or secret is wrong, or the client no longer exists.
  'invalid_client',
  'deleted_client',
  // A Workspace administrator has blocked the app or one of its scopes.
  'admin_policy_enforced',
] as const;

export type GoogleAuthErrorCode = (typeof GOOGLE_AUTH_ERROR_CODES)[number];

export function isGoogleAuthErrorCode(value: unknown): value is GoogleAuthErrorCode {
  return typeof value === 'string' && (GOOGLE_AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** The body's `error` field when it is an OAuth error string, parsing a JSON body gaxios left as text. */
function oauthErrorField(data: unknown): unknown {
  let body = data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (!body || typeof body !== 'object') return undefined;
  // A Google *API* error has an object here ({ code, message, status }); only
  // the token endpoint answers with a bare string.
  return (body as { error?: unknown }).error;
}

export function classifyGoogleAuthError(err: unknown): GoogleAuthErrorCode | null {
  if (!err || typeof err !== 'object') return null;
  const { response, message } = err as { response?: { data?: unknown }; message?: unknown };

  const field = oauthErrorField(response?.data);
  if (isGoogleAuthErrorCode(field)) return field;

  // gaxios names the error after the body's code, so an error re-thrown without
  // its response still carries it — but only as the whole message. A substring
  // match would let any text that mentions "invalid_grant" mark an account dead.
  if (isGoogleAuthErrorCode(message)) return message;
  return null;
}

/**
 * Not Google's answer but ours: the stored tokens cannot be decrypted — a
 * different `TOKEN_ENCRYPTION_KEY` after a move, or a damaged row. Nothing can
 * reach Google with them, and before this it surfaced only as a crypto error
 * in the log every minute while Settings said Connected. It is recorded and
 * shown like a refusal, and fixed the same way: Reconnect Google forces
 * consent, which writes both tokens again under the current key.
 */
export const TOKEN_UNREADABLE = 'token_unreadable';

/** Every reason `google_auth.auth_error` can hold. */
export type AuthErrorCode = GoogleAuthErrorCode | typeof TOKEN_UNREADABLE;

const TOKEN_UNREADABLE_ERROR = 'GOOGLE_TOKEN_UNREADABLE';

/**
 * What `getAuthenticatedClient` throws for it. A route answers with this
 * message, so it says what to do — and it carries nothing from the row, the
 * key or the decryption failure.
 */
export function tokenUnreadableError(): Error {
  return Object.assign(new Error('Stored Google credentials can’t be read. Reconnect Google to restore sync.'), {
    status: 400,
    code: TOKEN_UNREADABLE_ERROR,
  });
}

/** Why this failure means the grant is unusable — a Google refusal, or tokens that cannot be read — or null. */
export function classifyAuthFailure(err: unknown): AuthErrorCode | null {
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === TOKEN_UNREADABLE_ERROR) {
    return TOKEN_UNREADABLE;
  }
  return classifyGoogleAuthError(err);
}

/** The HTTP status of a gaxios error, wherever this version of the library put it. */
export function httpStatusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const { status, response } = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof status === 'number') return status;
  if (typeof response?.status === 'number') return response.status;
  return undefined;
}
