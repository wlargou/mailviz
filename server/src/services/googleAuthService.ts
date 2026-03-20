import { google } from 'googleapis';
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
   * intent='connect': used for connecting Gmail/Calendar (state=userId)
   */
  getAuthUrl(intent: 'login' | 'connect' = 'login', userId?: string) {
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: intent === 'connect' ? 'consent' : 'select_account',
      state: intent === 'connect' && userId ? userId : 'login',
    });
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

    // 1. Unlink tasks from companies (keep tasks, remove company association)
    await prisma.task.updateMany({ where: { customerId: { not: null } }, data: { customerId: null } });

    // 2. Delete MailToTask links (before deleting emails to avoid cascade issues)
    await prisma.mailToTask.deleteMany({});

    // 3. Delete email attachments
    await prisma.emailAttachment.deleteMany({});

    // 4. Delete all synced emails
    await prisma.email.deleteMany({ where: { gmailMessageId: { not: null } } });

    // 5. Delete calendar event-customer links
    await prisma.calendarEventCustomer.deleteMany({});

    // 6. Delete all synced calendar events
    await prisma.calendarEvent.deleteMany({ where: { googleEventId: { not: null } } });

    // 7. Delete all contacts (they were auto-discovered from emails)
    await prisma.contact.deleteMany({});

    // 8. Delete all companies (they were auto-discovered from email domains)
    await prisma.customer.deleteMany({});

    // 9. Delete the GoogleAuth record
    await prisma.googleAuth.delete({ where: { id: auth.id } });
  },

  /**
   * Get an authenticated Google OAuth2 client.
   * Can be called with userId (from requests) or without (from background jobs).
   */
  async getAuthenticatedClient(userId?: string) {
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

    // Proactive refresh if within 5 minutes of expiry
    const now = Date.now();
    const expiresIn = auth.tokenExpiry.getTime() - now;
    if (expiresIn < 5 * 60 * 1000) {
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
