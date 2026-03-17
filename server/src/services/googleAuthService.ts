import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
import { env } from '../config/env.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.modify',
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export const googleAuthService = {
  getAuthUrl() {
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  },

  async handleCallback(code: string) {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    // Get user email (best-effort)
    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data: userInfo } = await oauth2.userinfo.get();
      email = userInfo.email || null;
    } catch {
      // Scope may not include userinfo — that's OK
    }

    // Upsert — single-user app, keep only one row
    const existing = await prisma.googleAuth.findFirst();

    const authData = {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      tokenExpiry: new Date(tokens.expiry_date!),
      email,
      scope: SCOPES.join(' '),
    };

    if (existing) {
      await prisma.googleAuth.update({
        where: { id: existing.id },
        data: authData,
      });
    } else {
      await prisma.googleAuth.create({ data: authData });
    }

    return { email };
  },

  async getStatus() {
    const auth = await prisma.googleAuth.findFirst();
    if (!auth) {
      return { connected: false };
    }

    // Check if stored scope is outdated (e.g. still gmail.readonly instead of gmail.modify)
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

  async disconnect() {
    const auth = await prisma.googleAuth.findFirst();
    if (!auth) return;

    // Try to revoke the token
    try {
      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials({ access_token: auth.accessToken });
      await oauth2Client.revokeToken(auth.accessToken);
    } catch {
      // Token may already be invalid
    }

    await prisma.googleAuth.delete({ where: { id: auth.id } });
    // Clear synced data
    await prisma.calendarEvent.deleteMany({ where: { googleEventId: { not: null } } });
    await prisma.emailAttachment.deleteMany({});
    await prisma.email.deleteMany({ where: { gmailMessageId: { not: null } } });
  },

  async getAuthenticatedClient() {
    const auth = await prisma.googleAuth.findFirst();
    if (!auth) return null;

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
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
          accessToken: credentials.access_token!,
          tokenExpiry: new Date(credentials.expiry_date!),
          ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
        },
      });
      oauth2Client.setCredentials(credentials);
    }

    return oauth2Client;
  },
};
