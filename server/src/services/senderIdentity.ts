import { getGmailClient } from '../lib/gmail.js';
import { prisma } from '../lib/prisma.js';

/**
 * The name mail goes out under.
 *
 * Mail sent through the Gmail API carries exactly the From header it is
 * given, and Mailviz gave a bare address — so every message sent from here
 * arrived as "l.walid@powerm.ma" while the same person's Outlook mail read
 * "L.walid (PowerM)". The name is the send-as display name set in Gmail,
 * falling back to the account's profile name; it is looked up once an hour,
 * not on every send.
 */

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { name: string | null; at: number }>();

export async function senderName(userId: string, address: string): Promise<string | null> {
  const key = `${userId}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;

  let name: string | null = null;
  try {
    const gmail = await getGmailClient(userId);
    const { data } = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAs = data.sendAs ?? [];
    const match = sendAs.find((s) => s.sendAsEmail?.toLowerCase() === address.toLowerCase())
      ?? sendAs.find((s) => s.isDefault);
    name = match?.displayName?.trim() || null;
  } catch {
    // Unreachable Gmail must not block a send; the profile name will do.
  }
  if (!name) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    name = user?.name?.trim() || null;
  }
  cache.set(key, { name, at: Date.now() });
  return name;
}

/** `{ name, address }` for nodemailer, which quotes and encodes the name itself. */
export async function fromHeader(userId: string, address: string): Promise<{ name: string; address: string } | string> {
  const name = await senderName(userId, address);
  return name ? { name, address } : address;
}

/** For tests: forget cached names. */
export function clearSenderNameCache() {
  cache.clear();
}
