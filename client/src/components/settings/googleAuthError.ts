/**
 * What a refused Google grant means, in words for the person whose sync stopped.
 *
 * The codes are Google's own OAuth errors, recorded by the server
 * (`server/src/utils/googleAuthError.ts`), plus one of the server's own:
 * `token_unreadable`, stored tokens it cannot decrypt (a changed encryption
 * key). Most are fixed by Reconnect Google, which asks for consent again and
 * keeps every synced row; the client ones are not, and saying "reconnect"
 * there would send the user round in circles.
 */
const MESSAGES: Record<string, string> = {
  invalid_grant:
    'Google no longer accepts this app’s access to your account: it was removed from your Google account, it expired, or your Google password changed. Reconnect Google to resume.',
  unauthorized_client:
    'Your connection was made for a different registration of this app. Reconnect Google to resume.',
  invalid_client:
    'Google does not recognise this app’s own credentials. Reconnecting will not help until an administrator corrects the app’s Google configuration.',
  deleted_client:
    'Google does not recognise this app’s own credentials. Reconnecting will not help until an administrator corrects the app’s Google configuration.',
  admin_policy_enforced:
    'Your Google Workspace administrator has blocked this app. Ask them to allow it, then reconnect Google.',
  token_unreadable: 'Stored Google credentials can’t be read. Reconnect Google to restore sync.',
};

const FALLBACK = 'Google refused this app’s access to your account. Reconnect Google to resume.';

export function describeGoogleAuthError(code: string): string {
  return MESSAGES[code] ?? FALLBACK;
}
