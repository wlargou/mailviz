import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { prisma } from '../lib/prisma.js';
import { wsEmitToUser } from '../websocket.js';
import {
  classifyAuthFailure,
  classifyGoogleAuthError,
  httpStatusOf,
  TOKEN_UNREADABLE,
  tokenUnreadableError,
  type AuthErrorCode,
} from '../utils/googleAuthError.js';

/**
 * Exported so tests can assert against the same list the check uses. Hardcoding
 * the scopes in a test instead means the "fully scoped" case drifts out of date
 * the moment a scope is added, and starts passing for the wrong reason.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Google may answer with the short OpenID names for the two profile scopes.
const SCOPE_ALIASES: Record<string, string> = {
  email: 'https://www.googleapis.com/auth/userinfo.email',
  profile: 'https://www.googleapis.com/auth/userinfo.profile',
};

/**
 * The required scopes a stored grant lacks.
 *
 * Whole words, not `includes` on the string: `…/auth/calendar.readonly` would
 * otherwise pass for `…/auth/calendar`. A null scope — rows from before the
 * column was written — is taken as complete, as it always has been.
 */
export function missingScopes(granted: string | null): string[] {
  if (!granted) return [];
  const have = new Set(granted.split(/\s+/).filter(Boolean).map((s) => SCOPE_ALIASES[s] ?? s));
  return SCOPES.filter((s) => !have.has(s));
}

/** What `google:auth` carries and `getStatus` reports: why Google refused the grant, and since when. */
export interface GoogleAuthErrorState {
  code: string;
  at: Date | null;
}

/**
 * The grant a piece of work started with: the stored refresh token, exactly as
 * stored (ciphertext). Opaque — only ever compared with the column, never
 * decrypted or logged. Null when the account has no connection.
 *
 * A refusal is recorded only while this is still what is stored. Without it a
 * sync that read the old, dead grant and failed just after a Reconnect wrote
 * the error back over the new one — and a working sync never clears it, so
 * Settings said "Sync has stopped" for most of an hour while sync worked.
 */
export type GrantSnapshot = string | null;

function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

interface ExchangeResult {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  tokens: {
    accessToken: string;
    /**
     * Absent whenever Google has already granted this app to this account and
     * the request did not force consent — which is most logins. The old type
     * claimed it was always present and the exchange asserted it with `!`, so
     * the value reached `encrypt()` as undefined and threw.
     */
    refreshToken?: string;
    expiryDate: number;
    /**
     * The scopes Google granted, space-separated, from the token response. A
     * user can untick one on the consent screen, so this — not `SCOPES` — is
     * what the grant can do.
     */
    scope?: string;
  };
}

export const googleAuthService = {
  /**
   * Generate Google OAuth URL.
   * intent='login': used for the login flow (state=login)
   * intent='connect': used for connecting Gmail/Calendar (state is a signed JWT containing userId)
   */
  async getAuthUrl(
    intent: 'login' | 'connect' = 'login',
    userId?: string,
    options: { forceConsent?: boolean } = {}
  ) {
    const oauth2Client = createOAuth2Client();

    /**
     * Consent is forced when connecting, when the caller asks (the callback's
     * recovery path), or when this account has no Google connection yet — only
     * a consent prompt yields a refresh token.
     *
     * The account check used to be `findFirst()` with no `where`, asking whether
     * *anybody* in the database had connected Google. Once one account had, every
     * later login — including a second user's very first — was sent with
     * `prompt: select_account`, so Google withheld the refresh token and the
     * callback threw. On a login there is no user to scope by yet, which is
     * exactly why the recovery path in the callback exists.
     */
    let needsConsent = intent === 'connect' || options.forceConsent === true;
    if (!needsConsent && userId) {
      const existingAuth = await prisma.googleAuth.findUnique({ where: { userId } });
      if (!existingAuth) needsConsent = true;
    }

    // For the connect flow, sign the userId into a short-lived JWT to prevent state tampering (S2)
    let state = 'login';
    if (intent === 'connect' && userId) {
      state = jwt.sign({ sub: userId, intent: 'connect' }, env.JWT_SECRET, { expiresIn: '10m' });
    }

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: needsConsent ? 'consent' : 'select_account',
      state,
    });
  },

  /**
   * Verify and extract userId from a signed OAuth state parameter.
   * Returns null if the state is invalid or expired.
   */
  verifyOAuthState(state: string): string | null {
    try {
      const payload = jwt.verify(state, env.JWT_SECRET) as { sub: string; intent: string };
      if (payload.intent !== 'connect' || !payload.sub) return null;
      return payload.sub;
    } catch {
      return null;
    }
  },

  /**
   * Exchange authorization code for tokens + user info.
   */
  async exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let email: string | null = null;
    let name: string | null = null;
    let avatarUrl: string | null = null;

    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data: userInfo } = await oauth2.userinfo.get();
      email = userInfo.email || null;
      name = userInfo.name || null;
      avatarUrl = userInfo.picture || null;
    } catch {
      // Scope may not include userinfo
    }

    return {
      email,
      name,
      avatarUrl,
      tokens: {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token ?? undefined,
        expiryDate: tokens.expiry_date!,
        scope: tokens.scope ?? undefined,
      },
    };
  },

  /**
   * Upsert GoogleAuth record linked to a user.
   */
  async upsertGoogleAuth(userId: string, tokens: ExchangeResult['tokens']) {
    const existing = await prisma.googleAuth.findUnique({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId } });

    const authData = {
      accessToken: encrypt(tokens.accessToken),
      tokenExpiry: new Date(tokens.expiryDate),
      // What Google granted, not what was asked for: this used to be
      // `SCOPES.join(' ')` whatever the user ticked, so a connection without
      // Gmail read as complete and every Gmail call 403'd. Kept as stored when
      // the response carries none rather than guessed.
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      userId,
      // Only when Google actually sent one. On a re-authorisation it does not,
      // and the stored token stays valid — overwriting it with undefined is what
      // produced the 500, and blanking it would have been worse: the account
      // could never refresh again.
      ...(tokens.refreshToken ? { refreshToken: encrypt(tokens.refreshToken) } : {}),
    };

    if (existing) {
      await prisma.googleAuth.update({
        where: { id: existing.id },
        data: { ...authData, email: user?.email || existing.email },
      });
    } else {
      if (!tokens.refreshToken) {
        // Nothing stored and nothing granted: an access token alone expires in an
        // hour with no way to renew it, so this connection would silently die.
        // The caller re-runs the flow forcing consent.
        throw Object.assign(new Error('Google did not return a refresh token'), {
          status: 400,
          code: 'GOOGLE_REFRESH_TOKEN_MISSING',
        });
      }
      await prisma.googleAuth.create({
        data: { ...authData, refreshToken: encrypt(tokens.refreshToken), email: user?.email || null },
      });
    }

    // A new refresh token is a new grant, so whatever Google refused before no
    // longer applies. A login that brought none leaves the refused one in place
    // — and with it the error, which the next sync would only write back.
    if (tokens.refreshToken) await googleAuthService.clearAuthError(userId);

    // Auto-create/mark the user's own company as internal
    if (user?.email) {
      const domain = user.email.split('@')[1]?.toLowerCase();
      if (domain) {
        const existingCustomer = await prisma.customer.findUnique({
          where: { userId_domain: { userId, domain } },
        });
        if (existingCustomer) {
          if (!existingCustomer.isInternal) {
            await prisma.customer.update({
              where: { id: existingCustomer.id },
              data: { isInternal: true },
            });
          }
        } else {
          const { domainToCompanyName, getLogoUrl } = await import('../utils/domainResolver.js');
          const name = domainToCompanyName(domain);
          await prisma.customer.create({
            data: {
              name,
              company: name,
              domain,
              website: `https://${domain}`,
              logoUrl: getLogoUrl(domain),
              isInternal: true,
              status: 'ACCOUNT',
              userId,
            },
          });
        }
      }
    }
  },

  async getStatus(userId: string) {
    // Required, not optional. The `userId ? { userId } : {}` shape this replaces
    // meant a caller that forgot the argument silently read *whichever*
    // connection happened to be first in the table — the same shape that let a
    // cross-tenant `disconnect` regression pass its test. Both call sites
    // already pass a user, so the optional case only ever existed as a trap.
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) {
      return { connected: false };
    }

    // A grant missing a scope and a grant Google refused are fixed the same way:
    // a forced-consent reconnect, which keeps every synced row.
    const authError: GoogleAuthErrorState | null = auth.authError
      ? { code: auth.authError, at: auth.authErrorAt }
      : null;
    const needsReauth = authError !== null || missingScopes(auth.scope).length > 0;

    return {
      connected: true,
      email: auth.email,
      lastSyncAt: auth.lastSyncAt,
      lastMailSyncAt: auth.lastMailSyncAt,
      needsReauth,
      authError,
    };
  },

  /** What identifies the grant this account has stored right now — taken when a piece of work starts. */
  async currentGrant(userId: string): Promise<GrantSnapshot> {
    const row = await prisma.googleAuth.findUnique({ where: { userId }, select: { refreshToken: true } });
    return row?.refreshToken ?? null;
  },

  /**
   * Record that Google refused this account's grant.
   *
   * Conditional on the stored code differing, so the mail and calendar syncs
   * hitting the same dead grant every minute write, log and announce it once
   * between them — the line per tick is what made the old silence tempting.
   *
   * And conditional on `grant` — the one that was refused — still being the
   * stored one: a Reconnect that landed while the refused request was in
   * flight has already replaced it, and its error is not the new grant's.
   * Returns whether anything changed.
   */
  async recordAuthError(userId: string, code: AuthErrorCode, grant: string): Promise<boolean> {
    const at = new Date();
    // `OR … null` spelled out: Prisma's `not` leaves out NULL rows, which is
    // every healthy one.
    const { count } = await prisma.googleAuth.updateMany({
      where: { userId, refreshToken: grant, OR: [{ authError: null }, { authError: { not: code } }] },
      data: { authError: code, authErrorAt: at },
    });
    if (count === 0) return false;
    console.warn(
      code === TOKEN_UNREADABLE
        ? `[GoogleAuth] The stored Google tokens for ${userId} cannot be decrypted (${code}) — its sync is stopped until it reconnects`
        : `[GoogleAuth] Google refused the grant for ${userId} (${code}) — its sync is stopped until it reconnects`
    );
    wsEmitToUser(userId, 'google:auth', { authError: { code, at } satisfies GoogleAuthErrorState });
    return true;
  },

  /** The grant works again: clear the error, once, and tell the account's open tabs. */
  async clearAuthError(userId: string): Promise<boolean> {
    const { count } = await prisma.googleAuth.updateMany({
      where: { userId, authError: { not: null } },
      data: { authError: null, authErrorAt: null },
    });
    if (count === 0) return false;
    console.log(`[GoogleAuth] Google accepts the grant for ${userId} again`);
    wsEmitToUser(userId, 'google:auth', { authError: null });
    return true;
  },

  /**
   * Whether a sync failed because Google refused the grant, or because the
   * stored tokens cannot be read (`token_unreadable`) — recorded if so.
   *
   * For the schedulers and the manual syncs, which skip the account either way:
   * this decides whether Settings hears about it, and lets the caller stay
   * quiet instead of logging the same refusal every tick. Never throws — it
   * runs inside their catch blocks.
   *
   * A 401 is checked rather than trusted. It is what an API answers once the
   * user has revoked the grant, but google-auth-library does not refresh on a
   * 401 when the token's expiry is known, so the refusal itself only surfaced
   * at the next proactive refresh — up to fifty minutes later. Forcing one
   * asks the token endpoint now, and records whatever it says.
   *
   * `grant` is `currentGrant` as it was when the failed work started. A
   * refusal of a grant that has since been replaced is still the caller's to
   * skip quietly, but is not recorded.
   */
  async noteAuthFailure(userId: string, err: unknown, grant: GrantSnapshot): Promise<boolean> {
    const code = classifyAuthFailure(err);
    try {
      if (code) {
        if (grant !== null) await googleAuthService.recordAuthError(userId, code, grant);
        return true;
      }
      if (httpStatusOf(err) !== 401) return false;
      await googleAuthService.getAuthenticatedClient(userId, true);
      const row = await prisma.googleAuth.findUnique({ where: { userId }, select: { authError: true } });
      return Boolean(row?.authError);
    } catch (recordErr) {
      console.error('[GoogleAuth] Could not record a refused grant:', (recordErr as Error)?.message ?? recordErr);
      return code !== null;
    }
  },

  /**
   * Tell Google to drop the grant for this account.
   *
   * Best effort by design, and separated out because account deletion needs it
   * too: leaving a live grant behind after the local rows are gone means the
   * app still appears in the user's Google account page with no way for us to
   * remove it. Throws nothing the caller must handle — an already-expired token
   * is the normal case, not an error.
   */
  async revokeTokens(userId: string): Promise<void> {
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) return;
    try {
      const oauth2Client = createOAuth2Client();
      const accessToken = decrypt(auth.accessToken);
      oauth2Client.setCredentials({ access_token: accessToken });
      await oauth2Client.revokeToken(accessToken);
    } catch {
      // Token may already be invalid
    }
  },

  async disconnect(userId: string) {
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) return;

    await this.revokeTokens(userId);

    /**
     * Delete the synced data in a transaction, so a failure part-way cannot
     * leave emails pointing at deleted companies.
     *
     * Every statement is scoped to the account being disconnected, taken from
     * the row that was just looked up. These used to be unscoped
     * (`deleteMany({})`), which meant one user pressing "Disconnect
     * Google" emptied every other user's mailbox, calendar, contacts and
     * companies, and unlinked their tasks. The tables without their own
     * `user_id` are reached through the relation that has one.
     */
    const ownerId = auth.userId;
    await prisma.$transaction([
      // 1. Unlink this user's tasks from companies (keep the tasks — they are
      //    the user's own work, not synced data)
      prisma.task.updateMany({
        where: { userId: ownerId, customerId: { not: null } },
        data: { customerId: null },
      }),
      // 2. Delete MailToTask links (before deleting emails)
      prisma.mailToTask.deleteMany({ where: { email: { userId: ownerId } } }),
      // 3. Delete email attachments
      prisma.emailAttachment.deleteMany({ where: { email: { userId: ownerId } } }),
      // 4. Delete this user's emails
      prisma.email.deleteMany({ where: { userId: ownerId } }),
      // 5. Delete calendar event-company links
      prisma.calendarEventCustomer.deleteMany({ where: { calendarEvent: { userId: ownerId } } }),
      // 6. Delete the calendar events that came FROM Google. An event created
      //    here that never reached Google is the user's own work, not synced
      //    data — the same test step 1 applies to tasks, and the same one the
      //    sync's orphan reconciliation already applies to a row Google has
      //    never seen.
      prisma.calendarEvent.deleteMany({
        where: { userId: ownerId, googleEventId: { not: null } },
      }),
      // 7. Nothing will ever push the survivors: the retry sweep enumerates
      //    accounts from GoogleAuth, which this transaction deletes, and the
      //    Sync button is hidden while disconnected. A marker left behind would
      //    age into a permanent "no longer retrying" warning on an event the
      //    user has deliberately taken out of Google.
      prisma.calendarEvent.updateMany({
        where: { userId: ownerId, pendingSince: { not: null } },
        data: { pendingSince: null },
      }),
      // 8. Delete this user's contacts
      prisma.contact.deleteMany({ where: { customer: { userId: ownerId } } }),
      // 9. Delete this user's companies
      prisma.customer.deleteMany({ where: { userId: ownerId } }),
      // 10. Delete the GoogleAuth record
      prisma.googleAuth.delete({ where: { id: auth.id } }),
    ]);
  },

  /**
   * Get an authenticated Google OAuth2 client.
   * Can be called with userId (from requests) or without (from background jobs).
   * Set forceRefresh=true to always get a fresh token (for long-running operations).
   */
  async getAuthenticatedClient(userId?: string, forceRefresh = false) {
    const where = userId ? { userId } : {};
    const auth = await prisma.googleAuth.findFirst({ where });
    if (!auth) return null;

    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = decrypt(auth.accessToken);
      refreshToken = decrypt(auth.refreshToken);
    } catch {
      // A different TOKEN_ENCRYPTION_KEY, or a damaged row: nothing here can
      // reach Google, and only a Reconnect writes tokens this key can read.
      // Recorded once, like a refusal — the decryption error itself is
      // dropped, so neither the row nor the key can reach a log line.
      await googleAuthService.recordAuthError(auth.userId, TOKEN_UNREADABLE, auth.refreshToken).catch((recordErr) => {
        console.error('[GoogleAuth] Could not record unreadable credentials:', recordErr?.message ?? recordErr);
      });
      throw tokenUnreadableError();
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: auth.tokenExpiry.getTime(),
    });

    // Auto-persist new tokens when Google refreshes them during long operations
    oauth2Client.on('tokens', async (tokens) => {
      try {
        const updateData: Record<string, unknown> = {};
        if (tokens.access_token) updateData.accessToken = encrypt(tokens.access_token);
        if (tokens.refresh_token) updateData.refreshToken = encrypt(tokens.refresh_token);
        if (tokens.expiry_date) updateData.tokenExpiry = new Date(tokens.expiry_date);
        if (tokens.scope) updateData.scope = tokens.scope;
        if (Object.keys(updateData).length > 0) {
          await prisma.googleAuth.update({ where: { id: auth.id }, data: updateData });
        }
        // A refresh Google answered is the grant working.
        if (tokens.access_token) await googleAuthService.clearAuthError(auth.userId);
      } catch {
        // Best effort — don't crash on token persistence failure
      }
    });

    // Proactive refresh if forced or within 10 minutes of expiry
    const now = Date.now();
    const expiresIn = auth.tokenExpiry.getTime() - now;
    if (forceRefresh || expiresIn < 10 * 60 * 1000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        // google-auth-library hands the refresh token it was given back in
        // `credentials` whether or not Google rotated it. Re-encrypting that
        // echo wrote new ciphertext (a fresh IV) on every refresh, so the
        // stored grant appeared to change hourly — and `recordAuthError`
        // compares it to know which grant a refusal belongs to.
        const rotated =
          credentials.refresh_token && credentials.refresh_token !== refreshToken
            ? credentials.refresh_token
            : null;
        await prisma.googleAuth.update({
          where: { id: auth.id },
          data: {
            accessToken: encrypt(credentials.access_token!),
            tokenExpiry: new Date(credentials.expiry_date!),
            ...(rotated ? { refreshToken: encrypt(rotated) } : {}),
            // The refresh response names the granted scopes too, which is what
            // corrects a row written before they were stored.
            ...(credentials.scope ? { scope: credentials.scope } : {}),
          },
        });
        oauth2Client.setCredentials(credentials);
        await googleAuthService.clearAuthError(auth.userId);
      } catch (err) {
        // If refresh fails, continue with the existing token: a 5xx or a network
        // blip must not cost the sync its run. A refusal is different — the
        // grant is dead, and the account has to be told. Against the refresh
        // token this call read: a Reconnect that landed during the round trip
        // has already replaced it.
        const code = classifyGoogleAuthError(err);
        if (code) {
          await googleAuthService.recordAuthError(auth.userId, code, auth.refreshToken).catch((recordErr) => {
            console.error('[GoogleAuth] Could not record a refused grant:', recordErr?.message ?? recordErr);
          });
        }
      }
    }

    return oauth2Client;
  },
};
