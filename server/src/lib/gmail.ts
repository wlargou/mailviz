import { google } from 'googleapis';
import { googleAuthService } from '../services/googleAuthService.js';
import { withGmailRateLimit } from './gmailLimiter.js';

/**
 * Get an authenticated Gmail API client, or throw if Google is not connected.
 * Eliminates the repeated pattern of:
 *   const oauth2Client = await googleAuthService.getAuthenticatedClient();
 *   if (!oauth2Client) throw ...;
 *   const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
 *
 * Every Gmail call in the app goes through here, so this is also where
 * per-user rate limiting is applied — see lib/gmailLimiter.ts. The returned
 * client has the same type and behaviour; its calls are just queued.
 */
export async function getGmailClient(userId?: string, forceRefresh = false) {
  const oauth2Client = await googleAuthService.getAuthenticatedClient(userId, forceRefresh);
  if (!oauth2Client) {
    throw Object.assign(new Error('Google not connected'), { status: 400 });
  }
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  // Without a userId, getAuthenticatedClient falls back to the first stored
  // Google account, so those callers share one limiter key. That is the
  // conservative choice: the same account never gets two independent budgets.
  return withGmailRateLimit(gmail, userId ?? 'default');
}
