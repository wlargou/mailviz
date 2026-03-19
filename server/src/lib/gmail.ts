import { google } from 'googleapis';
import { googleAuthService } from '../services/googleAuthService.js';

/**
 * Get an authenticated Gmail API client, or throw if Google is not connected.
 * Eliminates the repeated pattern of:
 *   const oauth2Client = await googleAuthService.getAuthenticatedClient();
 *   if (!oauth2Client) throw ...;
 *   const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
 */
export async function getGmailClient(userId?: string) {
  const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
  if (!oauth2Client) {
    throw Object.assign(new Error('Google not connected'), { status: 400 });
  }
  return google.gmail({ version: 'v1', auth: oauth2Client });
}
