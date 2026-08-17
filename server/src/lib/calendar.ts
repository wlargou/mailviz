import { google } from 'googleapis';
import { googleAuthService } from '../services/googleAuthService.js';

/**
 * Get an authenticated Google Calendar client, or throw if Google is not
 * connected.
 *
 * The counterpart to `lib/gmail.ts#getGmailClient`, and it exists for the same
 * two reasons. It removes the repeated
 *
 *   const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
 *   if (!oauth2Client) throw ...;
 *   const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
 *
 * and — the reason it was added — it gives the calendar code a single seam. With
 * the client built inline there was nowhere to substitute a fake, so calendar
 * sync was the one Google-facing path in the app with no tests at all, while
 * being the one that deletes rows in bulk.
 *
 * Unlike Gmail this is not currently rate-limited: Calendar's quota is
 * per-project rather than per-user and the sync makes far fewer calls. If that
 * changes, this is where a limiter goes.
 */
export async function getCalendarClient(userId?: string, forceRefresh = false) {
  const oauth2Client = await googleAuthService.getAuthenticatedClient(userId, forceRefresh);
  if (!oauth2Client) {
    throw Object.assign(new Error('Google Calendar not connected'), { status: 400 });
  }
  return google.calendar({ version: 'v3', auth: oauth2Client });
}
