import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { prisma } from '../lib/prisma.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
];

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
    refreshToken: string;
    expiryDate: number;
  };
}

export const googleAuthService = {
  /**
   * Generate Google OAuth URL.
   * intent='login': used for the login flow (state=login)
   * intent='connect': used for connecting Gmail/Calendar (state is a signed JWT containing userId)
   */
  async getAuthUrl(intent: 'login' | 'connect' = 'login', userId?: string) {
    const oauth2Client = createOAuth2Client();

    // Force consent if connecting OR if no Google auth exists (e.g., after disconnect)
    // This ensures all scopes (including gmail.modify) are re-granted
    let needsConsent = intent === 'connect';
    if (!needsConsent) {
      const existingAuth = await prisma.googleAuth.findFirst();
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
        refreshToken: tokens.refresh_token!,
        expiryDate: tokens.expiry_date!,
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
      refreshToken: encrypt(tokens.refreshToken),
      tokenExpiry: new Date(tokens.expiryDate),
      scope: SCOPES.join(' '),
      userId,
    };

    if (existing) {
      await prisma.googleAuth.update({
        where: { id: existing.id },
        data: { ...authData, email: user?.email || existing.email },
      });
    } else {
      await prisma.googleAuth.create({
        data: { ...authData, email: user?.email || null },
      });
    }

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
              userId,
            },
          });
        }
      }
    }
  },

  async getStatus(userId?: string) {
    const where = userId ? { userId } : {};
    const auth = await prisma.googleAuth.findFirst({ where });
    if (!auth) {
      return { connected: false };
    }

    const needsReauth = auth.scope
      ? !SCOPES.every((s) => auth.scope!.includes(s))
      : false;

    return {
      connected: true,
      email: auth.email,
      lastSyncAt: auth.lastSyncAt,
      lastMailSyncAt: auth.lastMailSyncAt,
      needsReauth,
    };
  },

  async disconnect(userId?: string) {
    const where = userId ? { userId } : {};
    const auth = await prisma.googleAuth.findFirst({ where });
    if (!auth) return;

    // Revoke Google OAuth token (best effort)
    try {
      const oauth2Client = createOAuth2Client();
      const accessToken = decrypt(auth.accessToken);
      oauth2Client.setCredentials({ access_token: accessToken });
      await oauth2Client.revokeToken(accessToken);
    } catch {
      // Token may already be invalid
    }

    // Delete all synced data in a transaction to ensure atomicity
    await prisma.$transaction([
      // 1. Unlink tasks from companies (keep tasks, remove company association)
      prisma.task.updateMany({ where: { customerId: { not: null } }, data: { customerId: null } }),
      // 2. Delete MailToTask links (before deleting emails)
      prisma.mailToTask.deleteMany({}),
      // 3. Delete email attachments
      prisma.emailAttachment.deleteMany({}),
      // 4. Delete ALL emails
      prisma.email.deleteMany({}),
      // 5. Delete calendar event-company links
      prisma.calendarEventCustomer.deleteMany({}),
      // 6. Delete ALL calendar events
      prisma.calendarEvent.deleteMany({}),
      // 7. Delete all contacts
      prisma.contact.deleteMany({}),
      // 8. Delete all companies
      prisma.customer.deleteMany({}),
      // 9. Delete the GoogleAuth record
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

    const accessToken = decrypt(auth.accessToken);
    const refreshToken = decrypt(auth.refreshToken);

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
        if (Object.keys(updateData).length > 0) {
          await prisma.googleAuth.update({ where: { id: auth.id }, data: updateData });
        }
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
        await prisma.googleAuth.update({
          where: { id: auth.id },
          data: {
            accessToken: encrypt(credentials.access_token!),
            tokenExpiry: new Date(credentials.expiry_date!),
            ...(credentials.refresh_token ? { refreshToken: encrypt(credentials.refresh_token) } : {}),
          },
        });
        oauth2Client.setCredentials(credentials);
      } catch {
        // If refresh fails, continue with existing token
      }
    }

    return oauth2Client;
  },

  // Helper used by calendarSyncScheduler to check if sync is in progress
  async isCalendarSyncInProgress() {
    return false; // Placeholder — actual impl is in the scheduler
  },
};

// Re-export for backward compatibility
export function isCalendarSyncInProgress() {
  return false;
}
